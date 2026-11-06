// Offline tests for the per-command total limits (G3 smoke C+D and the #221 review): a command
// whose skill never returns ends at its limit with a line the model sees, through the real
// actionsList entry and the real ActionManager, instead of hanging (or the manager's kill).
// A fake agent and bot on the 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import '../agent.js'; // the real import order (commands/index.js first)
import { ActionManager } from '../action_manager.js';
import { actionsList, ACTION_LIMITS_MIN, STOP_GRACE, withinLimit } from './actions.js';
import * as skills from '../library/skills.js';

__setRegistryForTest(minecraftData('1.12.2'));
const reg = minecraftData('1.12.2');
const T = { timeout: 8000 };
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);

function fakeAgent({ openContainer = () => new Promise(() => {}), gotoMs = 0, furnaceAt = null, tableAt = null } = {}) {
    const chest = { name: 'chest', metadata: 0, type: reg.blocksByName.chest.id, position: at(3), boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]] };
    const furnace = furnaceAt && { name: 'furnace', metadata: 0, type: reg.blocksByName.furnace.id, position: furnaceAt, boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]] };
    const table = tableAt && { name: 'crafting_table', metadata: 0, type: reg.blocksByName.crafting_table.id, position: tableAt, boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]] };
    const blocks = [chest, furnace, table].filter(Boolean);
    const items = [
        { name: 'cobblestone', metadata: 0, count: 5, type: reg.itemsByName.cobblestone.id },
        { name: 'iron_ore', metadata: 0, count: 2, type: reg.itemsByName.iron_ore.id },
        { name: 'coal', metadata: 0, count: 2, type: reg.itemsByName.coal.id },
    ];
    const calls = { interrupts: 0, kills: 0, opened: 0, furnaces: 0 };
    const bot = {
        registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: at(0), height: 1.8 }, entities: {},
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items, slots: [null, ...items] },
        findBlocks: ({ matching }) => (blocks.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type))).map(b => b.position)),
        blockAt: (pos) => blocks.find(b => pos.equals(b.position)) ?? null,
        lookAt: () => Promise.resolve(),
        openFurnace: () => { calls.furnaces++; return new Promise(() => {}); },
        emit() {},
        openContainer: () => { calls.opened++; return openContainer(); },
        pathfinder: {
            setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false,
            getPathTo: () => ({ status: 'success', path: [] }),
            // A walk takes gotoMs and is not cut short by stop() (it lands first).
            goto: (goal) => new Promise(resolve => setTimeout(() => { bot.entity.position = at(goal.x + 1, goal.y, goal.z); resolve(); }, gotoMs)),
        },
    };
    const agent = {
        bot, calls,
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        cleanKill() { calls.kills++; },
        requestInterrupt() { calls.interrupts++; bot.interrupt_code = true; bot.pathfinder.stop(); },
        history: { add() {} },
        self_prompter: { isActive: () => false },
        isIdle: () => true,
    };
    agent.actions = new ActionManager(agent);
    return agent;
}

const perform = (name) => actionsList.find(a => a.name === name).perform;

test('every command the G3 review named has a total limit', () => {
    for (const name of ['collectBlocks', 'attack', 'buildShelter', 'digDown', 'craftRecipe', 'smeltItem', 'putInChest',
        'takeFromChest', 'searchForBlock', 'searchForEntity', 'goToCoordinates', 'goToPlayer', 'moveAway', 'useOn']) {
        assert.ok(ACTION_LIMITS_MIN[name] > 0, `!${name} has a limit`);
        assert.ok(actionsList.some(a => a.name === `!${name}`), `!${name} is a command`);
    }
});

test('!putInChest whose chest never opens ends at its limit with a clear line, not a hang or a kill', T, async (t) => {
    const saved = [ACTION_LIMITS_MIN.putInChest, STOP_GRACE.ms];
    t.after(() => { [ACTION_LIMITS_MIN.putInChest, STOP_GRACE.ms] = saved; });
    ACTION_LIMITS_MIN.putInChest = 0.005; // 0.3 s
    STOP_GRACE.ms = 200;
    const agent = fakeAgent();
    const t0 = Date.now();
    const out = await perform('!putInChest')(agent, 'cobblestone', 2);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
    assert.equal(agent.calls.opened, 1);
    assert.equal(agent.calls.interrupts >= 1, true, 'the bot was interrupted');
    assert.equal(agent.calls.kills, 0, 'no process kill');
    assert.match(out, /!putInChest failed: time limit of 0\.3 s reached; stopped\./);
    assert.equal(agent.actions.executing, false);
});

test('a command that ends in time is unchanged; a throw is still reported', T, async () => {
    const agent = fakeAgent({ openContainer: () => Promise.resolve({ deposit: () => Promise.resolve(), close: () => Promise.resolve() }) });
    const out = await perform('!putInChest')(agent, 'cobblestone', 2);
    assert.match(out, /Successfully put 2 cobblestone in the chest\./);
    assert.doesNotMatch(out, /time limit/);

    const b = fakeAgent();
    await assert.rejects(withinLimit(b, 'x', () => Promise.reject(new Error('boom')), 1000), /boom/);
});

// #224 review: a skill whose await settles after its command reported failure must stop there.
test('a chest window that opens after the limit is closed again; nothing is deposited', T, async (t) => {
    const saved = [ACTION_LIMITS_MIN.putInChest, STOP_GRACE.ms];
    t.after(() => { [ACTION_LIMITS_MIN.putInChest, STOP_GRACE.ms] = saved; });
    ACTION_LIMITS_MIN.putInChest = 0.005; // 0.3 s
    STOP_GRACE.ms = 200;
    const window = { deposits: 0, closes: 0, deposit() { this.deposits++; return Promise.resolve(); }, close() { this.closes++; } };
    const agent = fakeAgent({ openContainer: () => new Promise(resolve => setTimeout(() => resolve(window), 900)) });
    const out = await perform('!putInChest')(agent, 'cobblestone', 2);
    assert.match(out, /!putInChest failed: time limit of 0\.3 s reached; stopped\./);
    await new Promise(resolve => setTimeout(resolve, 1000)); // the late window opens
    assert.equal(window.deposits, 0, 'nothing deposited after the command failed');
    assert.equal(window.closes, 1, 'the late window was closed');
    assert.doesNotMatch(agent.bot.output, /Successfully put/);
    assert.equal(agent.bot.action_run, null, 'a later skill does not see this aborted run');
});

test('#224 review 3: !craftRecipe has more time than one 3 min walk', () => {
    assert.equal(ACTION_LIMITS_MIN.craftRecipe, 4);
});

// #225 review: the run is taken on the first line, so a limit hit during the walk stops the skill
// too; goToPosition, craftByFill and collectBlock check it after their awaits.
test('!smeltItem whose limit passes during the walk to the furnace never opens it', T, async (t) => {
    const saved = [ACTION_LIMITS_MIN.smeltItem, STOP_GRACE.ms];
    t.after(() => { [ACTION_LIMITS_MIN.smeltItem, STOP_GRACE.ms] = saved; });
    ACTION_LIMITS_MIN.smeltItem = 0.005; // 0.3 s
    STOP_GRACE.ms = 100;
    const agent = fakeAgent({ gotoMs: 700, furnaceAt: at(10) });
    const out = await perform('!smeltItem')(agent, 'cobblestone', 1);
    assert.match(out, /!smeltItem failed: time limit of 0\.3 s reached; stopped\./);
    await new Promise(resolve => setTimeout(resolve, 900)); // the walk lands
    assert.equal(agent.calls.furnaces, 0, 'the furnace was never opened');
});

test('goToPosition and collectBlock stop after an await once their run is aborted', T, async () => {
    const agent = fakeAgent({ gotoMs: 300 });
    const bot = agent.bot;
    const run = { aborted: false };
    bot.action_run = run;
    setTimeout(() => { run.aborted = true; }, 100);
    assert.equal(await skills.goToPosition(bot, 3, 64, 0, 2), false);
    assert.doesNotMatch(bot.output, /You have reached/);

    // collectBlock, by hand (a torch has no collision box): the walk lands after the abort; no dig.
    const b2 = fakeAgent({ gotoMs: 300 }).bot;
    let digs = 0;
    b2.dig = () => { digs++; return Promise.resolve(); };
    b2.tool = { equipForBlock: () => Promise.resolve() };
    b2.stopDigging = () => {};
    b2.collectBlock = { collect: () => { digs++; return Promise.resolve(); }, cancelTask: () => Promise.resolve() };
    b2.blockAt = (pos) => (pos.equals(at(3)) ? { name: 'torch', metadata: 0, type: reg.blocksByName.torch.id, position: at(3), canHarvest: () => true, boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]] } : null);
    b2.findBlocks = ({ matching }) => [b2.blockAt(at(3))].filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type))).map(b => b.position);
    const r2 = { aborted: false };
    b2.action_run = r2;
    setTimeout(() => { r2.aborted = true; }, 100); // during the walk to the block
    assert.equal(await skills.collectBlock(b2, 'torch', 1), false);
    assert.equal(digs, 0, 'nothing broken for an aborted run');
});

test('craftByFill stops once its run is aborted: no walk to the table, no craft', T, async () => {
    const bot = fakeAgent({ tableAt: at(12) }).bot;
    let crafts = 0;
    let walks = 0;
    bot.craft = () => { crafts++; return Promise.resolve(); };
    const goto = bot.pathfinder.goto;
    bot.pathfinder.goto = (goal) => { walks++; return goto(goal); };
    const table = bot.blockAt(at(12));
    const needs = { recipeId: 'x', requiresTable: true, ready: true, inputs: [] };
    const ops = { place: () => Promise.resolve(null), pickUp: () => Promise.resolve() };
    assert.equal(await skills.craftByFill(bot, 'stick', 4, needs, table, false, ops, { aborted: true }), false);
    assert.equal(walks, 0, 'no walk to the table');
    assert.equal(crafts, 0);
});

test('#225 nit: !clearFurnace whose limit passes during the walk to the furnace never opens it', T, async (t) => {
    const saved = [ACTION_LIMITS_MIN.clearFurnace, STOP_GRACE.ms];
    t.after(() => { [ACTION_LIMITS_MIN.clearFurnace, STOP_GRACE.ms] = saved; });
    ACTION_LIMITS_MIN.clearFurnace = 0.005; // 0.3 s
    STOP_GRACE.ms = 100;
    const agent = fakeAgent({ gotoMs: 700, furnaceAt: at(10) });
    const out = await perform('!clearFurnace')(agent);
    assert.match(out, /!clearFurnace failed: time limit of 0\.3 s reached; stopped\./);
    await new Promise(resolve => setTimeout(resolve, 900)); // the walk lands
    assert.equal(agent.calls.furnaces, 0, 'the furnace was never opened or emptied');
});
