// Probe P1 end to end, offline (#165 review, required by the lead): the REAL scenario
// (test/scenarios/probe/probe-craft-place.mjs) through the runner, against net-forge's REAL driver: a
// g1-driver.mjs process with ROTN_DRIVER_PROBE=1 (packages/forge-bridge/tools/probe-commands.mjs), logged
// in to net-forge's fake Forge 1.12.2 server with its craft world (real Run A ids, RotN's FastWorkbench
// table, the fake 1.12.2 containers) and rotn-data's real dump recipes. Nothing here is a stub of the
// driver: a reply-contract change in #162 fails this test.
//
// The only fake is the server console: a small adapter that answers P1's console commands from the fake
// server's state (give, count-only clear, setblock, testforblock, effect, tp, tell). The craft world is
// chunk 0,0 with the table at 10,65,8, so the adapter moves P1's world coordinates by a fixed offset that
// puts P1's table exactly on it (landing -45,66,-66 -> 8,65,8). Loopback only; no LLM, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runScenario } from '../runner/lib/runner.mjs';
import { driverProcess, wallClock } from '../runner/lib/adapters.mjs';
import { startFakeForgeServer } from '../../packages/forge-bridge/test/fake-forge-server.js';
import { stack } from '../../packages/forge-bridge/test/fake-containers.js';
import { pinnedModList, PING_FIXTURE } from '../../packages/forge-bridge/test/helpers.js';
import { I, B, TABLE, registries, joinCraftWorld } from '../../packages/forge-bridge/test/craft-world.js';
import probe from '../scenarios/probe/probe-craft-place.mjs';
import { P1_PLAN, P1_NOT_GATE } from '../runner/lib/probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, '..', '..', 'packages', 'forge-bridge', 'tools', 'g1-driver.mjs');
const NAME = 'FRCFLD';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const L = (msg, logger = DS) => `[12:00:00] [Server thread/INFO] [${logger}]: ${msg}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-e2e-'));

// P1's world coordinates -> the craft world's: P1's table (-43,66,-66) lands on TABLE (10,65,8).
const D = [TABLE.x - P1_PLAN.table[0], TABLE.y - P1_PLAN.table[1], TABLE.z - P1_PLAN.table[2]];
const toFake = (x, y, z) => [Number(x) + D[0], Number(y) + D[1], Number(z) + D[2]];
const ITEMS = {
    'pyrotech:rock': I.rock, 'minecraft:stick': I.stick, 'minecraft:planks': I.planks, 'minecraft:bread': I.bread,
    'minecraft:cobblestone': I.cobble, 'pyrotech:crude_axe': I.crudeAxe, 'contenttweaker:crafting_tools': I.craftingTools,
    'minecraft:crafting_table': I.table, 'minecraft:stone_pickaxe': I.stonePickaxe,
};
const BLOCKS = { 'minecraft:air': 0, 'minecraft:stone': B.stone, 'minecraft:crafting_table': B.table, 'minecraft:cobblestone': B.cobble };
const blockName = (id) => Object.keys(BLOCKS).find((k) => BLOCKS[k] === id) ?? `#${id}`;

/**
 * The fake Forge server with the craft world, and a console adapter over it for P1's commands.
 * opt.kickAt: 'place' kicks the bot when the first probe-place whisper would be sent.
 */
async function world(opt = {}) {
    const log = [];
    const add = (msg, logger = DS) => log.push(L(msg, logger));
    let client = null;
    let containers = null;
    const blocks = new Map();   // setblock, by craft-world position
    const key = (x, y, z) => `${x},${y},${z}`;
    let pos = null;
    let kicked = false;
    let teleportId = 10;
    const server = await startFakeForgeServer({
        modList: pinnedModList(), registries: registries(), reid: true,
        onJoin: (c) => {
            client = c;
            containers = joinCraftWorld(c);
            add(`UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`, 'net.minecraft.server.network.NetHandlerLoginServer');
            add(`${NAME} joined the game`);
            c.on('end', () => { if (!kicked) add(`${NAME} lost connection: Disconnected`); });
        },
    });
    const blockAt = (x, y, z) => {
        const placed = containers?.state.placed.filter((p) => p.target.x === x && p.target.y === y && p.target.z === z).at(-1);
        // P1 sets blocks up first and places afterwards, so a placement wins over a setblock.
        if (placed) return blockName(placed.blockId);
        const set = blocks.get(key(x, y, z));
        if (set !== undefined) return set;
        if (x === TABLE.x && y === TABLE.y && z === TABLE.z) return 'minecraft:crafting_table';
        return y === 64 ? 'minecraft:stone' : 'minecraft:air';
    };
    let seq = 0;
    const consoleAdapter = {
        console(cmd) {
            const before = log.length;
            const inv = containers?.state.inv;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if (cmd === 'gamerule doDaylightCycle false') add('Game rule doDaylightCycle has been updated to false');
            else if (cmd === 'time set day') add('Set the time to 1000');
            else if ((m = /^tp \S+ (-?\d+) (-?\d+) (-?\d+)$/.exec(cmd))) {
                const [x, y, z] = toFake(m[1], m[2], m[3]);
                pos = [Number(m[1]) + 0.5, Number(m[2]), Number(m[3]) + 0.5];
                client.write('position', { x: x + 0.5, y, z: z + 0.5, yaw: 0, pitch: 0, flags: 0, teleportId: teleportId++ });
                add(`Teleported ${NAME} to ${pos[0]}, ${pos[1]}.0, ${pos[2]}`);
            } else if (/^tp \S+ ~ ~ ~$/.test(cmd)) add(`Teleported ${NAME} to ${pos[0]}, ${pos[1]}.0, ${pos[2]}`);
            else if (cmd === `clear ${NAME}`) {
                for (let i = 0; i < inv.length; i++) inv[i] = null;
                containers.state.cursor = null;
                containers.sendInventory();
                add(`Cleared the inventory of ${NAME}`);
            } else if ((m = /^give \S+ (\S+) (\d+) (\d+)$/.exec(cmd))) {
                const slot = [...Array(9).keys()].map((i) => 36 + i).concat([...Array(27).keys()].map((i) => 9 + i)).find((i) => !inv[i]);
                inv[slot] = stack(ITEMS[m[1]], Number(m[2]), Number(m[3]));
                containers.sendInventory();
                add(`Given [${m[1]}] * ${m[2]} to ${NAME}`);
            } else if ((m = /^clear \S+ (\S+) -?\d+ 0$/.exec(cmd))) {
                const n = containers.count(ITEMS[m[1]]);
                add(n ? `${NAME} has ${n} items that match the criteria` : `Could not clear the inventory of ${NAME}, no items to remove`);
            } else if (/^effect \S+ minecraft:hunger \d+ \d+$/.test(cmd)) {
                containers.setFood(14);
                add(`Given Hunger (ID 17) * 10 to ${NAME} for 10 seconds`);
            } else if ((m = /^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
                const [x, y, z] = toFake(m[1], m[2], m[3]);
                blocks.set(key(x, y, z), m[4]);
                client.write('block_change', { location: { x, y, z }, type: BLOCKS[m[4]] << 4 });
                add('Block placed');
            } else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
                const b = blockAt(...toFake(m[1], m[2], m[3]));
                add(b === m[4] ? `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}` : `The block at ${m[1]}, ${m[2]}, ${m[3]} is ${b} (expected: ${m[4]})`);
            } else if ((m = /^tell \S+ (.*)$/.exec(cmd))) {
                if (opt.kickAt && m[1].startsWith(`probe-${opt.kickAt} `)) {
                    kicked = true;
                    add(`${NAME} lost connection: Kicked by an operator`);
                    client.end('Kicked by an operator');
                    return log.slice(before);
                }
                // The bot lives in the craft world: move the command's positions there too.
                const text = m[1].replace(/(-?\d+),(-?\d+),(-?\d+)/g, (_, x, y, z) => toFake(x, y, z).join(','));
                // What a 1.12 server sends for a console `tell`: a whisper from Server (net-forge's probe-e2e).
                client.write('chat', { message: JSON.stringify({ translate: 'commands.message.display.incoming', with: ['Server', { text }], color: 'gray', italic: true }), position: 0 });
                seq++;
            }
            return log.slice(before);
        },
        log: (n) => log.slice(-n),
    };
    return { server, consoleAdapter, containers: () => containers, sent: () => seq };
}

const DRIVER_ENV = {
    ROTN_DRIVER_AUTH: 'offline', ROTN_DRIVER_PING_TIMEOUT_MS: '60000', ROTN_DRIVER_CHUNK_WAIT_MS: '0', ROTN_DRIVER_MODLIST_FILE: PING_FIXTURE,
};
const saved = {};
function setEnv(vars) {
    for (const [k, v] of Object.entries(vars)) {
        if (!(k in saved)) saved[k] = process.env[k];
        process.env[k] = v;
    }
}
after(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

/** One P1 run: the real driver process against the fake world, through the runner. */
async function runP1(name, opt = {}) {
    const w = await world(opt);
    const capture = path.join(TMP, `${name}-capture.jsonl`);
    // The runner hands the driver TEST_SERVER_HOST/PORT and ROTN_DRIVER_* from its own environment;
    // the scenario adds ROTN_DRIVER_PROBE=1 when it starts the bot.
    setEnv({ ...DRIVER_ENV, TEST_SERVER_HOST: '127.0.0.1', TEST_SERVER_PORT: String(w.server.port), ROTN_DRIVER_CAPTURE: capture });
    const bot = driverProcess([process.execPath, DRIVER], path.join(TMP, `${name}-driver.log`));
    try {
        const r = await runScenario(probe, {
            server: w.consoleAdapter, bot, clock: wallClock, runId: `e2e-${name}`,
            params: { settleMs: 1000, tpSettleMs: 1500, consoleWaitS: 0, pollMs: 100, loginTimeoutMs: 120000 },
        });
        return { r, w, capture, output: bot.output() };
    } finally {
        await bot.stop(5000);
        await w.server.close();
    }
}
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

test('P1 against the real g1-driver and probe-commands.mjs: every check passes, never a gate pass', { timeout: 300000 }, async () => {
    const { r, w, capture, output } = await runP1('full');
    const c = byName(r);
    const why = `${r.error ?? ''}\n${output.filter((l) => /probe|fatal|error/i.test(l)).slice(-15).join('\n')}`;
    for (const k of Object.keys(probe.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}${why}`);
    assert.equal(r.verdict, 'SMOKE-PASS (not a gate pass)');
    assert.equal(r.gateValid, false);
    assert.ok(r.weakenedParams.includes(P1_NOT_GATE));
    // #162's reply contract, as the scenario reads it.
    assert.deepEqual(r.notes.crafts.map((x) => x.ok), [true, true, true, true]);
    assert.equal(r.notes.crafts[3].tableBlock, 'crafting_table');
    assert.equal(r.notes.placeLatencyMs.length, 5);
    assert.ok(r.notes.placeLatencyMs.every((ms) => Number.isFinite(ms) && ms >= 0), JSON.stringify(r.notes.placeLatencyMs));
    assert.ok(r.notes.eat.foodAfter > r.notes.eat.foodBefore && r.notes.eat.breadLeft === 1, JSON.stringify(r.notes.eat));
    // What the evidence step reads from the capture: no rejected click (the fake server's own record
    // agrees) and FastWorkbench's mod window.
    assert.equal(w.containers().state.rejected.length, 0, 'no window click rejected');
    assert.ok(r.notes.capture, 'the capture path is recorded');
    assert.match(fs.readFileSync(capture, 'utf8'), /mod_window[^\n]*fastbench/, 'the capture has the fastbench mod window');
});

test('P1 against the real driver: a kick aborts at once with its reason, nothing after it passes', { timeout: 300000 }, async () => {
    const { r } = await runP1('kick', { kickAt: 'place' });
    const c = byName(r);
    assert.equal(c.craft_stone_pickaxe.pass, true, c.craft_stone_pickaxe.detail);
    assert.equal(c.place_5.pass, false);
    assert.match(r.notes.aborted, /^kicked \(lost\): Kicked by an operator$|^the driver exited/, r.notes.aborted);
    assert.equal(c.eat.detail, 'not reached');
    assert.equal(r.gateValid, false);
});
