package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.google.gson.stream.JsonWriter;

import net.minecraft.item.ItemStack;
import net.minecraft.item.crafting.FurnaceRecipes;

/**
 * smelting.json: {"format", "smelting": [{input {name, meta}, output {name, meta, count}, xp}]}
 * from the vanilla furnace (FurnaceRecipes, after CraftTweaker's furnace.* changes).
 * Pyrotech kilns and other mod stations are a later increment (ADR 0004).
 */
final class SmeltingDumper {
    int write(JsonWriter w) throws IOException {
        List<Map.Entry<ItemStack, ItemStack>> list = new ArrayList<>(FurnaceRecipes.instance().getSmeltingList().entrySet());
        list.removeIf(e -> e.getKey() == null || e.getValue() == null || e.getKey().isEmpty() || e.getValue().isEmpty());
        list.sort((a, b) -> Names.stackKey(a.getKey()).compareTo(Names.stackKey(b.getKey())));
        int n = 0;
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("smelting").beginArray();
        for (Map.Entry<ItemStack, ItemStack> e : list) {
            Float xp = J.get(() -> FurnaceRecipes.instance().getSmeltingExperience(e.getValue()));
            w.beginObject();
            w.name("input");
            Names.stack(w, e.getKey(), false);
            w.name("output");
            Names.stack(w, e.getValue(), true);
            J.num(w, "xp", xp);
            w.endObject();
            n++;
        }
        w.endArray();
        w.endObject();
        return n;
    }
}
