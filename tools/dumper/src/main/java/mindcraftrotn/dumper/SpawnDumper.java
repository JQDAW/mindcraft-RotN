package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import net.minecraft.entity.EnumCreatureType;
import net.minecraft.world.biome.Biome;
import net.minecraftforge.fml.common.registry.EntityEntry;
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
        w.name("format").value(RotnDump.FORMAT);
        w.name("biomes").beginObject();
        for (Biome b : biomes) {
            if (b.getRegistryName() == null) continue;
            w.name(b.getRegistryName().toString()).beginObject();
            for (EnumCreatureType type : EnumCreatureType.values()) {
                w.name(type.name().toLowerCase()).beginArray();
                try {
                    for (Biome.SpawnListEntry e : b.getSpawnableList(type)) {
                        EntityEntry entry = EntityRegistry.getEntry(e.entityClass);
                        w.beginObject();
                        w.name("entity").value(entry != null && entry.getRegistryName() != null ? entry.getRegistryName().toString() : null);
                        w.name("class").value(e.entityClass.getName());
                        w.name("weight").value(e.itemWeight);
                        w.name("min").value(e.minGroupCount);
                        w.name("max").value(e.maxGroupCount);
                        w.endObject();
                    }
                } catch (Throwable t) {
                    // leave the list short
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
