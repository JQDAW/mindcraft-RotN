package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import net.minecraft.item.ItemStack;
import net.minecraftforge.oredict.OreDictionary;

/** oredict.json: {"format", "ores": {"rock": [{name, meta}, ...]}}; meta 32767 is the wildcard. */
final class OreDumper extends Part<String> {
    @Override
    protected List<String> entries() {
        List<String> ores = new ArrayList<>();
        Collections.addAll(ores, OreDictionary.getOreNames());
        Collections.sort(ores);
        return ores;
    }

    @Override
    protected void head(JsonWriter w) throws IOException {
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("ores").beginObject();
    }

    @Override
    protected boolean entry(JsonWriter w, String ore) throws IOException {
        List<ItemStack> list = J.get(() -> new ArrayList<>(OreDictionary.getOres(ore, false)));
        if (list == null || list.isEmpty()) return false;
        w.name(ore).beginArray();
        for (ItemStack s : list) Names.stack(w, s, false);
        w.endArray();
        return true;
    }

    @Override
    protected void tail(JsonWriter w) throws IOException {
        w.endObject();
        w.endObject();
    }
}
