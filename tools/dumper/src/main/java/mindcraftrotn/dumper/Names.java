package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.stream.JsonWriter;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.oredict.OreDictionary;

/** Stack and name helpers shared by every dumper. Everything is keyed by registry name + metadata. */
final class Names {
    /** Sorted "name:meta|..." signature of an ore's stacks -> the ore name (first one, alphabetically). */
    private Map<String, String> oreBySignature;

    static String name(Item item) {
        if (item == null) return null;
        ResourceLocation rl = item.getRegistryName();
        return rl == null ? null : rl.toString();
    }

    static String stackKey(ItemStack s) {
        return name(s.getItem()) + ":" + s.getItemDamage();
    }

    /** {"name": ..., "meta": ...[, "count": n]} or null for an empty stack. */
    static void stack(JsonWriter w, ItemStack s, boolean withCount) throws IOException {
        if (s == null || s.isEmpty() || name(s.getItem()) == null) {
            w.nullValue();
            return;
        }
        w.beginObject();
        w.name("name").value(name(s.getItem()));
        w.name("meta").value(s.getItemDamage());
        if (withCount) w.name("count").value(s.getCount());
        if (s.hasTagCompound()) w.name("nbt").value(String.valueOf(s.getTagCompound()));
        w.endObject();
    }

    static String signature(List<ItemStack> stacks) {
        List<String> keys = new ArrayList<>();
        for (ItemStack s : stacks) if (s != null && !s.isEmpty()) keys.add(stackKey(s));
        Collections.sort(keys);
        return String.join("|", keys);
    }

    /** The ore dictionary key whose stacks are exactly `stacks`, or null. */
    String oreFor(List<ItemStack> stacks) {
        if (oreBySignature == null) {
            oreBySignature = new HashMap<>();
            List<String> ores = new ArrayList<>();
            Collections.addAll(ores, OreDictionary.getOreNames());
            Collections.sort(ores);
            for (String ore : ores) {
                List<ItemStack> list = OreDictionary.getOres(ore, false);
                if (list == null || list.isEmpty()) continue;
                oreBySignature.putIfAbsent(signature(list), ore);
            }
        }
        if (stacks.isEmpty()) return null;
        return oreBySignature.get(signature(stacks));
    }

    static Double finite(double d) {
        return Double.isNaN(d) || Double.isInfinite(d) ? null : d;
    }

    static void num(JsonWriter w, String key, Double d) throws IOException {
        w.name(key);
        if (d == null) w.nullValue();
        else w.value(d);
    }
}
