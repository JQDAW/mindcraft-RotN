// Lead task after #496 (2026-11-20): melee entries for the seven reaction-fight mobs mob-melee.json did
// not cover (the Rats illager piper, the Ancient Beasts ghost, nekros and zealot, the Defiled Lands
// scuttler, the zombie and skeleton horses), and the note on the Special Mobs husk / special zombie
// maxDamage. Each number is checked against the javap excerpts and config lines in
// fixtures/melee-gaps-3.3.4/ (from the pinned pack zip's jars and configs; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/melee-gaps-3.3.4');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');
const jp = read('gaps.javap.txt');
const configs = read('configs.txt');
const pack = loadRotnData('3.3.4');
const MM = pack.mobMeleeData;

const section = (text, title) => {
    const i = text.indexOf(`\n## ${title}`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return text.slice(i + 1).split(/\n## /)[0];
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
/** The config line "path:line: text" for a path and a regex on the text. */
const cfg = (file, re) => {
    const l = configs.split('\n').find((x) => x.startsWith(`${file}:`) && re.test(x));
    assert.ok(l, `${file} ${re}`);
    return l;
};
const r2 = (x) => Math.round(x * 100) / 100;
const PLAYER_WIDTH = 0.6;
const SEVEN = ['rats:illager_piper', 'ancientbeasts:ghost', 'ancientbeasts:nekros', 'ancientbeasts:zealot', 'defiledlands:scuttler', 'minecraft:zombie_horse', 'minecraft:skeleton_horse'];

test('the seven reaction-fight mobs now have cited entries; every fight reaction has melee data', () => {
    for (const n of SEVEN) {
        const m = pack.mobMelee(n);
        assert.ok(m, n);
        assert.equal(m.confidence, 'verified', n);
        assert.ok(m.evidence.some((e) => /\.jar/.test(e)) && m.evidence.some((e) => /config\//.test(e)), n);
        assert.ok(m.evidence.some((e) => /melee-gaps-3\.3\.4/.test(e)), n);
        assert.ok(typeof m.maxDamage === 'number', n);
        assert.equal(pack.threatOf(n).reaction, 'fight', n);
        assert.equal(pack.threatOf(n).melee.damage, m.damage, n);
    }
    const fight = Object.entries(pack.threatReactions.entities).filter(([, e]) => e.reaction === 'fight').map(([n]) => n);
    assert.deepEqual(fight.filter((n) => !MM.mobs[n]), []);
    assert.equal(Object.keys(MM.mobs).length, 79);
    assert.match(MM.description, /melee-gaps-3\.3\.4/);
    assert.match(MM.description, /'none': it does no damage itself, so damage 0 is read, not unknown/);
});

test('SRG names: the obfuscated vanilla classes and methods used below', () => {
    const srg = section(jp, 'SRG names');
    for (const l of [
        'CL: xo net/minecraft/entity/ai/EntityAIAttackMelee', 'CL: aao net/minecraft/entity/passive/AbstractHorse', 'CL: aau net/minecraft/entity/passive/EntitySkeletonHorse',
        'CL: aaw net/minecraft/entity/passive/EntityZombieHorse', 'CL: aco net/minecraft/entity/monster/AbstractIllager', 'CL: adm net/minecraft/entity/monster/EntitySpellcasterIllager',
        'CL: adn$a net/minecraft/entity/monster/EntitySpider$AISpiderAttack', 'CL: vp net/minecraft/entity/EntityLivingBase', 'CL: vg net/minecraft/entity/Entity',
        'MD: xo/a (Lvp;)D net/minecraft/entity/ai/EntityAIAttackMelee/func_179512_a', 'MD: xo/a (Lvp;D)V net/minecraft/entity/ai/EntityAIAttackMelee/func_190102_a',
        'MD: xo/a ()Z net/minecraft/entity/ai/EntityAIAttackMelee/func_75250_a', 'MD: xo/e ()V net/minecraft/entity/ai/EntityAIAttackMelee/func_75246_d',
        'MD: vp/B (Lvg;)Z net/minecraft/entity/EntityLivingBase/func_70652_k', 'MD: vg/a (FF)V net/minecraft/entity/Entity/func_70105_a',
        'MD: vg/d (DDD)D net/minecraft/entity/Entity/func_70092_e', 'MD: vg/bw ()Lbhb; net/minecraft/entity/Entity/func_174813_aQ',
        'FD: vg/G net/minecraft/entity/Entity/field_70130_N', 'FD: bhb/b net/minecraft/util/math/AxisAlignedBB/field_72338_b',
    ]) assert.ok(srg.includes(l), l);
});

test('vanilla melee: reach^2 = (2 x width)^2 + target width to the target\'s feet, distance only; starts without a path when in reach', () => {
    inOrder(section(jp, 'xo (EntityAIAttackMelee) getAttackReachSqr'), 'Field vx.G:F', 'fconst_2', 'fmul', 'Field vx.G:F', 'fconst_2', 'fmul', 'fmul', 'Field vp.G:F', 'fadd');
    const upd = section(jp, 'xo (EntityAIAttackMelee) updateTask');
    inOrder(upd, 'Field vp.p:D', 'Method vp.bw:()Lbhb;', 'Field bhb.b:D', 'Field vp.r:D', 'Method vx.d:(DDD)D');
    const atk = section(jp, 'xo (EntityAIAttackMelee) checkAndPerformAttack');
    inOrder(atk, 'Method a:(Lvp;)D', 'dcmpg', 'bipush        20', 'Method vx.B:(Lvg;)Z');
    assert.doesNotMatch(atk, /zj\.a|vx\.y/, 'no canSee in the attack');
    inOrder(section(jp, 'xo (EntityAIAttackMelee) shouldExecute'), 'Method ze.a:(Lvg;)Lbel;', 'ifnull', 'iconst_1', 'Method a:(Lvp;)D', 'Method vx.d:(DDD)D', 'dcmpl', 'iflt', 'iconst_1');
    inOrder(section(jp, 'adn$a (EntitySpider$AISpiderAttack)'), 'float 4.0f', 'Field vp.G:F', 'fadd');
    inOrder(section(jp, 'vg (Entity) <init>'), 'float 0.6f', 'Field G:F', 'float 1.8f', 'Field H:F');
    inOrder(section(jp, 'vp (EntityLivingBase) attackEntityAsMob'), 'public boolean B(vg)', 'Method z:(Lvg;)V', 'iconst_0', 'ireturn');
});

test('rats:illager_piper: 2 (the EntityMob default), reach 1.43, melee only without its rat flute', () => {
    const sigs = section(jp, 'EntityIllagerPiper header and method signatures');
    assert.match(sigs, /extends net\.minecraft\.entity\.monster\.AbstractIllager implements net\.minecraft\.entity\.IRangedAttackMob/);
    assert.doesNotMatch(sigs, /func_70652_k/);
    assert.doesNotMatch(section(jp, 'EntityIllagerPiper func_110147_ax'), /field_111264_e/);
    for (const s of ['aco (AbstractIllager)', 'adm (EntitySpellcasterIllager)']) {
        const sec = section(jp, s);
        assert.doesNotMatch(sec, /\n {2}\S.* (bM|B|r)\(.*\);|Method a:\(FF\)V/, s);
    }
    inOrder(section(jp, 'EntityIllagerPiper <init>'), 'PiperAIStrife', 'double 0.8d', 'bipush        20', 'float 15.0f', 'EntityAIAttackMelee', 'double 0.8d', 'iconst_0', 'setCombatTask');
    inOrder(section(jp, 'EntityIllagerPiper setCombatTask'), 'func_85156_a', 'func_85156_a', 'func_184614_ca', 'RAT_FLUTE', 'if_acmpne', 'bipush        100', 'setAttackCooldown', 'aiArrowAttack', 'aiAttackOnCollide');
    inOrder(section(jp, 'EntityIllagerPiper func_180481_a'), 'MAINHAND', 'RAT_FLUTE', 'func_184201_a');
    inOrder(section(jp, 'EntityIllagerPiper func_82196_d'), 'summonRat', 'return');
    const m = pack.mobMelee('rats:illager_piper');
    assert.deepEqual([m.damage, m.maxDamage, m.reach, m.intervalTicks, m.hitsThroughWalls], [2, 2, r2(Math.sqrt((2 * 0.6) ** 2 + PLAYER_WIDTH)), 20, undefined]);
    assert.ok(m.reach < 0.3 + 1 + 0.3, 'not through a 1-block wall');
    assert.match(m.note, /rat flute/);
    assert.match(cfg('config/roughmobsrevamped.cfg', /rats:illager_piper;/), /generic\.maxHealth/);
    assert.doesNotMatch(section(configs, 'esm/entity_ai.json (rats:illager_piper)'), /Damage/);
});

test('ancientbeasts:ghost: no melee; a 4-damage possession spell on a random non-animal within 16, every 400 ticks', () => {
    assert.doesNotMatch(section(jp, 'EntityGhost func_184651_r'), /EntityAIAttackMelee|AttackMelee/);
    assert.doesNotMatch(section(jp, 'EntityGhost func_110147_ax'), /field_111264_e/);
    const pos = section(jp, 'EntityGhost$EntityAIPossession');
    inOrder(method(pos, 'func_75250_a'), 'func_70638_az', 'ifnonnull', 'magicCooldown', 'isUsingMagic', 'double 16.0d', 'func_186662_g', 'selector', 'func_175647_a', 'nextInt', 'access$100');
    const use = method(pos, 'useMagic');
    inOrder(use, 'instanceof', 'EntityLiving', 'field_76444_x', 'sipush        400', 'field_76424_c', 'iconst_2', 'field_76420_g', 'iconst_2', 'func_70624_b');
    inOrder(use, 'EntityPlayer', 'field_75098_d', 'POSSESSED', 'sipush        400', 'func_76358_a', 'float 4.0f', 'GlobalDamageMultiplier', 'func_70097_a');
    assert.doesNotMatch(use + method(pos, 'func_75250_a'), /func_70685_l|func_72933_a|func_147447_a/, 'no sight or ray trace');
    inOrder(method(pos, 'getMagicUseInterval'), 'sipush        400');
    inOrder(method(pos, 'lambda$new$0'), 'EntityGhost', 'POSSESSED', 'EntityAnimal', 'GHOSTLY');
    assert.doesNotMatch(pos, /getMagicWarmupTime/, 'the UseMagic default warmup');
    const um = section(jp, 'UseMagic');
    inOrder(method(um, 'getMagicWarmupTime'), 'bipush        20');
    inOrder(method(um, 'func_75249_e'), 'getMagicWarmupTime', 'magicWarmup', 'field_70173_aa', 'getMagicUseInterval', 'iadd', 'magicCooldown');
    assert.match(cfg('config/ancientbeasts.cfg', /Global Damage Multiplier/), /=1\.0$/);
    const m = pack.mobMelee('ancientbeasts:ghost');
    assert.deepEqual([m.damage, m.maxDamage, m.attack, m.reach, m.intervalTicks, m.hitsThroughWalls, m.hitsToKill], [4, 4, 'spell', 16, 400, true, 5]);
});

test('ancientbeasts:nekros: no melee; a 5-damage life steal within 8 while hurt, every 600 ticks', () => {
    const ai = section(jp, 'EntityNekros func_184651_r');
    assert.doesNotMatch(ai, /AttackMelee/);
    inOrder(ai, 'UseDarkMagic', 'LifeStealing', 'EntityAIAvoidEntity', 'EntityPlayer', 'float 6.0f');
    const ls = section(jp, 'EntityNekros$LifeStealing');
    inOrder(method(ls, 'func_75250_a'), 'UseMagic.func_75250_a', 'func_110143_aJ', 'func_110138_aP', 'fcmpg', 'ifge', 'func_70032_d', 'float 8.0f', 'fcmpg', 'ifge');
    inOrder(method(ls, 'useMagic'), 'func_76358_a', 'float 5.0f', 'GlobalDamageMultiplier', 'fmul', 'func_70097_a', 'field_76437_t', 'sipush        200', 'func_70690_d', 'float 5.0f', 'func_70691_i');
    inOrder(method(ls, 'getMagicUseInterval'), 'sipush        600');
    assert.doesNotMatch(ls, /func_70685_l|getMagicWarmupTime/);
    const m = pack.mobMelee('ancientbeasts:nekros');
    assert.deepEqual([m.damage, m.maxDamage, m.attack, m.reach, m.intervalTicks, m.hitsThroughWalls], [5, 5, 'spell', 8, 600, true]);
    assert.match(m.onHit, /Weakness for 10 s/);
});

test('ancientbeasts:zealot: no damaging attack at all (damage 0, read)', () => {
    const sigs = section(jp, 'EntityZealot header and method signatures');
    assert.match(sigs, /extends net\.minecraft\.entity\.monster\.EntitySpellcasterIllager/);
    assert.doesNotMatch(sigs, /func_70652_k/);
    const ai = section(jp, 'EntityZealot func_184651_r');
    assert.doesNotMatch(ai, /AttackMelee/);
    inOrder(ai, 'AICastingSpell', 'EntityAIRestrictSun', 'EntityAIFleeSun', 'AIBuffSpell', 'AIWeakeningSpell', 'EntityAIAvoidEntity', 'EntityPlayer', 'float 8.0f');
    assert.doesNotMatch(section(jp, 'EntityZealot func_110147_ax'), /field_111264_e/);
    const weak = section(jp, 'EntityZealot$AIWeakeningSpell');
    inOrder(method(weak, 'func_190868_j'), 'field_76437_t', 'bipush        100', 'iconst_2', 'field_76421_d', 'bipush        100', 'iconst_0');
    inOrder(method(weak, 'func_190872_i'), 'sipush        200');
    const buff = section(jp, 'EntityZealot$AIBuffSpell');
    inOrder(buff, 'EntityMob', 'double 6.0d', 'EntityBeam', 'SHIELDED', 'sipush        200');
    for (const s of [weak, buff, section(jp, 'EntityBeam')]) assert.doesNotMatch(s, /func_70097_a|DamageSource/);
    assert.match(section(jp, 'EntityBeam'), /class com\.unoriginal\.ancientbeasts\.entity\.Entities\.EntityBeam extends net\.minecraft\.entity\.Entity /);
    assert.doesNotMatch(section(jp, 'EntityBeam'), /func_70690_d/);
    const m = pack.mobMelee('ancientbeasts:zealot');
    assert.deepEqual([m.damage, m.maxDamage, m.attack, m.hitsToKill, m.reach], [0, 0, 'none', null, undefined]);
    assert.match(m.note, /read, not unknown/);
});

test('defiledlands:scuttler: the spider\'s 2, reach sqrt(4 + 0.6), through a 1-block wall only against it', () => {
    const sigs = section(jp, 'EntityScuttler header and method signatures');
    assert.match(sigs, /extends net\.minecraft\.entity\.monster\.EntitySpider /);
    assert.doesNotMatch(sigs, /func_70652_k/);
    assert.doesNotMatch(jp.slice(jp.indexOf('\n## EntityScuttler header')).split(/\n## /)[0], /func_70105_a|field_111264_e/);
    const ai = section(jp, 'EntityScuttler$AISpiderAttack');
    assert.match(ai, /extends lykrast\.defiledlands\.common\.entity\.ai\.EntityAIAttackMeleeStrafe/);
    inOrder(method(ai, 'getAttackReachSqr'), 'float 4.0f', 'field_70130_N', 'fadd');
    inOrder(section(jp, 'EntityAIAttackMeleeStrafe func_75246_d'), 'field_70165_t', 'func_174813_aQ', 'field_72338_b', 'field_70161_v', 'func_70092_e');
    const chk = section(jp, 'EntityAIAttackMeleeStrafe checkAndPerformAttack');
    inOrder(chk, 'getAttackReachSqr', 'dcmpg', 'bipush        20', 'func_70652_k');
    assert.doesNotMatch(chk, /func_70685_l|func_75522_a/);
    const list = configs.split('\n').filter((l) => /^config\/roughmobsrevamped\.cfg:15(4[3-9]|5\d):/.test(l)).map((l) => l.split(': ')[1].trim());
    assert.ok(list.includes('minecraft:spider') && !list.includes('defiledlands:scuttler'));
    assert.match(cfg('config/esm/epicsiegemod.cfg', /defiledlands:scuttler/), /:457:/);
    const m = pack.mobMelee('defiledlands:scuttler');
    assert.equal(m.damage, pack.mobMelee('minecraft:spider').damage);
    assert.deepEqual([m.damage, m.maxDamage, m.reach, m.intervalTicks, m.hitsThroughWalls], [2, 2, r2(Math.sqrt(4 + PLAYER_WIDTH)), 20, true]);
    // A spider's hitbox is 1.4 wide: 0.7 + 1 (wall) + 0.3 < reach < 0.7 + 1 + 0.5.
    assert.ok(0.7 + 1 + 0.3 < m.reach && m.reach < 0.7 + 1 + 0.5);
    assert.equal(m.onHit, undefined, 'not on Rough Mobs\' spider list');
});

test('undead horses: 3 a hit (Hordes\' attribute; Special AI\'s fallback), reach 2.9, through a 1-block wall', () => {
    inOrder(section(jp, 'aao (AbstractHorse) <init>'), 'float 1.3964844f', 'float 1.6f', 'Method a:(FF)V');
    for (const s of ['aao (AbstractHorse) bM', 'aaw (EntityZombieHorse)', 'aau (EntitySkeletonHorse)']) assert.doesNotMatch(section(jp, s), /adh\.f/, s);
    assert.match(section(jp, 'aaw (EntityZombieHorse)'), /class aaw extends aao/);
    assert.match(section(jp, 'aau (EntitySkeletonHorse)'), /class aau extends aao/);
    // The Hordes: the zombie horse's attribute and attack.
    assert.match(section(jp, 'Hordes mixins.hordes.json'), /"MixinEntityLivingBase",[\s\S]*"MixinEntityZombieHorse"/);
    const ref = section(jp, 'Hordes mixins.hordes.refmap.json');
    assert.match(ref, /"attackEntityAsMob\(Lnet\/minecraft\/entity\/Entity;\)Z": "Lnet\/minecraft\/entity\/EntityLivingBase;func_70652_k/);
    assert.match(ref, /"applyEntityAttributes\(\)V": "Lnet\/minecraft\/entity\/passive\/EntityZombieHorse;func_110147_ax/);
    inOrder(section(jp, 'Hordes MixinEntityLivingBase'), 'EntityZombieHorse', 'aggressiveZombieHorses', 'field_111264_e', 'func_111126_e', 'func_76358_a', 'func_70097_a', 'cancel', 'setReturnValue');
    inOrder(section(jp, 'Hordes MixinEntityZombieHorse'), 'aggressiveZombieHorses', 'field_111264_e', 'func_111150_b', 'double 3.0d');
    assert.match(section(jp, 'Hordes MixinAbstractHorse initEntityAI'), /EntityAIAttackMelee/);
    assert.match(cfg('config/hordes.cfg', /aggressiveZombieHorses/), /=true$/);
    // Special AI: the skeleton horse has no ATTACK_DAMAGE, so the attack falls back to 3.0.
    const sai = section(jp, 'Special AI EntityAIAttackMeleePassive');
    const atk = method(sai, 'private void attackEntityAsMob');
    inOrder(atk, 'field_111264_e', 'func_111126_e', 'goto', 'EntitySheep', 'EntityRabbit', 'fconst_2', 'EntityChicken', 'fconst_1', 'EntityCow', 'EntityHorse', 'float 4.0f', 'float 3.0f', 'func_152377_a', 'fadd', 'func_76358_a', 'func_70097_a');
    assert.match(sai, /0 {4}17 {4}20 {3}Class java\/lang\/Exception/);
    inOrder(method(sai, 'func_190102_a'), 'EntityMob', 'func_179512_a', 'dcmpg', 'bipush        20', 'attackEntityAsMob');
    for (const l of ['config/Special_AI.cfg:16:     D:depacify_aggressive_chance=1.0', 'config/Special_AI.cfg:25:         minecraft:skeleton_horse 1.0', 'config/Special_AI.cfg:26:         minecraft:zombie_horse 1.0']) assert.ok(configs.includes(l), l);
    // Rough Mobs changes neither horse's damage; ImmersiveCombat registers attributes only on players.
    for (const l of configs.split('\n').filter((x) => /minecraft:(skeleton|zombie)_horse;generic/.test(x))) assert.doesNotMatch(l, /attackDamage/);
    inOrder(section(jp, 'ImmersiveCombat EventHandlers'), 'onEntityConstructing', 'instanceof', 'EntityPlayer', 'registerCritAttributes');
    const width = 1.3964844;
    for (const n of ['minecraft:zombie_horse', 'minecraft:skeleton_horse']) {
        const m = pack.mobMelee(n);
        assert.deepEqual([m.damage, m.maxDamage, m.reach, m.intervalTicks, m.hitsThroughWalls], [3, 3, r2(Math.sqrt((2 * width) ** 2 + PLAYER_WIDTH)), 20, true], n);
        assert.ok(width / 2 + 1 + 0.5 < m.reach && width / 2 + 2 + 0.3 > m.reach, n);
        assert.match(m.note, /1-block wall/, n);
    }
});

test('nothing on the pack scales the seven: Thicc Entities 1.0, no Rough Mobs damage, no rotm Mob Offense', () => {
    const thicc = section(configs, 'thiccentities.cfg').split('\n').filter((l) => /D:damage=/.test(l));
    assert.equal(thicc.length, 7);
    for (const l of thicc) assert.match(l, /D:damage=1\.0$/);
    for (const l of section(configs, 'rotm.cfg').split('\n').filter((x) => x.startsWith('config/'))) assert.match(l, /;drown$/);
    assert.equal(MM.general.confidence, 'verified');
});

test('Special Mobs husk and special zombie: no maxDamage because their own weapons were not read', () => {
    for (const n of ['specialmobs:huskzombie', 'specialmobs:specialzombie']) {
        const raw = MM.mobs[n];
        assert.equal(raw.maxDamage, undefined, n);
        assert.match(raw.note, /weapon code for it was not read, not because it holds no weapon/, n);
        assert.match(raw.note, /not on Rough Mobs' zombie list/, n);
    }
});

// ---- through walls (lead, after the first draft: skills keeps the bot at the far side of its cell) ----

const walls = read('walls.javap.txt');

test('spider family: AISpiderAttack reach^2 = 4 + target width (2.14), sizes from bytecode, cave spider inherits the AI', () => {
    inOrder(section(walls, 'adn (EntitySpider) <init>'), 'float 1.4f', 'float 0.9f', 'Method a:(FF)V');
    inOrder(section(walls, 'adn (EntitySpider) initEntityAI'), 'new', 'class adn$a');
    assert.match(section(walls, 'adn$a (EntitySpider$AISpiderAttack)'), /class adn\$a extends xo/);
    const cave = section(walls, 'acr (EntityCaveSpider)');
    assert.match(cave, /class acr extends adn/);
    assert.doesNotMatch(cave, /void r\(\);/);
    inOrder(cave, 'float 0.7f', 'float 0.5f', 'Method a:(FF)V');
    for (const t of ['Special Mobs Entity_SpecialSpider', 'Special Mobs Entity_SpecialCaveSpider']) {
        const s = section(walls, t);
        inOrder(s, 'func_184651_r', 'invokespecial', 'func_184651_r', 'initTypeAI');
        assert.doesNotMatch(method(s, 'void initTypeAI'), /new /, t);
    }
    for (const [c, w, h] of [['EntityBabySpider', '0.6f', '0.4f'], ['EntityGiantSpider', '1.9f', '1.3f'], ['EntityHungrySpider', '1.9f', '1.3f'], ['EntityMotherSpider', '1.8f', '1.2f'], ['EntityBabyCaveSpider', '0.6f', '0.4f']]) {
        inOrder(section(walls, `Special Mobs ${c} <init>`), `float ${w}`, `float ${h}`, 'func_70105_a');
    }
    inOrder(section(walls, 'Special Mobs EntityDesertSpider <init>'), 'fconst_1', 'float 0.8f', 'func_70105_a');
    assert.doesNotMatch(section(walls, 'Special Mobs spiders without a size'), /func_70105_a|initTypeAI|func_184651_r/);
    assert.doesNotMatch(section(walls, 'Special Mobs cave spiders without a size'), /func_70105_a|initTypeAI|func_184651_r/);
    inOrder(section(walls, 'Special Mobs SpecialMobData'), 'setBaseScale', 'nextScale', 'setRenderScale', 'nextScale', 'RANDOM_SCALING');
    assert.doesNotMatch(section(walls, 'Special Mobs SpecialMobData'), /func_70105_a/);
    assert.match(section(configs, 'Special_Mobs.cfg'), /This is a visual effect only/);
    // Every spider-family entry carries the fields; only the three big ones stay outside a 1-block wall.
    const fam = Object.keys(MM.mobs).filter((n) => /spider|scuttler/.test(n));
    assert.equal(fam.length, 20);
    for (const n of fam) {
        const m = MM.mobs[n];
        assert.equal(m.reach, r2(Math.sqrt(4 + PLAYER_WIDTH)), n);
        assert.equal(m.hitsThroughWalls, !['specialmobs:giantspider', 'specialmobs:hungryspider', 'specialmobs:motherspider'].includes(n), n);
    }
    assert.deepEqual([MM.mobs['minecraft:spider'].width, MM.mobs['minecraft:cave_spider'].width], [1.4, 0.7]);
    assert.equal(MM.mobs['minecraft:spider'].hitsThroughFloor, true);
    assert.match(MM.mobs['defiledlands:scuttler'].note, /directly below a 1-block floor/);
});

test('other reach rules: zombie attack, the giant\'s 1.9, zombie players\' +3 with an item, the blaze\'s distance < 2', () => {
    inOrder(section(walls, 'adt (EntityZombie) initEntityAI'), 'class yq');
    const yq = section(walls, 'yq (EntityAIZombieAttack)');
    assert.match(yq, /class yq extends xo/);
    assert.doesNotMatch(yq, /double a\(vp\)/);
    inOrder(section(walls, 'Ancient Beasts EntityGiant$EntityAIGiantMelee'), 'extends net.minecraft.entity.ai.EntityAIAttackMelee', 'field_70130_N', 'float 1.9f', 'fmul', 'field_70130_N', 'fmul', 'float 1.9f', 'fmul', 'field_70130_N', 'fadd');
    inOrder(section(walls, 'zombie_players EntityZombiePlayer initEntityAI'), 'EntityAIZombieAttackWeaponReach');
    inOrder(section(walls, 'zombie_players EntityAIZombieAttackWeaponReach'), 'extends net.minecraft.entity.ai.EntityAIZombieAttack', 'func_184614_ca', 'func_190926_b', 'float 3.0f', 'fconst_2', 'fmul', 'fconst_2', 'fmul', 'field_70130_N', 'fadd', 'fload_2', 'fadd');
    const blaze = section(walls, 'acq$a (EntityBlaze$AIFireballAttack)');
    inOrder(blaze, 'Method acq.h:(Lvg;)D', 'double 4.0d', 'dcmpg', 'ifge', 'bipush        20', 'Method acq.B:(Lvg;)Z');
    assert.doesNotMatch(section(walls, 'acq (EntityBlaze) <init>'), /Method a:\(FF\)V/);
    assert.ok(section(walls, 'SRG names').includes('MD: vg/h (Lvg;)D net/minecraft/entity/Entity/func_70068_e'));
    assert.doesNotMatch(section(walls, 'Special Mobs EntityAISpecialAttackMelee'), /func_179512_a/);
    assert.match(section(walls, 'Special Mobs EntityAISpecialAttackMelee'), /extends net\.minecraft\.entity\.ai\.EntityAIAttackMelee/);
    inOrder(section(walls, 'Special Mobs Entity_SpecialZombie setCombatTask'), 'EntityAIAttackRangedBow', 'EntityAIZombieAttack');
    inOrder(section(walls, 'Special Mobs Entity_SpecialSkeleton'), 'fconst_1', 'setCollisionSize', 'float 0.6f', 'fload_1', 'fmul', 'float 1.99f', 'EntityAISpecialAttackMelee');
    for (const c of ['EntityGiantSkeleton', 'EntitySpitfireSkeleton']) inOrder(section(walls, `Special Mobs ${c} setCollisionSize`), 'float 0.9f', 'fload_1', 'fmul', 'float 2.7f', 'fload_1', 'fmul', 'func_70105_a');
    for (const c of ['EntityFrostWalker$AIFrostWalkerSlowMelee', 'EntityFrostWalker$AIFrostWalkerFastMelee']) assert.doesNotMatch(section(walls, `Ancient Beasts ${c}`), /func_179512_a/, c);
    assert.match(section(walls, 'Ancient Beasts EntityFrostWalker$AIFrostWalkerSlowMelee'), /extends net\.minecraft\.entity\.ai\.EntityAIAttackMelee/);
    // Sizes from the constructors.
    for (const [t, ...needles] of [
        ['Ancient Beasts EntityBoulderer', 'float 0.8f', 'float 1.95f', 'func_70105_a'], ['Ancient Beasts EntityFrostWalker <init>', 'float 0.8f', 'fconst_2', 'func_70105_a'],
        ['Ancient Beasts EntityGiant <init>', 'float 2.8f', 'float 7.2f', 'func_70105_a'], ['Ice and Fire EntityGorgon', 'float 0.8f', 'float 1.99f', 'func_70105_a', 'EntityAIAttackMelee'],
        ['Fish\'s Undead Rising EntityWeta', 'float 0.8f', 'float 0.5f', 'func_70105_a', 'EntityAIAttackMelee'], ['Fish\'s Undead Rising EntitySludgeLord', 'float 2.5f', 'float 3.0f', 'func_70105_a', 'EntityAIAttackMelee'],
        ['Fish\'s Undead Rising EntityMummy', 'fconst_1', 'float 1.95f', 'func_70105_a', 'EntityZombie.func_184651_r'], ['Fish\'s Undead Rising EntityZombieFrozen', 'fconst_1', 'float 1.95f', 'func_70105_a', 'EntityZombie.func_184651_r'],
        ['Fish\'s Undead Rising EntityZombieMushroom', 'fconst_1', 'float 1.95f', 'func_70105_a', 'EntityZombie.func_184651_r'], ['Special Mobs EntityGiantZombie', 'float 0.9f', 'float 2.7f', 'func_70105_a'],
    ]) inOrder(section(walls, t), ...needles);
    assert.match(section(walls, 'Ancient Beasts EntityBoulderer'), /extends net\.minecraft\.entity\.monster\.EntityZombie/);
    const want = { 'ancientbeasts:giant_zombie': r2(Math.sqrt((1.9 * 2.8) ** 2 + 0.6)), 'zombie_players:zombie_player': r2(Math.sqrt(1.2 ** 2 + 0.6 + 3)), 'minecraft:blaze': 2, 'mod_lavacow:sludgelord': r2(Math.sqrt(5 ** 2 + 0.6)), 'mod_lavacow:mummy': r2(Math.sqrt(2 ** 2 + 0.6)), 'iceandfire:gorgon': r2(Math.sqrt(1.6 ** 2 + 0.6)), 'specialmobs:giantzombie': r2(Math.sqrt(1.8 ** 2 + 0.6)) };
    for (const [n, reach] of Object.entries(want)) assert.equal(MM.mobs[n].reach, reach, n);
    assert.doesNotMatch(MM.mobs['minecraft:blaze'].note, /touch/);
});

test('through-block answers follow from width, height and reach; every one is cited', () => {
    const through = Object.entries(MM.mobs).filter(([, m]) => m.hitsThroughWalls !== undefined && m.attack !== 'spell');
    assert.equal(through.length, 38); // + the parasite (zombie-awareness PR)
    for (const [n, m] of through) {
        assert.ok(m.width > 0 && m.height > 0 && m.reach > 0, n);
        let t = 0;
        while (m.reach > m.width / 2 + (t + 1) + 0.3) t++;
        assert.equal(m.hitsThroughWalls, t >= 1, n);
        assert.equal(m.wallBlocks, t, n);
        assert.equal(m.hitsThroughFloor === true, m.reach > 1 + Math.ceil(m.height), n);
        assert.equal(m.hitsThroughRoof === true, m.reach > 3, n);
        assert.ok(m.evidence.some((e) => /walls\.javap\.txt|gaps\.javap\.txt|troll-trees-melee|zombie-awareness-3\.3\.4/.test(e)), n);
    }
    assert.deepEqual(['mod_lavacow:sludgelord', 'ancientbeasts:giant_zombie'].map((n) => MM.mobs[n].wallBlocks), [3, 3]);
    assert.deepEqual(Object.keys(MM.mobs).filter((n) => MM.mobs[n].hitsThroughRoof).sort(), ['ancientbeasts:giant_zombie', 'mod_lavacow:sludgelord']);
    // Narrow plain-melee mobs (0.6 wide, reach 1.43) are not listed as through-wall.
    for (const n of ['minecraft:zombie', 'minecraft:skeleton', 'minecraft:enderman', 'minecraft:wither_skeleton']) assert.equal(MM.mobs[n].hitsThroughWalls, undefined, n);
    assert.ok(Math.sqrt(1.4 ** 2 + 0.6) < 0.35 + 1.3, 'the wither skeleton (0.7 wide) stays short of a 1-block wall');
    assert.match(MM.description, /wallBlocks/);
});
