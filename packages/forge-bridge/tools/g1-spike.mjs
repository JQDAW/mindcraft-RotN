#!/usr/bin/env node
// G1 spike runner: Mindcraft's real initBot against a disposable RotN 3.3.4
// test server (never the live server). Logs in, stays N minutes, chats both
// ways, walks, and writes a capture plus summary.json. Run from the repo root,
// usually inside `deploy/test-server.sh run ... --`, which exports
// TEST_SERVER_HOST/PORT/NAME/CTL.
//
//   node packages/forge-bridge/tools/g1-spike.mjs [--minutes 10] [--mode full|handshake]
//        [--name FRCFLD] [--auth microsoft|offline] [--out DIR]
//
// --mode handshake is Run A (server started with --capture, which makes Forge
// close the connection right after the handshake): it only checks the handshake.
// Microsoft auth needs MINDCRAFT_PROFILES_FOLDER with a cache made by
// tools/msa-login.mjs. Nothing here prints tokens.

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { summarize } from './capture-summary.mjs';
import { readCapture } from '../src/capture.js';

const require = createRequire(import.meta.url);

function arg(name, def) {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : def;
}

const host = arg('host', process.env.TEST_SERVER_HOST);
const port = Number(arg('port', process.env.TEST_SERVER_PORT ?? 25565));
const name = arg('name', 'FRCFLD');
const minutes = Number(arg('minutes', 10));
const mode = arg('mode', 'full');
const auth = arg('auth', 'microsoft');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(arg('out', path.join('captures', 'raw', `g1-${mode}-${stamp}`)));
const ctl = process.env.TEST_SERVER_CTL;

if (!host) { console.error('g1-spike: no --host and no TEST_SERVER_HOST'); process.exit(2); }
if (auth === 'microsoft' && !process.env.MINDCRAFT_PROFILES_FOLDER) {
    console.error('g1-spike: set MINDCRAFT_PROFILES_FOLDER (token cache made by tools/msa-login.mjs)');
    process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const captureFile = path.join(outDir, 'capture.jsonl');
process.env.FORGE_CAPTURE = captureFile;
process.env.FORGE_BRIDGE = process.env.FORGE_BRIDGE ?? 'on';

const t0 = Date.now();
const secs = () => Math.round((Date.now() - t0) / 1000);
const log = (m) => console.log(`[g1 +${secs()}s] ${m}`);
const result = {
    gate: 'G1', mode, host: 'test-server', port, bot: name, minutesPlanned: minutes,
    startedAt: new Date(t0).toISOString(), checks: {}, notes: [],
};

function serverConsole(cmd) {
    if (!ctl) return null;
    const r = spawnSync('bash', [ctl, 'console', cmd], { encoding: 'utf8', timeout: 60000 });
    return (r.stdout ?? '') + (r.stderr ?? '');
}

function serverLog(n = 200) {
    if (!ctl) return '';
    const r = spawnSync('bash', [ctl, 'log', String(n)], { encoding: 'utf8', timeout: 60000 });
    return r.stdout ?? '';
}

async function main() {
    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host, port, auth, minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');

    const bot = initBot(name);
    let ended = null;
    let spawnedAt = null;
    const chatsHeard = [];
    let spawnMs = null;
    // Listen from the start: spawn can follow the handshake within milliseconds.
    const spawned = new Promise((r) => bot.once('spawn', () => { spawnedAt = secs(); spawnMs = Date.now(); r(true); }));
    bot.on('messagestr', (m) => { chatsHeard.push({ t: secs(), m: m.slice(0, 200) }); });
    bot.on('kicked', (reason) => { log(`kicked: ${String(reason).slice(0, 300)}`); });
    bot.on('end', (reason) => { ended = { t: secs(), reason: String(reason ?? '') }; log(`end: ${ended.reason}`); });
    bot.on('error', (e) => log(`error: ${e.message}`));

    function bridge() { return bot.forge?.bridge ?? null; }

    // Modded blocks have no name in bot.registry yet (brief item 4): prismarine
    // reports '' and an empty bounding box. Record the Forge registry name next
    // to it so the evidence says what the bot actually stood and walked on.
    function blockInfo(pos) {
        const b = bot.blockAt(pos);
        if (!b) return null;
        return {
            pos: [b.position.x, b.position.y, b.position.z],
            id: b.type, meta: b.metadata,
            name: b.name || null,
            registryName: bridge()?.registries?.nameOf('minecraft:blocks', b.type) ?? null,
            boundingBox: b.boundingBox,
        };
    }

    async function waitFor(pred, ms, every = 250) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (pred()) return true;
            if (ended) return pred();
            await sleep(every);
        }
        return pred();
    }

    async function finish(code) {
        const b = bridge();
        result.scope = 'G1 spike: login, handshake, chat, walk, stay. It does not exercise reconnects or the ADR 0003 exit codes: it runs one bot directly, without the main process (src/process/agent_process.js) that applies them. The process exit code here is only pass (0) or fail (1).';
        result.endedAt = new Date().toISOString();
        result.elapsedS = secs();
        result.end = ended;
        result.bridge = b ? {
            modListSource: b.modListSource, reid: b.reid, handshakeDone: b.handshakeDone,
            handshakeState: b.handshake?.stateName, overrideDimension: b.overrideDimension,
            registrySizes: b.registries?.sizes() ?? null,
            blockNamespaces: b.registries?.namespaces('minecraft:blocks') ?? null,
            serverChannels: b.serverChannels, stats: b.stats, lastKick: b.lastKick,
            modDiff: b.handshake?.modDiff,
        } : null;
        result.partialReadErrors = bot.partialReadErrors;
        try { bot.quit(); } catch { /* gone */ }
        await sleep(1000);
        try { result.capture = summarize(readCapture(captureFile)); } catch (e) { result.capture = { error: e.message }; }
        if (b?.registries) fs.writeFileSync(path.join(outDir, 'registries.json'), JSON.stringify(b.registries.toJSON()));
        if (ctl) fs.writeFileSync(path.join(outDir, 'server-log-tail.txt'), serverLog(400));
        result.pass = Object.values(result.checks).every(Boolean);
        fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(result, null, 2));
        log(`checks: ${JSON.stringify(result.checks)}`);
        log(`summary: ${path.join(outDir, 'summary.json')}`);
        process.exit(code ?? (result.pass ? 0 : 1));
    }

    // 1. Handshake
    result.checks.handshake = await waitFor(() => bridge()?.handshakeDone, 120000);
    log(`handshake ${result.checks.handshake ? 'done' : 'NOT done'} (state ${bridge()?.handshake?.stateName})`);
    if (mode === 'handshake') {
        // Forge with -Dfml.debugNetworkHandshake closes the connection here.
        await waitFor(() => ended, 30000);
        result.notes.push('Run A: server closes after the handshake by design (fml.debugNetworkHandshake).');
        await finish();
    }

    // 2. Spawn
    result.checks.spawn = await Promise.race([spawned, sleep(120000).then(() => false)]);
    if (!result.checks.spawn) { log('no spawn'); await finish(1); }
    const p0 = bot.entity.position.clone();
    log(`spawned at ${p0.toString()} after ${spawnedAt}s, dimension ${bot.game.dimension}`);
    result.spawn = { atS: spawnedAt, position: p0.toArray().map(v => Math.round(v * 10) / 10), dimension: bot.game.dimension, gameMode: bot.game.gameMode };
    await sleep(3000);
    result.spawn.blockBelow = blockInfo(p0.offset(0, -1, 0));
    result.spawn.blockAtFeet = blockInfo(p0);
    result.spawn.inventory = bot.inventory.items().map(i => `${i.name ?? '?'}#${i.type}x${i.count}`);
    result.spawn.nearbyEntities = Object.values(bot.entities).filter(e => e !== bot.entity).slice(0, 20).map(e => e.name ?? e.type);

    // 3. Chat out and in
    const outMsg = `G1 spike: ${name} online via forge-bridge`;
    bot.chat(outMsg);
    await sleep(2000);
    const sLog = serverLog(100);
    result.checks.chatSent = ctl ? sLog.includes(outMsg) : null;
    const inMsg = `g1-console-ping-${Date.now() % 100000}`;
    if (ctl) {
        serverConsole(`say ${inMsg}`);
        result.checks.chatReceived = await waitFor(() => chatsHeard.some(c => c.m.includes(inMsg)), 15000);
    } else {
        result.notes.push('No TEST_SERVER_CTL: chat checks skipped');
    }
    log(`chat sent=${result.checks.chatSent} received=${result.checks.chatReceived}`);

    // 4. Walk a few blocks, sampling the block under the bot along the way
    let walked = 0;
    const walkBlocks = [];
    const seenBlocks = new Set();
    const sampler = setInterval(() => {
        const info = blockInfo(bot.entity.position.offset(0, -1, 0));
        const key = info && info.pos.join(',');
        if (info && !seenBlocks.has(key) && walkBlocks.length < 50) { seenBlocks.add(key); walkBlocks.push(info); }
    }, 200);
    try {
        const { Movements, goals } = require('mineflayer-pathfinder');
        bot.pathfinder.setMovements(new Movements(bot));
        const goal = new goals.GoalNear(Math.floor(p0.x) + 6, Math.floor(p0.y), Math.floor(p0.z), 1);
        await Promise.race([bot.pathfinder.goto(goal), sleep(30000).then(() => { throw new Error('pathfinder timeout'); })]);
        result.walkMethod = 'pathfinder';
    } catch (e) {
        result.notes.push(`pathfinder: ${e.message}`);
        try { bot.pathfinder.stop(); } catch { /* not started */ }
        bot.setControlState('forward', true);
        await sleep(2500);
        bot.setControlState('forward', false);
        result.walkMethod = 'forward-control';
    }
    await sleep(1000);
    clearInterval(sampler);
    walked = bot.entity.position.distanceTo(p0);
    result.walkedBlocks = Math.round(walked * 10) / 10;
    result.walkBlocks = walkBlocks;
    result.walkEnd = { position: bot.entity.position.toArray().map(v => Math.round(v * 10) / 10), blockBelow: blockInfo(bot.entity.position.offset(0, -1, 0)) };
    result.checks.walk = walked >= 3;
    log(`walked ${result.walkedBlocks} blocks (${result.walkMethod})`);

    // 5. Stay connected for --minutes, counted from spawn
    const until = spawnMs + minutes * 60000;
    while (Date.now() < until && !ended) {
        await sleep(Math.min(60000, Math.max(0, until - Date.now())));
        if (ended) break;
        const b = bridge();
        log(`alive; pos ${bot.entity.position.toString()} hp ${bot.health} food ${bot.food}; payloads ${b?.stats.payloadsIn}; parseErrors ${b?.stats.parseErrors} partialRead ${b?.stats.partialReadErrors}`);
    }
    result.checks.stayed = !ended && Date.now() >= until;
    result.connectedS = spawnedAt === null ? 0 : secs() - spawnedAt;
    if (!ended) bot.chat(`G1 spike: ${name} done, logging off`);
    await sleep(1000);
    await finish();
}

main().catch((e) => { console.error(`g1-spike: ${e.stack ?? e}`); process.exit(1); });
