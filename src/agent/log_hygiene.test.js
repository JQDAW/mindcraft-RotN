// Static guard for skills-rotn A1 (log hygiene, "Before the first CX23 run"):
// the agent files that a connection or model error can reach must not print
// a whole error object. They log safeError(err) or safeStack(err) instead.
// Offline: this only reads source files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Paths relative to this file. src/models/openrouter.js is lead-owned and was
// changed under a lead-approved exception (the provider the bot uses).
const FILES = ['agent.js', 'action_manager.js', 'mindserver_proxy.js', 'connection_handler.js', 'speak.js', 'commands/queries.js', '../models/openrouter.js'];
const ERR_NAMES = '(?:err|error|e)';

// console.x(..., err), console.x(err), console.x(err.stack), String(err) in a
// log call, ${err} or ${err.stack} anywhere (logs and agent-visible text),
// "+ err.stack" concatenation, and JSON.stringify(err, ...).
const BAD = [
    new RegExp(`console\\.(?:error|log|warn|info)\\(([^)]*,\\s*)?${ERR_NAMES}(?:\\.stack)?\\s*\\)`),
    new RegExp(`(?:log|console\\.(?:error|log|warn|info))\\(.*String\\(${ERR_NAMES}\\)`),
    new RegExp(`\\$\\{${ERR_NAMES}(?:\\.stack)?\\}`),
    new RegExp(`\\+\\s*${ERR_NAMES}\\.stack\\b`),
    new RegExp(`JSON\\.stringify\\(${ERR_NAMES}\\b`),
];

for (const file of FILES) {
    test(`${file} never logs a whole error object`, () => {
        const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
        const offenders = source.split(/\r?\n/)
            .map((line, i) => ({ line: line.trim(), n: i + 1 }))
            .filter(({ line }) => !line.startsWith('//') && BAD.some(re => re.test(line)));
        assert.deepEqual(offenders, [], `whole-error logging in ${file}`);
    });
}

// src/models/prompter.js (lead-owned): only the statements in the
// lead-approved exception (124-125, 131-132, 238, 327) are checked; the rest
// of the file is out of scope (line 234 prints model output, which stays).
// No "Stack trace:" line with a raw stack is left.
test('prompter.js logs model and example errors through safeStack', () => {
    const lines = readFileSync(new URL('../models/prompter.js', import.meta.url), 'utf8').split(/\r?\n/);
    assert.ok(!lines.some(l => l.includes('error.stack')), 'raw error.stack in prompter.js');
    for (const message of ["'Failed to initialize examples. Error details:'", "'Failed to initialize examples:'", "'Error during message generation or file writing:'"]) {
        const hits = lines.filter(l => l.includes(message));
        assert.equal(hits.length, 1, message);
        assert.match(hits[0], /safeStack\(error\)\);\s*$/, message);
    }
    // The goal parser's error goes through safeError; the raw model reply may stay.
    const goal = lines.filter(l => l.includes("'Failed to parse goal:'"));
    assert.equal(goal.length, 1);
    assert.match(goal[0], /console\.log\('Failed to parse goal:', res, safeError\(err\)\);\s*$/);
});

test('the guard itself catches the old patterns', () => {
    const old = [
        "console.error('Error event!', err);",
        "console.error(err.stack);",
        "log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);",
        "console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));",
        "return `The following error occurred: ${error}`",
        "'Stack trace:\\n' + err.stack+'\\n';",
        "console.error('[TTS] Audio error', e);",
        "console.error('Error while awaiting response:', err);",
        "console.error('Stack trace:', error.stack);",
    ];
    for (const line of old) assert.ok(BAD.some(re => re.test(line)), line);
    assert.ok(!BAD.some(re => re.test("console.error('Error event!', safeError(err));")));
});
