// Soak 18 S18c (/home/rv/s18-plan-skills.md D, E, F; the lead's full-inventory craft item from rotn-data's
// /home/rv/s18-cobble-variant.md; #680's review residuals and nit 7). From test/evidence/g4/g4soak-18-20261127/
// driver.log (dl). Offline: the shared fake world, no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { fakeWorld } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { parseCommandMessage } from './commands/index.js';
import { craftRecipeCanRun } from './commands/preconditions.js';
import { buildMemory, emptyFacts, recordFailure, looksFailed } from './memory_facts.js';
import { toolsClause } from './agenda.js';
import { freshGoalText } from './agenda_driver.js';
import { cobbleKindHint } from './library/cobble.js';
import { inventoryFull, roomFor, resultHasRoom, watchCraftDrops, noRoomWhy } from './library/craft_room.js';
import { missingSummary, missingText, craftNeeds } from './library/craft_needs.js';
import * as skills from './library/skills.js';

const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };
const MIN = 60_000;

// ---- D: a rock kind's cobble name (dl:1512, dl:1981) ----
test('S18c D dl:1512: "undergroundbiomes:sedimentary_cobble" is no item: the reply names chalk_cobble and the craft (was igneous_cobble, sedimentary_clay or sedimentary_sand)', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 9: ['pyrotech_compat:rock_sedimentary', 4] } });
    useRegistry(t, w.bot);
    const r = parseCommandMessage('!craftRecipe("undergroundbiomes:sedimentary_cobble", 1)');
    assert.equal(typeof r, 'string');
    assert.match(r, /^Invalid item type: undergroundbiomes:sedimentary_cobble\. Sedimentary rocks make their own cobble, one per rock \(contenttweaker:chalk_cobble, [^)]*\): !craftRecipe\("cobblestone", 1\) crafts the cobble your rocks make \(4 rocks of one kind\)\.$/, r);
    assert.doesNotMatch(r, /Did you mean/);
    assert.match(cobbleKindHint('igneous_cobblestone'), /Igneous rocks make undergroundbiomes:igneous_cobble:/);
    assert.equal(cobbleKindHint('undergroundbiomes:granite_cobble'), null, 'not a rock kind');
    assert.match(parseCommandMessage('!craftRecipe("stone_swrd", 1)'), /Did you mean/, 'another bad name: the suggestions as before');
});

// ---- E: the no-yet line's diagnostics ----
test('S18c E: the no-yet diagnostics say how the pickup wait ended, the items near and the cell now (dl:150 …: the journal could not say why)', (t) => {
    quiet(t);
    const bot = {
        entity: { position: new Vec3(0, 64, 0) },
        collectBlock: { lastPickup: { entityId: 7, reason: 'timeout', ms: 5000 } },
        entities: { 7: { name: 'item', position: new Vec3(2.5, 64, 0) }, 8: { name: 'zombie', position: new Vec3(1, 64, 0) }, 9: { name: 'item', position: new Vec3(20, 64, 0) } },
        blockAt: () => ({ name: 'air' }),
    };
    assert.equal(skills.noYetDiagnostics(bot, new Vec3(1, 64, 0)), ' (the pickup wait: timeout after 5 s; items near: 1, the nearest 2.5 blocks away; the cell is now air)');
    bot.collectBlock.lastPickup = null; bot.entities = {};
    assert.equal(skills.noYetDiagnostics(bot, new Vec3(1, 64, 0)), ' (no pickup wait; items near: none; the cell is now air)');
});

test('S18c E: a rock pile that gives nothing: a [collect] journal line carries the diagnostics (the model\'s line unchanged); this attempt\'s own wait only', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    // Slot 5 (armour, never in items()) only puts pyrotech:rock in the fake registry, so the collect counts items, as live.
    const w = fakeWorld({ at: new Vec3(0, 64, 0), set: { '1,64,0': 'pyrotech_compat:rock_igneous' }, slots: { 5: ['pyrotech:rock', 1] }, pathfinder: 'teleport', timeOfDay: 1000, onDig: () => [] });
    useRegistry(t, w.bot);
    w.bot.collectBlock.lastPickup = { reason: 'gone', ms: 100 }; // an earlier collect's: cleared at the attempt
    await skills.collectBlock(w.bot, 'pyrotech:rock', 1);
    assert.match(w.bot.output, /Broke pyrotech_compat:rock_igneous at 1, 64, 0: no pyrotech:rock yet\./, 'the model\'s line as before');
    const diag = lines.find(l => l.startsWith('[collect] no pyrotech:rock yet'));
    assert.match(diag, /^\[collect\] no pyrotech:rock yet from pyrotech_compat:rock_igneous at 1, 64, 0: \((no pickup wait|the pickup wait: [^;]+); items near: none; the cell is now air\)$/, diag);
    assert.doesNotMatch(diag, /gone after 0\.1 s/, 'not an earlier collect\'s wait');
});

// ---- F: the shelter-block count ----
test('S18c F dl:2160, dl:2636: the count says it is now\'s (new crafts included) and how many short; the checker\'s "shelter blocks N of 14" stays', (t) => {
    quiet(t);
    const mem = (n) => {
        const w = fakeWorld({ slots: n ? { 9: ['undergroundbiomes:metamorphic_cobble', n] } : {} });
        __setRegistryForTest(w.bot.registry);
        return buildMemory({ bot: w.bot }, { facts: emptyFacts() });
    };
    t.after(() => __setRegistryForTest(null));
    assert.match(mem(13), /^Reserves: shelter blocks 13 of 14 \(stone or cobble; 1 short; counted now, new crafts included\);/m);
    assert.match(mem(15), /^Reserves: shelter blocks 15 of 14 \(stone or cobble; counted now, new crafts included\);/m);
    assert.equal(Number(/shelter blocks (\d+) of/.exec(mem(13))[1]), 13, 'test/tools/soak-memory-checks.mjs:363 reads it');
});

// ---- The full-inventory craft (dl:2142-2149, dl:2311-2352) ----
/** A full inventory as at dl:2311-2352 (36 stacks), the given stacks first, the rest distinct junk. */
function fullInventory(first) {
    const slots = {};
    let i = 9;
    for (const s of first) slots[i++] = s;
    const junk = ['dirt', 'sand', 'gravel', 'cobblestone', 'stick', 'planks', 'log', 'wool', 'string', 'bone', 'feather', 'flint', 'clay_ball', 'brick', 'paper', 'book', 'arrow', 'bow', 'coal', 'leather', 'apple', 'bread', 'wheat', 'wheat_seeds', 'sugar', 'egg', 'snowball', 'reeds', 'cactus', 'glass', 'stone', 'sapling', 'torch', 'ladder', 'fence', 'gold_nugget'];
    for (const n of junk) { if (i > 44) break; slots[i++] = [n, 1]; }
    return slots;
}

test('S18c: inventoryFull / roomFor / resultHasRoom read the 36 slots and the result\'s own stack', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: fullInventory([['pyrotech_compat:rock_igneous', 5, 2], ['undergroundbiomes:igneous_cobble', 3, 6]]) });
    useRegistry(t, w.bot);
    assert.equal(inventoryFull(w.bot), true);
    assert.equal(roomFor(w.bot, 'undergroundbiomes:igneous_cobble:6'), true, 'a stack of 3 has room');
    assert.equal(resultHasRoom(w.bot, 'undergroundbiomes:igneous_cobble:2'), false, 'no stack of :2, no free slot');
    const room = fakeWorld({ slots: { 9: ['dirt', 1] } });
    __setRegistryForTest(room.bot.registry);
    assert.equal(resultHasRoom(room.bot, 'undergroundbiomes:igneous_cobble:2'), true);
});

test('S18c: the craftResultDropped watcher (#682) records drops, never throws (a throwing listener would make bot.craft reject), and is removed', () => {
    const bot = new EventEmitter();
    const watch = watchCraftDrops(bot);
    bot.emit('craftResultDropped', { name: 'undergroundbiomes:igneous_cobble', metadata: 2, count: 1, thrown: 1, position: new Vec3(-147, 66, -129) });
    assert.doesNotThrow(() => bot.emit('craftResultDropped', null));
    assert.doesNotThrow(() => bot.emit('craftResultDropped', { get thrown() { throw new Error('bad event'); } }));
    watch.stop();
    assert.equal(bot.listenerCount('craftResultDropped'), 0);
    assert.equal(watch.drops[0].thrown, 1);
    const why = noRoomWhy({ inventory: { items: () => [], slots: [] } }, 'undergroundbiomes:igneous_cobble:2', watch.drops);
    assert.match(why, /^the craft made it, but your inventory is full \(no free slot, no undergroundbiomes:igneous_cobble:2 stack with room\), so 1 undergroundbiomes:igneous_cobble was thrown on the ground at -147, 66, -129: free a slot \(!discard something you do not need\), then pick it up$/);
});

/**
 * A fake bot.craft for the cobble path: takes 4 rocks of the recipe's kind (its first ingredient), and puts the cobble
 * where it fits: a stack of it with room, else a free slot (a stack the craft used up frees one), else emits
 * craftResultDropped as #682's patch does.
 */
function cobbleCraft(w, crafted) {
    return (recipe) => Promise.resolve().then(() => {
        const reg = w.bot.registry;
        const slots = w.bot.inventory.slots;
        const inId = (recipe.delta ?? []).find(d => d.count < 0)?.id ?? recipe.ingredients?.[0]?.id;
        const inMeta = (recipe.delta ?? []).find(d => d.count < 0)?.metadata ?? 0;
        let need = 4;
        for (let i = 9; i <= 44 && need > 0; i++) {
            const s = slots[i];
            if (s && s.type === inId && (s.metadata ?? 0) === inMeta) { const k = Math.min(need, s.count); s.count -= k; need -= k; if (s.count === 0) slots[i] = null; }
        }
        const outName = reg.items[recipe.result.id].name;
        const outMeta = recipe.result.metadata ?? 0;
        crafted.push(`${outName}:${outMeta}`);
        const stack = slots.slice(9, 45).find(s => s && s.type === recipe.result.id && (s.metadata ?? 0) === outMeta && s.count < 64);
        if (stack) { stack.count += 1; return; }
        const free = slots.findIndex((s, i) => i >= 9 && i <= 44 && !s);
        if (free >= 0) { w.give(outName, 1, outMeta); return; }
        w.bot.emit('craftResultDropped', { windowId: 0, windowType: 'minecraft:inventory', result: `${outName}:${outMeta} x1`, name: outName, metadata: outMeta, count: 1, thrown: 1, position: w.bot.entity.position.floored() });
    });
}

test('S18c dl:2142-2149: the inventory full, !craftRecipe("cobblestone", 1) takes the rock kind whose stack the craft uses up (komatiite 4 of 4), not rhyolite (4 of 5: no slot freed, the cobble lost)', async (t) => {
    quiet(t);
    const crafted = [];
    const w = fakeWorld({ slots: { ...fullInventory([['pyrotech_compat:rock_igneous', 5, 2], ['pyrotech_compat:rock_igneous', 4, 6]]), 5: ['undergroundbiomes:igneous_cobble', 1, 2] } });
    useRegistry(t, w.bot);
    w.bot.inventory.slots[5] = null; // the armour slot only put the cobble in the fake registry
    w.bot.craft = cobbleCraft(w, crafted);
    assert.equal(await skills.craftRecipe(w.bot, 'cobblestone', 1), true, w.bot.output);
    assert.deepEqual(crafted, ['undergroundbiomes:igneous_cobble:6'], w.bot.output);
    assert.doesNotMatch(w.bot.output, /igneous_cobble:2 \(4/, 'rhyolite was not tried');
});

test('S18c: the inventory full and no kind that frees a slot: "free a slot first", nothing crafted; with room the most-held kind as before', async (t) => {
    quiet(t);
    const crafted = [];
    const w = fakeWorld({ slots: { ...fullInventory([['pyrotech_compat:rock_igneous', 5, 2]]), 5: ['undergroundbiomes:igneous_cobble', 1, 2] } });
    useRegistry(t, w.bot);
    w.bot.inventory.slots[5] = null;
    w.bot.craft = cobbleCraft(w, crafted);
    const r = await skills.craftRecipeResult(w.bot, 'cobblestone', 1);
    assert.deepEqual([r.ok, r.code], [false, 'no-room']);
    assert.match(r.why, /^Could not craft cobblestone: your inventory is full .*Free a slot first \(!discard something you do not need\), then craft again\.$/);
    assert.deepEqual(crafted, []);
    assert.equal(looksFailed(r.why), true, 'the memory and the checker read it as a failure');
    // With a free slot: rhyolite (the most held) as before.
    const roomy = fakeWorld({ slots: { 9: ['pyrotech_compat:rock_igneous', 5, 2], 10: ['pyrotech_compat:rock_igneous', 4, 6], 5: ['undergroundbiomes:igneous_cobble', 1, 2] } });
    __setRegistryForTest(roomy.bot.registry);
    roomy.bot.inventory.slots[5] = null;
    const c2 = [];
    roomy.bot.craft = cobbleCraft(roomy, c2);
    assert.equal(await skills.craftRecipe(roomy.bot, 'cobblestone', 1), true, roomy.bot.output);
    assert.deepEqual(c2, ['undergroundbiomes:igneous_cobble:2']);
});

test('S18c dl:2147: a craft whose result was thrown (craftResultDropped) or had no room says so (was "the craft gave no …")', async (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { ...fullInventory([['pyrotech_compat:rock_igneous', 5, 2], ['pyrotech_compat:rock_igneous', 4, 6]]), 5: ['undergroundbiomes:igneous_cobble', 1, 2] } });
    useRegistry(t, w.bot);
    w.bot.inventory.slots[5] = null;
    const needs = { recipeId: null, requiresTable: false, ready: true, inputs: [], how: 'from your pyrotech_compat:rock_igneous:2 rocks' };
    const { cobbleRecipes } = await import('./library/cobble.js');
    const rhy = cobbleRecipes().find(c => /rock_igneous:2$/.test(c.rock));
    w.bot.craft = cobbleCraft(w, []);
    const r = await (async () => { const n0 = w.bot.output.length; const ok = await skills.craftByFill(w.bot, rhy.gives, 1, { ...needs, recipeId: rhy.recipeId }); return { ok, said: w.bot.output.slice(n0) }; })();
    assert.equal(r.ok, false);
    assert.match(r.said, /Could not craft undergroundbiomes:igneous_cobble:2: the craft made it, but your inventory is full \(no free slot, no undergroundbiomes:igneous_cobble:2 stack with room\), so 1 undergroundbiomes:igneous_cobble was thrown on the ground at 0, 64, 0: free a slot/, r.said);
    assert.equal(w.bot.rotnFail.code, 'no-room');
});

// ---- #680 residual (a): rocks have another way ----
test('S18c #680 residual: a dead end on rocks names mining stone with the pickaxe; with no pickaxe it is left for now', () => {
    const now = Date.now();
    const dead = () => ({ item: 'pyrotech:rock', range: 64, at: now - 12 * MIN });
    assert.equal(toolsClause({ weaponRank: () => 2, pickaxeCount: () => 2, craftDeadEnd: dead }, now),
        'keep a weapon and a pickaxe: a stone axe: no loose rocks found within 64, 12 min ago, so mine stone with your pickaxe for rocks (a stone gives 4)');
    assert.match(toolsClause({ weaponRank: () => 4, pickaxeCount: () => 0, craftDeadEnd: dead }, now), /a stone pickaxe not now \(no pyrotech:rock found within 64, 12 min ago: leave it until you see some\)/);
    assert.match(toolsClause({ weaponRank: () => 2, pickaxeCount: () => 2, craftDeadEnd: () => ({ item: 'stick', range: 64, at: now - MIN }) }, now), /a stone axe not now \(no stick found/);
});

// ---- #680 residual (b): freshGoalText with the food figure unknown ----
test('S18c #680 residual: freshGoalText swaps the tools clause when the food figure is unknown, and keeps the old figure', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 36: ['spartanweaponry:club_wood', 1], 37: ['stone_axe', 1], 38: ['stone_pickaxe', 1], 39: ['stone_pickaxe', 1], 40: ['bread', 2] } });
    useRegistry(t, w.bot);
    w.bot.inventory.slots[40].count = Infinity; // heldFoodPoints is not finite (the figure unknown)
    const agent = { bot: w.bot, history: { facts: emptyFacts() } };
    const before = "Standing goal (the agenda is done): keep food worth at least 12 points (you hold 7.5) and 14 blocks; keep a weapon and a pickaxe: make a stone axe when you can (3 rocks and 2 sticks at a crafting table): it is the weapon to have; explore by day.";
    agent._autonomy_prompt = before;
    const after = freshGoalText(agent, before);
    assert.match(after, /\(you hold 7\.5\)/, 'the old figure kept');
    assert.match(after, /keep a weapon and a pickaxe: your weapon \(stone_axe\) and 2 pickaxes are enough: keep them, and replace one that breaks; explore by day\./);
    assert.equal(agent._autonomy_prompt, after);
});

// ---- #680 nit 7: the missing input first ----
test('S18c #680 nit 7: a craft\'s "not enough" why starts with what to get, so a 40-char clip still names it (dl:2630 "You do not have the resource...")', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 9: ['pyrotech_compat:rock_igneous', 2], 10: ['stick', 1], 5: ['spartanweaponry:material', 1] } });
    useRegistry(t, w.bot);
    w.bot.inventory.slots[5] = null;
    const needs = craftNeeds(w.bot, 'stone_sword');
    assert.equal(missingSummary(needs), 'get 1 spartanweaponry:material:0');
    const text = missingText('stone_sword', needs);
    assert.match(text, /^Get 1 spartanweaponry:material:0 first: you do not have the resources to craft stone_sword\. To craft stone_sword \(at a crafting table\): /);
    assert.equal(looksFailed(text), true);
    // In Recent failures, 40 min old (the short why): the missing input is still there.
    const facts = emptyFacts();
    recordFailure(facts, { cmd: '!craftRecipe("stone_sword", 1)', why: text, code: 'missing', at: Date.now() - 40 * MIN });
    const line = buildMemory({}, { facts }).split('\n').find(l => l.startsWith('!craftRecipe'));
    assert.match(line, /^!craftRecipe\("stone_sword", 1\): Get 1 spartanweaponry:material:0.{0,8}\.\.\. \(40 min ago\)$/, line);
    // The precondition's text the same (K1's canRun).
    const bad = fakeWorld({ slots: { 11: ['planks', 4] }, extra: { recipesFor: () => [] } });
    __setRegistryForTest(bad.bot.registry);
    const tid = bad.bot.registry.itemsByName.crafting_table.id;
    bad.bot.registry.recipes = { ...bad.bot.registry.recipes, [tid]: [{ result: { id: tid, count: 1 } }] };
    assert.match(craftRecipeCanRun({ bot: bad.bot }, 'crafting_table').why, /^Get 1 contenttweaker:crafting_tools first: you do not have the resources to craft crafting_table\. /);
});
