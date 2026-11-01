#!/usr/bin/env node
// forge-bridge scenario driver for harness-ops' runner (test/runner/DRIVER.md).
// It is the bot under test in the G1 and G2 gate scenarios: Mindcraft's real initBot
// (src/utils/mcdata.js) with forge-bridge attached, plus the runner's scenario protocol.
// G1 (g1-login-chat-walk): hello, echo, walk, stay until SIGTERM.
// G2 (g2-blocks-named, g2-mobs-named, g2-items-roundtrip): scenario-blocks, -blockat,
// -entities and -items, answered through the agent's own naming path (attachG2 with
// loadAgentNames). harness-ops' reference driver uses stock mineflayer, which a Forge
// server rejects at the handshake, so this driver is the one for real G2 runs.
//
//   deploy/test-server.sh run --yes --ttl-hours 2 -- \
//     node test/runner/run.mjs --scenario g1-login-chat-walk -- \
//       node packages/forge-bridge/tools/g1-driver.mjs
//
// The runner decides pass or fail from the server's log, never from this driver.
//
// Env (allowlisted by the runner; see DRIVER.md):
//   TEST_SERVER_HOST, TEST_SERVER_PORT   the disposable test server (never anything else)
//   ROTN_SCENARIO_BOT                    bot account name (FRCFLD)
//   ROTN_SCENARIO_HELLO                  said once after spawn (attachScenario)
//   MINDCRAFT_PROFILES_FOLDER            the bot's token cache; required with Microsoft auth,
//                                        never printed. A missing or stale cache exits 3; this
//                                        driver never starts a device-code login.
//   ROTN_DRIVER_AUTH                     microsoft (default) | offline (loopback tests only)
//   ROTN_DRIVER_FORGE_BRIDGE             on (default) | auto | off  -> FORGE_BRIDGE
//   ROTN_DRIVER_CAPTURE                  1 (default: captures/raw/<bot>-<time>.jsonl) | a path | 0
//   ROTN_DRIVER_MODLIST_FILE             ping JSON fallback (default: the pinned RotN 3.3.4 fixture)
//   ROTN_DRIVER_PING_TIMEOUT_MS          total status-ping budget -> FORGE_PING_TIMEOUT_MS
//
// Exit codes (ADR 0003 decision 5, DRIVER.md): 0 clean stop on SIGTERM/SIGINT,
// 1 transient disconnect, 3 fatal (setup error, or a kick that the runner's
// FATAL_KICKS or forge-bridge's classifyKick calls fatal).

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachScenario, attachG2, loadAgentNames, stockNames, event } from '../../../test/runner/drivers/scenario-protocol.mjs';
import { classifyKick as runnerClassifyKick, FATAL_KICKS } from '../../../test/runner/lib/server-log.mjs';
import { classifyKick } from '../src/kicks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINNED_MODLIST = path.join(HERE, '..', 'test', 'fixtures', 'rotn-3.3.4', 'ping.json');
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

const host = process.env.TEST_SERVER_HOST;
const port = Number(process.env.TEST_SERVER_PORT ?? 25565);
const name = process.env.ROTN_SCENARIO_BOT ?? 'FRCFLD';
const auth = process.env.ROTN_DRIVER_AUTH ?? 'microsoft';

function fatalSetup(reason) {
    event('fatal', { reason });
    console.error(`g1-driver: ${reason}`);
    process.exit(3);
}

if (!host) fatalSetup('TEST_SERVER_HOST is not set');
if (!['microsoft', 'offline'].includes(auth)) fatalSetup(`ROTN_DRIVER_AUTH must be microsoft or offline, not ${auth}`);
if (auth === 'microsoft' && !process.env.MINDCRAFT_PROFILES_FOLDER) {
    fatalSetup('MINDCRAFT_PROFILES_FOLDER is not set: the bot account needs its own token cache folder');
}

// prismarine-auth logs HTTP details through `debug` when DEBUG matches; it loads
// with mineflayer below, so clear it first. initBot reads the FORGE_* switches.
delete process.env.DEBUG;
process.env.FORGE_BRIDGE = process.env.ROTN_DRIVER_FORGE_BRIDGE ?? 'on';
const capture = process.env.ROTN_DRIVER_CAPTURE ?? '1';
if (capture === '0') delete process.env.FORGE_CAPTURE; else process.env.FORGE_CAPTURE = capture;
process.env.FORGE_MODLIST_FILE = process.env.ROTN_DRIVER_MODLIST_FILE ?? PINNED_MODLIST;
if (process.env.ROTN_DRIVER_PING_TIMEOUT_MS) process.env.FORGE_PING_TIMEOUT_MS = process.env.ROTN_DRIVER_PING_TIMEOUT_MS;

process.on('unhandledRejection', (e) => event('error', { message: `unhandled rejection: ${String(e?.message ?? e).slice(0, 2000)}` }));

async function main() {
    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host, port, auth, minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');

    const bot = initBot(name, {
        onMsaCode: () => fatalSetup('Microsoft device-code login needed; the human must redo the login (coord/NEEDS-HUMAN.md)'),
    });
    const bridge = () => bot.forge?.bridge ?? null;

    // bot.registry has modded names (brief item 4); the synced Forge name is added as a cross-check.
    function blockBelow() {
        if (!bot.entity) return null;
        const b = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (!b) return null;
        return {
            pos: [b.position.x, b.position.y, b.position.z], id: b.type, meta: b.metadata,
            name: b.name || null, registryName: bridge()?.registries?.nameOf('minecraft:blocks', b.type) ?? null,
        };
    }

    // The walk itself is the scenario's (scenario-protocol.mjs walk()): report the
    // method it gives, or name that function, rather than claiming one here.
    attachScenario(bot, {
        emit: (type, data = {}) => {
            if (type === 'walked') return event(type, { ...data, walkMethod: data.method ?? 'scenario-protocol walk()', blockBelow: blockBelow() });
            if (type === 'spawn') return event(type, { ...data, blockBelow: blockBelow() });
            return event(type, data);
        },
    });
    // G2 (test/runner/DRIVER.md): the bot names what it sees through the agent's own naming
    // path. loadAgentNames imports the same src/utils/mcdata.js module initBot came from, so
    // names come from bot.registry as forge-bridge extends it, and translation from its
    // toNew/toOld. Stock names (no translation) only if mcdata.js cannot be imported; the
    // runner then fails the G2 items checks.
    loadAgentNames(REPO_ROOT).then((m) => {
        event('g2_adapter', { source: m?.source ?? 'stockNames (src/utils/mcdata.js could not be imported)', translation: m?.translation ?? false });
        attachG2(bot, { names: m?.names ?? stockNames });
    }, (err) => event('g2_adapter_error', { message: String(err?.message ?? err) }));


    let stopping = false;
    let fatal = null;
    bot.on('login', () => {
        const b = bridge();
        event('login', { username: bot.username, forgeBridge: !!b, modListSource: b?.modListSource ?? null, reid: b?.reid ?? null });
    });
    bot.once('spawn', () => {
        const b = bridge();
        event('forge', {
            handshakeDone: b?.handshakeDone ?? false, handshakeState: b?.handshake?.stateName ?? null,
            registrySizes: b?.registries?.sizes() ?? null, blockNamespaces: b?.registries?.namespaces('minecraft:blocks') ?? null,
            capture: bot.forge?.capture?.file ? path.relative(process.cwd(), bot.forge.capture.file) : null,
        });
    });
    bot.on('kicked', (reason) => {
        const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
        const runnerClass = runnerClassifyKick(text);
        const ours = classifyKick(text);
        const isFatal = FATAL_KICKS.has(runnerClass) || ours.fatal;
        if (isFatal) fatal = ours.fatal ? ours.category : runnerClass;
        event('kicked', { reason: text.slice(0, 2000), class: runnerClass, forgeCategory: ours.category, fatal: isFatal });
    });
    bot.on('error', (e) => event('error', { message: String(e?.message ?? e).slice(0, 2000) }));
    bot.on('end', (why) => {
        const b = bridge();
        const code = stopping ? 0 : fatal ? 3 : 1;
        event('end', {
            reason: String(why ?? ''), exitCode: code,
            stats: b?.stats ?? null, partialReadErrors: bot.partialReadErrors ?? null,
        });
        try { bot.forge?.capture?.close(); } catch { /* already closed */ }
        process.exit(code);
    });

    const stop = () => {
        if (stopping) return;
        stopping = true;
        event('stopping');
        try { bot.quit('scenario finished'); } catch { /* not connected */ }
        setTimeout(() => { try { bot.forge?.capture?.close(); } catch { /* closed */ } process.exit(0); }, 5000).unref();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

main().catch((e) => fatalSetup(`startup failed: ${String(e?.stack ?? e).slice(0, 2000)}`));
