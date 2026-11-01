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
 * entityName, displayName, hostile, kinds, tracking {range, frequency, velocity}}}}
 *
 * modId + modEntityTypeId is the mod-local id that FML's EntitySpawn message carries (the
 * server never sends this table; fml-spec.md section 3). Vanilla entities have no mod-local id
 * (null). hostile = the class implements IMob. kinds lists the base classes it extends.
 */
final class EntityDumper {
    int write(JsonWriter w) throws IOException {
        List<EntityEntry> entries = new ArrayList<>(ForgeRegistries.ENTITIES.getValuesCollection());
        entries.sort((a, b) -> String.valueOf(a.getRegistryName()).compareTo(String.valueOf(b.getRegistryName())));
        int n = 0;
        w.beginObject();
        w.name("format").value(RotnDump.FORMAT);
        w.name("entities").beginObject();
        for (EntityEntry e : entries) {
            if (e.getRegistryName() == null) continue;
            w.name(e.getRegistryName().toString());
            writeEntity(w, e);
            n++;
        }
        w.endObject();
        w.endObject();
        return n;
    }

    private static void writeEntity(JsonWriter w, EntityEntry e) throws IOException {
        Class<? extends Entity> c = e.getEntityClass();
        w.beginObject();
        w.name("class").value(c == null ? null : c.getName());
        w.name("entityName").value(e.getName());
        String display = null;
        try {
            String key = "entity." + e.getName() + ".name";
            if (I18n.canTranslate(key)) display = I18n.translateToLocal(key);
        } catch (Throwable t) {
            // none
        }
        w.name("displayName").value(display);

        EntityRegistry.EntityRegistration reg = null;
        try {
            if (c != null) reg = EntityRegistry.instance().lookupModSpawn(c, false);
        } catch (Throwable t) {
            // vanilla or unknown
        }
        if (reg != null) {
            w.name("modId").value(reg.getContainer().getModId());
            w.name("modEntityTypeId").value(reg.getModEntityId());
            w.name("tracking").beginObject()
                    .name("range").value(reg.getTrackingRange())
                    .name("frequency").value(reg.getUpdateFrequency())
                    .name("velocity").value(reg.sendsVelocityUpdates())
                    .endObject();
        } else {
            w.name("modId").value(e.getRegistryName().getNamespace());
            w.name("modEntityTypeId").nullValue();
        }
        w.name("hostile").value(c != null && IMob.class.isAssignableFrom(c));
        w.name("kinds").beginArray();
        if (c != null) {
            kind(w, c, EntityLivingBase.class, "living");
            kind(w, c, EntityLiving.class, "ai");
            kind(w, c, EntityCreature.class, "creature");
            kind(w, c, EntityMob.class, "monster");
            kind(w, c, IAnimals.class, "animals");
            kind(w, c, EntityAgeable.class, "ageable");
            kind(w, c, EntityAnimal.class, "animal");
            kind(w, c, EntityTameable.class, "tameable");
            kind(w, c, EntityWaterMob.class, "water");
            kind(w, c, EntityAmbientCreature.class, "ambient");
            kind(w, c, EntityFlying.class, "flying");
        }
        w.endArray();
        w.endObject();
    }

    private static void kind(JsonWriter w, Class<?> c, Class<?> base, String name) throws IOException {
        if (base.isAssignableFrom(c)) w.value(name);
    }
}
