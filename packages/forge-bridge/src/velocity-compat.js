// Entity velocity field names: minecraft-data 3.119 vs mineflayer 4.33.0.
//
// minecraft-data 3.119.0 (installed; the patch file still carries 3.97.0's name) defines the
// 1.12.2 packets entity_velocity, spawn_entity and spawn_entity_living with one field
// `velocity: vec3i16` ({ x, y, z }). mineflayer 4.33.0's entities plugin still reads
// packet.velocityX/Y/Z (lib/plugins/entities.js, the entity_velocity and spawn_entity_living
// handlers), which are undefined, so every entity_velocity gave a NaN velocity.
//
// For the bot itself that is the server's knockback (a hit, a push). The next physics tick made
// x and z NaN while y stayed finite: prismarine-physics' moveEntity takes the step-up branch on
// a NaN dx (NaN !== NaN), which rebuilds y from the old bounding box. S1a's movement_trace shows
// it: entity_velocity {x: 2261, y: 1600, z: -2324} for the bot (health 20 -> 17), then
// "position NaN 63.99999999999999 NaN" with velocity 0 / -0.0784 / 0 one tick later. G3 rounds
// 2 and 3 logged the same pattern (NaN y NaN) in the rocks, night and untrusted runs.
//
// This copies the vec3 into the old names before mineflayer's handlers run, for every entity.
// spawn_entity is left out: mineflayer 4.33.0's spawn_entity handler does not read a velocity.

export const VELOCITY_PACKETS = ['entity_velocity', 'spawn_entity_living'];

/** Copies packet.velocity {x, y, z} into velocityX/Y/Z in place. Returns true if it did. */
export function normalizeVelocityFields(packet) {
    const v = packet?.velocity;
    if (!v || typeof v !== 'object' || packet.velocityX !== undefined) return false;
    packet.velocityX = v.x;
    packet.velocityY = v.y;
    packet.velocityZ = v.z;
    return true;
}

/** Attach to the nmp client before (or after) mineflayer's plugins; runs before their handlers. */
export function attachVelocityCompat(client) {
    const stats = { normalized: 0 };
    for (const name of VELOCITY_PACKETS) {
        client.prependListener(name, (p) => { if (normalizeVelocityFields(p)) stats.normalized++; });
    }
    return stats;
}
