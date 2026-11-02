// A stand-in for Mindcraft's main.js in the G3 driver's tests: like the real one, it starts the agent as
// a child process (not detached, stdio inherited). It records what it was given (names and shapes only,
// never values) and both process ids in $FAKE_DIR, then stays up, or exits with $FAKE_EXIT_CODE.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = process.env.FAKE_DIR;
const settings = JSON.parse(process.env.SETTINGS_JSON ?? '{}');
const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
fs.writeFileSync(path.join(dir, 'seen.json'), JSON.stringify({
    argv: process.argv.slice(2),
    settingsKeys: Object.keys(settings).sort(),
    settings: { host: settings.host, port: settings.port, auth: settings.auth, auto_open_ui: settings.auto_open_ui },
    profiles: JSON.parse(process.env.PROFILES ?? '[]'),
    singleBot: process.env.MINDCRAFT_SINGLE_BOT_SERVICE ?? null,
    mindserverPort: Number(process.env.MINDSERVER_PORT),
    hasOpenRouterKey: 'OPENROUTER_API_KEY' in process.env,
    hasTestServerVars: Object.keys(process.env).some((k) => k.startsWith('TEST_SERVER_')),
    insecure: 'INSECURE_CODING' in process.env,
}));
fs.writeFileSync(path.join(dir, 'pids.json'), JSON.stringify({ main: process.pid, agent: agent.pid }));
console.log('fake main.js: agent started');
if (process.env.FAKE_EXIT_CODE) setTimeout(() => process.exit(Number(process.env.FAKE_EXIT_CODE)), 300);
else setInterval(() => {}, 1000);
