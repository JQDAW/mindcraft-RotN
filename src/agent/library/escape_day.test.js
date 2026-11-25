// Soak 16 (E, the lead): one escape, wired everywhere. Soak 15 lost 80 of 120 min in a pocket 8 blocks under the
// surface: the walks found no path, !goToSurface aimed at a giant tree's leaves (y 72 over ground at 64) and said
// "Going to the surface" after a failure, and the morning dig-out's 4 steps were too few. Fake worlds and a fake bot
// that digs, places, jumps and lands (as escape.test.js); fake pathfinders. No server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { escape, isTrapped, isOut, surfaceTarget, groundTarget, skyY, escapeText, escapeIfTrapped, escapeMovements, nextStep, ESCAPE, ESCAPE_DAY, ESCAPE_HOLD } from './escape.js';
import { goToSurface } from './skills.js';
import { SHELTER_HOLD } from '../agenda.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };

/** Soak 15's pocket: stone to y 59, dirt 60-63 (dirt over rock), air from 64 up; the bot's cell (0, 56, 0) and head (0, 57, 0) dug out: 8 below the ground. */
const pocket = (q) => (q.x === 0 && q.z === 0 && (q.y === 56 || q.y === 57) ? 'air' : q.y >= 64 ? 'air' : q.y >= 60 ? 'dirt' : 'stone');
/** The same under a giant tree's canopy: leaves at y 70-72 everywhere. */
const canopy = (q) => (q.y >= 70 && q.y <= 72 ? 'leaves' : pocket(q));
/** A pocket with gravel over it: the cells above the head and around it are gravel. */
const gravel = (q) => (q.y >= 59 && q.y <= 61 && Math.abs(q.x) <= 1 && Math.abs(q.z) <= 1 ? 'gravel' : pocket(q));

function fakeBot({ world = pocket, at = new Vec3(0, 56, 0), items = [], pathfinder = null } = {}) {
    const set = new Map();
    const nameAt = (q) => set.get(key(q)) ?? world(q);
    let reads = 0;
    const blockAt = (p) => {
        reads++;
        const q = p.floored();
        const v = nameAt(q);
        const b = reg.blocksByName[v];
        return { name: v, metadata: 0, type: b?.id ?? 1, boundingBox: b?.boundingBox ?? 'block', material: b?.material, position: q, canHarvest: () => true };
    };
    const solidAt = (q) => blockAt(q).boundingBox === 'block' && !/water|lava/.test(blockAt(q).name);
    const stack = (name, count) => ({ name, metadata: 0, count, type: reg.itemsByName[name]?.id });
    const inv = items.map(([n, c]) => stack(n, c));
    const calls = { dug: [], placed: [] };
    const bot = {
        output: '', interrupt_code: false, entities: {}, registry: reg, version: '1.12.2', game: { gameMode: 'survival' },
        entity: { position: at.offset(0.5, 0, 0.5), yaw: 0, onGround: true },
        inventory: { items: () => inv.filter(i => i.count > 0), slots: [] },
        heldItem: null, modes: { isOn: () => false }, tool: { equipForBlock: async () => {} },
        blockAt, digTime: () => 100,
        dig: (b) => { calls.dug.push(key(b.position)); set.set(key(b.position), 'air'); return Promise.resolve(); },
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        look: () => Promise.resolve(), lookAt: () => Promise.resolve(),
        setControlState: (c, on) => {
            if (c !== 'jump') return;
            const p = bot.entity.position;
            if (on) { bot.entity.position = p.offset(0, 1.2, 0); return; }
            let y = Math.floor(p.y);
            while (y > 0 && !solidAt(new Vec3(Math.floor(p.x), y - 1, Math.floor(p.z)))) y--;
            bot.entity.position = new Vec3(p.x, y, p.z);
        },
        clearControlStates: () => {},
        placeBlock: (ref, face) => {
            const target = ref.position.plus(face);
            if (bot.entity.position.floored().equals(target)) return Promise.reject(new Error('the bot is in the way'));
            bot.heldItem.count--;
            set.set(key(target), bot.heldItem.name);
            calls.placed.push(key(target));
            return Promise.resolve();
        },
        pathfinder,
    };
    return { bot, set, calls, inv, reads: () => reads };
}
const teleport = (bot, to) => { bot.entity.position = to.offset(0.5, 0, 0.5); return Promise.resolve(true); };
const noPath = () => ({ setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, getPathTo: () => ({ status: 'noPath', path: [] }), goto: () => Promise.reject(new Error('no path')) });
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

test('soak 16 (E): the sturdy blocks a climb keeps are the agenda\'s shelter hold', () => {
    assert.equal(ESCAPE.reserve, SHELTER_HOLD);
    assert.deepEqual(ESCAPE_DAY, { totalMs: 300_000, walkMs: 120_000, extraSteps: 8, maxPlaced: 32 });
});

test('soak 16 (E), soak 15\'s pocket: !goToSurface climbs out by stairs dug into the rock (more than 4 steps), keeps the shelter\'s 14 cobblestone, and says where it got to', async (t) => {
    quiet(t);
    const { bot, calls } = fakeBot({ pathfinder: noPath(), items: [['stone_pickaxe', 1], ['cobblestone', 14]] });
    assert.equal(isTrapped(bot).trapped, true);
    assert.ok(surfaceTarget(bot).equals(new Vec3(0, 64, 0)), 'the ground over the pocket');
    const out = await goToSurface(bot, { run: (b, opts) => escape(b, { ...opts, moveTo: teleport }) });
    assert.equal(out, true, bot.output);
    assert.ok(bot.entity.position.y >= 63, `out at ${bot.entity.position}`); // the ground (64) or one step below it, room to walk
    assert.ok(calls.dug.length > 8, 'stairs dug into the rock');
    assert.equal(count(bot, 'cobblestone'), 14, 'the reserve is untouched');
    assert.match(bot.output, /Reached open ground at -?\d+, 6\d, -?\d+ \(by stairs and pillars dug by hand; dug \d+, placed 0\) in \d+ s\./);
    assert.doesNotMatch(bot.output, /Going to the surface/);
    assert.equal(isTrapped(bot).trapped, false);
});

test('soak 16 (E): under a canopy the target is the ground (y 64), not the leaves; open ground under trees is not trapped; the sky starts over the leaves no more', (t) => {
    quiet(t);
    const { bot } = fakeBot({ world: canopy });
    assert.ok(surfaceTarget(bot).equals(new Vec3(0, 64, 0)));
    assert.equal(skyY(bot), 64, 'the tree parts count as sky');
    const under = fakeBot({ world: canopy, at: new Vec3(5, 64, 5) }).bot;
    assert.deepEqual([isTrapped(under).trapped, isTrapped(under).nodes], [false, 0], 'the sky over the feet ends it at once');
});

test('soak 16 (E): isTrapped is cheap: a 1-deep hole is no trap; a hole open to the sky is (sky above is no way out); the pocket is, within the node cap and a few thousand block reads', (t) => {
    quiet(t);
    const hole = fakeBot({ world: (q) => (q.x === 0 && q.z === 0 && q.y === 63 ? 'air' : pocket(q)), at: new Vec3(0, 63, 0) });
    assert.equal(isTrapped(hole.bot).trapped, false, 'one step up to open ground');
    // A collect's hole dug from the surface: 1 wide, 4 deep, open to the sky (soak 15's pocket may have been one).
    const shaft = fakeBot({ world: (q) => (q.x === 0 && q.z === 0 && q.y >= 60 ? 'air' : pocket(q)), at: new Vec3(0, 60, 0) });
    assert.equal(isTrapped(shaft.bot).trapped, true, 'the sky over a shaft is no walkable way out');
    const p = fakeBot();
    const r = isTrapped(p.bot);
    assert.equal(r.trapped, true);
    assert.ok(r.nodes <= 400, `${r.nodes} nodes`);
    assert.ok(p.reads() < 8000, `${p.reads()} block reads`);
});

test('soak 16 (E4): gravel over the pocket: the escape stops with a why that names it, and the model is told to start sideways', async (t) => {
    quiet(t);
    const { bot } = fakeBot({ world: gravel, pathfinder: noPath(), items: [['stone_pickaxe', 1], ['dirt', 4]] });
    const step = nextStep(bot, null, { placed: 0 });
    assert.match(step.why, /a falling gravel above at -?\d+, \d+, -?\d+/);
    const r = await escape(bot, { budget: 'day', moveTo: teleport, say: () => {} });
    assert.equal(r.out, false);
    assert.match(escapeText(r), /^You are trapped at 0, 56, 0: no walkable way to open ground within 8 blocks\. The escape stopped after \d+ s \(dug 0, placed 0\): no stair step.*falling gravel.*\. Start sideways, away from the falling block/);
});

test('soak 16 (E, the lead\'s order): dirt, then planks, then cobblestone only beyond the shelter\'s 14; the pathfinder places in that order', () => {
    const { bot } = fakeBot({ items: [['cobblestone', 16], ['planks', 3], ['dirt', 2]] });
    const m = escapeMovements(bot, { placed: 0, budget: { maxPlaced: 32, reserve: ESCAPE.reserve } });
    assert.deepEqual(m.scafoldingBlocks, [reg.itemsByName.dirt.id, reg.itemsByName.planks.id, reg.itemsByName.cobblestone.id]);
    assert.equal(m.countScaffoldingItems(), 2 + 3 + 2, 'the day budget keeps 14');
    // #624 review 4 (the lead): the morning and the unstuck reflex may spend the reserve (dirt and planks first).
    const morning = escapeMovements(bot, { placed: 0, budget: { maxPlaced: 32, reserve: 0 } });
    assert.equal(morning.countScaffoldingItems(), 2 + 3 + 16);
    const kept = fakeBot({ world: (q) => (q.y === 70 ? 'stone' : q.x === 0 && q.z === 0 && q.y >= 64 ? 'air' : q.y >= 64 ? 'stone' : 'stone'), at: new Vec3(0, 64, 0), items: [['cobblestone', 10]] });
    assert.match(nextStep(kept.bot, null, { placed: 0, budget: { maxPlaced: 32, reserve: ESCAPE.reserve } }).why ?? '', /no block to pillar up with \(the 10 sturdy blocks kept for the night's shelter are not used\)/);
    assert.equal(nextStep(kept.bot, null, { placed: 0 }).kind, 'pillar', 'no day budget: the reserve may be spent');
});

test('soak 16 (E): no dirt or planks, but dirt piles: dirt is crafted from them for the climb (day budget)', async (t) => {
    quiet(t);
    const { bot, inv } = fakeBot({ pathfinder: noPath(), items: [['stone_pickaxe', 1]] });
    inv.push({ name: 'betterwithmods:dirt_pile', metadata: 0, count: 12, type: 9001 });
    const crafted = [];
    const craft = (b, name, n) => { crafted.push([name, n]); inv.find(i => i.name === 'betterwithmods:dirt_pile').count -= 4 * n; inv.push({ name: 'dirt', metadata: 0, count: n, type: reg.itemsByName.dirt.id }); return Promise.resolve(true); };
    const r = await escape(bot, { budget: 'day', moveTo: teleport, craft, say: () => {} });
    assert.equal(crafted.length, 1, 'one craft');
    assert.equal(crafted[0][1], 3, 'all 12 piles: 3 dirt');
    assert.equal(r.crafted, 3);
});

test('soak 16 (E3, E4): the post-condition: a command that dug and left the bot trapped escapes (day budget); no dig, no check; a failed escape holds 2 min there; the third failure says to stop digging', async (t) => {
    quiet(t);
    const { bot } = fakeBot();
    const runs = [];
    let clock = 1_000_000;
    const run = (b, opts) => { runs.push(opts); return Promise.resolve({ out: false, why: 'no stair step, and no block to pillar up with', dug: 1, placed: 0, at: new Vec3(0, 56, 0), ms: 2000 }); };
    assert.equal(await escapeIfTrapped(bot, { digsBefore: 0, run, now: () => clock }), null, 'no dig: nothing');
    bot.rotnDigs = { count: 3 };
    const first = await escapeIfTrapped(bot, { digsBefore: 2, run, now: () => clock });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].budget, 'day');
    assert.ok(runs[0].target.equals(new Vec3(0, 64, 0)));
    assert.match(first, /^You are trapped at 0, 56, 0: .*no block to pillar up with\. Make dirt from dirt piles/);
    clock += 30_000;
    const held = await escapeIfTrapped(bot, { digsBefore: 2, run, now: () => clock });
    assert.equal(runs.length, 1, 'held: not tried again on its own');
    assert.match(held, /The escape here failed 30 s ago \(no stair step, and no block to pillar up with\); it is not tried again on its own for 2 min: !goToSurface tries from here\./);
    clock += ESCAPE_HOLD.ms;
    await escapeIfTrapped(bot, { digsBefore: 2, run, now: () => clock });
    clock += ESCAPE_HOLD.ms;
    const third = await escapeIfTrapped(bot, { digsBefore: 2, run, now: () => clock });
    assert.equal(runs.length, 3);
    assert.match(third, /The escape failed 3 times here in 10 min: stop digging here\.$/);
    // !digDown ('deep'): a hole only 2 deep below where it started is left alone.
    const shallow = fakeBot({ world: (q) => (q.x === 0 && q.z === 0 && (q.y === 62 || q.y === 63) ? 'air' : pocket(q)), at: new Vec3(0, 62, 0) }).bot;
    shallow.rotnDigs = { count: 2 };
    assert.equal(await escapeIfTrapped(shallow, { digsBefore: 0, from: new Vec3(0, 64, 0), minDepth: 3, run }), null);
    assert.equal(runs.length, 3);
});

test('soak 16 (E3): the commands with the post-condition, and how', async () => {
    await import('../agent.js'); // the real import order (commands/index.js first)
    const { POST_ESCAPE } = await import('../commands/actions.js');
    assert.deepEqual(POST_ESCAPE, { collectBlocks: 'down-or-failed', digDown: 'deep', goToCoordinates: 'failed', searchForBlock: 'failed', goToRememberedPlace: 'failed', goToBed: 'failed', goToPlayer: 'failed' });
});

test('soak 16 (E4): the lines for the model: out, interrupted, and a next step for each why', () => {
    const base = { dug: 2, placed: 1, at: new Vec3(1, 60, 2), ms: 12_000 };
    assert.equal(escapeText({ ...base, out: true, how: 'pathfinder' }), 'Reached open ground at 1, 60, 2 (by the pathfinder; dug 2, placed 1) in 12 s.');
    assert.match(escapeText({ ...base, out: false, interrupted: true, why: 'interrupted' }), /stopped by something else; !goToSurface goes on from here\./);
    assert.match(escapeText({ ...base, out: false, why: 'the 300 s ran out' }), /goes on from here, a bit higher each time\.$/);
    assert.match(escapeText({ ...base, out: false, why: 'could not dig stone at 1, 61, 2' }), /needs a better tool/);
    assert.doesNotMatch(escapeText({ ...base, out: false, why: 'x' }), /Going to the surface/);
});

test('soak 16 (E): soak 15\'s pocket with the stone pickaxe in the off hand: !goToSurface as an action (the hands rule takes it out first) digs out with it, then re-arms', async (t) => {
    quiet(t);
    const { ActionManager } = await import('../action_manager.js');
    const { bot, inv } = fakeBot({ pathfinder: noPath(), items: [['spartanweaponry:club_wood', 1]] });
    const slots = new Array(46).fill(null);
    const PICK = { name: 'stone_pickaxe', metadata: 0, count: 1, type: reg.itemsByName.stone_pickaxe.id };
    slots[45] = { ...PICK, slot: 45 };
    Object.assign(bot.inventory, { slots, firstEmptyInventorySlot: () => 20 });
    bot.moveSlotItem = (from, to) => { if (from === 45) { inv.push({ ...slots[45] }); slots[45] = null; } return Promise.resolve(); };
    bot.equip = (item, dest) => {
        if (dest === 'off-hand') { const i = inv.findIndex(x => x.name === item.name); if (i >= 0) slots[45] = { ...inv.splice(i, 1)[0], slot: 45 }; }
        else bot.heldItem = item;
        return Promise.resolve();
    };
    const dig = bot.dig;
    bot.dig = (b) => (/stone/.test(b.name) && !/pickaxe/.test(bot.heldItem?.name ?? '') ? Promise.reject(new Error(`dig time for ${b.name} is Infinity`)) : dig(b));
    const agent = { bot, isIdle: () => true, self_prompter: { isActive: () => false }, clearBotLogs() {}, cleanKill() {}, requestInterrupt() {} };
    bot.emit = () => {};
    agent.actions = new ActionManager(agent);
    agent.actions.stop = async () => {};
    let out = null;
    await agent.actions.runAction('action:goToSurface', async () => { out = await goToSurface(bot, { run: (b, opts) => escape(b, { ...opts, moveTo: teleport }) }); });
    assert.equal(out, true, bot.output);
    assert.equal(isTrapped(bot).trapped, false);
    assert.equal(slots[45]?.name, 'stone_pickaxe', 're-armed after the action');
});

test('soak 16 (E4): after a failed escape the agenda\'s prompt says to get out first, until the bot is out (re-checked every 5 s)', async (t) => {
    quiet(t);
    const { agendaGoal } = await import('../agenda_driver.js');
    const { stillTrapped } = await import('./escape.js');
    const { bot } = fakeBot({ pathfinder: noPath() });
    const out = await goToSurface(bot, { run: () => Promise.resolve({ out: false, why: 'no stair step, and no block to pillar up with', dug: 0, placed: 0, at: new Vec3(0, 56, 0), ms: 1000 }) });
    assert.equal(out, false);
    const step = { id: 'stone_axe', goal: 'Make a stone axe.' };
    const agenda = { steps: [step] };
    const goal = agendaGoal(agenda, step, { trapped: () => stillTrapped(bot) });
    assert.match(goal, /^RotN agenda, step 1 of 1 \(stone_axe\): You are trapped at 0, 56, 0 \(no walkable way to open ground\): get out first with !goToSurface \(it goes on from where you are\)\. Then: Make a stone axe\./);
    bot.entity.position = new Vec3(5.5, 64, 5.5); // out
    bot.rotnTrapped.checkedAt = 0;
    assert.equal(stillTrapped(bot), null);
    assert.doesNotMatch(agendaGoal(agenda, step, { trapped: () => stillTrapped(bot) }), /trapped/);
});

// #624 review 1 (the blocker): a shaft open to the sky, deeper than 8: the bot's own cell is never the target (it was
// "Reached open ground" at once, 12 deep); the target is the rim, the depth from the real surface.
const shaft = (q) => (q.x === 0 && q.z === 0 && q.y >= 52 ? 'air' : q.y >= 64 ? 'air' : q.y >= 60 ? 'dirt' : 'stone');
test('#624 review 1: an open shaft 12 deep: not out at the bottom; the rim is the target, 20 steps (12 + 8); !goToSurface climbs to it', async (t) => {
    quiet(t);
    const { bot } = fakeBot({ world: shaft, at: new Vec3(0, 52, 0), pathfinder: noPath(), items: [['stone_pickaxe', 1]] });
    assert.equal(isTrapped(bot).trapped, true);
    const target = surfaceTarget(bot);
    assert.equal(target.y, 64, `the rim: ${target}`);
    assert.ok(!target.equals(new Vec3(0, 52, 0)));
    const said = [];
    const out = await goToSurface(bot, { run: (b, opts) => escape(b, { ...opts, moveTo: teleport, say: (l) => said.push(l) }) });
    assert.ok(said.some(l => /\(up to 20 steps, 5 min\)$/.test(l)), said.join('\n'));
    assert.equal(out, true, bot.output);
    assert.ok(bot.entity.position.y >= 63, `${bot.entity.position}`);
    assert.equal(isTrapped(bot).trapped, false);
});

// #624 review 4 (the lead): the morning and the unstuck reflex may spend the shelter's reserve: soak 8's flooded
// pit (the well: water to 65 in a stone column to 70) with 10 cobblestone and no dirt pillars out.
test('#624 review 4: soak 8\'s flooded pit with 10 cobblestone and no dirt: the morning escape pillars out with the cobble', async (t) => {
    quiet(t);
    const well = (q) => (q.x === 0 && q.z === 0 ? (q.y < 64 ? 'stone' : q.y <= 65 ? 'water' : 'air') : q.y > 70 ? 'air' : 'stone');
    const { bot, calls } = fakeBot({ world: well, at: new Vec3(0, 64, 0), pathfinder: noPath(), items: [['cobblestone', 10]] });
    const r = await escape(bot, { moveTo: teleport, say: () => {} });
    assert.equal(r.out, true, r.why);
    assert.ok(calls.placed.length >= 2, 'pillared with cobble');
    assert.ok(count(bot, 'cobblestone') < 10);
    // The day budget keeps it: no block to pillar up with.
    const day = fakeBot({ world: well, at: new Vec3(0, 64, 0), pathfinder: noPath(), items: [['cobblestone', 10]] }).bot;
    const d = await escape(day, { budget: 'day', moveTo: teleport, say: () => {} });
    assert.equal(d.out, false);
    assert.match(d.why, /kept for the night's shelter/);
});

// #624 review 5: never "out" standing on or next to leaves only: the ground below is the target, and stairs and
// pillars (which only go up) say so.
test('#624 review 5: on a canopy (on the leaves at y 73): not open ground, the target is the ground below, and the climb says to go down', async (t) => {
    quiet(t);
    const trees = (q) => (q.y >= 70 && q.y <= 72 ? 'leaves' : q.y >= 64 ? 'air' : 'dirt');
    const { bot, set } = fakeBot({ world: trees, at: new Vec3(5, 73, 5), pathfinder: noPath(), items: [['dirt', 4]] });
    assert.equal(isOut(bot, null, true), false, 'on the leaves');
    set.set('5,73,5', 'dirt'); bot.entity.position = new Vec3(5.5, 74, 5.5); // a pillar on the leaves
    assert.equal(isOut(bot, null, true), false, 'a block on the leaves: steps onto leaves are no room');
    bot.entity.position = new Vec3(5.5, 73, 5.5); set.delete('5,73,5');
    assert.equal(groundTarget(bot).y, 64, 'the ground under the canopy');
    const r = await escape(bot, { budget: 'day', moveTo: teleport, say: () => {} });
    assert.equal(r.out, false);
    assert.match(r.why, /^the ground is below you \(open ground at -?\d+, 64, -?\d+\): climb down to it$/);
});

// #624 review 6: the cost on a big cave (61 x 61, 5 high): no walkable sky anywhere, the search is bounded.
test('#624 review 6: isTrapped in a 61 x 61 cave: at most 400 cells and under 12,000 block reads', (t) => {
    quiet(t);
    const cave = (q) => (Math.abs(q.x) <= 30 && Math.abs(q.z) <= 30 && q.y >= 40 && q.y <= 44 ? 'air' : 'stone');
    const c = fakeBot({ world: cave, at: new Vec3(0, 40, 0) });
    const r = isTrapped(c.bot);
    assert.equal(r.trapped, true);
    assert.ok(r.nodes <= 401, `${r.nodes} cells`);
    assert.ok(c.reads() < 12_000, `${c.reads()} block reads`);
});

// #624 review 2 (the lead): a collect in a cave is no reason (a cave is "trapped" too); a collect that took the bot 3
// or more below where it started, or one with a failed walk, is.
test('#624 review 2: the collect\'s post-condition: not after a collect in a cave at its own level; after one 3 down, or with a failed walk', async (t) => {
    quiet(t);
    await import('../agent.js'); // the real import order (commands/index.js first)
    const { postEscape } = await import('../commands/actions.js');
    const runs = [];
    const fake = (bot, opts) => { runs.push(opts.minDepth); return Promise.resolve(opts.minDepth > 0 && opts.from && opts.from.y - bot.entity.position.y < opts.minDepth ? null : 'escaped'); };
    const agent = (y) => ({ bot: { entity: { position: new Vec3(0.5, y, 0.5) }, rotnDigs: { count: 5 } } });
    const start = (y) => ({ t: Date.now(), digs: 1, at: new Vec3(0, y, 0) });
    assert.equal(await postEscape(agent(40), 'collectBlocks', start(40), { escapeIfTrapped: fake }), null, 'a cave collect at its own level');
    assert.equal(await postEscape(agent(36), 'collectBlocks', start(40), { escapeIfTrapped: fake }), 'escaped', '4 below where it started');
    const failed = agent(40);
    const s = start(40);
    failed.bot.rotnWalkFailedAt = s.t + 1;
    assert.equal(await postEscape(failed, 'collectBlocks', s, { escapeIfTrapped: fake }), 'escaped', 'a failed walk');
    assert.deepEqual(runs, [3, 3, 0]);
    assert.equal(await postEscape(agent(40), 'goToCoordinates', start(40), { escapeIfTrapped: fake }), null, 'a walk that did not fail');
    assert.equal(await postEscape(agent(40), 'craftRecipe', start(40), { escapeIfTrapped: fake }), null, 'no post-condition');
    // The real check: a cave collect (dug, trapped by the cave, at its own level) runs no escape.
    const c = fakeBot({ world: (q) => (Math.abs(q.x) <= 20 && Math.abs(q.z) <= 20 && q.y >= 40 && q.y <= 43 ? 'air' : 'stone'), at: new Vec3(0, 40, 0) });
    c.bot.rotnDigs = { count: 3 };
    let escaped = 0;
    await postEscape({ bot: c.bot }, 'collectBlocks', { t: Date.now(), digs: 1, at: new Vec3(0, 40, 0) }, { escapeIfTrapped: (b, o) => escapeIfTrapped(b, { ...o, run: () => { escaped++; return Promise.resolve({ out: true, how: 'pathfinder', dug: 0, placed: 0, at: new Vec3(0, 64, 0), ms: 1 }); } }) });
    assert.equal(escaped, 0);
});

// #624 review 7: the wiring with a real command: !goToCoordinates whose walk digs and then fails (no path) leaves the
// bot trapped in soak 15's pocket: runAsAction's post-condition runs the escape and the model reads where it got to.
test('#624 review 7: a real !goToCoordinates that dug and failed (goToGoal marks the failed walk): the escape runs in the same action', async (t) => {
    quiet(t);
    await import('../agent.js');
    const { executeCommand } = await import('../commands/index.js');
    const { installDigHands } = await import('./hands.js');
    const { bot } = fakeBot({ items: [['stone_pickaxe', 1]] });
    // The walk digs the block over the head, then finds no path; the escape's own pathfinder finds none either.
    let walks = 0;
    bot.pathfinder = { ...noPath(), getPathTo: () => ({ status: 'success', path: [] }), goto: async () => { if (walks++ === 0) await bot.dig(bot.blockAt(new Vec3(0, 58, 0))); throw Object.assign(new Error('No path to the goal!'), { name: 'NoPath' }); } };
    installDigHands(bot);
    bot.modes = { isOn: () => false, pause() {}, unpause() {}, behavior_log: '' };
    const labels = [];
    const agent = { bot, shut_up: true, openChat() {}, isIdle: () => true, agenda: { finished: false },
        actions: { currentActionLabel: '', resume_func: null, runAction(label, fn) { labels.push(label); return Promise.resolve(fn()).then(() => ({ message: bot.output, interrupted: false })); } } };
    const { ESCAPE: E } = await import('./escape.js');
    const saved = E.moveMs; E.moveMs = 50; t.after(() => { E.moveMs = saved; });
    const msg = await executeCommand(agent, '!goToCoordinates(10, 64, 10, 1)');
    assert.deepEqual(labels, ['action:goToCoordinates'], 'one action: the walk, then the post-condition');
    assert.ok(bot.rotnWalkFailedAt > 0, 'goToGoal marked the failed walk');
    assert.ok(bot.rotnDigs.count >= 1);
    assert.match(String(msg ?? bot.output), /You are trapped at|Reached open ground/);
});

// #624 review 7: a reflex (mode:) or a night job that digs never runs the post-condition: it hangs off model commands only.
test('#624 review 7: a mode: action that digs and leaves the bot trapped runs no escape', async (t) => {
    quiet(t);
    const { ActionManager } = await import('../action_manager.js');
    const { bot } = fakeBot({ pathfinder: noPath() });
    const agent = { bot, isIdle: () => true, self_prompter: { isActive: () => false }, clearBotLogs() {}, cleanKill() {}, requestInterrupt() {} };
    bot.emit = () => {};
    agent.actions = new ActionManager(agent);
    agent.actions.stop = async () => {};
    bot.rotnDigs = { count: 0 };
    await agent.actions.runAction('mode:unstuck', async () => { await bot.dig(bot.blockAt(new Vec3(1, 56, 0))); bot.rotnDigs.count++; });
    await agent.actions.runAction('action:digPit', () => { bot.rotnDigs.count++; });
    assert.equal(isTrapped(bot).trapped, true);
    assert.doesNotMatch(bot.output, /trapped|Reached open ground/);
    assert.equal(bot.rotnTrapped ?? null, null);
});
