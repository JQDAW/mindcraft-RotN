// Fake scenario driver for the runner's end-to-end test: "joins" the fake server of fake-ctl.mjs
// by writing the server's log lines, says the hello nonce, then idles until it is stopped.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = process.env.FAKE_CTL_DIR;
const add = (msg) => fs.appendFileSync(path.join(dir, 'server.log'), `[12:00:01] [Server thread/INFO] [x]: ${msg}\n`);
add('UUID of player FRCFLD is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d');
add('FRCFLD joined the game');
fs.writeFileSync(path.join(dir, 'online'), '');
add(`<FRCFLD> ${process.env.ROTN_SCENARIO_HELLO}`);
console.log(`DRIVER {"type":"spawn","bot":"${process.env.ROTN_SCENARIO_BOT}"}`);
// What the runner let through (PR #9 review finding 5): never the ctl, the state dir or cloud tokens.
console.log(`DRIVER ${JSON.stringify({ type: 'env', ctl: 'TEST_SERVER_CTL' in process.env, stateDir: 'TEST_SERVER_STATE_DIR' in process.env,
    hcloud: 'HCLOUD_TOKEN' in process.env, extra: process.env.ROTN_SCENARIO_EXTRA })}`);
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
