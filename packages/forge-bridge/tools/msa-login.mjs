#!/usr/bin/env node
// One-time Microsoft device-code login for a bot account, run by the human.
//
//   MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa \
//     node packages/forge-bridge/tools/msa-login.mjs FRCFLD
//
// It prints Microsoft's own instructions (open microsoft.com/link, type a code).
// You type the account's email and password only on Microsoft's page. The token
// cache goes to MINDCRAFT_PROFILES_FOLDER (must be outside the repo) and is
// written by prismarine-auth with the same options node-minecraft-protocol
// uses, so the bot reuses it. This script never prints or reads any token: it
// prints only the Minecraft profile name it signed in as.

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Authflow, Titles } = require('prismarine-auth');

const botName = process.argv[2];
const folder = process.env.MINDCRAFT_PROFILES_FOLDER;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function fail(msg) { console.error(`msa-login: ${msg}`); process.exit(2); }

if (!botName || !/^[A-Za-z0-9_]{3,16}$/.test(botName)) fail('usage: msa-login.mjs <BotName>  (the bot profile name, e.g. FRCFLD)');
if (!folder) fail('set MINDCRAFT_PROFILES_FOLDER to a folder outside the repo, e.g. C:/Users/admin/.mindcraft-rotn/FRCFLD/msa');
const abs = path.resolve(folder);
if (abs.toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep) || abs.toLowerCase() === repoRoot.toLowerCase()) {
    fail(`MINDCRAFT_PROFILES_FOLDER (${abs}) is inside the repo; choose a folder outside it`);
}
fs.mkdirSync(abs, { recursive: true });

// Same options as minecraft-protocol/src/client/microsoftAuth.js validateOptions().
const flow = new Authflow(botName, abs, { authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live' }, (res) => {
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
