// CX23 first start: the Coder read bots/execTemplate.js and bots/lintTemplate.js in its constructor,
// in readFile callbacks that threw, so a missing template killed the agent process even with
// allow_insecure_coding false. Now the templates are read on first use, and a read error is one log
// line with coding unavailable. Offline: temporary directories; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import settings from './settings.js';
import { Coder } from './coder.js';

/** Run in an empty working directory (the Coder makes ./bots/<name>/action-code/ there). */
function inTempCwd(t) {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), 'coder-'));
    process.chdir(dir);
    t.after(() => process.chdir(cwd));
    return dir;
}

test('CX23: constructing the Coder with missing templates and insecure coding off does not throw, now or later', async (t) => {
    inTempCwd(t);
    const before = settings.allow_insecure_coding;
    t.after(() => { settings.allow_insecure_coding = before; });
    settings.allow_insecure_coding = false;
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const missing = path.join(tmpdir(), 'no-such-templates-dir');
    let coder;
    assert.doesNotThrow(() => { coder = new Coder({ name: 'FRCFLD' }, { templates_dir: missing }); });
    // The old reads threw in a callback, after the constructor returned: give any such callback its turn.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(warns, [], 'nothing is read (or said) at construction');
    assert.equal(coder.code_template, '');
});

test('CX23: on first use a missing template is one safeError line, and coding reports itself unavailable (no LLM call, no throw)', async (t) => {
    inTempCwd(t);
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    let prompted = 0;
    const agent = { name: 'FRCFLD', prompter: { promptCoding: () => { prompted++; return Promise.resolve(''); } }, bot: { modes: { pause() {} } } };
    const coder = new Coder(agent, { templates_dir: path.join(tmpdir(), 'no-such-templates-dir') });
    const res = await coder.generateCode({ getHistory: () => [] });
    assert.match(res, /^Coding is unavailable: the code templates could not be read \(.*ENOENT.*\)\.$/);
    assert.equal(prompted, 0, 'no LLM call');
    assert.equal(warns.length, 1);
    assert.match(warns[0], /^\[coder\] could not read the code templates \(.*\); coding is unavailable$/);
    assert.ok(!/\n\s+at /.test(warns[0]), 'one line, no stack');
    await coder.generateCode({ getHistory: () => [] });
    assert.equal(warns.length, 1, 'said once');
});

test('CX23: with the templates there (the repo\'s bots/), they are read on first use', (t) => {
    inTempCwd(t);
    const coder = new Coder({ name: 'FRCFLD' });
    assert.equal(coder.code_template, '', 'not at construction');
    assert.equal(coder.loadTemplates(), true);
    assert.match(coder.code_template, /\/\* CODE HERE \*\//);
    assert.match(coder.code_lint_template, /\/\* CODE HERE \*\//);
});
