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
function tree(world, x, z = 0, { lean = 1 } = {}) {
    world.set(key(at(x, 63, z)), ROOTY);
    for (let y = 64; y <= 68; y++) world.set(key(at(x, y, z)), BRANCH);
    world.set(key(at(x + lean, 67, z)), BRANCH); // a limb
    for (let dx = -1; dx <= 3; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 67; y <= 70; y++) {
        const p = at(x + dx * lean, y, z + dz);
        if (!world.has(key(p))) world.set(key(p), LEAVES);
    }
}

/**
 * The bot and its world. A cut trunk turns the whole tree into a falling tree entity for fallMs;
 * then its logs lie where it landed (log:1 each), east of the trunk (the canopy side).
 */
function fakeBot({ start = at(-2), fallMs = 600, trees = [[3]], drops = null, unreachable = [], onGround = [], build = null, stuck = false, approachMs = 0, axe = true, sticks = 0, planks = 0 } = {}) {
    const world = new Map();
    for (const [x, z = 0] of trees) tree(world, x, z);
    build?.(world);
    const blockAt = (p) => {
        const q = p.floored ? p.floored() : p;
        const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        const id = reg.blocksByName[name]?.id ?? MODDED[name];
        return { name, metadata: 0, type: id, position: q, boundingBox: name === 'air' ? 'empty' : 'block',
            canHarvest: () => true, transparent: name === 'air', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]] };
    };
    const items = axe ? [{ name: 'stone_axe', metadata: 0, count: 1, type: reg.itemsByName.stone_axe.id }] : [];
    if (planks) items.push({ name: 'planks', metadata: 0, count: planks, type: reg.itemsByName.planks.id });
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
            for (const [k, name] of [...world]) if (name === BRANCH || name === LEAVES) world.delete(k);
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
    assert.match(stuck.output, /3 drops within 12 blocks \(3 new\), 1 left behind/);
    assert.match(stuck.output, /Collected 2 log/);
});

test('#222 review: drops already on the ground do not end the wait; it waits for new ones', T, async (t) => {
    fast(t);
    // An old stick lies north of the trunk; the tree's logs land 1 s after the cut (longer than quietMs).
    const bot = fakeBot({ fallMs: 1000, onGround: [at(3, 64, 4)] });
    assert.equal(await skills.collectBlock(bot, 'log', 1), true, bot.output);
    assert.match(bot.output, /Felled the tree at 3, 64, 0: 4 drops within 12 blocks \(3 new\), 0 left behind\./);
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
    assert.ok(!worldSources('stick').some(s => s.blocks.some(b => /leaves/.test(b))), 'leaves are no stick source');

    const handOnly = fakeBot({ axe: false, sticks: 3 });
    assert.equal(await skills.collectBlock(handOnly, 'stick', 2), true, handOnly.output);
    assert.equal(handOnly.log.digs.length, 1);
    assert.equal(handOnly.log.digs[0].held, null, 'by hand');
    assert.doesNotMatch(handOnly.output, /needs an axe/);
    assert.match(handOnly.output, /Collected 3 stick/);

    const withAxe = fakeBot({ sticks: 2 });
    assert.equal(await skills.collectBlock(withAxe, 'stick', 2), true, withAxe.output);
    assert.equal(withAxe.log.digs[0].held, 'stone_axe', 'the preferred axe');
});

// ---- G3 round 5 batch A: the tree at -62 64 -50 refused six times, 0 sticks ----

/** A grown oak as Dynamic Trees makes it: a 6-block trunk, 4 limbs of 2 at y 68, leaves 4 out all round. */
function oak(world, x, z = 0) {
    world.set(key(at(x, 63, z)), ROOTY);
    for (let y = 64; y <= 69; y++) world.set(key(at(x, y, z)), BRANCH);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 1; i <= 2; i++) world.set(key(at(x + dx * i, 68, z + dz * i)), BRANCH);
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let y = 67; y <= 71; y++) {
        if (Math.hypot(dx, dz) > 4.3) continue;
        const p = at(x + dx, y, z + dz);
        if (!world.has(key(p))) world.set(key(p), LEAVES);
    }
}

test('round 5 A: a grown oak (leaves 4 out all round) is cut: from under its leaves, never under a limb', T, async (t) => {
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
});

test('round 5 A: sticks short and no tree to fell: the rest are made from held planks (2 planks give 4 sticks)', T, async (t) => {
    fast(t);
    const make = (planks) => {
        const bot = fakeBot({ trees: [], axe: false, planks });
        const plank = () => bot.inventory.items().find(i => i.name === 'planks');
        const recipe = { result: { id: reg.itemsByName.stick.id, count: 4 },
            inShape: [[{ id: reg.itemsByName.planks.id, metadata: 0, count: 1 }], [{ id: reg.itemsByName.planks.id, metadata: 0, count: 1 }]] };
        bot.crafted = [];
        bot.recipesFor = (id, meta, n, table) => (id === reg.itemsByName.stick.id && !table && (plank()?.count ?? 0) >= 2 ? [recipe] : []);
        bot.craft = (r, count) => {
            bot.crafted.push(count);
            plank().count -= 2 * count;
            const items = bot.inventory.items();
            const stick = items.find(i => i.name === 'stick');
            if (stick) stick.count += 4 * count;
            else bot.inventory.add({ name: 'stick', metadata: 0, count: 4 * count, type: reg.itemsByName.stick.id });
        };
        bot.armorManager = { equipAll() {} };
        return bot;
    };
    const bot = make(5);
    assert.equal(await skills.collectBlock(bot, 'stick', 6), true, bot.output);
    assert.deepEqual(bot.crafted, [2], 'two crafts for 6 sticks');
    assert.equal(bot.inventory.items().find(i => i.name === 'stick')?.count, 8);
    assert.match(bot.output, /Making the other 6 sticks from planks/);
    assert.match(bot.output, /Collected 8 stick, 8 of them made from planks\./);

    const none = make(1); // one plank: not enough for a craft, so no craft is tried
    assert.equal(await skills.collectBlock(none, 'stick', 4), false);
    assert.deepEqual(none.crafted, []);
    assert.match(none.output, /Collected 0 stick\./);
});
