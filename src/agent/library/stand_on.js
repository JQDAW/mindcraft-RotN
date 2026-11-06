// Standing on a block (G3 round 5 C, the lead): the task "go to the gold block at -42 68 -50 and
// stand on it" ended beside the block. The model walked to the block's own position with range 1,
// said "Standing on the gold block" and called !taskDone, and the server's on-marker check never
// found it there. Standing on a block means: the feet are at x, y+1, z, and the block under them is
// the block at x, y, z (the named one, when the text names one). Pure helpers, no walking here; the
// walk is skills.standOnBlock.
import Vec3 from 'vec3';
import { getBlockId } from '../../utils/mcdata.js';

const STAND_ON = /\bstand(?:s|ing)?\s+(?:on\s+top\s+of|on|upon)\b/i;
const NUM = String.raw`(-?\d+)(?:\.\d+)?`;
const TRIPLE = String.raw`\(?\s*${NUM}\s*[,\s]\s*${NUM}\s*[,\s]\s*${NUM}`;
const NAME = String.raw`(?:the|a|an)\s+([a-z][a-z0-9_: ]*?)\s+(?:at|@)\s*`;
// Right after "stand on": "the gold block at X Y Z", or just "X Y Z".
const AFTER = new RegExp(String.raw`^\s*(?:${NAME})?${TRIPLE}`, 'i');
// "stand on it" (or there, that): the block named before it, with its coordinates.
const PRONOUN = /^\s*(?:it|there|that(?:\s+block)?|this(?:\s+block)?)\b/i;
const NAMED_AT = new RegExp(String.raw`\b${NAME}${TRIPLE}`, 'gi');

const bare = (name) => String(name ?? '').toLowerCase().replace(/^minecraft:/, '');

/** The block names a phrase like "gold block" or "block of gold" may mean, that exist. */
export function blockNamesFor(phrase) {
    const p = bare(phrase).trim().replace(/\s+/g, ' ');
    if (!p) return [];
    const of = p.match(/^block of (.+)$/);
    const base = (of ? `${of[1]} block` : p).replace(/ /g, '_');
    const cands = [base, base.endsWith('_block') ? null : `${base}_block`].filter(Boolean);
    return cands.filter(n => getBlockId(n) != null);
}

/**
 * The block a text asks to stand on: { x, y, z, name } (name null when the text names no known
 * block), or null when the text does not say to stand on a block at coordinates.
 */
export function parseStandOn(text) {
    const s = String(text ?? '');
    const on = s.match(STAND_ON);
    if (!on) return null;
    // Only the coordinates that belong to the stand-on words (#274 review 2): "go to 100 70 100,
    // then stand on the gold block at -42 68 -50" is the gold block, not the first triple.
    const rest = s.slice(on.index + on[0].length);
    const after = rest.match(AFTER);
    let m = after ? after.slice(1, 5) : null;
    if (!m && PRONOUN.test(rest)) {
        const before = [...s.slice(0, on.index).matchAll(NAMED_AT)].at(-1);
        if (before) m = before.slice(1, 5);
    }
    if (!m) return null;
    const name = m[0] ? (blockNamesFor(m[0])[0] ?? null) : null;
    return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]), name };
}

/** True when a block name is the named one ("gold_block", or "minecraft:gold_block"). */
export const sameBlock = (a, b) => bare(a) === bare(b);

/** "the gold_block at -42 68 -50" */
export const describeTarget = (t) => `the ${t.name ?? 'block'} at ${t.x} ${t.y} ${t.z}`;

/**
 * Is the bot standing on the target block? { ok, under, why }: under is the block under its feet;
 * why says what is wrong ("the block under your feet is grass at -43 68 -50").
 */
export function standCheck(bot, target) {
    const p = bot?.entity?.position;
    if (!p) return { ok: false, under: null, why: 'your position is not known' };
    // The block the feet rest on, just below them. On a slab or farmland the feet are inside that
    // block's cell (y 68.5 on a slab at 68), so the cell of y - 0.01, not floor(y) - 1 (#274 nit).
    const cell = new Vec3(Math.floor(p.x), Math.floor(p.y - 0.01), Math.floor(p.z));
    const under = bot.blockAt(cell);
    const at = `${cell.x} ${cell.y} ${cell.z}`;
    if (!under) return { ok: false, under, why: `the block under your feet at ${at} is not loaded` };
    const there = cell.x === Math.floor(target.x) && cell.y === Math.floor(target.y) && cell.z === Math.floor(target.z);
    if (!there) return { ok: false, under, why: `the block under your feet is ${under.name} at ${at}, not ${describeTarget(target)}` };
    if (target.name && !sameBlock(under.name, target.name)) {
        return { ok: false, under, why: `the block under your feet at ${at} is ${under.name}, not ${target.name}` };
    }
    if (under.boundingBox !== 'block') return { ok: false, under, why: `the block under your feet at ${at} is ${under.name}, nothing to stand on` };
    if (bot.entity.onGround === false) return { ok: false, under, why: 'you are not on the ground' };
    return { ok: true, under, why: '' };
}
