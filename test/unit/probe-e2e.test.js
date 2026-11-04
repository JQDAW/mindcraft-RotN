// Probe P1 end to end, offline (#165 review, required by the lead): the REAL scenario
// (test/scenarios/probe/probe-craft-place.mjs) through the runner, against net-forge's REAL driver (a
// g1-driver.mjs process with ROTN_DRIVER_PROBE=1, packages/forge-bridge/tools/probe-commands.mjs) and
// net-forge's fake RotN test server (packages/forge-bridge/test/probe-test-server.js, #167: forge-bridge's
// fake Forge server with REID, the real Run A ids, the fastbench override and the fake 1.12.2 containers,
// answering P1's console commands). Nothing here is a stub of the driver or of the server's P1 commands:
// a change to the reply contract or to the fake server fails this test. Every reply is also checked with
// net-forge's checkProbeReply, by the scenario itself.
//
// Two additions, in a thin wrapper: (1) the scoreboard (probe-test-server.js does not know it yet): P1's
// three `scoreboard` commands are answered in 1.12's form from the fake server's own food level, as 1.12
// does: no score until the food changes after the objective exists; (2) the login UUID in the log gets
// version digit 4, because the fake server runs offline. Loopback only; no LLM, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runScenario } from '../runner/lib/runner.mjs';
import { driverProcess, wallClock } from '../runner/lib/adapters.mjs';
import { startProbeTestServer } from '../../packages/forge-bridge/test/probe-test-server.js';
import { PING_FIXTURE } from '../../packages/forge-bridge/test/helpers.js';
import { checkProbeReply } from '../../packages/forge-bridge/tools/probe-commands.mjs';
import probe from '../scenarios/probe/probe-craft-place.mjs';
import { P1_NOT_GATE, P1_PLAN } from '../runner/lib/probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, '..', '..', 'packages', 'forge-bridge', 'tools', 'g1-driver.mjs');
const NAME = 'FRCFLD';
const OBJ = P1_PLAN.foodObjective;
const L = (msg) => `[12:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-e2e-'));

/**
 * probe-test-server.js plus P1's scoreboard commands, answered from the fake server's food level.
 * opt.noHunger: the hunger effect is answered but changes nothing (food stays 20).
 * opt.dropAt: 'place' closes the fake server when the first probe-place whisper would be sent.
 */
async function world(opt = {}) {
    const w = await startProbeTestServer({ name: NAME });
    let objective = false;
    let foodAtAdd = null;
    const food = () => w.containers()?.state.food ?? null;
    const server = {
        console(cmd, waitS) {
            if (cmd === `scoreboard objectives add ${OBJ} food`) {
                if (objective) return [L(`An objective with the name '${OBJ}' already exists`)];
                objective = true;
                foodAtAdd = food();
                return [L(`Added new objective '${OBJ}' successfully`)];
            }
            if (cmd === `scoreboard players list ${NAME}`) {
                // 1.12 writes a food score only when the food level changes after the objective exists.
                return objective && food() !== foodAtAdd
                    ? [L(`Showing 1 tracked objective(s) for ${NAME}:`), L(`- ${OBJ}: ${food()} (${OBJ})`)]
                    : [L(`Player ${NAME} has no scores recorded`)];
            }
            if (cmd === `scoreboard objectives remove ${OBJ}`) {
                objective = false;
                return [L(`Removed objective '${OBJ}' successfully`)];
            }
            if (opt.noHunger && /^effect \S+ minecraft:hunger /.test(cmd)) return [L(`Given Hunger (ID 17) * 19 to ${NAME} for 22 seconds`)];
            if (opt.dropAt && cmd.startsWith(`tell ${NAME} probe-${opt.dropAt} `)) {
                w.close();
                return [];
            }
            return w.server.console(cmd, waitS);
        },
        // The fake server runs offline, so it logs the offline (version 3) UUID; an online-mode server logs
        // the account's Mojang (version 4) UUID, which login_online requires. Only the version digit changes.
        log: (n) => w.server.log(n).map((l) => l.replace(new RegExp(`(UUID of player ${NAME} is [0-9a-f]{8}-[0-9a-f]{4}-)3`), '$14')),
    };
    return { w, server };
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

/** One P1 run: the real driver process against the fake test server, through the runner. */
async function runP1(name, opt = {}, params = {}) {
    const { w, server } = await world(opt);
    const capture = path.join(TMP, `${name}-capture.jsonl`);
    // The runner hands the driver TEST_SERVER_HOST/PORT and ROTN_DRIVER_* from its own environment;
    // the scenario adds ROTN_DRIVER_PROBE=1 when it starts the bot.
    setEnv({ ...DRIVER_ENV, TEST_SERVER_HOST: w.host, TEST_SERVER_PORT: String(w.port), ROTN_DRIVER_CAPTURE: capture });
    const bot = driverProcess([process.execPath, DRIVER], path.join(TMP, `${name}-driver.log`));
    try {
        const r = await runScenario(probe, {
            server, bot, clock: wallClock, runId: `e2e-${name}`,
            params: { settleMs: 1000, tpSettleMs: 1500, consoleWaitS: 0, pollMs: 100, loginTimeoutMs: 120000, foodPollMs: 500, ...params },
        });
        return { r, w, capture, output: bot.output() };
    } finally {
        await bot.stop(5000);
        await w.close().catch(() => {});
    }
}
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));
const probeReplies = (output) => output.filter((l) => l.startsWith('DRIVER ')).map((l) => {
    try { return JSON.parse(l.slice(7)); } catch { return null; }
}).filter((e) => e?.type === 'probe');

test('P1 against the real g1-driver and probe-test-server.js: every check passes, every reply meets contract v1, never a gate pass', { timeout: 300000 }, async () => {
    const { r, w, capture, output } = await runP1('full');
    const c = byName(r);
    const why = `${r.error ?? ''}\n${output.filter((l) => /probe|fatal|error/i.test(l)).slice(-15).join('\n')}`;
    for (const k of Object.keys(probe.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}${why}`);
    assert.equal(r.verdict, 'SMOKE-PASS (not a gate pass)');
    assert.equal(r.gateValid, false);
    assert.ok(r.weakenedParams.includes(P1_NOT_GATE));
    // Contract v1 (#167): the scenario found no problem, and every reply the driver printed passes.
    assert.equal(r.notes.contractProblems, undefined, JSON.stringify(r.notes.contractProblems));
    const replies = probeReplies(output);
    assert.equal(replies.length, 4 + 5 + 1, 'four crafts, five placements, one eat');
    for (const x of replies) assert.deepEqual(checkProbeReply(x), [], JSON.stringify(x));
    assert.deepEqual(r.notes.crafts.map((x) => x.ok), [true, true, true, true]);
    assert.equal(r.notes.crafts[3].tableBlock, 'minecraft:crafting_table', 'contract v1: full registry names');
    assert.equal(r.notes.placeLatencyMs.length, 5);
    assert.ok(r.notes.placeLatencyMs.every((ms) => Number.isFinite(ms) && ms >= 0), JSON.stringify(r.notes.placeLatencyMs));
    // The food was below 20 before the eat step, by the server's score and by the driver's own bot.food.
    assert.ok(r.notes.foodBeforeEat.server < 20, JSON.stringify(r.notes.foodBeforeEat));
    assert.ok(r.notes.eat.foodBefore < 20, JSON.stringify(r.notes.eat));
    assert.ok(r.notes.eat.foodAfter > r.notes.eat.foodBefore && r.notes.eat.breadLeft === 1, JSON.stringify(r.notes.eat));
    assert.ok(r.notes.eat.serverFoodAfter > r.notes.eat.serverFoodBefore, `the server's p1food rose too (#165 review): ${JSON.stringify(r.notes.eat)}`);
    // What the evidence step reads from the capture: no rejected click (the fake server's own record
    // agrees) and FastWorkbench's mod window.
    assert.equal(w.containers().state.rejected.length, 0, 'no window click rejected');
    assert.ok(r.notes.capture, 'the capture path is recorded');
    assert.match(fs.readFileSync(capture, 'utf8'), /mod_window[^\n]*fastbench/, 'the capture has the fastbench mod window');
});

test('P1 against the real driver: food still at 20 before the eat step: the eat is not sent (no 60 s hang), the check fails', { timeout: 300000 }, async () => {
    const { r, output } = await runP1('no-hunger', { noHunger: true }, { foodWaitMs: 3000 });
    const c = byName(r);
    assert.equal(c.place_5.pass, true, c.place_5.detail);
    assert.equal(c.eat.pass, false);
    assert.match(c.eat.detail, /^not sent: the food is not below 20 after \d+s of hunger \(no food score: the food never changed from 20\); bread cannot be eaten at 20$/);
    assert.equal(r.notes.foodBeforeEat.server, null);
    assert.ok(!output.some((l) => l.includes('probe-eat')) && !probeReplies(output).some((x) => x.cmd === 'eat'), 'no eat command reached the driver');
    assert.equal(r.gateValid, false);
});

test('P1 against the real driver: a lost connection aborts at once with its reason, nothing after it passes', { timeout: 300000 }, async () => {
    const { r } = await runP1('drop', { dropAt: 'place' });
    const c = byName(r);
    assert.equal(c.craft_stone_pickaxe.pass, true, c.craft_stone_pickaxe.detail);
    assert.equal(c.place_5.pass, false);
    assert.match(r.notes.aborted, /^kicked \(lost\): Disconnected$|^the driver exited/, r.notes.aborted);
    assert.equal(c.eat.detail, 'not reached');
    assert.equal(r.gateValid, false);
});
