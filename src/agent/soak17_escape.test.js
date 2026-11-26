// Soak 17 E (the lead's decisions, /home/rv/soak17-lead-decisions.md): the escape that could not get out, offline.
// 18:06:21 escape 3: "no pickaxe, and none can be made here: a stone pickaxe needs a crafting table (none carried or near)"
// with 4 planks, 3 sticks and 510 rocks; escape 2 used up two stone pickaxes; 18:03:58 "could not pillar up" said no
// more; 18:09 the climb reached a cave of zombies at dusk, the outnumbered flee went down the shaft, and the bot died.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { pocketUnderRock, fakeWorld } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { escape, escapeText, nextStep, opensCave, duskSealDue, pillarUp, surfaceTarget, CAVE, DUSK_SEAL } from './library/escape.js';
import { pickaxePlan, makePickaxe, TABLE_CHAIN, walkKeep, usesLeft } from './library/pickaxe.js';
import { craftNeeds } from './library/craft_needs.js';
import './agent.js'; // the real import order (commands/index.js first)
import { __modeForTest, __resetThreatLease, holdsInPlace } from './modes.js';

const V = (x, y, z) => new Vec3(x, y, z);
const MORNING = 1000; // RotN's clock: 19.6 min to sunset (6000, the fixture's default, is dusk)
const quiet = (t, lines = null) => { t.mock.method(console, 'log', (...a) => lines?.push(a.join(' '))); t.mock.method(console, 'warn', () => {}); };
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };
const flush = () => new Promise(resolve => setImmediate(resolve));

// 18:06:21's bag (the death list and the craft lines): rocks, 4 planks, 3 sticks, the stone axe; no table, no pickaxe.
const BAG_1806 = { 36: ['stone_axe', 1], 9: ['pyrotech_compat:rock_metamorphic', 64], 10: ['pyrotech:rock', 64, 8], 11: ['planks', 4], 12: ['stick', 3], 13: ['dirt', 19] };

test('soak 17 E(1): the table chain\'s numbers are rotn-data\'s (crude axe: a rock and 2 sticks; Crafting Tools: the crude axe, a rock and a stick; the table: a plank and the tools)', (t) => {
    quiet(t);
    const has = (slots, name) => { const w = fakeWorld({ slots }); useRegistry(t, w.bot); return craftNeeds(w.bot, name); };
    const [axe, tools, table] = TABLE_CHAIN;
    assert.equal(has({ 9: ['pyrotech:rock', axe.rocks], 10: ['stick', axe.sticks] }, axe.item)?.ready, true);
    assert.equal(has({ 9: ['pyrotech:rock', axe.rocks], 10: ['stick', axe.sticks - 1] }, axe.item)?.ready, false);
    assert.equal(has({ 9: ['pyrotech:crude_axe', 1], 10: ['pyrotech:rock', tools.rocks], 11: ['stick', tools.sticks] }, tools.item)?.ready, true);
    // (Whether the server takes a stone axe for the tools, as rotn-data's recipe lists it, is soak 17's L4 question: the
    // chain always makes the crude axe, which soak 17's 18:06 craft showed works.)
    assert.equal(has({ 9: ['contenttweaker:crafting_tools', 1], 10: ['planks', table.planks] }, table.item)?.ready, true);
});

test('soak 17 E(1): with 18:06:21\'s bag the plan makes the table itself: sticks, the crude axe, Crafting Tools, the table, then the pickaxe', (t) => {
    quiet(t);
    const w = pocketUnderRock({ slots: BAG_1806 });
    useRegistry(t, w.bot);
    const plan = pickaxePlan(w.bot);
    assert.equal(plan.ready, true, plan.why);
    assert.deepEqual(plan.crafts, [['stick', 1], ['pyrotech:crude_axe', 1], ['contenttweaker:crafting_tools', 1], ['crafting_table', 1], ['stone_pickaxe', 1]]);
    // Crafting Tools carried: only the table is left to make; a crude axe carried: the tools and the table.
    const tools = pocketUnderRock({ slots: { ...BAG_1806, 14: ['contenttweaker:crafting_tools', 1] } });
    assert.deepEqual(pickaxePlan(tools.bot).crafts.map(c => c[0]), ['crafting_table', 'stone_pickaxe']);
    const axe = pocketUnderRock({ slots: { ...BAG_1806, 14: ['pyrotech:crude_axe', 1] } });
    assert.deepEqual(pickaxePlan(axe.bot).crafts.map(c => c[0]), ['contenttweaker:crafting_tools', 'crafting_table', 'stone_pickaxe'], 'the 3 sticks carried are enough (2 for the pickaxe, 1 for the tools)');
    // One plank: the sticks cannot be made and the table keeps its plank: the why names the table's makings.
    const poor = pocketUnderRock({ slots: { 9: ['pyrotech:rock', 8], 11: ['planks', 1], 12: ['stick', 2] } });
    const p = pickaxePlan(poor.bot);
    assert.equal(p.ready, false);
    assert.match(p.why, /a crafting table \(none carried or near\) or the makings of one \(pyrotech:crude_axe, then contenttweaker:crafting_tools, then crafting_table: 2 more rocks, 3 more sticks, 1 more plank\)/);
});

test('soak 17 E(1): makePickaxe crafts the chain and places the table it made in the pocket', async (t) => {
    const lines = [];
    quiet(t, lines);
    const w = pocketUnderRock({ slots: BAG_1806, set: { '0,56,0': 'air', '0,57,0': 'air', '1,56,0': 'air' } });
    useRegistry(t, w.bot);
    const crafts = [];
    const craft = (bot, item, n) => { crafts.push(item); w.give(item === 'stick' ? 'stick' : item, item === 'stick' ? 4 * n : 1); return Promise.resolve(true); };
    const r = await makePickaxe(w.bot, { craft });
    assert.equal(r.made, true, r.why);
    assert.deepEqual(crafts, ['stick', 'pyrotech:crude_axe', 'contenttweaker:crafting_tools', 'crafting_table', 'stone_pickaxe']);
    assert.ok(lines.some(l => /\[pickaxe\] placed the crafting table at \(1, 56, 0\)/.test(l)), lines.join('\n'));
});

test('soak 17 E(2): a pickaxe down to its keep is replaced before the next pickaxe dig when one can be made; else its last uses are spent', async (t) => {
    const lines = [];
    quiet(t, lines);
    const used = 131 + 1 - walkKeep({ name: 'stone_pickaxe' }); // uses left == its keep
    const bag = { 36: ['stone_pickaxe', 1, used], 9: ['undergroundbiomes:metamorphic_cobble', 8], 11: ['planks', 4], 12: ['crafting_table', 1], 13: ['dirt', 6] };
    const w = pocketUnderRock({ slots: bag, set: { '0,56,0': 'air', '0,57,0': 'air', '1,56,0': 'air' }, timeOfDay: MORNING });
    useRegistry(t, w.bot);
    assert.equal(usesLeft({ name: 'stone_pickaxe', metadata: used }), walkKeep({ name: 'stone_pickaxe' }));
    const crafts = [];
    const craft = (bot, item, n) => { crafts.push(item); w.give(item, item === 'stick' ? 4 * n : item === 'stone_pickaxe' ? 1 : 4 * n); return Promise.resolve(true); };
    const r = await escape(w.bot, { budget: 'day', target: surfaceTarget(w.bot), craft, say: (l) => lines.push(l) });
    const made = lines.findIndex(l => /^\[escape\] the stone_pickaxe has \d+ uses left \(keep \d+\): making another first$/.test(l));
    assert.ok(made >= 0, lines.join('\n'));
    assert.ok(crafts.includes('stone_pickaxe'));
    assert.equal(r.remade, 1);
    // Nothing to make one from: said once, and the climb spends the last uses.
    const lines2 = [];
    const bare = pocketUnderRock({ slots: { 36: ['stone_pickaxe', 1, used], 13: ['dirt', 6] }, timeOfDay: MORNING });
    await escape(bare.bot, { budget: 'day', target: surfaceTarget(bare.bot), craft: () => { throw new Error('no craft'); }, say: (l) => lines2.push(l) });
    assert.equal(lines2.filter(l => /no other can be made here .*: its last uses are spent/.test(l)).length, 1, lines2.join('\n'));
});

test('soak 17 E(3): pillarUp says why it failed; the climb tries a failed pillar once more after the hands settle, and the why carries the reason', async (t) => {
    const lines = [];
    quiet(t, lines);
    // A shaft in bedrock (no stair can be dug): only pillars.
    const set = {};
    for (let y = 56; y < 64; y++) set[`0,${y},0`] = 'air';
    const w = fakeWorld({ ground: [{ below: 64, block: 'bedrock' }], set, at: V(0, 56, 0), slots: { 9: ['dirt', 16] }, timeOfDay: MORNING });
    useRegistry(t, w.bot);
    let calls = 0;
    const pillar = (bot, item, deadline, info) => {
        calls++;
        if (calls === 1) { info.why = 'the jump did not lift the feet out of the cell'; return Promise.resolve(false); }
        const p = bot.entity.position.floored();
        w.world.set(p, item.name);
        bot.entity.position = V(p.x + 0.5, p.y + 1, p.z + 0.5);
        return Promise.resolve(true);
    };
    const r = await escape(w.bot, { budget: 'day', pillar, say: (l) => lines.push(l) });
    assert.ok(lines.some(l => /^\[escape\] the pillar at 0, 56, 0 did not take \(the jump did not lift the feet out of the cell\): once more$/.test(l)), lines.join('\n'));
    assert.equal(r.out, true, r.why);
    // Twice in a row: the why says which part failed.
    const w2 = fakeWorld({ ground: [{ below: 64, block: 'bedrock' }], set, at: V(0, 56, 0), slots: { 9: ['dirt', 16] }, timeOfDay: MORNING });
    const r2 = await escape(w2.bot, { budget: 'day', pillar: (b, i, d, info) => { info.why = 'the dirt did not stay at 0, 56, 0'; return Promise.resolve(false); }, say: () => {} });
    assert.match(r2.why, /could not pillar up from 0, 56, 0 \(the dirt did not stay at 0, 56, 0\)/);
    // The real pillarUp: no block, and nothing solid under the feet, are named.
    const info = {};
    assert.equal(await pillarUp(w2.bot, null, Infinity, info), false);
    assert.equal(info.why, 'no block to place');
    // A dirt pile is an item, not a block: never what a pillar places.
    const piles = fakeWorld({ ground: [{ below: 64, block: 'bedrock' }], set, at: V(0, 56, 0), slots: { 9: ['betterwithmods:dirt_pile', 40], 10: ['dirt', 2] }, timeOfDay: MORNING });
    const placed = [];
    await escape(piles.bot, { budget: 'day', pillar: (b, item) => { placed.push(item?.name); return Promise.resolve(false); }, say: () => {} });
    assert.ok(placed.length > 0 && placed.every(n => n === 'dirt'), JSON.stringify(placed));
});

test('soak 17 E(4)(ii): wary (a hostile near, or night), a stair cell that opens into a cave is not dug: another direction', (t) => {
    quiet(t);
    // A 1x2 pocket at 0, 60, 0 in stone; a cave (4 x 3 x 4 air) east of it, at x 2..5.
    const set = { '0,60,0': 'air', '0,61,0': 'air' };
    for (let x = 2; x <= 5; x++) for (let y = 60; y <= 62; y++) for (let z = -2; z <= 1; z++) set[`${x},${y},${z}`] = 'air';
    const w = fakeWorld({ ground: [{ below: 70, block: 'stone' }], set, at: V(0, 60, 0), slots: { 36: ['stone_pickaxe', 1] }, timeOfDay: MORNING });
    useRegistry(t, w.bot);
    const east = V(8, 70, 0);
    const calm = nextStep(w.bot, east, { placed: 0, budget: { maxPlaced: 8 }, wary: false, dugSet: new Set() });
    assert.deepEqual([calm.kind, calm.d?.x], ['stair', 1], 'calm: toward the target, east');
    assert.ok(opensCave(w.bot, V(1, 61, 0), new Set(['0,60,0', '0,61,0', '0,62,0', '1,61,0', '1,62,0'])), `${CAVE.cells} cells of air beside it`);
    const wary = nextStep(w.bot, east, { placed: 0, budget: { maxPlaced: 8 }, wary: true, dugSet: new Set() });
    assert.equal(wary.kind, 'stair');
    assert.notEqual(wary.d.x, 1, 'not into the cave');
});

test('soak 17 E(4)(iii): at dusk a day escape 8 below the surface seals in for the night (the night routine\'s shelter), no climb', async (t) => {
    const lines = [];
    quiet(t, lines);
    const w = pocketUnderRock({ slots: { 36: ['stone_pickaxe', 1], 9: ['dirt', 16] } }); // the fixture's 6000: dusk on RotN's clock
    useRegistry(t, w.bot);
    assert.match(duskSealDue(w.bot, { budget: { kind: 'day' } }) ?? '', /^it is dusk and the bot is still 8 below the surface$/);
    assert.equal(duskSealDue(w.bot, { budget: { kind: 'morning' } }), null, 'only the day budget');
    const seals = [];
    const r = await escape(w.bot, { budget: 'day', target: surfaceTarget(w.bot), seal: (bot, opts) => { seals.push(opts); return Promise.resolve({ closed: true }); }, say: (l) => lines.push(l) });
    assert.deepEqual([r.out, r.dusk, r.sealed, r.dug], [false, true, true, 0]);
    assert.deepEqual(seals.map(o => [o.site.toString(), o.keepSoft, o.floodCheck, o.roofRetry]), [['(0, 56, 0)', true, true, true]]);
    assert.ok(lines.some(l => /^\[escape\] it is dusk and the bot is still 8 below the surface at 0, 56, 0: sealing the shaft here for the night/.test(l)), lines.join('\n'));
    assert.match(escapeText(r), /^Night is near and you are deep under the surface: sealed in at 0, 56, 0 for the night .*the climb out goes on in the morning\.$/);
    // Shallower than DUSK_SEAL.minDepth: no seal, the climb goes on.
    const shallow = fakeWorld({ set: { '0,60,0': 'air', '0,61,0': 'air' }, at: V(0, 60, 0), slots: { 36: ['stone_pickaxe', 1] } });
    assert.ok(4 < DUSK_SEAL.minDepth);
    assert.equal(duskSealDue(shallow.bot, { budget: { kind: 'day' } }), null);
});

// ---- E(4)(i): no flee walk while climbing out ----
function arena({ inReach = true } = {}) {
    __resetThreatLease();
    let id = 1;
    const self = { id: 0, name: 'player', type: 'player', position: V(0, 64, 0), height: 1.8 };
    const zombies = [inReach ? 1.5 : 5, 5.5, 6].map(x => ({ id: id++, name: 'zombie', type: 'mob', position: V(x, 64, 0), height: 1.8 }));
    const bot = {
        username: 'FRCFLD', entity: self, entities: { 0: self, ...Object.fromEntries(zombies.map(z => [z.id, z])) },
        health: 20, isAlive: true, lastDamageTime: -1e9, lastDamageTaken: 0, blockAt: () => null, clearControlStates() {}, setControlState() {},
        inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] }, heldItem: null,
        pathfinder: { goal: null, getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; } },
        modes: { behavior_log: '' }, rotnClimbing: true,
    };
    bot.nearestEntity = (match = () => true) => zombies.filter(z => match(z)).sort((a, b) => a.position.distanceTo(self.position) - b.position.distanceTo(self.position))[0] ?? null;
    const ran = [];
    const agent = { bot, shut_up: true, openChat() {}, isIdle: () => true,
        actions: { resume_func: null, currentActionLabel: '', runAction(label) { ran.push(label); return new Promise(() => {}); } } };
    return { agent, ran };
}

test('soak 17 E(4)(i): climbing out, outnumbered: no flee walk; the zombie in reach is fought in place (none in reach: nothing interrupts the climb)', async (t) => {
    const lines = [];
    quiet(t, lines);
    const far = arena({ inReach: false });
    assert.equal(holdsInPlace(far.agent.bot), true);
    await __modeForTest('cowardice').update(far.agent);
    await flush();
    assert.deepEqual(far.ran, [], 'no action: the climb goes on');
    assert.ok(lines.some(l => /^\[survival\] climbing out of a hole: no flee walk from the zombie \(outnumbered\); nothing in reach yet$/.test(l)), lines.join('\n'));
    assert.ok(!lines.some(l => /^\[survival\] flee /.test(l)), 'never the flee line');
    lines.length = 0;
    await new Promise(r => setTimeout(r, 0));
    const near = arena({ inReach: true });
    // The line is said at most every HOLD_SAY_MS; the fight starts all the same.
    await __modeForTest('cowardice').update(near.agent);
    await flush();
    assert.deepEqual(near.ran, ['mode:cowardice'], 'one action: the fight in place');
    __modeForTest('cowardice').active = false;
    // Not climbing and not trapped: the flee as before.
    const free = arena({ inReach: false });
    free.agent.bot.rotnClimbing = false;
    assert.equal(holdsInPlace(free.agent.bot), false);
});

// ---- #668 review (soak 17, 18:07:34-35): the standing goal while trapped, and a command during the escape ----
test('#668 review: trapped or escaping, the standing goal offers only the way out (18:07:34 also said "craft it with !craftRecipe(\\"cobblestone\\", 5)")', async () => {
    const { agendaGoal } = await import('./agenda_driver.js');
    const step = { id: 'shelter_blocks', goal: 'Night is near: craft it with !craftRecipe("cobblestone", 5).' };
    const agenda = { steps: [step] };
    const trapped = agendaGoal(agenda, step, { trapped: () => V(80, 46, 71), escaping: () => false });
    assert.match(trapped, /You are trapped at 80, 46, 71 .*get out first with !goToSurface .*Only that until you are out; this step comes back then\./);
    assert.doesNotMatch(trapped, /craftRecipe|collectBlocks|Then:/);
    const escaping = agendaGoal(agenda, step, { trapped: () => V(80, 46, 71), escaping: () => true });
    assert.match(escaping, /The escape is getting you out of 80, 46, 71 right now: let it finish\. Send no command that digs, crafts, collects or walks until it says you are out \(such a command waits for it\)\./);
    assert.doesNotMatch(escaping, /craftRecipe|!goToSurface/);
    assert.match(agendaGoal(agenda, step, { trapped: () => null, escaping: () => false }), /craftRecipe\("cobblestone", 5\)/, 'out: the step as before');
});

test('#668 review: a command sent while the escape climbs out waits for it (no interrupt), then runs; a reflex still interrupts', async (t) => {
    const lines = [];
    quiet(t, lines);
    const { ActionManager, ESCAPE_WAIT } = await import('./action_manager.js');
    const { ESCAPE_DAY } = await import('./library/escape.js');
    assert.ok(ESCAPE_WAIT.maxMs >= ESCAPE_DAY.totalMs, 'the wait covers a whole day escape');
    const bot = { interrupt_code: false, output: '', emit() {} };
    const agent = { bot, clearBotLogs() {}, cleanKill() {}, requestInterrupt() { bot.interrupt_code = true; } };
    const manager = new ActionManager(agent);
    const order = [];
    const escapeJob = async () => {
        bot.rotnClimbing = true;
        for (let i = 0; i < 6 && !bot.interrupt_code; i++) await new Promise(r => setTimeout(r, 25));
        order.push(bot.interrupt_code ? 'escape interrupted' : 'escape done');
        bot.rotnClimbing = false;
    };
    const escapeRun = manager.runAction('action:escape (trapped)', escapeJob, { timeout: 0 });
    await new Promise(r => setTimeout(r, 20));
    const craft = manager.runAction('action:craftRecipe', () => { order.push('craft'); return Promise.resolve(); }, { timeout: 0 });
    const [er] = await Promise.all([escapeRun, craft]);
    assert.deepEqual(order, ['escape done', 'craft']);
    assert.equal(er.interrupted, false);
    assert.ok(lines.some(l => /^\[action\] "action:craftRecipe" waits for the escape \("action:escape \(trapped\)"\) to end: getting out comes first$/.test(l)), lines.join('\n'));
    // A reflex (mode:) interrupts as before.
    order.length = 0;
    bot.interrupt_code = false;
    const again = manager.runAction('action:escape (trapped)', escapeJob, { timeout: 0 });
    await new Promise(r => setTimeout(r, 20));
    await Promise.all([again, manager.runAction('mode:self_preservation', () => { order.push('reflex'); return Promise.resolve(); }, { timeout: 0 })]);
    assert.deepEqual(order, ['escape interrupted', 'reflex']);
});
