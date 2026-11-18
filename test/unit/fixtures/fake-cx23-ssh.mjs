// Fake `ssh cx23-ctl VERB BOT ...` (the CX23 gate, ADR 0009) for run.mjs's G4 step-7 end-to-end test (g4-accept.test.js); not to be
// confused with fake-ssh.mjs (deploy/test-server.sh). State in $FAKE_CTL_DIR: unit-state (the unit's ActiveState) and journal.txt; a start writes the account's UUID and join lines into the fake
// test server's log (server.log, read by fake-ctl.mjs), a stop its leave line. $FAKE_SSH_ACCOUNT names the account,
// $FAKE_SSH_RELEASE (optional) the "[release] <tag>-<sha12>" start line.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = process.env.FAKE_CTL_DIR;
const args = process.argv.slice(2);
const at = args.indexOf('cx23-ctl');
const [verb, unit] = args.slice(at + 1);
const account = process.env.FAKE_SSH_ACCOUNT ?? 'BOTTWO';
const stateFile = path.join(dir, 'unit-state');
const journalFile = path.join(dir, 'journal.txt');
const state = () => (fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8').trim() : 'inactive');
const serverLine = (msg) => fs.appendFileSync(path.join(dir, 'server.log'), `[12:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}\n`);
const journal = (msg, ident = 'node[4242]') => fs.appendFileSync(journalFile, `${new Date().toISOString().slice(0, 19)}+00:00 ${ident}: ${msg}\n`);

if (at < 0) { process.stderr.write('fake ssh: no cx23-ctl\n'); process.exit(255); }
if (verb === 'start') {
    fs.writeFileSync(stateFile, 'active');
    journal(`Starting mindcraft-rotn@${unit}.service - Mindcraft-RotN bot ${unit}...`, 'systemd[1]');
    if (process.env.FAKE_SSH_RELEASE) journal(`[release] ${process.env.FAKE_SSH_RELEASE}`);
    journal('[settings] effective allow_insecure_coding=false');
    journal(`[state] ${account} at start: tasks=absent agenda=absent memory=absent`);
    fs.appendFileSync(path.join(dir, 'server.log'), `[12:00:00] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${account} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d\n`);
    serverLine(`${account} joined the game`);
} else if (verb === 'stop') {
    if (state() === 'active') serverLine(`${account} left the game`);
    fs.writeFileSync(stateFile, 'inactive');
} else if (verb === 'metrics') {
    process.stdout.write(`MemoryCurrent=104857600\nMemoryPeak=104857600\nNRestarts=0\nActiveState=${state()}\n`);
} else if (verb === 'journal') {
    process.stdout.write(fs.existsSync(journalFile) ? fs.readFileSync(journalFile, 'utf8') : '');
} else if (verb === 'status') {
    process.stdout.write(`mindcraft-rotn@x.service - Active: ${state()}\n`);
} else {
    process.stderr.write(`fake ssh: unsupported ${verb}\n`);
    process.exit(2);
}
