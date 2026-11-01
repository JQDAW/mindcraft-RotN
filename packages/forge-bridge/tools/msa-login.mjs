#!/usr/bin/env node
// One-time Microsoft device-code login for a bot account, run by the human.
//
//   MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa \
//     node packages/forge-bridge/tools/msa-login.mjs FRCFLD [--check]
//
// It prints Microsoft's own instructions (open microsoft.com/link, type a code).
// You type the account's email and password only on Microsoft's page. The token
// cache goes to MINDCRAFT_PROFILES_FOLDER, which must be outside every git work
// tree and is created with mode 0700. It is written by prismarine-auth with the
// same options node-minecraft-protocol uses, so the bot reuses it. This script
// never prints or reads any token: it prints only the Minecraft profile name it
// signed in as.

import process from 'node:process';
import { createRequire } from 'node:module';
import { prepareSecretFolder } from '../src/secret-folder.js';

// prismarine-auth logs HTTP details through the `debug` package when DEBUG
// matches. Clear it before the library loads.
delete process.env.DEBUG;

const require = createRequire(import.meta.url);
const { Authflow, Titles } = require('prismarine-auth');

const botName = process.argv[2];
// --check: confirm an existing cache still signs in. Never starts a device-code
// prompt; if the cache needs one, it fails so a human can run the login again.
const checkOnly = process.argv.slice(3).includes('--check');
const folder = process.env.MINDCRAFT_PROFILES_FOLDER;

function fail(msg) { console.error(`msa-login: ${msg}`); process.exit(2); }

if (!botName || !/^[A-Za-z0-9_]{3,16}$/.test(botName)) fail('usage: msa-login.mjs <BotName>  (the bot profile name, e.g. FRCFLD)');
if (!folder) fail('set MINDCRAFT_PROFILES_FOLDER to a folder outside every git repository, e.g. C:/Users/admin/.mindcraft-rotn/FRCFLD/msa');
let abs;
try { abs = prepareSecretFolder(folder); } catch (e) { fail(`MINDCRAFT_PROFILES_FOLDER: ${e.message}`); }

// Same options as minecraft-protocol/src/client/microsoftAuth.js validateOptions().
const flow = new Authflow(botName, abs, { authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live' }, (res) => {
    if (checkOnly) fail('the token cache needs a new device-code login (not started in --check mode); ask the human to run the login again');
    console.log('\n' + (res.message ?? `Open ${res.verification_uri} and enter the code ${res.user_code}`) + '\n');
});

async function main() {
    const { profile } = await flow.getMinecraftJavaToken({ fetchProfile: true });
    if (!profile?.name) fail('signed in, but this account has no Minecraft Java profile');
    console.log(`Signed in. Minecraft profile: ${profile.name}`);
    if (profile.name !== botName) console.log(`WARNING: the profile name differs from the bot name ${botName}. The bot profile name must equal the account's Minecraft name (PLAN, multi-bot readiness).`);
    console.log(`Token cache folder: ${abs} (do not share or commit it)`);
}

main().catch((e) => fail(`login failed: ${e.message}`));
