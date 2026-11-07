// Real adapters for the scenario engine: the test server (through deploy/test-server.sh, i.e.
// $TEST_SERVER_CTL), the bot driver process and the wall clock.
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Buffer } from 'node:buffer';

/** Git Bash on Windows (never WSL's System32\bash.exe), plain bash elsewhere. */
export function findBash() {
    if (process.env.BASH_BIN) return process.env.BASH_BIN;
    if (process.platform === 'win32') {
        for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
            if (fs.existsSync(p)) return p;
        }
    }
    return 'bash';
}

/**
 * Windows NTSTATUS exit codes of a process that never got going (it failed while loading, before main):
 * 0xC0000142 STATUS_DLL_INIT_FAILED (round 5 B: Git Bash could not start while the machine was short of
 * memory), 0xC0000017 STATUS_NO_MEMORY, 0xC000012D STATUS_COMMITMENT_LIMIT. Node gets the full 32-bit code
 * only from the process it started itself (bash); a failure of ssh inside bash would come back as 8 bits.
 */
// Residual risk (#273 review 4): these codes are taken to mean "bash never ran". STATUS_DLL_INIT_FAILED only
// happens while a process loads, but STATUS_NO_MEMORY and STATUS_COMMITMENT_LIMIT could in theory end a bash
// that had already started, after ssh had sent the console command; the long retry would then send that
// command again (at most 5 more times). It would take bash itself, not its ssh child (whose code comes back
// as 8 bits), running out of memory after the send. Most console calls are reads (testfor, time query,
// scoreboard list), where a repeat is harmless; a repeated setblock, clear or whisper (a task sent twice) is
// possible but would show in the server log, which the evidence keeps.
export const NOT_STARTED_STATUS = { 3221225794: 'STATUS_DLL_INIT_FAILED', 3221225495: 'STATUS_NO_MEMORY', 3221225773: 'STATUS_COMMITMENT_LIMIT' };
/** spawnSync errors that mean the process was not started (a timeout, ETIMEDOUT, is not one of them). */
export const NOT_STARTED_ERRORS = ['ENOMEM', 'EAGAIN', 'EMFILE', 'ENFILE'];
/** Waits before each retry of a call whose process never started (5+10+20+40+60 = 135 s in all). */
export const NOT_STARTED_BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];

/** Why a spawnSync result is a process that never started, or null if it started (or timed out). */
export function notStarted(r) {
    if (r?.error && NOT_STARTED_ERRORS.includes(r.error.code)) return r.error.code;
    return NOT_STARTED_STATUS[r?.status] ?? null;
}

/**
 * Run start() (a spawnSync call) again while its process never started, waiting waits[i] before retry i;
 * onRetry(why, ms) is told each time. Returns the last result. For calls that are safe to repeat when
 * nothing ran (the batch's final `fetch logs`, round 5 B).
 */
export function retryNotStarted(start, { waits = NOT_STARTED_BACKOFF_MS, pause = sleepSync, onRetry = () => {} } = {}) {
    let r = start();
    for (const ms of waits) {
        const why = notStarted(r);
        if (!why) break;
        onRetry(why, ms);
        pause(ms);
        r = start();
    }
    return r;
}

/**
 * Console and log of the test server, via `deploy/test-server.sh console|log` (SSH to the box).
 * - A failed call is retried twice, after 2 s and 4 s (an SSH hiccup must not fail a 12-minute run).
 * - A call whose bash never started (notStarted: low memory on the runner's machine, round 5 B) is retried
 *   after NOT_STARTED_BACKOFF_MS instead, up to 5 more times. Nothing reached the server, so a console
 *   command cannot run twice. Those retries do not use up the 2 ordinary ones.
 * - The final error names each attempt's time, its result and the free memory then (`os.freemem()`).
 */
export function ctlServer(ctl, { bash = findBash(), timeoutMs = 120000, retries = 2, backoffMs = 2000, notStartedBackoffMs = NOT_STARTED_BACKOFF_MS,
    spawn: run = spawnSync, pause = sleepSync, now = () => new Date(), freemem = os.freemem } = {}) {
    if (!ctl) throw new Error('TEST_SERVER_CTL is not set: run this through `deploy/test-server.sh run -- ...`');
    const call = (args, { ordinaryRetries = retries, callTimeoutMs = timeoutMs } = {}) => {
        let last;
        let lastCode = null; // the last attempt's exit status (a number), for the caller (#347: 125 is an infra fault)
        let failed = 0;      // ordinary failures retried so far
        let unstarted = 0;   // never-started processes retried so far
        const attempts = [];
        for (;;) {
            const r = run(bash, [ctl, ...args], { encoding: 'utf8', timeout: callTimeoutMs, maxBuffer: 64 * 1024 * 1024 });
            if (r.status === 0) return r.stdout.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
            const why = notStarted(r);
            const code = r.status ?? r.error?.code ?? 'no status';
            lastCode = typeof r.status === 'number' ? r.status : null;
            attempts.push(`${now().toISOString().slice(11, 19)}Z ${why ?? code} (free ${Math.round(freemem() / 2 ** 20)} MB)`);
            const err = (r.stderr ?? '').trim().slice(-500);
            last = `${args[0]} failed (${code}${why && why !== code ? ` ${why}` : ''})${err ? `: ${err}` : ''}`;
            if (why && unstarted < notStartedBackoffMs.length) pause(notStartedBackoffMs[unstarted++]);
            else if (!why && failed < ordinaryRetries) pause(backoffMs * 2 ** failed++);
            else break;
        }
        // err.exitCode: the last attempt's exit status, or null. A restart's 125 means Mod Director's downloads failed
        // the pinned re-check after the new Done (ADR 0008): an infra fault, not a bot result.
        throw Object.assign(new Error(`${last} (after ${attempts.length} attempts: ${attempts.join(', ')})`), { exitCode: lastCode });
    };
    return {
        console: (cmd, waitS = 3) => call(['console', '--wait', String(waitS), '--', cmd]),
        log: (n = 20000) => call(['log', String(n)]),
        // The tail over the newest daily rolled-over logs/YYYY-MM-DD-N.log.gz plus latest.log (log4j rolls latest.log at 00:00 UTC):
        // {files, lines}. rotn-test's first line names the files ("##rotn-test files: a.log.gz,latest.log").
        logRotated: (n = 20000) => parseRotatedLog(call(['log', String(n), 'rotated'])),
        // G4 #1: restart the Minecraft server (test-server.sh restart: console stop, wait for the exit, start, wait for a
        // new Done line). Never re-sent after an ordinary failure (a second restart is not harmless); only a bash that
        // never started (nothing ran) is retried. Up to timeoutS for each of the stop and the start, plus a margin.
        restart: (timeoutS = 300) => call(['restart', String(timeoutS)], { ordinaryRetries: 0, callTimeoutMs: (2 * timeoutS + 60) * 1000 }),
    };
}

/** `rotn-test log N rotated` output -> {files, lines}; files is [] when the header line is missing. */
export function parseRotatedLog(out) {
    const m = /^##rotn-test files: (.*)$/.exec(out[0] ?? '');
    return m ? { files: m[1].split(',').filter(Boolean), lines: out.slice(1) } : { files: [], lines: out };
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The bot under test gets only these variables from the runner's environment (PR #9 review
// finding 5). In particular never TEST_SERVER_CTL (console access), TEST_SERVER_STATE_DIR or
// ROTN_TEST_STATE_DIR (the test server's root SSH key), HCLOUD_* or GH_* / GITHUB_*.
const BASE_ENV = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
    'TMPDIR', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ', 'TEST_SERVER_HOST', 'TEST_SERVER_PORT', 'MINDCRAFT_PROFILES_FOLDER'];
const ALLOWED_PREFIXES = ['ROTN_SCENARIO_', 'ROTN_DRIVER_'];
const NEVER = /^(TEST_SERVER_CTL|TEST_SERVER_STATE_DIR|TEST_SERVER_NAME|ROTN_TEST_.*|ROTN_HCLOUD_.*|HCLOUD_.*|GH_.*|GITHUB_.*|SSH_AUTH_SOCK|AWS_.*)$/;

/**
 * The driver's environment: the allowlist above, ROTN_SCENARIO_* / ROTN_DRIVER_*, the scenario's own
 * variables, and any --pass-env names (e.g. OPENROUTER_API_KEY for a Mindcraft driver). Throws if a
 * --pass-env name is one the driver must never get.
 */
export function driverEnv(parent, scenarioEnv = {}, passEnv = []) {
    for (const k of passEnv) {
        if (!k || NEVER.test(k)) throw new Error(`--pass-env ${k}: the bot under test must never get this variable`);
    }
    const env = {};
    for (const [k, v] of Object.entries(parent)) {
        if (v === undefined || NEVER.test(k)) continue;
        if (BASE_ENV.includes(k) || ALLOWED_PREFIXES.some((p) => k.startsWith(p)) || passEnv.includes(k)) env[k] = v;
    }
    return { ...env, ...scenarioEnv };
}

/**
 * The bot driver: argv[0] with argv[1..], no shell. Output goes to outFile and is kept in memory.
 * Its environment comes from driverEnv: the runner never hands it test-server or cloud credentials.
 */
export function driverProcess(argv, outFile, { passEnv = [] } = {}) {
    driverEnv({}, {}, passEnv); // validate --pass-env before anything starts
    let child = null;
    let code = null;
    let signal = null;
    const lines = [];
    const out = fs.createWriteStream(outFile, { flags: 'a' });
    return {
        start(env) {
            // A second start (the one login retry, session.mjs) is a new process: forget the old exit code.
            code = null;
            signal = null;
            child = spawn(argv[0], argv.slice(1), { env: driverEnv(process.env, env, passEnv), stdio: ['ignore', 'pipe', 'pipe'] });
            const take = (buf) => {
                out.write(buf);
                for (const l of buf.toString('utf8').split('\n')) if (l.trim()) lines.push(l.replace(/\r$/, ''));
            };
            child.stdout.on('data', take);
            child.stderr.on('data', take);
            // Ended by a signal (the runner's SIGTERM at the end of a scenario, or a kill): code 128, and
            // exitSignal() says which signal.
            child.on('exit', (c, sig) => { signal = sig ?? null; code = c ?? (sig ? 128 : 1); });
            child.on('error', (e) => { take(Buffer.from(`driver spawn error: ${e.message}\n`)); code = 127; });
        },
        alive: () => child !== null && code === null,
        exitCode: () => code,
        exitSignal: () => signal,
        output: () => lines,
        async stop(graceMs = 15000) {
            if (!child || code !== null) return;
            child.kill('SIGTERM');
            for (let t = 0; t < graceMs && code === null; t += 250) await sleep(250);
            if (code === null) child.kill('SIGKILL');
            for (let t = 0; t < 5000 && code === null; t += 250) await sleep(250);
            out.end();
        },
    };
}

export const wallClock = { now: () => Date.now(), sleep: (ms) => sleep(ms) };
