// The bot's last damage (bot.lastDamageTime, bot.lastDamageTaken), which self_preservation and
// threats.js read. Upstream set it in Agent.startEvents; it is here so it can be tested.
// G3 round 10 A: the fatal hit (20 health to 0) was still the "last damage" after the respawn,
// so at full health self_preservation saw "damage >= health" within 3 s, said "I'm dying!" at the
// spawn point and fled 20 blocks. A death now clears the record: the respawned bot took no damage.

/** Keep bot.lastDamageTime/lastDamageTaken from the 'health' events; a 'death' clears them. */
export function bindDamageRecord(bot) {
    let prevHealth = bot.health;
    bot.lastDamageTime = 0;
    bot.lastDamageTaken = 0;
    bot.on('health', () => {
        if (bot.health < prevHealth) {
            bot.lastDamageTime = Date.now();
            bot.lastDamageTaken = prevHealth - bot.health;
        }
        prevHealth = bot.health;
    });
    bot.on('death', () => {
        bot.lastDamageTime = 0;
        bot.lastDamageTaken = 0;
    });
}
