// Attack counts in the journal (soak 14, death 1).
//
// A soak could not show whether any attack went out before the grove sprite's hits: the Better
// Combat wrapper counts its calls in memory only, and the per-packet record needs FORGE_CAPTURE
// (off on the CX23). This prints numbers only:
//   - the attack packets that actually left the client: `bettercombat` payloads (Better Combat's
//     PacketMainhandAttack, the only payload sent on that channel) and use_entity with mouse 1
//     (vanilla attack; mouse 0 and 2 are interactions, not counted);
//   - the wrapper's per-path call counts (bettercombat.js stats).
// When: once a minute if the numbers changed since the last line, at every death and when the
// connection ends (a stop, a kick), so the zeros show too.

const ATTACHED = Symbol.for('mindcraft-rotn.attackCounts');
export const ATTACK_COUNTS_EVERY_MS = 60_000;
const CALL_KEYS = ['bettercombat', 'vanilla', 'waits', 'replaced', 'gone', 'cancelled', 'reach', 'sight', 'misses'];

/** The line's text for `why` (minute, death, end). */
export function attackCountsLine(why, packets, calls = {}) {
    const c = CALL_KEYS.map((k) => `${k} ${calls?.[k] ?? 0}`).join(', ');
    return `attacks (${why}): packets bettercombat ${packets.bettercombat}, use_entity ${packets.use_entity}; calls ${c}`;
}

/**
 * Counts attack packets on bot._client.write and logs the counts (see above). Once per bot.
 * @param {object} bot mineflayer bot (its _client already exists)
 * @param {object} opts
 * @param {() => object} [opts.stats] the Better Combat wrapper's call counts (forge.bcAttack.stats)
 * @returns {{packets: {bettercombat: number, use_entity: number}, line: (why: string) => string, stop: () => void}}
 */
export function attachAttackCounts(bot, {
    stats = () => ({}), log = (m) => console.log(`[forge-bridge] ${m}`), everyMs = ATTACK_COUNTS_EVERY_MS,
    setTimer = setInterval, clearTimer = clearInterval,
} = {}) {
    if (bot[ATTACHED]) return bot[ATTACHED];
    const packets = { bettercombat: 0, use_entity: 0 };
    const client = bot._client;
    const write = client.write;
    client.write = function (name, params) {
        if (name === 'custom_payload' && params?.channel === 'bettercombat') packets.bettercombat++;
        else if (name === 'use_entity' && params?.mouse === 1) packets.use_entity++;
        return write.apply(this, arguments);
    };

    const calls = () => { try { return stats() ?? {}; } catch { return {}; } };
    const line = (why) => attackCountsLine(why, packets, calls());
    let last = attackCountsLine('', { bettercombat: 0, use_entity: 0 }); // all zero: nothing to say yet
    const print = (why, always) => {
        const now = attackCountsLine('', packets, calls());
        if (!always && now === last) return;
        last = now;
        log(line(why));
    };

    const timer = setTimer(() => print('minute', false), everyMs);
    timer?.unref?.();
    const stop = () => clearTimer(timer);
    bot.on('death', () => print('death', true));
    bot.once('end', () => { stop(); print('end', true); });

    const report = { packets, line, stop };
    bot[ATTACHED] = report;
    return report;
}
