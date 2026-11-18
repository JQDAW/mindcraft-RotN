import './isolate-tmp.mjs';
// G4 step 7, the acceptance rule (lib/g4-accept.mjs; the lead's rule of 2026-11-08): each missing condition (a)-(e)
// makes a run not-gate with its reason, a complete set counts; the evidence check over a set of results; run.mjs end to
// end on the service path with a fake ssh gate, a fake test server and a fake tag.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    ACCEPT_GO_RE, STEP7_RUNS, STEP7_SCENARIOS, USAGE_FILE, acceptMarker, checkAcceptanceResults, evaluateAcceptance, freshServer, notAcceptanceReason,
    parseLedger, recordUsage, releaseFromJournal, runOf, serverCreatedMs, startAcceptance,
} from '../runner/lib/g4-accept.mjs';
import { timeQuery } from '../runner/lib/s1.mjs';
import { parseStarts } from '../runner/lib/adapters.mjs';
import { G3_ON_SERVICE_NOT_GATE, G4_SERVICE_NOT_GATE } from '../runner/lib/g3.mjs';
import { acceptanceApplies, policyReasonApplies, resolveTag } from '../runner/run.mjs';
import { G2_WORLD_SEED } from '../runner/lib/g2.mjs';
import { checkEvidenceTree, isG3AcceptanceOnService } from '../tools/g3-batch-check.mjs';
import { checkAcceptanceTree, parseCli } from '../tools/g4-accept-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const GO = 'G4-ACCEPT-20261118';
const TAG = 'rotn-v0.1.5';
const SHA = 'f0e1d2c3b4a5968778695a4b3c2d1e0f11223344';
const RELEASE = { tag: TAG, sha12: SHA.slice(0, 12), source: 'release line' };
const FRESH = { ok: true, why: 'fresh: no join and no scenario since the server started' };
const envFor = ({ unit = 'frcfld', run = 1, go = GO, svcGo = go, tag = TAG } = {}) => ({
    ROTN_SERVICE_GO: `${svcGo}:${unit}:test-server-host-confirmed`,
    ROTN_G4_ACCEPT: `${go}:${run}:${tag}:gate-ctl-hashes-confirmed`,
});
const evalWith = (over = {}) => evaluateAcceptance({
    env: envFor(), scenarioId: 'g4-soak-2h', botKind: 'service', unit: 'frcfld', driver: 'service frcfld via cx23-ctl',
    release: RELEASE, fresh: FRESH, resolveTag: (t) => (t === TAG ? SHA : null), ...over,
});
/** The conditions that do not hold, as letters ('' = a valid acceptance run). */
const failing = (acc) => Object.entries(acc.conditions).filter(([, v]) => !v.ok).map(([k]) => k).join('');

describe('the six step-7 runs (PLAN.md step 7)', () => {
    test('each step-7 scenario belongs to exactly one run; run 5 is the trusted-player session', () => {
        assert.deepEqual(Object.keys(STEP7_RUNS), ['1', '2', '3', '4', '5', '6']);
        assert.equal(new Set(STEP7_SCENARIOS).size, STEP7_SCENARIOS.length);
        assert.equal(runOf('g4-soak-2h'), 1);
        assert.equal(runOf('g3-untrusted-refused'), 4);
        assert.deepEqual(STEP7_RUNS[5], ['g4-control-commands', 'g3-task-preempts-agenda', 'g4-restart-persistence']);
        assert.ok(Number.isNaN(runOf('g1-login-chat-walk')));
    });

    test('every step-7 scenario exists in test/scenarios', () => {
        const r = spawnSync(process.execPath, [path.join(repo, 'test/runner/run.mjs'), '--list'], { encoding: 'utf8' });
        const ids = r.stdout.split('\n').map((l) => l.split('\t')[0]);
        for (const id of STEP7_SCENARIOS) assert.ok(ids.includes(id), id);
    });
});

describe('ROTN_G4_ACCEPT', () => {
    test('<GO id>:<run 1-6>:<rotn-v tag>:gate-ctl-hashes-confirmed, nothing else', () => {
        assert.deepEqual(acceptMarker(envFor({ run: 5 })), { ok: true, present: true, goId: GO, run: 5, tag: TAG });
        assert.equal(acceptMarker({}).present, false);
        assert.match(acceptMarker({}).why, /no ROTN_G4_ACCEPT marker/);
        for (const bad of [`${GO}`, `${GO}:7:${TAG}:gate-ctl-hashes-confirmed`, `${GO}:1:v0.1.5:gate-ctl-hashes-confirmed`,
            `${GO}:1:rotn-v0.1.5-rc.1:gate-ctl-hashes-confirmed`,
            `${GO}:1:${TAG}`, `${GO}:1:${TAG}:hashes`, `${GO}:1:${TAG}:gate-ctl-hashes-confirmed `, `x:1:${TAG}:gate-ctl-hashes-confirmed`]) {
            const m = acceptMarker({ ROTN_G4_ACCEPT: bad });
            assert.equal(m.ok, false, bad);
            assert.equal(m.present, true, bad);
        }
    });
    test('an acceptance GO id is G4-ACCEPT-<yyyymmdd>[-letter], nothing else (one GO spans all six runs)', () => {
        for (const ok of ['G4-ACCEPT-20261120', 'G4-ACCEPT-20261120-b']) assert.ok(ACCEPT_GO_RE.test(ok), ok);
        for (const bad of ['G4-ACCEPT-2026112', 'G4-ACCEPT-20261120-B', 'G4-ACCEPT-20261120-bb', 'X-G4-ACCEPT-20261120', 'G4-ACCEPTED-20261120',
            'G4-SOAK-ACCEPT-20261120', 'g4-accept-20261120']) assert.equal(ACCEPT_GO_RE.test(bad), false, bad);
    });
});

describe('the release, read from the journal (c): only the [release] line, after the unit start (#447)', () => {
    const j = (msg, ident = 'node[1]') => `2026-11-18T12:00:00+00:00 ${ident}: ${msg}`;
    const unitStart = (u = 'frcfld') => j(`Starting mindcraft-rotn@${u}.service - Mindcraft-RotN bot ${u}...`, 'systemd[1]');
    const rel = `[release] ${TAG}-${SHA.slice(0, 12)}`;
    test('the "[release] <tag>-<sha12>" line after the unit start', () => {
        assert.deepEqual(releaseFromJournal([unitStart(), j('[settings] x'), j(rel)], 'frcfld'),
            { tag: TAG, sha12: SHA.slice(0, 12), source: 'release line', seen: `${TAG}-${SHA.slice(0, 12)}` });
        assert.equal(releaseFromJournal([unitStart(), j(rel), unitStart(), j(rel)], 'frcfld').tag, TAG, 'a ctl restart inside the run: the same release twice');
    });
    test('the window must include the unit start; a line before it, or for another unit, does not count', () => {
        assert.match(releaseFromJournal([j(rel)], 'frcfld').why, /does not include the unit's start/);
        assert.match(releaseFromJournal([unitStart('bottwo'), j(rel)], 'frcfld').why, /does not include the unit's start/);
        assert.match(releaseFromJournal([j(rel), unitStart(), j('[state] FRCFLD at start: tasks=absent')], 'frcfld').why, /no "\[release\] <tag>-<sha12>" line after the unit's start/);
    });
    test('no fallback to release paths; "[release] none", a suffixed or malformed tag, two releases: no release, with the reason', () => {
        const path = j('    at goToGoal (file:///opt/mindcraft-rotn/releases/rotn-v0.1.4-f6107fc4b3b6/src/agent/library/skills.js:2617:41)');
        assert.match(releaseFromJournal([unitStart(), path], 'frcfld').why, /no "\[release\]/, 'stack-trace paths are not read any more');
        assert.match(releaseFromJournal([unitStart(), j('[release] none')], 'frcfld').why, /printed "\[release\] none"/);
        assert.match(releaseFromJournal([unitStart(), j(`[release] rotn-v0.1.5-rc.1-${SHA.slice(0, 12)}`)], 'frcfld').why, /not rotn-vX\.Y\.Z-<sha12> \(step 7 uses a plain tag\)/);
        assert.match(releaseFromJournal([unitStart(), j('[release] v0.1.0-abcdefabcdef')], 'frcfld').why, /not rotn-vX\.Y\.Z/);
        const two = releaseFromJournal([unitStart(), j(rel), unitStart(), j('[release] rotn-v0.1.4-f6107fc4b3b6')], 'frcfld');
        assert.equal(two.tag, null);
        assert.match(two.why, /more than one release/);
        assert.equal(releaseFromJournal([], 'frcfld').tag, null);
    });
});

describe('a fresh test server (e): the usage ledger, the log, and two server-side facts', () => {
    const start = '[10:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Starting minecraft server version 1.12.2';
    const say = (id) => `[10:05:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: [Server] scenario-${id}-begin`;
    const join = (n) => `[10:06:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${n} joined the game`;
    const created = Date.parse('2026-11-18T10:00:00Z');
    const base = { server: 'mcr-test-20261118-100000', stateDir: '/s', goId: GO, run: 5, scenarioId: 'g4-restart-persistence',
        usage: [], logLines: [start, 'Done (20.1s)!'], starts: { starts: 1, files: 1 }, gametime: 6000, createdMs: created, nowMs: created + 600000 };
    const run5 = (scenario, runId) => ({ goId: GO, run: 5, runId, scenario });
    test('fresh: nothing earlier; or only OTHER scenarios of this same GO and run (run 5\'s session)', () => {
        assert.equal(freshServer(base).ok, true, freshServer(base).why);
        const usage = [run5('g4-control-commands', '20261118t100500-abc123'), run5('g3-task-preempts-agenda', '20261118t102000-abc124')];
        const r = freshServer({ ...base, usage, logLines: [start, say('20261118t100500-abc123'), join('JQDAW'), join('FRCFLD'), say('20261118t102000-abc124')] });
        assert.equal(r.ok, true, r.why);
        assert.match(r.why, /only other scenarios of this run used it \(2\)/);
    });
    test('not fresh: the same scenario again on this server (a rerun), even under the same GO and run', () => {
        const rerun = { ...base, run: 2, scenarioId: 'g4-service-reconnect', usage: [{ goId: GO, run: 2, runId: '20261118t100500-abc123', scenario: 'g4-service-reconnect' }],
            logLines: [start, say('20261118t100500-abc123'), join('FRCFLD')] };
        assert.match(freshServer(rerun).why, /g4-service-reconnect already ran on this server .*needs a new server/);
        assert.match(freshServer({ ...base, usage: [run5('g4-restart-persistence', 'x')] }).why, /already ran on this server/);
    });
    test('not fresh: another GO or run, a run without a marker, a scenario the ledger does not show, a join before', () => {
        assert.match(freshServer({ ...base, usage: [{ goId: GO, run: 4, runId: 'x', scenario: 'g3-untrusted-refused' }] }).why, /an earlier run used this server \(g3-untrusted-refused, GO G4-ACCEPT-20261118 run 4\)/);
        assert.match(freshServer({ ...base, usage: [{ goId: 'G4-ACCEPT-20261117', run: 5, runId: 'x', scenario: 'g4-control-commands' }] }).why, /an earlier run used this server/);
        assert.match(freshServer({ ...base, usage: [{ goId: null, run: null, runId: 'x', scenario: 'g4-soak-2h' }] }).why, /not an acceptance run/);
        assert.match(freshServer({ ...base, goId: null, run: null, usage: [{ goId: null, run: null, runId: 'x', scenario: 'g4-control-commands' }] }).why, /an earlier run used/, 'no marker: no sharing at all');
        assert.match(freshServer({ ...base, logLines: [start, say('20261118t090000-def456')] }).why, /that its usage ledger does not show/);
        assert.match(freshServer({ ...base, logLines: [start, join('JQDAW')] }).why, /JQDAW joined before/);
    });
    test('the server started more than once, or its starts cannot be counted: not fresh', () => {
        assert.match(freshServer({ ...base, starts: { starts: 2, files: 2 } }).why, /started 2 times on this box \(over 2 log file\(s\)\)/);
        assert.match(freshServer({ ...base, starts: { starts: 0, files: 1 } }).why, /started 0 times/);
        assert.match(freshServer({ ...base, starts: null }).why, /starts could not be counted/);
        // Only the life since the LAST start is read for joins; the starts count catches an earlier life.
        assert.match(freshServer({ ...base, logLines: [start, join('JQDAW'), start], starts: { starts: 2, files: 2 } }).why, /started 2 times/);
    });
    test('the world older than the server (more than 20 ticks a second since it was created), or not read: not fresh', () => {
        assert.equal(freshServer({ ...base, gametime: 12000 }).ok, true, 'exactly 20 ticks a second for 600 s');
        assert.match(freshServer({ ...base, gametime: 12001 }).why, /world is 12001 ticks old, more than the 12000 ticks/);
        assert.match(freshServer({ ...base, gametime: 5000000 }).why, /older|more than/);
        assert.match(freshServer({ ...base, gametime: null }).why, /world's age could not be read/);
        assert.match(freshServer({ ...base, createdMs: null }).why, /creation time is unknown/);
        assert.equal(freshServer({ ...base, gametime: 0, nowMs: created - 5000 }).ok, true, 'a clock behind the creation time: bound 0, a new world 0');
        assert.match(freshServer({ ...base, gametime: 1, nowMs: created - 5000 }).why, /more than the 0 ticks/);
    });
    test('missing inputs fail closed', () => {
        assert.match(freshServer({ ...base, logLines: ['Done'] }).why, /start line is not in the fetched log/);
        assert.match(freshServer({ ...base, logLines: null }).why, /could not be read/);
        assert.match(freshServer({ ...base, usage: null }).why, /usage ledger cannot be read/);
        assert.match(freshServer({ ...base, server: null }).why, /no TEST_SERVER_NAME/);
        assert.match(freshServer({ ...base, stateDir: null }).why, /no TEST_SERVER_STATE_DIR/);
        assert.deepEqual(parseLedger('{"goId":"a","run":1}\n\n'), [{ goId: 'a', run: 1 }]);
        assert.equal(parseLedger('{"goId":"a"}\nnot json\n'), null);
    });

    test('startAcceptance reads the ledger, the log, rotn-test starts, the gametime (through the console) and server-create.json; writes nothing', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-accept-'));
        fs.writeFileSync(path.join(dir, 'server-create.json'), JSON.stringify({ server: { created: '2026-11-18T10:00:00Z' } }));
        const sent = [];
        const server = {
            log: () => [start, 'Done'],
            logRotated: () => { throw new Error('not needed'); },
            starts: () => parseStarts(['starts=1 files=1']),
            console: (cmd) => { sent.push(cmd); return ['[10:10:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Time is 6000']; },
        };
        const env = { ...envFor({ run: 5 }), TEST_SERVER_NAME: 'mcr-test-x', TEST_SERVER_STATE_DIR: dir };
        const a = startAcceptance({ server, env, scenarioId: 'g4-control-commands', fsImpl: fs, pathImpl: path, timeQuery, nowMs: created + 600000 });
        assert.equal(a.fresh.ok, true, a.fresh.why);
        assert.deepEqual(a.facts, { starts: { starts: 1, files: 1 }, gametime: 6000, createdAt: '2026-11-18T10:00:00.000Z' });
        assert.deepEqual(sent, ['time query gametime']);
        assert.equal(fs.existsSync(path.join(dir, USAGE_FILE)), false, 'the check writes nothing');
        assert.equal(serverCreatedMs(dir, fs, path), created);
        // After 00:00 UTC the start line is in the rolled-over file.
        const rolled = { ...server, log: () => ['[00:00:01] Done'], logRotated: () => ({ files: ['2026-11-18-1.log.gz', 'latest.log'], lines: [start, '[00:00:01] Done'] }) };
        assert.equal(startAcceptance({ server: rolled, env, scenarioId: 'g4-control-commands', fsImpl: fs, pathImpl: path, timeQuery, nowMs: created + 600000 }).fresh.ok, true);
        // A server without the starts read, a console that refuses, an unreadable log, no server-create.json: not fresh.
        const { starts, ...noStarts } = server;
        void starts;
        assert.match(startAcceptance({ server: noStarts, env, scenarioId: 'g4-control-commands', fsImpl: fs, pathImpl: path, timeQuery, nowMs: created + 600000 }).fresh.why, /starts could not be counted/);
        assert.match(startAcceptance({ server: { ...server, console: () => { throw new Error('refused'); } }, env, scenarioId: 'g4-control-commands', fsImpl: fs, pathImpl: path, timeQuery, nowMs: created + 600000 }).fresh.why, /world's age could not be read/);
        assert.match(startAcceptance({ server: { ...server, log: () => { throw new Error('ssh'); } }, env, scenarioId: 'g4-control-commands', fsImpl: fs, pathImpl: path, timeQuery, nowMs: created + 600000 }).fresh.why, /log could not be read/);
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-accept-'));
        assert.match(startAcceptance({ server, env: { ...env, TEST_SERVER_STATE_DIR: bare }, scenarioId: 'g4-control-commands', fsImpl: fs, pathImpl: path, timeQuery, nowMs: created + 600000 }).fresh.why, /creation time is unknown/);
    });

    test('recordUsage: EVERY run on a test server writes a line, marked or not; a failed write is reported', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-usage-'));
        const at = () => new Date('2026-11-18T10:00:00Z');
        assert.equal(recordUsage({ env: { TEST_SERVER_STATE_DIR: dir }, scenarioId: 'g3-first-night', runId: 'r1', botKind: 'driver', fsImpl: fs, pathImpl: path, now: at }).ok, true);
        assert.equal(recordUsage({ env: { ...envFor({ run: 1 }), TEST_SERVER_STATE_DIR: dir }, scenarioId: 'g4-soak-2h', runId: 'r2', botKind: 'service', fsImpl: fs, pathImpl: path, now: at }).ok, true);
        assert.deepEqual(parseLedger(fs.readFileSync(path.join(dir, USAGE_FILE), 'utf8')), [
            { runId: 'r1', scenario: 'g3-first-night', goId: null, run: null, bot: 'driver', at: '2026-11-18T10:00:00.000Z' },
            { runId: 'r2', scenario: 'g4-soak-2h', goId: GO, run: 1, bot: 'service', at: '2026-11-18T10:00:00.000Z' },
        ]);
        const ro = { ...fs, appendFileSync: () => { throw Object.assign(new Error('EROFS'), { code: 'EROFS' }); } };
        assert.match(recordUsage({ env: { TEST_SERVER_STATE_DIR: dir }, scenarioId: 'x', runId: 'r3', fsImpl: ro, pathImpl: path }).why, /could not be written \(EROFS\)/);
        assert.equal(recordUsage({ env: {}, scenarioId: 'x', runId: 'r4', fsImpl: fs, pathImpl: path }).ok, false, 'not a test-server run: nothing written');
    });
    test('parseStarts: "starts=N files=K", else null', () => {
        assert.deepEqual(parseStarts(['starts=1 files=3']), { starts: 1, files: 3 });
        assert.equal(parseStarts(['starts=x files=1']), null);
        assert.equal(parseStarts([]), null);
    });
});

describe('the rule: each missing condition gives not-gate with its reason; a complete set counts', () => {
    test('a complete set: valid, with the marker, the release and its commit recorded', () => {
        const acc = evalWith();
        assert.equal(failing(acc), '');
        assert.equal(acc.valid, true);
        assert.deepEqual(acc.reasons, []);
        assert.deepEqual(acc.marker, { goId: GO, run: 1, tag: TAG });
        assert.deepEqual(acc.release, { tag: TAG, sha12: SHA.slice(0, 12), commit: SHA, source: 'release line' });
        assert.match(acc.conditions.d.why, /not verified by the runner/);
    });

    test('(a) no marker, a malformed one, a GO not named as acceptance, a scenario of another run, another GO than ROTN_SERVICE_GO', () => {
        const noMarker = evalWith({ env: { ROTN_SERVICE_GO: envFor().ROTN_SERVICE_GO } });
        assert.equal(failing(noMarker), 'ad', 'the hash attestation is part of the marker');
        assert.match(noMarker.reasons[0], /^\(a\) no ROTN_G4_ACCEPT marker/);
        assert.equal(failing(evalWith({ env: { ...envFor(), ROTN_G4_ACCEPT: `${GO}:1:${TAG}` } })), 'ad');
        assert.equal(failing(evalWith({ env: envFor({ go: 'G4-SOAK-3-20261118' }) })), 'a');
        assert.match(evalWith({ env: envFor({ go: 'G4-SOAK-3-20261118' }) }).conditions.a.why, /not an acceptance GO \(G4-ACCEPT-<yyyymmdd>\[-letter\]\)/);
        assert.equal(failing(evalWith({ env: envFor({ go: 'G4-ACCEPT-OTHER' }) })), 'a', 'ACCEPT alone is not the form');
        assert.equal(failing(evalWith({ env: envFor({ run: 2 }) })), 'a');
        assert.match(evalWith({ env: envFor({ run: 2 }) }).conditions.a.why, /not one of step-7 run 2's scenarios/);
        assert.equal(failing(evalWith({ env: envFor({ svcGo: 'G4-ACCEPT-OTHER' }) })), 'a');
    });

    test('(b) a spawned driver (set-up T)', () => {
        assert.equal(failing(evalWith({ botKind: 'driver', driver: 'node test/runner/mindcraft-driver.mjs' })), 'b');
        assert.equal(failing(evalWith({ driver: 'service frcfld via other-host' })), 'b');
        // T with no unit: the host cannot be confirmed either.
        assert.equal(failing(evalWith({ botKind: 'driver', unit: null, driver: 'node d.mjs' })), 'be');
    });

    test('(c) the release not read, a tag not in this repo, a commit that does not match', () => {
        assert.equal(failing(evalWith({ release: { tag: null, why: 'no release in the journal' } })), 'cd', '(d) cannot be tied to a release either');
        assert.equal(failing(evalWith({ resolveTag: () => null })), 'c');
        assert.match(evalWith({ resolveTag: () => null }).conditions.c.why, /not in this repo/);
        assert.equal(failing(evalWith({ resolveTag: () => '0'.repeat(40) })), 'c');
        assert.match(evalWith({ resolveTag: () => '0'.repeat(40) }).conditions.c.why, /CX23 runs f0e1d2c3b4a5/);
    });

    test('(d) the hashes confirmed at another tag than the one running', () => {
        const acc = evalWith({ env: envFor({ tag: 'rotn-v0.1.4' }) });
        assert.equal(failing(acc), 'd');
        assert.match(acc.conditions.d.why, /confirmed at rotn-v0\.1\.4, but the CX23 runs rotn-v0\.1\.5/);
    });

    test('(e) a server that is not fresh; a host not confirmed for this unit', () => {
        assert.equal(failing(evalWith({ fresh: { ok: false, why: 'not fresh: JQDAW joined before this acceptance run began' } })), 'e');
        assert.equal(failing(evalWith({ fresh: null })), 'e');
        assert.equal(failing(evalWith({ env: { ROTN_G4_ACCEPT: envFor().ROTN_G4_ACCEPT } })), 'e');
        assert.equal(failing(evalWith({ env: envFor({ unit: 'bottwo' }) })), 'e', 'the service GO names another unit');
    });

    test('the not-gate reason names every missing condition', () => {
        const acc = evalWith({ env: { ROTN_SERVICE_GO: envFor().ROTN_SERVICE_GO }, fresh: { ok: false, why: 'not fresh: x' } });
        assert.match(notAcceptanceReason(acc), /^not a G4 acceptance run: \(a\) no ROTN_G4_ACCEPT .*; \(d\) .*; \(e\) not fresh: x$/);
    });
});

describe('run.mjs: when the rule applies; the tag lookup', () => {
    test('a step-7 scenario on the service, or any step-7 run with the marker; never another scenario', () => {
        const svc = { kind: 'service' };
        const drv = { kind: 'driver' };
        assert.equal(acceptanceApplies({ id: 'g4-soak-2h' }, svc, {}), true);
        assert.equal(acceptanceApplies({ id: 'g3-untrusted-refused' }, svc, {}), true);
        assert.equal(acceptanceApplies({ id: 'g4-death-report' }, drv, {}), false, 'a T rehearsal without the marker: the rehearsal reason only');
        assert.equal(acceptanceApplies({ id: 'g4-death-report' }, drv, envFor()), true, 'a T run with the marker is judged (and fails (b))');
        assert.equal(acceptanceApplies({ id: 'g3-first-night' }, svc, envFor()), false);
    });
    test('g3Policy\'s reason: kept on T and for an S run that is not a valid acceptance run; dropped for a valid G4 one and for G3 on S', () => {
        const svc = { kind: 'service' };
        const drv = { kind: 'driver' };
        assert.equal(policyReasonApplies({ gate: 'G4' }, svc, { valid: true }), false);
        assert.equal(policyReasonApplies({ gate: 'G4' }, svc, { valid: false }), true);
        assert.equal(policyReasonApplies({ gate: 'G4' }, svc, undefined), true);
        assert.equal(policyReasonApplies({ gate: 'G4' }, drv, { valid: true }), false, 'a "valid" record is impossible on T ((b)), and the record decides');
        assert.equal(policyReasonApplies({ gate: 'G3' }, svc, undefined), false, 'G3 on S: the S reason replaces the spend-stop one');
        assert.equal(policyReasonApplies({ gate: 'G3' }, drv, undefined), true, 'a G3 run on T keeps its batch rule');
    });
    test('resolveTag: only a rotn-v tag, its full commit, or null', () => {
        const exec = (prog, args) => { assert.equal(prog, 'git'); assert.deepEqual(args, ['rev-parse', '--verify', '--quiet', `refs/tags/${TAG}^{commit}`]); return `${SHA}\n`; };
        assert.equal(resolveTag(TAG, '/r', exec), SHA);
        assert.equal(resolveTag('v0.1.0', '/r', () => SHA), null);
        assert.equal(resolveTag(`${TAG};rm`, '/r', () => SHA), null);
        assert.equal(resolveTag(TAG, '/r', () => { throw new Error('unknown revision'); }), null);
        assert.equal(resolveTag(TAG, '/r', () => 'not a sha\n'), null);
    });
});

/** A valid (or not) acceptance result as run.mjs writes it. */
function accResult({ scenario, run = runOf(scenario), server = `mcr-test-run${run}`, runId, commit = SHA, tag = TAG, passed = true, go = GO, fresh = FRESH }) {
    const unit = scenario === 'g4-second-bot' ? 'bottwo' : 'frcfld';
    const g3 = scenario.startsWith('g3-');
    const acc = evaluateAcceptance({ env: envFor({ unit, run, go, tag }), scenarioId: scenario, botKind: 'service', unit, driver: `service ${unit} via cx23-ctl`,
        release: { tag, sha12: commit.slice(0, 12), source: 'release line' }, fresh, resolveTag: () => commit });
    const weakened = [...(g3 ? [G3_ON_SERVICE_NOT_GATE] : []), ...(acc.valid ? [] : [notAcceptanceReason(acc), ...(g3 ? [] : [G4_SERVICE_NOT_GATE])])];
    return {
        scenario, gate: g3 ? 'G3' : 'G4', runId: runId ?? `20261118t1${run}${STEP7_RUNS[run].indexOf(scenario)}000-a0000${run}`, server,
        driver: `service ${unit} via cx23-ctl`, service: { goId: go, startError: null, incident: null, stateUnknown: null },
        checksPassed: passed, gateValid: weakened.length === 0, pass: passed && weakened.length === 0, weakenedParams: weakened, g4Acceptance: acc,
    };
}
const sixRuns = () => STEP7_SCENARIOS.map((s) => ({ file: `g4/accept/${s}/result.json`, result: accResult({ scenario: s }) }));
const check = (results, o = {}) => checkAcceptanceResults(results, { g3OnServiceReason: G3_ON_SERVICE_NOT_GATE, ...o });

describe('the step-7 evidence check over a set of results', () => {
    test('a complete set on one commit: consistent, and --complete passes; the summary lists each scenario', () => {
        const r = check(sixRuns(), { complete: GO });
        assert.deepEqual(r.problems, []);
        assert.equal(r.summary.length, 1);
        assert.match(r.summary[0], new RegExp(`^GO ${GO} on ${TAG} \\(f0e1d2c3b4a5\\): g4-soak-2h PASS, `));
        assert.match(r.summary[0], /g3-untrusted-refused PASS/, 'a G3 scenario on S passes on its checks, its only weakening the S one');
    });

    test('(c) over the set: two commits or two tags in one GO', () => {
        const runs = sixRuns();
        runs[2] = { file: 'x/result.json', result: accResult({ scenario: runs[2].result.scenario, commit: '1'.repeat(40) }) };
        assert.match(check(runs).problems.join('\n'), /more than one commit/);
        const runs2 = sixRuns();
        runs2[0] = { file: 'y/result.json', result: accResult({ scenario: 'g4-soak-2h', tag: 'rotn-v0.1.6' }) };
        assert.match(check(runs2).problems.join('\n'), /more than one tag/);
    });

    test('(e) over the set: one test server used by two step-7 runs; run 5\'s three scenarios on one server are fine', () => {
        const runs = sixRuns();
        runs[1] = { file: 'r2/result.json', result: accResult({ scenario: 'g4-service-reconnect', server: 'mcr-test-run1' }) };
        assert.match(check(runs).problems.join('\n'), /mcr-test-run1 was used by step-7 runs 1 and 2/);
        assert.deepEqual(check(sixRuns()).problems, [], 'run 5: three scenarios, one server');
    });

    test('(e) over the set: a failed run 2 rerun on the SAME server is a problem; on a new server it is fine', () => {
        const failed = accResult({ scenario: 'g4-service-reconnect', passed: false });
        const sameServer = accResult({ scenario: 'g4-service-reconnect', runId: '20261119t100000-b00002' });
        const runs = [...sixRuns().filter((x) => x.result.scenario !== 'g4-service-reconnect'), { file: 'r2a/result.json', result: failed }, { file: 'r2b/result.json', result: sameServer }];
        assert.match(check(runs).problems.join('\n'), /g4-service-reconnect ran twice on the test server mcr-test-run2 \(r2a\/result\.json, r2b\/result\.json\); a rerun needs a fresh server/);
        const newServer = accResult({ scenario: 'g4-service-reconnect', runId: '20261119t100000-b00002', server: 'mcr-test-run2b' });
        const ok = [...sixRuns().filter((x) => x.result.scenario !== 'g4-service-reconnect'), { file: 'r2a/result.json', result: failed }, { file: 'r2b/result.json', result: newServer }];
        assert.deepEqual(check(ok, { complete: GO }).problems, []);
    });

    test('--complete: a missing scenario, or one that never passed, is a problem; a failed run that is rerun and passes is not', () => {
        const runs = sixRuns().filter((x) => x.result.scenario !== 'g4-second-bot');
        assert.match(check(runs, { complete: GO }).problems.join('\n'), /run 6 has no valid acceptance result for g4-second-bot/);
        const failed = sixRuns();
        failed[0] = { file: 'f/result.json', result: accResult({ scenario: 'g4-soak-2h', passed: false }) };
        assert.match(check(failed, { complete: GO }).problems.join('\n'), /g4-soak-2h \(step-7 run 1\) did not pass/);
        assert.deepEqual(check(failed).problems, [], 'a failed acceptance run is evidence too (consistent)');
        const rerun = [...failed, { file: 'f2/result.json', result: accResult({ scenario: 'g4-soak-2h', server: 'mcr-test-run1b', runId: '20261119t100000-b00001' }) }];
        assert.deepEqual(check(rerun, { complete: GO }).problems, []);
        assert.match(check(rerun).summary[0], /g4-soak-2h FAIL\/PASS/);
        assert.match(check([], { complete: GO }).problems.join('\n'), /run 1 has no valid acceptance result/);
    });

    test('a G4 pass (or gate-valid result) that is not a valid acceptance run is a problem', () => {
        assert.match(check([{ file: 'p.json', result: { scenario: 'g4-soak-2h', gate: 'G4', pass: true, gateValid: true } }]).problems[0], /not a valid step-7 acceptance run/);
        const r = accResult({ scenario: 'g4-soak-2h', fresh: { ok: false, why: 'not fresh: x' } });
        assert.deepEqual(check([{ file: 'ok.json', result: r }]).problems, [], 'an invalid acceptance run marked not-gate is consistent');
        assert.match(check([{ file: 'b.json', result: { ...r, gateValid: true } }]).problems.join('\n'), /not a valid acceptance run/);
    });

    test('a record that does not follow its conditions, or a "valid" one whose recorded facts break the rule', () => {
        const base = accResult({ scenario: 'g4-soak-2h' });
        const forged = (patch) => [{ file: 'forged.json', result: { ...base, ...patch(base) } }];
        const out = (patch) => check(forged(patch)).problems.join('\n');
        assert.match(out((b) => ({ g4Acceptance: { ...b.g4Acceptance, conditions: { ...b.g4Acceptance.conditions, e: { ok: false, why: 'x' } } } })), /valid does not follow its conditions/);
        assert.match(out((b) => ({ g4Acceptance: { ...b.g4Acceptance, conditions: { a: b.g4Acceptance.conditions.a } } })), /lacks a condition/);
        assert.match(out(() => ({ driver: 'node test/runner/mindcraft-driver.mjs' })), /not the S service/);
        assert.match(out(() => ({ service: { goId: 'G4-ACCEPT-OTHER' } })), /service GO \(G4-ACCEPT-OTHER\) is not the acceptance GO/);
        assert.match(out(() => ({ scenario: 'g4-second-bot' })), /not a scenario of step-7 run 1/);
        assert.match(out((b) => ({ g4Acceptance: { ...b.g4Acceptance, release: { ...b.g4Acceptance.release, tag: 'rotn-v0.1.4' } } })), /release rotn-v0\.1\.4 is not the confirmed tag/);
        assert.match(out((b) => ({ g4Acceptance: { ...b.g4Acceptance, release: { ...b.g4Acceptance.release, commit: '0'.repeat(40) } } })), /commit is missing or does not match/);
        assert.match(out((b) => ({ g4Acceptance: { ...b.g4Acceptance, fresh: { ok: false } } })), /not recorded as fresh/);
        assert.match(out(() => ({ server: null })), /names no test server/);
        assert.match(out((b) => ({ g4Acceptance: { ...b.g4Acceptance, marker: { ...b.g4Acceptance.marker, goId: 'G4-SOAK-3' } } })), /not a step-7 acceptance marker/);
        const d = accResult({ scenario: 'g3-untrusted-refused' });
        assert.match(check([{ file: 'd.json', result: { ...d, weakenedParams: [], gateValid: true } }]).problems.join('\n'), /never G3 gate evidence/);
        const twice = [{ file: 'a.json', result: base }, { file: 'b.json', result: { ...base } }];
        assert.match(check(twice).problems.join('\n'), /runId .* is also in a\.json/);
    });
});

describe('the evidence trees: g3-batch-check --tree runs the step-7 check; g4-accept-check alone', () => {
    const write = (root, rel, obj) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(obj)); };
    test('a step-7 D on S needs no batch.json (the G4 check covers it); without its acceptance record it does', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-tree-'));
        const d = accResult({ scenario: 'g3-untrusted-refused' });
        assert.equal(isG3AcceptanceOnService(d), true);
        write(root, 'g4/accept/d/result.json', d);
        assert.deepEqual(checkEvidenceTree(root, { g3Scenarios: ['g3-untrusted-refused'] }), []);
        const { g4Acceptance, ...plain } = d;
        assert.equal(isG3AcceptanceOnService(plain), false);
        assert.equal(isG3AcceptanceOnService({ ...d, weakenedParams: [] }), false, 'must be marked never-G3');
        assert.equal(isG3AcceptanceOnService({ ...d, driver: 'node d.mjs' }), false);
        void g4Acceptance;
        write(root, 'g4/accept/plain/result.json', plain);
        assert.match(checkEvidenceTree(root, { g3Scenarios: ['g3-untrusted-refused'] }).join('\n'), /a G3 result that no batch\.json covers/);
    });
    test('a forged step-7 record fails g3-batch-check --tree too; g4-accept-check reads the same tree', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-tree-'));
        const soak = accResult({ scenario: 'g4-soak-2h' });
        write(root, 'g4/accept/soak/result.json', { ...soak, g4Acceptance: { ...soak.g4Acceptance, fresh: { ok: false } } });
        assert.match(checkEvidenceTree(root, { g3Scenarios: [] }).join('\n'), /not recorded as fresh/);
        assert.match(checkAcceptanceTree(root).problems.join('\n'), /not recorded as fresh/);
        const ok = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-tree-'));
        for (const x of sixRuns()) write(ok, x.file, x.result);
        assert.deepEqual(checkAcceptanceTree(ok, { complete: GO }).problems, []);
        assert.deepEqual(parseCli(['--tree', 'd', '--complete', GO]), { tree: 'd', complete: GO });
        assert.equal(parseCli(['--complete', GO]), null);
        const cli = spawnSync(process.execPath, [path.join(repo, 'test/tools/g4-accept-check.mjs'), '--tree', ok, '--complete', GO], { encoding: 'utf8' });
        assert.equal(cli.status, 0, cli.stderr);
        assert.match(cli.stdout, new RegExp(`GO ${GO} is complete: every step-7 scenario passed`));
    });
    test('the repo\'s own evidence is consistent under the step-7 check', () => {
        const r = checkAcceptanceTree(path.join(repo, 'test', 'evidence'));
        assert.deepEqual(r.problems, []);
    });
});

describe('run.mjs end to end on the service path (fake ssh gate, fake test server, fake tag): g4-second-bot as step-7 run 6', () => {
    test('a complete set: g4Acceptance valid, the server facts read, no "not an acceptance run" reason; then without the marker on the same server: not-gate with (a), (d), (e), and both usage lines', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-e2e-'));
        const fwd = (p) => p.replace(/\\/g, '/');
        const bin = path.join(tmp, 'bin');
        const state = path.join(tmp, 'state');
        fs.mkdirSync(bin);
        fs.mkdirSync(state);
        const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
        // CI checkouts have no tags: the tag lookup is answered here, everything else goes to the real git.
        fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env bash\nif [[ "$*" == *"refs/tags/${TAG}^{commit}"* ]]; then echo ${SHA}; exit 0; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
        fs.writeFileSync(path.join(bin, 'ssh'), `#!/usr/bin/env bash\nexec "${fwd(process.execPath)}" "${fwd(path.join(repo, 'test/unit/fixtures/fake-cx23-ssh.mjs'))}" "$@"\n`, { mode: 0o755 });
        const ctl = path.join(tmp, 'ctl.sh');
        fs.writeFileSync(ctl, `#!/usr/bin/env bash\nexec "${fwd(process.execPath)}" "${fwd(path.join(repo, 'test/unit/fixtures/fake-ctl.mjs'))}" "$@"\n`, { mode: 0o755 });
        // The test server was created 10 minutes ago; its world is 3 minutes old (3600 ticks).
        fs.writeFileSync(path.join(state, 'server-create.json'), JSON.stringify({ server: { created: new Date(Date.now() - 600000).toISOString() } }));
        fs.writeFileSync(path.join(tmp, 'server.log'), '[10:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Starting minecraft server version 1.12.2\n'
            + '[10:00:20] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Done (20.1s)! For help, type "help" or "?"\n');
        const run = (out, extraEnv) => {
            const env = {
                PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
                TEST_SERVER_CTL: fwd(ctl), FAKE_CTL_DIR: tmp, TEST_SERVER_NAME: 'mcr-test-20261118-100000', TEST_SERVER_STATE_DIR: state,
                FAKE_CTL_SEED: String(G2_WORLD_SEED), FAKE_CTL_GAMETIME: '3600', FAKE_SSH_ACCOUNT: 'BOTTWO', FAKE_SSH_RELEASE: `${TAG}-${SHA.slice(0, 12)}`, ROTN_SERVICE_GO: `${GO}:bottwo:test-server-host-confirmed`, ...extraEnv,
            };
            for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
            const r = spawnSync(process.execPath, [path.join(repo, 'test/runner/run.mjs'), '--scenario', 'g4-second-bot', '--service', 'bottwo',
                '--param', 'bot=BOTTWO', '--param', 'stayS=1', '--param', 'leaveWaitS=3', '--param', 'pollMs=200', '--param', 'loginTimeoutMs=15000',
                '--param', 'consoleWaitS=0', '--out', out], { encoding: 'utf8', timeout: 90000, env });
            return { r, res: JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')) };
        };
        const a = run(path.join(tmp, 'out1'), { ROTN_G4_ACCEPT: `${GO}:6:${TAG}:gate-ctl-hashes-confirmed` });
        assert.equal(a.res.checksPassed, true, `${a.r.stderr}\n${JSON.stringify(a.res.checks, null, 1)}`);
        assert.equal(a.res.g4Acceptance.valid, true, JSON.stringify(a.res.g4Acceptance, null, 1));
        assert.deepEqual(a.res.g4Acceptance.release, { tag: TAG, sha12: SHA.slice(0, 12), commit: SHA, source: 'release line' });
        assert.deepEqual(a.res.g4Acceptance.marker, { goId: GO, run: 6, tag: TAG });
        assert.equal(a.res.weakenedParams.length, 1, a.res.weakenedParams.join(' | '));
        assert.match(a.res.weakenedParams[0], /^stayS=1/, 'only the shortened stay: no acceptance or "not an acceptance run" reason');
        assert.equal(a.r.status, 4);
        assert.match(a.r.stderr, /G4 step 7: a valid acceptance run \(run 6, GO G4-ACCEPT-20261118, rotn-v0\.1\.5\)/);
        assert.deepEqual(a.res.g4Acceptance.fresh.facts.starts, { starts: 1, files: 1 });
        assert.equal(a.res.g4Acceptance.fresh.facts.gametime, 3600);
        assert.match(a.res.g4Acceptance.fresh.why, /^fresh: no earlier run, join or scenario; started once; world 3600 of at most \d+ ticks$/);
        assert.deepEqual(check([{ file: 'out1/result.json', result: a.res }]).problems, []);

        const b = run(path.join(tmp, 'out2'), {});
        assert.equal(b.res.g4Acceptance.valid, false);
        assert.equal(failing(b.res.g4Acceptance), 'ade');
        assert.match(b.res.g4Acceptance.conditions.e.why, /g4-second-bot already ran on this server/);
        // Every run on the test server wrote its usage line, the marked one and the unmarked one.
        assert.deepEqual(parseLedger(fs.readFileSync(path.join(state, USAGE_FILE), 'utf8')).map((e) => [e.goId, e.run, e.scenario, e.runId, e.bot]),
            [[GO, 6, 'g4-second-bot', a.res.runId, 'service'], [null, null, 'g4-second-bot', b.res.runId, 'service']]);
        assert.ok(b.res.weakenedParams.includes(G4_SERVICE_NOT_GATE));
        assert.ok(b.res.weakenedParams.some((w) => /^not a G4 acceptance run: \(a\) no ROTN_G4_ACCEPT marker/.test(w)));
        assert.equal(b.res.gateValid, false);
        assert.deepEqual(check([{ file: 'out2/result.json', result: b.res }]).problems, []);
    });
});
