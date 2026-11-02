// Guard (skills-rotn, fix for a #104 regression): src/models/_model_map.js
// imports every .js file in src/models/ when the agent starts, so a test
// file there would run inside the bot. src/models/openrouter.test.js did, and
// its before() hook replaced OPENROUTER_API_KEY with a fake key.
// Offline: reads the directory and imports the model map with no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import process from 'node:process';

test('src/models/ holds no test files (the model map would load them into the agent)', () => {
    const files = readdirSync(new URL('../models/', import.meta.url));
    assert.deepEqual(files.filter(f => /\.test\.(m?js|cjs)$/.test(f)), []);
});

test('loading the model map leaves OPENROUTER_API_KEY alone', async (t) => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    const before = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'placeholder-not-a-key';
    t.after(() => {
        if (before === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = before;
    });

    await import('../models/_model_map.js');
    await new Promise(r => setTimeout(r, 200)); // any test file it loaded would have run its hooks by now

    assert.equal(process.env.OPENROUTER_API_KEY, 'placeholder-not-a-key');
});
