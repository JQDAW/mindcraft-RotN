// Offline tests for felling Dynamic Trees trees in RotN.
// G3 smoke C+D: a branch break fells the tree (rotn-data's "fell-tree" rule); its logs drop where it
// lands, a moment later and away from the bot, so collectBlock waits for them (bounded) and picks
// them up around the tree.
// G3 round 3 B: the falling tree crushed the bot ("FRCFLD was crushed by a falling tree"). Now the
// bot cuts the lowest trunk block from the side away from the canopy, never from under it or between
// trunks, steps back at once, and collects only after the falling tree entity is gone.
// A fake world (dirt below y 64, a tree on rooty dirt) on the 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { worldSources } from './rotn_sources.js';
import { treeBase, standSpots, FALLING_TREE } from './felling.js';
import * as skills from './skills.js';
import * as world from './world.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName } };
const MODDED = { 'dynamictrees:sprucebranch': 4300, 'dynamictrees:leaves0': 4301, 'dynamictrees:rootydirt': 4302 };
for (const [name, id] of Object.entries(MODDED)) { reg.blocks[id] = { id, name }; reg.blocksByName[name] = reg.blocks[id]; }
__setRegistryForTest(reg);

const T = { timeout: 20_000 };
const FAST_DROPS = { settleMs: 1500, quietMs: 300, walkMs: 500, totalMs: 4000 };
const FAST_FALL = { appearMs: 500, maxMs: 3000, stepAwayMs: 500 };
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const key = (p) => `${p.x},${p.y},${p.z}`;
const BRANCH = 'dynamictrees:sprucebranch', LEAVES = 'dynamictrees:leaves0', ROOTY = 'dynamictrees:rootydirt';

/** A spruce on rooty dirt at x: a 5-block trunk, a limb and a canopy that leans east (+x). */
function tree(world, x, z = 0, { lean = 1, canopy = 67 } = {}) {
    world.set(key(at(x, 63, z)), ROOTY);
    for (let y = 64; y <= 68; y++) world.set(key(at(x, y, z)), BRANCH);
    world.set(key(at(x + lean, 67, z)), BRANCH); // a limb
    for (let dx = -1; dx <= 3; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = canopy; y <= canopy + 3; y++) {
        const p = at(x + dx * lean, y, z + dz);
        if (!world.has(key(p))) world.set(key(p), LEAVES);
    }
}

/**
 * The bot and its world. A cut trunk turns the whole tree into a falling tree entity for fallMs;
 * then its logs lie where it landed (log:1 each), east of the trunk (the canopy side).
 */
function fakeBot({ start = at(-2), fallMs = 600, trees = [[3]], drops = null, unreachable = [], onGround = [], build = null, stuck = false, approachMs = 0, axe = true, sticks = 0, ghost = false, canopy = 67 } = {}) {
    const world = new Map();
    for (const [x, z = 0] of trees) tree(world, x, z, { canopy });
    build?.(world);
    const blockAt = (p) => {
        const q = p.floored ? p.floored() : p;
        const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        const id = reg.blocksByName[name]?.id ?? MODDED[name];
        return { name, metadata: 0, type: id, position: q, boundingBox: name === 'air' ? 'empty' : 'block',
            canHarvest: () => true, transparent: name === 'air', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]] };
    };
    const items = axe ? [{ name: 'stone_axe', metadata: 0, count: 1, type: reg.itemsByName.stone_axe.id }] : [];
    let nextId = 1;
    const entities = {};
    for (const pos of onGround) { const id = nextId++; entities[id] = { id, name: 'item', position: pos, drop: 'stick' }; }
    const log = { digs: [], pickups: [], positions: [], moves: [] };
    const bot = {
        log, world, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: start.offset(0.5, 0, 0.5) },
        entities, heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), add: (i) => items.push(i), slots: [] },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            const here = bot.entity.position;
            return [...world.keys()].map(k => blockAt(at(...k.split(',').map(Number))))
                .filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(here) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))
                .slice(0, count).map(b => b.position);
        },
        blockAt,
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        tool: { equipForBlock: () => Promise.resolve() },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
        dig: (b, _forceLook, faceArg) => {
            const where = bot.entity.position.floored();
            let covered = false;
            for (let y = where.y + 2; y < 75; y++) covered ||= /dynamictrees/.test(world.get(key(at(where.x, y, where.z))) ?? '');
            log.digs.push({ pos: key(b.position), from: key(where), covered, face: faceArg ? key(faceArg) : null, gotosBefore: log.moves.length, held: bot.heldItem?.name ?? null });
            // The whole tree falls: its blocks become one falling entity, and the logs land later.
            // ghost: the client still sees the tree above the cut (round 5 A rerun); only the cut block goes.
            if (ghost) world.delete(key(b.position));
            else for (const [k, name] of [...world]) if (name === BRANCH || name === LEAVES) world.delete(k);
            const fall = { id: nextId++, name: FALLING_TREE, position: b.position.clone() };
            entities[fall.id] = fall;
            setTimeout(() => {
                delete entities[fall.id];
                log.fellAt = Date.now();
                for (const pos of drops ?? [at(b.position.x + 4, 64, 1), at(b.position.x + 5, 64, 0), at(b.position.x + 6, 64, -1)]) {
                    const id = nextId++; entities[id] = { id, name: 'item', position: pos, drop: 'log' };
                }
                for (let i = 0; i < sticks; i++) { // a felled tree also drops sticks with its logs (rotn-data #252)
                    const id = nextId++; entities[id] = { id, name: 'item', position: at(b.position.x + 4 + i, 64, 2), drop: 'stick' };
                }
            }, fallMs);
            return Promise.resolve();
        },
        pathfinder: {
            setMovements(m) { bot._moves = m; }, setGoal() {}, isMoving: () => false,
            stop() { const r = bot._pending; bot._pending = null; r?.(new Error('Path was stopped before it could be completed!')); },
            getPathTo: () => ({ status: 'success', path: [] }),
            goto(goal) {
                log.moves.push(bot._moves?.canDig);
                const target = at(Math.floor(goal.x), Math.floor(goal.y), Math.floor(goal.z));
                if (stuck && goal.constructor?.name === 'GoalBlock') return Promise.resolve(); // it never gets there
                if (approachMs && goal.constructor?.name === 'GoalBlock') { // a long walk to the place
                    return new Promise(resolve => setTimeout(() => {
                        bot.entity.position = at(Math.floor(goal.x), Math.floor(goal.y), Math.floor(goal.z)).offset(0.5, 0, 0.5);
                        resolve();
                    }, approachMs));
                }
                if (unreachable.some(p => p.equals(target))) return new Promise((_, reject) => { bot._pending = reject; });
                bot.entity.position = target.offset(0.5, 0, 0.5);
                log.positions.push({ to: key(target), at: Date.now(), falling: Object.values(entities).some(e => e.name === FALLING_TREE) });
                for (const [id, e] of Object.entries(entities)) {
                    if (e.name === 'item' && e.position.distanceTo(bot.entity.position) <= 1.5) {
                        delete entities[id];
                        log.pickups.push({ at: Date.now(), falling: Object.values(entities).some(x => x.name === FALLING_TREE) });
                        const meta = e.drop === 'log' ? 1 : 0;
                        const got = items.find(i => i.name === e.drop && i.metadata === meta);
                        if (got) got.count++; else items.push({ name: e.drop, metadata: meta, count: 1, type: reg.itemsByName[e.drop].id });
                    }
                }
                return Promise.resolve();
            },
        },
    };
    return bot;
}

function fast(t) {
    t.mock.method(console, 'log', () => {});
    const saved = [{ ...skills.FELL_LIMITS }, { ...skills.TREE_FALL }];
    Object.assign(skills.FELL_LIMITS, FAST_DROPS);
    Object.assign(skills.TREE_FALL, FAST_FALL);
    t.after(() => { Object.assign(skills.FELL_LIMITS, saved[0]); Object.assign(skills.TREE_FALL, saved[1]); });
}

test('rotn-data: a log comes from felling a tree (a Dynamic Trees branch)', () => {
    const fell = worldSources('log').find(s => s.id === 'fell-tree');
    assert.ok(fell, 'the fell-tree rule is a log source');
    assert.ok(fell.blocks.includes('dynamictrees:sprucebranch'));
    // An axe, or by hand: rotn-data #252 (Request 13) found that a branch broken by hand fells the
    // tree and drops its logs and sticks too (tool null). Either way, no other tool type.
    assert.ok(fell.tool === null || fell.tool?.type === 'axe', JSON.stringify(fell.tool));
});

test('round 3 B: the plan: the lowest trunk block, from a high limb too; a place on the side away from the canopy', () => {
    const bot = fakeBot();
    assert.equal(key(treeBase(bot, at(4, 67, 0))), '3,64,0', 'from the limb in the canopy');
    assert.equal(key(treeBase(bot, at(3, 68, 0))), '3,64,0');
    const spots = standSpots(bot, at(3));
    assert.ok(spots.length > 0);
    const best = spots[0];
    assert.ok(best.x < 3, `west of the trunk, away from the east-leaning canopy: ${key(best)}`);
    // Round 5 A: a place under leaves is allowed, but never under a branch, never under leaves on
    // the side the canopy leans to (east), and only after every place under no canopy.
    const above = (s, re) => { for (let y = s.y + 2; y < 75; y++) if (re.test(bot.world.get(key(at(s.x, y, s.z))) ?? '')) return true; return false; };
    let seenCovered = false;
    for (const s of spots) {
        assert.ok(!above(s, /branch/), `${key(s)} is under a branch`);
        const covered = above(s, /dynamictrees/);
        if (covered) assert.ok(s.x <= 3, `${key(s)} is under leaves on the lean side`);
        assert.ok(covered || !seenCovered, `${key(s)}: a place under no canopy comes first`);
        seenCovered ||= covered;
    }
    assert.equal(above(best, /dynamictrees/), false, 'the best place is under no canopy');
});

test('round 3 B: collectBlocks("log") cuts the trunk from outside the canopy, steps back, and collects after the fall', T, async (t) => {
    fast(t);
    for (const start of [at(-2), at(9)]) { // from the open side, and from the canopy side
        const bot = fakeBot({ start });
        assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
        assert.equal(bot.log.digs.length, 1);
        const cut = bot.log.digs[0];
        assert.equal(cut.pos, '3,64,0', 'the lowest trunk block, not a limb');
        assert.equal(cut.covered, false, `not cut from under the canopy (from ${cut.from})`);
        assert.ok(Number(cut.from.split(',')[0]) < 3, `from the side away from the canopy: ${cut.from}`);
        const after = bot.log.positions.find(p => p.at >= 0 && p.to !== cut.from && bot.log.positions.indexOf(p) > bot.log.positions.findIndex(q => q.to === cut.from));
        assert.ok(after && Number(after.to.split(',')[0]) <= Number(cut.from.split(',')[0]) - 3, `stepped back from the trunk at once: ${after?.to}`);
        assert.ok(bot.log.pickups.length >= 3 && bot.log.pickups.every(p => !p.falling), 'no pickup while the tree was falling');
        assert.match(bot.output, /Cut the tree at 3, 64, 0 from -?\d+, 64, -?\d+, away from its canopy; stepping back\./);
        assert.match(bot.output, /Collected 3 log/);
    }
});

test('round 3 B: no safe place (between trunks, under canopies everywhere): the tree is not cut, and not tried again', T, async (t) => {
    fast(t);
    // A grove: trunks 2 apart all around, canopies overlapping; the bot in its middle, so every
    // place within reach of a trunk it tries is next to another trunk.
    const trees = [];
    for (let x = -7; x <= 13; x += 2) for (let z = -8; z <= 8; z += 2) trees.push([x, z]);
    const bot = fakeBot({ start: at(3, 64, 1), trees });
    assert.equal(await skills.collectBlock(bot, 'log', 4), false);
    assert.equal(bot.log.digs.length, 0);
    // Round 5 A: each tree is refused once per collect, not once per block of it found.
    const refusals = bot.output.match(/Not cutting the tree at -?\d+, 64, -?\d+/g) ?? [];
    assert.ok(refusals.length > 0);
    assert.equal(new Set(refusals).size, refusals.length, `a tree refused twice: ${refusals.join('; ')}`);
    assert.match(bot.output, /Not cutting the tree at -?\d+, 64, -?\d+: no place beside it that is under no branch, off the side its canopy leans to and not between trunks./);
});

test('drops: none fell (the wait is bounded), and a drop that cannot be reached', T, async (t) => {
    fast(t);
    const none = fakeBot({ drops: [] });
    assert.equal(await skills.collectBlock(none, 'log', 1), false);
    assert.match(none.output, /Broke the tree at 3, 64, 0: no drops appeared within 1\.5 s\./);
    assert.match(none.output, /Broke dynamictrees:sprucebranch but got no log\./);

    const stuck = fakeBot({ unreachable: [at(7, 64, 1)] }); // the first log's place
    assert.equal(await skills.collectBlock(stuck, 'log', 1), true);
    assert.match(stuck.output, /3 drops within 20 blocks \(3 new\), 1 left behind/);
    assert.match(stuck.output, /Collected 2 log/);
});

test('#222 review: drops already on the ground do not end the wait; it waits for new ones', T, async (t) => {
    fast(t);
    // An old stick lies north of the trunk; the tree's logs land 1 s after the cut (longer than quietMs).
    const bot = fakeBot({ fallMs: 1000, onGround: [at(3, 64, 4)] });
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    assert.match(bot.output, /Felled the tree at 3, 64, 0: 4 drops within 20 blocks \(3 new\), 0 left behind\./);
    assert.match(bot.output, /Collected 3 log/);
});

// #242 review.
test('#242 review 1: a limb with leaves under it is not the trunk; the trunk stands on rooty soil or ground', () => {
    const bot = fakeBot({ build: (w) => { w.set(key(at(4, 66, 0)), LEAVES); } }); // leaves right under the limb at 4, 67, 0
    assert.equal(key(treeBase(bot, at(4, 67, 0))), '3,64,0');
    // a trunk on plain ground (no rooty soil) counts too
    const ground = fakeBot({ build: (w) => { w.delete(key(at(3, 63, 0))); } });
    assert.equal(key(treeBase(ground, at(3, 66, 0))), '3,64,0');
});

test('#242 review 2 and 5: no walk near the tree may dig; the cut is at the cut height or below, on the side face towards the bot', T, async (t) => {
    fast(t);
    const bot = fakeBot();
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    const cut = bot.log.digs[0];
    // every walk of the felling (to the place, and the step back right after the cut) cannot dig
    const fellingWalks = bot.log.moves.slice(0, cut.gotosBefore + 1);
    assert.ok(fellingWalks.length >= 2 && fellingWalks.every(canDig => canDig === false), `canDig per walk: ${fellingWalks}`);
    const from = cut.from.split(',').map(Number), face = cut.face.split(',').map(Number);
    assert.ok(from[1] <= 64, `not above the cut block: ${cut.from}`);
    assert.equal(face[1], 0, 'a side face, not the top');
    assert.ok((from[0] - 3) * face[0] + (from[2] - 0) * face[2] > 0, `the face towards the bot: ${cut.face} from ${cut.from}`);
});

test('#242 nit: no safe place reached: no cut, and a reason', T, async (t) => {
    fast(t);
    const bot = fakeBot({ stuck: true });
    assert.equal(await skills.collectBlock(bot, 'log', 1), false);
    assert.equal(bot.log.digs.length, 0);
    assert.match(bot.output, /Not cutting the tree at 3, 64, 0: could not reach a safe place beside it\./);
});

test('#242 nit: a thick (2x2) trunk: one cut at a trunk base, from a place next to no trunk and under no canopy', T, async (t) => {
    fast(t);
    const thick = (w) => {
        for (const [x, z] of [[4, 0], [3, 1], [4, 1]]) {
            w.set(key(at(x, 63, z)), ROOTY);
            for (let y = 64; y <= 68; y++) w.set(key(at(x, y, z)), BRANCH);
        }
    };
    const bot = fakeBot({ build: thick });
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    assert.equal(bot.log.digs.length, 1);
    const cut = bot.log.digs[0];
    assert.match(cut.pos, /^[34],64,[01]$/, `a trunk base: ${cut.pos}`);
    assert.equal(cut.covered, false);
    const [fx, , fz] = cut.from.split(',').map(Number);
    for (const [x, z] of [[3, 0], [4, 0], [3, 1], [4, 1]]) assert.ok(Math.max(Math.abs(fx - x), Math.abs(fz - z)) > 1, `next to the trunk at ${x}, ${z}: ${cut.from}`);
});

test('#242 nit: on a slope it does not stand on the higher side above the cut; it cuts from the level side', T, async (t) => {
    fast(t);
    // The ground west of x 2 is one block higher (stand at y 65 there): above the cut height.
    const hill = (w) => { for (let x = -6; x <= 1; x++) for (let z = -6; z <= 6; z++) w.set(key(at(x, 64, z)), 'dirt'); };
    const bot = fakeBot({ start: at(0, 65, 0), build: hill });
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    const cut = bot.log.digs[0];
    const [fx, fy] = cut.from.split(',').map(Number);
    assert.ok(fy <= 64 && fx >= 2, `not from the hill: ${cut.from}`);
    assert.equal(cut.covered, false);
});

test('#242 follow-up: the first approach to a tree has the normal walk limit, not a step\'s, and still does not dig', T, async (t) => {
    fast(t);
    const saved = { ...skills.GO_TO_LIMITS };
    t.after(() => Object.assign(skills.GO_TO_LIMITS, saved));
    Object.assign(skills.GO_TO_LIMITS, { stepMs: 150, totalMs: 3000 }); // a step: 0.15 s; a walk: 3 s
    const bot = fakeBot({ start: at(-20), approachMs: 500 }); // the tree is 0.5 s away
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    assert.equal(bot.log.digs.length, 1);
    assert.doesNotMatch(bot.output, /could not reach a safe place/);
    assert.equal(bot.log.moves[0], false, 'the approach cannot dig');
});

test('#252: sticks come from felling, by hand when there is no axe, with an axe when there is one', T, async (t) => {
    fast(t);
    const way = worldSources('stick').find(s => s.id === 'fell-tree');
    assert.ok(way, 'fell-tree gives sticks');
    assert.equal(way.tool, null, 'no tool is required');
    assert.deepEqual(way.preferredTool, { type: 'axe', minLevel: 0 });
    // Request 17 (rotn-data #312): leaves DO give sticks, and leaves reachable from the ground come
    // before felling (collect_sticks.test.js). Here the canopy starts 5 above the ground: out of reach.
    const handOnly = fakeBot({ axe: false, sticks: 3, canopy: 69 });
    assert.equal(await skills.collectBlock(handOnly, 'stick', 2), true, handOnly.output);
    assert.equal(handOnly.log.digs.length, 1);
    assert.equal(handOnly.log.digs[0].held, null, 'by hand');
    assert.doesNotMatch(handOnly.output, /needs an axe/);
    assert.match(handOnly.output, /Collected 3 stick/);

    const withAxe = fakeBot({ sticks: 2, canopy: 69 });
    assert.equal(await skills.collectBlock(withAxe, 'stick', 2), true, withAxe.output);
    assert.equal(withAxe.log.digs[0].held, 'stone_axe', 'the preferred axe');
});

// ---- G3 round 5 batch A: the tree at -62 64 -50 refused six times, 0 sticks ----

/** A grown oak as Dynamic Trees makes it: a 6-block trunk, 4 limbs of 2 at y 68, leaves 4 to 4.5 out all round (over every place in the stand ring). */
function oak(world, x, z = 0) {
    world.set(key(at(x, 63, z)), ROOTY);
    for (let y = 64; y <= 69; y++) world.set(key(at(x, y, z)), BRANCH);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 1; i <= 2; i++) world.set(key(at(x + dx * i, 68, z + dz * i)), BRANCH);
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let y = 67; y <= 71; y++) {
        if (Math.hypot(dx, dz) > 4.6) continue;
        const p = at(x + dx, y, z + dz);
        if (!world.has(key(p))) world.set(key(p), LEAVES);
    }
}

test('round 5 A: a grown oak (leaves over every place in reach) is cut: from under its leaves, never under a limb', T, async (t) => {
    fast(t);
    const bot = fakeBot({ trees: [], build: (w) => oak(w, 3), start: at(-4) });
    const spots = standSpots(bot, at(3));
    assert.ok(spots.length > 0, 'a place beside it (before: none, every place in reach was under its leaves)');
    for (const s of spots) {
        for (let y = s.y + 2; y < 75; y++) assert.ok(!/branch/.test(bot.world.get(key(at(s.x, y, s.z))) ?? ''), `${key(s)} is under a limb`);
    }
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    assert.equal(bot.log.digs.length, 1);
    assert.equal(bot.log.digs[0].pos, '3,64,0');
    const [fx, , fz] = bot.log.digs[0].from.split(',').map(Number);
    const d = Math.hypot(fx - 3, fz);
    assert.ok(d >= 2 && d <= 4.5, `from 2 to 4.5 out: ${bot.log.digs[0].from}`);
    // #268 review 1: the relaxed case is visible in the log and to the death report.
    assert.equal(bot.log.digs[0].covered, true, 'every place is under its leaves');
    assert.match(bot.output, /Cut the tree at 3, 64, 0 from -?\d+, 64, -?\d+, away from its canopy \(from under its leaves\); stepping back\./);
    assert.equal(bot.rotnLastFell.underLeaves, true);
});

/**
 * A bot with no tree in reach holding `held` ([name, meta, count]) and a crafting model of the
 * inventory grid: 2 planks of one kind give 4 sticks; 1 log gives 4 planks of its kind (log:m ->
 * planks:m). bot.crafted lists [item, count] per craft.
 */
function crafter(held, { planksNeedTable = false, build = null, gridLogs = {} } = {}) {
    const bot = fakeBot({ trees: [], axe: false, build });
    for (const [name, metadata, count] of held) bot.inventory.add({ name, metadata, count, type: reg.itemsByName[name].id });
    const stack = (name, meta) => bot.inventory.items().find(i => i.name === name && i.metadata === meta);
    const id = (name) => reg.itemsByName[name].id;
    bot.crafted = [];
    bot.recipesFor = (want, meta, n, table) => {
        // planksNeedTable: as on RotN, logs -> planks only at a table (#270 review 2).
        if (table && !(planksNeedTable && want === id('planks'))) return [];
        if (!table && planksNeedTable && want === id('planks')) {
            // gridLogs: a modded log whose planks recipe is 2x2, no table (rotn-data #278).
            const g = bot.inventory.items().find(i => gridLogs[i.name] && i.count >= 1);
            if (!g) return [];
            const [n, m, c] = gridLogs[g.name];
            return [{ result: { id: id(n), count: c }, out: [n, m, c], use: [[g.name, g.metadata, 1]], inShape: [[{ id: g.type, metadata: g.metadata, count: 1 }]] }];
        }
        const items = bot.inventory.items();
        if (want === id('stick')) {
            const p = items.find(i => i.name === 'planks' && i.count >= 2);
            return p ? [{ result: { id: id('stick'), count: 4 }, out: ['stick', 0, 4], use: [['planks', p.metadata, 2]],
                inShape: [[{ id: id('planks'), metadata: p.metadata, count: 1 }], [{ id: id('planks'), metadata: p.metadata, count: 1 }]] }] : [];
        }
        if (want === id('planks')) {
            const l = items.find(i => i.name === 'log' && i.count >= 1 && (meta == null || i.metadata === meta));
            return l ? [{ result: { id: id('planks'), count: 4 }, out: ['planks', l.metadata, 4], use: [['log', l.metadata, 1]],
                inShape: [[{ id: id('log'), metadata: l.metadata, count: 1 }]] }] : [];
        }
        return [];
    };
    bot.craft = (r, count) => {
        bot.crafted.push([r.out[0], count]);
        for (const [name, meta, n] of r.use) stack(name, meta).count -= n * count;
        const [name, meta, n] = r.out;
        const got = stack(name, meta);
        if (got) got.count += n * count;
        else bot.inventory.add({ name, metadata: meta, count: n * count, type: id(name) });
    };
    bot.armorManager = { equipAll() {} };
    return bot;
}
const held = (bot, name, meta) => bot.inventory.items().filter(i => i.name === name && (meta == null || i.metadata === meta)).reduce((n, i) => n + i.count, 0);

test('round 5 A: sticks short and no tree to fell: the rest are made from held planks (2 planks give 4 sticks)', T, async (t) => {
    fast(t);
    const bot = crafter([['planks', 0, 5]]);
    assert.equal(await skills.collectBlock(bot, 'stick', 6), true, bot.output);
    assert.deepEqual(bot.crafted, [['stick', 2]], 'two crafts for 6 sticks');
    assert.equal(held(bot, 'stick'), 8);
    assert.match(bot.output, /Making the other 6 sticks from planks/);
    assert.match(bot.output, /Collected 8 stick, 8 of them made from planks\./);

    const none = crafter([['planks', 0, 1]]); // one plank: not enough for a craft, so no craft is tried
    assert.equal(await skills.collectBlock(none, 'stick', 4), false);
    assert.deepEqual(none.crafted, []);
    assert.match(none.output, /Collected 0 stick\./);
});

test('#268 follow-up 3: planks are counted per kind: a mixed pair makes no stick, a pair of one kind does', T, async (t) => {
    fast(t);
    const mixed = crafter([['planks', 0, 1], ['planks', 1, 1]]); // oak + spruce: 2 planks, no pair
    assert.equal(skills.stickCraftsHeld(mixed), 0);
    assert.equal(await skills.collectBlock(mixed, 'stick', 4), false);
    assert.deepEqual(mixed.crafted, [], 'no craft tried for a mixed pair');
    assert.doesNotMatch(mixed.output, /Making the other/);

    const some = crafter([['planks', 0, 1], ['planks', 1, 3]]); // a spruce pair
    assert.equal(skills.stickCraftsHeld(some), 1);
    assert.equal(await skills.collectBlock(some, 'stick', 8), true, some.output);
    assert.deepEqual(some.crafted, [['stick', 1]], 'one craft: the only pair, not the 2 the count asks for');
    assert.equal(held(some, 'planks', 1), 1);
    assert.equal(held(some, 'planks', 0), 1);
});

test('#268 follow-up 2: no pair of planks but logs held: logs into planks first, then sticks', T, async (t) => {
    fast(t);
    const bot = crafter([['log', 1, 2], ['planks', 0, 1], ['crafting_table', 0, 1]]); // a table to place (round 5 A rerun)
    assert.equal(await skills.collectBlock(bot, 'stick', 4), true, bot.output);
    assert.deepEqual(bot.crafted, [['planks', 1], ['stick', 1]], 'one log into planks, then one stick craft');
    assert.equal(held(bot, 'stick'), 4);
    assert.equal(held(bot, 'log', 1), 1, 'only the logs needed');
    assert.equal(held(bot, 'planks', 1), 2);
    assert.match(bot.output, /Making planks from logs for sticks\./);
    assert.match(bot.output, /Collected 4 stick, 4 of them made from planks\./);

    const bare = crafter([]); // nothing to craft from
    assert.equal(await skills.collectBlock(bare, 'stick', 4), false);
    assert.deepEqual(bare.crafted, []);

    // Round 5 A rerun: logs but no table near or held: no craft tried ("Crafting planks requires a
    // crafting table" before), and the reason, with the sticks that need no table.
    const noTable = crafter([['log', 1, 25]]);
    assert.equal(await skills.collectBlock(noTable, 'stick', 4), false);
    assert.deepEqual(noTable.crafted, []);
    assert.match(noTable.output, /Not making planks: in RotN most logs \(all vanilla ones\) become planks only at a crafting table, and there is none near or held, and you hold no axe to chop them.* River Cane or bamboo \(picked by hand\) work as sticks/);
});

test('rotn-data #278: a log whose planks need no table (a Pam maple log) makes planks in the 2x2 grid, then sticks; no table, no axe', T, async (t) => {
    fast(t);
    const MAPLE = 'harvestcraft:pammaple';
    const saved = [reg.items, reg.itemsByName];
    t.after(() => { [reg.items, reg.itemsByName] = saved; });
    reg.items = { ...saved[0], 9001: { id: 9001, name: MAPLE, displayName: 'Maple Log', stackSize: 64 } };
    reg.itemsByName = { ...saved[1], [MAPLE]: reg.items[9001] };
    const bot = crafter([[MAPLE, 0, 1]], { planksNeedTable: true, gridLogs: { [MAPLE]: ['planks', 1, 4] } });
    assert.equal(await skills.collectBlock(bot, 'stick', 4), true, bot.output);
    assert.deepEqual(bot.crafted, [['planks', 1], ['stick', 1]]);
    assert.match(bot.output, /Making planks from your logs in the 2x2 grid \(these logs need no crafting table\)\./);
    assert.doesNotMatch(bot.output, /Not making planks/);
    assert.equal(held(bot, 'stick'), 4);
    assert.equal(held(bot, 'planks', 1), 2, 'planks left, one of them for the table');
});

test('rotn-data #278: by its recipes, a held mangrove, maple or End log has grid planks; a vanilla log or planks alone do not', () => {
    const inv = (name, metadata) => ({ inventory: { items: () => [{ name, metadata, count: 4 }] } });
    assert.equal(skills.gridPlanksReady(inv('biomesoplenty:log_1', 6)), 'biomesoplenty:planks_0:6');
    assert.equal(skills.gridPlanksReady(inv('harvestcraft:pammaple', 0)), 'planks');
    assert.equal(skills.gridPlanksReady(inv('stygian:endlog', 0)), 'stygian:endplanks');
    assert.equal(skills.gridPlanksReady(inv('log', 1)), null, 'vanilla logs need a table');
    assert.equal(skills.gridPlanksReady(inv('planks', 0)), null, 'planks are never made into other planks');
});

// ---- G3 round 5 A rerun: late, far drops; one tree cut 4 times; "its trunk is not in sight" ----

test('round 5 A rerun: the drop wait is longer and bounded, and reaches as far as a tall tree falls', () => {
    const L = skills.FELL_LIMITS;
    assert.ok(L.radius >= 20, `radius ${L.radius}`);
    assert.ok(L.settleMs >= 15_000, `settle ${L.settleMs}`);
    assert.ok(L.totalMs <= 60_000 && L.totalMs > L.settleMs, `bounded: ${L.totalMs}`);
    assert.ok(L.pickupMs > 0);
});

test('round 5 A rerun: drops that land 15 blocks out are picked up, and the gain is counted after the pickup', T, async (t) => {
    fast(t);
    const bot = fakeBot({ drops: [at(18, 64, 0), at(18, 64, 1)] }); // 15 out from the trunk at x 3
    assert.equal(await skills.collectBlock(bot, 'log', 2), true, bot.output);
    assert.match(bot.output, /Felled the tree at 3, 64, 0: 2 drops within 20 blocks \(2 new\), 0 left behind\./);
    assert.match(bot.output, /Collected 2 log/);
});

test('round 5 A rerun: a felled tree the bot still sees is never cut again; its leftover blocks are one "not in sight"', T, async (t) => {
    fast(t);
    const bot = fakeBot({ ghost: true });
    await skills.collectBlock(bot, 'log', 3);
    assert.equal(bot.log.digs.length, 1, 'one cut, though the trunk above it is still seen');
    assert.doesNotMatch(bot.output, /trunk is not in sight/, 'its blocks are skipped for this collect');
    // The next collect: the leftover trunk (no ground under it) is one refusal, not one per block.
    bot.output = '';
    await skills.collectBlock(bot, 'log', 3);
    assert.equal(bot.log.digs.length, 1);
    assert.equal((bot.output.match(/its trunk is not in sight/g) ?? []).length, 1, bot.output);
});

test('round 5 A rerun: a felled tree that gave logs but no stick says what it gave, and that sticks are rare', T, async (t) => {
    fast(t);
    const bot = fakeBot({ sticks: 0, canopy: 69 }); // leaves out of reach from the ground (Request 17)
    assert.equal(await skills.collectBlock(bot, 'stick', 1), false);
    assert.match(bot.output, /Broke dynamictrees:sprucebranch but got no stick \(it gave 3 log:1\)\. A felled tree drops few sticks, often none\./);
});

test('round 5 A rerun: wood is never targeted underground: collectBlocks and searchForBlock pick the surface tree', T, async (t) => {
    fast(t);
    const buried = (w) => { w.set(key(at(-2, 60, 0)), 'log'); w.set(key(at(-3, 60, 0)), 'log'); }; // 4 below the bot, in dirt
    const bot = fakeBot({ build: buried });
    assert.equal(world.isUnderground(bot, at(-2, 60, 0)), true);
    assert.equal(world.isUnderground(bot, at(3, 64, 0)), false, 'a trunk under its own canopy is on the surface');
    // #274 nit: "wood" only as a whole name part: a wooden slab roof is not tree cover.
    const roofed = fakeBot({ trees: [], build: (w) => { w.set(key(at(-6, 64, 0)), 'log'); w.set(key(at(-6, 67, 0)), 'wooden_slab'); } });
    assert.equal(world.isUnderground(roofed, at(-6, 64, 0)), true, 'a log under a wooden slab roof');
    for (const name of ['log2', 'biomesoplenty:log_0', 'twilightforest:twilight_log', 'dynamictrees:oakbranch', 'leaves']) assert.ok(world.TREE_COVER.test(name), name);
    for (const name of ['wooden_slab', 'planks', 'driftwood', 'betterwithmods:wood_siding']) assert.ok(!world.TREE_COVER.test(name), name);
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    assert.equal(bot.log.digs.length, 1);
    assert.equal(bot.log.digs[0].pos, '3,64,0', 'the surface tree, not the nearer buried log');

    const search = fakeBot({ build: buried });
    assert.equal(await skills.goToNearestBlock(search, 'log', 4, 64), true, search.output);
    assert.match(search.output, /Found log at \(3, (6[4-9]|7\d), -?\d+\)/, 'a block of the surface tree');
    assert.doesNotMatch(search.output, /, 60, /);

    const none = fakeBot({ trees: [], build: buried });
    assert.equal(await skills.goToNearestBlock(none, 'log', 4, 64), false);
    assert.match(none.output, /Could not find any log on the surface in 64 blocks \(logs underground are left alone\)\./);
});

test('#270 review 2: planks need a table (as on RotN) and none is near or held: one clear reason, no craft, 0 sticks, no repeat', T, async (t) => {
    fast(t);
    const bot = crafter([['log', 1, 25]], { planksNeedTable: true });
    assert.equal(await skills.collectBlock(bot, 'stick', 4), false);
    assert.deepEqual(bot.crafted, []);
    assert.equal((bot.output.match(/Not making planks: in RotN most logs \(all vanilla ones\) become planks only at a crafting table, and there is none near or held, and you hold no axe to chop them \(place a log or plank and use the axe on it\)\. Get a crude axe or a table first/g) ?? []).length, 1, bot.output);
    assert.doesNotMatch(bot.output, /Making planks from logs|requires a crafting table/);
    assert.match(bot.output, /Collected 0 stick\./);
    assert.equal(held(bot, 'log', 1), 25);
});

test('#270 review 2: planks need a table and one stands near: planks at the table, then sticks', T, async (t) => {
    fast(t);
    const bot = crafter([['log', 1, 2]], { planksNeedTable: true, build: (w) => w.set(key(at(-1, 64, 0)), 'crafting_table') });
    assert.equal(await skills.collectBlock(bot, 'stick', 4), true, bot.output);
    assert.deepEqual(bot.crafted, [['planks', 1], ['stick', 1]]);
    assert.match(bot.output, /Collected 4 stick, 4 of them made from planks\./);
});

test('#270 review 3: a cut from under vanilla leaves counts as from under leaves', T, async (t) => {
    fast(t);
    // Vanilla leaves over the ground west of the trunk, where the place to stand is.
    const vanilla = (w) => { for (let x = -2; x <= 2; x++) for (let z = -4; z <= 4; z++) for (let y = 68; y <= 69; y++) if (!w.has(key(at(x, y, z)))) w.set(key(at(x, y, z)), 'leaves'); };
    const bot = fakeBot({ build: vanilla });
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    assert.ok(Number(bot.log.digs[0].from.split(',')[0]) <= 2, `from the west: ${bot.log.digs[0].from}`);
    assert.match(bot.output, /away from its canopy \(from under its leaves\); stepping back\./);
    assert.equal(bot.rotnLastFell.underLeaves, true);
});

// G3 round 10 A: the bot waited out its own cut; a tree still fell more than 15 s after it, and the
// unstuck reflex (20 s in one place) walked the bot into the fall: "crushed by a falling tree".
// Scaled down: the fall lasts longer than the fall wait plus the drop wait.
test('round 10 A: the bot stands still on purpose (rotnStationary) until the fall is over, and walks to no drop while the tree falls', T, async (t) => {
    assert.ok(skills.TREE_FALL.maxMs >= 30_000, `the fall wait: ${skills.TREE_FALL.maxMs} ms`);
    fast(t);
    // An old drop lies near the tree, so the walks could start before the logs land.
    const bot = fakeBot({ fallMs: 5000, onGround: [at(1, 64, 3)] });
    const samples = [];
    const timer = setInterval(() => samples.push({
        stationary: bot.rotnStationary === true,
        falling: Object.values(bot.entities).some(e => e.name === FALLING_TREE),
    }), 100);
    try {
        assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    } finally {
        clearInterval(timer);
    }
    assert.equal(bot.log.digs.length, 1);
    const whileFalling = samples.filter(s => s.falling);
    assert.ok(whileFalling.length >= 30, `the fall was sampled: ${whileFalling.length}`);
    assert.ok(whileFalling.every(s => s.stationary), 'rotnStationary for the whole fall');
    assert.notEqual(bot.rotnStationary, true, 'released after the fell');
    // The step back right after the cut is the one move allowed while it falls.
    const walksWhileFalling = bot.log.positions.filter(p => p.falling);
    assert.ok(walksWhileFalling.length <= 1, `walks while the tree fell: ${JSON.stringify(walksWhileFalling)}`);
    assert.ok(bot.log.pickups.every(p => !p.falling), 'no pickup while the tree was falling');
});
