// Round 17 K1 (/home/rv/k-plan-skills.md): command preconditions (canRun, before perform) and structured results
// ({ok, code, why, where}) for !craftRecipe and !placeHere, from soak 16 and 17's failed commands (driver.log lines:
// dl16 = g4soak-16-20261125, dl17 = g4soak-17-20261126). Offline: the shared fake world, no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Vec3 } from 'vec3';
import * as espree from 'espree';
import { fakeWorld } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { executeCommand } from './commands/index.js';
import { actionsList } from './commands/actions.js';
import { checkCanRun, craftRecipeCanRun, noteResult } from './commands/preconditions.js';
import { emptyFacts, recordFailure, buildMemory, MEMORY_FACTS } from './memory_facts.js';
import { resultLine, resultOf, fail } from './library/results.js';
import * as skills from './library/skills.js';
import { placeHere, placeHereRefusal, placeHereResult } from './library/escape.js';

const quiet = (t, lines = null) => { t.mock.method(console, 'log', (...a) => lines?.push(a.join(' '))); t.mock.method(console, 'warn', () => {}); };
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };
/** Give the fake registry a crafting recipe for each name (the live registry has RotN's; minecraft-data has vanilla's only). */
const withRecipes = (bot, names) => {
    bot.registry.recipes = { ...(bot.registry.recipes ?? {}) };
    for (const n of names) { const id = bot.registry.itemsByName[n.replace(/^minecraft:/, '')]?.id; if (id != null) bot.registry.recipes[id] = [{ result: { id, count: 1 } }]; }
};
const without = (bot, name) => {
    const id = bot.registry.itemsByName[name].id;
    bot.registry.recipes = { ...bot.registry.recipes };
    delete bot.registry.recipes[id];
};
/** recipesFor as mineflayer's: none in the 2x2 grid; at a table (true or a block) one recipe. */
const tableOnly = () => (id, meta, n, table) => (table === null ? [] : [{ id }]);
const agentFor = (bot, runs = []) => ({
    name: 'FRCFLD', blocked_actions: [], history: { facts: emptyFacts() }, bot,
    actions: {
        stopped: 0,
        stop() { this.stopped++; return Promise.resolve(); },
        runAction: async (label, fn) => { runs.push(label); bot.output = ''; await fn(); return { success: true, message: `Action output:\n${bot.output}`, interrupted: false, timedout: false }; },
    },
});
const cmd = (name) => actionsList.find(c => c.name === name);

// ---- The mechanism ----
test('K1: a canRun refusal is the reply; perform never runs (nothing running is stopped, no walk); it is a Recent failure with its code; one [result] line', async (t) => {
    const lines = [];
    quiet(t, lines);
    const w = fakeWorld({ slots: { 9: ['pyrotech:rock', 3], 10: ['stick', 4], 11: ['planks', 4] }, extra: { recipesFor: tableOnly() } });
    useRegistry(t, w.bot);
    withRecipes(w.bot, ['stone_axe']);
    const runs = [];
    const agent = agentFor(w.bot, runs);
    const reply = await executeCommand(agent, '!craftRecipe("stone_axe", 1)');
    assert.deepEqual(runs, [], 'perform (runAsAction -> runAction) never ran');
    assert.equal(agent.actions.stopped, 0);
    assert.match(reply, /^Crafting stone_axe requires a crafting table: there is none within 16 blocks and none in your inventory\./);
    const f = agent.history.facts.failures;
    assert.equal(f.length, 1);
    assert.deepEqual([f[0].cmd, f[0].code], ['!craftRecipe("stone_axe", 1)', 'no-table']);
    const result = lines.filter(l => l.startsWith('[result]'));
    assert.equal(result.length, 1);
    assert.match(result[0], /^\[result\] cmd=!craftRecipe args=\["stone_axe",1\] ok=false code=no-table where=- why="Crafting stone_axe requires a crafting table: .*"$/);
});

test('K1: a canRun that throws, returns a promise or nothing lets the command run; a bare string is code "refused"', (t) => {
    quiet(t);
    const agent = {};
    assert.equal(checkCanRun({ name: '!x', canRun: () => { throw new Error('bug'); } }, agent, []), null);
    assert.equal(checkCanRun({ name: '!x', canRun: () => Promise.resolve('no') }, agent, []), null);
    assert.equal(checkCanRun({ name: '!x', canRun: () => null }, agent, []), null);
    assert.equal(checkCanRun({ name: '!x' }, agent, []), null);
    assert.deepEqual(checkCanRun({ name: '!x', canRun: () => 'Not now: why.' }, agent, []), { code: 'refused', why: 'Not now: why.' });
    assert.deepEqual(checkCanRun({ name: '!x', canRun: (a, n) => ({ code: 'c', why: `n=${n}` }) }, agent, [3]), { code: 'c', why: 'n=3' });
});

test('K1: a perform\'s structured result is recorded with its why and code (not the regex); a success is not; the [result] line has a fixed field order, why last and quoted', async (t) => {
    const lines = [];
    quiet(t, lines);
    const w = fakeWorld({ slots: { 9: ['stick', 2] } });
    useRegistry(t, w.bot);
    const agent = { name: 'FRCFLD', history: { facts: emptyFacts() }, bot: w.bot };
    let r = { ok: false, code: 'no-recipe', why: 'Cannot craft x: it has no crafting recipe on this pack.', where: null };
    // Through the real command with a stubbed skill result: perform hands it over with noteResult.
    const real = cmd('!craftRecipe');
    t.mock.method(real, 'canRun', () => null);
    t.mock.method(real, 'perform', (ag, name, num, context) => { noteResult(context, r); return Promise.resolve('Action output:\nsomething else'); });
    await executeCommand(agent, '!craftRecipe("stick", 1)');
    assert.deepEqual(agent.history.facts.failures.map(e => [e.code, e.why]), [['no-recipe', r.why]]);
    r = { ok: true, code: 'ok', why: null, where: null };
    await executeCommand(agent, '!craftRecipe("stick", 1)');
    assert.equal(agent.history.facts.failures.length, 1, 'a success is no failure');
    const out = lines.filter(l => l.startsWith('[result]'));
    assert.deepEqual(out, [
        '[result] cmd=!craftRecipe args=["stick",1] ok=false code=no-recipe where=- why="Cannot craft x: it has no crafting recipe on this pack."',
        '[result] cmd=!craftRecipe args=["stick",1] ok=true code=ok where=- why=""',
    ]);
    assert.equal(resultLine('!placeHere', ['dirt'], { ok: false, code: 'jump-failed', why: 'say "a"', where: '1,64,2' }),
        '[result] cmd=!placeHere args=["dirt"] ok=false code=jump-failed where=1,64,2 why="say \\"a\\""');
});

test('K1: resultOf gives the last tagged failure of the call, else code "failed" and the last line logged', async () => {
    const bot = { output: '' };
    assert.deepEqual(await resultOf(bot, () => Promise.resolve(true)), { ok: true, code: 'ok', why: null, where: null });
    assert.deepEqual(await resultOf(bot, () => Promise.resolve(fail(bot, 'not-held', 'Don\'t have any dirt to place.', new Vec3(1.5, 64, -2.2)))),
        { ok: false, code: 'not-held', why: 'Don\'t have any dirt to place.', where: '1,64,-3' });
    assert.deepEqual(await resultOf(bot, () => { bot.output += 'Some line.\nThe last line.\n'; return Promise.resolve(false); }),
        { ok: false, code: 'failed', why: 'The last line.', where: null }, 'an older tagged failure is not taken');
});

// ---- The static rules ----
test('K1: every canRun is synchronous (no async function); in src/ the ...Result siblings are called only in commands/actions.js, never read as a boolean', () => {
    const src = readFileSync(new URL('./commands/actions.js', import.meta.url), 'utf8');
    const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    const found = [];
    (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'Property' && (n.key?.name === 'canRun' || n.key?.value === 'canRun')) found.push(n.value);
        for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
    })(ast);
    assert.ok(found.length >= 2, 'the !craftRecipe and !placeHere canRun');
    for (const f of found) assert.equal(f.async, false, `an async canRun at ${src.slice(f.start, f.start + 60)}`);
    for (const c of actionsList.filter(c => c.canRun)) assert.notEqual(c.canRun.constructor.name, 'AsyncFunction', c.name);

    // K1 review 6: every ...Result call in src/ (not only src/agent) is in the allow-list's file, and its value is never
    // read as a boolean (resultUseProblems).
    const srcRoot = new URL('..', import.meta.url).pathname; // src/
    const files = [];
    (function list(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) list(p); else if (p.endsWith('.js') && !p.endsWith('.test.js')) files.push(p); } })(srcRoot);
    let calls = 0;
    for (const p of files) {
        const rel = p.slice(srcRoot.length);
        const text = readFileSync(p, 'utf8');
        if (![...RESULT_NAMES].some(n => text.includes(n))) continue;
        const { count, problems } = resultUseProblems(text);
        calls += count;
        if (count) assert.ok(RESULT_FILES.has(rel), `...Result calls outside the allow-list (${[...RESULT_FILES]}): ${rel}`);
        assert.deepEqual(problems, [], rel);
    }
    assert.equal(calls, 2, 'actions.js: !craftRecipe and !placeHere');
});

test('K1 review 6: the static check refuses `const r = await xResult(...); if (r)`, a returned result and a let; it takes noteResult and r.<field>', () => {
    for (const bad of [
        'async function f(bot) { const r = await placeBlockResult(bot, "dirt", 0, 0, 0); if (r) return true; }',
        'async function f(bot) { return await placeBlockResult(bot, "dirt", 0, 0, 0); }',
        'async function f(bot) { if (await skills.placeHereResult(bot, "dirt")) return 1; }',
        'async function f(bot) { let r = await skills.craftRecipeResult(bot, "x"); return r.ok; }',
    ]) assert.equal(resultUseProblems(bad).problems.length, 1, bad);
    const good = 'async function f(bot, context) { noteResult(context, await skills.craftRecipeResult(bot, "x")); const r = await skills.placeHereResult(bot, "d"); noteResult(context, r); return r.ok; }';
    assert.deepEqual(resultUseProblems(good), { count: 2, problems: [] });
});

/** The ...Result siblings, and the one file that may call them (the command layer). */
const RESULT_NAMES = new Set(['craftRecipeResult', 'placeBlockResult', 'placeHereResult']);
const RESULT_FILES = new Set(['agent/commands/actions.js']);
/**
 * A ...Result call is fine as noteResult's argument, or as the init of a const whose every other use is a property
 * (r.ok, r.why) or noteResult's argument. Anything else (a condition, a return, a let) is a problem.
 */
function resultUseProblems(text) {
    const ast = espree.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    const parents = new Map(), refs = new Map(), calls = [];
    const nameOf = (c) => (c?.type === 'Identifier' ? c.name : c?.type === 'MemberExpression' && !c.computed ? c.property?.name : null);
    (function walk(n, parent) {
        if (!n || typeof n.type !== 'string') return;
        parents.set(n, parent);
        if (n.type === 'CallExpression' && RESULT_NAMES.has(nameOf(n.callee))) calls.push(n);
        if (n.type === 'Identifier') { if (!refs.has(n.name)) refs.set(n.name, []); refs.get(n.name).push({ id: n, up: parent }); }
        for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(c => walk(c, n)); else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, n); }
    })(ast, null);
    const noteArg = (node, up) => up?.type === 'CallExpression' && nameOf(up.callee) === 'noteResult' && up.arguments.includes(node);
    const problems = [];
    for (const call of calls) {
        const at = text.slice(call.start, call.start + 60);
        let node = call, up = parents.get(call);
        if (up?.type === 'AwaitExpression') { node = up; up = parents.get(up); }
        if (noteArg(node, up)) continue;
        if (!(up?.type === 'VariableDeclarator' && up.init === node && up.id.type === 'Identifier' && parents.get(up)?.kind === 'const')) { problems.push(`a result used as a value or condition: ${at}`); continue; }
        const bad = (refs.get(up.id.name) ?? []).filter(({ id, up: u }) => id !== up.id && !(u?.type === 'MemberExpression' && u.object === id) && !noteArg(id, u));
        if (bad.length) problems.push(`${up.id.name} used other than ${up.id.name}.<field> or noteResult(…, ${up.id.name}): ${at}`);
    }
    return { count: calls.length, problems };
}

// ---- !craftRecipe ----
test('K1 dl16:776/1017: a stone axe with no table near and none held: one reply names the table and the whole way to it (was "requires a crafting table", one link per failed call)', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 9: ['pyrotech:rock', 3], 10: ['stick', 4], 11: ['planks', 4] }, extra: { recipesFor: tableOnly() } });
    useRegistry(t, w.bot);
    withRecipes(w.bot, ['stone_axe']);
    const r = craftRecipeCanRun({ bot: w.bot }, 'stone_axe');
    assert.equal(r?.code, 'no-table');
    assert.match(r.why, /To craft crafting_table: .*1 contenttweaker:crafting_tools: you have none/, r.why);
    assert.match(r.why, /To craft contenttweaker:crafting_tools: /, r.why);
    assert.match(r.why, /Make the pyrotech:crude_axe now: !craftRecipe\("pyrotech:crude_axe", 1\)\./, r.why);
    // With the Crafting Tools held: the table is the next link.
    const tools = fakeWorld({ slots: { 9: ['contenttweaker:crafting_tools', 1], 11: ['planks', 4], 12: ['pyrotech:rock', 3], 13: ['stick', 2] }, extra: { recipesFor: tableOnly() } });
    __setRegistryForTest(tools.bot.registry);
    withRecipes(tools.bot, ['stone_axe']);
    assert.match(craftRecipeCanRun({ bot: tools.bot }, 'stone_axe').why, /Make the crafting_table now: !craftRecipe\("crafting_table", 1\)\.$/);
    // A table held or one within 16 blocks: no refusal (the craft places or walks to it).
    const held = fakeWorld({ slots: { 9: ['crafting_table', 1], 12: ['pyrotech:rock', 3], 13: ['stick', 2] }, extra: { recipesFor: tableOnly() } });
    __setRegistryForTest(held.bot.registry);
    withRecipes(held.bot, ['stone_axe']);
    assert.equal(craftRecipeCanRun({ bot: held.bot }, 'stone_axe'), null);
    const near = fakeWorld({ set: { '3,64,0': 'crafting_table' }, slots: { 12: ['pyrotech:rock', 3], 13: ['stick', 2] }, extra: { recipesFor: tableOnly() } });
    __setRegistryForTest(near.bot.registry);
    withRecipes(near.bot, ['stone_axe']);
    assert.equal(craftRecipeCanRun({ bot: near.bot }, 'stone_axe'), null);
});

test('K1 dl16:2090, dl17:3038: no crafting recipe: said why, with what to do instead (a stone: cobblestone from the rocks held)', (t) => {
    quiet(t);
    const w = fakeWorld({ set: { '9,40,9': 'undergroundbiomes:metamorphic_stone' }, slots: { 9: ['pyrotech_compat:rock_metamorphic', 13] }, extra: { recipesFor: () => [] } });
    useRegistry(t, w.bot);
    without(w.bot, 'wooden_pickaxe');
    const wood = craftRecipeCanRun({ bot: w.bot }, 'wooden_pickaxe');
    assert.deepEqual(wood, { code: 'no-recipe', why: 'Cannot craft wooden_pickaxe: it has no crafting recipe on this pack. !craftable lists what you can make now.' });
    const ub = craftRecipeCanRun({ bot: w.bot }, 'undergroundbiomes:metamorphic_stone');
    assert.equal(ub?.code, 'no-recipe');
    assert.match(ub.why, /^Cannot craft undergroundbiomes:metamorphic_stone: it has no crafting recipe on this pack\. For shelter blocks, make cobblestone from your rocks instead: your pyrotech_compat:rock_metamorphic(:0)? rocks make undergroundbiomes:metamorphic_cobble(:0)?: !craftRecipe\("cobblestone", 3\) \(4 rocks each\)\.$/, ub.why);
    const none = fakeWorld({ set: { '9,40,9': 'undergroundbiomes:metamorphic_stone' }, extra: { recipesFor: () => [] } });
    __setRegistryForTest(none.bot.registry);
    assert.match(craftRecipeCanRun({ bot: none.bot }, 'undergroundbiomes:metamorphic_stone').why, /collect rocks with !collectBlocks\("pyrotech:rock", 8\), then !craftRecipe\("cobblestone", 1\)/);
    assert.equal(craftRecipeCanRun({ bot: w.bot }, 'cobblestone'), null, 'cobblestone is the rocks\' own craft');
});

test('K1 dl16:819, dl17:2217: missing inputs are refused before anything runs, in craftRecipe\'s own words', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 11: ['planks', 4] }, extra: { recipesFor: () => [] } });
    useRegistry(t, w.bot);
    withRecipes(w.bot, ['crafting_table']);
    const r = craftRecipeCanRun({ bot: w.bot }, 'crafting_table');
    assert.equal(r.code, 'missing');
    assert.match(r.why, /^You do not have the resources to craft crafting_table\. To craft crafting_table: .*1 contenttweaker:crafting_tools: you have none, so get 1 contenttweaker:crafting_tools/, r.why);
});

test('K1 dl17:2273 (pin of #670 L4): the stone axe only the off hand holds is not refused (craftRecipe moves it)', (t) => {
    quiet(t);
    // Slot 5 (armour, never in items()) only puts contenttweaker:crafting_tools in the fake registry, as live.
    const w = fakeWorld({ slots: { 5: ['contenttweaker:crafting_tools', 1], 45: ['stone_axe', 1], 10: ['pyrotech:rock', 90, 8], 11: ['stick', 3] }, extra: { recipesFor: () => [] } });
    useRegistry(t, w.bot);
    withRecipes(w.bot, ['contenttweaker:crafting_tools']);
    assert.equal(craftRecipeCanRun({ bot: { ...w.bot, inventory: { ...w.bot.inventory, slots: w.bot.inventory.slots.map((s, i) => (i === 45 ? null : s)) } } }, 'contenttweaker:crafting_tools')?.code, 'missing', 'without the off-hand axe: refused');
    assert.equal(craftRecipeCanRun({ bot: w.bot }, 'contenttweaker:crafting_tools'), null);
});

test('K1 dl16:627: bot.craft\'s "missing ingredient" (the server rejected the clicks) is a result that says to send the craft again; other throws go on', async (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 9: ['log', 3] }, extra: { recipesFor: () => [{ id: 5, result: { id: 5, count: 4 }, delta: [], requiresTable: false }] } });
    useRegistry(t, w.bot);
    w.bot.craft = () => Promise.reject(new Error('Error: missing ingredient'));
    const r = await skills.craftRecipeResult(w.bot, 'planks', 1);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'server-rejected');
    assert.match(r.why, /^The server refused the craft of planks .*send the same craft again\.$/);
    assert.match(w.bot.output, /send the same craft again/);
    w.bot.craft = () => Promise.reject(new Error('boom'));
    await assert.rejects(skills.craftRecipeResult(w.bot, 'planks', 1), /boom/);
    w.bot.craft = () => Promise.reject(new Error('Error: missing ingredient'));
    await assert.rejects(skills.craftRecipe(w.bot, 'planks', 1), /missing ingredient/, 'the boolean craftRecipe throws as before');
});

// ---- The table placement (dl17:823, 901) ----
test('K1 dl17:823/901 (behaviour change): a cell where the table placement just failed is left out for 2 min; the next free cell is taken; the why keeps the error', async (t) => {
    quiet(t);
    const w = fakeWorld({ at: new Vec3(0, 64, 0), slots: { 36: ['crafting_table', 1] }, pathfinder: 'teleport' });
    useRegistry(t, w.bot);
    withDrops(w.bot);
    const tried = [];
    w.bot.placeBlock = (ref, face) => {
        const p = ref.position.plus(face);
        tried.push(`${p.x},${p.y},${p.z}`);
        return Promise.reject(new Error('No block has been placed : the block is still air'));
    };
    let now = 1_000_000;
    const first = await skills.placeTableNear(w.bot, 'stone_axe', 0, () => now);
    assert.equal(first, null);
    assert.equal(w.bot.rotnFail.code, 'table-not-placed');
    assert.match(w.bot.output, /Failed to place crafting_table at \(.*\): (Error: )?No block has been placed : the block is still air\./);
    assert.match(w.bot.rotnFail.why, /^Could not place a crafting table to craft stone_axe at -?\d+, \d+, -?\d+ \((Error: )?No block has been placed : the block is still air\); the next try takes another cell for 2 min\.$/);
    now += 30_000;
    await skills.placeTableNear(w.bot, 'stone_axe', 0, () => now);
    assert.equal(tried.length, 2);
    assert.notEqual(tried[1], tried[0], `the second try (dl17:901) took another cell: ${tried}`);
    now += TWO_MIN;
    w.bot.rotnTableFails = w.bot.rotnTableFails.slice(0, 1); // the first cell's failure, now 2.5 min old
    await skills.placeTableNear(w.bot, 'stone_axe', 0, () => now);
    assert.equal(tried[2], tried[0], 'after 2 min the cell may be tried again');
});
const TWO_MIN = 2 * 60_000;
/** The fake world's blocks carry no drops (prismarine-block's do); world.getNearestFreeSpace reads them. */
function withDrops(bot) {
    const blockAt = bot.blockAt;
    bot.blockAt = (p) => { const b = blockAt(p); if (b && !b.drops) b.drops = b.boundingBox === 'block' ? [b.type] : []; return b; };
}

test('K1: placeBlock\'s failure keeps the error, and names a mob in the cell', async (t) => {
    quiet(t);
    const w = fakeWorld({ at: new Vec3(0, 64, 0), slots: { 36: ['dirt', 4] }, pathfinder: 'teleport' });
    useRegistry(t, w.bot);
    w.bot.placeBlock = () => Promise.reject(new Error('blockUpdate did not fire'));
    w.bot.entities[99] = { id: 99, type: 'mob', name: 'zombie', position: new Vec3(3.5, 64, 0.5), width: 0.6, height: 1.95 };
    const mob = await skills.placeBlockResult(w.bot, 'dirt', 3, 64, 0);
    assert.deepEqual([mob.ok, mob.code, mob.where], [false, 'place-error', '3,64,0']);
    // K1 review 4: the real error is kept; the mob is added.
    assert.match(mob.why, /^Failed to place dirt at \(3, 64, 0\): (Error: )?blockUpdate did not fire; zombie is in that cell\.$/, mob.why);
    const err = await skills.placeBlockResult(w.bot, 'dirt', 3, 64, 2);
    assert.match(err.why, /^Failed to place dirt at \(3, 64, 2\): .*blockUpdate did not fire\.$/);
    assert.equal(await skills.placeBlock(w.bot, 'dirt', 3, 64, 2), false, 'placeBlock stays boolean');
    // The bot's own cell (placeHere's torch): never "you stand in that cell", only the error.
    const own = await skills.placeBlockResult(w.bot, 'dirt', 0, 64, 0, 'bottom', false);
    assert.doesNotMatch(own.why ?? '', /you stand|in that cell/, own.why);
});

// ---- !placeHere ----
test('K1 dl16:798, dl16:456: !placeHere refuses before anything runs: none held (with the blocks held), an item that is no block', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 36: ['hitwithaxe:bark', 1, 20], 37: ['dirt', 9] } });
    useRegistry(t, w.bot);
    assert.deepEqual(placeHereRefusal(w.bot, 'crafting_table'), { code: 'not-held', why: 'Cannot place crafting_table: you hold none (blocks you hold: dirt).' });
    assert.deepEqual(placeHereRefusal(w.bot, 'hitwithaxe:bark:20'), { code: 'not-a-block', why: 'Cannot place hitwithaxe:bark:20: hitwithaxe:bark is an item, not a block.' });
    assert.equal(placeHereRefusal(w.bot, 'dirt'), null, 'a full block with a floor and headroom: the jump runs');
});

test('K1 dl17:308: leaves above the head: the same text as before, then what to do; placeHere itself says the same', async (t) => {
    quiet(t);
    const w = fakeWorld({ at: new Vec3(0, 64, 0), set: { '0,66,0': 'leaves' }, slots: { 36: ['log', 3] } });
    useRegistry(t, w.bot);
    const r = placeHereRefusal(w.bot, 'log');
    assert.equal(r.code, 'no-headroom');
    assert.match(r.why, /^Cannot place log where you stand at 0, 64, 0: you are in that cell, and the leaves above your head leaves no room to jump and put it under you\. Break the leaves above you first, or step to a cell with open air above you \(!moveAway\(2\)\)\.$/);
    const res = await placeHereResult(w.bot, 'log', { pillar: () => assert.fail('no jump') });
    assert.deepEqual([res.ok, res.code, res.where], [false, 'no-headroom', '0,64,0']);
    assert.match(res.why, /^Cannot place log where you stand at 0, 64, 0: you are in that cell, and the leaves above your head leaves no room to jump and put it under you\.$/);
});

test('K1 dl16:1635, dl17:344: the jump-and-place that did not take says pillarUp\'s reason (was dropped)', async (t) => {
    quiet(t);
    const w = fakeWorld({ at: new Vec3(0, 64, 0), slots: { 36: ['log', 3] } });
    useRegistry(t, w.bot);
    const res = await placeHereResult(w.bot, 'log', { pillar: (bot, item, deadline, info) => { info.why = 'the jump did not lift you (0.3 of 1.0)'; return Promise.resolve(false); } });
    assert.deepEqual([res.ok, res.code], [false, 'jump-failed']);
    assert.equal(res.why, 'Could not place log at 0, 64, 0: you are in that cell, and the jump-and-place did not take (still at 0, 64, 0): the jump did not lift you (0.3 of 1.0).');
    assert.equal(await placeHere(w.bot, 'log', { pillar: () => Promise.resolve(true) }), true, 'placeHere stays boolean');
});

test('K1: !placeHere through the command: a refusal is said before perform, with its code', async (t) => {
    const lines = [];
    quiet(t, lines);
    const w = fakeWorld({ slots: { 37: ['dirt', 9] } });
    useRegistry(t, w.bot);
    const runs = [];
    const agent = agentFor(w.bot, runs);
    const reply = await executeCommand(agent, '!placeHere("crafting_table")');
    assert.deepEqual(runs, []);
    assert.equal(reply, 'Cannot place crafting_table: you hold none (blocks you hold: dirt).');
    assert.equal(agent.history.facts.failures[0].code, 'not-held');
});

// ---- K1 review round 1 ----
test('K1 review 1: stacks in the 2x2 grid or on the cursor: no refusal (craftRecipe returns them to the inventory first); the same craft with none anywhere is refused', (t) => {
    quiet(t);
    const grid = fakeWorld({ slots: { 1: ['planks', 4] }, extra: { recipesFor: () => [] } });
    useRegistry(t, grid.bot);
    withRecipes(grid.bot, ['stick']);
    assert.equal(craftRecipeCanRun({ bot: grid.bot }, 'stick'), null, 'the planks in slot 1');
    const none = fakeWorld({ slots: { 5: ['planks', 1] }, extra: { recipesFor: () => [] } }); // slot 5 (armour) only names planks in the registry
    __setRegistryForTest(none.bot.registry);
    withRecipes(none.bot, ['stick']);
    none.bot.inventory.slots[5] = null;
    assert.equal(craftRecipeCanRun({ bot: none.bot }, 'stick')?.code, 'missing');
    none.bot.inventory.selectedItem = grid.bot.inventory.slots[1]; // a stack on the cursor
    assert.equal(craftRecipeCanRun({ bot: none.bot }, 'stick'), null, 'a cursor stack');
});

test('K1 review 3: while the escape climbs (bot.rotnClimbing), canRun is skipped: the command runs (and waits, ESCAPE_WAIT) and its skill judges after the climb', async (t) => {
    const lines = [];
    quiet(t, lines);
    const w = fakeWorld({ slots: { 9: ['pyrotech:rock', 3], 10: ['stick', 4], 11: ['planks', 4] }, extra: { recipesFor: tableOnly() } });
    useRegistry(t, w.bot);
    withRecipes(w.bot, ['stone_axe']);
    const runs = [];
    const agent = agentFor(w.bot, runs);
    w.bot.rotnClimbing = true;
    assert.equal(checkCanRun(cmd('!craftRecipe'), agent, ['stone_axe', 1]), null);
    const reply = await executeCommand(agent, '!craftRecipe("stone_axe", 1)');
    assert.deepEqual(runs, ['action:craftRecipe'], 'perform ran');
    assert.match(reply, /Crafting stone_axe requires a crafting table\./, 'the skill\'s own line');
    assert.equal(agent.history.facts.failures[0].code, 'no-table', 'from the skill\'s result');
    w.bot.rotnClimbing = false;
    assert.equal(checkCanRun(cmd('!craftRecipe'), agent, ['stone_axe', 1])?.code, 'no-table');
});

test('K1 review 5: resultOf takes the failure the skill itself tagged, never a nested skill\'s or a reflex\'s during the call', async () => {
    const bot = { output: '' };
    const r = await resultOf(bot, () => {
        fail(bot, 'place-error', 'Failed to place crafting_table at (1, 64, 0): Error: x.', null, 'placeBlock'); // nested
        bot.output += 'Stopped before the table was reached.\n';
        return Promise.resolve(false);
    }, ['craftRecipe']);
    assert.deepEqual(r, { ok: false, code: 'failed', why: 'Stopped before the table was reached.', where: null });
    const own = await resultOf(bot, () => {
        fail(bot, 'no-table', 'Crafting x requires a crafting table.', null, 'craftRecipe');
        fail(bot, 'not-held', 'Don\'t have any torch to place.', null, 'placeBlock'); // a reflex's, later
        return Promise.resolve(false);
    }, ['craftRecipe']);
    assert.deepEqual([own.code, own.why], ['no-table', 'Crafting x requires a crafting table.']);
    const before = await resultOf(bot, () => Promise.resolve(false), ['craftRecipe']);
    assert.equal(before.code, 'failed', 'a failure tagged before the call is not this call\'s');
});

// ---- Recent failures: a repeat updates its entry (the lead's answer 4) ----
test('K1: the same command and code within 5 min updates its Recent failures entry (time, count "x2"); another code or after 5 min adds one; the 12-entry cap keeps the others', () => {
    const facts = emptyFacts();
    const t0 = 1_000_000;
    for (let i = 0; i < 11; i++) recordFailure(facts, { cmd: `!collectBlocks("x${i}", 1)`, why: `miss ${i}`, at: t0 + i });
    recordFailure(facts, { cmd: '!craftRecipe("stone_axe", 1)', why: 'Failed to place the table at A.', code: 'table-not-placed', at: t0 + 100 });
    assert.equal(facts.failures.length, 12);
    recordFailure(facts, { cmd: '!craftRecipe("stone_axe", 1)', why: 'Failed to place the table at B.', code: 'table-not-placed', at: t0 + 60_000 });
    assert.equal(facts.failures.length, 12, 'updated, not added: x0 is still kept');
    assert.equal(facts.failures[0].cmd, '!collectBlocks("x0", 1)');
    const last = facts.failures.at(-1);
    assert.deepEqual([last.count, last.at, last.why], [2, t0 + 60_000, 'Failed to place the table at B.']);
    recordFailure(facts, { cmd: '!craftRecipe("stone_axe", 1)', why: 'no table', code: 'no-table', at: t0 + 61_000 });
    assert.equal(facts.failures.at(-1).count, undefined, 'another code: its own entry');
    recordFailure(facts, { cmd: '!craftRecipe("stone_axe", 1)', why: 'later', code: 'table-not-placed', at: t0 + 60_000 + MEMORY_FACTS.failureHoldMs });
    assert.equal(facts.failures.at(-1).count, undefined, 'after 5 min: a new entry');
    // Shown with its count.
    const facts2 = emptyFacts();
    recordFailure(facts2, { cmd: '!forage', why: 'No ripe wild food within 24 blocks.', at: Date.now() - 1000 });
    recordFailure(facts2, { cmd: '!forage', why: 'No ripe wild food within 24 blocks.', at: Date.now() });
    const mem = buildMemory({}, { facts: facts2 });
    assert.match(mem, /!forage x2: No ripe wild food within 24 blocks\./);
});

