// Fake `deploy/test-server.sh console|log` for the runner's end-to-end test. State lives in
// $FAKE_CTL_DIR: server.log (the "latest.log") and online (present while FRCFLD is online).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = process.env.FAKE_CTL_DIR;
const logFile = path.join(dir, 'server.log');
const posFile = path.join(dir, 'pos.json');
const read = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : []);
const add = (msg) => fs.appendFileSync(logFile, `[12:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}\n`);
const online = () => fs.existsSync(path.join(dir, 'online'));
const pos = () => (fs.existsSync(posFile) ? JSON.parse(fs.readFileSync(posFile, 'utf8')) : [0.5, 64, 0.5]);
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'log' && rest[1] === 'since-start') {
    // G4 step 7: rotn-test log N since-start over the fake's one log file (the bytes bound is rotn-test's own test).
    const lines = read();
    let at = -1;
    lines.forEach((l, i) => { if (l.includes('Starting minecraft server version ')) at = i; });
    const from = at < 0 ? [] : lines.slice(at);
    const over = from.length > Number(rest[0]);
    process.stdout.write([`##rotn-test since-start files=latest.log found=${at < 0 ? 0 : 1} lines=${from.length} over=${over ? 1 : 0}`,
        ...(over ? [] : from)].join('\n') + '\n');
} else if (cmd === 'log') {
    process.stdout.write(read().slice(-Number(rest[0] ?? 100)).join('\n') + '\n');
} else if (cmd === 'console') {
    const line = rest.slice(rest.indexOf('--') + 1).join(' ');
    const before = read().length;
    let m;
    if ((m = /^say (.*)$/.exec(line))) add(`[Server] ${m[1]}`);
    else if ((m = /^tell FRCFLD scenario-echo (\S+)$/.exec(line)) && online()) add(`<FRCFLD> echo ${m[1]}`);
    else if ((m = /^tell FRCFLD scenario-walk (\d+)$/.exec(line)) && online()) {
        const p = pos();
        p[2] += Number(m[1]);
        fs.writeFileSync(posFile, JSON.stringify(p));
        add(`<FRCFLD> walked ${p.join(' ')}`);
    } else if (line === 'seed' && process.env.FAKE_CTL_SEED) add(`Seed: [${process.env.FAKE_CTL_SEED}]`);
    else if (line === 'time query gametime' && process.env.FAKE_CTL_GAMETIME) add(`Time is ${process.env.FAKE_CTL_GAMETIME}`);
    else if (line === 'tp FRCFLD ~ ~ ~') add(`Teleported FRCFLD to ${pos().join(', ')}`);
    else if (line === 'list') {
        add(`There are ${online() ? 1 : 0}/10 players online:`);
        add(online() ? 'FRCFLD' : '');
    }
    process.stdout.write(read().slice(before).join('\n') + '\n');
} else if (cmd === 'starts') {
    // G4 step 7: rotn-test starts over the fake's one log file.
    process.stdout.write(`starts=${read().filter((l) => l.includes('Starting minecraft server version ')).length} files=1\n`);
} else {
    process.stderr.write(`fake ctl: unsupported ${cmd}\n`);
    process.exit(2);
}
