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

/** Console and log of the test server, via `deploy/test-server.sh console|log` (SSH to the box). */
export function ctlServer(ctl, { bash = findBash(), timeoutMs = 120000 } = {}) {
    if (!ctl) throw new Error('TEST_SERVER_CTL is not set: run this through `deploy/test-server.sh run -- ...`');
    const call = (args) => {
        const r = spawnSync(bash, [ctl, ...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
        if (r.status !== 0) throw new Error(`${args[0]} failed (${r.status}): ${(r.stderr ?? '').trim().slice(-500)}`);
        return r.stdout.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
    };
    return {
        console: (cmd, waitS = 3) => call(['console', '--wait', String(waitS), '--', cmd]),
        log: (n = 20000) => call(['log', String(n)]),
    };
}

/**
 * The bot driver: argv[0] with argv[1..], no shell. Output goes to outFile and is kept in memory.
 * The driver gets the parent environment plus the scenario's variables; it is never given secrets
 * by the runner (MINDCRAFT_PROFILES_FOLDER, if set, is only passed through).
 */
export function driverProcess(argv, outFile) {
    let child = null;
    let code = null;
    const lines = [];
    const out = fs.createWriteStream(outFile, { flags: 'a' });
    return {
        start(env) {
            child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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
