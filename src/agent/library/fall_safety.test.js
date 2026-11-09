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
    isLiquid, hazardOf, isLethal, isFirmGround, installWalkSafety,
    MAX_SAFE_DROP, PATHFINDER_MAX_DROP_DOWN, fallSafe, treeSafe, standsOnTree, leafFromGround, itemOnGround, isTreePart,
} from './fall_safety.js';
import { ROTN_EARLY_GAME } from '../agenda.js';
import { moveAwayWithin } from '../modes.js';
import * as skills from './skills.js';
import * as world from './world.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName }, blocksByStateId: { ...vanilla.blocksByStateId } };
const MODDED = { 'dynamictrees:oakbranch': 4400, 'dynamictrees:leaves0': 4401, 'dynamictrees:rootydirt': 4402, 'dynamictrees:trunkshell': 4403 };
// diggable, as forge-bridge's extendRegistry makes modded blocks (else the pathfinder never digs them).
for (const [name, id] of Object.entries(MODDED)) { reg.blocks[id] = { id, name, diggable: true }; reg.blocksByName[name] = reg.blocks[id]; }
// #259: what forge-bridge's applyCollisionShapes puts on modded entries. Molten tin: a liquid that
// is lethal (hazard 'lava'); milk: a liquid, no hazard; spikes: a trap in every state; BOP plant_0:
// poison ivy (meta 4) is a trap, short grass (meta 0) is not (hazardByMeta, per-state entries).
const MOLTEN = 'contenttweaker:tin_molten', MILK = 'animania:milk_holstein', SPIKES = 'minetraps:spikes', PLANT = 'biomesoplenty:plant_0';
const FLUIDS = {
    [MOLTEN]: { id: 4410, liquid: true, boundingBox: 'block', forge: { modded: true, hazard: 'lava' } },
    [MILK]: { id: 4411, liquid: true, boundingBox: 'block', forge: { modded: true } },
    [SPIKES]: { id: 4412, boundingBox: 'block', forge: { modded: true, hazard: 'trap' } },
    [PLANT]: { id: 4413, boundingBox: 'empty', forge: { modded: true, hazard: 'trap', hazardByMeta: { 4: 'trap' } } },
};
for (const [name, e] of Object.entries(FLUIDS)) {
    reg.blocks[e.id] = { name, diggable: true, ...e }; reg.blocksByName[name] = reg.blocks[e.id]; MODDED[name] = e.id;
    for (let m = 0; m < 16; m++) {
        const hazard = e.forge.hazardByMeta ? e.forge.hazardByMeta[m] : e.forge.hazard;
        const forge = { ...e.forge }; if (hazard) forge.hazard = hazard; else delete forge.hazard;
        reg.blocksByStateId[(e.id << 4) | m] = { ...reg.blocks[e.id], forge };
    }
}
reg.blocksArray = Object.values(reg.blocks);
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
        const cell = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        const [name, meta] = cell.split('@'); // "biomesoplenty:plant_0@4": a state
        const id = reg.blocksByName[name]?.id ?? MODDED[name];
        const empty = name === 'air' || reg.blocks[id]?.boundingBox === 'empty';
        return { name, metadata: Number(meta ?? 0), type: id, position: q, boundingBox: empty ? 'empty' : 'block',
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
        dig: (b) => {
            calls.digs.push(key(b.position));
            world.set(key(b.position), 'air');
            // Gravity: a bot with nothing under its feet falls onto the first block below.
            const feet = bot.entity.position.floored();
            let y = feet.y;
            while (y > 0 && blockAt(at(feet.x, y - 1, feet.z)).boundingBox === 'empty') y--;
            if (y !== feet.y) { calls.falls = [...(calls.falls ?? []), feet.y - y]; bot.entity.position = at(feet.x, y, feet.z).offset(0.5, 0, 0.5); }
            return Promise.resolve();
        },
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
    const counts = [m.exclusionAreasBreak.length, m.exclusionAreasStep.length];
    fallSafe(m);
    assert.deepEqual([m.exclusionAreasBreak.length, m.exclusionAreasStep.length], counts, 'once');
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

    // CX23 soak: no walk down, but leaves under it: it digs down through them (falls of 1), then collects.
    const leafy = fakeBot({ blocks, start: at(0, 67) });
    assert.equal(await skills.collectBlock(leafy, LEAVES, 1), true);
    assert.deepEqual(leafy.calls.digs.slice(0, 3), ['0,66,0', '0,65,0', '0,64,0'], 'the leaves under it, one at a time');
    assert.deepEqual(leafy.calls.falls, [1, 1, 1]);
    // A branch under it: never dug (it would fell the tree), so no way down; nothing is done.
    const stuck = fakeBot({ blocks: { ...blocks, '0,66,0': BRANCH }, start: at(0, 67) });
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

test('round 9 B: a thick trunk\'s shell (dynamictrees:trunkshell) is a tree part: no leaf on it counts as from the ground, no walk breaks it, and it is only cut the safe way', async (t) => {
    t.mock.method(console, 'log', () => {});
    // Round 9 B (driver.log 131-133): leaves at y 73 on three corners of a 3x3 ring around (-70, -60),
    // a thick trunk's shell, passed the ground check; each walk ended out of reach. And
    // !collectBlocks("dynamictrees:trunkshell", 1) dug a shell as a plain block (driver.log 244).
    const SHELL = 'dynamictrees:trunkshell';
    const bot = fakeBot({ blocks: { '7,64,0': SHELL, '7,65,0': SHELL, '7,66,0': LEAVES, '9,66,0': SHELL } });
    const shell = bot.blockAt(at(7, 64));
    assert.equal(isTreePart(shell), true, 'a shell is part of a tree');
    assert.equal(leafFromGround(bot, bot.blockAt(at(7, 66))), false, 'a leaf on a shell is not reachable from the ground');
    assert.equal(fallSafe(new pf.Movements(bot)).safeToBreak(shell), false, 'no walk breaks a shell');
    // rotn-data #332: a shell with no trunk next to it is air on the server (isAir), so no walk
    // stands on any shell: on a live one it would be up a tree, on a leftover one it would fall.
    const m = fallSafe(new pf.Movements(bot));
    assert.ok(m.exclusionStep(bot.blockAt(at(9, 67))) >= 100, 'never a step onto a shell (here one with no trunk)');
    assert.equal(m.exclusionStep(bot.blockAt(at(1, 64))), 0, 'a step on dirt');
    bot.entity.position = at(7, 66).offset(0.5, 0, 0.5);
    bot.world.set('7,66,0', 'air');
    assert.equal(standsOnTree(bot), true, 'standing on a shell is standing on a tree');
    bot.entity.position = at(0).offset(0.5, 0, 0.5);

    // Collected, it goes to fellTree (here no trunk in sight: refused), never a plain dig or collect().
    await skills.collectBlock(bot, SHELL, 1);
    assert.deepEqual([bot.calls.collected, bot.calls.digs], [[], []]);
    assert.match(bot.output, /Not cutting the tree/);
});

test('the sticks step: dead bushes, leaves from the ground, then felling (Request 17: leaves do give sticks)', () => {
    const sticks = ROTN_EARLY_GAME.find(s => s.id === 'sticks');
    // G3 round 8 A and Request 17: dead bushes by hand first, then leaves from the ground, then felling,
    // another kind of tree after one gave none.
    assert.match(sticks.goal, /!collectBlocks\("stick", 3\) first breaks dead bushes nearby by hand \(0-2 sticks each\), then leaves you can reach from the ground \(a stick half the time; it never climbs for them\), then fells trees/);
    assert.match(sticks.goal, /trying another kind of tree after one gave no sticks/);
    assert.doesNotMatch(sticks.goal, /Leaves drop no sticks/);
    // Round 5 A rerun: planks need a table (rotn-data), so before it River Cane or bamboo stand in.
    assert.match(sticks.goal, /Planks from ordinary logs need a crafting table here, so they come later/);
    assert.match(sticks.goal, /!collectBlocks\("biomesoplenty:plant_1:5", 3\)/);
    assert.doesNotMatch(sticks.goal, /drop from leaves|punching trees does not work/);
});

// ---- #259: liquids and hazards (lead, before G3 smoke round 5) ----

test('#259: any liquid (vanilla by name, modded by the liquid flag) and any hazard (per state) is not ground and not empty', () => {
    const bot = fakeBot({ blocks: {
        '1,63,0': MOLTEN, '1,64,0': LEAVES,              // a leaf over molten tin
        '2,63,0': MILK, '2,64,0': LEAVES,                // over milk
        '3,64,0': `${PLANT}@4`, '3,65,0': LEAVES,        // over poison ivy
        '4,64,0': `${PLANT}@0`, '4,65,0': LEAVES,        // over short grass: the dirt below counts
        '5,63,0': SPIKES,
        '6,63,0': 'water',
    } });
    const b = (x, y) => bot.blockAt(at(x, y));
    assert.equal(isLiquid(bot, b(6, 63)), true, 'vanilla water by name');
    assert.equal(isLiquid(bot, b(1, 63)), true, 'molten tin by the flag');
    assert.equal(isLiquid(bot, b(2, 63)), true, 'milk by the flag');
    assert.equal(isLiquid(bot, b(5, 63)), false);
    assert.equal(isLethal(bot, b(1, 63)), true, 'molten metal is lethal like lava');
    assert.equal(isLethal(bot, b(2, 63)), false, 'milk is not');
    assert.equal(hazardOf(bot, b(3, 64)), 'trap', 'poison ivy');
    assert.equal(hazardOf(bot, b(4, 64)), null, 'short grass, the same block id');
    for (const [x, y] of [[1, 63], [2, 63], [5, 63], [6, 63]]) assert.equal(isFirmGround(bot, b(x, y)), false, `${b(x, y).name} is not ground`);
    assert.equal(isFirmGround(bot, b(0, 63)), true, 'dirt is');
    assert.equal(leafFromGround(bot, b(1, 64)), false, 'not over molten tin');
    assert.equal(leafFromGround(bot, b(2, 64)), false, 'not over milk');
    assert.equal(leafFromGround(bot, b(3, 65)), false, 'not over poison ivy (a hazard is not empty)');
    assert.equal(leafFromGround(bot, b(4, 65)), true, 'over short grass the dirt counts');
    assert.equal(itemOnGround(bot, { position: new Vec3(1.5, 64.0, 0.5) }), false, 'an item on molten tin');
    assert.equal(itemOnGround(bot, { position: new Vec3(5.5, 64.0, 0.5) }), false, 'on spikes');
});

test('#259: every walk avoids whole-block hazards by id, poison ivy per state (never all of plant_0), and never digs either', () => {
    const bot = fakeBot({ blocks: { '1,64,0': `${PLANT}@4`, '2,64,0': `${PLANT}@0` } });
    const m = fallSafe(new pf.Movements(bot));
    assert.ok(m.blocksToAvoid.has(FLUIDS[SPIKES].id), 'spikes: a hazard in every state');
    assert.ok(m.blocksToAvoid.has(FLUIDS[MOLTEN].id), 'molten tin');
    assert.ok(!m.blocksToAvoid.has(FLUIDS[PLANT].id), 'not plant_0 by id: the bot would avoid all short grass');
    assert.ok(m.exclusionStep(bot.blockAt(at(1, 64))) >= 100, 'into poison ivy: never');
    assert.equal(m.exclusionStep(bot.blockAt(at(2, 64))), 0, 'into short grass: fine');
    assert.ok(m.exclusionBreak({ name: MOLTEN, type: FLUIDS[MOLTEN].id, metadata: 0 }) >= 100, 'never dig a fluid');
    assert.ok(m.exclusionBreak({ name: SPIKES, type: FLUIDS[SPIKES].id, metadata: 0 }) >= 100, 'nor a trap');
    assert.equal(m.exclusionBreak({ name: 'dirt', type: reg.blocksByName.dirt.id, metadata: 0 }), 0);
});

test('#259: the pathfinder never lands, drops or steps onto a modded liquid or a hazard (they are solid cubes in the registry)', () => {
    const node = { x: 0, y: 64, z: 0, remainingBlocks: 0 };
    const east = { x: 1, z: 0 };
    // A step east onto a floor at y 63 of: dirt, molten tin, milk, spikes.
    const forward = (floor) => {
        const bot = fakeBot({ blocks: floor ? { '1,63,0': floor } : {} });
        const out = [];
        fallSafe(new pf.Movements(bot)).getMoveForward(node, east, out);
        const raw = [];
        new pf.Movements(bot).getMoveForward(node, east, raw);
        return [out.length, raw.length];
    };
    assert.deepEqual(forward(null), [1, 1], 'dirt: a step');
    for (const floor of [MOLTEN, MILK, SPIKES]) assert.deepEqual(forward(floor), [0, 1], `${floor}: no step (the raw pathfinder would)`);
    // A drop east from a ledge onto a pool of molten tin 2 below.
    const pool = fakeBot({ blocks: { '1,63,0': 'air', '1,62,0': MOLTEN } });
    assert.equal(fallSafe(new pf.Movements(pool)).getLandingBlock(node, east), null, 'never lands on molten tin');
    assert.ok(new pf.Movements(pool).getLandingBlock(node, east), 'the raw pathfinder would');
});

test('#259: installWalkSafety makes every movements anyone sets fall-, liquid- and hazard-safe, once', () => {
    const bot = fakeBot();
    const set = [];
    bot.pathfinder = { setMovements: (m) => set.push(m), movements: new pf.Movements(bot) };
    assert.equal(installWalkSafety(bot), true);
    assert.equal(bot.pathfinder.movements.rotnFallSafe, true, 'the current movements too');
    bot.pathfinder.setMovements(new pf.Movements(bot)); // e.g. mineflayer-collectblock or -pvp
    assert.equal(set[0].rotnFallSafe, true);
    assert.equal(set[0].maxDropDown, PATHFINDER_MAX_DROP_DOWN);
    assert.ok(set[0].blocksToAvoid.has(FLUIDS[SPIKES].id));
    assert.equal(installWalkSafety(bot), false, 'once');
});

test('#427 review: every movements anyone sets (a flee, a follow, a pvp chase) steps around poison ivy and thorns, once', () => {
    const bot = fakeBot();
    const set = [];
    bot.pathfinder = { setMovements: (m) => set.push(m), movements: new pf.Movements(bot) };
    installWalkSafety(bot);
    const steps = (m, name, metadata) => m.exclusionAreasStep.reduce((n, f) => n + f({ name, metadata, position: new Vec3(0, 64, 0) }), 0);
    assert.equal(bot.pathfinder.movements.rotnPlantSafe, true, 'the current movements too');
    bot.pathfinder.setMovements(new pf.Movements(bot)); // e.g. mineflayer-pvp's chase
    const m = set[0];
    assert.equal(m.rotnPlantSafe, true);
    assert.ok(steps(m, 'biomesoplenty:plant_0', 4) >= 100, 'poison ivy');
    assert.ok(steps(m, 'biomesoplenty:plant_1', 2) >= 100, 'thorns');
    assert.equal(steps(m, 'biomesoplenty:plant_0', 0), 0, 'another BoP plant');
    const before = m.exclusionAreasStep.length;
    bot.pathfinder.setMovements(m); // set again: not added twice
    assert.equal(set[1].exclusionAreasStep.length, before);
});

// ---- #264 review ----

test('#264 review 1: vanilla water is left to the pathfinder: wading and swimming still give moves', () => {
    const node = { x: 0, y: 64, z: 0, remainingBlocks: 0 };
    const east = { x: 1, z: 0 };
    const moves = (blocks) => {
        const bot = fakeBot({ blocks });
        const safe = [], raw = [];
        fallSafe(new pf.Movements(bot)).getMoveForward(node, east, safe);
        new pf.Movements(bot).getMoveForward(node, east, raw);
        return [safe.length, raw.length];
    };
    assert.deepEqual(moves({ '1,64,0': 'water' }), [1, 1], 'wading: 1-deep water on dirt');
    assert.deepEqual(moves({ '1,64,0': 'water', '1,63,0': 'water', '1,62,0': 'water' }), [1, 1], 'swimming on the surface');
    assert.deepEqual(moves({ '1,65,0': 'water', '1,64,0': 'water', '1,63,0': 'water' }), [1, 1], 'under water');
    // ...while a modded fluid is still refused
    assert.deepEqual(moves({ '1,63,0': MILK }), [0, 1], 'never onto a floor of milk');
});

test('#264 review 2: never dig next to a modded fluid, whatever dontCreateFlow says (mineflayer-collectblock turns it off)', () => {
    const bot = fakeBot({ blocks: { '1,64,0': 'stone', '2,64,0': MOLTEN, '5,64,0': 'stone', '6,64,0': 'water', '9,64,0': 'stone' } });
    const stone = (x) => bot.blockAt(at(x, 64));
    for (const dontCreateFlow of [true, false]) {
        const m = fallSafe(new pf.Movements(bot));
        m.dontCreateFlow = dontCreateFlow;
        assert.equal(m.safeToBreak(stone(1)), false, `next to molten tin (dontCreateFlow ${dontCreateFlow})`);
        assert.equal(m.safeToBreak(stone(9)), true, `nothing near (dontCreateFlow ${dontCreateFlow})`);
    }
    const raw = new pf.Movements(bot);
    assert.equal(raw.safeToBreak(stone(1)), true, 'the raw pathfinder would dig it');
    const m = fallSafe(new pf.Movements(bot));
    assert.equal(m.getBlock(at(2, 64), 0, 0, 0).liquid, true, 'a modded fluid is a liquid to the pathfinder');
    assert.equal(m.safeToBreak(stone(5)), false, 'next to water: the pathfinder\'s own dontCreateFlow, as before');
});

test('#264 nit: isClearPath uses the safe movements', async () => {
    const bot = fakeBot();
    let used = null;
    bot.pathfinder = { getPathFromTo: function* (m) { used = m; yield { result: { status: 'success', path: [] } }; } };
    await world.isClearPath(bot, { position: at(3, 64) });
    assert.ok(used, 'searched');
    assert.equal(used.rotnFallSafe, true);
    assert.ok(used.blocksToAvoid.has(FLUIDS[SPIKES].id));
    assert.equal(used.canDig, false);
});

// CX23 soak (rotn-v0.1.3): the world spawn was in a giant spruce's canopy (y 80, the ground ~64):
// every respawn on leaves, no walk down (all drops over 3), so no shelter, no hole, the night outside.
test('CX23 soak: with no walk down, the bot digs the leaf under it by hand; one last-resort larger drop only if health stays at least 10', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.deepEqual(skills.CANOPY_DESCENT.minHealthAfterDrop, 10);
    const air = (from, to) => Object.fromEntries(Array.from({ length: from - to + 1 }, (_, i) => [`0,${from - i},0`, 'air']));
    // The ground's top is y 63 (dirt below 64), so the bot lands standing at y 64.
    // A canopy 16 above the ground: the fall (16, 13 damage) would leave 7 health: refused, nothing dug.
    const high = fakeBot({ blocks: { '0,79,0': LEAVES }, start: at(0, 80) });
    high.health = 20;
    assert.equal(await skills.descendFromTree(high), false);
    assert.deepEqual(high.calls.digs, []);
    assert.match(high.output, /Not digging down: a fall of 16 blocks would leave you 7 health/);
    // 9 above the ground: one fall of 9 (6 damage) leaves 14: the last resort, taken once.
    const mid = fakeBot({ blocks: { '0,72,0': LEAVES }, start: at(0, 73) });
    mid.health = 20;
    assert.equal(await skills.descendFromTree(mid), true);
    assert.deepEqual([mid.calls.digs, mid.calls.falls], [['0,72,0'], [9]]);
    assert.match(mid.output, /one fall of 9 blocks as the last resort \(health 20 -> about 14\)/);
    // The same fall at health 12 would leave 9: refused.
    const hurt = fakeBot({ blocks: { '0,72,0': LEAVES }, start: at(0, 73) });
    hurt.health = 12;
    assert.equal(await skills.descendFromTree(hurt), false);
    assert.deepEqual(hurt.calls.digs, []);
    // Two big drops in a row: the first is taken, the second refused (one per descent).
    const two = fakeBot({ blocks: { '0,76,0': LEAVES, '0,70,0': LEAVES }, start: at(0, 77) });
    two.health = 20;
    assert.equal(await skills.descendFromTree(two), false);
    assert.deepEqual([two.calls.digs, two.calls.falls], [['0,76,0'], [6]]);
    assert.match(two.output, /Not digging down: a fall of 7 blocks .* only one such drop/);
    // Leaves all the way down: falls of 1, no big drop needed.
    const column = fakeBot({ blocks: Object.fromEntries([64, 65, 66, 67].map(y => [`0,${y},0`, LEAVES])), start: at(0, 68) });
    column.health = 6;
    assert.equal(await skills.descendFromTree(column), true);
    assert.deepEqual(column.calls.falls, [1, 1, 1, 1]);
    // Never into lava; never a trunk shell (or a branch, above).
    const lava = fakeBot({ blocks: { '0,66,0': LEAVES, ...air(65, 64), '0,63,0': 'lava' }, start: at(0, 67) });
    lava.health = 20;
    assert.equal(await skills.descendFromTree(lava), false);
    assert.deepEqual(lava.calls.digs, []);
    assert.match(lava.output, /it would land in lava at 0, 63, 0/);
    const shell = fakeBot({ blocks: { '0,66,0': 'dynamictrees:trunkshell' }, start: at(0, 67) });
    assert.equal(await skills.descendFromTree(shell), false);
    assert.deepEqual(shell.calls.digs, []);
});

test('#415 review 1: the unstuck reflex\'s timeout aborts the dig down too (it does not run on beside the next action)', async (t) => {
    t.mock.method(console, 'log', () => {});
    // Ten leaves under the bot, each dig takes 200 ms; the reflex gives up after 300 ms.
    const blocks = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`0,${64 + i},0`, LEAVES]));
    const bot = fakeBot({ blocks, start: at(0, 74) });
    const dig = bot.dig;
    let stopped = 0;
    bot.stopDigging = () => { stopped++; };
    bot.dig = (b) => new Promise(resolve => setTimeout(() => resolve(dig(b)), 200));
    const r = await moveAwayWithin(bot, 5, 300);
    assert.equal(r.outcome, 'timeout');
    const atTimeout = bot.calls.digs.length;
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.ok(bot.calls.digs.length <= atTimeout + 1, `digs after the timeout: ${atTimeout} -> ${bot.calls.digs.length}`);
    assert.ok(bot.calls.digs.length < 4, 'nowhere near the 10 it would have dug');
    assert.equal(stopped, 1, 'a dig in progress is stopped');
});

test('#415 review 2: off the middle of its cell the bot sneaks to the middle first; one that does not fall stops (never "on the ground" up there)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const blocks = { '0,66,0': LEAVES, '0,65,0': LEAVES, '0,64,0': LEAVES };
    const bot = fakeBot({ blocks, start: at(0, 67) });
    bot.entity.position = new Vec3(0.9, 67, 0.5); // on the edge, over the next block too
    let looking = null;
    bot.lookAt = (p) => { looking = p; return Promise.resolve(); };
    const controls = [];
    bot.setControlState = (c, on) => {
        controls.push(`${c}:${on}`);
        if (c !== 'forward' || !on || !looking) return;
        const pos = bot.entity.position, dx = looking.x - pos.x, dz = looking.z - pos.z, d = Math.hypot(dx, dz);
        if (d > 0) bot.entity.position = pos.offset(dx / d * Math.min(0.1, d), 0, dz / d * Math.min(0.1, d));
    };
    const dig = bot.dig;
    const xs = [];
    bot.dig = (b) => { xs.push(bot.entity.position.x); return dig(b); };
    assert.equal(await skills.digDownThroughLeaves(bot), true);
    assert.ok(xs[0] <= 0.65, `centred before the first dig (x ${xs[0]})`);
    assert.ok(controls.includes('sneak:true') && controls.at(-1) === 'sneak:false');

    // A bot that does not fall once the leaf is gone (it stands on something else): it stops.
    const held = fakeBot({ blocks, start: at(0, 67) });
    held.dig = (b) => { held.calls.digs.push(`${b.position.x},${b.position.y},${b.position.z}`); held.world.set(`${b.position.x},${b.position.y},${b.position.z}`, 'air'); return Promise.resolve(); };
    const saved = { ...skills.CANOPY_DESCENT };
    Object.assign(skills.CANOPY_DESCENT, { landMs: 100 });
    t.after(() => Object.assign(skills.CANOPY_DESCENT, saved));
    assert.equal(await skills.digDownThroughLeaves(held), false);
    assert.deepEqual(held.calls.digs, ['0,66,0'], 'one dig, then it stops');
    assert.match(held.output, /Not digging down further: you did not fall \(you stand at 67\.00, not 66\)/);
});


// Soak 2 (rotn-v0.1.4): a 3-min !moveAway sprinted food from 16 to 8; food 0 kills on this pack.
test('soak 2: no walk sprints, except while a survival mode flees or fights (bot.rotnSprint)', async () => {
    const { execute, SPRINT_MODES } = await import('../modes.js');
    const bot = fakeBot();
    const set = [];
    bot.pathfinder = { setMovements: (m) => { set.push(m); bot.pathfinder.movements = m; }, movements: new pf.Movements(bot) };
    installWalkSafety(bot);
    assert.equal(bot.pathfinder.movements.allowSprinting, false, 'the current movements too');
    bot.pathfinder.setMovements(new pf.Movements(bot)); // a collect, a hunt, a !moveAway
    assert.equal(set.at(-1).allowSprinting, false);
    // A survival mode's action may sprint; any other mode's may not.
    assert.deepEqual(SPRINT_MODES, ['self_preservation', 'cowardice', 'self_defense']);
    const agent = { bot, actions: { currentActionLabel: '', runAction: async (label, fn) => { await fn(); return { message: '', interrupted: false }; } } };
    let during = null;
    const walk = () => { bot.pathfinder.setMovements(new pf.Movements(bot)); during = bot.pathfinder.movements.allowSprinting; return Promise.resolve(); };
    for (const name of ['cowardice', 'self_preservation', 'self_defense']) {
        await execute({ name, active: false }, agent, walk);
        assert.equal(during, true, `${name}: a flee or a fight sprints`);
        assert.equal(bot.rotnSprint, false, `${name}: and only during its action`);
        // #432 review 5: the movements it left keep no sprint for a walk that reuses them.
        assert.equal(bot.pathfinder.movements.allowSprinting, false, `${name}: no sprint kept after it`);
    }
    await execute({ name: 'hunting', active: false }, agent, walk);
    assert.equal(set.at(-1).allowSprinting, false, 'a hunt walks');
});
