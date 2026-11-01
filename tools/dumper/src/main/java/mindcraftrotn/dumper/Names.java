package mindcraftrotn.dumper;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import com.google.gson.stream.JsonWriter;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.crafting.Ingredient;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.oredict.OreDictionary;
import net.minecraftforge.oredict.OreIngredient;

/** Stack, name and ore-dictionary helpers shared by the dumpers. Keys are registry name + metadata. */
final class Names {
    /** Ore signatures: raw (wildcards as 32767) and expanded (wildcards replaced by known variants). */
    private Map<String, String> oreByRaw;
    private Map<String, String> oreByExpanded;
    private final Map<Item, Set<Integer>> variants = new IdentityHashMap<>();

    static String name(Item item) {
        if (item == null) return null;
        ResourceLocation rl = item.getRegistryName();
        return rl == null ? null : rl.toString();
    }

    static String stackKey(ItemStack s) {
        return name(s.getItem()) + ":" + s.getItemDamage();
    }

    /** {"name", "meta"[, "count"][, "nbt"]} or null for an empty stack. */
    static void stack(JsonWriter w, ItemStack s, boolean withCount) throws IOException {
        String n = s == null || s.isEmpty() ? null : name(s.getItem());
        if (n == null) {
            w.nullValue();
            return;
        }
        String nbt = J.get(() -> s.hasTagCompound() ? String.valueOf(s.getTagCompound()) : null);
        w.beginObject();
        J.str(w, "name", n);
        J.num(w, "meta", s.getItemDamage());
        if (withCount) J.num(w, "count", s.getCount());
        if (nbt != null) J.str(w, "nbt", nbt);
        w.endObject();
    }

    /** Metas an item is known to have (set by ItemDumper; used to expand wildcards). */
    void setVariants(Item item, Set<Integer> metas) {
        variants.put(item, metas);
        oreByExpanded = null;
    }

    private Collection<String> expandedKeys(List<ItemStack> stacks) {
        Set<String> keys = new TreeSet<>();
        for (ItemStack s : stacks) {
            if (s == null || s.isEmpty() || name(s.getItem()) == null) continue;
            Set<Integer> v = variants.get(s.getItem());
            if (s.getItemDamage() == OreDictionary.WILDCARD_VALUE && v != null && !v.isEmpty()) {
                for (int m : v) keys.add(name(s.getItem()) + ":" + m);
            } else {
                keys.add(stackKey(s));
            }
        }
        return keys;
    }

    private static String rawSignature(List<ItemStack> stacks) {
        List<String> keys = new ArrayList<>();
        for (ItemStack s : stacks) if (s != null && !s.isEmpty() && name(s.getItem()) != null) keys.add(stackKey(s));
        Collections.sort(keys);
        return String.join("|", keys);
    }

    private void index() {
        if (oreByRaw != null && oreByExpanded != null) return;
        oreByRaw = new HashMap<>();
        oreByExpanded = new HashMap<>();
        List<String> ores = new ArrayList<>();
        Collections.addAll(ores, OreDictionary.getOreNames());
        Collections.sort(ores);
        for (String ore : ores) {
            List<ItemStack> list = OreDictionary.getOres(ore, false);
            if (list == null || list.isEmpty()) continue;
            oreByRaw.putIfAbsent(rawSignature(list), ore);
            oreByExpanded.putIfAbsent(String.join("|", expandedKeys(list)), ore);
        }
    }

    /**
     * The one ore dictionary key an ingredient is exactly, or null:
     * 1. Forge's OreIngredient: its own ore list (private field "ores"; Forge classes keep their names);
     * 2. the stacks equal one ore's stacks, raw or with wildcards expanded to known variants.
     */
    String exactOre(Ingredient ing, List<ItemStack> stacks) {
        index();
        if (ing instanceof OreIngredient) {
            List<ItemStack> ores = J.get(() -> oreList((OreIngredient) ing));
            String o = ores == null ? null : oreByRaw.get(rawSignature(ores));
            if (o != null) return o;
        }
        if (stacks.isEmpty()) return null;
        String o = oreByRaw.get(rawSignature(stacks));
        return o != null ? o : oreByExpanded.get(String.join("|", expandedKeys(stacks)));
    }

    /**
     * Every ore key an ingredient includes: the exact one, plus CraftTweaker IOreDictEntry objects
     * reachable in two field hops (e.g. both sides of <ore:rock>|<minecraft:flint>).
     */
    List<String> oresIn(Ingredient ing, List<ItemStack> stacks) {
        Set<String> out = new java.util.LinkedHashSet<>();
        String exact = exactOre(ing, stacks);
        if (exact != null) out.add(exact);
        if (ing != null) collectCtOres(ing, out, 0, Collections.newSetFromMap(new IdentityHashMap<>()));
        return new ArrayList<>(out);
    }

    /** The raw ore stacks of a Forge OreIngredient (with wildcard metas), or null. */
    @SuppressWarnings("unchecked")
    static List<ItemStack> oreList(OreIngredient ing) throws ReflectiveOperationException {
        Field f = OreIngredient.class.getDeclaredField("ores");
        f.setAccessible(true);
        return (List<ItemStack>) f.get(ing);
    }

    private static void collectCtOres(Object o, Set<String> out, int depth, Set<Object> seen) {
        if (o == null || depth > 2 || !seen.add(o)) return;
        Class<?> c = o.getClass();
        if (implementsNamed(c, "crafttweaker.api.oredict.IOreDictEntry")) {
            String n = J.get(() -> {
                Method m = c.getMethod("getName");
                return (String) m.invoke(o);
            });
            if (n != null) out.add(n);
            return;
        }
        if (!c.getName().startsWith("crafttweaker.") && depth > 0) return;
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) {
            for (Field f : k.getDeclaredFields()) {
                if (java.lang.reflect.Modifier.isStatic(f.getModifiers()) || f.getType().isPrimitive()) continue;
                Object v = J.get(() -> {
                    f.setAccessible(true);
                    return f.get(o);
                });
                if (v instanceof Object[]) {
                    for (Object e : (Object[]) v) collectCtOres(e, out, depth + 1, seen);
                } else if (v instanceof Collection) {
                    for (Object e : (Collection<?>) v) collectCtOres(e, out, depth + 1, seen);
                } else {
                    collectCtOres(v, out, depth + 1, seen);
                }
            }
        }
    }

    private static boolean implementsNamed(Class<?> c, String iface) {
        Set<Class<?>> seen = new HashSet<>();
        List<Class<?>> todo = new ArrayList<>();
        todo.add(c);
        while (!todo.isEmpty()) {
            Class<?> k = todo.remove(todo.size() - 1);
            if (k == null || !seen.add(k)) continue;
            if (k.getName().equals(iface)) return true;
            todo.add(k.getSuperclass());
            Collections.addAll(todo, k.getInterfaces());
        }
        return false;
    }
}
