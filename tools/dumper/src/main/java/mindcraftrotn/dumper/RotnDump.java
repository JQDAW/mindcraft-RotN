package mindcraftrotn.dumper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
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
import net.minecraft.world.World;
import net.minecraftforge.common.DimensionManager;
import net.minecraftforge.common.ForgeVersion;
import net.minecraftforge.fml.common.Loader;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.ModContainer;
import net.minecraftforge.fml.common.event.FMLServerStartedEvent;
import net.minecraftforge.fml.common.event.FMLServerStartingEvent;

/**
 * RotN data dumper (Mindcraft-RotN ADR 0004). Runs on the disposable test server only.
 *
 * Once the server has started (every mod and CraftTweaker script loaded) it reads the live
 * registries and writes JSON files in format "rotn-dump/1" to ./rotn-dump/ (relative to the
 * server folder): manifest, blocks, items, recipes, smelting, oredict, entities, spawns.
 * The console command "rotndump" writes them again. It only reads game state.
 *
 * acceptableRemoteVersions = "*": clients without this mod can still join.
 * System properties: -Drotndump.auto=false (no dump at start), -Drotndump.dir=PATH.
 */
@Mod(modid = RotnDump.MODID, name = "RotN Data Dumper", version = RotnDump.VERSION,
        acceptableRemoteVersions = "*", serverSideOnly = true)
public class RotnDump {
    public static final String MODID = "rotndump";
    public static final String VERSION = "@VERSION@";
    public static final String FORMAT = "rotn-dump/1";
    static final Logger LOG = LogManager.getLogger(MODID);

    @Mod.EventHandler
    public void serverStarting(FMLServerStartingEvent event) {
        event.registerServerCommand(new DumpCommand());
    }

    @Mod.EventHandler
    public void serverStarted(FMLServerStartedEvent event) {
        if ("false".equalsIgnoreCase(System.getProperty("rotndump.auto", "true"))) {
            LOG.info("[rotndump] auto dump disabled (-Drotndump.auto=false); run the rotndump command");
            return;
        }
        runDump();
    }

    static File outDir() {
        return new File(System.getProperty("rotndump.dir", "rotn-dump"));
    }

    /** Writes every file; returns a one-line summary. Errors in one part never stop the others. */
    static synchronized String runDump() {
        long t0 = System.currentTimeMillis();
        File dir = outDir();
        if (!dir.isDirectory() && !dir.mkdirs()) {
            LOG.error("[rotndump] cannot create {}", dir.getAbsolutePath());
            return "cannot create " + dir;
        }
        File done = new File(dir, "DONE");
        if (done.exists() && !done.delete()) LOG.warn("[rotndump] could not remove old DONE marker");
        World world = DimensionManager.getWorld(0);
        Map<String, Object> counts = new LinkedHashMap<>();
        List<String> errors = new ArrayList<>();
        Names names = new Names();

        part(dir, "oredict", errors, counts, w -> new OreDumper(names).write(w));
        part(dir, "blocks", errors, counts, w -> new BlockDumper(names, world).write(w));
        part(dir, "items", errors, counts, w -> new ItemDumper(names).write(w));
        part(dir, "recipes", errors, counts, w -> new RecipeDumper(names, world).write(w));
        part(dir, "smelting", errors, counts, w -> new SmeltingDumper(names).write(w));
        part(dir, "entities", errors, counts, w -> new EntityDumper().write(w));
        part(dir, "spawns", errors, counts, w -> new SpawnDumper().write(w));
        part(dir, "manifest", errors, counts, w -> writeManifest(w, counts, errors, t0));

        String summary = "[rotndump] wrote " + counts + " to " + dir.getAbsolutePath() + " in "
                + (System.currentTimeMillis() - t0) + " ms, errors: " + errors.size();
        try (Writer w = new OutputStreamWriter(new FileOutputStream(done), StandardCharsets.UTF_8)) {
            w.write(summary + "\n");
        } catch (IOException e) {
            LOG.error("[rotndump] cannot write DONE", e);
        }
        LOG.info(summary);
        return summary;
    }

    interface Part {
        int write(JsonWriter w) throws IOException;
    }

    private static void part(File dir, String name, List<String> errors, Map<String, Object> counts, Part p) {
        File f = new File(dir, name + ".json");
        try (Writer out = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
            JsonWriter w = new JsonWriter(out);
            w.setIndent("");
            w.setSerializeNulls(true);
            int n = p.write(w);
            w.flush();
            counts.put(name, n);
        } catch (Throwable t) {
            LOG.error("[rotndump] {} failed", name, t);
            errors.add(name + ": " + t);
            counts.put(name, "error");
        }
    }

    private static int writeManifest(JsonWriter w, Map<String, Object> counts, List<String> errors, long t0) throws IOException {
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        List<ModContainer> mods = new ArrayList<>(Loader.instance().getActiveModList());
        mods.sort((a, b) -> a.getModId().compareTo(b.getModId()));
        StringBuilder modList = new StringBuilder();
        for (ModContainer m : mods) modList.append(m.getModId()).append('@').append(m.getVersion()).append('\n');

        w.beginObject();
        w.name("format").value(FORMAT);
        w.name("dumper").value(VERSION);
        w.name("minecraft").value("1.12.2");
        w.name("forge").value(ForgeVersion.getVersion());
        w.name("dumpedAt").value(iso.format(new Date(t0)));
        w.name("modCount").value(mods.size());
        w.name("modListSha256").value(sha256(modList.toString()));
        w.name("mods").beginArray();
        for (ModContainer m : mods) {
            w.beginObject().name("id").value(m.getModId()).name("version").value(m.getVersion()).endObject();
        }
        w.endArray();
        w.name("counts").beginObject();
        for (Map.Entry<String, Object> e : counts.entrySet()) {
            if (e.getValue() instanceof Number) w.name(e.getKey()).value((Number) e.getValue());
            else w.name(e.getKey()).value(String.valueOf(e.getValue()));
        }
        w.endObject();
        w.name("errors").beginArray();
        for (String e : errors) w.value(e);
        w.endArray();
        w.endObject();
        return 1;
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
            return "/rotndump - write the RotN data dump to ./rotn-dump/";
        }

        @Override
        public int getRequiredPermissionLevel() {
            return 4; // console or op level 4 only
        }

        @Override
        public void execute(MinecraftServer server, ICommandSender sender, String[] args) {
            sender.sendMessage(new TextComponentString(runDump()));
        }
    }
}
