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

test('bosses are avoided, ghast and blaze are ranged (take cover), the zombie horse is fought', () => {
    const want = {
        'minecraft:ender_dragon': ['avoid', true, 'vanilla'],
        'minecraft:wither': ['avoid', true, 'vanilla'],
        'minecraft:ghast': ['take-cover', true, 'vanilla'],
        'minecraft:blaze': ['take-cover', true, 'vanilla'],
        'minecraft:zombie_horse': ['fight', false, 'verified'],
        'iceandfire:gorgon': ['avoid', false, 'verified'],
    };
    for (const [n, [reaction, ranged, source]] of Object.entries(want)) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.ranged, t.source], [reaction, ranged, source], n);
        if (n !== 'minecraft:zombie_horse') assert.notEqual(t.reaction, 'fight', n);
        assert.ok(t.summary && t.evidence.length > 0, `${n}: summary and evidence`);
    }
    // The zombie horse is hostile on this pack: The Hordes makes it IMob and gives it zombie AI.
    const zh = pack.threatOf('minecraft:zombie_horse');
    assert.equal(zh.level, 'hostile');
    assert.match(zh.evidence.join(' '), /MixinAbstractHorse.*EntityAINearestAttackableTarget for EntityPlayer/);
    assert.match(zh.evidence.join(' '), /hordes\.cfg misc\.aggressiveZombieHorses=true \(line 131\)/);
});

test('their pack facts are cited: where they spawn and the configs that change them', () => {
    assert.match(ev('minecraft:ghast'), /spawndimensions ghast = -1 \(lines 1887-1889\)/);
    assert.match(ev('minecraft:blaze'), /only in Nether biomes' monster lists/);
    assert.match(ev('minecraft:blaze'), /roughmobsrevamped\.cfg attributes lines 77, 86, 95 and 104/);
    assert.match(ev('minecraft:wither'), /lines 233-235/);
    // None of them is a first-night overworld threat.
    const night = new Set(pack.nightThreats({ limit: 1000 }).map((t) => t.name));
    for (const n of ['minecraft:ender_dragon', 'minecraft:wither', 'minecraft:ghast', 'minecraft:blaze', 'minecraft:zombie_horse', 'iceandfire:gorgon']) assert.ok(!night.has(n), n);
});

test('gorgon: its gaze kills a player who looks back; the entry marks it do-not-look', () => {
    assert.match(ev('iceandfire:gorgon'), /isEntityLookingAt\(gorgon, target, 0\.4\) and isEntityLookingAt\(target, gorgon, 0\.4\)/);
    assert.match(ev('iceandfire:gorgon'), /2\.147E9 damage/);
    assert.match(pack.threatOf('iceandfire:gorgon').summary, /Never look at it/);
    // In the data, and through threatOf's lookAt (#187).
    assert.equal(reactions.entities['iceandfire:gorgon'].lookAt, false);
    assert.equal(pack.threatOf('iceandfire:gorgon').lookAt, false);
});

// #188 review follow-up (lead): the ghast and blaze variants from Special Mobs, NetherEx and Twilight
// Forest still returned 'fight'. A class rule covers them; the two bosses get 'avoid' entries.
test('every hostile ghast or blaze class in the dump is covered; ranged ones take cover, the six melee Special Mobs variants are fought', () => {
    const E = pack.dump.entities.entities;
    const simple = (c) => (c ?? '').slice((c ?? '').lastIndexOf('.') + 1);
    const names = Object.keys(E).filter((n) => /Ghast|Blaze/.test(simple(E[n].class)) && pack.entity(n).hostile);
    assert.ok(names.length >= 20, `ghast and blaze classes: ${names.length}`);
    for (const n of names) {
        const t = pack.threatOf(n);
        assert.notEqual(t.source, 'default', n);
        if (t.rule === 'melee-ghast-blaze-variants') continue;
        assert.ok(['take-cover', 'avoid'].includes(t.reaction), `${n}: ${t.reaction}`);
        assert.equal(t.ranged, true, n);
    }
    // #191 review: six Special Mobs variants call disableRangedAI(); they melee, so they are fought.
    const melee = names.filter((n) => pack.threatOf(n).rule === 'melee-ghast-blaze-variants').sort();
    assert.deepEqual(melee, ['specialmobs:babyghast', 'specialmobs:cinderblaze', 'specialmobs:emberblaze', 'specialmobs:fighterghast', 'specialmobs:joltblaze', 'specialmobs:unholyghast']);
    for (const n of melee) assert.deepEqual([pack.threatOf(n).reaction, pack.threatOf(n).ranged, pack.threatOf(n).source], ['fight', false, 'verified'], n);
    assert.match(pack.threatOf('specialmobs:fighterghast').evidence.join(' '), /disableRangedAI.*EntityAIFlyingAttackMelee/);
    assert.equal(names.filter((n) => pack.threatOf(n).rule === 'ghast-blaze-variants').length, 11);
    // The ranged rule matches NetherEx's ghastling (not ending in Ghast) and the ranged Special Mobs variants.
    for (const n of ['netherex:ghastling', 'specialmobs:kingghast', 'specialmobs:specialblaze', 'specialmobs:wildfireblaze', 'twilightforest:tower_ghast', 'twilightforest:mini_ghast']) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.ranged, t.source, t.rule], ['take-cover', true, 'inferred', 'ghast-blaze-variants'], n);
    }
    // The bosses are avoided (entries win over the rule).
    for (const n of ['netherex:ghast_queen', 'twilightforest:ur_ghast']) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.ranged, t.source], ['avoid', true, 'verified'], n);
        assert.match(t.evidence[0], /\.boss\.Entity/);
    }
    // Fireball projectiles are not hostile, so the rule does not touch them.
    for (const n of ['netherex:ghast_queen_fireball', 'netherex:ghastling_fireball']) {
        assert.deepEqual([pack.threatOf(n).level, pack.threatOf(n).reaction], ['none', 'ignore'], n);
    }
});
