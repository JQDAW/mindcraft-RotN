package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import com.google.gson.stream.JsonWriter;

import net.minecraft.block.Block;
import net.minecraft.block.state.IBlockState;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.init.Blocks;
import net.minecraft.init.Items;
import net.minecraft.item.Item;
import net.minecraft.item.ItemBlock;
import net.minecraft.item.ItemFood;
import net.minecraft.item.ItemStack;
import net.minecraft.tileentity.TileEntityFurnace;
import net.minecraft.util.NonNullList;
import net.minecraftforge.fml.common.registry.ForgeRegistries;
import net.minecraftforge.oredict.OreDictionary;

/**
 * items.json: {"format", "items": {"pyrotech:crude_axe": {class, stackSize, maxDamage, hasSubtypes,
 * block, toolClasses {class: level}, speed {pickaxe|axe|shovel: destroy speed on stone|log|dirt},
 * variants: [{meta, displayName, translationKey, burnTime, food {hunger, saturation}}]}}}
 * Variants: meta 0, every meta from getSubItems (when it works on a server), the ore dictionary
 * and the item's block states, plus a probe of metas 1..1023 that keeps a meta when its
 * translation key is new for the item (stops after 64 metas with nothing new).
 * The variants are also handed to Names, which uses them to match wildcard ore entries.
 */
final class ItemDumper extends Part<Item> {
    private static final int PROBE_MAX = 1023;
    private static final int PROBE_GIVE_UP = 64;
    private final Names names;

    ItemDumper(Names names) {
        this.names = names;
    }

    private Map<Item, Set<Integer>> known;

    @Override
    protected List<Item> entries() {
        known = knownMetas();
        List<Item> items = new ArrayList<>(ForgeRegistries.ITEMS.getValuesCollection());
        items.removeIf(i -> Names.name(i) == null);
        items.sort((a, b) -> Names.name(a).compareTo(Names.name(b)));
        return items;
    }

    @Override
    protected void head(JsonWriter w) throws IOException {
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("items").beginObject();
    }

    @Override
    protected String key(Item item) {
        return Names.name(item);
    }

    @Override
    protected boolean entry(JsonWriter w, Item item) throws IOException {
        Set<Integer> metas = variantMetas(item, known.get(item));
        writeItem(w, item, metas);
        names.setVariants(item, metas); // only once the entry rendered (PR #48 review follow-up 5)
        return true;
    }

    @Override
    protected void tail(JsonWriter w) throws IOException {
        w.endObject();
        w.endObject();
    }

    private static Map<Item, Set<Integer>> knownMetas() {
        Map<Item, Set<Integer>> out = new HashMap<>();
        for (String ore : OreDictionary.getOreNames()) {
            List<ItemStack> list = J.get(() -> OreDictionary.getOres(ore, false));
            if (list == null) continue;
            for (ItemStack s : list) {
                if (s.isEmpty() || s.getItemDamage() == OreDictionary.WILDCARD_VALUE) continue;
                out.computeIfAbsent(s.getItem(), k -> new HashSet<>()).add(s.getItemDamage());
            }
        }
        for (Block b : ForgeRegistries.BLOCKS.getValuesCollection()) {
            Item item = J.get(() -> Item.getItemFromBlock(b));
            if (item == null || item == Items.AIR) continue;
            List<IBlockState> states = J.get(() -> new ArrayList<>(b.getBlockState().getValidStates()));
            if (states == null) continue;
            for (IBlockState s : states) {
                Integer m = J.get(() -> b.damageDropped(s));
                if (m != null) out.computeIfAbsent(item, k -> new HashSet<>()).add(m);
            }
        }
        return out;
    }

    private static void writeItem(JsonWriter w, Item item, Set<Integer> metas) throws IOException {
        ItemStack base = J.get(() -> new ItemStack(item)); // null if the item's constructor hook throws
        Integer stackSize = J.get(() -> item.getItemStackLimit(base));
        Integer maxDamage = J.get(() -> item.getMaxDamage(base));
        Boolean hasSubtypes = J.get(item::getHasSubtypes);
        String block = J.get(() -> item instanceof ItemBlock ? ((ItemBlock) item).getBlock().getRegistryName().toString() : null);
        Map<String, Integer> tools = J.get(() -> {
            Map<String, Integer> out = new TreeMap<>();
            for (String c : item.getToolClasses(base)) out.put(c, item.getHarvestLevel(base, c, null, null));
            return out;
        });
        Map<String, Float> speed = new LinkedHashMap<>();
        if (base != null) {
            speed(speed, item, base, "pickaxe", Blocks.STONE.getDefaultState());
            speed(speed, item, base, "axe", Blocks.LOG.getDefaultState());
            speed(speed, item, base, "shovel", Blocks.DIRT.getDefaultState());
        }

        w.beginObject();
        J.str(w, "class", item.getClass().getName());
        J.num(w, "stackSize", stackSize);
        J.num(w, "maxDamage", maxDamage);
        J.bool(w, "hasSubtypes", hasSubtypes);
        J.str(w, "block", block);
        w.name("toolClasses").beginObject();
        if (tools != null) for (Map.Entry<String, Integer> e : tools.entrySet()) J.num(w, e.getKey(), e.getValue());
        w.endObject();
        w.name("speed").beginObject();
        for (Map.Entry<String, Float> e : speed.entrySet()) J.num(w, e.getKey(), e.getValue());
        w.endObject();
        w.name("variants").beginArray();
        for (int meta : metas) writeVariant(w, item, meta);
        w.endArray();
        w.endObject();
    }

    private static void speed(Map<String, Float> out, Item item, ItemStack s, String key, IBlockState state) {
        Float f = J.get(() -> item.getDestroySpeed(s, state));
        if (f != null && f != 1.0f) out.put(key, f);
    }

    private static Set<Integer> variantMetas(Item item, Set<Integer> knownMetas) {
        Set<Integer> metas = new TreeSet<>();
        metas.add(0);
        Boolean sub = J.get(item::getHasSubtypes);
        if (sub == null || !sub) return metas;
        if (knownMetas != null) metas.addAll(knownMetas);
        List<ItemStack> listed = J.get(() -> {
            NonNullList<ItemStack> list = NonNullList.create();
            item.getSubItems(CreativeTabs.SEARCH, list);
            return list;
        });
        if (listed != null) for (ItemStack s : listed) if (s.getItem() == item) metas.add(s.getItemDamage());
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
        return J.get(() -> item.getTranslationKey(new ItemStack(item, 1, meta)));
    }

    private static void writeVariant(JsonWriter w, Item item, int meta) throws IOException {
        ItemStack s = J.get(() -> new ItemStack(item, 1, meta));
        String display = s == null ? null : J.get(() -> s.getDisplayName());
        String key = key(item, meta);
        Integer burn = s == null ? null : J.get(() -> TileEntityFurnace.getItemBurnTime(s));
        Integer hunger = s != null && item instanceof ItemFood ? J.get(() -> ((ItemFood) item).getHealAmount(s)) : null;
        Float saturation = s != null && item instanceof ItemFood ? J.get(() -> ((ItemFood) item).getSaturationModifier(s)) : null;

        w.beginObject();
        J.num(w, "meta", meta);
        J.str(w, "displayName", display);
        J.str(w, "translationKey", key);
        if (burn != null && burn > 0) J.num(w, "burnTime", burn);
        if (hunger != null || saturation != null) {
            w.name("food").beginObject();
            J.num(w, "hunger", hunger);
            J.num(w, "saturation", saturation);
            w.endObject();
        }
        w.endObject();
    }
}
