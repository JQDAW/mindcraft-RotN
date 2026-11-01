// Entity threat overrides beyond IMob (3.3.4/entity-overrides.json; lead request after net-forge #56:
// Ice and Fire's dragons came out passive because the dump's `hostile` is IMob only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadRotnData, isDangerous, entity } from '../index.js';

const require = createRequire(import.meta.url);
const pack = loadRotnData('3.3.4');
const overrides = require('../3.3.4/entity-overrides.json');
const skip = pack.hasDump ? false : 'no 3.3.4 dump imported';

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
    // Small player-targeting animals are hostile but not dangerous.
    assert.equal(entity('animania:doe_dutch').hostile, true);
    assert.equal(isDangerous('animania:doe_dutch'), false);
});
