// Offline tests for fall safety (G3 round 4 batch B: "FRCFLD fell from a high place" during
// !collectBlocks("stick", 4) on leaves, 3 s after the unstuck reflex took over). Leaves only from
// the ground, never a climb, a tower or a dig into the tree; a bot on a tree climbs down; no walk
// drops more than 3 blocks or breaks a Dynamic Trees branch (that fells the tree); drops lying on
// leaves are left. A fake world (dirt below y 64) on the 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import {
    MAX_SAFE_DROP, PATHFINDER_MAX_DROP_DOWN, fallSafe, treeSafe, standsOnTree, leafFromGround, itemOnGround, isTreePart,
} from './fall_safety.js';
import { ROTN_EARLY_GAME } from '../agenda.js';
import { moveAwayWithin } from '../modes.js';
import * as skills from './skills.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName } };
const MODDED = { 'dynamictrees:oakbranch': 4400, 'dynamictrees:leaves0': 4401, 'dynamictrees:rootydirt': 4402 };
for (const [name, id] of Object.entries(MODDED)) { reg.blocks[id] = { id, name }; reg.blocksByName[name] = reg.blocks[id]; }
__setRegistryForTest(reg);

const BRANCH = 'dynamictrees:oakbranch', LEAVES = 'dynamictrees:leaves0';
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const key = (p) => `${p.x},${p.y},${p.z}`;

/**
 * A bot in a fake world: dirt below y 64, air above, plus `blocks` ({ "x,y,z": name }). The
 * pathfinder records every movements object it is given; goto moves the bot to `arrive(goal)`
 * (default: stays), so a test decides where a walk ends.
 */
function fakeBot({ blocks = {}, start = at(0), arrive = null, items = [], entities = {} } = {}) {
    const world = new Map(Object.entries(blocks));
    const blockAt = (p) => {
        const q = p.floored ? p.floored() : new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        const id = reg.blocksByName[name]?.id ?? MODDED[name];
        return { name, metadata: 0, type: id, position: q, boundingBox: name === 'air' ? 'empty' : 'block',
            canHarvest: () => true, transparent: name === 'air', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]] };
    };
    const calls = { moves: [], paths: [], gotos: [], digs: [], collected: [] };
    const bot = {
        calls, world, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival', minY: 0 },
        entity: { position: start.offset(0.5, 0, 0.5), eyeHeight: 1.62, height: 1.8 },
        entities, heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items, slots: [] },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            const here = bot.entity.position;
            return [...world.keys()].map(k => blockAt(at(...k.split(',').map(Number))))
                .filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(here) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))
                .slice(0, count).map(b => b.position);
        },
        blockAt,
        equip: () => Promise.resolve(),
        tool: { equipForBlock: () => Promise.resolve() },
        lookAt: () => Promise.resolve(),
        nearestEntity: (match) => Object.values(bot.entities).filter(match)
            .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null,
        dig: (b) => { calls.digs.push(key(b.position)); world.set(key(b.position), 'air'); return Promise.resolve(); },
        collectBlock: { collect: (b) => { calls.collected.push(key(b.position)); return Promise.resolve(); } },
        pathfinder: {
            setMovements(m) { bot._moves = m; calls.moves.push(m); }, setGoal() {}, stop() {}, isMoving: () => false,
            getPathTo(m, goal) { calls.paths.push(m); return { status: 'success', path: [] }; },
            goto(goal) {
                calls.gotos.push({ goal, moves: bot._moves });
                const to = arrive?.(goal, bot);
                if (to) bot.entity.position = to.offset(0.5, 0, 0.5);
                return Promise.resolve();
            },
        },
    };
    return bot;
}

test('the predicates: leaves within reach from the ground, the bot on a tree, an item on the ground', () => {
    const bot = fakeBot({ blocks: {
        '1,64,0': LEAVES,                     // right on the ground
        '2,67,0': LEAVES,                     // 3 air blocks above the ground: still in reach
        '3,68,0': LEAVES,                     // 4 above: the canopy, out of reach
        '4,64,0': LEAVES, '4,65,0': LEAVES,   // the upper one sits on leaves
        '5,66,0': BRANCH, '5,67,0': LEAVES,   // on a branch
        '6,64,0': 'leaves',                   // vanilla leaves count too
    } });
    const leaf = (x, y) => bot.blockAt(at(x, y));
    assert.equal(leafFromGround(bot, leaf(1, 64)), true);
    assert.equal(leafFromGround(bot, leaf(2, 67)), true);
    assert.equal(leafFromGround(bot, leaf(3, 68)), false, 'the canopy needs a climb');
    assert.equal(leafFromGround(bot, leaf(4, 65)), false, 'leaves above leaves');
    assert.equal(leafFromGround(bot, leaf(5, 67)), false, 'leaves above a branch');
    assert.equal(isTreePart(leaf(6, 64)), true);
    assert.equal(isTreePart(bot.blockAt(at(0, 63))), false, 'dirt is ground');

    assert.equal(standsOnTree(bot), false, 'on dirt');
    bot.entity.position = at(4, 66).offset(0.5, 0, 0.5);
    assert.equal(standsOnTree(bot), true, 'on leaves');
    bot.entity.position = at(5, 67).offset(0.3, 0, 0.5);
    bot.world.set('5,67,0', 'air');
    assert.equal(standsOnTree(bot), true, 'on a branch');

    assert.equal(itemOnGround(bot, { position: new Vec3(0.5, 64.0, 0.5) }), true, 'on dirt');
    assert.equal(itemOnGround(bot, { position: new Vec3(4.5, 66.0, 0.5) }), false, 'on leaves');
    assert.equal(itemOnGround(bot, { position: new Vec3(9.5, 70.2, 0.5) }), false, 'high in the air');
});

test('fallSafe: no drop over 3 blocks and never a broken branch; treeSafe also no dig, tower, parkour or step above a tree', () => {
    const bot = fakeBot({ blocks: { '2,64,0': LEAVES } });
    const m = fallSafe(new pf.Movements(bot));
    assert.equal(m.maxDropDown, PATHFINDER_MAX_DROP_DOWN);
    assert.deepEqual([MAX_SAFE_DROP, PATHFINDER_MAX_DROP_DOWN], [3, 4]);
    assert.equal(m.safeToBreak(bot.blockAt(at(1, 64)).name === 'air' ? { ...bot.blockAt(at(1, 64)), name: BRANCH, type: MODDED[BRANCH] } : null), false, 'a branch is never broken');
    assert.equal(m.safeToBreak(bot.blockAt(at(2, 64))), true, 'leaves may be');
    fallSafe(m);
    assert.equal(m.exclusionAreasBreak.length, 1, 'once');
    const t = treeSafe(bot, new pf.Movements(bot));
    assert.deepEqual([t.maxDropDown, t.canDig, t.allow1by1towers, t.allowParkour, t.scafoldingBlocks.length], [4, false, false, false, 0]);
    assert.ok(t.exclusionStep(bot.blockAt(at(2, 65))) >= 100, 'a step onto leaves');
    assert.equal(t.exclusionStep(bot.blockAt(at(1, 64))), 0, 'a step on dirt');
});

test('#256 review 3: in pathfinder 2.4.5 a fall-safe walk may fall 3 blocks (no damage), not 4', () => {
    // The bot stands at y 67 on a ledge (dirt at y 66); east of it the ground is lower.
    const at3 = fakeBot({ blocks: { '0,66,0': 'dirt', '0,65,0': 'dirt', '0,64,0': 'dirt' } });
    const node = { x: 0, y: 67, z: 0, remainingBlocks: 0 };
    const east = { x: 1, z: 0 };
    // East: air down to y 64, dirt at y 63 (the world's ground): landing at feet y 64, a fall of 3.
    const m = fallSafe(new pf.Movements(at3));
    const land = m.getLandingBlock(node, east);
    assert.ok(land, 'a fall of 3 is allowed');
    assert.equal(land.position.y, 64, 'it stands at y 64: 67 - 64 = 3 blocks');
    // The same with the ground one lower (air at y 63): a fall of 4 is refused.
    const at4 = fakeBot({ blocks: { '0,66,0': 'dirt', '0,65,0': 'dirt', '0,64,0': 'dirt', '1,63,0': 'air' } });
    assert.equal(fallSafe(new pf.Movements(at4)).getLandingBlock(node, east), null, 'a fall of 4 is not');
    // The old setting (maxDropDown 3) refused the harmless fall of 3.
    const old = new pf.Movements(at3);
    old.maxDropDown = 3;
    assert.equal(old.getLandingBlock(node, east), null);
});

test('every goToGoal walk is fall-safe; canDig false never digs (pickups used to get digging movements)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot();
    await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1));
    assert.ok(bot.calls.paths.length > 0);
    for (const m of [...bot.calls.paths, ...bot.calls.moves]) {
        assert.equal(m.maxDropDown, 4);
        assert.ok(m.exclusionBreak({ name: BRANCH, type: MODDED[BRANCH] }) >= 100, 'no branch broken');
    }
    const quiet = fakeBot();
    quiet.pathfinder.getPathTo = (m) => { quiet.calls.paths.push(m); return { status: 'noPath', path: [] }; };
    await skills.goToGoal(quiet, new pf.goals.GoalNear(5, 64, 0, 1), { canDig: false });
    assert.ok([...quiet.calls.paths, ...quiet.calls.moves].every(m => m.canDig === false), 'no digging fallback');
});

test('unstuck: on a tree it climbs down (no drop over 3); on the ground its walk away is fall-safe', async (t) => {
    t.mock.method(console, 'log', () => {});
    const blocks = { '3,64,0': LEAVES, '3,65,0': LEAVES, '3,66,0': BRANCH };
    const treeBot = fakeBot({ blocks, start: at(3, 67), arrive: (goal) => {
        assert.equal(goal.isEnd(at(3, 67)), false, 'still on the tree is not the end');
        assert.equal(goal.isEnd(at(5, 64)), true, 'firm ground is');
        return at(5, 64);
    } });
    assert.equal(standsOnTree(treeBot), true);
    const r = await moveAwayWithin(treeBot, 5, 2000);
    assert.equal(r.outcome, 'freed');
    const m = treeBot.calls.gotos[0].moves;
    assert.deepEqual([m.maxDropDown, m.allow1by1towers, m.allowParkour], [4, false, false]);
    assert.ok(m.exclusionBreak({ name: BRANCH, type: MODDED[BRANCH] }) >= 100);
    assert.match(treeBot.output, /climbing down to the ground/);

    const stuckUp = fakeBot({ blocks, start: at(3, 67) }); // no way down: it stays
    assert.equal((await moveAwayWithin(stuckUp, 5, 2000)).outcome, 'failed');
    assert.match(stuckUp.output, /no safe way down/);

    const ground = fakeBot({ arrive: () => at(6, 64) });
    assert.equal((await moveAwayWithin(ground, 5, 2000)).outcome, 'freed');
    assert.ok(ground.calls.moves.length > 0 && ground.calls.moves.every(mv => mv.maxDropDown === 4), 'the walk away falls at most 3');
});

test('leaves only from the ground: the canopy is skipped; a low leaf is broken from a ground walk that never digs or towers', async (t) => {
    t.mock.method(console, 'log', () => {});
    // Only canopy leaves (4 and more above the ground): nothing to do, no climb.
    const high = fakeBot({ blocks: { '2,68,0': LEAVES, '2,69,0': LEAVES } });
    assert.equal(await skills.collectBlock(high, LEAVES, 1), false);
    assert.deepEqual([high.calls.digs, high.calls.collected, high.calls.gotos], [[], [], []]);
    assert.match(high.output, /No dynamictrees:leaves0 nearby/);

    // A canopy leaf nearer than a low one: the low one is taken, from the ground.
    const bot = fakeBot({ blocks: { '1,68,0': LEAVES, '6,65,0': LEAVES }, arrive: () => at(5, 64) });
    assert.equal(await skills.collectBlock(bot, LEAVES, 1), true);
    assert.deepEqual(bot.calls.digs, ['6,65,0']);
    assert.deepEqual(bot.calls.collected, [], 'not mineflayer-collectblock (it digs, towers and climbs)');
    const m = bot.calls.gotos[0].moves;
    assert.deepEqual([m.canDig, m.allow1by1towers, m.allowParkour, m.maxDropDown], [false, false, false, 4]);

    // The walk did not get within reach: skipped, not broken from afar.
    const far = fakeBot({ blocks: { '9,64,0': LEAVES } });
    assert.equal(await skills.collectBlock(far, LEAVES, 1), false);
    assert.deepEqual(far.calls.digs, []);
    assert.match(far.output, /Could not reach dynamictrees:leaves0 at 9, 64, 0 from the ground/);
});

test('a collect that starts on a tree climbs down first, or does nothing when there is no safe way down', async (t) => {
    t.mock.method(console, 'log', () => {});
    const blocks = { '0,64,0': LEAVES, '0,65,0': LEAVES, '0,66,0': LEAVES, '4,64,0': LEAVES };
    const bot = fakeBot({ blocks, start: at(0, 67), arrive: (goal) => (goal.isEnd?.(at(3, 64)) ? at(3, 64) : null) });
    assert.equal(await skills.collectBlock(bot, LEAVES, 1), true);
    assert.equal(bot.calls.gotos[0].moves.maxDropDown, 4, 'down first');
    assert.deepEqual(bot.calls.digs, ['4,64,0']);

    const stuck = fakeBot({ blocks, start: at(0, 67) });
    assert.equal(await skills.collectBlock(stuck, LEAVES, 1), false);
    assert.deepEqual(stuck.calls.digs, []);
    assert.match(stuck.output, /up on a tree and found no safe way down/);
});

test('pickups: a drop on leaves is left; one on the ground is fetched without digging', async (t) => {
    t.mock.method(console, 'log', () => {});
    const entities = {
        1: { id: 1, name: 'item', position: new Vec3(2.5, 66.0, 0.5) },  // on the leaves at 2,65
        2: { id: 2, name: 'item', position: new Vec3(4.5, 64.0, 0.5) },  // on the dirt
    };
    const bot = fakeBot({ blocks: { '2,64,0': LEAVES, '2,65,0': LEAVES }, entities, arrive: (goal, b) => {
        delete b.entities[goal.entity?.id]; return null; // picked up
    } });
    await skills.pickupNearbyItems(bot);
    assert.deepEqual(bot.calls.gotos.map(g => g.goal.entity.id), [2], 'only the drop on the ground');
    assert.ok([...bot.calls.paths, ...bot.calls.moves].every(m => m.canDig === false), 'no digging on the way');
    assert.ok(bot.entities[1], 'the one on the leaves is still there');
});

test('a Dynamic Trees branch is always cut the safe way (fellTree), whichever rule asked for it', async (t) => {
    t.mock.method(console, 'log', () => {});
    // A lone branch with no trunk in sight: fellTree refuses; collect() must never get it.
    const bot = fakeBot({ blocks: { '3,66,0': BRANCH } });
    await skills.collectBlock(bot, BRANCH, 1);
    assert.deepEqual(bot.calls.collected, []);
    assert.match(bot.output, /Not cutting the tree/);
});

test('the sticks step: felling, not leaves (rotn-data Request 13: leaves never drop sticks)', () => {
    const sticks = ROTN_EARLY_GAME.find(s => s.id === 'sticks');
    assert.match(sticks.goal, /!collectBlocks\("stick", 4\)/);
    assert.match(sticks.goal, /felling a tree/);
    assert.match(sticks.goal, /Leaves drop no sticks/);
    assert.match(sticks.goal, /!craftRecipe\("stick", 1\) makes 4 sticks from 2 planks/, 'or from planks (rotn-data #252: the planks recipe is kept)');
    assert.doesNotMatch(sticks.goal, /drop from leaves|punching trees does not work/);
});
