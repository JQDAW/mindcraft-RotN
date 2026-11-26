// Animals that fight back (lead task G4 #5, 2026-11-18): soak 2's 22:48 death was "gored to death", the
// Animania damage source "bull". threat-reactions.json's 'groups' (the Animania retaliators) and the
// panda, book wyrm, wolf, polar bear and llama entries, checked against the dump and against the javap
// excerpts in fixtures/animal-retaliation-3.3.4/ (from the pinned pack zip's jars; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const javap = fs.readFileSync(path.join(HERE, 'fixtures/animal-retaliation-3.3.4/animals.javap.txt'), 'utf8').replace(/\r\n/g, '\n');
const pack = loadRotnData('3.3.4');
const reactions = pack.threatReactions;
const E = pack.dump.entities.entities;
const group = (id) => reactions.groups.find((g) => g.id === id);

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
/** The order of the given substrings in a text (each must occur). */
const inOrder = (text, ...needles) => {
    let at = -1;
    for (const n of needles) {
        const i = text.indexOf(n, at + 1);
        assert.ok(i > at, `"${n}" after position ${at}`);
        at = i;
    }
};
/** Dump entities whose class's simple name matches. */
const byClass = (re) => Object.keys(E).filter((n) => re.test((E[n].class ?? '').slice((E[n].class ?? '').lastIndexOf('.') + 1))).sort();

test('groups: well formed, cited, members synced and in the dump, no name listed twice', () => {
    const seen = new Set(Object.keys(reactions.entities));
    for (const g of reactions.groups) {
        assert.ok(g.id && g.members.length > 0 && g.summary && g.evidence.length > 0, g.id);
        assert.ok(['ignore-unless-provoked', 'ignore'].includes(g.reaction), `${g.id}: reaction`);
        assert.equal(g.confidence, 'verified', g.id);
        assert.ok(g.evidence.some((e) => /\.jar[ :(]/.test(e)), `${g.id}: verified cites a jar`);
        for (const n of g.members) {
            assert.ok(pack.names.entities.has(n), `${n} is not synced`);
            assert.ok(E[n], `${n} is not in the dump`);
            assert.ok(!seen.has(n), `${n} listed twice`);
            seen.add(n);
        }
        const p = g.provoked;
        assert.ok(p && typeof p.damage === 'number' && typeof p.fightBack === 'boolean' && typeof p.callsForHelp === 'boolean', `${g.id}: provoked`);
    }
});

test('bulls: all eight animania:bull_* variants, every bull class in the dump, ignore unless provoked, do not fight back', () => {
    const bulls = group('animania-bulls');
    assert.deepEqual([...bulls.members].sort(), byClass(/^Cow\w+\$EntityBull\w+$/));
    assert.deepEqual([...bulls.members].sort(), Object.keys(E).filter((n) => /^animania:bull_/.test(n)).sort());
    assert.equal(bulls.members.length, 8);
    const classes = section('Animania bull classes');
    for (const n of bulls.members) {
        const t = pack.threatOf(n);
        // Level stays 'none': a bull is not IMob and seeks no player, so forge-bridge and isHostile are unchanged.
        assert.deepEqual([t.level, t.reaction, t.source, t.group], ['none', 'ignore-unless-provoked', 'verified', 'animania-bulls'], n);
        assert.equal(pack.entity(n).hostile, false, n);
        assert.deepEqual(
            [t.provoked.damage, t.provoked.health, t.provoked.reach, t.provoked.attackIntervalTicks, t.provoked.fightBack, t.provoked.callsForHelp],
            [5, 24, 2, 20, false, false], n);
        assert.equal(t.provoked.angerMetadata.index, 20, n);
        assert.match(classes, new RegExp(`class ${E[n].class.replace(/[.$]/g, '\\$&')} extends com\\.animania\\.common\\.entities\\.cows\\.EntityBullBase`), n);
    }
    assert.match(pack.threatOf('animania:bull_holstein').summary, /never attacks first/);
    assert.match(pack.threatOf('animania:bull_holstein').summary, /gored to death/);
    // A copy, so a caller cannot change the catalog.
    pack.threatOf('animania:bull_angus').provoked.damage = 99;
    assert.equal(pack.threatOf('animania:bull_angus').provoked.damage, 5);
});

test('bulls, from the bytecode: retaliation only, the attack needs animalsCanAttackOthers, 5 damage within 2 blocks, 24 health', () => {
    const bull = section('Animania EntityBullBase');
    inOrder(method(bull, 'EntityBullBase(net.minecraft.world.World)'),
        'float 1.6f', 'float 1.8f', 'float 1.1f', 'field_70138_W',
        'GameRules.animalsCanAttackOthers:Z', 'ifeq', 'getSterilized', 'ifne', 'field_70714_bg', 'iconst_0', 'class com/animania/common/entities/cows/ai/EntityAIAttackMeleeBulls', 'double 1.8d');
    inOrder(method(bull, 'func_70652_k'), 'func_70685_l', 'func_70032_d', 'fconst_2', 'fcmpg', 'ifgt', 'String bull', 'float 5.0f', 'func_70097_a', 'class net/minecraft/entity/player/EntityPlayer', 'func_70653_a');
    inOrder(method(bull, 'func_110147_ax'), 'field_111267_a', 'double 24.0d', 'field_111263_d', 'double 0.20000000298023224d');
    // The pack's config turns the attack on (fixture header, from the pinned zip).
    assert.match(javap, /config\/animania\.cfg:28 B:animalsCanAttackOthers=true/);
    // Nothing seeks players: the cow base only retaliates, and the bull adds no target task.
    const cow = method(section('Animania EntityAnimaniaCow'), 'EntityAnimaniaCow(net.minecraft.world.World)');
    const targetTasks = cow.split('\n').filter((l) => /field_70715_bh/.test(l)).length;
    assert.equal(targetTasks, 2);
    assert.equal((cow.match(/class net\/minecraft\/entity\/ai\/EntityAIHurtByTarget$/gm) ?? []).length, 2);
    assert.doesNotMatch(cow + method(bull, 'EntityBullBase(net.minecraft.world.World)'), /NearestAttackableTarget|TargetNonTamed/);
    assert.doesNotMatch(bull, /field_70715_bh/);
    // The attack AI: needs a target, sets FIGHTING, attacks every 20 ticks, clears FIGHTING on reset.
    const ai = section('Animania EntityAIAttackMeleeBulls');
    inOrder(method(ai, 'func_75250_a'), 'func_70638_az', 'ifnonnull', 'setFighting');
    inOrder(method(ai, 'func_190102_a'), 'getAttackReachSqr', 'bipush        20', 'func_70652_k');
    inOrder(method(ai, 'func_75251_c'), 'iconst_0', 'setFighting');
    assert.match(javap, /Special_AI\.cfg:24-33 S:depacify_list(?:[^\n]*\n#){2}[^\n]*\(no Animania entity/);
});

test('bulls: the FIGHTING metadata index is 20 (vanilla 0-12, seven EntityAnimaniaCow keys, then FIGHTING first)', () => {
    const cowStatic = method(section('Animania EntityAnimaniaCow'), 'static {}');
    const keys = (cowStatic.match(/func_187226_a/g) ?? []).length;
    assert.equal(keys, 7);
    const bullStatic = method(section('Animania EntityBullBase'), 'static {}');
    inOrder(bullStatic, 'func_187226_a', 'putstatic', 'FIGHTING');
    const firstPut = bullStatic.split('\n').find((l) => /putstatic/.test(l));
    assert.match(firstPut, /FIGHTING/);
    assert.match(bullStatic.split('FIGHTING')[0], /field_187198_h/); // BOOLEAN
    const VANILLA_AGEABLE_KEYS = 13; // Entity 0-5, EntityLivingBase 6-10, EntityLiving 11, EntityAgeable 12
    assert.equal(VANILLA_AGEABLE_KEYS + keys, group('animania-bulls').provoked.angerMetadata.index);
});

test('bulls spawn with cows: one in three of the breed\'s cows (while 4 or fewer are within 64 blocks) brings its male', () => {
    inOrder(method(section('Animania GenericBehavior'), 'initialSpawnFemale'),
        'iconst_3', 'java/util/Random.nextInt', 'double 64.0d', 'iconst_4', 'if_icmpgt', 'getMale', 'setMateUniqueId', 'func_70107_b', 'func_72838_d');
    assert.match(group('animania-bulls').summary, /one Animania cow in three spawns with a bull/);
});

test('cows fight back and call their breed; their hit is a "bull" hit too (gored to death)', () => {
    const cows = group('animania-cows');
    assert.deepEqual([...cows.members].sort(), byClass(/^Cow\w+\$EntityCow\w+$/));
    const sec = section('Animania EntityCowBase');
    inOrder(method(sec, 'EntityCowBase(net.minecraft.world.World)'),
        'field_70714_bg', 'class net/minecraft/entity/ai/EntityAIAttackMelee', 'double 1.2d', 'field_70715_bh', 'class net/minecraft/entity/ai/EntityAIHurtByTarget', 'iconst_1', 'iconst_0', 'anewarray');
    assert.doesNotMatch(method(sec, 'EntityCowBase(net.minecraft.world.World)'), /Config/);
    inOrder(method(sec, 'func_70652_k'), 'func_70032_d', 'fconst_2', 'String bull', 'fconst_2', 'func_70097_a');
    inOrder(method(sec, 'func_110147_ax'), 'double 18.0d', 'double 0.20000000298023224d', 'double 2.0d');
    for (const n of cows.members) {
        const t = pack.threatOf(n);
        // 'ignore', not 'ignore-unless-provoked': skills-rotn's !attack refuses the latter, and cows are food.
        assert.deepEqual([t.level, t.reaction, t.provoked.damage, t.provoked.health, t.provoked.callsForHelp, t.provoked.fightBack], ['none', 'ignore', 2, 18, true, true], n);
    }
    assert.match(javap, /en_US\.lang:319 death\.attack\.bull=%1\$s was gored to death/);
    assert.match(cows.summary, /no other cow of its breed within 16 blocks/);
});

test('the small Animania retaliators: hens and roosters, peafowl, ferrets, hedgehogs (from the bytecode)', () => {
    assert.deepEqual([...group('animania-hens').members].sort(), byClass(/^Chicken\w+\$EntityHen\w+$/));
    assert.deepEqual([...group('animania-roosters').members].sort(), byClass(/^Chicken\w+\$EntityRooster\w+$/));
    assert.deepEqual([...group('animania-peafowl').members].sort(), byClass(/^Peafowl\w+\$Entity(Peacock|Peafowl|Peachick)\w+$/));
    assert.deepEqual([...group('animania-ferrets').members].sort(), byClass(/^EntityFerret(Grey|White)$/));
    assert.deepEqual([...group('animania-hedgehogs').members].sort(), byClass(/^EntityHedgehog(Albino)?$/));
    // Retaliation: the chicken base adds EntityAIHurtByTarget(this, false) with no config check.
    inOrder(method(section('Animania EntityAnimaniaChicken'), 'EntityAnimaniaChicken(net.minecraft.world.World)'), 'field_70715_bh', 'iconst_0', 'EntityAIHurtByTarget', 'iconst_0', 'iconst_0');
    inOrder(method(section('Animania EntityAnimaniaChicken'), 'func_110147_ax'), 'double 6.0d');
    for (const [title, ctor] of [['Animania EntityHenBase', 'EntityHenBase(net.minecraft.world.World)'], ['Animania EntityRoosterBase', 'EntityRoosterBase(net.minecraft.world.World)']]) {
        inOrder(method(section(title), ctor), 'EntityAILeapAtTarget', 'EntityAIAttackMelee', 'animalsCanAttackOthers');
        inOrder(method(section(title), 'func_70652_k'), 'func_76358_a', 'fconst_2', 'func_70097_a');
    }
    const peacock = section('Animania EntityAnimaniaPeacock');
    inOrder(method(peacock, 'EntityAnimaniaPeacock(net.minecraft.world.World)'), 'animalsCanAttackOthers', 'ifeq', 'EntityAILeapAtTarget', 'EntityAIAttackMelee', 'field_70715_bh', 'EntityAIHurtByTarget');
    inOrder(method(peacock, 'func_70652_k'), 'func_76358_a', 'fconst_2', 'func_70097_a');
    inOrder(method(peacock, 'func_110147_ax'), 'double 7.0d');
    inOrder(method(section('Animania EntityFerretBase'), 'func_70652_k'), 'func_76358_a', 'fconst_1', 'func_70097_a');
    inOrder(method(section('Animania EntityFerretBase'), 'initAI'), 'EntityAIAttackMelee', 'animalsCanAttackOthers', 'EntityAIHurtByTarget');
    inOrder(method(section('Animania EntityHedgehogBase'), 'func_70652_k'), 'func_76358_a', 'fconst_2', 'func_70097_a');
    inOrder(method(section('Animania EntityHedgehogBase'), 'initAI'), 'EntityAIAttackMelee', 'animalsCanAttackOthers', 'EntityAIHurtByTarget');
    const expect = { 'animania:hen_leghorn': ['ignore', 2, 6], 'animania:rooster_wyandotte': ['ignore-unless-provoked', 2, 6], 'animania:peahen_blue': ['ignore-unless-provoked', 2, 7],
        'animania:ferret_grey': ['ignore-unless-provoked', 1, 8], 'animania:hedgehog': ['ignore-unless-provoked', 2, 8] };
    for (const [n, [reaction, damage, health]] of Object.entries(expect)) {
        const t = pack.threatOf(n);
        assert.deepEqual([t.reaction, t.provoked.damage, t.provoked.health, t.provoked.fightBack], [reaction, damage, health, true], n);
    }
});

test('soak 16 death 2: hens and roosters chase and knock back; the give-up rules and the hit rate are in provoked', () => {
    // The chicken base: panic (priority 1) ahead of the hen's melee; no FOLLOW_RANGE set, so the vanilla 16 applies.
    const chicken = section('Animania EntityAnimaniaChicken');
    inOrder(method(chicken, 'EntityAnimaniaChicken(net.minecraft.world.World)'), 'iconst_1', 'GenericAIPanic', 'func_75776_a');
    assert.ok(!method(chicken, 'func_110147_ax').includes('field_111265_b'), 'no FOLLOW_RANGE: the default 16');
    inOrder(method(section('Animania EntityHenBase'), 'EntityHenBase(net.minecraft.world.World)'), 'bipush        10', 'EntityAIAttackMelee', 'dconst_1', 'iconst_1');
    // Against a player each hit adds knockBack(this, 1.0f, dx, dz).
    for (const title of ['Animania EntityHenBase', 'Animania EntityRoosterBase']) {
        inOrder(method(section(title), 'func_70652_k'), 'fconst_2', 'func_70097_a', 'EntityPlayer', 'fconst_1', 'func_70653_a');
    }
    for (const n of ['animania:hen_rhode_island_red', 'animania:rooster_leghorn']) {
        const p = pack.threatOf(n).provoked;
        assert.deepEqual([p.damage, p.fightBack, p.attackIntervalTicks, p.knockback, p.followRange, p.loseSightTicks], [2, true, 20, 1, 16, 60], n);
        assert.match(pack.threatOf(n).summary, /more than 16 blocks away or out of its sight for 3 s.*Fight it back at once rather than flee/, n);
    }
    // Chicks never attack: no provoked block (the next test checks they stay ignore).
    assert.equal(pack.threatOf('animania:chick_rhode_island_red')?.provoked ?? null, null);
});

test('animals that do no damage to a player stay ignore (calves, chicks, toads, frogs, pigs, sheep, goats, rabbits, horses)', () => {
    for (const n of ['animania:calf_holstein', 'animania:chick_leghorn', 'animania:toad', 'animania:frog', 'animania:sow_large_white', 'animania:hog_large_white',
        'animania:ewe_suffolk', 'animania:ram_suffolk', 'animania:buck_alpine', 'animania:doe_alpine', 'animania:doe_dutch', 'minecraft:horse']) {
        if (!E[n]) continue;
        const t = pack.threatOf(n);
        assert.deepEqual([t.level, t.reaction, t.provoked, t.group], ['none', 'ignore', null, undefined], n);
    }
    assert.ok(E['animania:calf_holstein'] && E['animania:toad'] && E['animania:ram_suffolk'], 'the checked names exist');
});

test('panda, book wyrm (verified) and wolf, polar bear, llama (vanilla) fight back; the polar bear is not fought early', () => {
    const t = (n) => pack.threatOf(n);
    assert.deepEqual([t('futuremc:panda').reaction, t('futuremc:panda').source, t('futuremc:panda').provoked.damage, t('futuremc:panda').provoked.fightBack], ['ignore-unless-provoked', 'verified', 6, false]);
    inOrder(method(section('Future MC EntityPanda'), 'func_110147_ax'), 'field_111264_e', 'double 6.0d');
    inOrder(method(section('Future MC EntityPanda'), 'func_184651_r'), 'EntityPanda$AIAttack', 'EntityPanda$AIRevenge');
    inOrder(section('Future MC EntityPanda$AIRevenge'), 'iconst_1', 'iconst_0', 'EntityAIHurtByTarget."<init>"');
    assert.deepEqual([t('defiledlands:book_wyrm').reaction, t('defiledlands:book_wyrm').provoked.damage, t('defiledlands:book_wyrm').provoked.health], ['ignore-unless-provoked', 5, 12]);
    inOrder(method(section('Defiled Lands EntityBookWyrm'), 'func_70652_k'), 'func_76358_a', 'float 5.0f', 'func_70097_a');
    inOrder(method(section('Defiled Lands EntityBookWyrm'), 'func_110147_ax'), 'double 12.0d');
    assert.deepEqual([t('minecraft:wolf').reaction, t('minecraft:wolf').source], ['ignore-unless-provoked', 'vanilla']);
    assert.deepEqual([t('minecraft:polar_bear').reaction, t('minecraft:polar_bear').source, t('minecraft:polar_bear').provoked.health, t('minecraft:polar_bear').provoked.fightBack],
        ['ignore-unless-provoked', 'vanilla', 50, false]);
    assert.match(t('minecraft:polar_bear').evidence.join(' '), /roughmobsrevamped\.cfg:117-119.*maxHealth \+20/);
    assert.deepEqual([t('minecraft:llama').reaction, t('minecraft:llama').ranged], ['ignore-unless-provoked', true]);
    // The rest of the threat table is unchanged: no provoked block where none was written.
    assert.equal(t('minecraft:zombie').provoked, null);
    assert.equal(t('iceandfire:firedragon').provoked, null);
});

test('night threats are unchanged: none of these animals is hostile', () => {
    const names = new Set([...reactions.groups.flatMap((g) => g.members), 'futuremc:panda', 'defiledlands:book_wyrm', 'minecraft:wolf', 'minecraft:polar_bear', 'minecraft:llama']);
    for (const n of names) assert.equal(pack.threatOf(n).level, 'none', n);
    assert.ok(!pack.nightThreats({ limit: 1000 }).some((x) => names.has(x.name)));
});

test('food animals stay huntable: no name the hunting reflex takes is ignore-unless-provoked (skills-rotn !attack refuses those)', () => {
    // src/agent/library/hunting.js ANIMANIA_FOOD and the vanilla food animals it hunts.
    const food = Object.keys(E).filter((n) => /^animania:(cow|sow|ewe|doe)_[a-z_]+$/.test(n) || ['minecraft:cow', 'minecraft:pig', 'minecraft:sheep', 'minecraft:chicken', 'minecraft:rabbit', 'minecraft:mooshroom'].includes(n));
    assert.ok(food.length > 20);
    for (const n of food) assert.notEqual(pack.threatOf(n).reaction, 'ignore-unless-provoked', n);
    for (const n of ['animania:bull_holstein', 'animania:rooster_leghorn', 'minecraft:wolf', 'minecraft:polar_bear']) assert.equal(pack.threatOf(n).reaction, 'ignore-unless-provoked', n);
});
