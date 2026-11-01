// Entity threat overrides beyond IMob (3.3.4/entity-overrides.json; lead request after net-forge #56:
// Ice and Fire's dragons came out passive because the dump's `hostile` is IMob only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadRotnData, isDangerous, isReplaced, entity } from '../index.js';

const require = createRequire(import.meta.url);
const pack = loadRotnData('3.3.4');
const overrides = require('../3.3.4/entity-overrides.json');
const skip = pack.hasDump ? false : 'no 3.3.4 dump imported';

// The exact list is pinned, so any change to it is deliberate and reviewed.
const MARKED = {
    'betteranimalsplus:eel_freshwater': false, 'betteranimalsplus:eel_saltwater': false, 'betteranimalsplus:moose': false,
    'iceandfire:deathworm': true, 'iceandfire:firedragon': true, 'iceandfire:icedragon': true, 'iceandfire:if_cockatrice': true,
    'iceandfire:seaserpent': true, 'mod_lavacow:salamander': false, 'mod_lavacow:scarecrow': false, 'mod_lavacow:unburied': false,
    'primitivemobs:grovesprite': false, 'primitivemobs:lily_lurker': false,
}; // name -> dangerous

test('the override list is exactly the reviewed one (13 entries, 33 reviewed and not marked)', () => {
    assert.deepEqual(Object.keys(overrides.entities).sort(), Object.keys(MARKED).sort());
    assert.equal(Object.keys(overrides.entities).length, 13);
    for (const [name, dangerous] of Object.entries(MARKED)) {
        assert.equal(overrides.entities[name].dangerous, dangerous, name);
        assert.equal(overrides.entities[name].targetsPlayers, true, name);
    }
    assert.equal(Object.keys(overrides.reviewedNotMarked).length, 33);
    assert.equal(Object.keys(overrides.reviewedNotMarked).filter(n => /^animania:(buck|doe|kit)_/.test(n)).length, 24);
    assert.equal(overrides.entities['primitivemobs:grovesprite'].confidence, 'conditional');
});

test('every override is documented and names a real, non-IMob entity', () => {
    for (const k of ['description', 'method', 'confidence', 'entities', 'reviewedNotMarked']) assert.ok(overrides[k], k);
    for (const [name, o] of Object.entries(overrides.entities)) {
        assert.ok(pack.names.entities.has(name), `${name} is not in the 3.3.4 entity registry`);
        assert.equal(typeof o.targetsPlayers, 'boolean', name);
        assert.equal(typeof o.dangerous, 'boolean', name);
        assert.ok(Object.keys(overrides.confidence).includes(o.confidence), `${name}: confidence ${o.confidence}`);
        // Cited: the jar and a class or method from the bytecode review.
        assert.match(o.evidence, /\.jar: /, `${name}: evidence must name the jar`);
        assert.match(o.evidence, /(initEntityAI|func_\d+_\w+|constructor|resetAI|onUpdate|apply)/, `${name}: evidence must name the method`);
        if (pack.hasDump) assert.equal(pack.dump.entities.entities[name].hostile, false, `${name} already implements IMob; no override needed`);
    }
    for (const name of Object.keys(overrides.reviewedNotMarked)) {
        assert.ok(pack.names.entities.has(name), name);
        assert.ok(!(name in overrides.entities), `${name} is both marked and reviewed-not-marked`);
    }
});

test('Ice and Fire dragons are hostile and dangerous (net-forge #56 found them passive)', { skip }, () => {
    for (const name of ['iceandfire:firedragon', 'iceandfire:icedragon']) {
        const e = entity(name);
        assert.equal(e.imob, false, `${name}: the dump says it does not implement IMob`);
        assert.equal(e.hostile, true, name);
        assert.equal(e.targetsPlayers, true, name);
        assert.equal(e.dangerous, true, name);
        assert.equal(e.threat.confidence, 'verified');
        assert.match(e.threat.evidence, /DragonAITargetNonTamed\(EntityPlayer\.class/);
        assert.equal(isDangerous(name), true);
    }
    for (const name of ['iceandfire:seaserpent', 'iceandfire:deathworm', 'iceandfire:if_cockatrice']) assert.equal(isDangerous(name), true, name);
});

test('the mod-local entity table carries the same threat fields (what forge-bridge reads)', { skip }, () => {
    const e = entity('iceandfire:firedragon');
    const byId = pack.entityByModId(e.modId, e.modEntityTypeId);
    assert.equal(byId.name, 'iceandfire:firedragon');
    assert.equal(byId.hostile, true);
    assert.equal(byId.dangerous, true);
});

test('IMob mobs stay hostile without an override; reviewed retaliators stay passive', { skip }, () => {
    for (const name of ['iceandfire:cyclops', 'iceandfire:if_hydra', 'iceandfire:gorgon', 'iceandfire:if_troll', 'minecraft:zombie']) {
        const e = entity(name);
        assert.equal(e.hostile, true, name);
        assert.equal(e.imob, true, name);
        assert.equal(e.threat, undefined, name);
    }
    for (const name of Object.keys(overrides.reviewedNotMarked)) {
        assert.equal(entity(name).hostile, false, name);
        assert.equal(isDangerous(name), false, name);
    }
    // Ordinary animals are unchanged.
    for (const name of ['minecraft:cow', 'animania:cow_holstein', 'butterflies:butterfly']) {
        assert.equal(entity(name).hostile, false, name);
        assert.equal(entity(name).dangerous, false, name);
    }
    // Animania rabbits are passive: their player targeting is only for a rabbit named "Killer"
    // (PR #62 review; the first version of this list wrongly marked them).
    assert.equal(entity('animania:doe_dutch').hostile, false);
    assert.equal(entity('animania:doe_dutch').targetsPlayers, false);
    assert.equal(isDangerous('animania:doe_dutch'), false);
    assert.match(overrides.reviewedNotMarked['animania:doe_dutch'], /"Killer"/);
});

test('vanilla animals Animania replaces are marked, citing the pack config (G2 batch 1)', { skip }, () => {
    const replaced = overrides.replacedByMod.entities;
    assert.deepEqual(Object.keys(replaced).sort(), ['minecraft:chicken', 'minecraft:cow', 'minecraft:pig', 'minecraft:rabbit', 'minecraft:sheep']);
    for (const [name, r] of Object.entries(replaced)) {
        assert.match(r.config, /^config\/animania\.cfg:\d+ B:replaceVanilla\w+=true/, name);
        const e = entity(name);
        assert.equal(isReplaced(name), true, name);
        assert.equal(e.replacedBy.by, 'animania');
        assert.ok(e.replacedBy.replacements.length >= 15, `${name}: ${e.replacedBy.replacements.length} replacements`);
        assert.ok(e.replacedBy.replacements.every(n => n.startsWith('animania:')), name);
    }
    assert.ok(entity('minecraft:chicken').replacedBy.replacements.includes('animania:hen_leghorn'));
    assert.ok(entity('minecraft:pig').replacedBy.replacements.includes('animania:sow_duroc'));
    // Rabbits, not goats (both use buck/doe/kit names).
    assert.ok(entity('minecraft:rabbit').replacedBy.replacements.includes('animania:doe_dutch'));
    assert.ok(!entity('minecraft:rabbit').replacedBy.replacements.includes('animania:doe_alpine'));
    // replaceVanillaHorses=false, and other vanilla mobs are untouched.
    for (const name of ['minecraft:horse', 'minecraft:zombie', 'minecraft:mooshroom']) assert.equal(isReplaced(name), false, name);
});
