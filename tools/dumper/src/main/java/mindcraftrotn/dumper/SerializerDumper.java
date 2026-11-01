package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import net.minecraft.entity.Entity;
import net.minecraft.network.datasync.DataSerializer;
import net.minecraft.network.datasync.DataSerializers;
import net.minecraft.network.datasync.EntityDataManager;
import net.minecraft.world.World;
import net.minecraftforge.fml.common.registry.EntityEntry;
import net.minecraftforge.fml.common.registry.ForgeRegistries;

/**
 * serializers.json (net-forge request): the entity-metadata DataSerializer table and which entity
 * data keys use a modded serializer, so forge-bridge can decode them (e.g. ids 15-18).
 * {"format",
 *  "serializers": [{id, class, vanilla}]         every id 0..1023 that DataSerializers.getSerializer
 *                                                knows (Forge's patched lookup, so ids >= 256 from the
 *                                                forge:dataserializers registry are included),
 *  "usage": {"<entity>": [{index, serializerId, class}]}}  only keys with a non-vanilla serializer,
 *                                                read from a freshly constructed (never spawned)
 *                                                entity's EntityDataManager.
 * vanilla = the serializer's class is in net.minecraft. Constructing an entity runs the mod's
 * entity constructor and Forge's capability-attach events (the entity is never spawned or added to
 * the world). Constructors that throw are caught (Throwable), counted in manifest.entryErrors and
 * skipped; check that count after each batch (PR #48 review follow-up 4).
 */
final class SerializerDumper extends Part<EntityEntry> {
    private static final int MAX_ID = 1023;
    private final World world;

    SerializerDumper(World world) {
        this.world = world;
    }

    static boolean vanilla(DataSerializer<?> s) {
        return s.getClass().getName().startsWith("net.minecraft.");
    }

    @Override
    protected List<EntityEntry> entries() {
        List<EntityEntry> entries = new ArrayList<>(ForgeRegistries.ENTITIES.getValuesCollection());
        entries.removeIf(e -> e.getRegistryName() == null);
        entries.sort((a, b) -> a.getRegistryName().toString().compareTo(b.getRegistryName().toString()));
        return entries;
    }

    @Override
    protected void head(JsonWriter w) throws IOException {
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("serializers").beginArray();
        for (int id = 0; id <= MAX_ID; id++) {
            final int i = id;
            DataSerializer<?> s = J.get(() -> DataSerializers.getSerializer(i));
            if (s == null) continue;
            w.beginObject();
            J.num(w, "id", id);
            J.str(w, "class", s.getClass().getName());
            J.bool(w, "vanilla", vanilla(s));
            w.endObject();
        }
        w.endArray();
        w.name("usage").beginObject();
    }

    @Override
    protected String key(EntityEntry e) {
        return e.getRegistryName().toString();
    }

    @Override
    protected boolean entry(JsonWriter w, EntityEntry e) throws IOException {
        if (world == null) return false;
        Entity ent = e.newInstance(world); // a throw here drops only this entity (Part.write)
        if (ent == null) return false;
        List<EntityDataManager.DataEntry<?>> all = ent.getDataManager().getAll();
        if (all == null) return false;
        List<Object[]> modded = new ArrayList<>();
        for (EntityDataManager.DataEntry<?> d : all) {
            DataSerializer<?> s = d.getKey().getSerializer();
            if (s == null || vanilla(s)) continue;
            modded.add(new Object[] {d.getKey().getId(), DataSerializers.getSerializerId(s), s.getClass().getName()});
        }
        if (modded.isEmpty()) return false;
        w.beginArray();
        for (Object[] m : modded) {
            w.beginObject();
            J.num(w, "index", (Integer) m[0]);
            J.num(w, "serializerId", (Integer) m[1]);
            J.str(w, "class", (String) m[2]);
            w.endObject();
        }
        w.endArray();
        return true;
    }

    @Override
    protected void tail(JsonWriter w) throws IOException {
        w.endObject();
        w.endObject();
    }
}
