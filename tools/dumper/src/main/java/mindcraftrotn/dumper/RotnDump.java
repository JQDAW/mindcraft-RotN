package mindcraftrotn.dumper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.google.gson.stream.JsonWriter;

import net.minecraft.command.CommandBase;
import net.minecraft.command.ICommandSender;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.text.TextComponentString;
import net.minecraftforge.common.DimensionManager;
import net.minecraftforge.common.ForgeVersion;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Loader;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.ModContainer;
import net.minecraftforge.fml.common.event.FMLServerStartedEvent;
import net.minecraftforge.fml.common.event.FMLServerStartingEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;

/**
 * RotN data dumper (Mindcraft-RotN ADR 0004). For the disposable test server only.
 *
 * Strictly opt-in: nothing happens unless the file "rotn-dump.enable" exists in the server folder
 * (the test server creates it; a copy of this jar on any other server does nothing). With the
 * marker present, a dump is scheduled once the server has started, and the console command
 * "rotndump" (permission level 4) schedules another.
 *
 * A dump writes format "rotn-dump/1" files to ./rotn-dump/: one part per server tick (oredict,
 * blocks, items, recipes, smelting, entities, spawns, then manifest), each written to
 * NAME.json.tmp and renamed into place, and the DONE marker last. A reader must wait for DONE.
 * It only reads game state. acceptableRemoteVersions = "*": clients without the mod can join.
 */
@Mod(modid = RotnDump.MODID, name = "RotN Data Dumper", version = RotnDump.VERSION,
        acceptableRemoteVersions = "*", serverSideOnly = true)
public class RotnDump {
    public static final String MODID = "rotndump";
    public static final String VERSION = "0.1.0"; // keep equal to build.gradle's version (build.sh checks)
    public static final String FORMAT = "rotn-dump/1";
    public static final String ENABLE_MARKER = "rotn-dump.enable";
    static final Logger LOG = LogManager.getLogger(MODID);

    private static Job running;

    static boolean enabled() {
        return new File(ENABLE_MARKER).isFile();
    }

    static File outDir() {
        return new File("rotn-dump");
    }

    @Mod.EventHandler
    public void serverStarting(FMLServerStartingEvent event) {
        event.registerServerCommand(new DumpCommand());
    }

    @Mod.EventHandler
    public void serverStarted(FMLServerStartedEvent event) {
        if (!enabled()) {
            LOG.info("[rotndump] disabled: no {} in the server folder", ENABLE_MARKER);
            return;
        }
        LOG.info("[rotndump] {}", schedule());
    }

    /** Starts a dump on the following server ticks; returns a status line. */
    static synchronized String schedule() {
        if (!enabled()) return "disabled: no " + ENABLE_MARKER + " in the server folder";
        if (running != null) return "a dump is already running";
        File dir = outDir();
        if (!dir.isDirectory() && !dir.mkdirs()) return "cannot create " + dir.getAbsolutePath();
        File done = new File(dir, "DONE");
        if (done.exists() && !done.delete()) return "cannot remove the old DONE marker";
        running = new Job(dir);
        MinecraftForge.EVENT_BUS.register(running);
        return "dump scheduled into " + dir.getAbsolutePath() + "; wait for rotn-dump/DONE";
    }

    static synchronized void finished(Job job) {
        MinecraftForge.EVENT_BUS.unregister(job);
        if (running == job) running = null;
    }

    interface Part {
        int write(JsonWriter w) throws IOException;
    }

    /** One dump: a queue of parts, one per server tick. */
    public static final class Job {
        private final File dir;
        private final long t0 = System.currentTimeMillis();
        private final Names names = new Names();
        private final Map<String, Object> counts = new LinkedHashMap<>();
        private final List<String> errors = new ArrayList<>();
        private final Deque<String> todo = new ArrayDeque<>();

        Job(File dir) {
            this.dir = dir;
            for (String p : new String[] {"oredict", "blocks", "items", "recipes", "smelting", "entities", "spawns", "manifest"}) todo.add(p);
        }

        @SubscribeEvent
        public void onTick(TickEvent.ServerTickEvent event) {
            if (event.phase != TickEvent.Phase.END) return;
            String p = todo.poll();
            if (p == null) {
                finish();
                return;
            }
            long t = System.currentTimeMillis();
            write(p, partFor(p));
            LOG.info("[rotndump] {}: {} in {} ms", p, counts.get(p), System.currentTimeMillis() - t);
        }

        private Part partFor(String p) {
            switch (p) {
                case "oredict": return w -> new OreDumper().write(w);
                case "blocks": return w -> new BlockDumper(DimensionManager.getWorld(0)).write(w);
                case "items": return w -> new ItemDumper(names).write(w);
                case "recipes": return w -> new RecipeDumper(names, DimensionManager.getWorld(0)).write(w);
                case "smelting": return w -> new SmeltingDumper().write(w);
                case "entities": return w -> new EntityDumper().write(w);
                case "spawns": return w -> new SpawnDumper().write(w);
                default: return this::writeManifest;
            }
        }

        private void write(String name, Part part) {
            File tmp = new File(dir, name + ".json.tmp");
            File dst = new File(dir, name + ".json");
            try {
                try (Writer out = new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8)) {
                    JsonWriter w = new JsonWriter(out);
                    w.setIndent("");
                    w.setSerializeNulls(true);
                    int n = part.write(w);
                    w.flush();
                    counts.put(name, n);
                }
                move(tmp, dst);
            } catch (Throwable t) {
                LOG.error("[rotndump] {} failed", name, t);
                errors.add(name + ": " + t);
                counts.put(name, "error");
                if (!tmp.delete()) tmp.deleteOnExit();
            }
        }

        private void finish() {
            String summary = "[rotndump] wrote " + counts + " to " + dir.getAbsolutePath() + " in "
                    + (System.currentTimeMillis() - t0) + " ms, errors: " + errors.size();
            File tmp = new File(dir, "DONE.tmp");
            try {
                try (Writer w = new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8)) {
                    w.write(summary + "\n");
                }
                move(tmp, new File(dir, "DONE"));
            } catch (IOException e) {
                LOG.error("[rotndump] cannot write DONE", e);
            }
            LOG.info(summary);
            finished(this);
        }

        private int writeManifest(JsonWriter w) throws IOException {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            List<ModContainer> mods = new ArrayList<>(Loader.instance().getActiveModList());
            mods.sort((a, b) -> a.getModId().compareTo(b.getModId()));
            StringBuilder modList = new StringBuilder();
            for (ModContainer m : mods) modList.append(m.getModId()).append('@').append(m.getVersion()).append('\n');

            w.beginObject();
            J.str(w, "format", FORMAT);
            J.str(w, "dumper", VERSION);
            J.str(w, "minecraft", "1.12.2");
            J.str(w, "forge", ForgeVersion.getVersion());
            J.str(w, "dumpedAt", iso.format(new Date(t0)));
            J.num(w, "modCount", mods.size());
            J.str(w, "modListSha256", sha256(modList.toString()));
            w.name("mods").beginArray();
            for (ModContainer m : mods) {
                w.beginObject();
                J.str(w, "id", m.getModId());
                J.str(w, "version", m.getVersion());
                w.endObject();
            }
            w.endArray();
            w.name("counts").beginObject();
            for (Map.Entry<String, Object> e : counts.entrySet()) {
                if (e.getValue() instanceof Number) J.num(w, e.getKey(), (Number) e.getValue());
                else J.str(w, e.getKey(), String.valueOf(e.getValue()));
            }
            w.endObject();
            w.name("errors").beginArray();
            for (String e : errors) w.value(e);
            w.endArray();
            w.endObject();
            return 1;
        }
    }

    private static void move(File from, File to) throws IOException {
        try {
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static String sha256(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (byte x : d) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) {
            return null;
        }
    }

    public static class DumpCommand extends CommandBase {
        @Override
        public String getName() {
            return MODID;
        }

        @Override
        public String getUsage(ICommandSender sender) {
            return "/rotndump - schedule a RotN data dump into ./rotn-dump/ (needs " + ENABLE_MARKER + ")";
        }

        @Override
        public int getRequiredPermissionLevel() {
            return 4; // console or op level 4 only
        }

        @Override
        public void execute(MinecraftServer server, ICommandSender sender, String[] args) {
            sender.sendMessage(new TextComponentString("[rotndump] " + schedule()));
        }
    }
}
