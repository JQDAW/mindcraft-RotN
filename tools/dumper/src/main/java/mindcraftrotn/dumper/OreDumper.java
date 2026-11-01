package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import net.minecraft.item.ItemStack;
import net.minecraftforge.oredict.OreDictionary;

/** oredict.json: {"format", "ores": {"rock": [{name, meta}, ...]}}; meta 32767 is the wildcard. */
final class OreDumper {
    private final Names names;

    OreDumper(Names names) {
        this.names = names;
    }

    int write(JsonWriter w) throws IOException {
        List<String> ores = new ArrayList<>();
        Collections.addAll(ores, OreDictionary.getOreNames());
        Collections.sort(ores);
        int n = 0;
        w.beginObject();
        w.name("format").value(RotnDump.FORMAT);
        w.name("ores").beginObject();
        for (String ore : ores) {
            List<ItemStack> list = OreDictionary.getOres(ore, false);
            if (list == null || list.isEmpty()) continue;
            w.name(ore).beginArray();
            for (ItemStack s : list) Names.stack(w, s, false);
            w.endArray();
            n++;
        }
        w.endObject();
        w.endObject();
        return n;
    }
}
