// Static guard for skills-rotn A1 (log hygiene, "Before the first CX23 run"):
// the agent files that a connection or model error can reach must not print
// a whole error object. They log safeError(err) or safeStack(err) instead.
// Offline: this only reads source files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['agent.js', 'action_manager.js', 'mindserver_proxy.js'];
const ERR_NAMES = '(?:err|error|e)';

// console.x(..., err), console.x(err), console.x(err.stack), String(err) or
// ${err} inside a log call, and JSON.stringify(err, ...).
const BAD = [
    new RegExp(`console\\.(?:error|log|warn|info)\\(([^)]*,\\s*)?${ERR_NAMES}(?:\\.stack)?\\s*\\)`),
    new RegExp(`(?:log|console\\.(?:error|log|warn|info))\\(.*(?:String\\(${ERR_NAMES}\\)|\\$\\{${ERR_NAMES}\\})`),
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

test('the guard itself catches the old patterns', () => {
    const old = [
        "console.error('Error event!', err);",
        "console.error(err.stack);",
        "log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);",
        "console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));",
    ];
    for (const line of old) assert.ok(BAD.some(re => re.test(line)), line);
    assert.ok(!BAD.some(re => re.test("console.error('Error event!', safeError(err));")));
});
