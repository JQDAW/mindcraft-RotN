// Probe P1's driver commands (tools/probe-commands.mjs) offline: Mindcraft's real initBot in the
// craft world (craft-world.js: real Run A ids, RotN's FastWorkbench table, fake 1.12.2
// containers). The fake server sends the commands in chat as the scenario will; the bot crafts
// with rotn-data's real dump recipes (convertRecipe), places and eats, and answers each with a
// DRIVER-style JSON event and one chat line. Loopback only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpFile } from './helpers.js';
import { I, TABLE, within, startCraftWorld, stopCraftWorld } from './craft-world.js';
import { attachProbe, chatLine, itemByName } from '../tools/probe-commands.mjs';

let world;
after(() => stopCraftWorld(world));

test('chatLine stays under 200 characters and itemByName knows minecraft: prefixes', () => {
    const line = chatLine('abcdef12', 'craft', false, { error: 'x'.repeat(500), at: [1, 2, 3] });
    assert.ok(line.length <= 200 && line.startsWith('probe abcdef12 craft fail error=x'));
    assert.equal(chatLine('abcdef12', 'eat', true, { food: '15->20', left: 1, none: null }), 'probe abcdef12 eat ok food=15->20 left=1');
    const registry = { itemsByName: { stick: { id: 280 }, 'pyrotech:rock': { id: 8917 } } };
    assert.equal(itemByName(registry, 'minecraft:stick').id, 280);
    assert.equal(itemByName(registry, 'pyrotech:rock').id, 8917);
    assert.equal(itemByName(registry, 'minecraft:nope'), null);
});

test('probe-craft, probe-place and probe-eat through initBot, answered as JSON and in chat', { timeout: 240000 }, async () => {
    let serverClient = null;
    world = await startCraftWorld({ captureFile: tmpFile('probe-capture.jsonl'), onJoin: (client) => { serverClient = client; } });
    const { bot, server } = world;
    const containers = world.containers();
    const st = containers.state;
    const { loadRotnData, PACK_VERSION, convertRecipe } = await import('../../rotn-data/index.js');
    const pack = loadRotnData(PACK_VERSION);

    const events = [];
    attachProbe(bot, { emit: (type, data = {}) => events.push({ type, ...data }), dumpRecipes: () => pack.dump.recipes.recipes, convertRecipe, answerDelayMs: 0 });
    assert.deepEqual(events.find(e => e.type === 'probe_ready'), { type: 'probe_ready', autoEat: 'off' });
    assert.equal(bot.autoEat.disabled, true, 'auto-eat is off while the probe runs');

    let n = 0;
    const send = async (text) => {
        const token = `abcdef${String(++n).padStart(2, '0')}`;
        serverClient.write('chat', { message: JSON.stringify({ text: text.replace('TOKEN', token) }), position: 1 });
        const ev = await within(60000, (async () => {
            for (;;) {
                const e = events.find(x => x.type === 'probe' && x.token === token);
                if (e) return e;
                await sleep(50);
            }
        })(), text);
        return ev;
    };

    // The 2x2 grid, with the real dump recipes.
    const axe = await send('probe-craft TOKEN crafttweaker:pyro_crude_axe');
    assert.equal(axe.ok, true, JSON.stringify(axe));
    assert.deepEqual([axe.result, axe.before, axe.after, axe.table], ['pyrotech:crude_axe', 0, 1, null]);
    const tools = await send('probe-craft TOKEN crafttweaker:crafting_tools');
    assert.equal(tools.ok, true, JSON.stringify(tools));
    const table = await send('probe-craft TOKEN crafttweaker:crafting_table');
    assert.equal(table.ok, true, JSON.stringify(table));
    // RotN's FastWorkbench table at X,Y,Z (OpenGui -> the synthetic window).
    const pick = await send(`probe-craft TOKEN crafttweaker:stone_pickaxe ${TABLE.x},${TABLE.y},${TABLE.z}`);
    assert.equal(pick.ok, true, JSON.stringify(pick));
    assert.deepEqual([pick.result, pick.tableBlock], ['stone_pickaxe', 'crafting_table']);
    assert.deepEqual([containers.count(I.crudeAxe), containers.count(I.craftingTools), containers.count(I.table), containers.count(I.stonePickaxe), containers.count(I.rock)], [0, 0, 1, 1, 0], 'server-side inventory');
    assert.deepEqual(st.rejected, []);
    assert.equal(bot.forge.bridge.stats.modWindows, 1);

    // Failures are answered, not thrown.
    const missing = await send('probe-craft TOKEN crafttweaker:stone_pickaxe 10,65,8');
    assert.equal(missing.ok, false);
    assert.match(missing.error, /missing ingredients/);
    const unknown = await send('probe-craft TOKEN crafttweaker:no_such_recipe');
    assert.match(unknown.error, /not in rotn-data's dump/);

    // Place cobblestone on the floor; latency from the call to the server's block update.
    const place = await send('probe-place TOKEN minecraft:cobblestone 6,64,6 up');
    assert.equal(place.ok, true, JSON.stringify(place));
    assert.deepEqual([place.before, place.after, place.target], ['air', 'cobblestone', [6, 65, 6]]);
    assert.ok(Number.isInteger(place.updateMs) && place.updateMs >= 0 && place.updateMs <= place.totalMs, JSON.stringify(place));
    assert.equal(place.timeoutMs, 10000);
    assert.deepEqual(st.placed.map(p => p.target), [{ x: 6, y: 65, z: 6 }]);

    // Eat bread (food under 20 first, as the scenario's hunger effect does).
    containers.setFood(15);
    for (let waited = 0; bot.food !== 15 && waited < 5000; waited += 50) await sleep(50);
    const eat = await send('probe-eat TOKEN minecraft:bread');
    assert.equal(eat.ok, true, JSON.stringify(eat));
    assert.deepEqual([eat.foodBefore, eat.foodAfter, eat.countBefore, eat.countAfter], [15, 20, 2, 1]);
    assert.deepEqual(st.uses.map(u => u.hand), [0]);

    // A repeated token runs once.
    const before = events.filter(e => e.type === 'probe').length;
    serverClient.write('chat', { message: JSON.stringify({ text: 'probe-eat abcdef01 minecraft:bread' }), position: 1 });
    await sleep(1500);
    assert.equal(events.filter(e => e.type === 'probe').length, before);

    // One chat answer per command, in the documented form.
    for (let waited = 0; server.state.chats.filter(c => c.startsWith('probe ')).length < n && waited < 5000; waited += 50) await sleep(50);
    const answers = server.state.chats.filter(c => c.startsWith('probe '));
    assert.equal(answers.length, n);
    assert.ok(answers.every(a => a.length <= 200 && /^probe abcdef\d\d (craft|place|eat) (ok|fail)/.test(a)), answers.join('\n'));
    assert.ok(answers.some(a => a.startsWith('probe abcdef04 craft ok recipe=crafttweaker:stone_pickaxe result=stone_pickaxe before=0 after=1')), answers.join('\n'));
});
