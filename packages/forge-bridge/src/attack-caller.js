// Who called bot.attack, from a stack trace (soak 16 death 2: the hit that provoked a hen could not be
// attributed). The first two frames outside forge-bridge's own src, mineflayer and node's internals,
// innermost first: "attackEntity skills.js:1234 < huntAnimal skills.js:980". Async callers appear as
// V8 records them ("async" frames). File names only, never full paths.

const SKIP = [/[\\/]packages[\\/]forge-bridge[\\/]src[\\/]/, /[\\/]packages[\\/]forge-bridge[\\/]index\.js/, /[\\/]node_modules[\\/]/, /^node:/, /^internal[\\/]/];

/** One stack line as { fn, file, line }, or null when it is not a frame. */
export function parseFrame(text) {
    const m = /^\s*at (?:async )?(?:(.+?) \((.+?):(\d+):\d+\)|(.+?):(\d+):\d+)\s*$/.exec(text);
    if (!m) return null;
    const fn = m[1] ?? null;
    const file = (m[2] ?? m[4]).replace(/^file:\/\//, '');
    // "TestContext.<anonymous>", "<anonymous>": no name worth printing; "Object.x", "Bot.x": just x;
    // "bot.attack [as vanillaAttack]": the name it was called by.
    const named = fn && !fn.includes('<anonymous>') ? fn.replace(/ \[as [^\]]+\]$/, '').replace(/^(?:Object|Bot)\./, '') : null;
    return { fn: named, file, line: Number(m[3] ?? m[5]) };
}

/**
 * The caller of the code that made `stack` (an Error's stack), or null when no frame is outside
 * forge-bridge, mineflayer and node (a timer, an event).
 * @param {string} stack
 * @param {number} [depth] how many frames to name (2)
 */
export function callerOf(stack, depth = 2) {
    const frames = String(stack ?? '').split('\n').slice(1).map(parseFrame)
        .filter((f) => f && !SKIP.some((re) => re.test(f.file)));
    if (!frames.length) return null;
    return frames.slice(0, depth).map((f) => {
        const where = `${f.file.split(/[\\/]/).pop()}:${f.line}`;
        return f.fn ? `${f.fn} ${where}` : where;
    }).join(' < ');
}

/** "name#id" for an entity id the bot knows (bot.entities), else "?#id". */
export function targetName(bot, id) {
    const e = bot?.entities?.[id];
    const name = e?.name ?? (e?.type === 'player' ? 'player' : null) ?? '?';
    return `${name}#${id ?? '?'}`;
}
