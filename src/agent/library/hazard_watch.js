// Re-plan after a teleport or a horde warning (skills-rotn D1b; brief deliverable 3; PLAN priority 1).
//
// AggroTP (rotn-progression.md hazard table): a Quazar teleports the player it aggroes about 7
// blocks every 21 to 29 s. "Re-plan after any position jump of 5 or more blocks." A teleport is a
// server position packet: mineflayer emits 'forcedMove' after it. Only then is the position
// compared with the one at the last physics tick, so the bot's own walking (a mode's moveAway, the
// pathfinder) is never taken for a teleport (#212 review 3). Vertical moves are not counted.
//
// Hordes (`hordes` 1.1.7): the wave warning is the lang key `message.hordes.EventStart` ("You hear
// the howls of a nearby horde"), sent on the Forge channel `hordes_hordeevent` (#212 review 1;
// forge-bridge will decode it). Only that key counts (review 2), not EventEnd or TrySleep.

/** A forced move this long or more (horizontally) is a teleport. */
export const JUMP_BLOCKS = 5;
/** The hordes mod's wave warning (its en_us.lang: "You hear the howls of a nearby horde"). */
export const HORDE_START_KEY = 'message.hordes.EventStart';

/** The bot's position at the last physics tick, against which a forced move is measured. */
export class JumpWatch {
    constructor() { this.last = null; }

    reset() { this.last = null; }

    /** Every physics tick: where the bot is. */
    sample(pos) {
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) this.last = { x: pos.x, y: pos.y, z: pos.z };
    }

    /**
     * On 'forcedMove' (the server set the position): the jump when it is JUMP_BLOCKS or more from
     * the last tick's position, else null. The new position becomes the sample.
     * @returns {{from, to, blocks: number}|null}
     */
    forced(pos, { riding = false } = {}) {
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return null;
        const prev = this.last;
        this.sample(pos);
        if (!prev || riding) return null;
        const blocks = Math.hypot(pos.x - prev.x, pos.z - prev.z);
        return blocks >= JUMP_BLOCKS ? { from: prev, to: this.last, blocks } : null;
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

/**
 * Whether a lang key, or a chat component (the title fallback), is the horde wave warning:
 * exactly HORDE_START_KEY. {key} or null.
 */
export function hordeWarning(keyOrComponent) {
    if (keyOrComponent === HORDE_START_KEY) return { key: HORDE_START_KEY };
    if (typeof keyOrComponent === 'string' && /^[\w.]+$/.test(keyOrComponent)) return null; // another key
    const { keys } = componentParts(keyOrComponent);
    return keys.includes(HORDE_START_KEY) ? { key: HORDE_START_KEY } : null;
}
