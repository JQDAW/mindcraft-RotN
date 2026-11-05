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

__setRegistryForTest(minecraftData('1.12.2'));
const reg = minecraftData('1.12.2');
const T = { timeout: 8000 };
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);

function fakeAgent({ openContainer = () => new Promise(() => {}) } = {}) {
    const chest = { name: 'chest', metadata: 0, type: reg.blocksByName.chest.id, position: at(3), boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]] };
    const items = [{ name: 'cobblestone', metadata: 0, count: 5, type: reg.itemsByName.cobblestone.id }];
    const calls = { interrupts: 0, kills: 0, opened: 0 };
    const bot = {
        registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: at(0), height: 1.8 }, entities: {},
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items, slots: [null, ...items] },
        findBlocks: ({ matching }) => ([chest].filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type))).map(b => b.position)),
        blockAt: (pos) => (pos.equals(chest.position) ? chest : null),
        emit() {},
        openContainer: () => { calls.opened++; return openContainer(); },
        pathfinder: {
            setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false,
            getPathTo: () => ({ status: 'success', path: [] }),
            goto: (goal) => { bot.entity.position = at(goal.x + 1, goal.y, goal.z); return Promise.resolve(); },
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
