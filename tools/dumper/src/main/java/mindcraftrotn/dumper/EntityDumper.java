package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityAgeable;
import net.minecraft.entity.EntityCreature;
import net.minecraft.entity.EntityFlying;
import net.minecraft.entity.EntityLiving;
import net.minecraft.entity.EntityLivingBase;
import net.minecraft.entity.monster.EntityMob;
import net.minecraft.entity.monster.IMob;
import net.minecraft.entity.passive.EntityAmbientCreature;
import net.minecraft.entity.passive.EntityAnimal;
import net.minecraft.entity.passive.EntityTameable;
import net.minecraft.entity.passive.EntityWaterMob;
import net.minecraft.entity.passive.IAnimals;
import net.minecraft.util.text.translation.I18n;
import net.minecraftforge.fml.common.registry.EntityEntry;
import net.minecraftforge.fml.common.registry.EntityRegistry;
import net.minecraftforge.fml.common.registry.ForgeRegistries;

/**
 * entities.json: {"format", "entities": {"specialmobs:firecreeper": {modId, modEntityTypeId, class,
 * entityName, displayName, modSpawn, usesVanillaSpawning, hostile, kinds, tracking {range, frequency, velocity}}}}
 *
 * modId + modEntityTypeId is the mod-local id that FML's EntitySpawn message carries (the
 * server never sends this table; fml-spec.md section 3). Vanilla entities have no mod-local id
 * (null). modSpawn is false for an entity without an FML mod spawn registration (then modId is
 * only its registry namespace and modEntityTypeId is null). A mod entity with usesVanillaSpawning
 * arrives in a vanilla spawn packet with its minecraft:entities id, not in FML EntitySpawn.
 * hostile = the class implements IMob. kinds lists the base classes it extends.
 */
final class EntityDumper extends Part<EntityEntry> {
    @Override
    protected List<EntityEntry> entries() {
        List<EntityEntry> entries = new ArrayList<>(ForgeRegistries.ENTITIES.getValuesCollection());
        entries.removeIf(e -> e.getRegistryName() == null);
        entries.sort((a, b) -> a.getRegistryName().toString().compareTo(b.getRegistryName().toString()));
        return entries;
    }

    @Override
    protected void head(JsonWriter w) throws IOException {
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        w.name("entities").beginObject();
    }

    @Override
    protected boolean entry(JsonWriter w, EntityEntry e) throws IOException {
        w.name(e.getRegistryName().toString());
        writeEntity(w, e);
        return true;
    }

    @Override
    protected void tail(JsonWriter w) throws IOException {
        w.endObject();
        w.endObject();
    }

    private static void writeEntity(JsonWriter w, EntityEntry e) throws IOException {
        Class<? extends Entity> c = J.get(e::getEntityClass);
        String display = J.get(() -> {
            String key = "entity." + e.getName() + ".name";
            return I18n.canTranslate(key) ? I18n.translateToLocal(key) : null;
        });
        EntityRegistry.EntityRegistration reg = c == null ? null : J.get(() -> EntityRegistry.instance().lookupModSpawn(c, false));
        String regMod = reg == null ? null : J.get(() -> reg.getContainer().getModId());
        Integer typeId = reg == null ? null : J.get(reg::getModEntityId);
        Boolean vanillaSpawning = reg == null ? null : J.get(reg::usesVanillaSpawning);
        Integer range = reg == null ? null : J.get(reg::getTrackingRange);
        Integer frequency = reg == null ? null : J.get(reg::getUpdateFrequency);
        Boolean velocity = reg == null ? null : J.get(reg::sendsVelocityUpdates);
        String namespace = e.getRegistryName().getNamespace();
        List<String> kinds = new ArrayList<>();
        if (c != null) {
            kind(kinds, c, EntityLivingBase.class, "living");
            kind(kinds, c, EntityLiving.class, "ai");
            kind(kinds, c, EntityCreature.class, "creature");
            kind(kinds, c, EntityMob.class, "monster");
            kind(kinds, c, IAnimals.class, "animals");
            kind(kinds, c, EntityAgeable.class, "ageable");
            kind(kinds, c, EntityAnimal.class, "animal");
            kind(kinds, c, EntityTameable.class, "tameable");
            kind(kinds, c, EntityWaterMob.class, "water");
            kind(kinds, c, EntityAmbientCreature.class, "ambient");
            kind(kinds, c, EntityFlying.class, "flying");
        }

        w.beginObject();
        J.str(w, "class", c == null ? null : c.getName());
        J.str(w, "entityName", J.get(e::getName));
        J.str(w, "displayName", display);
        // modSpawn: FML knows a mod spawn registration for this class (EntityRegistry.registerModEntity).
        // usesVanillaSpawning: such an entity is still sent with vanilla spawn packets, not FML EntitySpawn.
        J.bool(w, "modSpawn", reg != null);
        J.str(w, "modId", reg != null ? regMod : namespace);
        J.num(w, "modEntityTypeId", typeId);
        J.bool(w, "usesVanillaSpawning", vanillaSpawning);
        if (reg != null) {
            w.name("tracking").beginObject();
            J.num(w, "range", range);
            J.num(w, "frequency", frequency);
            J.bool(w, "velocity", velocity);
            w.endObject();
        }
        J.bool(w, "hostile", c != null && IMob.class.isAssignableFrom(c));
        w.name("kinds").beginArray();
        for (String k : kinds) w.value(k);
        w.endArray();
        w.endObject();
    }

    private static void kind(List<String> out, Class<?> c, Class<?> base, String name) {
        if (base.isAssignableFrom(c)) out.add(name);
    }
}
