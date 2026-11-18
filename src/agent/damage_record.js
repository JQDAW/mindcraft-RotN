// The bot's last damage (bot.lastDamageTime, bot.lastDamageTaken), which self_preservation and
// threats.js read. Upstream set it in Agent.startEvents; it is here so it can be tested.
// G3 round 10 A: the fatal hit (20 health to 0) was still the "last damage" after the respawn,
// so at full health self_preservation saw "damage >= health" within 3 s, said "I'm dying!" at the
// spawn point and fled 20 blocks. A death now clears the record: the respawned bot took no damage.

/**
 * #453 review 1: a fall counts as the damage's cause when the bot dropped more than FALL.minDrop
 * blocks (1.12 fall damage starts past 3) and landed within FALL.landedMs of the damage, or is
 * still in the air that far below where it left the ground.
 */
export const FALL = { minDrop: 3, landedMs: 1000 };

/**
 * Keep bot.lastDamageTime/lastDamageTaken from the 'health' events, and bot.lastDamageCause: 'fall'
 * or 'starving' (food 0 and 1 damage) when the world, not a mob, did it, else null (#453 review 1:
 * threats.js never takes those for an animal's hit). A 'death' clears them.
 */
export function bindDamageRecord(bot) {
    let prevHealth = bot.health;
    let air = null; // {fromY}: where the bot left the ground
    let landed = null; // {at, drop}: the last landing
    bot.lastDamageTime = 0;
    bot.lastDamageTaken = 0;
    bot.lastDamageCause = null;
    bot.on('move', () => {
        const e = bot.entity;
        if (!e?.position) return;
        if (e.onGround) {
            if (air) { landed = { at: Date.now(), drop: air.fromY - e.position.y }; air = null; }
        } else if (!air) air = { fromY: e.position.y };
    });
    bot.on('health', () => {
        if (bot.health < prevHealth) {
            const now = Date.now();
            bot.lastDamageTime = now;
            bot.lastDamageTaken = prevHealth - bot.health;
            const y = bot.entity?.position?.y;
            const fell = (landed && now - landed.at <= FALL.landedMs && landed.drop > FALL.minDrop)
                || (air && Number.isFinite(y) && air.fromY - y > FALL.minDrop);
            const starving = bot.food === 0 && bot.lastDamageTaken <= 1;
            bot.lastDamageCause = fell ? 'fall' : starving ? 'starving' : null;
        }
        prevHealth = bot.health;
    });
    bot.on('death', () => {
        bot.lastDamageTime = 0;
        bot.lastDamageTaken = 0;
        bot.lastDamageCause = null;
        air = null;
        landed = null;
    });
}
