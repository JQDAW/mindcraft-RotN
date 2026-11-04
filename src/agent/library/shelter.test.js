// skills-rotn D2b: building the first-night shelter from inside, offline. A fake world (dirt
// below y 64, air above), a fake bot that places and digs in it, and the real 3.3.4 dump for
// what is sturdy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { shelterItems, siteNeeds, chooseSite, buildShelter } from './shelter.js';
import { getCommand } from '../commands/index.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;
const blockOf = (name, position) => {
    const b = reg.blocksByName[name];
    return { name, metadata: 0, boundingBox: b.boundingBox, material: b.material, position, canHarvest: () => true };
};

function fakeBot({ cobble = 10, set = {}, at = new Vec3(0.5, 64, 0.5) } = {}) {
    const world = new Map(Object.entries(set));
    const items = cobble > 0 ? [{ name: 'cobblestone', metadata: 0, count: cobble }] : [];
    const placed = [], dug = [];
    const bot = {
        output: '',
        entity: { position: at },
        inventory: { items: () => items.filter(i => i.count > 0) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        blockAt: (p) => {
            const q = p.floored();
            return blockOf(world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air'), q);
        },
        equip: async () => {},
        lookAt: async () => {},
        setControlState: () => {},
        placeBlock: (ref, face) => {
            const target = ref.position.plus(face);
            assert.notEqual(ref.boundingBox, 'empty', 'placed against a solid block');
            assert.equal(bot.blockAt(target).boundingBox, 'empty', 'the target was free');
            items[0].count--;
            world.set(key(target), 'cobblestone');
            placed.push(key(target));
            return Promise.resolve();
        },
        dig: (b) => { world.set(key(b.position), 'air'); dug.push(key(b.position)); return Promise.resolve(); },
    };
    return { bot, placed, dug, world };
}

test('D2b: on flat dirt with 10 cobblestone the bot closes a shelter in its own cell, from inside', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, placed } = fakeBot();
    const r = await buildShelter(bot);
    assert.equal(r.closed, true);
    assert.equal(r.placed, 10, '8 walls, a block to hold the roof, the roof');
    assert.ok(r.feet.equals(new Vec3(0, 64, 0)));
    assert.ok(!placed.includes('0,64,0') && !placed.includes('0,65,0'), 'the 1x2 space stays free');
    assert.equal(placed.at(-1), '0,66,0', 'the roof last');
    assert.match(bot.output, /Shelter closed at 0, 64, 0: placed 10 blocks\. The floor is dirt, not rock\./);
});

test('D2b: too few sturdy blocks: it says how many it needs and places nothing', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, placed } = fakeBot({ cobble: 9 });
    const r = await buildShelter(bot);
    assert.equal(r.closed, false);
    assert.deepEqual(placed, []);
    assert.match(bot.output, /A shelter at 0, 64, 0 needs 10 sturdy blocks \(cobblestone or stone\); you have 9\./);
    assert.deepEqual(shelterItems(fakeBot({ cobble: 0, set: {} }).bot), [], 'dirt and logs do not count');
});

test('D2b: a breached shelter is repaired with one block; dirt in a wall is dug and replaced', async (t) => {
    t.mock.method(console, 'log', () => {});
    const shell = {};
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { shell[`${x},64,${z}`] = 'cobblestone'; shell[`${x},65,${z}`] = 'cobblestone'; }
    shell['0,66,0'] = 'cobblestone';
    shell['1,65,0'] = 'air'; // a mob broke out a wall
    shell['-1,64,0'] = 'dirt';
    const { bot, placed, dug } = fakeBot({ cobble: 2, set: shell });
    assert.equal(siteNeeds(bot, new Vec3(0, 64, 0)).blocks, 2);
    const r = await buildShelter(bot);
    assert.equal(r.closed, true);
    assert.deepEqual(dug, ['-1,64,0']);
    assert.deepEqual(placed.sort(), ['-1,64,0', '1,65,0']);
});

test('D2b: the site needing the fewest blocks wins; a site next to lava or with no floor is never used', (t) => {
    t.mock.method(console, 'log', () => {});
    // A stone corner 2 blocks east: its walls on two sides and its roof are already there.
    const set = {};
    for (const p of ['3,64,0', '3,65,0', '2,64,1', '2,65,1', '2,66,0']) set[p] = 'stone';
    const { bot } = fakeBot({ set });
    const site = chooseSite(bot, 4);
    assert.ok(site.feet.equals(new Vec3(2, 64, 0)), `chose ${site.feet}`);
    assert.equal(site.blocks, 4);

    const lava = fakeBot({ set: { '1,64,0': 'lava' } }).bot;
    assert.equal(siteNeeds(lava, new Vec3(0, 64, 0)), null);
    const noFloor = fakeBot({ set: { '0,63,0': 'air' } }).bot;
    assert.equal(siteNeeds(noFloor, new Vec3(0, 64, 0)), null);
});

test('D2b: !buildShelter is a command that runs the shelter build as an action', async (t) => {
    t.mock.method(console, 'log', () => {});
    const cmd = getCommand('!buildShelter');
    assert.ok(cmd, 'registered');
    assert.deepEqual(Object.keys(cmd.params ?? {}), []);
    const { bot } = fakeBot();
    let label = null;
    const agent = { bot, actions: { runAction: async (l, fn) => { label = l; await fn(); return { message: bot.output, interrupted: false }; } } };
    await cmd.perform(agent);
    assert.equal(label, 'action:buildShelter');
    assert.match(bot.output, /Shelter closed at/);
});

test('D2b: unstuck leaves the shelter build alone (it stands still on purpose), but still counts for other actions', async () => {
    const { __modeForTest, STATIONARY_ACTIONS } = await import('../modes.js');
    assert.deepEqual(STATIONARY_ACTIONS, ['action:buildShelter']);
    const mode = __modeForTest('unstuck');
    const position = new Vec3(0.5, 64, 0.5);
    const agent = { isIdle: () => false, actions: { currentActionLabel: 'action:buildShelter' }, bot: { entity: { position }, targetDigBlock: null } };
    mode.prev_location = position.clone();
    mode.stuck_time = mode.max_stuck_time + 1;
    mode.last_time = Date.now() - 1000;
    await mode.update(agent);
    assert.equal(mode.stuck_time, 0);
    assert.equal(mode.active, false, 'no move-away');

    agent.actions.currentActionLabel = 'action:collectBlocks';
    mode.prev_location = position.clone();
    mode.stuck_time = 1;
    mode.last_time = Date.now() - 1000;
    await mode.update(agent);
    assert.ok(mode.stuck_time > 1, 'another action standing still is counted as stuck');
});
