// The fake-server task (/home/rv/fake-forge-server-plan.md): digging through Mindcraft's real initBot
// and mineflayer's real bot.dig against the fake Forge server's dig model (fake-dig.js: the 1.12.2
// PlayerInteractionManager rule with Tool Progression, from the same dump the client uses). Loopback only.
//
// - the soak 15 trap: the stone pickaxe in the off hand, then on the cursor: the client's rule refuses
//   at once (no packet) and initBot's dig-refused line says where the pickaxe is;
// - an ABORT: the block is sent back;
// - a client/server difference: the client holds the pickaxe, the server's held slot has planks. The
//   client predicts air and bot.dig resolves; the server never breaks the block, sends it back and holds
//   its delayed-destroy slot (skills-rotn's soak 15 question C: "Broke ..." while the block is still
//   there); a later early STOP on another block is ignored; once the server holds the pickaxe the held
//   block breaks;
// - an early STOP (Mining Fatigue on the server only): the block is sent back, then broken by the
//   delayed destroy;
// - soak 14's respawn: a death drops the effects (#610's patch); a dimension change resends them.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { tmpFile } from './helpers.js';
import { startRotnWorld, stopCraftWorld, within } from './craft-world.js';
import { respawnAfterDeath, changeDimension, effectPacket } from './fake-forge-server.js';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3');
let world;
after(() => { world?.dig?.()?.stop(); return stopCraftWorld(world ?? {}); });

test('digging through real mineflayer against the server\'s rule: refused, sent back, delayed, and the respawn effects', { timeout: 60000 }, async () => {
    const at = (x) => ({ x, y: 64, z: 6 });
    world = await startRotnWorld({
        itemNames: ['minecraft:planks', 'minecraft:stone_pickaxe', 'minecraft:stick'],
        inventory: { 36: { name: 'minecraft:planks', count: 1 }, 45: { name: 'minecraft:stone_pickaxe', count: 1 } },
        digBlocks: [5, 6, 7, 8, 9, 10].map(x => ({ ...at(x), name: 'minecraft:stone' })),
        captureFile: tmpFile('dig-e2e.jsonl'),
    });
    const { bot, ids } = world;
    const c = world.containers();
    const dig = world.dig();
    const lines = [];
    const realLog = console.log;
    console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[forge-bridge] dig refused:')) lines.push(a[0]); realLog(...a); };
    after(() => { console.log = realLog; });
    const { followServerCursor } = await import('../../../src/agent/library/inventory_sync.js');
    followServerCursor(bot);
    const block = (x) => bot.blockAt(new Vec3(x, 64, 6));
    const until = async (ok, ms = 3000) => { for (let w = 0; !ok() && w < ms; w += 20) await sleep(20); return ok(); };
    bot.setQuickBarSlot(0);
    assert.ok(await until(() => bot.entity.onGround, 5000), 'on the floor (off the ground every dig time is x5)');
    assert.equal(block(8).name, 'stone');

    // The soak 15 trap: planks in hand, the stone pickaxe in the off hand (slot 45).
    await assert.rejects(within(5000, bot.dig(block(8), true), 'dig'), /dig time for stone is Infinity/);
    assert.deepEqual(dig.state.digs, [], 'refused before any packet');
    await until(() => lines.length === 1);
    assert.match(lines[0], /^\[forge-bridge\] dig refused: stone:0 at 8, 64, 6 \(pickaxe level 0, hardness 1\.5\); held planks \(no pickaxe level\); pickaxe tools: stone_pickaxe \(level 0\) off hand; rule: held Infinity, stone_pickaxe 600 ms$/);

    // The 22:41:56 case: the pickaxe on the cursor (a rejected equip's resync left it there).
    c.setInventory({ 36: { id: ids['minecraft:planks'], count: 1 } }, { id: ids['minecraft:stone_pickaxe'], count: 1 });
    await until(() => bot.inventory.selectedItem?.name === 'stone_pickaxe');
    await assert.rejects(within(5000, bot.dig(block(9), true), 'dig'), /is Infinity/);
    await until(() => lines.length === 2);
    assert.match(lines[1], /^\[forge-bridge\] dig refused: stone:0 at 9, 64, 6 .*; pickaxe tools: stone_pickaxe \(level 0\) cursor; /);

    // A normal dig: the pickaxe held on both sides. The server breaks it at the STOP.
    c.setInventory({ 36: { id: ids['minecraft:stone_pickaxe'], count: 1 } });
    await until(() => bot.heldItem?.name === 'stone_pickaxe' && !bot.inventory.selectedItem);
    await within(5000, bot.dig(block(10), true), 'dig');
    await until(() => dig.blockAt(at(10)).id === 0);
    assert.equal(dig.state.digs.at(-1).outcome, 'broken');
    assert.equal(block(10).name, 'air');

    // An ABORT also sends the block back (processPlayerDigging, offset 446; #629 review 2).
    const changes = [];
    bot._client.on('block_change', (pk) => changes.push(pk));
    const aborted = bot.dig(block(8), true).catch((e) => e.message);
    await until(() => dig.state.digs.at(-1)?.status === 0 && dig.state.digs.at(-1).pos.x === 8);
    bot.stopDigging();
    assert.equal(await aborted, 'Digging aborted');
    assert.ok(await until(() => dig.state.digs.at(-1).status === 1));
    assert.equal(dig.state.digs.at(-1).outcome, 'aborted, sent back');
    assert.ok(await until(() => changes.some((pk) => pk.location.x === 8 && pk.type !== 0)), 'the stone sent back');
    assert.equal(block(8).name, 'stone');

    // The client holds the pickaxe, the server's held slot has planks (a view that parted silently). The
    // client predicts air and bot.dig resolves; the server's rule says never, sends the block back and
    // holds its one delayed-destroy slot for it (#629 review 1).
    c.state.inv[36] = { id: ids['minecraft:planks'], count: 1, meta: 0 }; // the server only
    await within(5000, bot.dig(block(7), true), 'dig');
    assert.ok(await until(() => dig.state.digs.at(-1).status === 2), 'the STOP reached the server'); // bot.dig resolves on its own predicted air
    assert.equal(dig.state.digs.at(-1).outcome, 'sent back, delayed destroy held');
    assert.ok(await until(() => block(7).name === 'stone'), 'the client sees the stone again');
    // A later early STOP on another block arms nothing while the slot is held.
    await within(5000, bot.dig(block(5), true), 'dig');
    assert.ok(await until(() => dig.state.digs.at(-1).status === 2 && dig.state.digs.at(-1).pos.x === 5));
    assert.equal(dig.state.digs.at(-1).outcome, 'sent back (a delayed destroy is already held: ignored)');
    assert.ok(await until(() => block(5).name === 'stone'));
    await sleep(500);
    assert.deepEqual([dig.blockAt(at(7)).name, dig.blockAt(at(5)).name], ['minecraft:stone', 'minecraft:stone'], 'neither breaks with planks');
    assert.deepEqual(dig.state.delayed?.pos, at(7), 'the slot is still held for the first block');
    // The server's held item becomes the pickaxe: the next tick breaks the held block; the other stays.
    c.setInventory({ 36: { id: ids['minecraft:stone_pickaxe'], count: 1 } });
    assert.ok(await until(() => block(7).name === 'air', 3000), 'broken by the delayed destroy once a valid tool is held');
    assert.equal(dig.state.digs.at(-1).outcome, 'broken by the delayed destroy');
    assert.equal(dig.state.delayed, null, 'released');
    assert.equal(dig.blockAt(at(5)).name, 'minecraft:stone', 'its STOP was ignored: it stays');

    // An early STOP: Mining Fatigue I on the server only (x 0.3: 2000 ms) against the client's 600 ms.
    await until(() => bot.heldItem?.name === 'stone_pickaxe');
    dig.state.effects = { 4: { amplifier: 0 } };
    const started = Date.now();
    await within(5000, bot.dig(block(6), true), 'dig');
    await until(() => dig.state.digs.at(-1).status === 2 && dig.state.digs.at(-1).pos.x === 6);
    const stop = dig.state.digs.at(-1);
    assert.equal(stop.outcome, 'sent back, delayed destroy held');
    assert.ok(stop.f < 0.7, `f ${stop.f}`);
    // #629 review 6: wide windows, so a loaded runner does not flake.
    assert.ok(await until(() => block(6).name === 'stone', 3000), 'sent back first');
    assert.ok(await until(() => block(6).name === 'air', 8000), 'then broken by the delayed destroy');
    assert.ok(Date.now() - started >= 1800, `${Date.now() - started} ms: at progress 1.0, about 2000 ms after the START`);
    assert.equal(dig.state.digs.at(-1).outcome, 'broken by the delayed destroy');
    dig.state.effects = {};

    // Soak 14: a death's respawn sends no effects (the client drops its own, #610); a dimension change
    // resends the live ones after the respawn packet, and the client keeps those.
    const client = world.server.state.client;
    client.write('entity_effect', effectPacket(1, { id: 4, amplifier: 3, duration: 19 }));
    assert.ok(await until(() => bot.entity.effects[4]?.amplifier === 3));
    assert.ok(bot.digTime(block(5)) > 600000, 'Mining Fatigue IV (x 0.00081): about 11.5 min for stone with the pickaxe');
    respawnAfterDeath(client);
    assert.ok(await until(() => !bot.entity.effects[4]));
    assert.equal(bot.digTime(block(5)), 600, 'back to 600 ms');
    changeDimension(client, -1, [{ id: 4, amplifier: 0 }]);
    assert.ok(await until(() => bot.entity.effects[4]?.amplifier === 0), 'the resent effect is kept');
});
