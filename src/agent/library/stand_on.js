// Standing on a block (G3 round 5 C, the lead): the task "go to the gold block at -42 68 -50 and
// stand on it" ended beside the block. The model walked to the block's own position with range 1,
// said "Standing on the gold block" and called !taskDone, and the server's on-marker check never
// found it there. Standing on a block means: the feet are at x, y+1, z, and the block under them is
// the block at x, y, z (the named one, when the text names one). Pure helpers, no walking here; the
// walk is skills.standOnBlock.
import Vec3 from 'vec3';
import { getBlockId } from '../../utils/mcdata.js';

const STAND_ON = /\bstand(?:s|ing)?\s+(?:on\s+top\s+of|on|upon)\b/i;
const COORDS = /\(?\s*(-?\d+)(?:\.\d+)?\s*[,\s]\s*(-?\d+)(?:\.\d+)?\s*[,\s]\s*(-?\d+)(?:\.\d+)?/;
const NAMED = /\b(?:the|a|an)\s+([a-z][a-z0-9_: ]*?)\s+(?:at|@)\s*\(?\s*-?\d/i;

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
    if (!STAND_ON.test(s)) return null;
    const c = s.match(COORDS);
    if (!c) return null;
    const named = s.match(NAMED);
    const name = named ? (blockNamesFor(named[1])[0] ?? null) : null;
    return { x: Number(c[1]), y: Number(c[2]), z: Number(c[3]), name };
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
    const feet = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const under = bot.blockAt(feet.offset(0, -1, 0));
    const at = `${feet.x} ${feet.y - 1} ${feet.z}`;
    if (!under) return { ok: false, under, why: `the block under your feet at ${at} is not loaded` };
    const there = feet.x === Math.floor(target.x) && feet.y - 1 === Math.floor(target.y) && feet.z === Math.floor(target.z);
    if (!there) return { ok: false, under, why: `the block under your feet is ${under.name} at ${at}, not ${describeTarget(target)}` };
    if (target.name && !sameBlock(under.name, target.name)) {
        return { ok: false, under, why: `the block under your feet at ${at} is ${under.name}, not ${target.name}` };
    }
    if (under.boundingBox !== 'block') return { ok: false, under, why: `the block under your feet at ${at} is ${under.name}, nothing to stand on` };
    if (bot.entity.onGround === false) return { ok: false, under, why: 'you are not on the ground' };
    return { ok: true, under, why: '' };
}
