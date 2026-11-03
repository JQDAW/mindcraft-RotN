// #186 review, data request 2 (lead, 2026-11-03): threatOf gave 'fight' to the ender dragon, the
// wither, the ghast and the blaze, and a hostile 'fight' to the zombie horse. Plus the gorgon, found
// look-triggered in the #187 review. Offline: the catalog reads packages/rotn-data/3.3.4 only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pack = loadRotnData('3.3.4');
const reactions = JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/threat-reactions.json'), 'utf8'));
const ev = (n) => pack.threatOf(n).evidence.join(' ');

test('bosses are avoided, ghast and blaze are ranged (take cover), the zombie horse is ignored', () => {
    const want = {
        'minecraft:ender_dragon': ['avoid', true, 'vanilla'],
        'minecraft:wither': ['avoid', true, 'vanilla'],
        'minecraft:ghast': ['take-cover', true, 'vanilla'],
        'minecraft:blaze': ['take-cover', true, 'vanilla'],
        'minecraft:zombie_horse': ['ignore', false, 'vanilla'],
        'iceandfire:gorgon': ['avoid', false, 'verified'],
    };
    for (const [n, [reaction, ranged, source]] of Object.entries(want)) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.ranged, t.source], [reaction, ranged, source], n);
        assert.notEqual(t.reaction, 'fight', n);
        assert.ok(t.summary && t.evidence.length > 0, `${n}: summary and evidence`);
    }
    // The zombie horse keeps the dump's level (its class is recorded as IMob); only the reaction changes.
    assert.equal(pack.threatOf('minecraft:zombie_horse').level, 'hostile');
});

test('their pack facts are cited: where they spawn and the configs that change them', () => {
    assert.match(ev('minecraft:ghast'), /spawndimensions ghast = -1 \(lines 1887-1889\)/);
    assert.match(ev('minecraft:blaze'), /only in Nether biomes' monster lists/);
    assert.match(ev('minecraft:blaze'), /roughmobsrevamped\.cfg attributes lines 77, 86, 95 and 104/);
    assert.match(ev('minecraft:wither'), /lines 233-235/);
    // None of them is a first-night overworld threat.
    const night = new Set(pack.nightThreats({ limit: 1000 }).map((t) => t.name));
    for (const n of ['minecraft:ender_dragon', 'minecraft:wither', 'minecraft:blaze', 'minecraft:zombie_horse', 'iceandfire:gorgon']) assert.ok(!night.has(n), n);
});

test('gorgon: its gaze kills a player who looks back; the entry marks it do-not-look', () => {
    assert.match(ev('iceandfire:gorgon'), /isEntityLookingAt\(gorgon, target, 0\.4\) and isEntityLookingAt\(target, gorgon, 0\.4\)/);
    assert.match(ev('iceandfire:gorgon'), /2\.147E9 damage/);
    assert.match(pack.threatOf('iceandfire:gorgon').summary, /Never look at it/);
    // The field threatOf returns once #187 (lookAt) is in; checked on the data here.
    assert.equal(reactions.entities['iceandfire:gorgon'].lookAt, false);
});
