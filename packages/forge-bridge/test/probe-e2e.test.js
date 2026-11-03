// Probe P1's driver commands (tools/probe-commands.mjs) offline: Mindcraft's real initBot in the
// craft world (craft-world.js: real Run A ids, RotN's FastWorkbench table, fake 1.12.2
// containers). The fake server sends the commands in chat as the scenario will; the bot crafts
// with rotn-data's real dump recipes (convertRecipe), places and eats, and answers each with a
// DRIVER-style JSON event and one chat line. Loopback only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpFile } from './helpers.js';
import { I, B, TABLE, within, startCraftWorld, stopCraftWorld } from './craft-world.js';
import { attachProbe, chatLine, itemByName, pickVariant, checkProbeReply, registryName } from '../tools/probe-commands.mjs';

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

test('registryName gives full names; checkProbeReply holds a reply to the contract', () => {
    assert.equal(registryName({ name: 'stick' }), 'minecraft:stick');
    assert.equal(registryName({ name: 'pyrotech:rock' }), 'pyrotech:rock');
    assert.equal(registryName({ name: 'silver_shulker_box', registryName: 'minecraft:silver_shulker_box' }), 'minecraft:silver_shulker_box');
    const ok = { type: 'probe', t: '2026-11-03T00:00:00Z', v: 1, token: 'abcdef', cmd: 'place', ok: true, item: 'minecraft:cobblestone', ref: [1, 64, 1], face: 'up', target: [1, 65, 1],
        before: 'minecraft:air', after: 'minecraft:cobblestone', expected: 'minecraft:cobblestone', otherUpdates: 0, totalMs: 80, updateMs: 40, timeoutMs: 10000 };
    assert.deepEqual(checkProbeReply(ok), []);
    // What #165's first fake driver read: fields the real driver never sends, and short names.
    assert.ok(checkProbeReply({ ...ok, window: 'x' }).includes('unknown field window'));
    assert.ok(checkProbeReply({ ...ok, after: 'cobblestone' }).some(p => p.startsWith('after:')));
    const noUpdate = { ...ok };
    delete noUpdate.updateMs;
    assert.ok(checkProbeReply(noUpdate).includes('ok reply without updateMs'));
    assert.ok(checkProbeReply({ ...ok, v: 0 }).some(p => p.startsWith('v is')));
    assert.deepEqual(checkProbeReply({ v: 1, token: 'abcdef', cmd: 'craft', ok: false, error: 'time limit of 60000 ms reached', timedOut: true, limitMs: 60000 }), []);
    assert.ok(checkProbeReply({ v: 1, token: 'abcdef', cmd: 'eat', ok: false }).includes('failure without error'));
    assert.ok(checkProbeReply({ v: 1, token: 'abcdef', cmd: 'eat', ok: false, error: 'x', timedOut: false }).some(p => p.startsWith('timedOut:')), 'timedOut is only ever true');
});

test('pickVariant never counts one stack for two cells (any meta plus a fixed meta of the same id)', () => {
    const inv = (items) => ({ inventory: { items: () => items.map(([type, metadata, count]) => ({ type, metadata, count })) } });
    // Two cells of item 5: one any-meta, one meta 2. One meta-2 plank cannot fill both.
    const v = [{ ingredients: [{ id: 5, metadata: null }, { id: 5, metadata: 2 }] }];
    assert.equal(pickVariant(inv([[5, 2, 1]]), v), null);
    assert.equal(pickVariant(inv([[5, 2, 2]]), v)?.index, 0);
    assert.equal(pickVariant(inv([[5, 2, 1], [5, 0, 1]]), v)?.index, 0);
    assert.equal(pickVariant(inv([[5, 0, 2]]), v), null, 'the fixed meta still needs its own stack');
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
    // A short time limit for the hung-command check below; every real command here takes well under it.
    attachProbe(bot, { emit: (type, data = {}) => events.push({ type, ...data }), dumpRecipes: () => pack.dump.recipes.recipes, convertRecipe, answerDelayMs: 0, commandTimeoutMs: 6000, placeTimeoutMs: 9000 });
    // What a 1.12 server sends for a console `tell FRCFLD <text>`; mineflayer reports it as a whisper from Server.
    const whisper = (from, text) => serverClient.write('chat', { message: JSON.stringify({ translate: 'commands.message.display.incoming', with: [from, { text }], color: 'gray', italic: true }), position: 0 });
    assert.deepEqual(events.find(e => e.type === 'probe_ready'), { type: 'probe_ready', autoEat: 'off' });
    assert.equal(bot.autoEat.disabled, true, 'auto-eat is off while the probe runs');

    let n = 0;
    const send = async (text) => {
        const token = `abcdef${String(++n).padStart(2, '0')}`;
        whisper('Server', text.replace('TOKEN', token));
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
    assert.deepEqual([pick.result, pick.tableBlock], ['minecraft:stone_pickaxe', 'minecraft:crafting_table'], 'full registry names (contract v1)');
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
    assert.deepEqual([place.before, place.after, place.target], ['minecraft:air', 'minecraft:cobblestone', [6, 65, 6]]);
    assert.ok(Number.isInteger(place.updateMs) && place.updateMs >= 0 && place.updateMs <= place.totalMs, JSON.stringify(place));
    assert.equal(place.timeoutMs, 9000);
    assert.deepEqual([place.expected, place.otherUpdates], ['minecraft:cobblestone', 0], 'only the update to the placed block counts');

    // An unrelated update to the same block first (stone, before the cobblestone): mineflayer's
    // placeBlock returns on it, but the probe waits for the placed block's own update.
    containers.state.noiseNext = B.stone;
    const noisy = await send('probe-place TOKEN minecraft:cobblestone 5,64,6 up');
    assert.equal(noisy.ok, true, JSON.stringify(noisy));
    assert.deepEqual([noisy.after, noisy.otherUpdates], ['minecraft:cobblestone', 1], 'the stone update is counted apart, the cobblestone one is the placement');
    assert.ok(Number.isInteger(noisy.updateMs));
    assert.deepEqual(st.placed.map(p => p.target), [{ x: 6, y: 65, z: 6 }, { x: 5, y: 65, z: 6 }]);

    // Only the console whisper is accepted: the same command in public chat, or whispered by a player, does nothing.
    const heard = () => events.filter(e => e.type === 'probe_heard').length;
    const heardBefore = heard();
    serverClient.write('chat', { message: JSON.stringify({ text: '<JQDAW> probe-eat abcdef77 minecraft:bread' }), position: 0 });
    serverClient.write('chat', { message: JSON.stringify({ text: 'probe-eat abcdef78 minecraft:bread' }), position: 1 });
    whisper('JQDAW', 'probe-eat abcdef79 minecraft:bread');
    whisper('Server', 'say probe-eat abcdef80 minecraft:bread'); // not anchored at the start
    await sleep(1500);
    assert.equal(heard(), heardBefore, 'no command from public chat, a player whisper or an unanchored line');
    assert.ok(events.some(e => e.type === 'probe_ignored' && e.from === 'JQDAW'), 'the player whisper is logged as ignored');

    // A hung command (the fake server never places a stick) is answered ok:false at the time limit;
    // its late result is only logged, and the next command runs after it settles.
    const hung = await send('probe-place TOKEN minecraft:stick 7,64,6 up');
    assert.equal(hung.ok, false);
    assert.equal(hung.timedOut, true);
    assert.match(hung.error, /time limit of 6000 ms reached/);
    const late = await within(30000, (async () => { for (;;) { const e = events.find(x => x.type === 'probe_late' && x.token === hung.token); if (e) return e; await sleep(100); } })(), 'probe_late');
    assert.equal(late.ok, false);
    assert.ok(!events.some(e => e.type === 'probe_stuck'), 'it settled within the grace time');

    // An op's /say lookalike ("[JQDAW] Server whispers to you: ...", chat.type.announcement) is not a
    // console whisper: mineflayer's whisper pattern takes it for one from Server, the probe does not.
    const sayBefore = heard();
    serverClient.write('chat', { message: JSON.stringify({ translate: 'chat.type.announcement', with: ['JQDAW', { text: 'Server whispers to you: probe-eat abcdef81 minecraft:bread' }] }), position: 0 });
    await sleep(1500);
    assert.equal(heard(), sayBefore, 'the /say lookalike starts nothing');

    // Eat bread (food under 20 first, as the scenario's hunger effect does).
    containers.setFood(15);
    for (let waited = 0; bot.food !== 15 && waited < 5000; waited += 50) await sleep(50);
    const eat = await send('probe-eat TOKEN minecraft:bread');
    assert.equal(eat.ok, true, JSON.stringify(eat));
    assert.deepEqual([eat.foodBefore, eat.foodAfter, eat.countBefore, eat.countAfter], [15, 20, 2, 1]);
    assert.deepEqual(st.uses.map(u => u.hand), [0]);

    // A repeated token runs once.
    const before = events.filter(e => e.type === 'probe').length;
    whisper('Server', 'probe-eat abcdef01 minecraft:bread');
    await sleep(1500);
    assert.equal(events.filter(e => e.type === 'probe').length, before);

    // A malformed command (a bad table position) is answered as such, never run in the 2x2 grid.
    const bad = await send('probe-craft TOKEN crafttweaker:pyro_crude_axe 1,2');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /malformed command/);
    assert.equal(bad.line, `probe-craft abcdef${String(n).padStart(2, '0')} crafttweaker:pyro_crude_axe 1,2`);

    // The bot's own answer, echoed back in chat, starts nothing.
    const quiet = events.filter(e => e.type === 'probe' || e.type === 'probe_heard').length;
    serverClient.write('chat', { message: JSON.stringify({ text: '<FRCFLD> probe abcdef99 craft ok recipe=crafttweaker:pyro_crude_axe' }), position: 0 });
    await sleep(1500);
    assert.equal(events.filter(e => e.type === 'probe' || e.type === 'probe_heard').length, quiet);

    // Every reply (and the late one) meets the reply contract.
    for (const e of events.filter(x => x.type === 'probe' || x.type === 'probe_late')) {
        const { type, ...reply } = e;
        assert.deepEqual(checkProbeReply(type === 'probe' ? { type, ...reply } : reply), [], JSON.stringify(e));
    }

    // One chat answer per command, in the documented form.
    for (let waited = 0; server.state.chats.filter(c => c.startsWith('probe ')).length < n && waited < 5000; waited += 50) await sleep(50);
    const answers = server.state.chats.filter(c => c.startsWith('probe '));
    assert.equal(answers.length, n);
    assert.ok(answers.every(a => a.length <= 200 && /^probe abcdef\d\d (craft|place|eat) (ok|fail)/.test(a)), answers.join('\n'));
    assert.ok(answers.some(a => a.startsWith('probe abcdef04 craft ok recipe=crafttweaker:stone_pickaxe result=minecraft:stone_pickaxe before=0 after=1')), answers.join('\n'));
});
