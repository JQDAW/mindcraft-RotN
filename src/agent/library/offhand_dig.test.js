// Soak 15 (the lead's first fix): #614's rearmWeapon keeps the stone pickaxe in the off hand (slot 45), but the tool
// choosers (mineflayer-tool's equipForBlock, the pathfinder's bestHarvestTool) read inventory.items() (9-44) and the
// main hand only. After a !collectBlocks the walks and !digDown saw no pickaxe: every stone was Infinity ("Path not
// found", "needs a better tool"). Every path that can dig now takes the off-hand pickaxe back first and re-arms after.
// Offline: a fake inventory (slots 9-44 the inventory, 45 the off hand); the fake tool choosers see items() only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import * as skills from './skills.js';
import { ActionManager } from '../action_manager.js';
import { installDigHands } from './hands.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const PICK = { name: 'stone_pickaxe', metadata: 0, count: 1, type: reg.itemsByName.stone_pickaxe.id };
const CLUB = { name: 'spartanweaponry:club_wood', metadata: 48, count: 1, type: 9001 };
const STONE = 'undergroundbiomes:metamorphic_stone';

/** The pickaxe in the off hand, the club in the main hand; stone below the bot (y 63 and down), air above. */
function offHandBot() {
    const slots = new Array(46).fill(null);
    slots[45] = { ...PICK, slot: 45 };
    slots[36] = { ...CLUB, slot: 36 };
    const cells = new Map();
    const log = { planned: [], dug: [], equips: [] };
    const hasPick = () => slots.slice(9, 45).some(s => s?.name === 'stone_pickaxe') || bot.heldItem?.name === 'stone_pickaxe';
    const blockAt = (p) => {
        const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        const name = cells.get(`${q.x},${q.y},${q.z}`) ?? (q.y < 64 ? STONE : 'air');
        return { name, type: name === 'air' ? 0 : 1, metadata: 6, position: q, boundingBox: name === 'air' ? 'empty' : 'block', canHarvest: () => true };
    };
    const bot = {
        registry: reg, version: '1.12.2', output: '', interrupt_code: false, game: { gameMode: 'survival' },
        entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8, effects: {} }, entities: {},
        heldItem: slots[36], quickBarSlot: 0,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), firstEmptyInventorySlot: () => { const i = slots.findIndex((s, k) => k >= 9 && k < 45 && !s); return i < 0 ? null : i; } },
        moveSlotItem: (from, to) => { const s = slots[from]; slots[from] = slots[to] ? { ...slots[to], slot: from } : null; slots[to] = s ? { ...s, slot: to } : null; return Promise.resolve(); },
        equip: (item, dest) => {
            log.equips.push(`${item.name}@${dest}`);
            const from = slots.findIndex(s => s && s.name === item.name);
            if (dest === 'off-hand') { const prev = slots[45]; slots[45] = { ...item, slot: 45 }; slots[from] = prev ? { ...prev, slot: from } : null; }
            else bot.heldItem = slots[from] ?? item;
            return Promise.resolve();
        },
        tool: { equipForBlock: (b) => { const p = slots.slice(9, 45).find(s => s?.name === 'stone_pickaxe'); if (p && b.name !== 'air') bot.heldItem = p; return Promise.resolve(); } },
        dig: (b) => {
            // The Forge dig rule: Underground Biomes stone needs a pickaxe in hand (Infinity otherwise).
            if (bot.heldItem?.name !== 'stone_pickaxe') return Promise.reject(new Error(`dig time for ${b.name} is Infinity`));
            log.dug.push(`${b.position.x},${b.position.y},${b.position.z}`);
            cells.set(`${b.position.x},${b.position.y},${b.position.z}`, 'air');
            return Promise.resolve();
        },
        blockAt, lookAt: () => Promise.resolve(), setControlState() {}, clearControlStates() {},
        digTime: (b) => (b.name === 'air' ? 0 : bot.heldItem?.name === 'stone_pickaxe' ? 350 : Infinity),
        findBlocks: ({ maxDistance = 16, count = 1 } = {}) => [new Vec3(0, 63, 0)].filter(p => blockAt(p).name === STONE).slice(0, count),
        collectBlock: { movements: null, collect: async (b) => { await bot.tool.equipForBlock(b); await bot.dig(b); } },
        pathfinder: {
            setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false,
            // The planner prices stone with bestHarvestTool, which sees items() only: no pickaxe there, no path.
            getPathTo: () => { log.planned.push(hasPick()); return { status: hasPick() ? 'success' : 'noPath', path: [] }; },
            goto: (goal) => {
                if (!hasPick()) return Promise.reject(Object.assign(new Error('No path to the goal!'), { name: 'NoPath' }));
                bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
                return Promise.resolve();
            },
        },
    };
    return { bot, slots, cells, log };
}
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
/** An agent with the real ActionManager (the action boundary: library/hands.js). */
function withActions(bot) {
    const agent = { bot, isIdle: () => true, self_prompter: { isActive: () => false }, clearBotLogs() { bot.output = ''; }, cleanKill() {}, requestInterrupt() {} };
    bot.emit = () => {};
    agent.actions = new ActionManager(agent);
    agent.actions.stop = async () => {};
    return agent;
}

test('soak 15: an action (a goToGoal walk) with the pickaxe in the off hand: planned and walked with it in the inventory, then re-armed', async (t) => {
    quiet(t);
    const { bot, slots, log } = offHandBot();
    const agent = withActions(bot);
    let walked = null;
    await agent.actions.runAction('action:goToCoordinates', async () => { walked = await skills.goToGoal(bot, new pf.goals.GoalBlock(0, 58, 0)); });
    assert.equal(walked, true);
    assert.equal(log.planned[0], true, 'the planner saw the pickaxe (soak 15: "Path not found")');
    assert.equal(slots[45]?.name, 'stone_pickaxe', 're-armed after the action: the pickaxe in the off hand');
    assert.equal(bot.heldItem?.name, 'spartanweaponry:club_wood', 'the club in the main hand');
});

test('soak 15: !breakBlockAt and !digDown through stone with the pickaxe in the off hand (actions): dug, then re-armed', async (t) => {
    quiet(t);
    const a = offHandBot();
    await withActions(a.bot).actions.runAction('action:breakBlockAt', async () => { assert.equal(await skills.breakBlockAt(a.bot, 0, 63, 0), true, a.bot.output); });
    assert.deepEqual(a.log.dug, ['0,63,0']);
    assert.equal(a.slots[45]?.name, 'stone_pickaxe', 're-armed');
    const d = offHandBot();
    await withActions(d.bot).actions.runAction('action:digDown', async () => { assert.equal(await skills.digDown(d.bot, 2), true, d.bot.output); });
    assert.deepEqual(d.log.dug, ['0,63,0', '0,62,0']);
    assert.doesNotMatch(d.bot.output, /needs a better tool/);
    assert.equal(d.slots[45]?.name, 'stone_pickaxe', 're-armed');
});

test('soak 15: a dig outside any action, the pickaxe in the off hand and the club in hand: the bot.dig wrapper takes the pickaxe in hand', async (t) => {
    quiet(t);
    const { bot, log } = offHandBot();
    installDigHands(bot);
    assert.equal(await skills.breakBlockAt(bot, 0, 63, 0), true, bot.output);
    assert.deepEqual(log.dug, ['0,63,0']);
    assert.equal(bot.heldItem?.name, 'stone_pickaxe');
    // A held item that can dig the block: the wrapper does nothing (no clicks).
    const air = offHandBot();
    installDigHands(air.bot);
    air.bot.digTime = () => 100;
    air.bot.dig = air.bot.dig; // still wrapped
    const equips = air.log.equips.length;
    await air.bot.dig(air.bot.blockAt(new Vec3(0, 63, 0))).catch(() => {});
    assert.equal(air.log.equips.length, equips, 'no equip when the held item can dig');
});

test('soak 15: !collectBlocks of stone (an action) with the pickaxe in the off hand: the collect digs it, then re-arms', async (t) => {
    quiet(t);
    const { bot, slots, log } = offHandBot();
    const agent = withActions(bot);
    let ok = null;
    await agent.actions.runAction('action:collectBlocks', async () => { ok = await skills.collectBlock(bot, STONE, 1); });
    assert.deepEqual(log.dug, ['0,63,0'], bot.output);
    assert.equal(slots[45]?.name, 'stone_pickaxe', 're-armed');
    assert.equal(typeof ok, 'boolean');
});
