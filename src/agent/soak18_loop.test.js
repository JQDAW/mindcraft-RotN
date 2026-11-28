// Soak 18 S18a (/home/rv/s18-plan-skills.md A and B): the sword loop (26 calls, 25% of the soak's spend). A: the
// standing goal's tools clause from what the bot carries (never the stone sword; a stone axe or better is the weapon
// done; no invitation to a craft whose input came up empty). B: the facts line keeps a sticky failure's short line,
// and the model's own "X can wait" decisions. From test/evidence/g4/g4soak-18-20261127/driver.log (dl). Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { fakeWorld } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { Agenda, STANDING_GOAL_PREFIX, toolsClause } from './agenda.js';
import { agendaState, freshGoalText, craftDeadEnd } from './agenda_driver.js';
import { emptyFacts, recordFailure, recordDecision, recordTouch, decidedOn, buildMemory, MEMORY_FACTS } from './memory_facts.js';
import { executeCommand } from './commands/index.js';

const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };
const MIN = 60_000;
/** The standing goal text for a fake world's bot (agenda.standingGoal with the driver's state). */
const goalFor = (bot, facts = null) => new Agenda('FRCFLD', { dir: '/nonexistent/s18a', steps: [] }).standingGoal(agendaState(bot, null, facts));
// dl:2623's standing goal, word for word (the old static clause).
const OLD_GOAL = "Standing goal (the agenda is done): keep food worth at least 12 points (you hold 30.3) and 14 blocks for the night's shelter and its repairs (you have 13; cobblestone first); keep a weapon and a pickaxe, and make better ones when you can (a stone sword or axe, a spare pickaxe); explore by day within 64 blocks of your last shelter at -105, 69, -161, away from where you died (a zombie rises there and stays); be back near it before dusk: the night routine builds the shelter then.";

// ---- A: the tools clause ----
test('S18a A dl:2623: holding the club, a stone axe and two stone pickaxes, the goal says they are enough; no sword, no "make better ones"', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 37: ['stone_axe', 1], 38: ['stone_pickaxe', 1], 45: ['stone_pickaxe', 1] } });
    useRegistry(t, w.bot);
    const goal = goalFor(w.bot);
    assert.ok(goal.startsWith(STANDING_GOAL_PREFIX));
    assert.match(goal, /keep a weapon and a pickaxe: your weapon \(stone_axe\) and 2 pickaxes are enough: keep them, and replace one that breaks; explore by day/);
    assert.doesNotMatch(goal, /sword|make better/);
    assert.match(goal, /\(you hold [0-9.]+\)/, 'the food figure, as the checker reads it');
    assert.match(goal, /\(you have \d+; /, 'the shelter blocks figure, as the checker reads it');
});

test('S18a A: the club only: make a stone axe (the weapon to have); one pickaxe: a spare; none: a stone pickaxe', (t) => {
    quiet(t);
    const club = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1] } });
    useRegistry(t, club.bot);
    assert.match(goalFor(club.bot), /keep a weapon and a pickaxe: make a stone axe when you can \(3 rocks and 2 sticks at a crafting table\): it is the weapon to have; /);
    const one = fakeWorld({ slots: { 37: ['stone_axe', 1], 38: ['stone_pickaxe', 1] } });
    __setRegistryForTest(one.bot.registry);
    assert.match(goalFor(one.bot), /keep a weapon and a pickaxe: make a spare stone pickaxe when you can \(3 rocks and 2 sticks at a crafting table\); /);
    const none = fakeWorld({ slots: { 37: ['stone_axe', 1] } });
    __setRegistryForTest(none.bot.registry);
    assert.match(goalFor(none.bot), /keep a weapon and a pickaxe: make a stone pickaxe when you can/);
    for (const w of [club, one, none]) assert.doesNotMatch(goalFor(w.bot), /sword/);
});

test('S18a A: no invitation to a dead end: a craft whose missing input a collect just found none of says so instead (dl:1294 tinder; here rocks)', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 10: ['stick', 4], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1] } });
    useRegistry(t, w.bot);
    const now = Date.now();
    w.bot.rotnCollects = [{ item: 'pyrotech:rock', got: 0, wanted: 3, reason: 'none', range: 64, at: now - 12 * MIN }];
    assert.deepEqual(craftDeadEnd(w.bot, 'stone_axe', now), { item: 'pyrotech:rock', range: 64, at: now - 12 * MIN });
    assert.match(goalFor(w.bot), /keep a weapon and a pickaxe: a stone axe not now \(no pyrotech:rock found within 64, 12 min ago: leave it until you see some\); /);
    // 31 min ago: no longer a dead end.
    w.bot.rotnCollects[0].at = now - 31 * MIN;
    assert.equal(craftDeadEnd(w.bot, 'stone_axe', now), null);
    assert.match(goalFor(w.bot), /make a stone axe when you can/);
});

test('S18a A: a craft the model decided can wait is not suggested again (only A\'s list acts on a decision)', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1] } });
    useRegistry(t, w.bot);
    const facts = emptyFacts();
    recordDecision(facts, 'Rocks are far, so the stone axe can wait. Exploring: !moveAway(20)');
    assert.match(goalFor(w.bot, facts), /keep a weapon and a pickaxe: a stone axe can wait \(you decided: 'the stone axe can wait'\); /);
});

test('S18a A: freshGoalText swaps the tools clause for what the bot carries now; the drivers\' identity follows', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1] } });
    useRegistry(t, w.bot);
    const agent = { bot: w.bot, history: { facts: emptyFacts() } };
    const before = goalFor(w.bot);
    assert.match(before, /make a stone axe when you can/);
    agent._autonomy_prompt = before;
    // A stone axe crafted between turns: the same bot with it (a second fake world).
    const axe = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 37: ['stone_axe', 1], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1] } });
    __setRegistryForTest(axe.bot.registry);
    agent.bot = axe.bot;
    const after = freshGoalText(agent, before);
    assert.match(after, /keep a weapon and a pickaxe: your weapon \(stone_axe\) and 2 pickaxes are enough/);
    assert.equal(agent._autonomy_prompt, after, 'the identity follows the new text: no goal restart');
    assert.equal(after.replace(/keep a weapon and a pickaxe: [^;]*;/, ''), before.replace(/keep a weapon and a pickaxe: [^;]*;/, ''), 'only the clause changed');
    assert.equal(freshGoalText(agent, OLD_GOAL).includes('a stone sword or axe'), true, 'an old prompt without the new head is left as it was');
});

test('S18a A: toolsClause with a state that knows nothing says to keep them; no ";" in any clause', () => {
    assert.equal(toolsClause({}), 'keep a weapon and a pickaxe: keep them, and replace one that breaks');
    const cases = [
        { weaponRank: () => 2, pickaxeCount: () => 0 },
        { weaponRank: () => 2, pickaxeCount: () => 1, decided: () => 'a; b' },
        { weaponRank: () => 6, pickaxeCount: () => 3, bestWeapon: () => 'iron_axe' },
    ];
    for (const c of cases) assert.doesNotMatch(toolsClause(c).slice('keep a weapon and a pickaxe: '.length), /;/);
});

// ---- B: the failure budget ----
/** dl:2154's stored failures (times relative to 21:39:08), recorded as the command layer does (K1's merge applies). */
function dl2154(facts, t0) {
    const at = (min) => t0 - min * MIN;
    const p = new Vec3(-169, 69, -133);
    recordFailure(facts, { cmd: '!craftRecipe("stone_sword", 1)', why: 'You do not have the resources to craft stone_sword. To craft stone_sword (at a crafting table): 2 rock: you have 2 pyrotech_compat:rock_igneous (enough); 1 spartanweaponry:material:0: you have none, so get 1 spartanweaponry:material:0.', code: 'missing', pos: p, at: at(36) });
    recordFailure(facts, { cmd: '!collectBlocks("pyrotech:tinder", 3)', why: 'Collected 0 pyrotech:tinder.', pos: p, at: at(35.3) });
    recordFailure(facts, { cmd: '!collectBlocks("cobblestone", 8)', why: 'Collected 0 cobblestone.', pos: new Vec3(-121, 67, -129), at: at(3.2) });
    recordFailure(facts, { cmd: '!collectBlocks("pyrotech_compat:rock_igneous", 1)', why: 'Collected 0 pyrotech_compat:rock_igneous.', pos: new Vec3(-125, 69, -136), at: at(3.1) });
    recordFailure(facts, { cmd: '!collectBlocks("pyrotech_compat:rock_igneous", 1)', why: 'Collected 0 pyrotech_compat:rock_igneous.', pos: new Vec3(-135, 67, -135), at: at(2.9) });
    recordFailure(facts, { cmd: '!craftRecipe("undergroundbiomes:igneous_cobble", 1)', why: 'You do not have the resources to craft undergroundbiomes:igneous_cobble. To craft undergroundbiomes:igneous_cobble: 4 pyrotech_compat:rock_igneous: you have 3, so get 1 more.', code: 'missing', pos: new Vec3(-135, 67, -135), at: at(2.1) });
    recordFailure(facts, { cmd: '!collectBlocks("pyrotech_compat:rock_igneous", 1)', why: 'Collected 0 pyrotech_compat:rock_igneous.', pos: new Vec3(-142, 66, -136), at: at(1.2) });
}
const failuresOf = (mem) => mem.split('\n').slice(mem.split('\n').indexOf('Recent failures (newest first):') + 1).filter(l => l.startsWith('!'));

test('S18a B dl:2154 (pin of K1): K1\'s merge makes the three igneous misses one x3 line, and that alone brings both old failures back', (t) => {
    const t0 = Date.now();
    const here = { entity: { position: new Vec3(-142, 66, -136) } };
    const facts = emptyFacts();
    dl2154(facts, t0);
    // K1 alone: an old line's why as long as a fresh one's (B's shortWhyMax off), no goal, no touch.
    const short = MEMORY_FACTS.shortWhyMax;
    MEMORY_FACTS.shortWhyMax = 1000;
    t.after(() => { MEMORY_FACTS.shortWhyMax = short; });
    const shown = failuresOf(buildMemory({ bot: here }, { facts, now: t0 }));
    assert.equal(shown.filter(l => /rock_igneous", 1\) x3:/.test(l)).length, 1, shown.join('\n'));
    assert.ok(shown.some(l => /stone_sword/.test(l)) && shown.some(l => /pyrotech:tinder/.test(l)), shown.join(' | '));
});

/** dl:2154 with five different fresh failures (nothing for K1 to merge): the case B is for. */
function dl2154Distinct(facts, t0) {
    dl2154(facts, t0);
    facts.failures = facts.failures.filter(e => !/rock_igneous/.test(e.cmd));
    const p = new Vec3(-135, 67, -135);
    for (const [cmd, min] of [['!collectBlocks("pyrotech_compat:rock_igneous", 1)', 3.1], ['!collectBlocks("pyrotech_compat:rock_igneous", 2)', 2.9], ['!collectBlocks("pyrotech:rock", 1)', 1.2]])
        recordFailure(facts, { cmd, why: `Collected 0 ${/rock_igneous/.test(cmd) ? 'pyrotech_compat:rock_igneous' : 'pyrotech:rock'}.`, pos: p, at: t0 - min * MIN });
    facts.failures.sort((x, y) => x.at - y.at);
}

test('S18a B: five different fresh failures: K1 alone hides the sword craft (as at dl:2154 live); B\'s short old lines show it', (t) => {
    const t0 = Date.now();
    const here = { entity: { position: new Vec3(-142, 66, -136) } };
    const facts = emptyFacts();
    dl2154Distinct(facts, t0);
    const short = MEMORY_FACTS.shortWhyMax;
    MEMORY_FACTS.shortWhyMax = 1000;
    t.after(() => { MEMORY_FACTS.shortWhyMax = short; });
    let shown = failuresOf(buildMemory({ bot: here }, { facts, now: t0 }));
    assert.equal(shown.filter(l => /\(\d min ago|just now/.test(l)).length, 5, shown.join('\n'));
    assert.ok(!shown.some(l => /stone_sword/.test(l)), `K1 alone: ${shown.join(' | ')}`);
    MEMORY_FACTS.shortWhyMax = short;
    shown = failuresOf(buildMemory({ bot: here, self_prompter: { prompt: OLD_GOAL } }, { facts, now: t0 }));
    assert.ok(shown.some(l => /stone_sword/.test(l)), shown.join(' | '));
});

test('S18a B dl:2154: the sword craft is sticky by the goal text (dl:2623 names a stone sword), by a touch after it, or by a decision; its line is short', () => {
    const t0 = Date.now();
    const here = { entity: { position: new Vec3(-142, 66, -136) } };
    const byGoal = emptyFacts();
    dl2154Distinct(byGoal, t0);
    let shown = failuresOf(buildMemory({ bot: here, self_prompter: { prompt: OLD_GOAL } }, { facts: byGoal, now: t0 }));
    const sword = shown.find(l => /stone_sword/.test(l));
    assert.ok(sword, shown.join(' | '));
    assert.match(sword, /^!craftRecipe\("stone_sword", 1\): You do not have the resources to craf\.\.\. \(36 min ago at -169, 69, -133, /, sword);
    assert.ok(shown.join('\n').length + shown.length <= MEMORY_FACTS.failuresChars + 2 * MEMORY_FACTS.failureLineMax);
    // A touch: the model's !getCraftingPlan("stone_sword", 1) after the failure, within 15 min (round 3, dl:2638).
    const byTouch = emptyFacts();
    dl2154Distinct(byTouch, t0);
    recordTouch(byTouch, '!getCraftingPlan("stone_sword", 1)', t0 - 4 * MIN);
    shown = failuresOf(buildMemory({ bot: here }, { facts: byTouch, now: t0 }));
    assert.ok(shown.some(l => /stone_sword/.test(l)), shown.join(' | '));
    // A decision (dl:2672) on the sword.
    const byDecision = emptyFacts();
    dl2154Distinct(byDecision, t0);
    recordDecision(byDecision, 'Tinder can\'t be crafted — needs finding. But I already hold a stone axe and two pickaxes, so a stone sword can wait. Heading back: !goToCoordinates(-105, 69, -161, 16)', t0 - MIN);
    shown = failuresOf(buildMemory({ bot: here }, { facts: byDecision, now: t0 }));
    assert.ok(shown.some(l => /stone_sword/.test(l)), shown.join(' | '));
});

test('S18a B: at most 2 sticky lines; a failure past 5 min has a short why; the rest within the 600 chars as before', () => {
    const t0 = Date.now();
    const facts = emptyFacts();
    for (let i = 0; i < 5; i++) recordFailure(facts, { cmd: `!craftRecipe("stone_axe_${i}", 1)`, why: 'x'.repeat(90), at: t0 - (40 + i) * MIN });
    for (let i = 0; i < 5; i++) recordTouch(facts, `!getCraftingPlan("stone_axe_${i}", 1)`, t0 - MIN);
    for (let i = 0; i < 6; i++) recordFailure(facts, { cmd: `!collectBlocks("rock${i}", 1)`, why: 'y'.repeat(90), at: t0 - (i + 1) * 20_000 });
    const shown = failuresOf(buildMemory({}, { facts, now: t0 }));
    assert.equal(shown.filter(l => /stone_axe_/.test(l)).length, 2, shown.join('\n'));
    for (const l of shown.filter(l => /stone_axe_/.test(l))) assert.match(l, /: x{37}\.\.\. \(4\d min ago\)$/);
    assert.ok(shown.filter(l => /rock/.test(l)).length >= 2, 'the fresh ones fill the rest');
});

// ---- B: the model's own decisions ----
test('S18a B dl:2237, dl:2672, dl:2954: the model\'s "drop the X hunt" and "X can wait" are kept (2, 60 min) and shown; round 5 (dl:3005) would see the last', () => {
    const t0 = Date.now();
    const facts = emptyFacts();
    recordDecision(facts, 'Already hold a stone axe and club — that covers the weapon goal, so I\'ll drop the sword hunt. Heading back into the 64-block range of my shelter: !goToCoordinates(-71, 63, -146, 30)', t0 - 37 * MIN);
    assert.deepEqual(facts.decisions.map(d => [d.subject, d.words]), [['sword', 'drop the sword hunt']]);
    recordDecision(facts, 'Tinder can\'t be crafted — needs finding. But I already hold a stone axe and two pickaxes, so a stone sword can wait. Heading back toward the shelter to explore that side before dusk: !goToCoordinates(-105, 69, -161, 16)', t0 - 3 * MIN);
    recordDecision(facts, 'Axe already counts as the "better one," and the club covers the weapon — sword can wait until tinder shows up. Daylight\'s for exploring, so foraging for food as I go: !forage', t0 - 30_000);
    assert.equal(facts.decisions.length, 2);
    assert.deepEqual(facts.decisions.map(d => d.words), ['a stone sword can wait', 'sword can wait']);
    assert.equal(decidedOn(facts, 'stone_sword', t0), 'sword can wait');
    assert.equal(decidedOn(facts, 'stone_axe', t0), null, 'a stone axe was not decided on');
    const mem = buildMemory({}, { facts, now: t0 });
    assert.match(mem, /^Your decisions: 'sword can wait' \(just now\); 'a stone sword can wait' \(3 min ago\)$/m);
    assert.equal(decidedOn(facts, 'stone_sword', t0 + 61 * MIN), null, 'kept 60 min');
    assert.doesNotMatch(buildMemory({}, { facts, now: t0 + 61 * MIN }), /Your decisions/);
});

test('S18a B: only those phrases; words after a command are not read; a reply with none records nothing', () => {
    const facts = emptyFacts();
    recordDecision(facts, 'Got 7 more rocks. Crafting cobblestone now: !craftRecipe("cobblestone", 1)');
    recordDecision(facts, 'The food goal is fine and the sword is good. !moveAway(5) the stone axe can wait');
    assert.deepEqual(facts.decisions, []);
    recordDecision(facts, 'Shelter first; the stone pickaxe is optional for now. !goToCoordinates(1, 64, 1, 2)');
    assert.deepEqual(facts.decisions.map(d => d.subject), ['stone pickaxe']);
});

test('S18a B: history.add records the bot\'s own decisions, not a system or player line; executeCommand records a query\'s target as a touch', async (t) => {
    quiet(t);
    const { History } = await import('./history.js');
    const h = Object.create(History.prototype);
    Object.assign(h, { name: 'FRCFLD', turns: [], max_messages: 999, summary_chunk_size: 5, facts: emptyFacts() });
    await h.add('system', 'a stone sword can wait');
    await h.add('Player1', 'the stone sword can wait');
    assert.deepEqual(h.facts.decisions, []);
    await h.add('FRCFLD', 'So a stone sword can wait. !forage');
    assert.deepEqual(h.facts.decisions.map(d => d.words), ['a stone sword can wait']);

    const w = fakeWorld({ slots: { 9: ['stick', 2] } });
    useRegistry(t, w.bot);
    const agent = { name: 'FRCFLD', blocked_actions: [], bot: w.bot, history: { facts: emptyFacts() } };
    await executeCommand(agent, '!getCraftingPlan("stone_sword", 1)');
    assert.deepEqual(agent.history.facts.touches.map(x => x.target), ['stone_sword']);
});

// ---- #680 review round 1 ----
test('#680 review 1: an empty cobblestone collect is no dead end for the stone axe (rocks come from piles and stone: dl:2154 "no cobblestone within 64")', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 10: ['stick', 4], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1] } });
    useRegistry(t, w.bot);
    const now = Date.now();
    w.bot.rotnCollects = [{ item: 'cobblestone', got: 0, wanted: 8, reason: 'none', range: 64, from: new Vec3(0, 64, 0), at: now - 3 * MIN }];
    assert.equal(craftDeadEnd(w.bot, 'stone_axe', now), null);
    assert.match(goalFor(w.bot), /make a stone axe when you can/);
});

test('#680 review 1: the newest collect of an item decides (a later one that got some clears the dead end); beyond its range from its start it is no dead end', (t) => {
    quiet(t);
    const w = fakeWorld({ at: new Vec3(0, 64, 0), slots: { 36: ['spartanweaponry:club_wood', 1], 10: ['stick', 4], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1] } });
    useRegistry(t, w.bot);
    const now = Date.now();
    const miss = { item: 'pyrotech:rock', got: 0, wanted: 3, reason: 'none', range: 64, from: new Vec3(10, 64, 0), at: now - 12 * MIN };
    w.bot.rotnCollects = [miss];
    assert.equal(craftDeadEnd(w.bot, 'stone_axe', now)?.item, 'pyrotech:rock', 'within 64 of where that collect started');
    w.bot.rotnCollects = [miss, { item: 'pyrotech:rock', got: 2, wanted: 3, reason: 'attempts', range: 64, from: new Vec3(10, 64, 0), at: now - 2 * MIN }];
    assert.equal(craftDeadEnd(w.bot, 'stone_axe', now), null, 'a later collect got some');
    w.bot.rotnCollects = [{ ...miss, from: new Vec3(100, 64, 0) }];
    assert.equal(craftDeadEnd(w.bot, 'stone_axe', now), null, 'the bot is 100 blocks from where it searched 64');
});

test('#680 review 2: a failure over 60 min old is never sticky; the "another failure on it" rule holds only within 15 min', () => {
    const t0 = Date.now();
    const here = { entity: { position: new Vec3(-142, 66, -136) } };
    const shownWith = (age) => {
        const facts = emptyFacts();
        dl2154Distinct(facts, t0);
        facts.failures.find(e => /stone_sword/.test(e.cmd)).at = t0 - age * MIN;
        facts.failures.find(e => /tinder/.test(e.cmd)).at = t0 - (age - 1) * MIN;
        facts.failures.sort((x, y) => x.at - y.at);
        return failuresOf(buildMemory({ bot: here, self_prompter: { prompt: OLD_GOAL } }, { facts, now: t0 }));
    };
    assert.ok(shownWith(59).some(l => /stone_sword/.test(l)), 'sticky by the goal at 59 min');
    assert.ok(!shownWith(61).some(l => /stone_sword/.test(l)), 'not at 61 min');
    // Two failures on one target: sticky only while the newer one is under 15 min old.
    const repeat = (newerMin) => {
        const facts = emptyFacts();
        dl2154Distinct(facts, t0);
        facts.failures = facts.failures.filter(e => !/stone_sword|tinder/.test(e.cmd));
        recordFailure(facts, { cmd: '!collectBlocks("deadbush", 4)', why: 'Collected 0 deadbush.', at: t0 - 40 * MIN });
        recordFailure(facts, { cmd: '!collectBlocks("deadbush", 2)', why: 'Collected 0 deadbush, still none here.', at: t0 - newerMin * MIN });
        facts.failures.sort((x, y) => x.at - y.at);
        return failuresOf(buildMemory({ bot: here }, { facts, now: t0 })).filter(l => /deadbush", 4/.test(l)).length;
    };
    assert.equal(repeat(10), 1, 'came back 10 min ago: sticky');
    assert.equal(repeat(20), 0, 'came back 20 min ago: not');
});

test('#680 review 5: a decision is never taken from an untrusted turn', async (t) => {
    quiet(t);
    const { History } = await import('./history.js');
    const h = Object.create(History.prototype);
    Object.assign(h, { name: 'FRCFLD', turns: [], max_messages: 999, summary_chunk_size: 5, facts: emptyFacts() });
    await h.add('FRCFLD', 'the stone axe can wait', { untrusted: true });
    assert.deepEqual(h.facts.decisions, []);
});

test('#680 review 6: an unknown pickaxe count or weapon is never called enough ("null pickaxes")', () => {
    assert.equal(toolsClause({ weaponRank: () => 4, pickaxeCount: () => null }), 'keep a weapon and a pickaxe: keep them, and replace one that breaks');
    assert.equal(toolsClause({ weaponRank: () => null, pickaxeCount: () => 2 }), 'keep a weapon and a pickaxe: keep them, and replace one that breaks');
    assert.match(toolsClause({ weaponRank: () => null, pickaxeCount: () => 1 }), /a spare stone pickaxe/, 'a known deficit is still said');
    assert.doesNotMatch(toolsClause({ weaponRank: () => 4, pickaxeCount: () => null, bestWeapon: () => 'stone_axe' }), /null/);
});
