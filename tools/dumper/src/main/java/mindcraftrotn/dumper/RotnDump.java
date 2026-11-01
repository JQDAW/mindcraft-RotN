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
 * A dump writes format "rotn-dump/1" files to ./rotn-dump/ (oredict, blocks, items, recipes,
 * smelting, entities, spawns, serializers, then manifest), at most BATCH entries and about
 * TICK_BUDGET_MS per server tick, each file
 * written to NAME.json.tmp and renamed into place, and the DONE marker last. A reader must wait
 * for DONE.
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

    /** Entries written per server tick, at most (PR #34 review: about 500). */
    static final int BATCH = 500;
    /** Time per server tick, at most: a batch stops early once it has used this (PR #34 follow-up 1). */
    static final long TICK_BUDGET_MS = 40;

    /**
     * One dump: parts in order, each written in batches of at most BATCH entries per server tick.
     * Each part's duration and tick count are logged and stored in the manifest.
     */
    public static final class Job {
        private final File dir;
        private final long t0 = System.currentTimeMillis();
        private final Names names = new Names();
        private final Map<String, Object> counts = new LinkedHashMap<>();
        private final Map<String, long[]> timing = new LinkedHashMap<>(); // name -> {ms, ticks}
        private final Map<String, Object[]> entryErrors = new LinkedHashMap<>(); // name -> {count, first}
        private final List<String> errors = new ArrayList<>();
        private final Deque<String> todo = new ArrayDeque<>();

        // the part being written
        private String name;
        private Part<?> part;
        private Writer out;
        private JsonWriter w;
        private int next;
        private int written;
        private long partMs;
        private long partTicks;

        Job(File dir) {
            this.dir = dir;
            for (String p : new String[] {"oredict", "blocks", "items", "recipes", "smelting", "entities", "spawns", "serializers", "manifest"}) todo.add(p);
        }

        @SubscribeEvent
        public void onTick(TickEvent.ServerTickEvent event) {
            if (event.phase != TickEvent.Phase.END) return;
            long t = System.currentTimeMillis();
            try {
                if (part == null) {
                    String p = todo.poll();
                    if (p == null) {
                        finish();
                        return;
                    }
                    open(p);
                }
                int stop = Math.min(part.size(), next + BATCH);
                // At least one entry per tick (if any are left), then stop at BATCH entries or TICK_BUDGET_MS.
                while (next < stop) {
                    if (part.write(w, next)) written++;
                    next++;
                    if (System.currentTimeMillis() - t >= TICK_BUDGET_MS) break;
                }
                partTicks++;
                partMs += System.currentTimeMillis() - t;
                if (next >= part.size()) close();
            } catch (Throwable e) {
                fail(e);
            }
        }

        private Part<?> partFor(String p) {
            switch (p) {
                case "oredict": return new OreDumper();
                case "blocks": return new BlockDumper(DimensionManager.getWorld(0));
                case "items": return new ItemDumper(names);
                case "recipes": return new RecipeDumper(names, DimensionManager.getWorld(0));
                case "smelting": return new SmeltingDumper();
                case "entities": return new EntityDumper();
                case "spawns": return new SpawnDumper();
                case "serializers": return new SerializerDumper(DimensionManager.getWorld(0));
                default: return new ManifestPart();
            }
        }

        private void open(String p) throws IOException {
            long t = System.currentTimeMillis();
            name = p;
            part = partFor(p);
            next = 0;
            written = 0;
            partTicks = 0;
            out = new OutputStreamWriter(new FileOutputStream(new File(dir, p + ".json.tmp")), StandardCharsets.UTF_8);
            w = new JsonWriter(out);
            w.setLenient(true); // entries arrive pre-rendered through jsonValue (Part.write)
            w.setIndent("");
            w.setSerializeNulls(true);
            part.begin(w);
            partMs = System.currentTimeMillis() - t;
        }

        private void close() throws IOException {
            long t = System.currentTimeMillis();
            part.end(w);
            w.flush();
            out.close();
            move(new File(dir, name + ".json.tmp"), new File(dir, name + ".json"));
            partMs += System.currentTimeMillis() - t;
            counts.put(name, written);
            timing.put(name, new long[] {partMs, partTicks});
            if (part.entryErrors > 0) {
                entryErrors.put(name, new Object[] {part.entryErrors, part.firstEntryError});
                LOG.warn("[rotndump] {}: {} entries dropped, first: {}", name, part.entryErrors, part.firstEntryError);
            }
            LOG.info("[rotndump] {}: {} entries in {} ms over {} ticks", name, written, partMs, partTicks);
            part = null;
        }

        private void fail(Throwable e) {
            LOG.error("[rotndump] {} failed", name, e);
            errors.add(name + ": " + e);
            counts.put(name, "error");
            try {
                if (out != null) out.close();
            } catch (IOException ignored) {
                // nothing more to do
            }
            File tmp = new File(dir, name + ".json.tmp");
            if (!tmp.delete()) tmp.deleteOnExit();
            part = null;
        }

        private void finish() {
            String summary = "[rotndump] wrote " + counts + " to " + dir.getAbsolutePath() + " in "
                    + (System.currentTimeMillis() - t0) + " ms, errors: " + errors.size();
            File tmp = new File(dir, "DONE.tmp");
            try {
                try (Writer d = new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8)) {
                    d.write(summary + "\n");
                }
                move(tmp, new File(dir, "DONE"));
            } catch (IOException e) {
                LOG.error("[rotndump] cannot write DONE", e);
            }
            LOG.info(summary);
            finished(this);
        }

        /** manifest.json: written last, so it holds every other part's count, timing and errors. */
        private final class ManifestPart extends Part<Object> {
            @Override
            protected List<Object> entries() {
                return java.util.Collections.singletonList(null);
            }

            @Override
            protected void head(JsonWriter j) {
            }

            @Override
            protected boolean entry(JsonWriter j, Object ignored) throws IOException {
                writeManifest(j);
                return true;
            }

            @Override
            protected void tail(JsonWriter j) {
            }
        }

        private void writeManifest(JsonWriter j) throws IOException {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            List<ModContainer> mods = new ArrayList<>(Loader.instance().getActiveModList());
            mods.sort((a, b) -> a.getModId().compareTo(b.getModId()));
            StringBuilder modList = new StringBuilder();
            for (ModContainer m : mods) modList.append(m.getModId()).append('@').append(m.getVersion()).append('\n');
            File jar = J.get(() -> Loader.instance().getIndexedModList().get(MODID).getSource());
            String jarSha = jar == null || !jar.isFile() ? null : J.get(() -> sha256(Files.readAllBytes(jar.toPath())));
            Long jarBytes = jar == null || !jar.isFile() ? null : jar.length();

            j.beginObject();
            J.str(j, "format", FORMAT);
            J.str(j, "dumper", VERSION);
            // FG3's build is not byte-reproducible, so the jar that ran is identified by its hash.
            j.name("dumperJar").beginObject();
            J.str(j, "file", jar == null ? null : jar.getName());
            J.num(j, "bytes", jarBytes);
            J.str(j, "sha256", jarSha);
            j.endObject();
            J.str(j, "minecraft", "1.12.2");
            J.str(j, "forge", ForgeVersion.getVersion());
            J.str(j, "dumpedAt", iso.format(new Date(t0)));
            J.num(j, "batch", BATCH);
            J.num(j, "tickBudgetMs", TICK_BUDGET_MS);
            J.num(j, "modCount", mods.size());
            J.str(j, "modListSha256", sha256(modList.toString().getBytes(StandardCharsets.UTF_8)));
            j.name("mods").beginArray();
            for (ModContainer m : mods) {
                j.beginObject();
                J.str(j, "id", m.getModId());
                J.str(j, "version", m.getVersion());
                j.endObject();
            }
            j.endArray();
            j.name("counts").beginObject();
            for (Map.Entry<String, Object> e : counts.entrySet()) {
                if (e.getValue() instanceof Number) J.num(j, e.getKey(), (Number) e.getValue());
                else J.str(j, e.getKey(), String.valueOf(e.getValue()));
            }
            j.endObject();
            j.name("timing").beginObject();
            for (Map.Entry<String, long[]> e : timing.entrySet()) {
                j.name(e.getKey()).beginObject();
                J.num(j, "ms", e.getValue()[0]);
                J.num(j, "ticks", e.getValue()[1]);
                j.endObject();
            }
            j.endObject();
            // Entries dropped inside a part (the rest of the part was written).
            j.name("entryErrors").beginObject();
            for (Map.Entry<String, Object[]> e : entryErrors.entrySet()) {
                j.name(e.getKey()).beginObject();
                J.num(j, "count", (Integer) e.getValue()[0]);
                J.str(j, "first", (String) e.getValue()[1]);
                j.endObject();
            }
            j.endObject();
            j.name("errors").beginArray();
            for (String e : errors) j.value(e);
            j.endArray();
            j.endObject();
        }
    }

    private static void move(File from, File to) throws IOException {
        try {
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static String sha256(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
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
