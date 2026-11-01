// Real adapters for the scenario engine: the test server (through deploy/test-server.sh, i.e.
// $TEST_SERVER_CTL), the bot driver process and the wall clock.
import fs from 'node:fs';
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
 * Console and log of the test server, via `deploy/test-server.sh console|log` (SSH to the box).
 * A failed call is retried twice, after 2 s and 4 s (an SSH hiccup must not fail a 12-minute run).
 */
export function ctlServer(ctl, { bash = findBash(), timeoutMs = 120000, retries = 2, backoffMs = 2000, spawn: run = spawnSync, pause = sleepSync } = {}) {
    if (!ctl) throw new Error('TEST_SERVER_CTL is not set: run this through `deploy/test-server.sh run -- ...`');
    const call = (args) => {
        let last;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (attempt) pause(backoffMs * 2 ** (attempt - 1));
            const r = run(bash, [ctl, ...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
            if (r.status === 0) return r.stdout.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
            last = `${args[0]} failed (${r.status}): ${(r.stderr ?? '').trim().slice(-500)}`;
        }
        throw new Error(`${last} (after ${retries + 1} attempts)`);
    };
    return {
        console: (cmd, waitS = 3) => call(['console', '--wait', String(waitS), '--', cmd]),
        log: (n = 20000) => call(['log', String(n)]),
    };
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
    const lines = [];
    const out = fs.createWriteStream(outFile, { flags: 'a' });
    return {
        start(env) {
            // A second start (the one login retry, session.mjs) is a new process: forget the old exit code.
            code = null;
            child = spawn(argv[0], argv.slice(1), { env: driverEnv(process.env, env, passEnv), stdio: ['ignore', 'pipe', 'pipe'] });
            const take = (buf) => {
                out.write(buf);
                for (const l of buf.toString('utf8').split('\n')) if (l.trim()) lines.push(l.replace(/\r$/, ''));
            };
            child.stdout.on('data', take);
            child.stderr.on('data', take);
            child.on('exit', (c, sig) => { code = c ?? (sig ? 128 : 1); });
            child.on('error', (e) => { take(Buffer.from(`driver spawn error: ${e.message}\n`)); code = 127; });
        },
        alive: () => child !== null && code === null,
        exitCode: () => code,
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
