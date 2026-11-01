#!/usr/bin/env node
// Reference scenario driver: stock mineflayer 1.12.2 plus test/runner/drivers/scenario-protocol.mjs.
//
// Without forge-bridge, a Forge server rejects it during the FML handshake. That is useful: it is the
// negative control that shows the runner reports a failed login with a classified kick. net-forge's
// spike driver does the same as this file with its own bot factory (forge-bridge attached).
//
// Env (set by test/runner/run.mjs, plus the TEST_SERVER_* exports of deploy/test-server.sh run):
//   TEST_SERVER_HOST, TEST_SERVER_PORT    where to connect (the disposable test server only)
//   ROTN_SCENARIO_BOT                     Minecraft name of the bot account (FRCFLD)
//   ROTN_SCENARIO_HELLO                   text to say once spawned
//   MINDCRAFT_PROFILES_FOLDER             token cache folder of the bot account (read by prismarine-auth;
//                                         never printed). The first device-code login is a human step.
//   ROTN_DRIVER_AUTH                      microsoft (default) | offline (a local vanilla test only)
// Exit codes (ADR 0003 decision 5): 0 clean stop (SIGTERM), 1 transient disconnect, 3 fatal.
import process from 'node:process';
import mineflayer from 'mineflayer';
import { attachScenario, event } from './scenario-protocol.mjs';

const host = process.env.TEST_SERVER_HOST;
const port = Number(process.env.TEST_SERVER_PORT ?? 25565);
const username = process.env.ROTN_SCENARIO_BOT ?? 'FRCFLD';
const auth = process.env.ROTN_DRIVER_AUTH ?? 'microsoft';
if (!host) {
    console.error('TEST_SERVER_HOST is not set');
    process.exit(3);
}

const bot = mineflayer.createBot({
    host, port, username, auth, version: '1.12.2',
    profilesFolder: process.env.MINDCRAFT_PROFILES_FOLDER,
    // A scenario never runs an interactive login: a missing token cache is a fatal setup error.
    onMsaCode: () => {
        event('fatal', { reason: 'Microsoft device-code login needed; do the first login by hand (coord/NEEDS-HUMAN.md)' });
        process.exit(3);
    },
    hideErrors: false,
});
attachScenario(bot);

let stopping = false;
bot.on('login', () => event('login', { username: bot.username }));
bot.on('kicked', (reason) => {
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
    event('kicked', { reason: text.slice(0, 2000) });
});
bot.on('error', (e) => event('error', { message: String(e?.message ?? e).slice(0, 2000) }));
bot.on('end', (why) => {
    event('end', { reason: String(why ?? '') });
    process.exit(stopping ? 0 : 1);
});
const stop = () => {
    stopping = true;
    event('stopping');
    bot.quit('scenario finished');
    setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
