// Offline tests for standing on a block (G3 round 5 C, the lead): the task "go to the gold block
// at -42 68 -50 and stand on it" ended beside the block; the model walked to the block's own
// position with range 1, said "Standing on the gold block" and called !taskDone. Now: the walk goes
// to x, y+1, z with range 0, the block under the feet is checked, one more walk when off by one, and
// !goToCoordinates on a stand-on task does the same. A fake bot and world; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import '../agent.js'; // the real import order (commands/index.js first)
import { ActionManager } from '../action_manager.js';
import { actionsList, ACTION_LIMITS_MIN, standOnTarget } from '../commands/actions.js';
import { parseStandOn, standCheck, blockNamesFor } from './stand_on.js';
import * as skills from './skills.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const T = { timeout: 8000 };
const TASK = 'go to the gold block at -42 68 -50 and stand on it';
const GOLD = new Vec3(-42, 68, -50);

/**
 * A bot on flat dirt (y 67 and below) with a gold block at -42 68 -50. Each walk lands where
 * landings[i] says (the feet's block position; the last one repeats).
 */
function fakeAgent({ landings = [[-42, 69, -50]], task = null, prompt = '' } = {}) {
    const goals = [];
    const blockAt = (p) => {
        const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        const name = q.equals(GOLD) ? 'gold_block' : q.y <= 67 ? 'dirt' : q.y === 68 && q.x === -43 && q.z === -50 ? 'grass' : 'air';
        return { name, metadata: 0, type: reg.blocksByName[name].id, position: q, boundingBox: name === 'air' ? 'empty' : 'block', transparent: name === 'air', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]] };
    };
    const bot = {
        registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: new Vec3(-30.5, 68, -50.5), height: 1.8, onGround: true }, entities: {},
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => [], slots: [] },
        findBlocks: () => [],
        blockAt,
        lookAt: () => Promise.resolve(),
        emit() {},
        pathfinder: {
            setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false,
            getPathTo: () => ({ status: 'success', path: [] }),
            goto: (goal) => {
                goals.push([goal.x, goal.y, goal.z, goal.rangeSq]);
                const [x, y, z] = landings[Math.min(goals.length - 1, landings.length - 1)];
                bot.entity.position = new Vec3(x + 0.5, y, z + 0.5);
                return Promise.resolve();
            },
        },
    };
    const agent = {
        bot, goals,
        tasks: { tasks: task ? [{ id: 't1', status: 'active', text: task }] : [] },
        self_prompter: { isActive: () => false, prompt },
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        cleanKill() {}, requestInterrupt() {},
        history: { add() {} },
        isIdle: () => true,
    };
    agent.actions = new ActionManager(agent);
    return agent;
}
const perform = (name) => actionsList.find(a => a.name === name).perform;
function quiet(t) { t.mock.method(console, 'log', () => {}); }

test('a task text that says to stand on a block: its coordinates and block; other texts are not', () => {
    assert.deepEqual(parseStandOn(TASK), { x: -42, y: 68, z: -50, name: 'gold_block' });
    assert.deepEqual(parseStandOn('Stand on top of the block of gold at (-42, 68, -50).'), { x: -42, y: 68, z: -50, name: 'gold_block' });
    assert.deepEqual(parseStandOn('stand on the marker at 3 64 9'), { x: 3, y: 64, z: 9, name: null }, 'an unknown block: the position is still checked');
    assert.equal(parseStandOn('go to -42 68 -50'), null);
    assert.equal(parseStandOn('stand on the gold block'), null, 'no coordinates');
    assert.deepEqual(blockNamesFor('gold block'), ['gold_block']);
});

test('the check: beside the block is not on it; on top of the gold block is', () => {
    const { bot } = fakeAgent();
    const target = parseStandOn(TASK);
    bot.entity.position = new Vec3(-42.5, 69, -49.5); // beside it, one block west, on the grass
    const beside = standCheck(bot, target);
    assert.equal(beside.ok, false);
    assert.match(beside.why, /the block under your feet is grass at -43 68 -50, not the gold_block at -42 68 -50/);
    bot.entity.position = new Vec3(-41.5, 69, -49.5);
    assert.equal(standCheck(bot, target).ok, true);
    assert.match(standCheck(bot, { ...target, name: 'diamond_block' }).why, /is gold_block, not diamond_block/);
    bot.entity.onGround = false;
    assert.match(standCheck(bot, target).why, /not on the ground/);
});

test('standOnBlock walks to x, y+1, z with range 0 and says so only after the check', T, async (t) => {
    quiet(t);
    const { bot, goals } = fakeAgent();
    assert.equal(await skills.standOnBlock(bot, -42, 68, -50, 'gold_block'), true);
    assert.deepEqual(goals, [[-42, 69, -50, 0]]);
    assert.match(bot.output, /You are standing on the gold_block at -42 68 -50 \(checked: it is the block under your feet\)\./);
});

test('off by one: one more walk; still off: it says it is NOT on it and not to report the task done', T, async (t) => {
    quiet(t);
    const once = fakeAgent({ landings: [[-43, 69, -50], [-42, 69, -50]] });
    assert.equal(await skills.standOnBlock(once.bot, -42, 68, -50, 'gold_block'), true);
    assert.equal(once.goals.length, 2);
    assert.match(once.bot.output, /Not on it yet: the block under your feet is grass at -43 68 -50.*Trying once more\./);

    const twice = fakeAgent({ landings: [[-43, 69, -50]] });
    assert.equal(await skills.standOnBlock(twice.bot, -42, 68, -50, 'gold_block'), false);
    assert.equal(twice.goals.length, 2, 'retried once, not more');
    assert.match(twice.bot.output, /You are NOT standing on the gold_block at -42 68 -50: .*Do not say you are on it, and do not report a task done for it\./);
    assert.doesNotMatch(twice.bot.output, /You are standing on/);

    const far = fakeAgent({ landings: [[-30, 68, -50]] });
    assert.equal(await skills.standOnBlock(far.bot, -42, 68, -50, 'gold_block'), false);
    assert.equal(far.goals.length, 1, 'far away is not off by one: no second walk');
});

test('the wrong block there: no walk, and it says what is there', T, async (t) => {
    quiet(t);
    const { bot, goals } = fakeAgent();
    assert.equal(await skills.standOnBlock(bot, -42, 68, -50, 'diamond_block'), false);
    assert.deepEqual(goals, []);
    assert.match(bot.output, /The block at -42 68 -50 is gold_block, not diamond_block; not standing on it\./);
});

test('round 5 C replay: !goToCoordinates(-42, 68, -50, 1) on the stand-on task stands on the block and checks it', T, async (t) => {
    quiet(t);
    const agent = fakeAgent({ task: TASK, landings: [[-42, 69, -50]] });
    const out = await perform('!goToCoordinates')(agent, -42, 68, -50, 1);
    assert.deepEqual(agent.goals, [[-42, 69, -50, 0]], 'feet at y+1, range 0 (not the block itself with range 1)');
    assert.match(out, /The task says to stand on the gold_block at -42 68 -50, so standing on top of it and checking\./);
    assert.match(out, /You are standing on the gold_block at -42 68 -50/);

    // From the self-prompt goal too (an agenda or giver goal); y+1 counts as the same spot.
    const goal = fakeAgent({ prompt: `Your goal: ${TASK}.` });
    assert.ok(standOnTarget(goal, -42, 69, -50));
    // Elsewhere, or no stand-on text: the walk is unchanged.
    const other = fakeAgent({ task: TASK, landings: [[-20, 64, 5]] });
    await perform('!goToCoordinates')(other, -20, 64, 5, 1);
    assert.deepEqual(other.goals, [[-20, 64, 5, 1]]);
    assert.equal(standOnTarget(fakeAgent(), -42, 68, -50), null);
});

test('!standOnBlock is a command with a time limit', T, async (t) => {
    quiet(t);
    assert.ok(ACTION_LIMITS_MIN.standOnBlock > 0);
    const agent = fakeAgent({ landings: [[-43, 69, -50]] });
    const out = await perform('!standOnBlock')(agent, 'gold_block', -42, 68, -50);
    assert.match(out, /You are NOT standing on the gold_block at -42 68 -50/);
});
