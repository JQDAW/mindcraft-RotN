// Attack counts in the journal (soak 14, death 1).
//
// A soak could not show whether any attack went out before the grove sprite's hits: the Better
// Combat wrapper counts its calls in memory only, and the per-packet record needs FORGE_CAPTURE
// (off on the CX23). This prints numbers only:
//   - the attack packets written to the connection (#610 review 2: counted at client.write, so a
//     write on a connection that has already ended counts too): `bettercombat` payloads (Better
//     Combat's PacketMainhandAttack, the only payload sent on that channel) and use_entity with
//     mouse 1 (vanilla attack; mouse 0 and 2 are interactions, not counted);
//   - the wrapper's per-path call counts (bettercombat.js stats).
// When: once a minute if the numbers changed since the last line, at every death and when the
// connection ends (a stop, a kick), so the zeros show too. At the first spawn one status line says
// the counter is on (#610 review 3), so a journal without any count line still shows it was.

const ATTACHED = Symbol.for('mindcraft-rotn.attackCounts');
export const ATTACK_COUNTS_EVERY_MS = 60_000;
const CALL_KEYS = ['bettercombat', 'vanilla', 'waits', 'replaced', 'gone', 'cancelled', 'reach', 'sight', 'misses'];

/** The status line at the first spawn (#610 review 3). */
export const ATTACK_COUNTS_STATUS = 'attack counts: on (attack packets written and the wrapper\'s calls; a line a minute when they change, at every death and at the end)';

/** The line's text for `why` (minute, death, end). */
export function attackCountsLine(why, packets, calls = {}) {
    const c = CALL_KEYS.map((k) => `${k} ${calls?.[k] ?? 0}`).join(', ');
    return `attacks (${why}): written bettercombat ${packets.bettercombat}, use_entity ${packets.use_entity}; calls ${c}`;
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
    bot.once('spawn', () => log(ATTACK_COUNTS_STATUS));

    const report = { packets, line, stop };
    bot[ATTACHED] = report;
    return report;
}
