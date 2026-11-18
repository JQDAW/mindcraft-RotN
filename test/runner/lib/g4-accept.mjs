// G4 step 7: when a run counts as G4 evidence (the lead's rule of 2026-11-08; test/scenarios/g4/PLAN.md, step 7).
//
// A run is a G4 acceptance run only if ALL of these hold. run.mjs checks each one and records it in result.json under
// g4Acceptance; any missing one makes the run not-gate, with the reason:
//   (a) it is one of the six step-7 runs, started under a written lead GO named as acceptance. That GO is passed as a
//       per-run marker next to ROTN_SERVICE_GO:
//         ROTN_G4_ACCEPT=<GO id>:<run 1-6>:<rotn-v tag>:gate-ctl-hashes-confirmed
//       The GO id must say ACCEPT and be the same GO as ROTN_SERVICE_GO's, and the scenario must belong to that run
//       (STEP7_RUNS).
//   (b) the bot is the S service through cx23-ctl (run.mjs --service), never a spawned driver (T).
//   (c) the CX23 runs a rotn-v release: the tag and its commit are READ from the unit's journal for this run (the
//       bot's "[release] <tag>-<sha12>" start line, or the release paths in its journal lines), never assumed; the
//       tag must resolve to a commit in this repo that starts with the sha12 it shows. That all six runs share one
//       commit is checked over the set (checkAcceptanceResults).
//   (d) the human confirmed that the installed gate and ctl SHA-256 match the repo at that tag, which the lead
//       records in STATUS. The runner cannot verify hashes: it takes the marker's attestation, and the marker's tag
//       must be the tag read in (c).
//   (e) the test server is fresh and its host confirmed for this run. Host: ROTN_SERVICE_GO's
//       test-server-host-confirmed for this unit. Fresh: no other run used it. The test server's ledger
//       (<TEST_SERVER_STATE_DIR>/g4-accept.jsonl, one line per acceptance start) names no other GO or run. In its
//       log since its last start, nobody joined and no scenario began, except earlier scenarios of this same step-7
//       run (run 5 is three scenarios in one session).
//
// A failed check in a valid acceptance run is still evidence: the failure stays in the evidence (the G3 rule), so
// "valid" says whether the run counts, and pass says how it went.
import { goMarker, HOST, parseJournalLine } from './service.mjs';

/** The six step-7 runs and the scenarios each may run (PLAN.md step 7; run 5 is one session with the trusted player). */
export const STEP7_RUNS = Object.freeze({
    1: Object.freeze(['g4-soak-2h']),
    2: Object.freeze(['g4-service-reconnect']),
    3: Object.freeze(['g4-death-report']),
    4: Object.freeze(['g3-untrusted-refused']),
    5: Object.freeze(['g4-control-commands', 'g3-task-preempts-agenda', 'g4-restart-persistence']),
    6: Object.freeze(['g4-second-bot']),
});
export const STEP7_SCENARIOS = Object.freeze(Object.values(STEP7_RUNS).flat());
/** The run a step-7 scenario belongs to (each scenario is in exactly one run). */
export const runOf = (scenarioId) => Number(Object.keys(STEP7_RUNS).find((k) => STEP7_RUNS[k].includes(scenarioId)) ?? NaN);

export const ACCEPT_RE = /^([A-Za-z0-9][A-Za-z0-9._-]{2,63}):([1-6]):(rotn-v\d+\.\d+\.\d+):gate-ctl-hashes-confirmed$/;
/** A GO named as acceptance: its id says ACCEPT (e.g. G4-ACCEPT-20261120). */
export const ACCEPT_GO_RE = /ACCEPT/;
export const SERVICE_DRIVER_RE = /^service ([a-z0-9][a-z0-9-]{0,31}) via cx23-ctl$/;

/** ROTN_G4_ACCEPT -> {ok, goId, run, tag} or {ok: false, why}. Pure: reads only env. */
export function acceptMarker(env) {
    const raw = env?.ROTN_G4_ACCEPT;
    if (raw === undefined || raw === '') return { ok: false, present: false, why: 'no ROTN_G4_ACCEPT marker (only the six step-7 runs, under a written lead GO named as acceptance, set it)' };
    const m = ACCEPT_RE.exec(String(raw));
    if (!m) return { ok: false, present: true, why: 'ROTN_G4_ACCEPT is not <GO id>:<run 1-6>:<rotn-v tag>:gate-ctl-hashes-confirmed' };
    return { ok: true, present: true, goId: m[1], run: Number(m[2]), tag: m[3] };
}

// The release a unit runs: deploy.sh names each release releases/<tag>-<sha12> (deploy/cx23/deploy.sh).
const RELEASE_LINE_RE = /^\[release\] (rotn-v\d+\.\d+\.\d+)-([0-9a-f]{12})$/;
const RELEASE_PATH_RE = /\/opt\/mindcraft-rotn\/releases\/(rotn-v\d+\.\d+\.\d+)-([0-9a-f]{12})\//g;

/**
 * The release the unit ran, read from its journal for this run (raw journal lines, or their messages):
 * {tag, sha12, source: 'release line' | 'release paths', seen} or {tag: null, why}. The bot's "[release]" start line is
 * preferred; otherwise the release paths in any line (stack traces). Two different releases in one run: none (why).
 */
export function releaseFromJournal(lines) {
    const fromLine = new Set();
    const fromPaths = new Set();
    for (const l of lines ?? []) {
        const msg = parseJournalLine(l)?.msg ?? String(l);
        const m = RELEASE_LINE_RE.exec(msg);
        if (m) fromLine.add(`${m[1]}-${m[2]}`);
        for (const p of String(l).matchAll(RELEASE_PATH_RE)) fromPaths.add(`${p[1]}-${p[2]}`);
    }
    const all = new Set([...fromLine, ...fromPaths]);
    if (all.size > 1) return { tag: null, why: `the journal shows more than one release: ${[...all].sort().join(', ')}` };
    if (!all.size) return { tag: null, why: 'no release in the journal (no "[release] <tag>-<sha12>" line and no release path)' };
    const [name] = all;
    const i = name.lastIndexOf('-');
    return { tag: name.slice(0, i), sha12: name.slice(i + 1), source: fromLine.size ? 'release line' : 'release paths', seen: name };
}

const SERVER_START_RE = /Starting minecraft server version /;
const MARKER_RE = /scenario-([0-9a-z]+-[0-9a-f]{6})-begin/;
const JOIN_RE = /\]: (\S+) joined the game$/;

/**
 * Is the test server fresh for this step-7 run? ledger: the parsed g4-accept.jsonl entries ({goId, run, runId, ...});
 * logLines: the server log (null if it could not be read). Earlier entries, markers and joins are allowed only from
 * this same GO and run. -> {ok, why}
 */
export function freshServer({ server, stateDir, ledger, logLines, goId, run }) {
    if (!server) return { ok: false, why: 'no TEST_SERVER_NAME: not a test server from deploy/test-server.sh' };
    if (!stateDir) return { ok: false, why: 'no TEST_SERVER_STATE_DIR: the test server\'s ledger cannot be read' };
    if (!Array.isArray(ledger)) return { ok: false, why: 'the test server\'s ledger cannot be read' };
    const other = ledger.find((e) => e?.goId !== goId || e?.run !== run);
    if (other) return { ok: false, why: `not fresh: the ledger shows an earlier acceptance start of another run (${other?.goId ?? '?'} run ${other?.run ?? '?'}, ${other?.scenario ?? '?'})` };
    if (!Array.isArray(logLines)) return { ok: false, why: 'the test server\'s log could not be read' };
    let start = -1;
    logLines.forEach((l, i) => { if (SERVER_START_RE.test(l)) start = i; });
    if (start < 0) return { ok: false, why: 'the server\'s start line is not in the fetched log, so its history cannot be checked' };
    const sameRun = new Set(ledger.map((e) => e.runId));
    let opened = false;   // an earlier scenario of this same run began: joins after it are that scenario's
    for (const l of logLines.slice(start + 1)) {
        const mk = MARKER_RE.exec(l);
        if (mk) {
            if (!sameRun.has(mk[1])) return { ok: false, why: `not fresh: an earlier scenario (${mk[1]}) ran on this server outside this acceptance run` };
            opened = true;
            continue;
        }
        const j = JOIN_RE.exec(l);
        if (j && !opened) return { ok: false, why: `not fresh: ${j[1]} joined before this acceptance run began` };
    }
    return { ok: true, why: ledger.length ? `fresh: only earlier scenarios of this run (${ledger.length}) used it` : 'fresh: no join and no scenario since the server started' };
}

/** Each line of a ledger file -> its entry; null if any line is not JSON (fail closed). */
export function parseLedger(text) {
    try {
        return String(text ?? '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch {
        return null;
    }
}

/**
 * The rule, from what the runner saw. -> the g4Acceptance record: {marker, unit, release, fresh, conditions: {a..e:
 * {ok, why}}, valid, reasons}. resolveTag(tag) -> the full commit of the local tag, or null.
 */
export function evaluateAcceptance({ env, scenarioId, botKind, unit, driver, release, fresh, resolveTag }) {
    const mk = acceptMarker(env);
    const svc = unit ? goMarker(env, unit) : { ok: false, why: 'no service unit' };
    const c = {};
    {
        const why = [];
        if (!mk.ok) why.push(mk.why);
        else {
            if (!ACCEPT_GO_RE.test(mk.goId)) why.push(`the GO id ${mk.goId} is not named as acceptance (it must say ACCEPT)`);
            if (!STEP7_RUNS[mk.run]?.includes(scenarioId)) why.push(`${scenarioId} is not one of step-7 run ${mk.run}'s scenarios (${STEP7_RUNS[mk.run]?.join(', ')})`);
            if (svc.ok && svc.goId !== mk.goId) why.push(`ROTN_SERVICE_GO is GO ${svc.goId}, not the acceptance GO ${mk.goId}`);
        }
        c.a = { ok: !why.length, why: why.join('; ') || `step-7 run ${mk.run} under GO ${mk.goId}` };
    }
    {
        const ok = botKind === 'service' && Boolean(unit) && driver === `service ${unit} via ${HOST}`;
        c.b = { ok, why: ok ? `the S service ${unit} via ${HOST}` : 'the bot is not the S service through cx23-ctl (a spawned driver is set-up T, never G4 evidence)' };
    }
    let commit = null;
    {
        const why = [];
        if (!release?.tag) why.push(release?.why ?? 'the release was not read');
        else {
            commit = resolveTag(release.tag);
            if (!commit) why.push(`the tag ${release.tag} is not in this repo (fetch the tags)`);
            else if (!commit.startsWith(release.sha12)) why.push(`the tag ${release.tag} is ${commit.slice(0, 12)} here, but the CX23 runs ${release.sha12}`);
        }
        c.c = { ok: !why.length, why: why.join('; ') || `${release.tag} (${commit}), read from the journal (${release.source})` };
    }
    {
        const why = [];
        if (!mk.ok) why.push('no gate/ctl hash confirmation (it is part of ROTN_G4_ACCEPT)');
        else if (release?.tag && mk.tag !== release.tag) why.push(`the hashes were confirmed at ${mk.tag}, but the CX23 runs ${release.tag}`);
        else if (!release?.tag) why.push(`the hashes were confirmed at ${mk.tag}, but the running release was not read`);
        c.d = { ok: !why.length, why: why.join('; ') || `the human confirmed the gate and ctl hashes at ${mk.tag} (GO ${mk.goId}; not verified by the runner)` };
    }
    {
        const why = [];
        if (!svc.ok) why.push(`the env host is not confirmed for this run: ${svc.why}`);
        if (!fresh?.ok) why.push(fresh?.why ?? 'freshness not checked');
        c.e = { ok: !why.length, why: why.join('; ') || `host confirmed (ROTN_SERVICE_GO); ${fresh.why}` };
    }
    const reasons = Object.entries(c).filter(([, v]) => !v.ok).map(([k, v]) => `(${k}) ${v.why}`);
    return {
        marker: mk.ok ? { goId: mk.goId, run: mk.run, tag: mk.tag } : null,
        unit: unit ?? null,
        release: release?.tag ? { tag: release.tag, sha12: release.sha12, commit, source: release.source } : null,
        fresh: fresh ?? null,
        conditions: c,
        valid: reasons.length === 0,
        reasons,
    };
}

/** The reason run.mjs adds when a run is not a valid acceptance run. */
export const notAcceptanceReason = (acc) => `not a G4 acceptance run: ${acc.reasons.join('; ')}`;

// ---- The evidence check over a set of results (test/tools/g4-accept-check.mjs; g3-batch-check.mjs --tree runs it) ----

/** A result that claims to be (or tried to be) a step-7 acceptance run: it carries the runner's g4Acceptance record. */
export const isAcceptanceRecord = (r) => Boolean(r && typeof r === 'object' && !Array.isArray(r) && r.g4Acceptance && typeof r.g4Acceptance === 'object');

/** Did a valid acceptance run pass? A G4 scenario: result.pass. A G3 scenario on S: its checks, with no weakening but the S one. */
export function acceptancePassed(r, g3OnServiceReason) {
    if (r.gate === 'G4') return r.pass === true;
    return r.checksPassed === true && (r.weakenedParams ?? []).every((w) => w === g3OnServiceReason);
}

/**
 * The step-7 evidence check. results: [{file, result}]. Every G4 gate pass must be a valid acceptance run; every
 * acceptance record must be self-consistent; a valid one must hold its conditions in what it recorded; per GO, one tag
 * and one commit, and no test server used by two step-7 runs. complete: a GO id whose six runs must all be there and
 * have passed (the G4 claim). -> {problems, summary}
 */
export function checkAcceptanceResults(results, { complete = null, g3OnServiceReason } = {}) {
    const problems = [];
    const byGo = new Map();
    const runIds = new Map();
    for (const { file, result: r } of results) {
        if (!r || typeof r !== 'object') continue;
        if (r.gate === 'G4' && (r.pass === true || r.gateValid === true) && r.g4Acceptance?.valid !== true) {
            problems.push(`${file}: a G4 result marked gate-valid or passed that is not a valid step-7 acceptance run`);
        }
        if (!isAcceptanceRecord(r)) continue;
        const a = r.g4Acceptance;
        const conds = ['a', 'b', 'c', 'd', 'e'].map((k) => a.conditions?.[k]);
        if (conds.some((x) => !x || typeof x.ok !== 'boolean')) { problems.push(`${file}: the g4Acceptance record lacks a condition (a-e)`); continue; }
        const allOk = conds.every((x) => x.ok);
        if (a.valid !== allOk || (allOk !== (Array.isArray(a.reasons) && a.reasons.length === 0))) {
            problems.push(`${file}: g4Acceptance.valid does not follow its conditions`);
            continue;
        }
        if (!a.valid) {
            if (r.gate === 'G4' && r.gateValid !== false) problems.push(`${file}: not a valid acceptance run, yet not marked not-gate`);
            continue;
        }
        const m = a.marker ?? {};
        const why = [];
        if (!ACCEPT_RE.test(`${m.goId}:${m.run}:${m.tag}:gate-ctl-hashes-confirmed`) || !ACCEPT_GO_RE.test(String(m.goId))) why.push('its marker is not a step-7 acceptance marker');
        if (!STEP7_RUNS[m.run]?.includes(r.scenario)) why.push(`${r.scenario} is not a scenario of step-7 run ${m.run}`);
        if (r.service?.goId !== m.goId) why.push(`its service GO (${r.service?.goId ?? 'none'}) is not the acceptance GO ${m.goId}`);
        const d = SERVICE_DRIVER_RE.exec(String(r.driver ?? ''));
        if (!d || d[1] !== a.unit) why.push('its driver is not the S service through cx23-ctl');
        const rel = a.release ?? {};
        if (rel.tag !== m.tag) why.push(`its release ${rel.tag ?? 'none'} is not the confirmed tag ${m.tag}`);
        if (!/^[0-9a-f]{40,64}$/.test(String(rel.commit)) || !/^[0-9a-f]{12}$/.test(String(rel.sha12)) || !rel.commit.startsWith(rel.sha12)) why.push('its release commit is missing or does not match what the journal showed');
        if (a.fresh?.ok !== true) why.push('its test server is not recorded as fresh');
        if (typeof r.server !== 'string' || !r.server) why.push('it names no test server');
        if (r.gate === 'G3' && (r.gateValid !== false || !(r.weakenedParams ?? []).includes(g3OnServiceReason))) why.push('a G3 scenario on S that is not marked "never G3 gate evidence"');
        if (r.runId && runIds.has(r.runId)) why.push(`its runId ${r.runId} is also in ${runIds.get(r.runId)}`);
        runIds.set(r.runId, file);
        if (why.length) { problems.push(`${file}: marked a valid acceptance run, but ${why.join('; ')}`); continue; }
        const g = byGo.get(m.goId) ?? [];
        g.push({ file, r, run: m.run, passed: acceptancePassed(r, g3OnServiceReason) });
        byGo.set(m.goId, g);
    }
    const summary = [];
    for (const [goId, runs] of byGo) {
        const commits = new Set(runs.map((x) => x.r.g4Acceptance.release.commit));
        if (commits.size > 1) problems.push(`GO ${goId}: the acceptance runs are on more than one commit (${[...commits].map((c) => c.slice(0, 12)).join(', ')}); all six must share one`);
        const tags = new Set(runs.map((x) => x.r.g4Acceptance.release.tag));
        if (tags.size > 1) problems.push(`GO ${goId}: the acceptance runs are on more than one tag (${[...tags].join(', ')})`);
        const serverRuns = new Map();
        for (const x of runs) serverRuns.set(x.r.server, new Set([...(serverRuns.get(x.r.server) ?? []), x.run]));
        for (const [s, ks] of serverRuns) if (ks.size > 1) problems.push(`GO ${goId}: the test server ${s} was used by step-7 runs ${[...ks].sort().join(' and ')}; each run needs a fresh server`);
        const seen = STEP7_SCENARIOS.map((id) => {
            const of = runs.filter((x) => x.r.scenario === id);
            return `${id} ${of.length ? of.map((x) => (x.passed ? 'PASS' : 'FAIL')).join('/') : 'missing'}`;
        });
        summary.push(`GO ${goId} on ${[...tags].join(',')} (${[...commits].map((c) => c.slice(0, 12)).join(',')}): ${seen.join(', ')}`);
    }
    if (complete !== null) {
        const runs = byGo.get(complete) ?? [];
        for (const id of STEP7_SCENARIOS) {
            const of = runs.filter((x) => x.r.scenario === id);
            if (!of.length) problems.push(`GO ${complete}: step-7 run ${runOf(id)} has no valid acceptance result for ${id}`);
            else if (!of.some((x) => x.passed)) problems.push(`GO ${complete}: ${id} (step-7 run ${runOf(id)}) did not pass in any valid acceptance run`);
        }
    }
    return { problems, summary };
}

/**
 * Before a step-7 scenario starts (run.mjs): is the test server fresh, and, under a well-formed marker, the ledger
 * entry for this start. server: the ctl adapter (log, logRotated); env: TEST_SERVER_NAME, TEST_SERVER_STATE_DIR,
 * ROTN_G4_ACCEPT. The entry is written before the scenario runs, so a killed run still marks the server used.
 * -> {fresh: {ok, why}, ledgerFile}
 */
export function startAcceptance({ server, env, scenarioId, runId, logTail = 20000, now = () => new Date(), fsImpl, pathImpl }) {
    const mk = acceptMarker(env);
    const stateDir = env?.TEST_SERVER_STATE_DIR || null;
    const ledgerFile = stateDir ? pathImpl.join(stateDir, 'g4-accept.jsonl') : null;
    let ledger = null;
    if (ledgerFile) {
        try {
            ledger = fsImpl.existsSync(ledgerFile) ? parseLedger(fsImpl.readFileSync(ledgerFile, 'utf8')) : [];
        } catch {
            ledger = null;
        }
    }
    let logLines = null;
    try {
        logLines = server.log(logTail);
        // log4j rolls latest.log over at 00:00 UTC: then the server's start line is in the newest rolled-over file.
        if (!logLines.some((l) => SERVER_START_RE.test(l)) && typeof server.logRotated === 'function') logLines = server.logRotated(logTail)?.lines ?? logLines;
    } catch {
        logLines = null;
    }
    let fresh = freshServer({ server: env?.TEST_SERVER_NAME || null, stateDir, ledger, logLines, goId: mk.goId ?? null, run: mk.run ?? null });
    if (mk.ok && ledgerFile && ledger) {
        try {
            fsImpl.appendFileSync(ledgerFile, JSON.stringify({ goId: mk.goId, run: mk.run, runId, scenario: scenarioId, at: now().toISOString() }) + '\n');
        } catch (e) {
            fresh = { ok: false, why: `the test server's ledger could not be written (${e.code ?? e.message})` };
        }
    }
    return { fresh, ledgerFile };
}
