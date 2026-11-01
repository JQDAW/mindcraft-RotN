package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.IdentityHashMap;
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
 * blocks.json: {"format", "blocks": {"minecraft:stone": {"displayName", "defaultMeta", "states": [state...]}}}
 * One state per metadata value m in 0..15 with getMetaFromState(getStateFromMeta(m)) == m:
 * {meta, props, displayName, hardness, explosionResistance, material, harvestTool, harvestLevel,
 *  toolRequired, light, opacity, fullCube, opaque, solid, liquid, replaceable, collision, item, drops}.
 * Harvest tool and level come from Forge's Block#getHarvestTool/getHarvestLevel, so Tool
 * Progression's overrides are included. Hardness is read at (0,0,0) in the overworld, so
 * CraftTweaker hardness changes are included. Drops are the nominal getItemDropped and
 * quantityDropped with a fixed seed; event-handler drops (Pyrotech, Dropt) are not here (ADR 0004).
 */
final class BlockDumper {
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

    BlockDumper(Names names, World world) {
        this.world = world;
    }

    static String materialName(Material m) {
        if (m == null) return null;
        String n = MATERIALS.get(m);
        return n != null ? n : "modded:" + m.getClass().getName();
    }

    int write(JsonWriter w) throws IOException {
        List<Block> blocks = new ArrayList<>(ForgeRegistries.BLOCKS.getValuesCollection());
        blocks.sort((a, b) -> String.valueOf(a.getRegistryName()).compareTo(String.valueOf(b.getRegistryName())));
        w.beginObject();
        w.name("format").value(RotnDump.FORMAT);
        w.name("blocks").beginObject();
        int n = 0;
        for (Block b : blocks) {
            if (b.getRegistryName() == null) continue;
            w.name(b.getRegistryName().toString());
            writeBlock(w, b);
            n++;
        }
        w.endObject();
        w.endObject();
        return n;
    }

    private void writeBlock(JsonWriter w, Block b) throws IOException {
        w.beginObject();
        int defMeta = 0;
        try {
            defMeta = b.getMetaFromState(b.getDefaultState());
        } catch (Throwable t) {
            w.name("defaultMetaError").value(String.valueOf(t));
        }
        w.name("defaultMeta").value(defMeta);
        w.name("class").value(b.getClass().getName());
        w.name("states").beginArray();
        for (int m = 0; m < 16; m++) {
            IBlockState s;
            try {
                s = b.getStateFromMeta(m);
                if (s == null || s.getBlock() != b || b.getMetaFromState(s) != m) continue;
            } catch (Throwable t) {
                continue;
            }
            writeState(w, b, s, m);
        }
        w.endArray();
        w.endObject();
    }

    private void writeState(JsonWriter w, Block b, IBlockState s, int meta) throws IOException {
        w.beginObject();
        w.name("meta").value(meta);
        w.name("props").beginObject();
        try {
            for (Map.Entry<IProperty<?>, Comparable<?>> e : s.getProperties().entrySet()) {
                w.name(e.getKey().getName()).value(valueName(e.getKey(), e.getValue()));
            }
        } catch (Throwable t) {
            // leave props partial
        }
        w.endObject();

        Item item = Item.getItemFromBlock(b);
        int itemMeta = 0;
        try {
            itemMeta = b.damageDropped(s);
        } catch (Throwable t) {
            // keep 0
        }
        String display = null;
        try {
            if (item != null && item != Items.AIR) display = new ItemStack(item, 1, itemMeta).getDisplayName();
            else display = b.getLocalizedName();
        } catch (Throwable t) {
            // no display name
        }
        w.name("displayName").value(display);

        Double hardness = null;
        try {
            hardness = Names.finite(s.getBlockHardness(world, pos));
        } catch (Throwable t) {
            // null
        }
        Names.num(w, "hardness", hardness);
        Double resistance = null;
        try {
            resistance = Names.finite(b.getExplosionResistance(null));
        } catch (Throwable t) {
            // null
        }
        Names.num(w, "explosionResistance", resistance);

        Material mat = null;
        try {
            mat = s.getMaterial();
        } catch (Throwable t) {
            // null
        }
        w.name("material").value(materialName(mat));
        String tool = null;
        int level = -1;
        try {
            tool = b.getHarvestTool(s);
            level = b.getHarvestLevel(s);
        } catch (Throwable t) {
            // defaults
        }
        w.name("harvestTool").value(tool);
        w.name("harvestLevel").value(level);
        if (mat != null) {
            w.name("toolRequired").value(!mat.isToolNotRequired());
            w.name("solid").value(mat.blocksMovement());
            w.name("liquid").value(mat.isLiquid());
            w.name("replaceable").value(mat.isReplaceable());
        }
        try {
            w.name("light").value(s.getLightValue());
            w.name("opacity").value(s.getLightOpacity());
            w.name("fullCube").value(s.isFullCube());
            w.name("opaque").value(s.isOpaqueCube());
        } catch (Throwable t) {
            // partial
        }
        w.name("collision");
        try {
            AxisAlignedBB bb = s.getCollisionBoundingBox(world, pos);
            if (bb == null || bb == Block.NULL_AABB) {
                w.beginArray().endArray();
            } else {
                w.beginArray().beginArray();
                w.value(bb.minX).value(bb.minY).value(bb.minZ).value(bb.maxX).value(bb.maxY).value(bb.maxZ);
                w.endArray().endArray();
            }
        } catch (Throwable t) {
            w.nullValue();
        }

        w.name("item");
        if (item != null && item != Items.AIR && Names.name(item) != null) {
            w.beginObject().name("name").value(Names.name(item)).name("meta").value(itemMeta).endObject();
        } else {
            w.nullValue();
        }

        w.name("drops");
        try {
            Item drop = b.getItemDropped(s, new Random(0), 0);
            int count = b.quantityDropped(s, 0, new Random(0));
            if (drop == null || drop == Items.AIR || count <= 0) {
                w.beginArray().endArray();
            } else {
                w.beginArray().beginObject();
                w.name("name").value(Names.name(drop));
                w.name("meta").value(b.damageDropped(s));
                w.name("count").value(count);
                w.endObject().endArray();
            }
        } catch (Throwable t) {
            w.nullValue();
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
