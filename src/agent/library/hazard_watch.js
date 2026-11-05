// Re-plan after a teleport or a horde warning (skills-rotn D1b; brief deliverable 3; PLAN priority 1).
//
// AggroTP (rotn-progression.md hazard table): a Quazar teleports the player it aggroes about 7
// blocks every 21 to 29 s. "Re-plan after any position jump of 5 or more blocks." Walking moves
// the bot at most about 2 blocks between two mode updates (300 ms), so a horizontal jump of
// JUMP_BLOCKS or more is a teleport. Vertical moves (falling) are not counted.
//
// Hordes (the `hordes` mod, 1.1.7 in the pack): "a title message and sound when a wave spawns".
// Only a title whose text or translation key names a horde counts (lead, #206 review 5), not any
// title. The exact key is not known yet (requested from rotn-data, which has the pack's jars).

/** A horizontal jump between two samples this long or more is a teleport. */
export const JUMP_BLOCKS = 5;
/** Two samples further apart in time than this are not compared (a stall, a reconnect). */
export const MAX_SAMPLE_GAP_MS = 2_000;

/** Tracks the bot's position; observe() returns the jump when one happened, else null. */
export class JumpWatch {
    constructor() { this.last = null; }

    reset() { this.last = null; }

    /** @returns {{from, to, blocks: number}|null} */
    observe(pos, now, { riding = false } = {}) {
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return null;
        const prev = this.last;
        this.last = { x: pos.x, y: pos.y, z: pos.z, at: now };
        if (!prev || riding || now - prev.at > MAX_SAMPLE_GAP_MS) return null;
        const blocks = Math.hypot(pos.x - prev.x, pos.z - prev.z);
        if (blocks < JUMP_BLOCKS) return null;
        return { from: prev, to: this.last, blocks };
    }
}

/** Every text and translation key in a chat component (a JSON string or an object). */
function componentParts(component) {
    let c = component;
    if (typeof c === 'string') {
        try { c = JSON.parse(c); } catch { return { texts: [c], keys: [] }; }
    }
    const texts = [], keys = [];
    const walk = (x, depth) => {
        if (depth > 8 || x == null) return;
        if (typeof x === 'string') { texts.push(x); return; }
        if (Array.isArray(x)) { x.forEach(y => walk(y, depth + 1)); return; }
        if (typeof x !== 'object') return;
        if (typeof x.text === 'string') texts.push(x.text);
        if (typeof x.translate === 'string') keys.push(x.translate);
        walk(x.extra, depth + 1);
        walk(x.with, depth + 1);
    };
    walk(c, 0);
    return { texts, keys };
}

const oneLine = (s, max = 120) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A horde warning in a title component: {key, text} when a translation key or the text names a
 * horde (the hordes mod's own messages), else null.
 */
export function hordeWarning(component) {
    const { texts, keys } = componentParts(component);
    const key = keys.find(k => /horde/i.test(k)) ?? null;
    const text = oneLine(texts.join(''));
    if (key || /\bhordes?\b/i.test(text)) return { key, text };
    return null;
}
