// rotn-data brief acceptance tests that need the real 3.3.4 dump (ADR 0004).
// They are skipped, with a reason, until a dump from the test server is imported
// with tools/import-dump.mjs. Everything here runs offline on committed JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadRotnData } from '../index.js';
import { recipeMatches } from '../src/crosscheck.js';

const require = createRequire(import.meta.url);
const pack = loadRotnData('3.3.4');
const skip = pack.hasDump ? false : 'no 3.3.4 dump imported yet (tools/dumper must run on the test server first)';
const expected = require('./fixtures/scripts-3.3.4-early-recipes.json').recipes;

test('the dump is for RotN 3.3.4 on Forge 14.23.5.2860', { skip }, () => {
    const m = pack.dump.manifest;
    assert.equal(m.pack.version, '3.3.4');
    assert.equal(m.pack.zipSha256, '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205');
    assert.equal(m.forge, '14.23.5.2860');
});

test('dump and registry capture agree on every block, item and entity name', { skip }, () => {
    for (const [kind, file, key] of [['blocks', 'blocks', 'blocks'], ['items', 'items', 'items'], ['entities', 'entities', 'entities']]) {
        const dumped = new Set(Object.keys(pack.dump[file][key]));
        const missing = [...pack.names[kind]].filter(n => !dumped.has(n));
        const extra = [...dumped].filter(n => !pack.names[kind].has(n));
        assert.deepEqual(missing, [], `${kind} synced by the server but not dumped`);
        assert.deepEqual(extra, [], `${kind} dumped but not synced`);
    }
});

for (const e of expected) {
    test(`recipesFor finds RotN's ${e.key} recipe as in ${e.script}`, { skip }, () => {
        const ore = (k) => pack.oreDict(k);
        const all = pack.recipesFor(e.result.name);
        assert.ok(all.some(r => recipeMatches(e, r, ore)), `${e.key}: none of ${all.length} recipes for ${e.result.name} match the script`);
        if (e.only) assert.ok(!all.some(r => r.id === e.result.name), `${e.key}: the vanilla recipe is still registered`);
    });
}

test("harvestInfo('stone') reports RotN's tool and level from the dump", { skip }, () => {
    const h = pack.harvestInfo('stone');
    assert.equal(h.block, 'minecraft:stone');
    assert.equal(h.tool, 'pickaxe');
    assert.ok(Number.isInteger(h.level) && h.level >= 0, `level ${h.level}`);
    assert.equal(typeof h.levelName, 'string');
});

test('harvestInfo is defined for every block state in the dump (so for the 50 most common near spawn)', { skip }, () => {
    const bad = [];
    for (const name of Object.keys(pack.dump.blocks.blocks)) {
        const b = pack.dump.blocks.blocks[name];
        for (const s of b.states) {
            const h = pack.harvestInfo(name, s.meta);
            if (!h || typeof h.hardness !== 'number' || !Number.isInteger(h.level)) bad.push(`${name}:${s.meta}`);
        }
    }
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} states without harvest info`);
});

test('the mod-local entity table covers every modded entity the server syncs', { skip }, () => {
    const missing = [];
    for (const n of pack.names.entities) {
        if (n.startsWith('minecraft:')) continue;
        const e = pack.entity(n);
        if (!e.propertiesKnown || !Number.isInteger(e.modEntityTypeId)) { missing.push(n); continue; }
        assert.equal(pack.entityByModId(e.modId, e.modEntityTypeId).name, n);
    }
    assert.deepEqual(missing, []);
});
