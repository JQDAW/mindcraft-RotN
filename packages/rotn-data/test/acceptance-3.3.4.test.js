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
    assert.equal(h.level, 0); // Tool Progression level 0 (Crude): a stone pickaxe is enough (PR #47 review)
    assert.equal(h.levelName, 'Crude');
});

test('harvestInfo is defined for every block state in the dump, apart from the pinned known gaps', { skip }, () => {
    // The brief asks for the 50 most common blocks near spawn; this checks every state, and the
    // few exceptions are pinned exactly (test/fixtures/harvest-known-gaps-3.3.4.json).
    const known = require('./fixtures/harvest-known-gaps-3.3.4.json');
    const nullHardness = {};
    const noState = [];
    let states = 0;
    for (const name of Object.keys(pack.dump.blocks.blocks)) {
        const b = pack.dump.blocks.blocks[name];
        if (b.states.length === 0) { noState.push(name); continue; }
        for (const s of b.states) {
            states++;
            const h = pack.harvestInfo(name, s.meta);
            assert.ok(h && Number.isInteger(h.level), `${name}:${s.meta} has no harvest level`);
            if (typeof h.hardness !== 'number') (nullHardness[name] ??= []).push(s.meta);
        }
    }
    assert.ok(states > 20000, `only ${states} states`);
    assert.deepEqual(nullHardness, known.nullHardness.states);
    assert.deepEqual(noState.sort(), known.noMetaState.blocks);
});

test('common surface blocks near spawn have full harvest info', { skip }, () => {
    // Re-checked facts for G2/G3 (Tool Progression levels: 0 Crude, 1 Sturdy).
    const expect = {
        stone: ['pickaxe', 0], cobblestone: ['pickaxe', 0], dirt: ['shovel', 0], grass: ['shovel', 0], sand: ['shovel', 0],
        gravel: ['shovel', 0], log: ['axe', 0], iron_ore: ['pickaxe', 0], coal_ore: ['pickaxe', 0],
    };
    for (const [block, [tool, level]] of Object.entries(expect)) {
        const h = pack.harvestInfo(block);
        assert.equal(h.tool, tool, block);
        assert.equal(h.level, level, block);
        assert.equal(typeof h.hardness, 'number', block);
    }
    assert.equal(pack.harvestInfo('pyrotech:rock').tool, null);
});

test('serializers(): the real DataSerializer table from the second dump (net-forge)', { skip }, () => {
    const t = pack.serializers();
    assert.ok(t, 'no serializers.json in the 3.3.4 dump');
    const byId = Object.fromEntries(t.serializers.map(s => [s.id, s]));
    for (let id = 0; id <= 13; id++) assert.equal(byId[id]?.vanilla, true, `id ${id}`);
    assert.equal(byId[14].class, 'com.fuzs.aquaacrobatics.network.datasync.PoseSerializer$1');
    assert.equal(byId[16].class, 'com.bobmowzie.mowziesmobs.server.ServerProxy$1');
    assert.equal(byId[18].class, 'requious.util.ExtraSerializers$1');
    assert.equal(byId[256].class, 'doggytalents.serializers.TalentListSerializer');
    for (const id of [14, 15, 16, 17, 18, 256, 257]) assert.equal(byId[id].vanilla, false, `id ${id}`);
    const dog = t.usage['doggytalents:dog'];
    assert.deepEqual(dog.find(u => u.index === 21), { index: 21, serializerId: 256, class: 'doggytalents.serializers.TalentListSerializer' });
    assert.equal(dog.find(u => u.index === 30).serializerId, 257);
    assert.equal(t.usage['mowziesmobs:barakoaya'][0].serializerId, 16);
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

test('common-mobs.json is up to date, names real entities, and has modded mobs (harness-ops G2)', { skip }, async () => {
    const { buildCommonMobs } = await import('../tools/build-common-mobs.mjs');
    const committed = require('../3.3.4/common-mobs.json');
    assert.deepEqual(committed, JSON.parse(buildCommonMobs()));
    const first12 = committed.mobs.slice(0, 12).map(m => m.name);
    assert.equal(first12.length, 12);
    assert.ok(first12.some(n => !n.startsWith('minecraft:')), 'no modded mob among the first 12');
    for (const m of committed.mobs) assert.ok(pack.names.entities.has(m.name), m.name);
    assert.ok(first12.includes('minecraft:zombie') && first12.includes('minecraft:sheep'));
});
