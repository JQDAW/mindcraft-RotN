// The service adapter for G4's set-up S (test/scenarios/g4/PLAN.md): the bot is NOT spawned by the runner. It runs
// as mindcraft-rotn@<bot> on the CX23, and every action goes through the human's ssh alias for the restricted key,
// hard-wired as `cx23-ctl` (ADR 0009): `ssh cx23-ctl <verb> <bot> [--since TIME]`, which the CX23's forced command
// (the gate, deploy/cx23/mindcraft-rotn-ssh-gate.sh) turns into `sudo -n mindcraft-rotn-ctl ...`.
//
// Driver interface (lib/adapters.mjs driverProcess), so run.mjs, runner.mjs and startSession use it unchanged:
//   start(env)   `start <bot>`, sent asynchronously (env is ignored: the bot's environment is its env file on the
//                CX23, which only the human sets). Needs the run's GO marker (below). Returns a promise that never
//                rejects; a failure is kept in startError (and shown in output()). The journal is read from 60 s
//                before the call (clock skew), from the first "Starting mindcraft-rotn@<bot>.service" line on.
//   alive()      synchronous, from a cache: true while the start is in flight, then the unit's ActiveState (from
//                `metrics`) is active, activating (ExecStartPre or a systemd auto-restart) or reloading. A stale
//                cache starts a background refresh and returns at once (no blocking call: timers, watchers and
//                the runner's 20 s signal race keep running).
//   output()     synchronous, from a cache refreshed the same way: the journal's messages since the start (the
//                "driver log"), plus a "[service] ..." line for a failed start or an incident.
//   exitCode()   always null (a unit has no exit code here); unitState() gives the ActiveState.
//   stop()       async: `stop <bot>` once a start was sent (also after a failed start: its state is unknown), then
//                waits for inactive and writes the journal to outFile. Needs the GO marker too.
//   needsStop()  true once a start was sent and no stop has finished (runner.mjs's cleanup uses it).
//   Also async: metrics(), journal(since), statusText(), refresh() (force both caches), settle() (await refreshes).
//
// Rules (lead, #371 review):
//   - The GO marker: start and stop refuse unless the environment has ROTN_SERVICE_GO=<GO id>:test-server-host-confirmed,
//     set only under the lead's written GO after the human confirmed that the env file's host is a disposable test
//     server (ADR 0009). goId is recorded.
//   - argv only, never a shell string; the verb, the bot name (the ctl's rule) and a --since T form are checked first.
//     The keys are never read: ssh finds them through the alias's own config.
//   - Exit 126 is a GATE REFUSAL, an ADR 0009 incident: GateRefusal, never retried, kept in `incident` (run.mjs
//     reports it). Exit 2 is the ctl's own refusal, an ordinary error.
//   - ssh's own failure (255) is retried twice for the reads only (status, metrics, journal), never for start or
//     stop. ssh's own stderr is never kept (it can name hosts and addresses): on 255 it is dropped, and otherwise
//     only the gate's and the ctl's own lines are kept, with any IPv4 or IPv6 address redacted.
import fs from 'node:fs';
import process from 'node:process';
import { execFile } from 'node:child_process';

export const HOST = 'cx23-ctl';
export const GATE_REFUSED = 126;
export const CTL_REFUSED = 2;
export const SSH_FAILED = 255;
export const BOT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SINCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z?$|^@\d{1,12}$/;
export const GO_RE = /^([A-Za-z0-9][A-Za-z0-9._-]{2,63}):test-server-host-confirmed$/;
export const VERBS = ['status', 'start', 'stop', 'metrics', 'journal'];
const READS = ['status', 'metrics', 'journal'];
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
    const kept = lines.filter((l) => /^(rotn-ssh-gate|mindcraft-rotn-ctl): /.test(l)).map(redactAddresses);
    const dropped = lines.length - kept.length;
    return [kept.join(' | ').slice(0, 300), dropped ? `(${dropped} other stderr line${dropped === 1 ? '' : 's'} not kept)` : ''].filter(Boolean).join(' ');
}
export function redactAddresses(s) {
    return s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
        .replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi, (m) => (/[0-9a-f]/i.test(m) ? '<ip>' : m));
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
    let journal = { at: -Infinity, lines: [], raw: [] };
    const inflight = new Set();

    const go = (what) => {
        const m = GO_RE.exec(String(env.ROTN_SERVICE_GO ?? ''));
        if (!m) {
            throw new Error(`service ${what} refused: no GO marker. Set ROTN_SERVICE_GO=<the lead's GO id>:test-server-host-confirmed only under `
                + `the lead's written GO, after the human confirmed that the env file's host is a disposable test server (ADR 0009)`);
        }
        goId = m[1];
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
            if (r.code !== SSH_FAILED || !READS.includes(verb) || attempt >= retries) break;
            await sleep(backoffMs * 2 ** attempt);
        }
        return { code: r.code, stdout: r.stdout ?? '', stderr: keptStderr(r.stderr, r.code), request };
    };
    const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
    const failed = (r, what) => new Error(`service ${what}: '${r.request}' exited ${r.code ?? 'with no status (ssh did not run)'}${r.code === CTL_REFUSED ? ' (the ctl refused it)' : ''}${r.stderr ? `: ${r.stderr}` : ''}`);

    const metrics = async () => {
        const r = await call('metrics');
        if (r.code !== 0) throw failed(r, 'metrics');
        const m = parseMetrics(lines(r.stdout));
        status = { at: now(), state: m.ActiveState ?? null };
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
        get incident() { return incident; },
        get startError() { return startError; },
        get lastError() { return lastError; },
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
            if (now() - status.at >= statusRefreshMs) background('status', metrics);
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
            if (!startSent || stopped) return;
            go('stop');
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
