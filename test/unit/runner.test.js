// Offline unit tests for the scenario runner (test/runner/) and the G1 scenario. A simulated
// server, bot and clock stand in for Hetzner, Minecraft and wall time: a 10-minute scenario runs
// in milliseconds. No network, no Minecraft, no LLM.
import './isolate-tmp.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runScenario, waitFor, weakenedParams, KILLED_NOTE } from '../runner/lib/runner.mjs';
import { G2_WORLD_SEED } from '../runner/lib/g2.mjs';
import g2Blocks from '../scenarios/g2/g2-blocks-named.mjs';
import * as L from '../runner/lib/server-log.mjs';
import { parseArgs, loadScenarios, gitInfo, writeAtomic } from '../runner/run.mjs';
import { driverEnv, ctlServer, driverProcess, notStarted, retryNotStarted, NOT_STARTED_BACKOFF_MS } from '../runner/lib/adapters.mjs';
import { attachScenario } from '../runner/drivers/scenario-protocol.mjs';
import g1 from '../scenarios/g1/g1-login-chat-walk.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UUID_V4 = '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d';
const UUID_V3 = '0a1b2c3d-4e5f-3a7b-8c9d-0e1f2a3b4c5d';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';

/**
 * A simulated RotN server plus bot driver on a virtual clock.
 * behaviour: { uuid, loginMs, kick, exitBeforeJoin, hello, echo, walk, dropAtMs, loseSays }
 * loseSays: how many `say` commands vanish (reply and log) before one lands.
 * quietSay: a `say` lands in the log, but the console reply does not show it (a short --wait).
 * sayFormat: how a landed `say` is logged (default "[Server] TEXT").
 */
function sim(behaviour = {}) {
    const b = { uuid: UUID_V4, loginMs: 20000, hello: true, echo: true, walk: 6, ...behaviour };
    const name = 'FRCFLD';
    const log = [];
    const queue = [];
    let t = 0;
    let alive = false;
    let exitCode = null;
    let online = false;
    let pos = [10.5, 64, -3.5];
    let env = {};
    let started = false;
    let says = 0;
    const sayTimes = [];
    const hms = () => new Date(Date.UTC(2026, 10, 1, 12) + t).toISOString().slice(11, 19);
    const add = (msg, thread = 'Server thread', logger = DS) => log.push(`[${hms()}] [${thread}/INFO] [${logger}]: ${msg}`);
    const at = (ms, fn) => queue.push({ when: t + ms, fn });
    const run = () => {
        queue.sort((x, y) => x.when - y.when);
        while (queue.length && queue[0].when <= t) queue.shift().fn();
    };
    const advance = (ms) => {
        const end = t + ms;
        for (;;) {
            queue.sort((x, y) => x.when - y.when);
            if (!queue.length || queue[0].when > end) break;
            t = Math.max(t, queue[0].when);
            run();
        }
        t = end;
    };
    const drop = (reason) => {
        if (!online) return;
        online = false;
        add(`${name} lost connection: ${reason}`, 'Server thread', 'net.minecraft.network.NetHandlerPlayServer');
        add(`${name} left the game`);
    };
    add('Done (17.914s)! For help, type "help" or "?"');
    const server = {
        console(cmd, waitS = 3) {
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) {
                sayTimes.push(t);
                if (++says > (b.loseSays ?? 0)) add(b.sayFormat ? b.sayFormat(m[1]) : `[Server] ${m[1]}`);
            }
            else if ((m = /^tell (\S+) scenario-echo (\S+)$/.exec(cmd)) && online && b.echo) at(1500, () => online && add(`<${name}> echo ${m[2]}`));
            else if ((m = /^tell (\S+) scenario-walk (\d+)$/.exec(cmd)) && online && b.walk) {
                at(8000, () => {
                    pos = [pos[0] + b.walk, pos[1], pos[2]];
                    add(`<${name}> walked ${pos.join(' ')}`);
                });
            } else if (/^tp FRCFLD ~ ~ ~$/.test(cmd)) add(online ? `Teleported ${name} to ${pos.join(', ')}` : `Player not found`);
            else if (cmd === 'list') {
                add(`There are ${online ? 1 : 0}/10 players online:`);
                add(online ? name : '');
            }
            advance(waitS * 1000);
            if (b.quietSay && /^say /.test(cmd)) return [];
            return log.slice(before);
        },
        log: (n) => log.slice(-n),
    };
    const bot = {
        start(e) {
            env = e;
            started = true;
            alive = true;
            if (b.exitBeforeJoin) return at(3000, () => { alive = false; exitCode = 3; });
            at(b.loginMs, () => {
                add(`UUID of player ${name} is ${b.uuid}`, 'User Authenticator #1', 'net.minecraft.server.network.NetHandlerLoginServer');
                if (b.kick) {
                    add(`Disconnecting ${name} (/203.0.113.7:51234): ${b.kick}`, 'Server thread', 'net.minecraft.server.network.NetHandlerLoginServer');
                    alive = false;
                    exitCode = 3;
                    return;
                }
                online = true;
                add(`${name}[/203.0.113.7:51234] logged in with entity id 312 at (${pos.join(', ')})`, 'Server thread', 'net.minecraft.server.management.PlayerList');
                add(`${name} joined the game`);
                if (b.hello) at(2000, () => add(`<${name}> ${env.ROTN_SCENARIO_HELLO}`));
                // A cheating driver: "echoes" a token guessed from its environment without hearing it.
                if (b.echoGuess) at(3000, () => add(`<${name}> echo tok-${env.ROTN_SCENARIO_RUN}`));
                if (b.dropAtMs) at(b.dropAtMs, () => { drop('Timed out'); alive = false; exitCode = 1; });
                if (b.rejoinAtMs) {
                    // The driver reconnects by itself: same process, back online 20 s later.
                    at(b.rejoinAtMs, () => drop('Internal Exception: java.io.IOException: Connection reset by peer'));
                    at(b.rejoinAtMs + (b.rejoinDelayMs ?? 20000), () => { online = true; add(`${name} joined the game`); });
                }
            });
        },
        alive: () => alive,
        exitCode: () => exitCode,
        output: () => [],
        stop() {
            if (alive) { alive = false; exitCode = 0; drop('Disconnected'); }
            return Promise.resolve();
        },
    };
    const clock = { now: () => t, sleep: (ms) => Promise.resolve(advance(ms)) };
    return { server, bot, clock, lines: log, env: () => env, started: () => started, says: () => says, sayTimes: () => sayTimes };
}

const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));
const runG1 = (s, params) => runScenario(g1, { ...s, runId: 'r1', params });

describe('G1 scenario on a simulated server', () => {
    test('a healthy bot passes all five checks after 10 minutes', async () => {
        const s = sim();
        const r = await runG1(s);
        assert.equal(r.pass, true, JSON.stringify(r.checks, null, 1));
        assert.equal(r.passed, 5);
        assert.ok(r.durationS >= 600, `ran ${r.durationS}s`);
        assert.equal(s.env().ROTN_SCENARIO_HELLO, 'hello-r1');
        assert.equal(s.env().ROTN_SCENARIO_BOT, 'FRCFLD');
        const c = byName(r);
        assert.match(c.login_online.detail, /version 4, Mojang account/);
        assert.match(c.walk.detail, /moved 6\.0 blocks/);
        assert.match(c.stay_10min.detail, /still online after \d+s, no disconnects/);
        for (const x of r.checks) assert.ok(x.readyToTry.length > 0);
        assert.deepEqual(r.notes.walk.before, [10.5, 64, -3.5]);
        assert.deepEqual(r.notes.chatPrefixes, [''], 'no chat-mod prefix on the bot\'s lines (PR #13 nit 3)');
        assert.equal(r.botExitCode, 0, 'the runner stops the driver at the end');
        assert.equal(r.botStoppedByRunner, true, 'and says so (G2 batch 5, lead question 3)');
    });

    test('an offline-mode UUID (version 3) fails login_online', async () => {
        const r = await runG1(sim({ uuid: UUID_V3 }));
        const c = byName(r);
        assert.equal(c.login_online.pass, false);
        assert.match(c.login_online.detail, /NOT an online-mode login/);
        assert.equal(r.pass, false);
    });

    test('an FML handshake kick fails login, is classified, and the rest is "not reached"', async () => {
        const s = sim({ kick: 'Server Mod rejections: forge' });
        const r = await runG1(s);
        const c = byName(r);
        assert.equal(c.login_online.pass, false);
        assert.match(c.login_online.detail, /kicked: Server Mod rejections: forge \(handshake\)/);
        for (const n of ['chat_send', 'chat_receive', 'walk', 'stay_10min']) assert.equal(c[n].detail, 'not reached');
        assert.equal(r.notes.kicks[0].class, 'handshake');
        assert.ok(r.durationS < 60, 'stops at once, does not wait out 10 minutes');
    });

    test('a driver that exits before joining fails login with its exit code', async () => {
        const r = await runG1(sim({ exitBeforeJoin: true }));
        assert.match(byName(r).login_online.detail, /driver exited with code 3 before joining/);
    });

    test('no join at all times out', async () => {
        const r = await runG1(sim({ loginMs: 10 * 60000 }));
        assert.match(byName(r).login_online.detail, /no join within 240s/);
    });

    test('silent chat, no echo and no walk each fail their own check only', async () => {
        const c = byName(await runG1(sim({ hello: false, echo: false, walk: 0 })));
        assert.equal(c.login_online.pass, true);
        assert.equal(c.chat_send.pass, false);
        assert.equal(c.chat_receive.pass, false);
        assert.equal(c.walk.pass, false);
        assert.equal(c.stay_10min.pass, true);
    });

    test('walking less than minWalkBlocks (0.75 x walkBlocks = 6) fails (PR #9 review finding 9)', async () => {
        assert.equal(byName(await runG1(sim({ walk: 5 }))).walk.pass, false);
        assert.equal(byName(await runG1(sim({ walk: 6 }))).walk.pass, true);
    });

    test('an echo the driver could guess without hearing the whisper fails (finding 4)', async () => {
        const s = sim({ echo: false, echoGuess: true });
        const r = await runG1(s);
        assert.equal(byName(r).chat_receive.pass, false);
        assert.ok(!Object.values(s.env()).some((v) => /^[0-9a-f]{16}$/.test(v)), 'the token is never in the driver env');
        assert.ok(s.lines.some((l) => /<FRCFLD> echo tok-r1$/.test(l)), 'the guess was made');
    });

    test('a marker that scrolled out of the log tail fails the run instead of hiding disconnects (finding 3)', async () => {
        const r = await runG1(sim(), { logTail: 2 });
        assert.equal(r.pass, false);
        assert.match(r.error, /scenario marker not in the last 2 log lines/);
        assert.ok(r.checks.every((x) => !x.pass));
    });

    test('a drop after 5 minutes fails stay_10min with the reason, without waiting the full 10 minutes', async () => {
        const r = await runG1(sim({ dropAtMs: 5 * 60000 }));
        const c = byName(r);
        assert.equal(c.stay_10min.pass, false);
        assert.match(c.stay_10min.detail, /lost: Timed out \(timeout\)/);
        assert.equal(r.notes.kicks[0].class, 'timeout');
        assert.ok(r.durationS < 400, `ran ${r.durationS}s`);
        assert.equal(r.pass, false);
    });

    test('a drop is a FAIL even if the driver reconnects and is back in list at 10 minutes', async () => {
        const r = await runG1(sim({ rejoinAtMs: 4 * 60000 }));
        const c = byName(r);
        assert.equal(c.stay_10min.pass, false);
        assert.match(c.stay_10min.detail, /list=\[FRCFLD\]/);
        assert.match(c.stay_10min.detail, /server-exception/);
    });

    test('a drop and reconnect in the last poll window before 10 minutes still fails stay_10min', async () => {
        const r = await runG1(sim({ rejoinAtMs: 585000, rejoinDelayMs: 5000 }));
        const c = byName(r);
        assert.equal(c.stay_10min.pass, false);
        assert.match(c.stay_10min.detail, /^after (59\d|6\d\d)s: list=\[FRCFLD\]/);
    });

    test('a lost marker `say` is said again and confirmed before the driver starts', async () => {
        const s = sim({ loseSays: 2 });
        const r = await runG1(s);
        assert.equal(r.pass, true, JSON.stringify(r.checks));
        assert.equal(s.says(), 3);
        const [t0, t1, t2] = s.sayTimes();
        assert.ok(t1 - t0 >= 4000 && t2 - t1 >= 4000, `retries wait consoleWaitS (3 s) after the 1 s reply: ${s.sayTimes()} (PR #13 nit 2)`);
    });

    test('a marker missing from the console reply but in the log tail counts, without a second say', async () => {
        const s = sim({ quietSay: true });
        const r = await runG1(s);
        assert.equal(r.pass, true, JSON.stringify(r.checks));
        assert.equal(s.says(), 1);
    });

    test('the marker is found in any log format that contains it, as linesAfter finds it (PR #13 nit 1)', async () => {
        const s = sim({ sayFormat: (text) => `[Server] \u00a7d${text}` });
        const r = await runG1(s);
        assert.equal(r.pass, true, JSON.stringify(r.checks));
        assert.equal(s.says(), 1);
    });

    test('a marker that never lands fails the run, and the driver is never started', async () => {
        const s = sim({ loseSays: 3 });
        const r = await runG1(s);
        assert.equal(r.pass, false);
        assert.match(r.error, /marker never appeared in the server log after 3 'say' attempts/);
        assert.equal(s.started(), false);
        assert.equal(s.says(), 3);
    });

    test('a scenario that throws fails every check it did not reach and records the error', async () => {
        const s = sim();
        s.server.console = () => { throw new Error('ssh: connection refused'); };
        const r = await runG1(s);
        assert.equal(r.pass, false);
        assert.match(r.error, /ssh: connection refused/);
        assert.ok(r.checks.every((x) => !x.pass && /not reached \(scenario error\)/.test(x.detail)));
    });

    test('weakened params can pass their checks but are never a G1 pass (finding 1)', async () => {
        for (const params of [{ stayMs: 60000 }, { minWalkBlocks: 0 }, { walkBlocks: 2, minWalkBlocks: 1 }, { bot: 'OTHER' }]) {
            const r = await runG1(sim(), params);
            assert.equal(r.pass, false, JSON.stringify(params));
            assert.equal(r.gateValid, false);
            assert.ok(r.weakenedParams.length > 0);
            if (!params.bot) {
                assert.equal(r.checksPassed, true, JSON.stringify(params));
                assert.equal(r.verdict, 'SMOKE-PASS (not a gate pass)');
            }
        }
        const stronger = await runG1(sim({ walk: 9 }), { stayMs: 700000, walkBlocks: 9, minWalkBlocks: 7, chatTimeoutMs: 120000 });
        assert.equal(stronger.pass, true, 'stricter or neutral params still count');
        assert.equal(stronger.verdict, 'PASS');
        const shortStay = await runG1(sim(), { stayMs: 60000 });
        assert.ok(shortStay.durationS < 200);
        assert.deepEqual(shortStay.weakenedParams, ['stayMs=60000 (gate needs >= 600000)']);
    });

    test('a check name the scenario did not declare is a programming error', async () => {
        const bad = { id: 'x', gate: 'G1', title: 'x', checks: { a: 'item' }, defaults: { pollMs: 1 }, run: (ctx) => ctx.check('b', true) };
        const r = await runScenario(bad, { ...sim(), runId: 'r' });
        assert.match(r.error, /has no check 'b'/);
    });
});

describe('server-log parsers', () => {
    const line = (msg, thread = 'Server thread', logger = DS) => `[12:00:00] [${thread}/INFO] [${logger}]: ${msg}`;

    test('parseLine and linesAfter', () => {
        assert.deepEqual(L.parseLine(line('hi')), { time: '12:00:00', thread: 'Server thread', level: 'INFO', logger: DS, msg: 'hi' });
        assert.equal(L.parseLine('\tat net.minecraft.Foo.bar(Foo.java:1)'), null);
        assert.equal(L.parseLine('[12:00:00] [main/INFO]: no logger')?.msg, 'no logger');
        assert.deepEqual(L.linesAfter(['a', 'x MARK', 'b', 'c'], 'MARK'), ['b', 'c']);
        assert.equal(L.linesAfter(['a'], 'MARK'), null, 'a missing marker is not "no lines"');
    });

    test('UUID and its version', () => {
        assert.equal(L.loginUuid([line(`UUID of player FRCFLD is ${UUID_V4.toUpperCase()}`)], 'FRCFLD'), UUID_V4);
        assert.equal(L.loginUuid([line(`UUID of player FRCFLDX is ${UUID_V4}`)], 'FRCFLD'), null);
        assert.equal(L.uuidVersion(UUID_V4), 4);
        assert.equal(L.uuidVersion(UUID_V3.replace(/-/g, '')), 3);
        assert.equal(L.uuidVersion('nope'), null);
    });

    test('player events: join, chat, teleport, losses and both login-kick forms', () => {
        const ev = L.playerEvents([
            line('FRCFLD[/1.2.3.4:5] logged in with entity id 7 at (1.5, 64.0, -3.25)'),
            line('FRCFLD joined the game'),
            line('<FRCFLD> hi there'),
            line('<JQDAW> FRCFLD joined the game'),
            line('Teleported FRCFLD to -1.5, 70.0, 2.0'),
            line('FRCFLD lost connection: Timed out'),
            line('FRCFLD left the game'),
            line('Disconnecting com.mojang.authlib.GameProfile@1a2b[id=<null>,name=FRCFLD,properties={},legacy=false] (/1.2.3.4:5): You are not white-listed on this server!'),
            line('Disconnecting FRCFLD (/1.2.3.4:5): Server Mod rejections:'),
            line('Disconnecting OTHER (/1.2.3.4:6): nope'),
        ], 'FRCFLD');
        assert.deepEqual(ev.map((e) => e.type), ['logged_in', 'joined', 'chat', 'teleported', 'lost', 'left', 'kicked', 'kicked']);
        assert.deepEqual(ev[0].pos, [1.5, 64, -3.25]);
        assert.deepEqual(ev[3].pos, [-1.5, 70, 2]);
        assert.equal(ev[6].reason, 'You are not white-listed on this server!');
    });

    test('chat lines: own chat only, chat-mod prefixes tolerated, whispers and other players ignored', () => {
        const c = L.chatLines([
            line('<FRCFLD> echo tok'), line('[G] <FRCFLD> hello'), line('<JQDAW> <FRCFLD> fake'),
            line('<JQDAW> lol <FRCFLD> echo tok'), line('[Server] <FRCFLD> echo tok'), line('[Server] scenario-echo tok'),
            line('<FRCFLD2> no'), line('[a] [b] <FRCFLD> two prefixes'),
            line('[Rcon] <FRCFLD> echo tok'), line('[@] <FRCFLD> echo tok'),
        ], 'FRCFLD');
        assert.deepEqual(c.map((x) => x.text), ['echo tok', 'hello'], 'anchored: quotes, [Server], [Rcon], [@] and other players never count');
        assert.deepEqual(c.map((x) => x.prefix), [null, 'G'], 'the chat-mod prefix is kept for the chatPrefixes note');
    });

    test('online players from list, inline or on the next line', () => {
        assert.deepEqual(L.onlinePlayers([line('There are 2/10 players online:'), line('FRCFLD, JQDAW')]), ['FRCFLD', 'JQDAW']);
        assert.deepEqual(L.onlinePlayers([line('There are 1/10 players online: FRCFLD')]), ['FRCFLD']);
        assert.deepEqual(L.onlinePlayers([line('There are 0/10 players online:'), line('')]), []);
        assert.equal(L.onlinePlayers([line('nothing')]), null);
    });

    test('kick classes', () => {
        assert.equal(L.classifyKick('Server Mod rejections: foo'), 'handshake');
        assert.equal(L.classifyKick('No modded response'), 'handshake');
        assert.equal(L.classifyKick('Timed out'), 'timeout');
        assert.equal(L.classifyKick('You are not white-listed on this server!'), 'whitelist');
        assert.equal(L.classifyKick('Internal Exception: java.io.IOException: Error while read(...)'), 'server-exception');
        assert.equal(L.classifyKick('Disconnected'), 'client-quit');
        assert.equal(L.classifyKick('Flying is not enabled'), 'other');
        assert.equal(L.classifyKick('You are banned from this server.'), 'banned');
        assert.deepEqual([...L.FATAL_KICKS].sort(), ['banned', 'handshake', 'whitelist']);
        assert.equal(L.horizontal([0, 64, 0], [3, 70, 4]), 5);
    });
});

describe('waitFor', () => {
    test('returns the first truthy value or null at the deadline', async () => {
        let t = 0;
        const clock = { now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); } };
        assert.equal(await waitFor(clock, () => t >= 30 && 'ok', 100, 10), 'ok');
        assert.equal(t, 30);
        assert.equal(await waitFor(clock, () => false, 25, 10), null);
        assert.equal(t, 55);
    });

    test('a missing or bad poll interval is 1 s, so the deadline still comes (a scenario without pollMs once hung)', async () => {
        for (const bad of [undefined, NaN, 0, -5]) {
            let t = 0;
            const clock = { now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); } };
            assert.equal(await waitFor(clock, () => false, 3500, bad), null, String(bad));
            assert.equal(t, 3500, `${bad}: three 1 s polls and a last 0.5 s one`);
        }
    });
});

describe('run.mjs', () => {
    test('gitInfo: sha, dirty only for tracked changes, untracked counted; nulls when git cannot answer', () => {
        const SHA = 'a'.repeat(40);
        const lines = (...l) => l.map((x) => `${x}\n`).join('');
        const fake = (status) => (cmd, args) => (args[0] === 'rev-parse' ? lines(SHA) : status);
        assert.deepEqual(gitInfo('.', fake('')), { sha: SHA, dirty: false, untracked: 0 });
        assert.deepEqual(gitInfo('.', fake(lines('?? captures/x.jsonl', '?? test/scenarios/g2/new.mjs'))), { sha: SHA, dirty: false, untracked: 2 });
        assert.deepEqual(gitInfo('.', fake(lines(' M test/runner/run.mjs', '?? x'))), { sha: SHA, dirty: true, untracked: 1 });
        assert.deepEqual(gitInfo('.', fake(lines('M  staged.js'))), { sha: SHA, dirty: true, untracked: 0 });
        assert.deepEqual(gitInfo('.', () => { throw new Error('not a git repository'); }), { sha: null, dirty: null, untracked: null });
        assert.deepEqual(gitInfo('.', () => lines('garbage')), { sha: null, dirty: null, untracked: null });
        const real = gitInfo();
        assert.match(real.sha, /^[0-9a-f]{40}$/);
    });

    test('parseArgs', () => {
        assert.deepEqual(parseArgs(['--scenario', 'g1', '--param', 'stayMs=60000', '--param', 'bot=X=Y', '--', 'node', 'd.mjs', '--x']),
            { params: { stayMs: 60000, bot: 'X=Y' }, driver: ['node', 'd.mjs', '--x'], list: false, scenario: 'g1', out: null, passEnv: [], service: null });
        assert.deepEqual(parseArgs(['--pass-env', 'OPENROUTER_API_KEY', '--', 'x']).passEnv, ['OPENROUTER_API_KEY']);
        assert.throws(() => parseArgs(['--param', 'nope']), /key=value/);
        assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
    });

    test('parseArgs keeps integers beyond Number.MAX_SAFE_INTEGER (19-digit seeds) as strings, digit for digit', () => {
        const p = (v) => parseArgs(['--param', `x=${v}`]).params.x;
        assert.equal(p('1880465901402976865'), '1880465901402976865');
        assert.equal(p('-8796110535854059511'), '-8796110535854059511');
        assert.equal(p('9007199254740992'), '9007199254740992');   // MAX_SAFE_INTEGER + 1
        assert.equal(p('9007199254740991'), 9007199254740991);     // MAX_SAFE_INTEGER stays a number
        assert.equal(p('-42'), -42);
        assert.equal(p('2.5'), 2.5);
        // The planned G2 seed given on the command line is the gate default, so the run is not weakened.
        const params = parseArgs(['--param', `worldSeed=${G2_WORLD_SEED}`]).params;
        assert.deepEqual(weakenedParams(g2Blocks, params), []);
        // The fixed cube centre given on the command line is a string ("x,y,z") equal to the gate default.
        assert.deepEqual(weakenedParams(g2Blocks, parseArgs(['--param', 'cubeCentre=-45,66,-66']).params), []);
        assert.deepEqual(weakenedParams(g2Blocks, { worldSeed: Number(G2_WORLD_SEED) }).map((w) => w.split(' ')[0]), ['worldSeed=1880465901402976800']);
    });

    test('discovers the G1 scenario', async () => {
        const s = await loadScenarios();
        assert.equal(s['g1-login-chat-walk'], g1);
        assert.deepEqual(Object.keys(g1.checks), ['login_online', 'chat_send', 'chat_receive', 'walk', 'stay_10min']);
    });

    test('CLI: --list works; a missing driver, unknown param or missing TEST_SERVER_CTL is a usage error (2)', () => {
        const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(repo, 'test/runner/run.mjs'), ...args],
            { encoding: 'utf8', env: { ...process.env, TEST_SERVER_CTL: '', ...env } });
        const list = cli(['--list']);
        assert.equal(list.status, 0, list.stderr);
        assert.match(list.stdout, /^g1-login-chat-walk\tG1\t/m);
        assert.equal(cli(['--scenario', 'g1-login-chat-walk']).status, 2);
        assert.equal(cli(['--scenario', 'nope', '--', 'node', 'x']).status, 2);
        assert.match(cli(['--scenario', 'g1-login-chat-walk', '--param', 'zzz=1', '--', 'node', 'x']).stderr, /no parameter 'zzz'/);
        const noCtl = cli(['--scenario', 'g1-login-chat-walk', '--', 'node', 'x']);
        assert.equal(noCtl.status, 2);
        assert.match(noCtl.stderr, /TEST_SERVER_CTL is not set/);
    });
});

describe('run.mjs end to end with its real adapters (fake test-server CLI and fake driver)', () => {
    test('writes result.json, server.log and driver.log; a shortened stay exits 4 (smoke); the driver never sees the ctl', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-runner-'));
        try {
            const fwd = (p) => p.replace(/\\/g, '/');
            const ctl = path.join(tmp, 'ctl.sh');
            fs.writeFileSync(ctl, `#!/usr/bin/env bash\nexec "${fwd(process.execPath)}" "${fwd(path.join(repo, 'test/unit/fixtures/fake-ctl.mjs'))}" "$@"\n`, { mode: 0o755 });
            const out = path.join(tmp, 'out');
            const r = spawnSync(process.execPath, [path.join(repo, 'test/runner/run.mjs'), '--scenario', 'g1-login-chat-walk',
                '--param', 'stayMs=3000', '--param', 'pollMs=200', '--param', 'consoleWaitS=0', '--out', out, '--pass-env', 'FAKE_CTL_DIR',
                '--', process.execPath, path.join(repo, 'test/unit/fixtures/fake-driver.mjs')],
            { encoding: 'utf8', timeout: 60000, env: { ...process.env, TEST_SERVER_CTL: fwd(ctl), FAKE_CTL_DIR: tmp, TEST_SERVER_NAME: 'mcr-test-x',
                TEST_SERVER_STATE_DIR: fwd(tmp), HCLOUD_TOKEN: 'not-a-real-token', ROTN_SCENARIO_EXTRA: 'kept' } });
            const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
            assert.equal(r.status, 4, `${r.stderr}\n${JSON.stringify(res.checks, null, 1)}`);
            assert.equal(res.passed, 5);
            assert.equal(res.pass, false);
            assert.equal(res.verdict, 'SMOKE-PASS (not a gate pass)');
            assert.equal(res.server, 'mcr-test-x');
            const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
            assert.equal(res.git.sha, head, 'result.json records the commit under test');
            assert.equal(typeof res.git.dirty, 'boolean');
            assert.equal(typeof res.git.untracked, 'number');
            const serverLog = fs.readFileSync(path.join(out, 'server.log'), 'utf8');
            assert.match(serverLog, /^.*FRCFLD joined the game$/m);
            assert.doesNotMatch(serverLog, /scenario-.*-begin/, 'starts after the marker');
            const driverLog = fs.readFileSync(path.join(out, 'driver.log'), 'utf8');
            assert.match(driverLog, /DRIVER \{"type":"spawn","bot":"FRCFLD"\}/);
            assert.match(driverLog, /DRIVER \{"type":"env","ctl":false,"stateDir":false,"hcloud":false,"extra":"kept"\}/, 'finding 5');
            assert.match(r.stderr, /SMOKE run, not a G1 pass: stayMs=3000/);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe('driverProcess: the exit of a driver the runner stops (G2 batch 5: botExitCode 128)', () => {
    test('stop() ends a running driver with SIGTERM: exit code 128 and exitSignal "SIGTERM"; a driver that exits by itself keeps its code', async () => {
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-dp-')), 'driver.log');
        const d = driverProcess([process.execPath, '-e', 'setTimeout(() => {}, 60000)'], out);
        d.start({});
        assert.equal(d.alive(), true);
        await d.stop(5000);
        assert.equal(d.exitCode(), 128, 'ended by a signal');
        assert.equal(d.exitSignal(), 'SIGTERM');
        const e = driverProcess([process.execPath, '-e', 'process.exit(3)'], out);
        e.start({});
        for (let i = 0; i < 200 && e.alive(); i++) await new Promise((r) => setTimeout(r, 25));
        assert.equal(e.exitCode(), 3);
        assert.equal(e.exitSignal(), null);
    });
});

describe('driverProcess: a second start is a new process (the one login retry)', () => {
    test('exit code and alive() are reset by start(); output keeps both runs in order', async () => {
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-dp-')), 'driver.log');
        const d = driverProcess([process.execPath, '-e', 'console.log("run " + process.env.ROTN_T); setTimeout(() => process.exit(Number(process.env.ROTN_T)), 50)'], out);
        const waitExit = async () => { for (let i = 0; i < 200 && d.alive(); i++) await new Promise((r) => setTimeout(r, 25)); };
        d.start({ ROTN_T: '3' });
        assert.equal(d.alive(), true);
        await waitExit();
        assert.equal(d.exitCode(), 3);
        d.start({ ROTN_T: '0' });
        assert.equal(d.alive(), true, 'alive again right after the second start');
        assert.equal(d.exitCode(), null);
        await waitExit();
        assert.equal(d.exitCode(), 0);
        await new Promise((r) => setTimeout(r, 100));
        assert.deepEqual(d.output(), ['run 3', 'run 0']);
        await d.stop();
    });
});

describe('adapters', () => {
    test('driverEnv is an allowlist; credentials and test-server control never reach the driver (finding 5)', () => {
        const parent = {
            PATH: '/bin', HOME: '/h', TEST_SERVER_HOST: '203.0.113.7', TEST_SERVER_PORT: '25565', MINDCRAFT_PROFILES_FOLDER: '/p',
            TEST_SERVER_CTL: '/ctl', TEST_SERVER_STATE_DIR: '/s', ROTN_TEST_STATE_DIR: '/s2', HCLOUD_TOKEN: 'x', GH_TOKEN: 'x',
            GITHUB_TOKEN: 'x', OPENROUTER_API_KEY: 'x', ROTN_SCENARIO_X: '1', ROTN_DRIVER_AUTH: 'microsoft', RANDOM_VAR: 'y',
        };
        const env = driverEnv(parent, { ROTN_SCENARIO_HELLO: 'h' });
        assert.deepEqual(Object.keys(env).sort(), ['HOME', 'MINDCRAFT_PROFILES_FOLDER', 'PATH', 'ROTN_DRIVER_AUTH', 'ROTN_SCENARIO_HELLO',
            'ROTN_SCENARIO_X', 'TEST_SERVER_HOST', 'TEST_SERVER_PORT']);
        assert.equal(driverEnv(parent, {}, ['OPENROUTER_API_KEY']).OPENROUTER_API_KEY, 'x', 'only when asked for');
        for (const bad of ['TEST_SERVER_CTL', 'TEST_SERVER_STATE_DIR', 'ROTN_TEST_STATE_DIR', 'HCLOUD_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
            assert.throws(() => driverEnv(parent, {}, [bad]), /must never get/, bad);
        }
    });

    test('ctlServer retries a failed call twice with 2 s and 4 s backoff (finding 10)', () => {
        const pauses = [];
        let calls = 0;
        const flaky = (fails) => () => (++calls <= fails ? { status: 255, stderr: 'ssh: connection reset' } : { status: 0, stdout: 'a\r\nb\n' });
        const ok = ctlServer('/ctl', { spawn: flaky(2), pause: (ms) => pauses.push(ms) });
        assert.deepEqual(ok.log(5), ['a', 'b']);
        assert.deepEqual(pauses, [2000, 4000]);
        calls = 0;
        const bad = ctlServer('/ctl', { spawn: flaky(3), pause: () => {} });
        assert.throws(() => bad.console('list'), /console failed \(255\): ssh: connection reset \(after 3 attempts: \d\d:\d\d:\d\dZ 255 \(free \d+ MB\), /);
    });

    test('ctlServer: a bash that never started is retried longer, and only that (round 5 B: 0xC0000142 three times in 6 s)', () => {
        const DLL_INIT = 3221225794;
        const seq = (results) => { let i = 0; return () => results[Math.min(i++, results.length - 1)]; };
        const fixed = { now: () => new Date('2026-11-06T13:26:15Z'), freemem: () => 512 * 2 ** 20 };
        // Round 5 B's failure, now ridden out: three never-started calls, then the console answers.
        let pauses = [];
        const ok = ctlServer('/ctl', { ...fixed, spawn: seq([{ status: DLL_INIT, stderr: '' }, { status: DLL_INIT, stderr: '' }, { status: DLL_INIT, stderr: '' }, { status: 0, stdout: 'x\n' }]), pause: (ms) => pauses.push(ms) });
        assert.deepEqual(ok.console('time query daytime'), ['x']);
        assert.deepEqual(pauses, [5000, 10000, 20000], 'the long backoff, not 2 s and 4 s');
        // Never started for the whole long backoff: 6 attempts over 135 s, then the error names each one.
        pauses = [];
        const never = ctlServer('/ctl', { ...fixed, spawn: seq([{ status: DLL_INIT, stderr: '' }]), pause: (ms) => pauses.push(ms) });
        assert.throws(() => never.console('list'), (e) => {
            assert.match(e.message, /^console failed \(3221225794 STATUS_DLL_INIT_FAILED\) \(after 6 attempts: 13:26:15Z STATUS_DLL_INIT_FAILED \(free 512 MB\), /);
            return true;
        });
        assert.deepEqual(pauses, NOT_STARTED_BACKOFF_MS);
        assert.equal(pauses.reduce((a, b) => a + b, 0), 135000);
        // spawnSync's own errors: ENOMEM is a never-started process; a timeout is not (the command may have run).
        assert.equal(notStarted({ status: null, error: Object.assign(new Error('x'), { code: 'ENOMEM' }) }), 'ENOMEM');
        assert.equal(notStarted({ status: null, error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }), null);
        assert.equal(notStarted({ status: 255 }), null, 'an ssh failure inside bash comes back as 8 bits');
        assert.equal(notStarted({ status: 3221225495 }), 'STATUS_NO_MEMORY');
        // Mixed: never-started retries do not use up the two ordinary ones, and an ordinary failure keeps 2 s and 4 s.
        pauses = [];
        const mixed = ctlServer('/ctl', { ...fixed, spawn: seq([{ status: DLL_INIT }, { status: 255, stderr: 'reset' }, { status: DLL_INIT }, { status: 255, stderr: 'reset' }, { status: 255, stderr: 'reset' }]), pause: (ms) => pauses.push(ms) });
        assert.throws(() => mixed.log(5), /log failed \(255\): reset \(after 5 attempts: /);
        assert.deepEqual(pauses, [5000, 2000, 10000, 4000]);
    });

    test('retryNotStarted (the batch\'s final log fetch, round 5 B): retries only a never-started process, with the long backoff', () => {
        const DLL_INIT = 3221225794;
        const run = (results) => { let i = 0; const f = () => results[Math.min(i++, results.length - 1)]; f.calls = () => i; return f; };
        const told = [];
        const pauses = [];
        const a = run([{ status: DLL_INIT }, { status: DLL_INIT }, { status: 0 }]);
        assert.equal(retryNotStarted(a, { pause: (ms) => pauses.push(ms), onRetry: (why, ms) => told.push(`${why} ${ms}`) }).status, 0);
        assert.deepEqual([a.calls(), pauses, told], [3, [5000, 10000], ['STATUS_DLL_INIT_FAILED 5000', 'STATUS_DLL_INIT_FAILED 10000']]);
        const b = run([{ status: 1 }]);
        assert.equal(retryNotStarted(b, { pause: () => assert.fail('no wait for a fetch that ran and failed') }).status, 1);
        assert.equal(b.calls(), 1);
        const c = run([{ status: DLL_INIT }]);
        assert.equal(retryNotStarted(c, { pause: () => {} }).status, DLL_INIT, 'gives up after the long backoff');
        assert.equal(c.calls(), NOT_STARTED_BACKOFF_MS.length + 1);
    });
});

describe('driver side (scenario-protocol.mjs) on a fake mineflayer bot', () => {
    function fakeBot() {
        const bot = new EventEmitter();
        bot.said = [];
        bot.chat = (m) => bot.said.push(m);
        bot.controls = {};
        bot.entity = { position: { x: 0, y: 64, z: 0 }, yaw: 0 };
        bot.setControlState = (k, v) => { bot.controls[k] = v; };
        bot.clearControlStates = () => { bot.controls = {}; };
        bot.look = (yaw) => { bot.entity.yaw = yaw; return Promise.resolve(); };
        // Moves 0.5 blocks per 50 ms while "forward" is held.
        bot.timer = setInterval(() => { if (bot.controls.forward) bot.entity.position.x += 0.5; }, 50);
        return bot;
    }
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));

    test('says hello once on spawn, echoes each token once, walks and reports', async () => {
        const bot = fakeBot();
        const events = [];
        try {
            attachScenario(bot, { hello: 'hello-r1', helloDelayMs: 1, walkTimeoutMs: 5000, emit: (t, d) => events.push([t, d]) });
            bot.emit('spawn');
            await tick(20);
            assert.deepEqual(bot.said, ['hello-r1']);
            bot.emit('messagestr', 'Server whispers to you: scenario-echo tok-1');
            bot.emit('messagestr', '[Server -> FRCFLD] scenario-echo tok-1');
            assert.deepEqual(bot.said, ['hello-r1', 'echo tok-1']);
            bot.emit('messagestr', 'Server whispers to you: scenario-walk 3');
            for (let i = 0; i < 100 && !bot.said.some((s) => s.startsWith('walked')); i++) await tick(50);
            const w = bot.said.find((s) => s.startsWith('walked'));
            assert.ok(w, `said: ${bot.said}`);
            assert.ok(bot.entity.position.x >= 3);
            assert.deepEqual(bot.controls, {}, 'controls released after the walk');
            assert.ok(events.some(([t, d]) => t === 'walked' && d.method === 'forward+jump+turn'), 'walk reports its method (net-forge walkMethod)');
        } finally {
            clearInterval(bot.timer);
        }
    });

    test('errors in the handlers are reported as events, never as unhandled rejections (finding 8)', async () => {
        const bot = fakeBot();
        clearInterval(bot.timer);
        const events = [];
        const unhandled = [];
        const onUnhandled = (e) => unhandled.push(e);
        process.on('unhandledRejection', onUnhandled);
        try {
            bot.entity = null; // not spawned yet
            bot.chat = () => { throw new Error('not connected'); };
            attachScenario(bot, { hello: 'h', helloDelayMs: 1, walkTimeoutMs: 100, emit: (t, d) => events.push([t, d]) });
            bot.emit('messagestr', 'scenario-walk 3');
            bot.emit('messagestr', 'scenario-echo t1');
            bot.emit('spawn');
            await tick(30);
            assert.deepEqual(events.map(([t]) => t).sort(), ['chat_error', 'chat_error', 'heard', 'spawn', 'walk_error']);
            assert.match(events.find(([t]) => t === 'walk_error')[1].message, /no position yet/);
            assert.deepEqual(unhandled, []);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });
});

describe('P2 (lead, after G2 batch 6): a killed runner leaves the checks it had done in result.json, never a pass', () => {
    const fakeBot = () => ({ start() {}, stop: async () => {}, alive: () => false, exitCode: () => null, output: () => [] });
    const clock = { now: () => 0, sleep: async () => {} };
    const scenario = {
        id: 'p2', gate: 'GX', title: 't', checks: { a: 'item a', b: 'item b' }, defaults: {}, gateParams: {},
        run(ctx) { ctx.check('a', true, 'ok'); ctx.note('k', 1); ctx.check('b', true, 'ok'); },
    };

    test('onProgress gets a FAIL (killed) record at the start and after every check; the final result replaces it', async () => {
        const recs = [];
        const control = {};
        const r = await runScenario(scenario, { server: {}, bot: fakeBot(), clock, runId: 'x', onProgress: (x) => recs.push(structuredClone(x)), control });
        assert.equal(recs.length, 4, 'start, a, note k, b');
        for (const x of recs) {
            assert.equal(x.pass, false);
            assert.equal(x.checksPassed, false);
            assert.equal(x.gateValid, false, 'a killed record is never gate-valid');
            assert.equal(x.verdict, 'FAIL (killed)');
            assert.equal(x.notes.killed, KILLED_NOTE);
            assert.equal(x.error, 'runner killed before the scenario finished');
        }
        assert.deepEqual(recs[0].checks.map((c) => c.detail), ['not reached (runner killed)', 'not reached (runner killed)']);
        assert.deepEqual(recs[1].checks.map((c) => [c.check, c.pass, c.detail]), [['a', true, 'ok'], ['b', false, 'not reached (runner killed)']]);
        assert.equal(recs[2].notes.k, 1, 'a note is written through as well');
        // Every check passed before the kill: still never a pass.
        assert.equal(recs[3].passed, 2);
        assert.equal(recs[3].pass, false);
        assert.deepEqual(recs[3].weakenedParams, [], 'not weakened, yet not gate-valid');
        assert.equal(r.pass, true);
        assert.equal(r.gateValid, true);
        assert.equal(r.verdict, 'PASS');
        assert.equal('killed' in r.notes, false, 'a finished run has no killed note');
        assert.match(control.progress('SIGTERM').notes.killed, /Killed by SIGTERM\.$/);
    });

    test('writeAtomic replaces the file whole and leaves no temp file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-wa-'));
        try {
            const f = path.join(dir, 'result.json');
            writeAtomic(f, 'one\n');
            writeAtomic(f, 'two\n');
            assert.equal(fs.readFileSync(f, 'utf8'), 'two\n');
            assert.deepEqual(fs.readdirSync(dir), ['result.json']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    // Is the process gone (after the kill in killDuringStay's cleanup)? Polls up to 5 s.
    async function processGone(pid) {
        for (let i = 0; i < 50; i++) {
            try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; }
            await new Promise((r) => setTimeout(r, 100));
        }
        return false;
    }

    // run.mjs on the fake test-server CLI and fake driver, G1 with a 10-minute stay, killed during the stay.
    async function killDuringStay(signal) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-kill-'));
        const fwd = (q) => q.replace(/\\/g, '/');
        const ctl = path.join(tmp, 'ctl.sh');
        fs.writeFileSync(ctl, `#!/usr/bin/env bash\nexec "${fwd(process.execPath)}" "${fwd(path.join(repo, 'test/unit/fixtures/fake-ctl.mjs'))}" "$@"\n`, { mode: 0o755 });
        const out = path.join(tmp, 'out');
        const child = spawn(process.execPath, [path.join(repo, 'test/runner/run.mjs'), '--scenario', 'g1-login-chat-walk',
            '--param', 'pollMs=200', '--param', 'consoleWaitS=0', '--out', out, '--pass-env', 'FAKE_CTL_DIR',
            '--', process.execPath, path.join(repo, 'test/unit/fixtures/fake-driver.mjs')],
        { stdio: 'ignore', env: { ...process.env, TEST_SERVER_CTL: fwd(ctl), FAKE_CTL_DIR: tmp, TEST_SERVER_NAME: 'mcr-test-x', TEST_SERVER_STATE_DIR: fwd(tmp) } });
        const exited = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })));
        const file = path.join(out, 'result.json');
        const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
        const driverPid = () => { try { return Number(fs.readFileSync(path.join(tmp, 'driver.pid'), 'utf8')) || null; } catch { return null; } };
        try {
            // Wait until the progress record shows the walk passed (the stay is next and lasts 10 minutes).
            let rec = null;
            for (let i = 0; i < 600 && !(rec?.checks?.find((c) => c.check === 'walk')?.pass); i++) {
                await new Promise((r) => setTimeout(r, 100));
                rec = read();
            }
            assert.ok(rec, 'a progress record exists while the run is going');
            child.kill(signal);
            const ex = await exited;
            return { rec: read(), ex, driverPid: driverPid() };
        } finally {
            // The fake driver outlives a hard-killed runner (its parent dies, it does not): kill it by the pid it
            // wrote at its start (fake-driver.mjs; driver.log may not exist, see there).
            const pid = driverPid();
            try { if (pid) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
            child.kill('SIGKILL');
            await new Promise((r) => setTimeout(r, 200));
            fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
    }

    test('run.mjs: a hard kill (TerminateProcess on Windows, SIGKILL elsewhere) leaves FAIL (killed) with the checks done', { timeout: 120000 }, async () => {
        const { rec, driverPid } = await killDuringStay('SIGKILL');
        assert.ok(driverPid, 'the fake driver wrote its pid');
        assert.equal(await processGone(driverPid), true, 'no fake driver left running after the test');
        assert.equal(rec.pass, false);
        assert.equal(rec.gateValid, false);
        assert.equal(rec.verdict, 'FAIL (killed)');
        assert.equal(rec.notes.killed, KILLED_NOTE);
        const by = Object.fromEntries(rec.checks.map((c) => [c.check, c]));
        for (const k of ['login_online', 'chat_send', 'chat_receive', 'walk']) assert.equal(by[k].pass, true, `${k}: ${by[k].detail}`);
        assert.deepEqual([by.stay_10min.pass, by.stay_10min.detail], [false, 'not reached (runner killed)']);
        assert.equal(rec.server, 'mcr-test-x');
        assert.equal(typeof rec.git.sha, 'string', 'the progress record names the code under test');
    });

    test('run.mjs: SIGTERM where it can be caught (not Windows) names the signal and exits 143', { timeout: 120000, skip: process.platform === 'win32' && 'node cannot catch a SIGTERM sent to it on Windows (TerminateProcess)' }, async () => {
        const { rec, ex, driverPid } = await killDuringStay('SIGTERM');
        assert.ok(driverPid, 'the fake driver wrote its pid');
        assert.equal(await processGone(driverPid), true, 'no fake driver left running after the test');
        assert.equal(ex.code, 143);
        assert.equal(rec.pass, false);
        assert.equal(rec.verdict, 'FAIL (killed)');
        assert.match(rec.notes.killed, /Killed by SIGTERM\.$/);
        assert.equal(rec.checks.find((c) => c.check === 'walk').pass, true);
    });
});
