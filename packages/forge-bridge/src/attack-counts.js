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
//
// Soak 16 death 2 (a hen provoked by a hit no log could attribute): each line also names the targets
// of the attack packets written since the last line, with the bot.attack caller that sent them, and
// the waiting calls a newer call replaced (both callers and targets):
//   ...; targets animania:hen_rhode_island_red#1234 x2 (attackEntity skills.js:1023 via mineflayer-pvp),
//   zombie#77 x1 (defendSelf skills.js:1143 via mineflayer-pvp), zombie#80 x1 (no caller: mineflayer);
//   replaced attackEntity skills.js:1023 via mineflayer-pvp -> animania:hog_old_spot#90 by defendSelf
//   skills.js:1143 via mineflayer-pvp -> zombie#77
// A target is "name#id" from bot.entities when the packet is written ("?#id" when the bot does not
// know it). The caller (attack-caller.js callerOf: two frames, a package's frames named with it,
// known wrappers skipped, a mineflayer-pvp hit named by its bot.pvp.attack caller) is the Better Combat
// wrapper's (bettercombat.js firingCaller), else the stack at the write (a direct bot.attackVanilla,
// say); "no caller: <package>" when no frame is the bot's own. "targets -" when nothing was sent.
// At most TARGETS_SHOWN targets and REPLACED_SHOWN replacements per line, then "+N more".

import { decodeMainhandAttack } from './bettercombat.js';
import { callerOf, targetName, pvpCallerFor } from './attack-caller.js';

const ATTACHED = Symbol.for('mindcraft-rotn.attackCounts');
export const TARGETS_SHOWN = 8;
export const REPLACED_SHOWN = 4;
export const ATTACK_COUNTS_EVERY_MS = 60_000;
const CALL_KEYS = ['bettercombat', 'vanilla', 'waits', 'replaced', 'gone', 'cancelled', 'reach', 'sight', 'misses'];

/** The status line at the first spawn (#610 review 3). */
export const ATTACK_COUNTS_STATUS = 'attack counts: on (attack packets written and the wrapper\'s calls; a line a minute when they change, at every death and at the end)';

const more = (list, shown) => (list.length > shown ? [...list.slice(0, shown), `+${list.length - shown} more`] : list);

/**
 * The line's text for `why` (minute, death, end).
 * @param {object} [detail] { targets: Map(JSON.stringify(["name#id", caller or null]) -> count),
 *   replaced: [{ replaced, by }] (each { caller, target })};
 *   omitted: the numbers only (the comparison for the minute line)
 */
export function attackCountsLine(why, packets, calls = {}, detail = null) {
    const c = CALL_KEYS.map((k) => `${k} ${calls?.[k] ?? 0}`).join(', ');
    const base = `attacks (${why}): written bettercombat ${packets.bettercombat}, use_entity ${packets.use_entity}; calls ${c}`;
    if (!detail) return base;
    const targets = [...(detail.targets ?? new Map())].map(([k, n]) => {
        const [target, caller] = JSON.parse(k);
        return `${target} x${n} (${caller ?? 'no caller: ?'})`;
    });
    const one = (x) => `${x?.caller ?? 'no caller: ?'} -> ${x?.target ?? '?'}`;
    const replaced = (detail.replaced ?? []).map((r) => `${one(r.replaced)} by ${one(r.by)}`);
    return `${base}; targets ${targets.length ? more(targets, TARGETS_SHOWN).join(', ') : '-'}`
        + (replaced.length ? `; replaced ${more(replaced, REPLACED_SHOWN).join(', ')}` : '');
}

/**
 * Counts attack packets on bot._client.write and logs the counts (see above). Once per bot.
 * @param {object} bot mineflayer bot (its _client already exists)
 * @param {object} opts
 * @param {() => object} [opts.stats] the Better Combat wrapper's call counts (forge.bcAttack.stats)
 * @param {() => string|null} [opts.caller] the wrapper's caller for the packet being written (forge.bcAttack.firingCaller)
 * @param {() => object[]} [opts.takeReplacements] the wrapper's replacements since the last take (forge.bcAttack.takeReplacements)
 * @returns {{packets: {bettercombat: number, use_entity: number}, line: (why: string) => string, stop: () => void}}
 */
export function attachAttackCounts(bot, {
    stats = () => ({}), caller = () => null, takeReplacements = () => [], log = (m) => console.log(`[forge-bridge] ${m}`), everyMs = ATTACK_COUNTS_EVERY_MS,
    setTimer = setInterval, clearTimer = clearInterval,
} = {}) {
    if (bot[ATTACHED]) return bot[ATTACHED];
    const packets = { bettercombat: 0, use_entity: 0 };
    let targets = new Map(); // JSON [target, caller] -> count, since the last line
    const note = (id) => {
        let who = null;
        try { who = caller() ?? callerOf(new Error().stack, { pvpCaller: pvpCallerFor(bot), targetId: id }); } catch { who = 'no caller: error'; }
        const k = JSON.stringify([targetName(bot, id), who]);
        targets.set(k, (targets.get(k) ?? 0) + 1);
    };
    const client = bot._client;
    const write = client.write;
    client.write = function (name, params) {
        if (name === 'custom_payload' && params?.channel === 'bettercombat') {
            packets.bettercombat++;
            let id = null;
            try { id = decodeMainhandAttack(params.data).entityId; } catch { id = null; }
            note(id);
        } else if (name === 'use_entity' && params?.mouse === 1) {
            packets.use_entity++;
            note(params.target);
        }
        return write.apply(this, arguments);
    };

    const calls = () => { try { return stats() ?? {}; } catch { return {}; } };
    const line = (why) => {
        let replaced = [];
        try { replaced = takeReplacements() ?? []; } catch { replaced = []; }
        const text = attackCountsLine(why, packets, calls(), { targets, replaced });
        targets = new Map();
        return text;
    };
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
