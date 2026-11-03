// Probe P1 end to end, offline: the REAL g1-driver (tools/probe-commands.mjs, forge-bridge, Mindcraft's
// initBot), started through harness-ops' real adapter (test/runner/lib/adapters.mjs driverProcess),
// against probe-test-server.js, driven only through the runner's server interface (console/log) with
// P1's console commands as harness-ops' scenario sends them. Every reply is checked against the
// reply contract (checkProbeReply), and every result against the server's own counts.
// This is the template for harness-ops' end-to-end test of test/scenarios/probe/probe-craft-place.mjs:
// pass `server` and the adapter to runScenario instead of the steps below.

import process from 'node:process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { startProbeTestServer, P1_SEED } from './probe-test-server.js';
import { tmpFile } from './helpers.js';
import { checkProbeReply, PROBE_CONTRACT_VERSION } from '../tools/probe-commands.mjs';
import { driverProcess } from '../../../test/runner/lib/adapters.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, '..', 'tools', 'g1-driver.mjs');
const BOT = 'FRCFLD';

let world;
let bot;
after(async () => {
    await bot?.stop(5000);
    await world?.close();
});

const replies = () => bot.output().filter(l => l.startsWith('DRIVER ')).map(l => { try { return JSON.parse(l.slice(7)); } catch { return null; } })
    .filter(e => e?.type === 'probe');

async function until(pred, ms, what) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
        const v = pred();
        if (v) return v;
        if (!bot.alive()) throw new Error(`${what}: the driver exited (${bot.exitCode()}):\n${bot.output().slice(-30).join('\n')}`);
    }
    throw new Error(`${what}: not within ${ms} ms\n${bot.output().slice(-30).join('\n')}`);
}

const count = (lines) => {
    const has = lines.map(l => new RegExp(`: ${BOT} has (\\d+) items that match the criteria$`).exec(l)).find(Boolean);
    if (has) return Number(has[1]);
    return lines.some(l => l.endsWith(`Could not clear the inventory of ${BOT}, no items to remove`)) ? 0 : null;
};

test('P1 through the runner interface: the real driver crafts, places and eats; every reply meets the contract', { timeout: 300000 }, async () => {
    world = await startProbeTestServer({ name: BOT });
    const con = (cmd) => world.server.console(cmd, 0);
    bot = driverProcess([process.execPath, DRIVER], tmpFile('driver.log'));
    bot.start({
        TEST_SERVER_HOST: world.host, TEST_SERVER_PORT: String(world.port), ROTN_SCENARIO_BOT: BOT,
        ROTN_DRIVER_AUTH: 'offline', ROTN_DRIVER_CAPTURE: tmpFile('capture.jsonl'), ROTN_DRIVER_PING_TIMEOUT_MS: '60000',
        ROTN_DRIVER_CHUNK_WAIT_MS: '0', ROTN_DRIVER_PROBE: '1',
    });
    await until(() => world.server.log(50).some(l => l.endsWith(`${BOT} joined the game`)), 180000, 'join');
    await until(() => bot.output().some(l => l.includes('"type":"probe_ready"')), 60000, 'probe_ready');

    // Setup, as the scenario does it (console allowlist commands only).
    assert.ok(con('seed').some(l => l.endsWith(`Seed: ${P1_SEED}`)));
    con('gamerule doDaylightCycle false');
    con('time set day');
    assert.ok(con(`tp ${BOT} -45 66 -66`).some(l => l.endsWith(`Teleported ${BOT} to -44.5, 66.0, -65.5`)));
    con(`clear ${BOT}`);
    for (const [item, n] of [['pyrotech:rock', 8], ['minecraft:stick', 6], ['minecraft:planks', 1], ['minecraft:bread', 2], ['minecraft:cobblestone', 8]]) {
        assert.ok(con(`give ${BOT} ${item} ${n} 0`).some(l => / Given .+ \* \d+ to FRCFLD$/.test(l)), item);
    }
    // P1's hunger setup (README, "Probe P1", hunger setup). 10 s at amplifier 10 would leave food at 20.
    assert.ok(con(`effect ${BOT} minecraft:hunger 20 24`).some(l => l.endsWith('Given Hunger (ID 17) * 24 to FRCFLD for 20 seconds')));
    con('setblock -43 66 -66 minecraft:crafting_table');
    assert.ok(con('testforblock -43 66 -66 minecraft:crafting_table').some(l => l.endsWith('Successfully found the block at -43, 66, -66')));
    await sleep(1500); // the inventory and the table reach the bot

    let n = 0;
    const ask = async (cmd, text) => {
        const token = `beef${String(++n).padStart(4, '0')}`;
        con(`tell ${BOT} probe-${cmd} ${token} ${text}`);
        const r = await until(() => replies().find(e => e.token === token), 70000, `${cmd} ${text}`);
        assert.deepEqual(checkProbeReply(r), [], `${cmd} reply meets the contract: ${JSON.stringify(r)}`);
        assert.equal(r.v, PROBE_CONTRACT_VERSION);
        return r;
    };
    const items = (item) => count(con(`clear ${BOT} ${item} -1 0`));

    // The four crafts, each confirmed by the server's count.
    const crafts = [
        ['crafttweaker:pyro_crude_axe', '', 'pyrotech:crude_axe', { 'pyrotech:crude_axe': 1, 'pyrotech:rock': 7 }],
        ['crafttweaker:crafting_tools', '', 'contenttweaker:crafting_tools', { 'contenttweaker:crafting_tools': 1, 'pyrotech:crude_axe': 0 }],
        ['crafttweaker:crafting_table', '', 'minecraft:crafting_table', { 'minecraft:crafting_table': 1, 'minecraft:planks': 0 }],
        ['crafttweaker:stone_pickaxe', ' -43,66,-66', 'minecraft:stone_pickaxe', { 'minecraft:stone_pickaxe': 1, 'pyrotech:rock': 3 }],
    ];
    for (const [recipe, table, result, counts] of crafts) {
        const r = await ask('craft', `${recipe}${table}`);
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual([r.recipe, r.result, r.before, r.after], [recipe, result, 0, 1], 'full registry names');
        assert.equal(r.tableBlock, table ? 'minecraft:crafting_table' : null);
        for (const [item, want] of Object.entries(counts)) assert.equal(items(item), want, `${recipe}: ${item}`);
    }

    // Five placements, each confirmed with testforblock (the block lands at y 66).
    const targets = [[-47, 66, -66], [-45, 66, -68], [-45, 66, -64], [-47, 66, -68], [-47, 66, -64]];
    for (const [x, y, z] of targets) {
        con(`setblock ${x} ${y} ${z} minecraft:air`);
        con(`setblock ${x} ${y - 1} ${z} minecraft:stone`);
    }
    await sleep(500);
    for (const [x, y, z] of targets) {
        const r = await ask('place', `minecraft:cobblestone ${x},${y - 1},${z} up`);
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual([r.before, r.after, r.expected, r.target], ['minecraft:air', 'minecraft:cobblestone', 'minecraft:cobblestone', [x, y, z]]);
        assert.ok(Number.isInteger(r.updateMs));
        assert.ok(con(`testforblock ${x} ${y} ${z} minecraft:cobblestone`).some(l => l.endsWith(`Successfully found the block at ${x}, ${y}, ${z}`)));
    }

    // Eat one bread (the hunger effect put food under 20).
    const eat = await ask('eat', 'minecraft:bread');
    assert.equal(eat.ok, true, JSON.stringify(eat));
    assert.deepEqual([eat.foodBefore, eat.foodAfter], [14, 17], 'food 14 after the setup; RotN bread is +3');
    assert.deepEqual([eat.countBefore, eat.countAfter, items('minecraft:bread')], [2, 1, 1]);

    // A failure meets the contract too.
    const bad = await ask('craft', 'crafttweaker:stone_pickaxe -43,66,-66');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /missing ingredients/);

    con(`clear ${BOT}`);
    assert.equal(items('minecraft:stone_pickaxe'), 0);
    assert.ok(!world.server.log(500).some(l => / lost connection: /.test(l)), 'no kick or disconnect');
});
