package mindcraftrotn.dumper;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
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

/**
 * recipes.json: {"format", "recipes": [recipe...]} for every crafting-grid IRecipe in
 * ForgeRegistries.RECIPES after CraftTweaker. Recipes with an empty output (CraftTweaker's
 * removals leave dummies) are skipped and counted in "skippedEmpty".
 * recipe = {id, class, type: shaped|shapeless, group, dynamic, width, height, mirrored,
 *           requiresTable, result {name, meta, count}, slots (shaped, row-major, null = empty) |
 *           ingredients (shapeless), remaining (per slot, from getRemainingItems on a filled grid,
 *           null when unknown), matchesSample}
 * ingredient = {stacks: [{name, meta}] (32767 = any meta), ore: key when the stacks are exactly one ore}
 */
final class RecipeDumper {
    private final Names names;
    private final World world;

    RecipeDumper(Names names, World world) {
        this.names = names;
        this.world = world;
    }

    int write(JsonWriter w) throws IOException {
        List<IRecipe> recipes = new ArrayList<>(ForgeRegistries.RECIPES.getValuesCollection());
        recipes.sort((a, b) -> String.valueOf(a.getRegistryName()).compareTo(String.valueOf(b.getRegistryName())));
        int n = 0;
        int empty = 0;
        w.beginObject();
        w.name("format").value(RotnDump.FORMAT);
        w.name("recipes").beginArray();
        for (IRecipe r : recipes) {
            ItemStack out;
            try {
                out = r.getRecipeOutput();
            } catch (Throwable t) {
                out = ItemStack.EMPTY;
            }
            if (out == null || out.isEmpty()) {
                empty++;
                continue;
            }
            writeRecipe(w, r, out);
            n++;
        }
        w.endArray();
        w.name("skippedEmpty").value(empty);
        w.endObject();
        return n;
    }

    private void writeRecipe(JsonWriter w, IRecipe r, ItemStack out) throws IOException {
        NonNullList<Ingredient> ings;
        try {
            ings = r.getIngredients();
        } catch (Throwable t) {
            ings = NonNullList.create();
        }
        boolean shaped = r instanceof IShapedRecipe;
        int width = 0;
        int height = 0;
        if (shaped) {
            IShapedRecipe s = (IShapedRecipe) r;
            width = s.getRecipeWidth();
            height = s.getRecipeHeight();
            if (width * height != ings.size()) shaped = false; // inconsistent; treat as a list
        }
        w.beginObject();
        w.name("id").value(String.valueOf(r.getRegistryName()));
        w.name("class").value(r.getClass().getName());
        w.name("type").value(shaped ? "shaped" : "shapeless");
        try {
            w.name("group").value(r.getGroup());
        } catch (Throwable t) {
            w.name("group").nullValue();
        }
        try {
            w.name("dynamic").value(r.isDynamic());
        } catch (Throwable t) {
            // skip
        }
        Boolean mirrored = mirrored(r);
        if (mirrored != null) w.name("mirrored").value(mirrored);
        boolean fits2x2;
        try {
            fits2x2 = r.canFit(2, 2);
        } catch (Throwable t) {
            fits2x2 = shaped ? width <= 2 && height <= 2 : ings.size() <= 4;
        }
        w.name("requiresTable").value(!fits2x2);
        w.name("result");
        Names.stack(w, out, true);
        if (shaped) {
            w.name("width").value(width);
            w.name("height").value(height);
            w.name("slots");
        } else {
            w.name("ingredients");
        }
        w.beginArray();
        for (Ingredient ing : ings) {
            if (!shaped && (ing == null || ing == Ingredient.EMPTY || stacks(ing).isEmpty())) continue;
            writeIngredient(w, ing);
        }
        w.endArray();
        writeRemaining(w, r, ings, shaped, width, height);
        w.endObject();
    }

    private static List<ItemStack> stacks(Ingredient ing) {
        if (ing == null) return new ArrayList<>();
        try {
            return new ArrayList<>(Arrays.asList(ing.getMatchingStacks()));
        } catch (Throwable t) {
            return new ArrayList<>();
        }
    }

    private void writeIngredient(JsonWriter w, Ingredient ing) throws IOException {
        List<ItemStack> list = stacks(ing);
        if (list.isEmpty()) {
            w.nullValue();
            return;
        }
        w.beginObject();
        String ore = names.oreFor(list);
        if (ore != null) w.name("ore").value(ore);
        w.name("stacks").beginArray();
        for (ItemStack s : list) Names.stack(w, s, false);
        w.endArray();
        w.endObject();
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
     * matchesSample: the recipe accepts the sample grid. mirroredTested: a shaped recipe also
     * accepts the left-right mirrored grid (vanilla 1.12 shaped recipes always do).
     * remaining: what getRemainingItems leaves per filled slot (e.g. a reused or damaged tool).
     */
    private void writeRemaining(JsonWriter w, IRecipe r, List<Ingredient> ings, boolean shaped, int width, int height) throws IOException {
        Boolean matches = null;
        Boolean mirrorMatches = null;
        List<ItemStack> remaining = null;
        String error = null;
        try {
            InventoryCrafting inv = sampleGrid(ings, shaped, width, height, false);
            if (inv != null) {
                matches = r.matches(inv, world);
                if (matches) {
                    NonNullList<ItemStack> rem = r.getRemainingItems(inv);
                    boolean any = false;
                    for (ItemStack s : rem) if (s != null && !s.isEmpty()) any = true;
                    if (any) {
                        remaining = new ArrayList<>();
                        for (int i = 0; i < inv.getSizeInventory(); i++) {
                            if (inv.getStackInSlot(i).isEmpty()) continue;
                            remaining.add(i < rem.size() ? rem.get(i) : ItemStack.EMPTY);
                        }
                    }
                }
                if (shaped && width > 1) {
                    InventoryCrafting m = sampleGrid(ings, true, width, height, true);
                    if (m != null) mirrorMatches = r.matches(m, world);
                }
            }
        } catch (Throwable t) {
            error = String.valueOf(t);
        }
        w.name("matchesSample");
        if (matches == null) w.nullValue();
        else w.value(matches);
        if (mirrorMatches != null) w.name("mirroredTested").value(mirrorMatches);
        w.name("remaining");
        if (remaining == null) {
            w.nullValue();
        } else {
            w.beginArray();
            for (ItemStack s : remaining) Names.stack(w, s, false);
            w.endArray();
        }
        if (error != null) w.name("remainingError").value(error);
    }

    /** isMirrored()/getMirrored() via reflection on mod classes (CraftTweaker, ShapedOreRecipe). */
    private static Boolean mirrored(IRecipe r) {
        for (String m : new String[] {"isMirrored", "getMirrored", "isMirror"}) {
            try {
                Method meth = r.getClass().getMethod(m);
                Object v = meth.invoke(r);
                if (v instanceof Boolean) return (Boolean) v;
            } catch (Throwable t) {
                // try the next name
            }
        }
        return null;
    }
}
