// The parsing half of check-env (ExecStartPre of mindcraft-rotn@<bot>.service). Installed next to
// it as /usr/local/lib/mindcraft-rotn/check-env.mjs and run by check-env.sh with node, so values are
// judged the way main.js reads them (PR #30 review finding 1), never by grepping text:
//   main.js: if (process.env.INSECURE_CODING) settings.allow_insecure_coding = true;
//            if (process.env.BLOCKED_ACTIONS)  settings.blocked_actions = JSON.parse(...);
//            if (process.env.SETTINGS_JSON)    Object.assign(settings, JSON.parse(...));
//
//   node check-env.mjs RELEASE_DIR
// Reads the bot's effective environment. check-env.sh starts node with NODE_OPTIONS and NODE_PATH
// removed and passes the bot's NODE_OPTIONS as CHECK_ENV_NODE_OPTIONS (set only if it was set).
// Prints one line per problem; exit 0 = safe, 1 = refuse. Never prints a value.
import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const env = process.env;
const problems = [];
const bad = (m) => problems.push(m);
const has = (k) => Object.prototype.hasOwnProperty.call(env, k);

// 1. Settings that could turn on insecure coding or unblock actions.
if (has('INSECURE_CODING')) bad('INSECURE_CODING is set (to anything, even empty): not allowed on the CX23');
if (has('BLOCKED_ACTIONS')) bad('BLOCKED_ACTIONS is set: it would replace settings.js blocked_actions; not allowed');

// SETTINGS_JSON is merged into settings with Object.assign, so only an allowlist is safe. JSON.parse
// decodes escapes (allow_insecure_coding), so the keys are checked after parsing.
const ALLOWED = new Set(['auth', 'host', 'port', 'auto_open_ui']);
if (has('SETTINGS_JSON')) {
    let s;
    try {
        s = JSON.parse(env.SETTINGS_JSON);
    } catch {
        bad('SETTINGS_JSON is not valid JSON');
    }
    if (s !== undefined) {
        if (s === null || typeof s !== 'object' || Array.isArray(s)) {
            bad('SETTINGS_JSON must be a JSON object');
        } else {
            const keys = Object.keys(s);
            const unknown = keys.filter((k) => !ALLOWED.has(k));
            // Key names are printed escaped by JSON.stringify, so a control character cannot hide.
            if (unknown.length) bad(`SETTINGS_JSON has keys outside auth, host, port, auto_open_ui: ${unknown.map((k) => JSON.stringify(k)).join(', ')}`);
            if ('auto_open_ui' in s && s.auto_open_ui !== false) bad('SETTINGS_JSON auto_open_ui may only be false');
            if ('auth' in s && s.auth !== 'microsoft') bad('SETTINGS_JSON auth must be "microsoft" (online mode, the bot\'s own token cache)');
            if ('host' in s && (typeof s.host !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(s.host))) bad('SETTINGS_JSON host must be a host name or IPv4 address');
            if ('port' in s && !(Number.isInteger(s.port) && s.port >= 1 && s.port <= 65535)) bad('SETTINGS_JSON port must be an integer 1..65535');
        }
    }
}

// 2. DEBUG must not be able to enable prismarine-auth's debug output, which prints tokens. The rule is
// forge-bridge's own (auth-guard.js debugValueEnables), imported from the release the bot will run.
async function checkDebug() {
    if (!has('DEBUG')) return;
    const release = process.argv[2];
    try {
        if (!release) throw new Error('no release dir');
        const guard = await import(pathToFileURL(path.join(release, 'packages', 'forge-bridge', 'src', 'auth-guard.js')).href);
        if (typeof guard.debugValueEnables !== 'function') throw new Error('no debugValueEnables');
        if (guard.debugValueEnables(env.DEBUG)) bad('DEBUG could enable prismarine-auth debug output (it prints tokens); remove it');
    } catch {
        bad('DEBUG is set, and the release\'s forge-bridge auth guard could not be loaded to check it; remove DEBUG');
    }
}

// 3. NODE_OPTIONS reaches the bot's node: only a heap size, nothing that loads code (--require, --import, ...).
if (has('CHECK_ENV_NODE_OPTIONS')) {
    const parts = env.CHECK_ENV_NODE_OPTIONS.trim().split(/\s+/).filter(Boolean);
    if (!parts.every((p) => /^--max-old-space-size=\d{2,5}$/.test(p))) bad('NODE_OPTIONS may only hold --max-old-space-size=N');
}

// 4. The rest of the contract.
if (env.MINDCRAFT_SINGLE_BOT_SERVICE !== '1') bad('MINDCRAFT_SINGLE_BOT_SERVICE must be 1 (set by the unit; do not override it in the env file)');
const key = env.OPENROUTER_API_KEY ?? '';
if (!key || key.includes('set-by-human')) bad('OPENROUTER_API_KEY is empty or still the placeholder (the human sets it in the env file)');

checkDebug().then(() => {
    for (const p of problems) console.error(`check-env: ${p}`);
    process.exitCode = problems.length ? 1 : 0;
}, () => {
    console.error('check-env: internal error');
    process.exitCode = 1;
});
