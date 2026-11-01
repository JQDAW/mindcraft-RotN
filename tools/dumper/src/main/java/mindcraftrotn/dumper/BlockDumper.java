package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import com.google.gson.stream.JsonWriter;

import net.minecraft.block.Block;
import net.minecraft.block.material.Material;
import net.minecraft.block.properties.IProperty;
import net.minecraft.block.state.IBlockState;
import net.minecraft.init.Items;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.math.AxisAlignedBB;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;
import net.minecraftforge.fml.common.registry.ForgeRegistries;

/**
 * blocks.json: {"format", "blocks": {"minecraft:stone": {"defaultMeta", "class", "states": [state...]}}}
 * One state per metadata value m in 0..15 with getMetaFromState(getStateFromMeta(m)) == m:
 * {meta, props, displayName, hardness, explosionResistance, material, harvestTool, harvestLevel,
 *  toolRequired, solid, liquid, replaceable, light, opacity, fullCube, opaque, collision, item, drops}.
 * Every value is computed first and written as null if the game call throws (J).
 * Harvest tool and level come from Forge's Block#getHarvestTool/getHarvestLevel, so Tool
 * Progression's overrides are included. Hardness is read at (0,0,0) in the overworld, so
 * CraftTweaker hardness changes are included. Drops are the nominal getItemDropped and
 * quantityDropped with a fixed seed; event-handler drops (Pyrotech, Dropt) are not here (ADR 0004).
 * "material" is the lower-cased MCP field name of the vanilla Material (Material.PLANTS ->
 * "plants", GROUND -> "ground", CLOTH -> "cloth"); rotn-data maps it to prismarine's strings.
 */
final class BlockDumper extends Part<Block> {
    private static final Map<Material, String> MATERIALS = new IdentityHashMap<>();

    static {
        MATERIALS.put(Material.AIR, "air");
        MATERIALS.put(Material.GRASS, "grass");
        MATERIALS.put(Material.GROUND, "ground");
        MATERIALS.put(Material.WOOD, "wood");
        MATERIALS.put(Material.ROCK, "rock");
        MATERIALS.put(Material.IRON, "iron");
        MATERIALS.put(Material.ANVIL, "anvil");
        MATERIALS.put(Material.WATER, "water");
        MATERIALS.put(Material.LAVA, "lava");
        MATERIALS.put(Material.LEAVES, "leaves");
        MATERIALS.put(Material.PLANTS, "plants");
        MATERIALS.put(Material.VINE, "vine");
        MATERIALS.put(Material.SPONGE, "sponge");
        MATERIALS.put(Material.CLOTH, "cloth");
        MATERIALS.put(Material.FIRE, "fire");
        MATERIALS.put(Material.SAND, "sand");
        MATERIALS.put(Material.CIRCUITS, "circuits");
        MATERIALS.put(Material.CARPET, "carpet");
        MATERIALS.put(Material.GLASS, "glass");
        MATERIALS.put(Material.REDSTONE_LIGHT, "redstone_light");
        MATERIALS.put(Material.TNT, "tnt");
        MATERIALS.put(Material.CORAL, "coral");
        MATERIALS.put(Material.ICE, "ice");
        MATERIALS.put(Material.PACKED_ICE, "packed_ice");
        MATERIALS.put(Material.SNOW, "snow");
        MATERIALS.put(Material.CRAFTED_SNOW, "crafted_snow");
        MATERIALS.put(Material.CACTUS, "cactus");
        MATERIALS.put(Material.CLAY, "clay");
        MATERIALS.put(Material.GOURD, "gourd");
        MATERIALS.put(Material.DRAGON_EGG, "dragon_egg");
        MATERIALS.put(Material.PORTAL, "portal");
        MATERIALS.put(Material.CAKE, "cake");
        MATERIALS.put(Material.WEB, "web");
        MATERIALS.put(Material.PISTON, "piston");
        MATERIALS.put(Material.BARRIER, "barrier");
        MATERIALS.put(Material.STRUCTURE_VOID, "structure_void");
    }

    private final World world;
    private final BlockPos pos = BlockPos.ORIGIN;

    BlockDumper(World world) {
        this.world = world;
    }

    static String materialName(Material m) {
        if (m == null) return null;
        String n = MATERIALS.get(m);
        return n != null ? n : "modded:" + m.getClass().getName();
    }

    @Override
    protected List<Block> entries() {
        List<Block> blocks = new ArrayList<>(ForgeRegistries.BLOCKS.getValuesCollection());
        blocks.removeIf(b -> b.getRegistryName() == null);
        blocks.sort((a, b) -> a.getRegistryName().toString().compareTo(b.getRegistryName().toString()));
        return blocks;
    }

    @Override
    protected void head(JsonWriter w) throws IOException {
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("blocks").beginObject();
    }

    @Override
    protected boolean entry(JsonWriter w, Block b) throws IOException {
        w.name(b.getRegistryName().toString());
        writeBlock(w, b);
        return true;
    }

    @Override
    protected void tail(JsonWriter w) throws IOException {
        w.endObject();
        w.endObject();
    }

    private void writeBlock(JsonWriter w, Block b) throws IOException {
        Integer defMeta = J.get(() -> b.getMetaFromState(b.getDefaultState()));
        List<Integer> metas = new ArrayList<>();
        List<IBlockState> states = new ArrayList<>();
        for (int m = 0; m < 16; m++) {
            final int meta = m;
            IBlockState s = J.get(() -> {
                IBlockState x = b.getStateFromMeta(meta);
                return x != null && x.getBlock() == b && b.getMetaFromState(x) == meta ? x : null;
            });
            if (s != null) {
                metas.add(m);
                states.add(s);
            }
        }
        w.beginObject();
        J.num(w, "defaultMeta", defMeta);
        J.str(w, "class", b.getClass().getName());
        w.name("states").beginArray();
        for (int i = 0; i < states.size(); i++) writeState(w, b, states.get(i), metas.get(i));
        w.endArray();
        w.endObject();
    }

    private void writeState(JsonWriter w, Block b, IBlockState s, int meta) throws IOException {
        Map<String, String> props = J.get(() -> {
            Map<String, String> out = new LinkedHashMap<>();
            for (Map.Entry<IProperty<?>, Comparable<?>> e : s.getProperties().entrySet()) out.put(e.getKey().getName(), valueName(e.getKey(), e.getValue()));
            return out;
        });
        Item item = J.get(() -> Item.getItemFromBlock(b));
        boolean hasItem = item != null && item != Items.AIR && Names.name(item) != null;
        Integer itemMeta = J.get(() -> b.damageDropped(s));
        int im = itemMeta == null ? 0 : itemMeta;
        String display = J.get(() -> hasItem ? new ItemStack(item, 1, im).getDisplayName() : b.getLocalizedName());
        Float hardness = J.get(() -> s.getBlockHardness(world, pos));
        Float resistance = J.get(() -> b.getExplosionResistance(null));
        Material mat = J.get(s::getMaterial);
        String tool = J.get(() -> b.getHarvestTool(s));
        Integer level = J.get(() -> b.getHarvestLevel(s));
        Boolean toolRequired = mat == null ? null : J.get(() -> !mat.isToolNotRequired());
        Boolean solid = mat == null ? null : J.get(mat::blocksMovement);
        Boolean liquid = mat == null ? null : J.get(mat::isLiquid);
        Boolean replaceable = mat == null ? null : J.get(mat::isReplaceable);
        Integer light = J.get(s::getLightValue);
        Integer opacity = J.get(s::getLightOpacity);
        Boolean fullCube = J.get(s::isFullCube);
        Boolean opaque = J.get(s::isOpaqueCube);
        // [] = no collision, [[x0,y0,z0,x1,y1,z1]] = one box, null = unknown (the call threw)
        double[][] collision = J.get(() -> {
            AxisAlignedBB bb = s.getCollisionBoundingBox(world, pos);
            if (bb == null || bb == Block.NULL_AABB) return new double[0][];
            return new double[][] {{bb.minX, bb.minY, bb.minZ, bb.maxX, bb.maxY, bb.maxZ}};
        });
        Object[] drop = J.get(() -> {
            Item d = b.getItemDropped(s, new Random(0), 0);
            int count = b.quantityDropped(s, 0, new Random(0));
            if (d == null || d == Items.AIR || count <= 0 || Names.name(d) == null) return new Object[0];
            return new Object[] {Names.name(d), b.damageDropped(s), count};
        });

        w.beginObject();
        J.num(w, "meta", meta);
        w.name("props").beginObject();
        if (props != null) for (Map.Entry<String, String> e : props.entrySet()) J.str(w, e.getKey(), e.getValue());
        w.endObject();
        J.str(w, "displayName", display);
        J.num(w, "hardness", hardness);
        J.num(w, "explosionResistance", resistance);
        J.str(w, "material", materialName(mat));
        J.str(w, "harvestTool", tool);
        J.num(w, "harvestLevel", level == null ? -1 : level);
        J.bool(w, "toolRequired", toolRequired);
        J.bool(w, "solid", solid);
        J.bool(w, "liquid", liquid);
        J.bool(w, "replaceable", replaceable);
        J.num(w, "light", light);
        J.num(w, "opacity", opacity);
        J.bool(w, "fullCube", fullCube);
        J.bool(w, "opaque", opaque);
        w.name("collision");
        if (collision == null) {
            w.nullValue();
        } else {
            w.beginArray();
            for (double[] box : collision) {
                w.beginArray();
                for (double d : box) w.value(d);
                w.endArray();
            }
            w.endArray();
        }
        w.name("item");
        if (hasItem) {
            w.beginObject();
            J.str(w, "name", Names.name(item));
            J.num(w, "meta", im);
            w.endObject();
        } else {
            w.nullValue();
        }
        w.name("drops");
        if (drop == null) {
            w.nullValue();
        } else {
            w.beginArray();
            if (drop.length == 3) {
                w.beginObject();
                J.str(w, "name", (String) drop[0]);
                J.num(w, "meta", (Integer) drop[1]);
                J.num(w, "count", (Integer) drop[2]);
                w.endObject();
            }
            w.endArray();
        }
        w.endObject();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static String valueName(IProperty p, Comparable v) {
        try {
            return p.getName(v);
        } catch (Throwable t) {
            return String.valueOf(v);
        }
    }
}
