// threatOf, nightThreats and threat-reactions.json (Phase 3 PR 3), on the committed RotN 3.3.4 data.
// Offline: the catalog reads packages/rotn-data/3.3.4 only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { isOverworldBiome } from '../src/biomes.js';
import { NIGHT_THREATS_NOT_REFLECTED } from '../src/threats.js';

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
        assert.ok(['documented', 'vanilla', 'verified', 'inferred'].includes(r.confidence), `${name}: confidence`);
        if (r.confidence === 'verified') assert.ok(r.evidence.some((e) => /\.jar[ :(]/.test(e)), `${name}: verified cites a jar`);
        if (r.confidence === 'inferred') assert.ok(r.evidence.some((e) => /not checked/.test(e)), `${name}: inferred says what was not checked`);
        assert.ok(r.summary && r.evidence?.length > 0, `${name}: summary and evidence`);
        if (r.confidence === 'documented') assert.ok(r.evidence.every((e) => e.includes('rotn-progression.md')), `${name}: documented means cited from the research`);
    }
    for (const r of reactions.classRules) {
        assert.ok(r.id && r.pattern && REACTIONS.includes(r.reaction), `class rule ${r.id}`);
        assert.ok([undefined, 'inferred', 'verified'].includes(r.confidence), `class rule ${r.id}: confidence`);
        if (r.confidence === 'verified') assert.ok(r.evidence.some((e) => /\.jar[ :(]/.test(e)), `class rule ${r.id}: verified cites a jar`);
        assert.ok(r.summary && r.evidence?.length > 0 && r.note, `class rule ${r.id}: summary, evidence, note`);
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
    assert.deepEqual([dragon.level, dragon.reaction, dragon.source], ['dangerous', 'avoid', 'override']);
    assert.ok(dragon.evidence.some((e) => /jar/.test(e)), 'the override\'s bytecode evidence');
    // A hostile mob without an entry or class rule (the wither skeleton: Nether only) gets the default.
    const wither = pack.threatOf('minecraft:wither_skeleton');
    assert.deepEqual([wither.level, wither.reaction, wither.source, wither.summary], ['hostile', 'fight', 'default', null]);
    const cow = pack.threatOf('animania:cow_holstein');
    assert.deepEqual([cow.level, cow.reaction], ['none', 'ignore']);
    // The enderman is IMob (hostile) but neutral in vanilla; its entry says so and is marked vanilla.
    const ender = pack.threatOf('minecraft:enderman');
    assert.deepEqual([ender.level, ender.reaction, ender.source], ['hostile', 'ignore-unless-provoked', 'vanilla']);
    assert.equal(pack.threatOf('nosuchmod:mob'), null);
});

test('#111 review (safety): no creeper variant in the dump is to be fought', () => {
    const E = pack.dump.entities.entities;
    const simple = (c) => c.slice(c.lastIndexOf('.') + 1);
    const creepers = Object.keys(E).filter((n) => /Creeper/.test(simple(E[n].class ?? '')) && pack.entity(n).hostile);
    assert.ok(creepers.length >= 19, `creeper classes in the dump: ${creepers.length}`);
    for (const n of creepers) {
        const t = pack.threatOf(n);
        assert.equal(t.reaction, 'keep-distance', n);
        assert.equal(t.explodes, true, n);
    }
    const fire = pack.threatOf('specialmobs:firecreeper');
    assert.deepEqual([fire.source, fire.rule], ['documented', undefined], 'the research names Fire Creepers');
    const special = pack.threatOf('specialmobs:specialcreeper');
    assert.deepEqual([special.source, special.rule], ['inferred', 'creeper-variants']);
    assert.match(special.note, /sheared creeper/);
    assert.equal(pack.threatOf('primitivemobs:rocket_creeper').reaction, 'keep-distance');
    assert.equal(pack.threatOf('minecraft:creeper').source, 'documented', 'an entry wins over a class rule');
});

test('#111 review: skeleton variants take cover; wither skeletons and the skeleton horse do not', () => {
    for (const n of ['specialmobs:sniperskeleton', 'specialmobs:knightskeleton', 'primitivemobs:skeleton_warrior', 'trumpetskeleton:trumpet_skeleton']) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.ranged, t.source, t.rule], ['take-cover', true, 'inferred', 'skeleton-variants'], n);
    }
    for (const n of ['minecraft:wither_skeleton', 'specialmobs:sniperwitherskeleton']) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.source], ['fight', 'default'], n);
    }
    assert.deepEqual([pack.threatOf('minecraft:skeleton_horse').level, pack.threatOf('minecraft:skeleton_horse').reaction], ['none', 'ignore'], 'class rules apply to hostile mobs only');
});

test('#111 review: what threatOf and nightThreats do not reflect is stated', () => {
    const text = NIGHT_THREATS_NOT_REFLECTED.join('\n');
    for (const re of [/Special Mobs/, /Light level/, /Mob Stages/, /Invasions/, /MultiMob/]) assert.match(text, re);
    // Special Mobs variants are in no spawn list.
    assert.ok(!pack.nightThreats({ limit: 1000 }).some((t) => t.name.startsWith('specialmobs:')));
    // The custom-name gap: a rabbit named "Killer" targets players, but threatOf takes no name.
    assert.equal(pack.threatOf('animania:buck_chinchilla').level, 'none');
});

test('#111 follow-up: overworld mobs that defaulted to fight', () => {
    const want = {
        'minecraft:stray': ['take-cover', true, 'inferred'],
        'minecraft:witch': ['take-cover', true, 'vanilla'],
        'minecraft:illusion_illager': ['take-cover', true, 'vanilla'],
        'iceandfire:dread_lich': ['take-cover', true, 'verified'],
        'iceandfire:if_troll': ['avoid', false, 'verified'],
    };
    for (const [n, [reaction, ranged, source]] of Object.entries(want)) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.level, t.reaction, t.ranged, t.source], ['hostile', reaction, ranged, source], n);
    }
    assert.equal(pack.threatOf('minecraft:stray').rule, 'skeleton-variants');
    // All five are overworld night threats, and none of them reads 'fight' there any more.
    const night = new Map(pack.nightThreats({ limit: 1000 }).map((t) => [t.name, t]));
    for (const n of Object.keys(want)) {
        assert.ok(night.has(n), `${n} spawns in the overworld at night`);
        assert.notEqual(night.get(n).reaction, 'fight', n);
    }
});

test('cited follow-up: the mobs the lead listed, read from the mods bytecode (or vanilla)', () => {
    const want = {
        'quark:ashen': ['take-cover', true, 'verified'],
        'quark:dweller': ['fight', false, 'verified'],
        'minecraft:guardian': ['take-cover', true, 'vanilla'],
        'minecraft:vindication_illager': ['avoid', false, 'vanilla'],
        'iceologer:iceologer': ['take-cover', true, 'verified'],
        'mowziesmobs:naga': ['take-cover', true, 'verified'],
        'rats:illager_piper': ['fight', false, 'verified'],
        'ancientbeasts:bonepile': ['take-cover', true, 'verified'],
        'ancientbeasts:boulderer': ['fight', false, 'verified'],
        'ancientbeasts:damcell': ['take-cover', true, 'verified'],
        'ancientbeasts:rifted_enderman': ['ignore-unless-provoked', false, 'verified'],
        'ancientbeasts:frost_walker': ['take-cover', true, 'verified'],
        'ancientbeasts:ghost': ['fight', false, 'verified'],
        'ancientbeasts:giant_zombie': ['avoid', false, 'verified'],
        'ancientbeasts:nekros': ['fight', false, 'verified'],
        'ancientbeasts:zealot': ['fight', false, 'verified'],
        'ancientbeasts:sandy': ['avoid', true, 'verified'],
        'minecraft:slime': ['fight', false, 'vanilla'],
        'charm:spectre': ['fight', false, 'verified'],
    };
    for (const [n, [reaction, ranged, source]] of Object.entries(want)) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.ranged, t.source], [reaction, ranged, source], n);
        assert.ok(t.summary && t.evidence.length > 0, `${n}: summary and evidence`);
    }
    // The troll's numbers are the pack's config, not Ice and Fire's defaults.
    assert.match(pack.threatOf('iceandfire:if_troll').evidence.join(' '), /ice_and_fire\.cfg.*Troll Attack Strength"=18\.0.*Troll Max Health"=200\.0/);
    // Second cited follow-up: the lich's minions and staff, the ghost's possession, the spectre's pack config.
    assert.match(pack.threatOf('iceandfire:dread_lich').summary, /up to 5 minions/);
    assert.match(pack.threatOf('iceandfire:dread_lich').evidence.join(' '), /lich_staff.*getMinionCount\(\) < 5/);
    assert.match(pack.threatOf('ancientbeasts:sandy').summary, /only while untamed/);
    assert.doesNotMatch(pack.threatOf('ancientbeasts:ghost').summary, /not traced/);
    assert.match(pack.threatOf('ancientbeasts:ghost').summary, /Possessed effect for 20 s and deals 4 damage/);
    assert.match(pack.threatOf('charm:spectre').evidence.join(' '), /charm\.cfg.*"Apply curse"=true.*"Spawn depth"=24/);
    // Slime and spectre were the two largest overworld defaults (about 10.5% of spawn weight each).
    const defaults = pack.nightThreats({ limit: 1000 }).filter((t) => pack.threatOf(t.name).source === 'default');
    assert.ok(defaults.every((t) => t.share < 0.02), `every remaining default is under 2%: ${defaults.map((t) => t.name).join(', ')}`);
    // No inferred entry is left (the lead's review remark is not evidence).
    assert.deepEqual(Object.entries(reactions.entities).filter(([, r]) => r.confidence === 'inferred').map(([n]) => n), []);
});

// Follow-up 2 (#140 note), narrowed after the #143 review: Special Mobs enderman and witch variants.
test('Special Mobs enderman and witch variants: vanilla reaction (inferred), each variant named', () => {
    const enders = ['blindingenderman', 'icyenderman', 'lightningenderman', 'minienderman', 'mirageenderman', 'thiefenderman', 'specialenderman'];
    const witches = ['dominationwitch', 'shadowswitch', 'undeadwitch', 'wildswitch', 'windwitch', 'specialwitch'];
    for (const n of enders) {
        const t = pack.threatOf(`specialmobs:${n}`);
        assert.deepEqual([t.reaction, t.source, t.rule], ['ignore-unless-provoked', 'inferred', 'enderman-variants'], n);
        assert.ok(t.variantNote, `${n} has a variant note`);
    }
    for (const n of witches) {
        const t = pack.threatOf(`specialmobs:${n}`);
        assert.deepEqual([t.reaction, t.ranged, t.source, t.rule], ['take-cover', true, 'inferred', 'witch-variants'], n);
        assert.ok(t.variantNote, `${n} has a variant note`);
    }
    // The behaviours the review found are named, with the bytecode method.
    assert.match(pack.threatOf('specialmobs:thiefenderman').variantNote, /teleportTargetRandomly/);
    assert.match(pack.threatOf('specialmobs:blindingenderman').variantNote, /12 blocks/);
    assert.match(pack.threatOf('specialmobs:mirageenderman').variantNote, /fake/);
    assert.match(pack.threatOf('specialmobs:undeadwitch').variantNote, /EntitySkeleton/);
    assert.match(pack.threatOf('specialmobs:wildswitch').variantNote, /EntityBabySpider/);
    assert.match(pack.threatOf('specialmobs:dominationwitch').variantNote, /10 and 14 blocks/);
    assert.match(pack.threatOf('specialmobs:windwitch').variantNote, /teleport/i);
    // The rules claim as verified only that the targeting AI is vanilla, and no longer that no variant refers to players.
    for (const id of ['enderman-variants', 'witch-variants']) {
        const r = reactions.classRules.find((x) => x.id === id);
        assert.match(r.evidence[0], /verified only that the targeting AI is vanilla/);
        assert.ok(!r.evidence.join(' ').includes('none refers to EntityPlayer'), id);
        // Every variant key is a real entity that the rule matches.
        for (const n of Object.keys(r.variants)) {
            assert.ok(pack.names.entities.has(n), n);
            assert.equal(pack.threatOf(n).rule, id, n);
        }
    }
    // Witch spiders are spiders: no witch rule.
    for (const n of ['witchspider', 'witchcavespider']) assert.equal(pack.threatOf(`specialmobs:${n}`).rule, undefined, n);
    // Entries win over the rules.
    assert.deepEqual([pack.threatOf('minecraft:enderman').source, pack.threatOf('minecraft:witch').source], ['vanilla', 'vanilla']);
    assert.equal(pack.threatOf('ancientbeasts:rifted_enderman').source, 'verified');
    assert.equal(pack.threatOf('ancientbeasts:rifted_enderman').rule, undefined);
    // No hostile enderman or witch class in the dump is left to the default 'fight'.
    for (const [n, e] of Object.entries(pack.dump.entities.entities)) {
        const simple = (e.class ?? '').split('.').pop();
        if (!/(Enderman|Witch)$/.test(simple) || !pack.entity(n).hostile) continue;
        assert.notEqual(pack.threatOf(n).reaction, 'fight', n);
    }
    assert.equal(pack.threatOf('specialmobs:specialcreeper').source, 'inferred');
    assert.equal(pack.threatOf('specialmobs:specialcreeper').variantNote, undefined);
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

// The lead's G3 pick (2026-11-03): the 14 overworld night mobs that still defaulted to 'fight', each
// cited from its mod's bytecode (javap on the pinned pack's jars) and the pack's configs, or vanilla.
test('the last 14 overworld night defaults are cited; no overworld night threat is left to the default', () => {
    const want = {
        'mod_lavacow:zombiemushroom': ['fight', false, 'verified'],
        'mod_lavacow:mummy': ['fight', false, 'verified'],
        'mod_lavacow:zombiefrozen': ['avoid', false, 'verified'],
        'mod_lavacow:sludgelord': ['avoid', true, 'verified'],
        'defiledlands:host': ['fight', false, 'verified'],
        'defiledlands:scuttler': ['fight', false, 'verified'],
        'defiledlands:shambler': ['avoid', false, 'verified'],
        'defiledlands:shambler_twisted': ['avoid', false, 'verified'],
        'mowziesmobs:grottol': ['ignore', false, 'verified'],
        'mowziesmobs:foliaath': ['keep-distance', false, 'verified'],
        'mowziesmobs:barakoana': ['avoid', false, 'verified'],
        'betteranimalsplus:tarantula': ['avoid', true, 'verified'],
        'minecraft:husk': ['fight', false, 'vanilla'],
        'minecraft:zombie_villager': ['fight', false, 'vanilla'],
    };
    for (const [n, [reaction, ranged, source]] of Object.entries(want)) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.ranged, t.source], [reaction, ranged, source], n);
        assert.ok(t.summary && t.evidence.length > 0, `${n}: summary and evidence`);
    }
    const defaults = pack.nightThreats({ limit: 1000 }).filter((t) => pack.threatOf(t.name).source === 'default');
    assert.deepEqual(defaults.map((t) => t.name), []);
    // Key facts a reviewer can recheck in the bytecode or the pack's configs.
    const ev = (n) => pack.threatOf(n).evidence.join(' ');
    assert.match(ev('defiledlands:shambler'), /SLOWNESS|Slowness/);
    assert.match(ev('defiledlands:shambler'), /EntityDamageSourceIndirect/);
    assert.match(ev('mod_lavacow:zombiefrozen'), /roughmobsrevamped\.cfg lines 266-268/);
    assert.match(ev('mowziesmobs:grottol'), /mowziesmobs\.cfg.*lines 324-326/);
    assert.match(ev('betteranimalsplus:tarantula'), /EntityTarantulaHair/);
    // What the workers could not settle stays visible in the evidence.
    assert.ok(Object.keys(want).filter((n) => /Not settled: /.test(ev(n))).length >= 10);
});

// #178/#179 review (lead): citations name the pack's own paths (scripts/..., config/..., the jar's
// file name in mods/), never the author's scratch folders.
test('threat-reactions.json cites pack paths, not scratch paths', () => {
    const text = JSON.stringify(reactions);
    for (const re of [/packfiles\//, /SCRATCH/, /scratchpad/i, /fishs-undead-rising/]) assert.doesNotMatch(text, re);
    assert.match(pack.threatOf('mod_lavacow:mummy').evidence[0], /^Fish's Undead Rising-1\.3\.2\.jar \(in the pack as mods\//);
    assert.ok(Object.values(reactions.entities).flatMap((e) => e.evidence).some((e) => e.startsWith('scripts/fishsundeadrising.zs')));
});
