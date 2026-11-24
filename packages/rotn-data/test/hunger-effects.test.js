// Low food on the pack (soak 14, net-forge item D): hunger-effects.json against the pack's
// HungerOverhaul.cfg, server.properties and the javap excerpts in fixtures/hunger-effects-3.3.4/
// (Hunger Overhaul 1.3.3, AppleCore 3.4.0 and the vanilla server jar of the pinned pack zip; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/hunger-effects-3.3.4');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');
const data = loadRotnData('3.3.4').hungerEffectsData;
const javap = read('hunger-effects.javap.txt');
const section = (title) => {
    const i = javap.indexOf(`\n## ${title}\n`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return javap.slice(i + 1).split(/\n## /)[0];
};
/** One method's code from a section, by a unique substring of its javap signature line. */
const method = (sec, sig) => {
    const parts = sec.split(/\n(?= {2}\S)/).filter((p) => p.split('\n')[0].includes(sig));
    assert.equal(parts.length, 1, `method ${sig}`);
    return parts[0];
};
/** Bytecode lines as [offset, text] pairs. */
const code = (text) => [...text.matchAll(/^\s+(\d+): (.*)$/gm)].map((m) => [Number(m[1]), m[2].trim()]);

const EFFECT_FIELDS = {
    field_76421_d: 'minecraft:slowness',
    field_76419_f: 'minecraft:mining_fatigue',
    field_76437_t: 'minecraft:weakness',
    field_76431_k: 'minecraft:nausea',
};
const constOf = (t) => {
    let m = t.match(/^iconst_(m1|\d)$/);
    if (m) return m[1] === 'm1' ? -1 : Number(m[1]);
    m = t.match(/^bipush\s+(-?\d+)$/);
    return m ? Number(m[1]) : null;
};

/**
 * The low-food ladder read from onLivingUpdate: for each PotionEffect it builds, the food bound
 * (iload 5 = food, iconst N, if_icmple), the optional difficulty floor (iload 8 = d, iconst K,
 * if_icmplt) and the amplifier expression pushed after the 19-tick duration. Also where a failed
 * floor jumps to (floorTarget), where the tier began (start: the getstatic two lines before its food
 * bound) and the first offset after its addPotionEffect (after), for the fall-through check.
 */
function ladderFromBytecode() {
    const lines = code(method(section('HungerOverhaul HungerOverhaulEventHook'), 'onLivingUpdate'));
    const tiers = {};
    const raw = {};
    let food = null; let minDifficulty = 0; let start = null; let floorTarget = null;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i][1];
        if (t === 'iload         5' && lines[i + 2]?.[1].startsWith('if_icmple')) {
            food = constOf(lines[i + 1][1]); minDifficulty = 0; floorTarget = null;
            start = lines[i - 2][0];
            assert.match(lines[i - 2][1], /^getstatic .*Config\.addLowHunger/, `tier start at ${start}`);
        }
        if (t === 'iload         8' && lines[i + 2]?.[1].startsWith('if_icmplt')) {
            minDifficulty = constOf(lines[i + 1][1]);
            floorTarget = Number(lines[i + 2][1].split(/\s+/)[1]);
        }
        const f = Object.keys(EFFECT_FIELDS).find((k) => t.includes(`MobEffects.${k}`));
        if (!f) continue;
        assert.equal(lines[i + 1][1], 'bipush        19', 'duration 19 ticks');
        // The amplifier: "iload 8" (d), "c iload 8 iadd" (d + c) or a constant.
        const a = lines.slice(i + 2, i + 5).map((x) => x[1]);
        let amplifier;
        if (a[0] === 'iload         8') amplifier = 'd';
        else if (a[1] === 'iload         8' && a[2] === 'iadd') {
            const c = constOf(a[0]);
            amplifier = c < 0 ? `d - ${-c}` : `d + ${c}`;
        } else amplifier = String(constOf(a[0]));
        const add = lines.findIndex((x, k) => k > i && x[1].includes('func_70690_d'));
        (tiers[EFFECT_FIELDS[f]] ??= []).push({ foodAtMost: food, minDifficulty, amplifier });
        (raw[EFFECT_FIELDS[f]] ??= []).push({ start, floorTarget, after: lines[add + 1][0] });
    }
    return { tiers, raw };
}

const amp = (expr, d) => {
    if (expr === 'd') return d;
    const m = expr.match(/^d ([+-]) (\d+)$/);
    return m ? d + (m[1] === '+' ? 1 : -1) * Number(m[2]) : Number(expr);
};
/** The effects at a food level and difficulty: the first tier whose food bound and difficulty floor both hold. */
function effectsAt(tiers, food, d) {
    const out = {};
    for (const [effect, list] of Object.entries(tiers)) {
        const tier = list.find((t) => food <= t.foodAtMost && d >= t.minDifficulty);
        if (tier) out[effect] = amp(tier.amplifier, d);
    }
    return out;
}

test('the low-food tiers are the ones onLivingUpdate builds (food bound, difficulty floor, amplifier, 19 ticks)', () => {
    assert.deepEqual(data.effects.tiers, ladderFromBytecode().tiers);
});

test('#611 review 5: a tier whose floor fails falls through to the next tier (the last one to the end of the effect)', () => {
    const { raw } = ladderFromBytecode();
    for (const [effect, list] of Object.entries(raw)) {
        list.forEach((t, k) => {
            if (t.floorTarget === null) return;
            const want = k + 1 < list.length ? list[k + 1].start : t.after;
            assert.equal(t.floorTarget, want, `${effect} tier ${k + 1}`);
        });
    }
    assert.match(data.effects.rule, /first tier whose food bound and difficulty floor both hold/);
});

test('the table at the server difficulty follows from the tiers; nothing at food 5 or more on Normal', () => {
    assert.equal(data.serverDifficulty, 2);
    const byFood = data.effects.byFoodAtServerDifficulty;
    for (let food = 0; food <= 20; food++) {
        const want = effectsAt(data.effects.tiers, food, data.serverDifficulty);
        assert.deepEqual(byFood[String(food)] ?? {}, want, `food ${food}`);
    }
    // net-forge's soak 14 table: Mining Fatigue I at food 4, II at 3, III at 2, IV at 1 and 0.
    assert.deepEqual([4, 3, 2, 1, 0].map((f) => byFood[f]['minecraft:mining_fatigue']), [0, 1, 2, 3, 3]);
    // On Hard a fifth tier starts at food 5; on Peaceful food 2 still gives level I.
    assert.equal(effectsAt(data.effects.tiers, 5, 3)['minecraft:slowness'], 0);
    assert.equal(effectsAt(data.effects.tiers, 2, 0)['minecraft:mining_fatigue'], 0);
});

test('d is the world difficulty id when difficultyScalingEffects is on (2 otherwise); every 10 ticks', () => {
    const m = method(section('HungerOverhaul HungerOverhaulEventHook'), 'onLivingUpdate');
    const i = m.indexOf('Config.difficultyScalingEffects');
    assert.ok(i > 0);
    const after = m.slice(i, i + 1200);
    assert.ok(after.indexOf('func_151525_a') > 0, 'EnumDifficulty.getDifficultyId');
    assert.match(m.slice(m.lastIndexOf('iconst_2', i), i), /istore\s+8/, 'd starts at 2');
    // The NBT countdown: set to 9 after a run, counted down and removed on the following ticks.
    assert.match(m, /String HungerOverhaulCheck[\s\S]*bipush\s+9[\s\S]*func_74768_a/);
});

test('the dig factor per Mining Fatigue level is vanilla getDigSpeed\'s, level by level (#611 review 2)', () => {
    const m = section('Vanilla EntityPlayer.getDigSpeed');
    const sw = m.match(/tableswitch\s+\{ \/\/ 0 to 3\n([\s\S]*?)\n\s+default: (\d+)/);
    assert.ok(sw, 'the tableswitch on the amplifier');
    const cases = Object.fromEntries([...sw[1].matchAll(/^\s+(\d+): (\d+)$/gm)].map((x) => [x[1], Number(x[2])]));
    assert.deepEqual(Object.keys(cases), ['0', '1', '2', '3']);
    assert.equal(Number(sw[2]), cases['3'], 'amplifier 4 and above use the level-IV factor');
    const at = Object.fromEntries(code(m).map(([o, t]) => [o, t]));
    const factor = Object.fromEntries(Object.keys(data.effects.miningFatigueDigFactor).filter((k) => k !== 'note').map((k) => [k, data.effects.miningFatigueDigFactor[k]]));
    assert.deepEqual(Object.keys(factor), ['0', '1', '2', '3']);
    for (const [amplifier, offset] of Object.entries(cases)) {
        const f = at[offset].match(/float ([0-9.E-]+)f/);
        assert.ok(f, `case ${amplifier} loads a float`);
        assert.equal(factor[amplifier], Number(f[1]), `amplifier ${amplifier}`);
    }
});

test('starvation: 80 ticks at food 0, then Hunger Overhaul\'s damageOnStarve (200) whatever the difficulty or health', () => {
    const period = section('AppleCore StarvationEvent');
    assert.match(period, /GetStarveTickPeriod\(net[^\n]*\n[\s\S]*?bipush\s+80/);
    const starve = method(section('HungerOverhaul FoodEventHandler'), 'onStarve');
    assert.match(starve, /Config\.damageOnStarve:I[\s\S]*putfield[^\n]*starveDamage/);
    assert.doesNotMatch(starve, /if/, 'no condition before setting the damage');
    const hooks = method(section('AppleCore Hooks'), 'onAppleCoreFoodStatsUpdate');
    assert.match(hooks, /fireStarveEvent[\s\S]*DamageSource\.field_76366_f[\s\S]*starveDamage[\s\S]*func_70097_a/);
    assert.equal(data.starvation.ticksAtZero, 80);
    assert.equal(data.starvation.damage, data.config.damageOnStarve.value);
});

test('the drain numbers follow from the bytecode and config', () => {
    const m = method(section('HungerOverhaul HungerOverhaulEventHook'), 'onLivingUpdate');
    assert.match(m, /Config\.constantHungerLoss:Z[\s\S]*?ldc\s+#\d+\s+\/\/ float 0\.01f\s*\n[^\n]*func_71020_j/);
    const max = method(section('HungerOverhaul FoodEventHandler'), 'getMaxExhaustion');
    assert.match(max, /hungerLossRatePercentage:F[\s\S]*float 100\.0f[\s\S]*fdiv[\s\S]*fdiv/);
    const rate = data.config.hungerLossRatePercentage.value;
    assert.equal(data.drain.constantExhaustionPerTick, 0.01 / 10);
    assert.ok(Math.abs(data.drain.maxExhaustionAtServerDifficulty - 4 / (rate / 100)) < 1e-3);
    const seconds = data.drain.maxExhaustionAtServerDifficulty / data.drain.constantExhaustionPerTick / 20;
    assert.ok(Math.abs(data.drain.secondsPerPointAtRest - seconds) < 0.1);
    const regen = method(section('HungerOverhaul FoodEventHandler'), 'allowHealthRegen');
    assert.match(regen, /func_75116_a[\s\S]*Config\.minHungerToHeal:I[\s\S]*if_icmplt/);
    assert.equal(data.regeneration.minFood, data.config.minHungerToHeal.value);
    // #611 review 1: the sealed night of soak 14 measured the rest drain.
    const seen = data.drain.observed;
    assert.ok(Math.abs(seen.sealedSecondsPerPoint - data.drain.secondsPerPointAtRest) / data.drain.secondsPerPointAtRest < 0.05);
    assert.ok(seen.activeSecondsPerPoint.every((x) => x < data.drain.secondsPerPointAtRest));
});

test('#611 review 3: ordinary regeneration costs no food; saturated regeneration (food 20) still costs exhaustion', () => {
    const fe = section('HungerOverhaul FoodEventHandler');
    const onRegen = method(fe, 'onHealthRegen(');
    assert.match(onRegen, /Config\.disableHealingHungerDrain:Z\s*\n[^\n]*ifeq[\s\S]*fconst_0\s*\n[^\n]*putfield[^\n]*Regen\.deltaExhaustion/);
    assert.equal(data.config.disableHealingHungerDrain.value, true);
    assert.doesNotMatch(fe, /SaturatedRegen/, 'Hunger Overhaul has no SaturatedRegen handler');
    const hooks = method(section('AppleCore Hooks'), 'onAppleCoreFoodStatsUpdate');
    // The default saturated-regen check: saturation > 0, the player hurt, food >= 20.
    assert.match(hooks, /fireAllowSaturatedRegenEvent[\s\S]*?func_75115_e[\s\S]*?func_70996_bM[\s\S]*?func_75116_a:\(\)I\s*\n[^\n]*bipush\s+20/);
    assert.match(hooks, /SaturatedRegen\.deltaExhaustion:F\s*\n[^\n]*FoodStats\.func_75113_a/);
    const sat = section('AppleCore HealthRegenEvent');
    assert.match(sat, /func_75115_e[\s\S]*float 6\.0f[\s\S]*Math\.min[\s\S]*putfield[^\n]*deltaExhaustion/);
    assert.match(data.regeneration.rule, /no SaturatedRegen handler/);
});

test('every cited config value and line is the pack\'s; the server difficulty is server.properties\'', () => {
    const cfg = read('HungerOverhaul.cfg').split('\n');
    for (const [key, { value, line }] of Object.entries(data.config)) {
        const m = cfg[line - 1].match(new RegExp(`^\\s*[BIS]:${key}=(.*)$`));
        assert.ok(m, `${key} at line ${line}`);
        assert.equal(String(value), m[1].trim(), key);
    }
    assert.match(read('server.properties.excerpt.txt'), /^difficulty=2$/m);
    assert.equal(data.serverDifficulty, 2);
});
