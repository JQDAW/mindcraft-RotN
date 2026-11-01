package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.google.gson.stream.JsonWriter;

import net.minecraft.entity.EnumCreatureType;
import net.minecraft.world.biome.Biome;
import net.minecraftforge.fml.common.registry.EntityRegistry;
import net.minecraftforge.fml.common.registry.ForgeRegistries;

/**
 * spawns.json: {"format", "biomes": {"minecraft:plains": {"monster": [{entity, weight, min, max}],
 * "creature": [...], "ambient": [...], "water_creature": [...]}}}
 * These are the biomes' natural spawn lists after every mod registered its spawns. Mods that
 * filter spawns in events at spawn time (stages, light rules, invasions) are not reflected.
 */
final class SpawnDumper {
    int write(JsonWriter w) throws IOException {
        List<Biome> biomes = new ArrayList<>(ForgeRegistries.BIOMES.getValuesCollection());
        biomes.sort((a, b) -> String.valueOf(a.getRegistryName()).compareTo(String.valueOf(b.getRegistryName())));
        int n = 0;
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("biomes").beginObject();
        for (Biome b : biomes) {
            if (b.getRegistryName() == null) continue;
            w.name(b.getRegistryName().toString()).beginObject();
            for (EnumCreatureType type : EnumCreatureType.values()) {
                w.name(type.name().toLowerCase(Locale.ROOT)).beginArray();
                List<Biome.SpawnListEntry> list = J.get(() -> new ArrayList<>(b.getSpawnableList(type)));
                if (list != null) {
                    for (Biome.SpawnListEntry e : list) {
                        String entity = J.get(() -> EntityRegistry.getEntry(e.entityClass).getRegistryName().toString());
                        w.beginObject();
                        J.str(w, "entity", entity);
                        J.str(w, "class", e.entityClass == null ? null : e.entityClass.getName());
                        J.num(w, "weight", e.itemWeight);
                        J.num(w, "min", e.minGroupCount);
                        J.num(w, "max", e.maxGroupCount);
                        w.endObject();
                    }
                }
                w.endArray();
            }
            w.endObject();
            n++;
        }
        w.endObject();
        w.endObject();
        return n;
    }
}
