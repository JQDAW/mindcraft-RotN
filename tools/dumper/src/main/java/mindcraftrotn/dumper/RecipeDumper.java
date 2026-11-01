package mindcraftrotn.dumper;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import net.minecraft.entity.player.EntityPlayer;
import net.minecraft.inventory.Container;
import net.minecraft.inventory.InventoryCrafting;
import net.minecraft.item.ItemStack;
import net.minecraft.item.crafting.IRecipe;
import net.minecraft.item.crafting.Ingredient;
import net.minecraft.util.NonNullList;
import net.minecraft.world.World;
import net.minecraftforge.common.crafting.IShapedRecipe;
import net.minecraftforge.fml.common.registry.ForgeRegistries;
import net.minecraftforge.oredict.OreDictionary;
import net.minecraftforge.oredict.OreIngredient;

/**
 * recipes.json: {"format", "recipes": [recipe...], "skippedEmpty"} for every crafting-grid IRecipe in
 * ForgeRegistries.RECIPES after CraftTweaker. Recipes with an empty output (CraftTweaker's
 * removals leave dummies) are skipped and counted in "skippedEmpty".
 * recipe = {id, class, type: shaped|shapeless, group, dynamic, mirrored (the recipe's own flag, if
 *           it has one), requiresTable (!canFit(2, 2)), result {name, meta, count},
 *           width + height + slots (shaped, row-major, null = empty) | ingredients (shapeless),
 *           matchesSample, mirroredTested, remaining, remainingError}
 * ingredient = {stacks: [{name, meta}] (32767 = any meta), ore: the key when the ingredient is
 *              exactly one ore (its stacks are then the ore's own list, as in oredict.json, so
 *              they keep wildcard metas 32767 instead of listing each variant),
 *              ores: every ore key it includes (e.g. ["rock"] for <ore:rock>|<minecraft:flint>)}
 */
final class RecipeDumper extends Part<IRecipe> {
    private final Names names;
    private final World world;

    RecipeDumper(Names names, World world) {
        this.names = names;
        this.world = world;
    }

    private int empty;

    @Override
    protected List<IRecipe> entries() {
        List<IRecipe> recipes = new ArrayList<>(ForgeRegistries.RECIPES.getValuesCollection());
        recipes.sort((a, b) -> String.valueOf(a.getRegistryName()).compareTo(String.valueOf(b.getRegistryName())));
        return recipes;
    }

    @Override
    protected void head(JsonWriter w) throws IOException {
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("recipes").beginArray();
    }

    @Override
    protected boolean entry(JsonWriter w, IRecipe r) throws IOException {
        ItemStack out = J.get(r::getRecipeOutput);
        if (out == null || out.isEmpty()) {
            empty++;
            return false;
        }
        writeRecipe(w, r, out);
        return true;
    }

    @Override
    protected void tail(JsonWriter w) throws IOException {
        w.endArray();
        J.num(w, "skippedEmpty", empty);
        w.endObject();
    }

    /** One ingredient, computed before writing. */
    private final class Ing {
        final List<ItemStack> stacks;
        final String ore;
        final List<String> ores;

        Ing(Ingredient ing) {
            List<ItemStack> matching = stacks(ing);
            String exact = J.get(() -> names.exactOre(ing, matching));
            List<ItemStack> own = null;
            if (exact != null) own = J.get(() -> new ArrayList<>(OreDictionary.getOres(exact, false)));
            this.ore = exact;
            this.stacks = own != null && !own.isEmpty() ? own : matching;
            List<String> all = J.get(() -> names.oresIn(ing, matching));
            this.ores = all == null ? Collections.emptyList() : all;
        }

        boolean empty() {
            return stacks.isEmpty();
        }
    }

    private void writeRecipe(JsonWriter w, IRecipe r, ItemStack out) throws IOException {
        NonNullList<Ingredient> list = J.get(r::getIngredients);
        List<Ingredient> ings = list == null ? new ArrayList<>() : list;
        boolean shaped = r instanceof IShapedRecipe;
        Integer width = shaped ? J.get(() -> ((IShapedRecipe) r).getRecipeWidth()) : null;
        Integer height = shaped ? J.get(() -> ((IShapedRecipe) r).getRecipeHeight()) : null;
        if (shaped && (width == null || height == null || width * height != ings.size())) shaped = false; // treat as a list
        final boolean isShaped = shaped;
        List<Ing> parsed = new ArrayList<>();
        for (Ingredient i : ings) parsed.add(new Ing(i));
        String group = J.get(r::getGroup);
        Boolean dynamic = J.get(r::isDynamic);
        Boolean mirrored = mirrored(r);
        Boolean fits = J.get(() -> r.canFit(2, 2));
        boolean requiresTable = fits != null ? !fits : isShaped ? width > 2 || height > 2 : ings.size() > 4;
        Sample sample = sample(r, ings, isShaped, isShaped ? width : 0, isShaped ? height : 0);

        w.beginObject();
        J.str(w, "id", String.valueOf(r.getRegistryName()));
        J.str(w, "class", r.getClass().getName());
        J.str(w, "type", isShaped ? "shaped" : "shapeless");
        J.str(w, "group", group);
        J.bool(w, "dynamic", dynamic);
        if (mirrored != null) J.bool(w, "mirrored", mirrored);
        J.bool(w, "requiresTable", requiresTable);
        w.name("result");
        Names.stack(w, out, true);
        if (isShaped) {
            J.num(w, "width", width);
            J.num(w, "height", height);
            w.name("slots");
        } else {
            w.name("ingredients");
        }
        w.beginArray();
        for (Ing i : parsed) {
            if (i.empty()) {
                if (isShaped) w.nullValue();
                continue;
            }
            w.beginObject();
            if (i.ore != null) J.str(w, "ore", i.ore);
            if (!i.ores.isEmpty()) {
                w.name("ores").beginArray();
                for (String o : i.ores) w.value(o);
                w.endArray();
            }
            w.name("stacks").beginArray();
            for (ItemStack s : i.stacks) Names.stack(w, s, false);
            w.endArray();
            w.endObject();
        }
        w.endArray();
        J.bool(w, "matchesSample", sample.matches);
        if (sample.mirrorMatches != null) J.bool(w, "mirroredTested", sample.mirrorMatches);
        w.name("remaining");
        if (sample.remaining == null) {
            w.nullValue();
        } else {
            w.beginArray();
            for (ItemStack s : sample.remaining) Names.stack(w, s, false);
            w.endArray();
        }
        if (sample.error != null) J.str(w, "remainingError", sample.error);
        w.endObject();
    }

    private static List<ItemStack> stacks(Ingredient ing) {
        if (ing == null) return new ArrayList<>();
        List<ItemStack> out = J.get(() -> new ArrayList<>(Arrays.asList(ing.getMatchingStacks())));
        if ((out == null || out.isEmpty()) && ing instanceof OreIngredient) {
            // getMatchingStacks expands wildcards through getSubItems, which may fail on a server.
            out = J.get(() -> new ArrayList<>(Names.oreList((OreIngredient) ing)));
        }
        if (out == null) return new ArrayList<>();
        out.removeIf(s -> s == null || s.isEmpty());
        return out;
    }

    private static final class Sample {
        Boolean matches;
        Boolean mirrorMatches;
        List<ItemStack> remaining;
        String error;
    }

    /** A grid filled with the first stack of each ingredient (mirrored left-right on request), or null. */
    private static InventoryCrafting sampleGrid(List<Ingredient> ings, boolean shaped, int width, int height, boolean mirror) {
        int gw = shaped ? Math.max(width, 1) : 3;
        int gh = shaped ? Math.max(height, 1) : 3;
        InventoryCrafting inv = new InventoryCrafting(new Container() {
            @Override
            public boolean canInteractWith(EntityPlayer player) {
                return false;
            }
        }, gw, gh);
        int i = 0;
        int filled = 0;
        for (Ingredient ing : ings) {
            List<ItemStack> list = stacks(ing);
            if (!shaped && list.isEmpty()) continue;
            if (i >= gw * gh) return null;
            ItemStack s = list.isEmpty() ? ItemStack.EMPTY : list.get(0).copy();
            if (!s.isEmpty()) {
                if (s.getItemDamage() == OreDictionary.WILDCARD_VALUE) s.setItemDamage(0);
                s.setCount(1);
                filled++;
            }
            int slot = i;
            if (mirror && shaped) slot = (i / gw) * gw + (gw - 1 - i % gw);
            inv.setInventorySlotContents(slot, s);
            i++;
        }
        return filled == 0 ? null : inv;
    }

    /**
     * matches: the recipe accepts the sample grid. mirrorMatches: a shaped recipe also accepts the
     * left-right mirrored grid (vanilla 1.12 shaped recipes always do). remaining: what
     * getRemainingItems leaves per filled slot (e.g. a reused or damaged tool), null if nothing.
     */
    private Sample sample(IRecipe r, List<Ingredient> ings, boolean shaped, int width, int height) {
        Sample out = new Sample();
        try {
            InventoryCrafting inv = sampleGrid(ings, shaped, width, height, false);
            if (inv == null) return out;
            out.matches = r.matches(inv, world);
            if (out.matches) {
                NonNullList<ItemStack> rem = r.getRemainingItems(inv);
                boolean any = false;
                for (ItemStack s : rem) if (s != null && !s.isEmpty()) any = true;
                if (any) {
                    List<ItemStack> list = new ArrayList<>();
                    for (int i = 0; i < inv.getSizeInventory(); i++) {
                        if (inv.getStackInSlot(i).isEmpty()) continue;
                        list.add(i < rem.size() ? rem.get(i) : ItemStack.EMPTY);
                    }
                    out.remaining = list;
                }
            }
            if (shaped && width > 1) {
                InventoryCrafting m = sampleGrid(ings, true, width, height, true);
                if (m != null) out.mirrorMatches = r.matches(m, world);
            }
        } catch (Throwable t) {
            out.error = String.valueOf(t);
        }
        return out;
    }

    /** isMirrored()/getMirrored() via reflection on mod classes (CraftTweaker, ShapedOreRecipe). */
    private static Boolean mirrored(IRecipe r) {
        for (String m : new String[] {"isMirrored", "getMirrored", "isMirror"}) {
            Boolean v = J.get(() -> {
                Method meth = r.getClass().getMethod(m);
                Object o = meth.invoke(r);
                return o instanceof Boolean ? (Boolean) o : null;
            });
            if (v != null) return v;
        }
        return null;
    }
}
