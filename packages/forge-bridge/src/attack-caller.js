// Who called bot.attack, from a stack trace (soak 16 death 2: the hit that provoked a hen could not be
// attributed). The answer is one of three:
//   - the first two frames that are neither forge-bridge's own src, mineflayer itself, node, nor a known
//     pass-through wrapper of bot.attack (ATTACK_WRAPPERS), innermost first:
//     "attackEntity skills.js:1234 < huntAnimal hunting.js:80". A frame in another package is named with
//     it: "cb mineflayer-pvp/PVP.js:213". File names only, never paths.
//   - for a hit mineflayer-pvp sends (its physicsTick loop calls bot.attack, so every frame is in a
//     package), the caller of bot.pvp.attack for that target, which attachPvpCallers remembers:
//     "attackEntity skills.js:1023 via mineflayer-pvp";
//   - else "no caller: <package>", the first frame's package after forge-bridge (mineflayer for its own
//     timers and events, node for a bare timer).
// Async callers appear as V8 records them ("async" frames).

/** forge-bridge's own frames: never the caller. */
const OWN = [/[\\/]packages[\\/]forge-bridge[\\/]src[\\/]/, /[\\/]packages[\\/]forge-bridge[\\/]index\.js/];

/**
 * Pass-through wrappers of bot.attack above the bridge's: their frame is skipped, so the code that called
 * bot.attack is named, not the wrapper. { file (a RegExp on the path), fn (the frame's function name) }.
 * Exported, so a new wrapper can be added (ATTACK_WRAPPERS.push(...)).
 */
export const ATTACK_WRAPPERS = [
    { file: /[\\/]src[\\/]agent[\\/]library[\\/]hands\.js$/, fn: 'guarded' }, // #652: installAttackGuard
    { file: /[\\/]src[\\/]agent[\\/]library[\\/]survival_log\.js$/, fn: 'marking' }, // the provoked marks (#612)
    { file: /[\\/]src[\\/]agent[\\/]library[\\/]skills\.js$/, fn: 'bot.attack' }, // defendSelf's swing stamp
];

/** One stack line as { fn, file, line }, or null when it is not a frame. */
export function parseFrame(text) {
    const m = /^\s*at (?:async )?(?:(.+?) \((.+?):(\d+):\d+\)|(.+?):(\d+):\d+)\s*$/.exec(text);
    if (!m) return null;
    const fn = m[1] ?? null;
    const file = (m[2] ?? m[4]).replace(/^file:\/\//, '');
    // "TestContext.<anonymous>", "<anonymous>": no name worth printing. "EventEmitter.guarded" (mineflayer's
    // bot is a plain EventEmitter), "Object.x", "PVP.x": the receiver's type dropped, just the function.
    // "bot.attack" (an inferred name, lower case) is kept. "x [as attack]": x.
    const named = fn && !fn.includes('<anonymous>') ? fn.replace(/ \[as [^\]]+\]$/, '').replace(/^[A-Z][\w$]*\./, '') : null;
    return { fn: named, file, line: Number(m[3] ?? m[5]) };
}

/** The package a frame's file is in ("mineflayer-pvp", "@scope/name"), "node" for node's own, or null (the project). */
export function packageOf(file) {
    if (/^node:|^internal[\\/]/.test(file)) return 'node';
    const m = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(file);
    return m ? m[1].replace(/\\/g, '/') : null;
}

const isOwn = (f) => OWN.some((re) => re.test(f.file));
const isWrapper = (f) => ATTACK_WRAPPERS.some((w) => w.fn === f.fn && w.file.test(f.file));
// mineflayer's and node's frames are never the caller; other packages' are (mineflayer-pvp's attack loop).
const isSkipped = (f) => { const p = packageOf(f.file); return p === 'mineflayer' || p === 'node'; };
const show = (f) => {
    const pkg = packageOf(f.file);
    const where = `${pkg ? `${pkg}/` : ''}${f.file.split(/[\\/]/).pop()}:${f.line}`;
    return f.fn ? `${f.fn} ${where}` : where;
};

/**
 * The caller for `stack` (an Error's stack taken in or below bot.attack), as above; always a string.
 * @param {string} stack
 * @param {object} [o]
 * @param {number} [o.depth] how many frames to name (2)
 * @param {(id: number) => string|null} [o.pvpCaller] the remembered bot.pvp.attack caller for a target id
 * @param {number} [o.targetId] the target of this hit
 */
export function callerOf(stack, { depth = 2, pvpCaller = null, targetId = null } = {}) {
    const all = String(stack ?? '').split('\n').slice(1).map(parseFrame).filter((f) => f && !isOwn(f) && !isWrapper(f));
    const frames = all.filter((f) => !isSkipped(f));
    if (!frames.length) return `no caller: ${all.length ? packageOf(all[0].file) ?? 'node' : 'node'}`;
    if (packageOf(frames[0].file) === 'mineflayer-pvp' && pvpCaller) {
        let via = null;
        try { via = pvpCaller(targetId); } catch { via = null; }
        if (via) return `${via} via mineflayer-pvp`;
    }
    return frames.slice(0, depth).map(show).join(' < ');
}

/** "name#id" for an entity id the bot knows (bot.entities), else "?#id". */
export function targetName(bot, id) {
    const e = bot?.entities?.[id];
    const name = e?.name ?? (e?.type === 'player' ? 'player' : null) ?? '?';
    return `${name}#${id ?? '?'}`;
}

const PVP = Symbol.for('mindcraft-rotn.pvpCallers');
/** How many targets' bot.pvp.attack callers are kept (the oldest go first). */
export const PVP_CALLERS_KEPT = 50;

/** The remembered bot.pvp.attack caller lookup for a bot (attachPvpCallers), for callerOf's pvpCaller. */
export const pvpCallerFor = (bot) => (id) => bot?.[PVP]?.callerFor(id) ?? null;

/**
 * Remembers the caller of each bot.pvp.attack(target) by target id, so a hit mineflayer-pvp later sends from
 * its tick loop names who started that fight. Wraps bot.pvp.attack once mineflayer-pvp is injected (now, or
 * at inject_allowed or spawn). Once per bot; returns { callerFor(id) }.
 */
export function attachPvpCallers(bot) {
    if (bot[PVP]) return bot[PVP];
    const callers = new Map();
    const report = { callerFor: (id) => callers.get(id) ?? null };
    bot[PVP] = report;
    const wrap = () => {
        const pvp = bot.pvp;
        if (!pvp || typeof pvp.attack !== 'function' || pvp.attack[PVP]) return;
        const original = pvp.attack;
        const attack = function (target, ...rest) {
            if (target?.id != null) {
                callers.delete(target.id); // the newest last, so the oldest is dropped first
                callers.set(target.id, callerOf(new Error().stack));
                if (callers.size > PVP_CALLERS_KEPT) callers.delete(callers.keys().next().value);
            }
            return original.call(this ?? pvp, target, ...rest);
        };
        attack[PVP] = true;
        pvp.attack = attack;
    };
    wrap();
    bot.once?.('inject_allowed', wrap);
    bot.on?.('spawn', wrap);
    return report;
}
