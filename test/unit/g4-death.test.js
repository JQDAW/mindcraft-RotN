// Offline tests for G4 #6, test/scenarios/g4/g4-death-report.mjs, and its wiring into the G3 tooling (the
// per-scenario console allowlist, the G4 not-gate rule, the batch checks). A fake server answers the scenario's
// console commands in 1.12's formats (scoreboard, count-only clear, kill) and a fake agent dies, respawns and
// says death_report.js's line. No server, no LLM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { G3_CONSOLE_ALLOW, G4_TEST_SERVER_NOT_GATE, SCENARIO_CONSOLE_EXTRA, consoleAllowFor, crossCheckBatch, g3Policy, guardConsole, isG3Result } from '../runner/lib/g3.mjs';
import { gateBatchProblems, scenarioTimeouts } from '../runner/batch.mjs';
import { loadScenarios } from '../runner/run.mjs';
import g4d, { LOSS_ITEMS, lossConsistency, maxPerMinute, parseDeathReport, reportBaseId, secondsBetween } from '../scenarios/g4/g4-death-report.mjs';

const NAME = 'FRCFLD';
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;
const HELD = { 'pyrotech:rock': 7, 'minecraft:log': 5, 'minecraft:stick': 2, 'minecraft:bread': 1, 'bundles:bundle': 1 };
const KEY = (id) => (id.startsWith('minecraft:') ? id.slice(10) : id);
/** death_report.js's line for a loss (largest first, then by key; at most six named). */
const reportFor = (lost, cause = `${NAME} fell out of the world`) => {
    const named = Object.entries(lost).filter(([, n]) => n > 0).map(([id, n]) => ({ key: KEY(id), count: n }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const list = named.length ? named.slice(0, 6).map((l) => `${l.count} ${l.key}`).join(', ') + (named.length > 6 ? ` and ${named.length - 6} more kinds` : '') : 'nothing';
    return `I died at -40, 66, -60 (${cause}); lost ${list}.`;
};

/**
 * opt: fewItems (only the first-join kit), respawnMs (default 8 s; null never), report (a text instead of the
 * true one; null for none), extraReportMs (a second report this long after the first), reportDelayMs (default
 * 3 s), spam (n lines right after the report), spamKick, noAgenda, noKillReply, kept ({id: n} kept on death).
 */
function sim(opt = {}) {
    const log = [];
    const output = [];
    const sent = [];
    const scheduled = [];
    let t = 0;
    let alive = false;
    let joinedAt = null;
    let dead = false;
    let deaths = 0;
    let health = 20;
    let held = {};
    let gathered = false;   // the agenda's items, once, 2 min after the join
    let frozenAt = null;   // the agenda counter's value while it does not move
    let resumeAt = Infinity;
    const objs = new Set();
    const add = (msg) => log.push(line(t, msg));
    const at = (when, fn) => scheduled.push({ when, fn });
    const advance = () => {
        scheduled.sort((a, b) => a.when - b.when);
        while (scheduled.length && scheduled[0].when <= t) {
            const e = scheduled.shift();
            const now = t;
            t = e.when;
            e.fn();
            t = now;
        }
        if (joinedAt !== null && !gathered && t - joinedAt >= 120000) { gathered = true; held = opt.fewItems ? { 'minecraft:bread': 1, 'bundles:bundle': 1 } : { ...HELD }; }
    };
    const counter = () => {
        if (joinedAt === null) return 0;
        const free = Math.floor((t - joinedAt) / 30000);
        if (frozenAt === null) return free;
        return t >= resumeAt && !opt.noAgenda ? frozenAt + Math.floor((t - resumeAt) / 30000) + 1 : frozenAt;
    };
    const server = {
        console(cmd) {
            advance();
            sent.push(cmd);
            const start = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if ((m = /^scoreboard objectives add (\S+) (\S+)$/.exec(cmd))) { objs.add(m[1]); add(`Added new objective '${m[1]}' successfully`); }
            else if ((m = /^scoreboard objectives remove (\S+)$/.exec(cmd))) { if (objs.delete(m[1])) add(`Removed objective '${m[1]}' successfully`); else add(`No objective was found by the name '${m[1]}'`); }
            else if (cmd === `scoreboard players list ${NAME}`) {
                const val = (o) => (o === 'g4d_d' ? deaths : o === 'g4d_h' ? health : o === 'g4d_a0' ? counter() : 0);
                add(`Showing ${objs.size} tracked objective(s) for ${NAME}:`);
                for (const o of objs) add(`- ${o}: ${val(o)} (${o})`);
            } else if ((m = /^clear (\S+) (\S+) -1 0$/.exec(cmd))) {
                const n = dead ? 0 : held[m[2]] ?? 0;
                add(n ? `${NAME} has ${n} items that match the criteria.` : `Could not clear the inventory of ${NAME}, no items to remove`);
            } else if (cmd === `kill ${NAME}`) {
                if (!opt.noKillReply) { add(`Killed ${NAME}`); add(`${NAME} fell out of the world`); }
                else at(t + 5000, () => add(`${NAME} fell out of the world`));   // a silent console: nothing in the reply
                dead = true;
                deaths++;
                health = 0;
                frozenAt = counter();
                const lost = Object.fromEntries(Object.entries(held).map(([id, n]) => [id, n - (opt.kept?.[id] ?? 0)]));
                const respawnMs = opt.respawnMs === undefined ? 8000 : opt.respawnMs;
                if (respawnMs !== null) {
                    at(t + respawnMs, () => {
                        dead = false;
                        health = 20;
                        held = { ...(opt.kept ?? {}) };
                        resumeAt = t + 90000;
                        const text = opt.report === undefined ? reportFor(lost) : opt.report;
                        const rd = opt.reportDelayMs ?? 3000;
                        if (text !== null) at(t + rd, () => add(`<${NAME}> ${text}`));
                        if (opt.extraReportMs && text !== null) at(t + rd + opt.extraReportMs, () => add(`<${NAME}> ${text}`));
                        for (let i = 0; i < (opt.spam ?? 0); i++) at(t + rd + 1000 + i * 1000, () => add(`<${NAME}> I will get my stuff back, step ${i}`));
                        if (opt.spamKick) at(t + 20000, () => { add(`${NAME} lost connection: Kicked for spamming`); add(`${NAME} left the game`); alive = false; });
                    });
                }
            }
            t += 300;   // every console call takes a moment
            return log.slice(start);
        },
        log: (n) => { advance(); return log.slice(-n); },
    };
    const bot = {
        start() {
            alive = true;
            joinedAt = t;
            output.push(`DRIVER ${JSON.stringify({ type: 'mindcraft_start', models: { model: 'openrouter/@preset/glm-5-3-flash-cheap-reliable' }, serverTaskGiver: false,
                botState: { dir: 'bots/FRCFLD', movedAside: ['agenda.json.g3-S.bak'], fresh: true } })}`);
            log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
            add(`${NAME} joined the game`);
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => output,
        stop() { alive = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; advance(); for (let i = 0; i < 3; i++) await tick(); } };
    return { server: guardConsole(server, consoleAllowFor(g4d)), raw: server, bot, clock, sent };
}

const fast = { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000, agendaCounter: 'stat.mineBlock.pyrotech.rock' };
const run = (s, params = {}) => runScenario(g4d, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('g4-death-report: the pure helpers', () => {
    test('reportBaseId and parseDeathReport on death_report.js\'s lines (from the G3 smoke evidence)', () => {
        assert.equal(reportBaseId('log:1'), 'minecraft:log');
        assert.equal(reportBaseId('stick'), 'minecraft:stick');
        assert.equal(reportBaseId('pyrotech_compat:rock_metamorphic:6'), 'pyrotech_compat:rock_metamorphic');
        assert.equal(reportBaseId('bundles:bundle'), 'bundles:bundle');
        const r = parseDeathReport('I died at -65, 52, -60; lost 32 betterwithmods:dirt_pile, 30 log:1, 12 pyrotech_compat:rock_metamorphic:6, 11 undergroundbiomes:metamorphic_cobble:6, 4 planks:1, 1 betterwithmods:hemp and 5 more kinds.');
        assert.deepEqual(r.at, [-65, 52, -60]);
        assert.equal(r.moreKinds, 5);
        assert.equal(r.items['minecraft:log'], 30);
        assert.equal(r.named.length, 6);
        const c = parseDeathReport('I died at -23, 71, -75 (FRCFLD was slain by Grove Sprite); lost 6 stick, 2 pyrotech_compat:rock_igneous:7, 1 bread.');
        assert.equal(c.cause, 'FRCFLD was slain by Grove Sprite');
        assert.deepEqual(c.items, { 'minecraft:stick': 6, 'pyrotech_compat:rock_igneous': 2, 'minecraft:bread': 1 });
        assert.deepEqual(parseDeathReport('I died at 1, 2, 3; lost 4 stick; XP level 5 -> 2.').xp, [5, 2]);
        assert.equal(parseDeathReport('I died at 1, 2, 3; lost nothing.').nothing, true);
        // Not the report: the streak line, other chat, a mangled list.
        for (const t of ['I died 3 times in 10 min; I stop reporting deaths in chat for now.', 'Got 7 rocks', 'I died at 1, 2, 3; lost some stuff.']) assert.equal(parseDeathReport(t), null, t);
    });

    test('lossConsistency: equal, within the tolerance, unnamed but truncated, and the inconsistent cases', () => {
        const rep = (t) => parseDeathReport(t);
        assert.equal(lossConsistency({ 'minecraft:log': 5, 'minecraft:stick': 2 }, rep('I died at 0, 0, 0; lost 5 log, 2 stick.')).ok, true);
        assert.equal(lossConsistency({ 'minecraft:log': 5 }, rep('I died at 0, 0, 0; lost 7 log.')).ok, true, 'picked up 2 more between the count and the kill');
        assert.equal(lossConsistency({ 'minecraft:log': 20 }, rep('I died at 0, 0, 0; lost 25 log.')).ok, true, '25% of 25');
        assert.equal(lossConsistency({ 'minecraft:log': 5 }, rep('I died at 0, 0, 0; lost 9 log.')).ok, false);
        assert.equal(lossConsistency({ 'minecraft:log': 5 }, rep('I died at 0, 0, 0; lost nothing.')).ok, false);
        const notNamed = lossConsistency({ 'minecraft:bread': 1 }, rep('I died at 0, 0, 0; lost 9 log, 8 stick.'));
        assert.equal(notNamed.ok, false);
        assert.match(notNamed.problems[0], /1 minecraft:bread lost; the report does not name it/);
        assert.equal(lossConsistency({ 'minecraft:bread': 1 }, rep('I died at 0, 0, 0; lost 9 log, 8 stick, 7 a:b, 6 c:d, 5 e:f, 4 g:h and 1 more kinds.')).ok, true, 'among the kinds not named');
        assert.equal(lossConsistency({ 'minecraft:bread': 30 }, rep('I died at 0, 0, 0; lost 9 log, 8 stick, 7 a:b, 6 c:d, 5 e:f, 4 g:h and 1 more kinds.')).ok, false, 'too many to be one of the unnamed');
        assert.equal(lossConsistency({ 'minecraft:log': 0 }, rep('I died at 0, 0, 0; lost 6 log.')).ok, false, 'it reports a loss the server did not count');
        assert.equal(lossConsistency({}, rep('I died at 0, 0, 0; lost 6 x:y.')).ok, true, 'items the server did not count are not judged');
    });

    test('maxPerMinute and secondsBetween (across midnight)', () => {
        assert.equal(maxPerMinute([]), 0);
        assert.equal(maxPerMinute([0, 10, 59, 60, 61]), 4, '10..61 lie within 51 s');
        assert.equal(maxPerMinute([0, 30, 60, 90]), 2);
        assert.equal(maxPerMinute([0, 1, 2, 3, 120]), 4);
        assert.equal(secondsBetween('23:59:50', '00:00:10'), 20);
        assert.equal(secondsBetween('12:00:00', '12:05:00'), 300);
    });
});

describe('g4-death-report on a simulated server', () => {
    test('the module: G4, the real agent, gate parameters, and a runner timeout batch.mjs can derive', () => {
        assert.equal(g4d.gate, 'G4');
        assert.equal(g4d.llm, true);
        assert.equal(g4d.defaults.respawnS, 30);
        assert.equal(g4d.defaults.spamWindowMin, 5);
        assert.equal(g4d.defaults.lossItems, LOSS_ITEMS);
        for (const k of ['respawnS', 'reportS', 'spamWindowMin', 'maxChatPerMin', 'resumeMinutes', 'minHeld', 'maxBatchUsd']) assert.equal(g4d.gateParams[k], 'equal', k);
        const tos = scenarioTimeouts([{ id: 'g4-death-report', timeoutMin: null }], { 'g4-death-report': g4d }, { maxBatchUsd: 2 });
        assert.deepEqual(tos.problems, []);
        assert.ok(tos.timeouts[0].derivedMin >= 40 && tos.timeouts[0].derivedMin <= 55, `derived ${tos.timeouts[0].derivedMin}`);
    });

    test('a death, a respawn, one consistent report, no spam, the agenda resumes: every check passes; only approved commands', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(g4d.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.match(c.respawned.detail, /^health above 0 at \S+, (8|9)s after the kill$/);
        assert.match(c.loss_reported.detail, /^"I died at -40, 66, -60 \(FRCFLD fell out of the world\); lost 7 pyrotech:rock, 5 log, 2 stick, 1 bread, 1 bundles:bundle\." at /);
        assert.equal(s.sent.filter((x) => x.startsWith('kill ')).length, 1, 'one forced death');
        assert.ok(s.sent.every((x) => !/^clear \S+ \S+ -?\d+ [1-9]/.test(x)), 'never a real clear');
        for (const cmd of s.sent) assert.ok(consoleAllowFor(g4d).some((re) => re.test(cmd)), `not approved: ${cmd}`);
        assert.deepEqual(r.notes.lossServer['pyrotech:rock'], 7);
    });

    test('kept items (the main hand) are no loss on either side', async () => {
        const c = byName(await run(sim({ kept: { 'minecraft:log': 5 } })));
        assert.equal(c.loss_reported.pass, true, c.loss_reported.detail);
        assert.doesNotMatch(c.loss_reported.detail, / log/);
    });

    test('each failure fails its own check', async () => {
        const few = byName(await run(sim({ fewItems: true }), { maxWaitHeldMin: 2 }));
        assert.equal(few.had_items.pass, false);
        assert.match(few.died.detail, /^not reached: the bot held 2 of the loss items/);
        const never = byName(await run(sim({ respawnMs: null })));
        assert.equal(never.died.pass, true);
        assert.equal(never.respawned.pass, false);
        assert.match(never.loss_reported.detail, /^not reached: no respawn/);
        const slow = byName(await run(sim({ respawnMs: 40000 })));
        assert.equal(slow.respawned.pass, false);
        assert.match(slow.respawned.detail, /limit 30s/);
        const none = byName(await run(sim({ report: null })));
        assert.match(none.loss_reported.detail, /^no death report line in chat/);
        const wrong = byName(await run(sim({ report: 'I died at -40, 66, -60; lost 2 log, 1 bread.' })));
        assert.equal(wrong.loss_reported.pass, false);
        assert.match(wrong.loss_reported.detail, /does not match the server's count: .*pyrotech:rock/);
        const nothing = byName(await run(sim({ report: 'I died at -40, 66, -60; lost nothing.' })));
        assert.match(nothing.loss_reported.detail, /lost nothing/);
        const twice = byName(await run(sim({ extraReportMs: 70000 })));
        assert.match(twice.loss_reported.detail, /^2 death report lines for one death/);
        const late = byName(await run(sim({ reportDelayMs: 90000 })));
        assert.match(late.loss_reported.detail, /not within 60s of the respawn/);
        const spam = byName(await run(sim({ spam: 15 })));
        assert.equal(spam.no_spam.pass, false);
        assert.match(spam.no_spam.detail, /^1\d chat lines in one 60 s \(limit 10\)/);
        const kicked = byName(await run(sim({ spamKick: true })));
        assert.equal(kicked.no_spam.pass, false);
        assert.match(kicked.no_spam.detail, /kicked for spamming|the bot is gone/);
        const stuck = byName(await run(sim({ noAgenda: true })));
        assert.equal(stuck.agenda_resumed.pass, false);
        assert.match(stuck.agenda_resumed.detail, /stayed at \d+ for 5 min/);
        const noReply = byName(await run(sim({ noKillReply: true })));
        assert.match(noReply.died.detail, /^not reached: the kill got no reply/);
    });
});

describe('the G4 wiring in the G3 tooling', () => {
    test('kill (and the health objective) are on this scenario\'s console list only, a plain name only', async () => {
        const g4 = consoleAllowFor(g4d);
        const ok = (list, cmd) => list.some((re) => re.test(cmd));
        assert.equal(ok(g4, 'kill FRCFLD'), true);
        assert.equal(ok(g4, 'scoreboard objectives add g4d_h health'), true);
        for (const bad of ['kill @a', 'kill @e[type=Zombie]', 'kill', 'kill FRCFLD JQDAW', 'kill @p']) assert.equal(ok(g4, bad), false, bad);
        const registry = await loadScenarios();
        for (const sc of Object.values(registry).filter((x) => x.gate === 'G3')) {
            assert.equal(ok(consoleAllowFor(sc), 'kill FRCFLD'), false, `${sc.id} must not kill`);
            assert.equal(ok(consoleAllowFor(sc), 'scoreboard objectives add h health'), false, sc.id);
        }
        assert.equal(ok(G3_CONSOLE_ALLOW, 'kill FRCFLD'), false);
        assert.deepEqual(Object.keys(SCENARIO_CONSOLE_EXTRA), ['g4-death-report']);
        assert.throws(() => guardConsole({ console: () => [] }).console('kill FRCFLD'), /not on the approved list/);
    });

    test('a G4 run is never a gate run; a G4 result needs a batch.json and is never gate evidence; --gate refuses it', () => {
        const pol = g3Policy(g4d, { ROTN_G3_BATCH: 'b1:2' }, 2);
        assert.equal(pol.guard, true);
        assert.equal(pol.notGate, G4_TEST_SERVER_NOT_GATE);
        assert.equal(pol.batch, 'b1:2');
        assert.equal(isG3Result({ gate: 'G4' }), true);
        assert.equal(isG3Result({ scenario: 'g4-death-report' }), true);
        assert.equal(isG3Result({ scenario: 'g2-blocks-named', gate: 'G2' }), false);
        const summary = { batchId: 'b1', testMode: false, gate: true, smoke: false, maxBatchUsd: 2, scenarios: [{ id: 'g4-death-report', runId: 'r1', exit: 4 }] };
        const res = { scenario: 'g4-death-report', gate: 'G4', runId: 'r1', batch: 'b1:2', pass: false };
        assert.ok(crossCheckBatch(summary, [{ file: 'x/result.json', result: res }], { gate: true }).some((p) => /a G4 result from a test server, a rehearsal: never gate evidence/.test(p)));
        assert.deepEqual(crossCheckBatch({ ...summary, gate: false, smoke: true }, [{ file: 'x/result.json', result: res }]), [], 'a smoke batch vouches for it');
        const reg = { 'g4-death-report': g4d, 'g3-untrusted-refused': { gate: 'G3' } };
        assert.equal(gateBatchProblems({ gate: true, scenarios: [{ id: 'g4-death-report' }] }, reg).length, 1);
        assert.deepEqual(gateBatchProblems({ gate: false, scenarios: [{ id: 'g4-death-report' }] }, reg), []);
        assert.deepEqual(gateBatchProblems({ gate: true, scenarios: [{ id: 'g3-untrusted-refused' }] }, reg), []);
    });
});
