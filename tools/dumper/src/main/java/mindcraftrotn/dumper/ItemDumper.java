package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import com.google.gson.stream.JsonWriter;

import net.minecraft.block.Block;
import net.minecraft.block.state.IBlockState;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.init.Blocks;
import net.minecraft.item.Item;
import net.minecraft.item.ItemBlock;
import net.minecraft.item.ItemFood;
import net.minecraft.item.ItemStack;
import net.minecraft.tileentity.TileEntityFurnace;
import net.minecraft.util.NonNullList;
import net.minecraftforge.fml.common.registry.ForgeRegistries;
import net.minecraftforge.oredict.OreDictionary;

/**
 * items.json: {"format", "items": {"pyrotech:crude_axe": {stackSize, maxDamage, hasSubtypes, block,
 * toolClasses {class: level}, speed {pickaxe|axe|shovel: destroy speed on stone|log|dirt},
 * variants: [{meta, displayName, translationKey, burnTime, food {hunger, saturation}}]}}}
 * Variants: meta 0, every meta from getSubItems (when it works on a server), the ore dictionary
 * and the item's block states, plus a probe of metas 1..1023 that keeps a meta when its
 * translation key is new for the item (stops after 64 metas with nothing new).
 */
final class ItemDumper {
    private static final int PROBE_MAX = 1023;
    private static final int PROBE_GIVE_UP = 64;

    ItemDumper(Names names) {
    }

    int write(JsonWriter w) throws IOException {
        Map<Item, Set<Integer>> known = knownMetas();
        List<Item> items = new ArrayList<>(ForgeRegistries.ITEMS.getValuesCollection());
        items.sort((a, b) -> String.valueOf(a.getRegistryName()).compareTo(String.valueOf(b.getRegistryName())));
        w.beginObject();
        w.name("format").value(RotnDump.FORMAT);
        w.name("items").beginObject();
        int n = 0;
        for (Item item : items) {
            String name = Names.name(item);
            if (name == null) continue;
            w.name(name);
            writeItem(w, item, known.get(item));
            n++;
        }
        w.endObject();
        w.endObject();
        return n;
    }

    private static Map<Item, Set<Integer>> knownMetas() {
        Map<Item, Set<Integer>> out = new HashMap<>();
        for (String ore : OreDictionary.getOreNames()) {
            for (ItemStack s : OreDictionary.getOres(ore, false)) {
                if (s.isEmpty() || s.getItemDamage() == OreDictionary.WILDCARD_VALUE) continue;
                out.computeIfAbsent(s.getItem(), k -> new HashSet<>()).add(s.getItemDamage());
            }
        }
        for (Block b : ForgeRegistries.BLOCKS.getValuesCollection()) {
            Item item = Item.getItemFromBlock(b);
            if (item == null || item == net.minecraft.init.Items.AIR) continue;
            for (IBlockState s : b.getBlockState().getValidStates()) {
                try {
                    out.computeIfAbsent(item, k -> new HashSet<>()).add(b.damageDropped(s));
                } catch (Throwable t) {
                    // skip
                }
            }
        }
        return out;
    }

    private void writeItem(JsonWriter w, Item item, Set<Integer> knownMetas) throws IOException {
        ItemStack base = new ItemStack(item);
        w.beginObject();
        w.name("class").value(item.getClass().getName());
        try {
            w.name("stackSize").value(item.getItemStackLimit(base));
        } catch (Throwable t) {
            w.name("stackSize").nullValue();
        }
        try {
            w.name("maxDamage").value(item.getMaxDamage(base));
        } catch (Throwable t) {
            w.name("maxDamage").nullValue();
        }
        w.name("hasSubtypes").value(item.getHasSubtypes());
        w.name("block");
        if (item instanceof ItemBlock && ((ItemBlock) item).getBlock().getRegistryName() != null) {
            w.value(((ItemBlock) item).getBlock().getRegistryName().toString());
        } else {
            w.nullValue();
        }
        w.name("toolClasses").beginObject();
        try {
            for (String c : new TreeSet<>(item.getToolClasses(base))) w.name(c).value(item.getHarvestLevel(base, c, null, null));
        } catch (Throwable t) {
            // none
        }
        w.endObject();
        w.name("speed").beginObject();
        speed(w, item, base, "pickaxe", Blocks.STONE.getDefaultState());
        speed(w, item, base, "axe", Blocks.LOG.getDefaultState());
        speed(w, item, base, "shovel", Blocks.DIRT.getDefaultState());
        w.endObject();

        w.name("variants").beginArray();
        for (int meta : variantMetas(item, knownMetas)) writeVariant(w, item, meta);
        w.endArray();
        w.endObject();
    }

    private static void speed(JsonWriter w, Item item, ItemStack s, String key, IBlockState state) throws IOException {
        try {
            float f = item.getDestroySpeed(s, state);
            if (f != 1.0f) w.name(key).value(f);
        } catch (Throwable t) {
            // skip
        }
    }

    private static Set<Integer> variantMetas(Item item, Set<Integer> knownMetas) {
        Set<Integer> metas = new TreeSet<>();
        metas.add(0);
        if (!item.getHasSubtypes()) return metas;
        if (knownMetas != null) metas.addAll(knownMetas);
        try {
            NonNullList<ItemStack> list = NonNullList.create();
            item.getSubItems(CreativeTabs.SEARCH, list);
            for (ItemStack s : list) if (s.getItem() == item) metas.add(s.getItemDamage());
        } catch (Throwable t) {
            // client-only on some items; the probe below covers them
        }
        Set<String> keys = new HashSet<>();
        for (int m : metas) {
            String k = key(item, m);
            if (k != null) keys.add(k);
        }
        int sinceNew = 0;
        for (int m = 1; m <= PROBE_MAX && sinceNew < PROBE_GIVE_UP; m++) {
            String k = key(item, m);
            if (k != null && keys.add(k)) {
                metas.add(m);
                sinceNew = 0;
            } else {
                sinceNew++;
            }
        }
        return metas;
    }

    private static String key(Item item, int meta) {
        try {
            return item.getTranslationKey(new ItemStack(item, 1, meta));
        } catch (Throwable t) {
            return null;
        }
    }

    private static void writeVariant(JsonWriter w, Item item, int meta) throws IOException {
        ItemStack s = new ItemStack(item, 1, meta);
        w.beginObject();
        w.name("meta").value(meta);
        try {
            w.name("displayName").value(s.getDisplayName());
        } catch (Throwable t) {
            w.name("displayName").nullValue();
        }
        w.name("translationKey").value(key(item, meta));
        try {
            int burn = TileEntityFurnace.getItemBurnTime(s);
            if (burn > 0) w.name("burnTime").value(burn);
        } catch (Throwable t) {
            // skip
        }
        if (item instanceof ItemFood) {
            try {
                ItemFood f = (ItemFood) item;
                w.name("food").beginObject().name("hunger").value(f.getHealAmount(s)).name("saturation").value(f.getSaturationModifier(s)).endObject();
            } catch (Throwable t) {
                // skip
            }
        }
        w.endObject();
    }
}
