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

test('soak 17 E(1), #667 review 5: the table chain\'s numbers are rotn-data\'s, both ways: exactly these fill each recipe, one less of any input does not', (t) => {
    quiet(t);
    const ready = (slots, name) => { const w = fakeWorld({ slots }); useRegistry(t, w.bot); return craftNeeds(w.bot, name)?.ready; };
    const [axe, tools, table] = TABLE_CHAIN;
    // Each step's inputs: [item, count]; the previous step's result counts 1.
    const inputs = {
        [axe.item]: [['pyrotech:rock', axe.rocks], ['stick', axe.sticks]],
        [tools.item]: [['pyrotech:crude_axe', 1], ['pyrotech:rock', tools.rocks], ['stick', tools.sticks]],
        [table.item]: [['contenttweaker:crafting_tools', 1], ['planks', table.planks]],
    };
    for (const [item, list] of Object.entries(inputs)) {
        const slots = (minus = -1) => Object.fromEntries(list.map(([n, c], i) => [9 + i, [n, c - (i === minus ? 1 : 0)]]).filter(([, [, c]]) => c > 0));
        assert.equal(ready(slots(), item), true, `${item}: exactly the chain's inputs fill it`);
        list.forEach(([n], i) => assert.equal(ready(slots(i), item), false, `${item}: one ${n} less does not`));
    }
    // (Whether the server takes a stone axe for the tools, as rotn-data's recipe lists it, is soak 17's L4 question: the
    // chain always makes the crude axe, which soak 17's 18:06 craft showed works.)
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

// ---- #667 review round 1 ----
test('#667 review 1: a command waiting for the escape is not run when the escape is stopped (!stop, a death) or a reflex takes over', async (t) => {
    const lines = [];
    quiet(t, lines);
    const { ActionManager } = await import('./action_manager.js');
    for (const how of ['stop', 'death', 'reflex']) {
        const bot = { interrupt_code: false, output: '', emit() {}, health: 20 };
        const agent = { bot, clearBotLogs() {}, cleanKill() {}, requestInterrupt() { bot.interrupt_code = true; } };
        const manager = new ActionManager(agent);
        const order = [];
        const escapeJob = async () => {
            bot.rotnClimbing = true;
            for (let i = 0; i < 40 && !bot.interrupt_code; i++) await new Promise(r => setTimeout(r, 25));
            order.push(bot.interrupt_code ? 'escape stopped' : 'escape done');
            bot.rotnClimbing = false;
        };
        const escapeRun = manager.runAction('action:escape (trapped)', escapeJob, { timeout: 0 });
        await new Promise(r => setTimeout(r, 20));
        const craft = manager.runAction('action:craftRecipe', () => { order.push('craft'); return Promise.resolve(); }, { timeout: 0 });
        await new Promise(r => setTimeout(r, 60));
        let reflex = null;
        if (how === 'stop') await manager.stop(); // !stop, the night routine's dusk stop
        else if (how === 'death') { bot.health = 0; await manager.stop(); } // agent.js: the death stops the action
        else reflex = manager.runAction('mode:self_preservation', () => { order.push('reflex'); return Promise.resolve(); }, { timeout: 0 });
        const [, cr] = await Promise.all([escapeRun, craft, reflex]);
        assert.ok(!order.includes('craft'), `${how}: the queued craft did not run (${order.join(', ')})`);
        assert.equal(cr.interrupted, true, how);
        assert.match(cr.message, /^Not run: it waited for the escape, which ended otherwise \(.+\)\. Send it again if it still fits\.$/, how);
    }
});

test('#667 review 2: the dusk seal only when one is possible; a seal that does not close goes on climbing', async (t) => {
    const lines = [];
    quiet(t, lines);
    // No blocks to seal with (an empty-handed respawn) in a shaft open to the sky (its roof cell must be filled): no seal,
    // the climb goes on.
    const { openShaft } = await import('../../test/fixtures/fake-world.mjs');
    const bare = openShaft(); // the fixture's 6000: dusk on RotN's clock; 12 deep
    useRegistry(t, bare.bot);
    let seals = 0;
    const r = await escape(bare.bot, { budget: 'day', target: surfaceTarget(bare.bot), seal: () => { seals++; return Promise.resolve({ closed: true }); }, say: (l) => lines.push(l) });
    assert.equal(seals, 0, 'not tried');
    assert.ok(lines.some(l => /^\[escape\] it is dusk and the bot is still \d+ below the surface at 0, 52, 0, but no seal is possible here \(it needs \d+ blocks and you carry 0\): climbing on$/.test(l)), lines.join('\n'));
    assert.notEqual(r.dusk, true);
    assert.ok(bare.calls.dug.length > 0, 'it climbed');
    // Possible but it does not close: said, and the climb goes on.
    const lines2 = [];
    const w = pocketUnderRock({ slots: { 36: ['stone_pickaxe', 1], 9: ['dirt', 16] } });
    const r2 = await escape(w.bot, { budget: 'day', target: surfaceTarget(w.bot), seal: () => Promise.resolve({ closed: false, line: 'the roof did not stay' }), say: (l) => lines2.push(l) });
    assert.ok(lines2.some(l => /^\[escape\] the seal at 0, 56, 0 did not close \(the roof did not stay\): climbing on$/.test(l)), lines2.join('\n'));
    assert.notEqual(r2.dusk, true);
    assert.ok(w.calls.dug.length > 0);
    assert.equal(w.bot.rotnSealedIn ?? null, null);
    // Closed: the cell is marked for the night routine.
    const w3 = pocketUnderRock({ slots: { 36: ['stone_pickaxe', 1], 9: ['dirt', 16] } });
    const r3 = await escape(w3.bot, { budget: 'day', target: surfaceTarget(w3.bot), seal: () => Promise.resolve({ closed: true }), say: () => {} });
    assert.deepEqual([r3.dusk, r3.sealed], [true, true]);
    assert.equal(w3.bot.rotnSealedIn.pos.toString(), '(0, 56, 0)');
});

test('#667 review 4: no pickaxe re-made with a hostile near (a real scan); once it is clear, it is', async (t) => {
    const lines = [];
    quiet(t, lines);
    const used = 131 + 1 - walkKeep({ name: 'stone_pickaxe' });
    const bag = { 36: ['stone_pickaxe', 1, used], 9: ['undergroundbiomes:metamorphic_cobble', 8], 11: ['planks', 4], 12: ['crafting_table', 1], 13: ['dirt', 6] };
    const w = pocketUnderRock({ slots: bag, set: { '0,56,0': 'air', '0,57,0': 'air', '1,56,0': 'air' }, timeOfDay: MORNING });
    useRegistry(t, w.bot);
    const zombie = w.addEntity ? w.addEntity({ name: 'zombie', type: 'mob', position: V(4, 56, 0) }) : null;
    if (!zombie) w.bot.entities[99] = { id: 99, name: 'zombie', type: 'mob', position: V(4, 56, 0), height: 1.95 };
    const crafts = [];
    const craft = (bot, item, n) => { crafts.push(item); w.give(item, item === 'stone_pickaxe' ? 1 : 4 * n); return Promise.resolve(true); };
    await escape(w.bot, { budget: 'day', target: surfaceTarget(w.bot), craft, say: (l) => lines.push(l) });
    assert.ok(!crafts.includes('stone_pickaxe'), `no craft with the zombie near: ${crafts.join(', ')}`);
    assert.ok(lines.some(l => /not making another with a zombie within 16 blocks \(later, once it is clear\)/.test(l)), lines.join('\n'));
});

/** A 1x1 shaft in stone from (0, 29, 0) up to the surface (y 64), the seal's roof (dirt) over the head; the night agent. */
async function sealedShaft(t, { food = 20, slots = {} } = {}) {
    const { NIGHT_START, TICKS_PER_MIN } = await import('./library/night.js');
    const set = {};
    for (let y = 29; y < 64; y++) set[`0,${y},0`] = 'air';
    set['0,31,0'] = 'dirt';
    const w = fakeWorld({ ground: [{ below: 64, block: 'undergroundbiomes:metamorphic_stone' }], set, at: V(0, 29, 0), slots: { 36: ['stone_pickaxe', 1], 9: ['dirt', 20], ...slots }, timeOfDay: NIGHT_START - 3 * TICKS_PER_MIN, food });
    useRegistry(t, w.bot);
    const bot = w.bot;
    bot.rotnSealedIn = { pos: V(0, 29, 0), at: 0 };
    bot.modes = { anyActive: () => false };
    const chat = [];
    const agent = {
        bot, openChat: (l) => chat.push(l),
        self_prompter: { active: false, loop_active: false, isActive() { return this.active; }, stop() { this.active = false; }, isPaused: () => false },
        actions: { executing: false, currentActionLabel: '', stop() { return Promise.resolve(); }, async runAction(label, fn) { await fn(); return { message: '', interrupted: false }; } },
        control: { blocking: () => null },
    };
    const calls = { builds: [], foodRuns: [], escapes: [] };
    const lines = [];
    const ops = {
        buildShelter: (b, opts) => { calls.builds.push(opts); return Promise.resolve({ closed: true, feet: b.entity.position.floored() }); },
        foodRun: () => { calls.foodRuns.push(1); return Promise.resolve({ points: 0, why: 'none found' }); },
        siteNeeds: () => ({ todo: [] }),
        escape: (b, opts) => { calls.escapes.push(opts); return escape(b, { ...opts, say: (l) => lines.push(l) }); },
    };
    return { w, bot, agent, chat, calls, ops, lines };
}

test('#667 review 3, round 2 (the lead): a well-fed bot sealed in a 35-deep shaft at dusk: the night routine adopts the cell (no build, no food run), and the morning climbs out', async (t) => {
    quiet(t);
    const { nightTick, nightState } = await import('./night_routine.js');
    const { bot, agent, chat, calls, ops, lines } = await sealedShaft(t, { food: 20, slots: { 10: ['bread', 6] } });
    const settle = async () => { while (nightState(agent).job) await nightState(agent).job; };
    // The routine's own times (its clock reads them; the escape reads that clock at Date.now(), as in the bot).
    assert.equal(nightTick(agent, { now: Date.now(), ops }), 'night:inside');
    assert.ok(chat.some(l => /^\[night\] sunset is near: sealed in the shaft at 0, 29, 0 \(the escape's seal\): tonight's shelter as it is$/.test(l)), chat.join('\n'));
    bot.time.timeOfDay = 15000;
    for (let i = 1; i <= 4; i++) { nightTick(agent, { now: Date.now(), ops }); await settle(); }
    assert.deepEqual([calls.builds.length, calls.foodRuns.length, calls.escapes.length], [0, 0, 0], 'kept as it is all night');
    assert.equal(nightState(agent).state, 'inside');
    // The morning: the escape (the day budget) climbs out of the shaft.
    bot.time.timeOfDay = 1000;
    nightTick(agent, { now: Date.now(), ops });
    await settle();
    assert.equal(calls.escapes.length, 1);
    assert.equal(calls.escapes[0].budget, 'day');
    assert.ok(bot.entity.position.y >= 63, `out at ${bot.entity.position}: ${lines.filter(l => /\[escape\]/.test(l)).slice(-3).join(' / ')}`);
    assert.ok(chat.some(l => /^\[night\] morning: climbed out of the shaft at 0, 29, 0 to /.test(l)), chat.join('\n'));
    assert.equal(nightState(agent).state, 'day');
    assert.equal(bot.rotnSealedIn, null);
});

test('#667 round 2 (the lead): food 4 with nothing held is not sealed (the escape climbs on), and the sealed cell is not adopted (out first)', async (t) => {
    const lines = [];
    quiet(t, lines);
    // The escape: no seal with the food short.
    const w = pocketUnderRock({ slots: { 36: ['stone_pickaxe', 1], 9: ['dirt', 16] }, food: 4 });
    useRegistry(t, w.bot);
    let seals = 0;
    await escape(w.bot, { budget: 'day', target: surfaceTarget(w.bot), seal: () => { seals++; return Promise.resolve({ closed: true }); }, say: (l) => lines.push(l) });
    assert.equal(seals, 0);
    assert.ok(lines.some(l => /no seal is possible here \(the food held \(0 points\) does not cover the night \(about [\d.]+ more than your bar\)\): climbing on$/.test(l)), lines.join('\n'));
    // The night routine: a sealed cell at dusk with food 4 and nothing held: out first, then the normal rules.
    const { nightTick, nightState } = await import('./night_routine.js');
    const s = await sealedShaft(t, { food: 4 });
    nightTick(s.agent, { now: Date.now(), ops: s.ops });
    while (nightState(s.agent).job) await nightState(s.agent).job;
    assert.equal(s.calls.escapes.length, 1, 'the climb out first');
    assert.ok(s.chat.some(l => /^\[night\] the food held \(0 points\) does not cover the night \(about [\d.]+\) in the sealed shaft at 0, 29, 0: climbing out now with the escape, then the night's food rules$/.test(l)), s.chat.join('\n'));
    assert.equal(s.bot.rotnSealedIn, null);
    assert.ok(s.bot.entity.position.y >= 63, `out at ${s.bot.entity.position}`);
});

test('#667 round 2 (the lead): sealed (well fed at dusk), the night\'s food emergency still comes: the bot climbs out at once and the normal food path goes on', async (t) => {
    quiet(t);
    const { nightTick, nightState } = await import('./night_routine.js');
    const s = await sealedShaft(t, { food: 20, slots: { 10: ['bread', 6] } });
    const settle = async () => { while (nightState(s.agent).job) await nightState(s.agent).job; };
    assert.equal(nightTick(s.agent, { now: Date.now(), ops: s.ops }), 'night:inside');
    // Night: the bread is gone, food 4.
    s.bot.time.timeOfDay = 15000;
    s.bot.food = 4;
    s.bot.inventory.slots[10] = null;
    nightTick(s.agent, { now: Date.now(), ops: s.ops });
    await settle();
    assert.equal(s.calls.escapes.length, 1, 'out at once');
    assert.ok(s.chat.some(l => /^\[night\] food 4 with nothing held in the sealed shaft at 0, 29, 0: climbing out now with the escape, then the night's food rules$/.test(l)), s.chat.join('\n'));
    assert.equal(s.bot.rotnSealedIn, null);
    for (let i = 0; i < 3 && !s.calls.foodRuns.length; i++) { nightTick(s.agent, { now: Date.now(), ops: s.ops }); await settle(); }
    assert.ok(s.calls.foodRuns.length >= 1, 'the normal emergency food run');
});

test('#667 round 2 nit: two commands waiting for an escape that ends by itself: the second is not dropped by the first', async (t) => {
    quiet(t);
    const { ActionManager } = await import('./action_manager.js');
    const bot = { interrupt_code: false, output: '', emit() {}, health: 20 };
    const agent = { bot, clearBotLogs() { bot.interrupt_code = false; }, cleanKill() {}, requestInterrupt() { bot.interrupt_code = true; } };
    const manager = new ActionManager(agent);
    const order = [];
    const escapeRun = manager.runAction('action:escape (trapped)', async () => { bot.rotnClimbing = true; await new Promise(r => setTimeout(r, 120)); order.push('escape done'); bot.rotnClimbing = false; }, { timeout: 0 });
    await new Promise(r => setTimeout(r, 20));
    const first = manager.runAction('action:craftRecipe', () => { order.push('craft'); return Promise.resolve(); }, { timeout: 0 });
    await new Promise(r => setTimeout(r, 20));
    const second = manager.runAction('action:collectBlocks', () => { order.push('collect'); return Promise.resolve(); }, { timeout: 0 });
    const [, , r2] = await Promise.all([escapeRun, first, second]);
    assert.equal(order[0], 'escape done');
    assert.ok(order.includes('collect'), `the second waiter ran: ${order.join(', ')}`);
    assert.doesNotMatch(r2.message ?? '', /^Not run/);
});
