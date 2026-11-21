#!/usr/bin/env node
// Probe BC's driver (the lead's Better Combat plan, step 4): Mindcraft's real initBot (src/utils/mcdata.js,
// with forge-bridge and net-forge's Better Combat wrapper, #521), the runner's scenario protocol (hello),
// and the bc-hit command (./bc-attack.mjs). No LLM, no key. Not for gate runs.
//
//   deploy/test-server.sh run --yes -- node test/runner/run.mjs --scenario probe-bc-attack -- \
//     node test/runner/drivers/bc-attack-driver.mjs
//
// Env (allowlisted by the runner; test/runner/DRIVER.md):
//   TEST_SERVER_HOST, TEST_SERVER_PORT   the disposable test server (never anything else)
//   ROTN_SCENARIO_BOT                    the bot account (FRCFLD)
//   ROTN_SCENARIO_HELLO                  said once after spawn
//   MINDCRAFT_PROFILES_FOLDER            the bot's token cache; required with Microsoft auth, never printed.
//                                        A missing or stale cache exits 3; no device-code login here.
//   ROTN_DRIVER_BC_ATTACK                on | off -> FORGE_BC_ATTACK (the scenario sets on; unset = initBot's default, on since #545)
//   ROTN_DRIVER_AUTH                     microsoft (default) | offline (loopback tests only)
//   ROTN_DRIVER_CAPTURE                  1 (default) | a path | 0 -> FORGE_CAPTURE, as g1-driver
//   ROTN_DRIVER_MODLIST_FILE             the ping JSON fallback (default: the pinned RotN 3.3.4 fixture)
// Exit codes (ADR 0003 decision 5): 0 clean stop on SIGTERM/SIGINT, 1 transient, 3 fatal.
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachScenario, event } from './scenario-protocol.mjs';
import { attachBcAttack } from './bc-attack.mjs';
import { classifyKick as runnerClassifyKick, FATAL_KICKS } from '../lib/server-log.mjs';
import { classifyKick } from '../../../packages/forge-bridge/src/kicks.js';
import { createExitTracker } from '../../../packages/forge-bridge/tools/driver-exit.mjs';
import { lastProfileFetchFailure } from '../../../packages/forge-bridge/src/auth-diagnostics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const PINNED_MODLIST = path.join(REPO, 'packages', 'forge-bridge', 'test', 'fixtures', 'rotn-3.3.4', 'ping.json');

const host = process.env.TEST_SERVER_HOST;
const port = Number(process.env.TEST_SERVER_PORT ?? 25565);
const name = process.env.ROTN_SCENARIO_BOT ?? 'FRCFLD';
const auth = process.env.ROTN_DRIVER_AUTH ?? 'microsoft';
const bcRaw = process.env.ROTN_DRIVER_BC_ATTACK;

function fatalSetup(reason) {
    event('fatal', { reason, exitCode: 3, joined: false, beforeJoin: true });
    console.error(`bc-attack-driver: ${reason}`);
    process.exit(3);
}
if (!host) fatalSetup('TEST_SERVER_HOST is not set');
if (!['microsoft', 'offline'].includes(auth)) fatalSetup(`ROTN_DRIVER_AUTH must be microsoft or offline, not ${auth}`);
if (bcRaw !== undefined && !['on', 'off'].includes(bcRaw)) fatalSetup(`ROTN_DRIVER_BC_ATTACK must be on or off, not ${bcRaw}`);
if (auth === 'microsoft' && !process.env.MINDCRAFT_PROFILES_FOLDER) fatalSetup('MINDCRAFT_PROFILES_FOLDER is not set: the bot account needs its own token cache folder');

// prismarine-auth logs HTTP details through `debug`; initBot reads the FORGE_* switches.
delete process.env.DEBUG;
process.env.FORGE_BRIDGE = 'on';
if (bcRaw !== undefined) process.env.FORGE_BC_ATTACK = bcRaw;
const capture = process.env.ROTN_DRIVER_CAPTURE ?? '1';
if (capture === '0') delete process.env.FORGE_CAPTURE; else process.env.FORGE_CAPTURE = capture;
process.env.FORGE_MODLIST_FILE = process.env.ROTN_DRIVER_MODLIST_FILE ?? PINNED_MODLIST;

let closeCapture = () => {};
const exitTracker = createExitTracker({ emit: event, onFinish: () => closeCapture(), profileFailure: () => lastProfileFetchFailure() });
process.on('unhandledRejection', (e) => exitTracker.unhandledRejection(e));
process.on('beforeExit', () => exitTracker.drained());

async function main() {
    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host, port, auth, minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');
    const bot = initBot(name, {
        onMsaCode: () => fatalSetup('Microsoft device-code login needed; the human must redo the login (coord/NEEDS-HUMAN.md)'),
    });
    attachScenario(bot, { emit: event });
    attachBcAttack(bot, { emit: event });
    event('bc_attached', { bcAttackEnv: bcRaw ?? null });

    closeCapture = () => { try { bot.forge?.capture?.close(); } catch { /* already closed */ } };
    bot.on('login', () => {
        exitTracker.joined();
        event('login', { username: bot.username, forgeBridge: !!bot.forge?.bridge });
    });
    bot.once('spawn', () => {
        const bc = bot.forge?.bcAttack;
        event('bc_status', { wrapper: !!bc, attackVanilla: typeof bot.attackVanilla === 'function', active: bc?.active ?? null, status: bc?.status?.() ?? null,
            capture: bot.forge?.capture?.file ? path.relative(process.cwd(), bot.forge.capture.file) : null });
    });
    bot.on('kicked', (reason) => {
        const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
        const runnerClass = runnerClassifyKick(text);
        const ours = classifyKick(text);
        const isFatal = FATAL_KICKS.has(runnerClass) || ours.fatal;
        if (isFatal) exitTracker.fatal(ours.fatal ? ours.category : runnerClass);
        event('kicked', { reason: text.slice(0, 2000), class: runnerClass, forgeCategory: ours.category, fatal: isFatal });
    });
    bot.on('death', () => event('bot_death', { health: bot.health ?? null }));
    bot.on('error', (e) => exitTracker.botError(e));
    bot.on('end', (why) => exitTracker.end(why, { stats: bot.forge?.bridge?.stats ?? null }));

    const stop = () => {
        if (exitTracker.state.stopping) return;
        exitTracker.stopping();
        event('stopping');
        try { bot.quit('scenario finished'); } catch { /* not connected */ }
        setTimeout(() => { try { bot.forge?.capture?.close(); } catch { /* closed */ } process.exit(0); }, 5000).unref();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

main().catch((e) => fatalSetup(`startup failed: ${String(e?.stack ?? e).slice(0, 2000)}`));
