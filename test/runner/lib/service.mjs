// The service adapter for G4's set-up S (test/scenarios/g4/PLAN.md): the bot is NOT spawned by the runner. It runs
// as mindcraft-rotn@<bot> on the CX23, and every action goes through the human's ssh alias for the restricted key
// (ADR 0009): `ssh cx23-ctl <verb> <bot> [--since TIME]`, which the CX23's forced command (the gate,
// deploy/cx23/mindcraft-rotn-ssh-gate.sh) turns into `sudo -n mindcraft-rotn-ctl ...`.
//
// The same interface as driverProcess (lib/adapters.mjs), so run.mjs and startSession use it unchanged:
//   start(env)   `start <bot>` (env is ignored: the bot's environment is its env file on the CX23, which only the
//                human sets; ADR 0009). The journal is read from 60 s before this call (clock skew), from the
//                first "Starting mindcraft-rotn@<bot>.service" line on.
//   alive()      the unit's ActiveState from `metrics <bot>`: active, activating (ExecStartPre, or a systemd
//                auto-restart) or reloading. Not `status`'s exit code, which is 3 for an activating unit too.
//                Cached for statusRefreshMs.
//   output()     the journal's messages since the start (the "driver log"), cached for journalRefreshMs.
//   exitCode()   null while alive, else the unit's ActiveState ('inactive', 'failed', ...) from `metrics`.
//   stop()       `stop <bot>`, then waits until status says inactive; writes the last journal to outFile.
//   metrics()    `metrics <bot>` as {MemoryCurrent, MemoryPeak, NRestarts, ActiveState}.
// Rules:
//   - argv only, never a shell string: ssh gets [...SSH_OPTS, host, verb, bot, ...]. The verb is one of the gate's,
//     the bot matches the ctl's name rule and a --since time is the gate's T form, all checked here first.
//   - The keys are never read: ssh finds them through the alias's own config.
//   - Exit 126 is a GATE REFUSAL, an ADR 0009 incident: it throws a GateRefusal at once (no retry), which ends the
//     scenario; report it to the human. (126 is also the shell's code for a gate it cannot execute: the gate's
//     fixed stderr line tells a real refusal apart.) Exit 2 is the ctl's own refusal, an ordinary error.
//   - ssh's own failure (255: no connection) is retried twice; start and stop are safe to repeat (systemd).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export const GATE_REFUSED = 126;
export const CTL_REFUSED = 2;
export const SSH_FAILED = 255;
export const BOT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SINCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z?$|^@\d{1,12}$/;
export const VERBS = ['status', 'start', 'stop', 'metrics', 'journal'];
/** BatchMode: never a password or passphrase prompt; -T: no pty (the key has `restrict` anyway). */
export const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-T'];
const SKEW_MS = 60 * 1000;
/** systemd ActiveStates in which the bot's unit is up or coming up (an auto-restart is 'activating'). */
export const ALIVE_STATES = ['active', 'activating', 'reloading'];

/** The gate refused a request: an ADR 0009 incident, never retried. */
export class GateRefusal extends Error {
    constructor(request, stderr) {
        super(`the CX23's ssh gate refused '${request}' (exit 126): an ADR 0009 incident; stop and report to the human${stderr ? ` (${stderr.trim().slice(0, 200)})` : ''}`);
        this.name = 'GateRefusal';
        this.exitCode = GATE_REFUSED;
        this.incident = true;
    }
}

/** The gate's T form, UTC, seconds kept: 2026-11-08T12:34:56Z. */
export const sinceStamp = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

/**
 * One journal line of `mindcraft-rotn-ctl journal` (journalctl --output=short-iso --utc --no-hostname):
 * "2026-11-08T12:34:56+0000 node[123]: text" (or +00:00) -> {time, ident, msg}; null for anything else
 * (journalctl's "-- No entries --", a cut note).
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

/**
 * The journal from this start on: the lines after the FIRST "Starting mindcraft-rotn@<bot>.service" at or after
 * the --since time (the start may come a little after the CX33's clock said; the window opens 60 s early).
 * Before that line is seen: nothing (a previous run's tail is not this run's log).
 */
export function linesFromStart(raw, bot) {
    const unit = `mindcraft-rotn@${bot}.service`;
    const parsed = raw.map(parseJournalLine).filter(Boolean);
    const i = parsed.findIndex((p) => p.ident === 'systemd' && (p.msg === `Starting ${unit}...` || p.msg.startsWith(`Starting ${unit} `)));
    return i === -1 ? [] : parsed.slice(i);
}

/**
 * serviceBot(bot, outFile, opts) -> the adapter above.
 * opts: host (the ssh alias, default 'cx23-ctl'), ssh (the program, default 'ssh'), spawn (spawnSync),
 * now, sleep (async ms), statusRefreshMs (10 s), journalRefreshMs (15 s), stopWaitMs (60 s), retries (2), backoffMs (2 s), timeoutMs.
 */
export function serviceBot(bot, outFile, { host = 'cx23-ctl', ssh = 'ssh', spawn = spawnSync, now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pause = sleepSync, statusRefreshMs = 10000, journalRefreshMs = 15000, stopWaitMs = 60000,
    retries = 2, backoffMs = 2000, timeoutMs = 120000 } = {}) {
    if (!BOT_RE.test(bot)) throw new Error(`service bot '${bot}': not a valid bot name (${BOT_RE})`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(host)) throw new Error(`service host '${host}': not an ssh alias name`);
    let since = null;          // the --since stamp of the current start
    let status = { at: -Infinity, active: false };
    let journal = { at: -Infinity, lines: [] };
    let lastState = null;
    let started = false;

    /** One request through the gate: argv only; GateRefusal on 126; retries only ssh's own 255. */
    const call = (verb, extra = []) => {
        if (!VERBS.includes(verb)) throw new Error(`service: '${verb}' is not a gate verb`);
        if (extra.length && !(verb === 'journal' && extra.length === 2 && extra[0] === '--since' && SINCE_RE.test(extra[1]))) {
            throw new Error(`service: bad arguments for ${verb}: ${JSON.stringify(extra)}`);
        }
        const argv = [...SSH_OPTS, host, verb, bot, ...extra];
        const request = [verb, bot, ...extra].join(' ');
        let r;
        for (let attempt = 0; ; attempt++) {
            r = spawn(ssh, argv, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
            if (r.status === GATE_REFUSED) throw new GateRefusal(request, r.stderr);
            if (r.status !== SSH_FAILED || attempt >= retries) break;
            pause(backoffMs * 2 ** attempt);
        }
        return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', request };
    };
    const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
    const failed = (r, what) => new Error(`service ${what}: '${r.request}' exited ${r.code ?? 'with no status'}${r.code === CTL_REFUSED ? ' (the ctl refused it)' : ''}${r.stderr ? `: ${r.stderr.trim().slice(-300)}` : ''}`);

    const readStatus = (force = false) => {
        if (!force && now() - status.at < statusRefreshMs) return status.active;
        const m = metrics();
        status = { at: now(), active: ALIVE_STATES.includes(m.ActiveState), state: m.ActiveState ?? null };
        return status.active;
    };
    const readJournal = (force = false) => {
        if (!since) return [];
        if (!force && now() - journal.at < journalRefreshMs) return journal.lines;
        const r = call('journal', ['--since', since]);
        if (r.code !== 0) throw failed(r, 'journal');
        const raw = lines(r.stdout);
        journal = { at: now(), lines: linesFromStart(raw, bot).map((p) => p.msg), raw };
        return journal.lines;
    };
    const metrics = () => {
        const r = call('metrics');
        if (r.code !== 0) throw failed(r, 'metrics');
        const m = parseMetrics(lines(r.stdout));
        if (m.ActiveState) lastState = m.ActiveState;
        return m;
    };
    const writeLog = () => {
        if (outFile && journal.raw) fs.writeFileSync(outFile, journal.raw.join('\n') + (journal.raw.length ? '\n' : ''));
    };

    return {
        kind: 'service',
        bot,
        host,
        start() {
            since = sinceStamp(now() - SKEW_MS);
            const r = call('start');
            if (r.code !== 0) throw failed(r, 'start');
            started = true;
            lastState = null;
            status = { at: -Infinity, active: false };
            journal = { at: -Infinity, lines: [] };
        },
        alive: () => started && readStatus(),
        exitCode() {
            if (!started) return null;
            if (readStatus()) return null;
            return status.state ?? lastState ?? 'unknown';
        },
        exitSignal: () => null,
        output: () => readJournal(),
        journal: (s = since) => {
            if (s !== since) { if (!SINCE_RE.test(s)) throw new Error(`service journal: bad --since '${s}'`); }
            const r = call('journal', s ? ['--since', s] : []);
            if (r.code !== 0) throw failed(r, 'journal');
            return lines(r.stdout);
        },
        metrics,
        /** `status <bot>`: systemctl's own text (it prints the last journal lines too) and its exit code (0 active, 3 not). */
        statusText() {
            const r = call('status');
            if (r.code !== 0 && r.code !== 3) throw failed(r, 'status');
            return { code: r.code, lines: lines(r.stdout) };
        },
        async stop() {
            if (!started) return;
            const r = call('stop');
            if (r.code !== 0) throw failed(r, 'stop');
            const end = now() + stopWaitMs;
            while (readStatus(true) && now() < end) await sleep(2000);
            if (status.active) throw new Error(`service stop: ${bot} still active ${stopWaitMs / 1000}s after 'stop'`);
            readJournal(true);
            writeLog();
            started = false;
            try { metrics(); } catch { /* the stop's own result stands */ }
        },
        since: () => since,
    };
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
