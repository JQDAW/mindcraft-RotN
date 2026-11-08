// The service adapter for G4's set-up S (test/scenarios/g4/PLAN.md): the bot is NOT spawned by the runner. It runs
// as mindcraft-rotn@<bot> on the CX23, and every action goes through the human's ssh alias for the restricted key,
// hard-wired as `cx23-ctl` (ADR 0009): `ssh cx23-ctl <verb> <bot> [--since TIME]`, which the CX23's forced command
// (the gate, deploy/cx23/mindcraft-rotn-ssh-gate.sh) turns into `sudo -n mindcraft-rotn-ctl ...`.
//
// Driver interface (lib/adapters.mjs driverProcess), so run.mjs, runner.mjs and startSession use it unchanged:
//   start(env)   `start <bot>`, sent asynchronously (env is ignored: the bot's environment is its env file on the
//                CX23, which only the human sets). Needs the run's GO marker for this unit (below). Returns a promise that never
//                rejects; a failure is kept in startError (and shown in output()). The journal is read from 60 s
//                before the call (clock skew), from the first "Starting mindcraft-rotn@<bot>.service" line on.
//   alive()      synchronous, from a cache: true while the start is in flight, then the unit's ActiveState (from
//                `metrics`) is active, activating (ExecStartPre or a systemd auto-restart) or reloading. After
//                STATUS_FAIL_LIMIT (3) failed refreshes in a row the state is 'unknown' (not alive), and stateUnknown
//                records when and why (run.mjs puts it in result.json). A stale
//                cache starts a background refresh and returns at once (no blocking call: timers, watchers and
//                the runner's 20 s signal race keep running).
//   output()     synchronous, from a cache refreshed the same way: the journal's messages since the start (the
//                "driver log"), plus a "[service] ..." line for a failed start or an incident.
//   exitCode()   always null (a unit has no exit code here); unitState() gives the ActiveState.
//   stop()       async: `stop <bot>` once a start was sent (also after a failed start: its state is unknown), then
//                waits for inactive and writes the journal to outFile. It uses the GO checked at that start and does not
//                re-read the marker (the cleanup must stop what was started); with no start sent it sends nothing.
//   needsStop()  true once a start was sent and no stop has finished (runner.mjs's cleanup uses it).
//   Also async: metrics(), journal(since), statusText(), refresh() (force both caches), settle() (await refreshes).
//
// Rules (lead, #371 review):
//   - The GO marker, per bot (lead, #401 review): start refuses unless the environment has
//     ROTN_SERVICE_GO=<GO id>:<unit>:test-server-host-confirmed naming THIS adapter's unit, set only under the lead's
//     written GO for that bot after the human confirmed that its env file's host is a disposable test server (ADR 0009).
//     A marker for another unit, or the old form without a unit, refuses before anything is sent. goId is recorded, and
//     the stop of a started unit uses it (never refused: the cleanup must stop what was started);
//     goStatus() reads the marker without sending anything (a scenario checks it before its own first command).
//   - argv only, never a shell string; the verb, the bot name (the ctl's rule) and a --since T form are checked first.
//     The keys are never read: ssh finds them through the alias's own config.
//   - Exit 126 is a GATE REFUSAL, an ADR 0009 incident: GateRefusal, never retried, kept in `incident` (run.mjs
//     reports it). Exit 2 is the ctl's own refusal, an ordinary error.
//   - ssh's own failure (255) is retried twice for the reads (status, metrics, journal) and for stop (idempotent in
//     systemd), never for start: a start is never sent twice. ssh's own stderr is never kept (it can name hosts and addresses): on 255 it is dropped, and otherwise
//     only the gate's and the ctl's own lines are kept, with any IPv4 or IPv6 address redacted.
import fs from 'node:fs';
import net from 'node:net';
import process from 'node:process';
import { execFile } from 'node:child_process';

export const HOST = 'cx23-ctl';
export const GATE_REFUSED = 126;
export const CTL_REFUSED = 2;
export const SSH_FAILED = 255;
export const BOT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SINCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z?$|^@\d{1,12}$/;
export const GO_RE = /^([A-Za-z0-9][A-Za-z0-9._-]{2,63}):([a-z0-9][a-z0-9-]{0,31}):test-server-host-confirmed$/;
const OLD_GO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}:test-server-host-confirmed$/;

/** The run's GO marker for one unit (lead, #401 review): {ok, goId} or {ok: false, why}. Pure: reads only env. */
export function goMarker(env, bot) {
    const raw = String(env?.ROTN_SERVICE_GO ?? '');
    const m = GO_RE.exec(raw);
    if (!m) {
        return { ok: false, why: `${OLD_GO_RE.test(raw) ? 'the GO marker has the old form without a unit' : 'no GO marker'}. Set ROTN_SERVICE_GO=<the lead's GO id>:${bot}:test-server-host-confirmed `
            + `only under the lead's written GO for ${bot}, after the human confirmed that its env file's host is a disposable test server (ADR 0009)` };
    }
    if (m[2] !== bot) return { ok: false, why: `the GO marker names ${m[2]}, not this unit ${bot}` };
    return { ok: true, goId: m[1] };
}
export const VERBS = ['status', 'start', 'stop', 'metrics', 'journal'];
// 255 (ssh's own failure) is retried for the reads and for stop, which systemd makes idempotent; never for start.
const RETRY_ON_255 = ['status', 'metrics', 'journal', 'stop'];
/** Background status refreshes that may fail in a row before alive() reports the state unknown (#371 review). */
export const STATUS_FAIL_LIMIT = 3;
/** BatchMode: never a prompt; no forwarding of any kind; -T: no pty (the key has `restrict` anyway). */
export const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-T'];
/** systemd ActiveStates in which the bot's unit is up or coming up (an auto-restart is 'activating'). */
export const ALIVE_STATES = ['active', 'activating', 'reloading'];
const SKEW_MS = 60 * 1000;

/** The gate refused a request: an ADR 0009 incident, never retried. */
export class GateRefusal extends Error {
    constructor(request, stderr) {
        super(`the CX23's ssh gate refused '${request}' (exit 126): an ADR 0009 incident; stop and report to the human${stderr ? ` (${stderr})` : ''}`);
        this.name = 'GateRefusal';
        this.exitCode = GATE_REFUSED;
        this.incident = true;
    }
}

/**
 * How a bot that is no longer up is named in a check's detail (#379 review): a spawned driver by its exit code, the
 * CX23 service by its unit's state (it has no exit code: exitCode() is null) and any start error.
 *   exitReason(bot) -> "code 1" | "unit failed; <start error>"
 *   exitedText(bot) -> "the driver exited with code 1" | "the service is down (unit failed; <start error>)"
 */
export function exitReason(bot) {
    if (bot?.kind !== 'service') return `code ${bot.exitCode()}`;
    return `unit ${bot.unitState?.() ?? 'state unknown'}${bot.startError ? `; ${bot.startError}` : ''}`;
}
export function exitedText(bot) {
    return bot?.kind === 'service' ? `the service is down (${exitReason(bot)})` : `the driver exited with ${exitReason(bot)}`;
}

/** The gate's T form, UTC, seconds kept: 2026-11-08T12:34:56Z. */
export const sinceStamp = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

/**
 * What may be kept of a call's stderr: nothing on ssh's own failure (255); otherwise only the gate's and the ctl's
 * own lines ("rotn-ssh-gate: ...", "mindcraft-rotn-ctl: ..."), with IPv4 and IPv6 addresses redacted. ssh's own lines
 * (warnings, host keys) can name the host and its address, so they are dropped and only counted.
 */
export function keptStderr(stderr, code) {
    if (code === SSH_FAILED) return '(ssh failed; its stderr is not kept)';
    const lines = String(stderr ?? '').split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
    // Each line is cut to 300 characters before the redaction runs (#379 review: bounded work on any input).
    const kept = lines.filter((l) => /^(rotn-ssh-gate|mindcraft-rotn-ctl): /.test(l)).map((l) => redactAddresses(l.slice(0, 300)));
    const dropped = lines.length - kept.length;
    return [kept.join(' | ').slice(0, 300), dropped ? `(${dropped} other stderr line${dropped === 1 ? '' : 's'} not kept)` : ''].filter(Boolean).join(' ');
}
export function redactAddresses(s) {
    // IPv6: one bounded run of hex digits and colons (at most 45, an address's longest form; the old unbounded pattern
    // backtracked for seconds on a long line, #379 review), and it counts only if node's own parser takes it as an
    // address, so a time such as 12:34:56 stays (#371 review).
    return s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
        .replace(/(?<![\w:])[0-9a-f:]{2,45}(?![\w:])/gi, (m) => (m.includes(':') && net.isIPv6(m) ? '<ip>' : m));
}

/**
 * One journal line of `mindcraft-rotn-ctl journal` (journalctl --output=short-iso --utc --no-hostname):
 * "2026-11-08T12:34:56+0000 node[123]: text" (or +00:00) -> {time, ident, msg}; null for anything else.
 */
export function parseJournalLine(l) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})? ([^\s:[]+)(?:\[\d+\])?: (.*)$/.exec(l);
    return m ? { time: m[1], ident: m[2], msg: m[3] } : null;
}

/** `metrics` output (KEY=value lines) -> an object; numbers stay numbers ('[not set]' and the like stay strings). */
export function parseMetrics(lines) {
    const o = {};
    for (const l of lines) {
        const m = /^([A-Za-z]+)=(.*)$/.exec(l);
        if (m) o[m[1]] = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
    }
    return o;
}

/** The journal from the FIRST "Starting mindcraft-rotn@<bot>.service" line on; nothing before it is this run's. */
export function linesFromStart(raw, bot) {
    const unit = `mindcraft-rotn@${bot}.service`;
    const parsed = raw.map(parseJournalLine).filter(Boolean);
    const i = parsed.findIndex((p) => p.ident === 'systemd' && (p.msg === `Starting ${unit}...` || p.msg.startsWith(`Starting ${unit} `)));
    return i === -1 ? [] : parsed.slice(i);
}

/** The default exec: async execFile, never a shell. -> {code (number, or null when ssh could not run), stdout, stderr}. */
export function execSsh(prog, argv, { timeout, maxBuffer }) {
    return new Promise((resolve) => {
        execFile(prog, argv, { encoding: 'utf8', timeout, maxBuffer, shell: false }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        });
    });
}

/**
 * serviceBot(bot, outFile, opts) -> the adapter above.
 * opts (tests): exec (async, (prog, argv, o) -> {code, stdout, stderr}), ssh ('ssh'), env (process.env), now, sleep,
 * statusRefreshMs (10 s), journalRefreshMs (15 s), stopWaitMs (60 s), retries (2), backoffMs (2 s), timeoutMs.
 */
export function serviceBot(bot, outFile, { exec = execSsh, ssh = 'ssh', env = process.env, now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)), statusRefreshMs = 10000, journalRefreshMs = 15000, stopWaitMs = 60000,
    retries = 2, backoffMs = 2000, timeoutMs = 120000 } = {}) {
    if (!BOT_RE.test(bot)) throw new Error(`service bot '${bot}': not a valid bot name (${BOT_RE})`);
    let since = null;
    let startSent = false;
    let stopped = false;
    let starting = null;          // the start's promise while in flight
    let startError = null;
    let incident = null;
    let lastError = null;
    let goId = null;
    let status = { at: -Infinity, state: null };
    let statusFails = 0;          // background status refreshes failed in a row
    let stateUnknown = null;      // {since, failures, lastError} once they reach STATUS_FAIL_LIMIT
    let journal = { at: -Infinity, lines: [], raw: [] };
    const inflight = new Set();

    const go = (what) => {
        const g = goMarker(env, bot);
        if (!g.ok) throw new Error(`service ${what} refused: ${g.why}`);
        goId = g.goId;
        return goId;
    };
    /** One request through the gate: argv only; GateRefusal on 126; 255 retried for the reads only. */
    const call = async (verb, extra = []) => {
        if (!VERBS.includes(verb)) throw new Error(`service: '${verb}' is not a gate verb`);
        if (extra.length && !(verb === 'journal' && extra.length === 2 && extra[0] === '--since' && SINCE_RE.test(extra[1]))) {
            throw new Error(`service: bad arguments for ${verb}: ${JSON.stringify(extra)}`);
        }
        const argv = [...SSH_OPTS, HOST, verb, bot, ...extra];
        const request = [verb, bot, ...extra].join(' ');
        let r;
        for (let attempt = 0; ; attempt++) {
            r = await exec(ssh, argv, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
            if (r.code === GATE_REFUSED) {
                const e = new GateRefusal(request, keptStderr(r.stderr, r.code));
                incident = incident ?? e.message;
                throw e;
            }
            if (r.code !== SSH_FAILED || !RETRY_ON_255.includes(verb) || attempt >= retries) break;
            await sleep(backoffMs * 2 ** attempt);
        }
        return { code: r.code, stdout: r.stdout ?? '', stderr: keptStderr(r.stderr, r.code), request };
    };
    const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
    // The exit code rides along (exitCode), so a caller can tell the ctl's refusal (CTL_REFUSED) apart.
    const failed = (r, what) => Object.assign(new Error(`service ${what}: '${r.request}' exited ${r.code ?? 'with no status (ssh did not run)'}${r.code === CTL_REFUSED ? ' (the ctl refused it)' : ''}${r.stderr ? `: ${r.stderr}` : ''}`), { exitCode: r.code ?? null });

    const metrics = async () => {
        const r = await call('metrics');
        if (r.code !== 0) throw failed(r, 'metrics');
        const m = parseMetrics(lines(r.stdout));
        status = { at: now(), state: m.ActiveState ?? null };
        statusFails = 0;
        return m;
    };
    const readJournal = async () => {
        if (!since) return [];
        const r = await call('journal', ['--since', since]);
        if (r.code !== 0) throw failed(r, 'journal');
        const raw = lines(r.stdout);
        journal = { at: now(), lines: linesFromStart(raw, bot).map((p) => p.msg), raw };
        return journal.lines;
    };
    /** A background refresh: errors are kept (incident, lastError), never thrown into a synchronous caller. */
    const background = (key, fn) => {
        if ([...inflight].some((x) => x.key === key)) return;
        const job = { key };
        job.p = fn().catch((e) => { lastError = String(e?.message ?? e); if (e?.incident) incident = incident ?? e.message; }).finally(() => inflight.delete(job));
        inflight.add(job);
    };
    const writeLog = () => {
        if (outFile) fs.writeFileSync(outFile, journal.raw.join('\n') + (journal.raw.length ? '\n' : ''));
    };
    const extraLines = () => [startError && `[service] start failed: ${startError}`, incident && `[service] INCIDENT: ${incident}`].filter(Boolean);

    return {
        kind: 'service',
        bot,
        host: HOST,
        get goId() { return goId; },
        goStatus: () => goMarker(env, bot),
        get incident() { return incident; },
        get startError() { return startError; },
        get lastError() { return lastError; },
        get stateUnknown() { return stateUnknown; },
        start() {
            go('start');
            since = sinceStamp(now() - SKEW_MS);
            startSent = true;      // before the call: a start that fails or times out may still have reached systemd
            stopped = false;
            startError = null;
            status = { at: -Infinity, state: null };
            journal = { at: -Infinity, lines: [], raw: [] };
            starting = call('start').then((r) => {
                if (r.code !== 0) throw failed(r, 'start');
                status = { at: -Infinity, state: 'activating' };
            }).catch((e) => {
                startError = `${String(e?.message ?? e)} (the unit's state is unknown)`;
            }).finally(() => { starting = null; });
            return starting;
        },
        alive() {
            if (!startSent || stopped) return false;
            if (starting) return true;
            if (startError) return false;
            if (now() - status.at >= statusRefreshMs) {
                background('status', () => metrics().catch((e) => {
                    // After STATUS_FAIL_LIMIT failures in a row the state is unknown, never a stale "active" (#371 review).
                    if (++statusFails >= STATUS_FAIL_LIMIT) {
                        stateUnknown = stateUnknown ?? { since: new Date(now()).toISOString(), failures: statusFails, lastError: String(e?.message ?? e) };
                        stateUnknown.failures = statusFails;
                        status = { at: now(), state: 'unknown' };
                    }
                    throw e;
                }));
            }
            return status.state === null || ALIVE_STATES.includes(status.state);
        },
        unitState: () => status.state,
        exitCode: () => null,
        exitSignal: () => null,
        output() {
            if (since && !starting && now() - journal.at >= journalRefreshMs) background('journal', readJournal);
            return [...journal.lines, ...extraLines()];
        },
        needsStop: () => startSent && !stopped,
        metrics,
        async refresh() { await this.settle(); if (startSent) { await metrics(); await readJournal(); } },
        async settle() { if (starting) await starting; await Promise.all([...inflight].map((j) => j.p)); },
        async journal(s = since) {
            if (s && !SINCE_RE.test(s)) throw new Error(`service journal: bad --since '${s}'`);
            const r = await call('journal', s ? ['--since', s] : []);
            if (r.code !== 0) throw failed(r, 'journal');
            return lines(r.stdout);
        },
        /** `status <bot>`: systemctl's own text (it prints the last journal lines too) and its exit code (0 active, 3 not). */
        async statusText() {
            const r = await call('status');
            if (r.code !== 0 && r.code !== 3) throw failed(r, 'status');
            return { code: r.code, lines: lines(r.stdout) };
        },
        async stop() {
            // No start sent: nothing to stop, nothing sent. Once a start went out, the stop uses the GO and the unit checked
            // at that start (goId, bot) and never re-reads the marker, so the runner's cleanup always stops a unit it
            // started, whatever the environment says by then (#401 re-review).
            if (!startSent || stopped) return;
            if (starting) await starting;
            const r = await call('stop');
            if (r.code !== 0) throw failed(r, 'stop');
            const end = now() + stopWaitMs;
            let m = await metrics();
            while (ALIVE_STATES.includes(m.ActiveState) && now() < end) { await sleep(2000); m = await metrics(); }
            if (ALIVE_STATES.includes(m.ActiveState)) throw new Error(`service stop: ${bot} still ${m.ActiveState} ${stopWaitMs / 1000}s after 'stop'`);
            stopped = true;
            try { await readJournal(); } catch (e) { lastError = String(e?.message ?? e); }
            writeLog();
        },
        since: () => since,
    };
}
