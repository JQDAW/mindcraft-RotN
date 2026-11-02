// threatOf, nightThreats and threat-reactions.json (Phase 3 PR 3), on the committed RotN 3.3.4 data.
// Offline: the catalog reads packages/rotn-data/3.3.4 only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { isOverworldBiome } from '../src/biomes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pack = loadRotnData('3.3.4');
const reactions = JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/threat-reactions.json'), 'utf8'));
const REACTIONS = ['fight', 'keep-distance', 'take-cover', 'avoid', 'ignore-unless-provoked', 'ignore'];

test('threat-reactions.json: well formed, cited, and every entity exists on the server and in the dump', () => {
    assert.equal(reactions.format, 'rotn-threat-reactions/1');
    assert.ok(reactions.general.summary && reactions.general.evidence.length > 0);
    for (const [name, r] of Object.entries(reactions.entities)) {
        assert.ok(pack.names.entities.has(name), `${name} is not synced`);
        assert.ok(pack.dump.entities.entities[name], `${name} is not in the dump`);
        assert.ok(REACTIONS.includes(r.reaction), `${name}: reaction ${r.reaction}`);
        assert.ok(['documented', 'vanilla'].includes(r.confidence), `${name}: confidence`);
        assert.ok(r.summary && r.evidence?.length > 0, `${name}: summary and evidence`);
        if (r.confidence === 'documented') assert.ok(r.evidence.every((e) => e.includes('rotn-progression.md')), `${name}: documented means cited from the research`);
    }
});

test('threatOf: the documented first-night mobs', () => {
    const creeper = pack.threatOf('minecraft:creeper');
    assert.deepEqual([creeper.level, creeper.reaction, creeper.source, creeper.explodes], ['hostile', 'keep-distance', 'documented', true]);
    const skeleton = pack.threatOf('minecraft:skeleton');
    assert.deepEqual([skeleton.reaction, skeleton.ranged], ['take-cover', true]);
    assert.equal(pack.threatOf('minecraft:zombie').reaction, 'fight');
    assert.equal(pack.threatOf('minecraft:spider').reaction, 'fight');
    assert.match(pack.threatOf('minecraft:zombie').summary, /choke point/);
    assert.ok(pack.threatOf('minecraft:zombie').evidence.length > 0);
});

test('threatOf: defaults from the threat level; dangerous always means avoid', () => {
    const dragon = pack.threatOf('iceandfire:firedragon');
    assert.deepEqual([dragon.level, dragon.reaction, dragon.source], ['dangerous', 'avoid', 'default']);
    assert.ok(dragon.evidence.some((e) => /jar/.test(e)), 'the override\'s bytecode evidence');
    const spectre = pack.threatOf('charm:spectre');
    assert.deepEqual([spectre.level, spectre.reaction, spectre.source, spectre.summary], ['hostile', 'fight', 'default', null]);
    const cow = pack.threatOf('animania:cow_holstein');
    assert.deepEqual([cow.level, cow.reaction], ['none', 'ignore']);
    // The enderman is IMob (hostile) but neutral in vanilla; its entry says so and is marked vanilla.
    const ender = pack.threatOf('minecraft:enderman');
    assert.deepEqual([ender.level, ender.reaction, ender.source], ['hostile', 'ignore-unless-provoked', 'vanilla']);
    assert.equal(pack.threatOf('nosuchmod:mob'), null);
});

test('nightThreats: one biome, from its monster spawn list, hostile only, most likely first', () => {
    const plains = pack.nightThreats({ biome: 'minecraft:plains', limit: 100 });
    const names = plains.map((t) => t.name);
    for (const m of ['minecraft:zombie', 'minecraft:skeleton', 'minecraft:spider', 'minecraft:creeper']) assert.ok(names.includes(m), m);
    assert.ok(plains.every((t) => t.level !== 'none'), 'no passive mobs');
    assert.ok(!names.includes('quark:stoneling'), 'the stoneling spawns as a monster but is not hostile');
    assert.ok(!names.includes('minecraft:ghast'), 'MultiMob lists are not read');
    for (let i = 1; i < plains.length; i++) assert.ok(plains[i - 1].share >= plains[i].share, 'sorted by share');
    const sum = plains.reduce((a, t) => a + t.share, 0);
    assert.ok(Math.abs(sum - 1) < 0.01, `shares add up to 1 (${sum})`);
    const creeper = plains.find((t) => t.name === 'minecraft:creeper');
    assert.deepEqual([creeper.reaction, creeper.explodes, creeper.biomes], ['keep-distance', true, 1]);
    assert.equal(pack.nightThreats({ biome: 'minecraft:plains', limit: 3 }).length, 3);
});

test('nightThreats: default is every overworld biome; several biomes; unknown biome is empty', () => {
    const all = pack.nightThreats({ limit: 6 });
    assert.deepEqual(new Set(all.map((t) => t.name)), new Set(['minecraft:slime', 'charm:spectre', 'minecraft:creeper', 'minecraft:spider', 'minecraft:skeleton', 'minecraft:zombie']));
    assert.ok(all[0].biomes > 50, 'counted over many biomes');
    const two = pack.nightThreats({ biome: ['minecraft:plains', 'minecraft:forest'], limit: 100 });
    assert.ok(two.find((t) => t.name === 'minecraft:zombie').biomes === 2);
    assert.deepEqual(pack.nightThreats({ biome: 'nosuchmod:biome' }), []);
    assert.ok(!isOverworldBiome('minecraft:hell') && isOverworldBiome('minecraft:plains') && isOverworldBiome('iceandfire:glacier'));
});
