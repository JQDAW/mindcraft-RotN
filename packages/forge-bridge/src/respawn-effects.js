// The bot's effects after a respawn (soak 14).
//
// patches/mineflayer (entities.js) empties bot.entity.effects on every respawn packet, as the
// vanilla client does: its new player entity has no effects, and the server sends no
// remove_entity_effect for those of the entity that died. mineflayer kept them, so a starvation
// death's Mining Fatigue IV (Hunger Overhaul, food 1 or less) stayed in bot.entity.effects and
// every later bot.digTime read it: dirt by hand 926 s instead of 0.75 s, and digs hung until a
// caller's limit. The patch emits respawnEffectsCleared with the dropped effects; this logs them
// once per respawn, so a soak shows what a death left behind.

const ATTACHED = Symbol.for('mindcraft-rotn.respawnEffectsLog');

/** "MiningFatigue:3 Slowness:1": each effect's registry name (else its id) and its amplifier. */
export function effectList(registry, effects) {
    return (effects ?? []).map((e) => `${registry?.effects?.[e?.id]?.name ?? e?.id}:${e?.amplifier ?? '?'}`).join(' ');
}

/**
 * Logs `respawn: dropped stale effects ...` for each respawn that dropped any. Once per bot.
 * @returns {{respawns: number, dropped: number}} a live count: respawns that dropped effects, and effects dropped
 */
export function attachRespawnEffectsLog(bot, { log = (m) => console.log(`[forge-bridge] ${m}`) } = {}) {
    if (bot[ATTACHED]) return bot[ATTACHED];
    const report = { respawns: 0, dropped: 0 };
    bot[ATTACHED] = report;
    bot.on('respawnEffectsCleared', (effects) => {
        report.respawns++;
        report.dropped += effects?.length ?? 0;
        log(`respawn: dropped stale effects ${effectList(bot.registry, effects)} (effect:amplifier; the new player entity has none)`);
    });
    return report;
}
