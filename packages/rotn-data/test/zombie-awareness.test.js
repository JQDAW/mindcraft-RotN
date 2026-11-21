// Probe attempt 2 (#540) research, lead task 2026-11-21: Zombie Awareness makes zombies target a player they can see even
// with NoAI (so Better Combat's sneak-attack crit did not fire on the NoAI zombies), and Fish's Undead Rising's parasite as a
// fight. Checks combat.json's zombieAwareness block, its sneak-attack note and the parasite's numbers against
// fixtures/zombie-awareness-3.3.4/ (javap excerpts and config lines from the pinned pack zip; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { hitsToKill } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, 'fixtures/zombie-awareness-3.3.4', f), 'utf8').replace(/\r\n/g, '\n');
const jp = read('za.javap.txt');
const configs = read('configs.txt');
const pack = loadRotnData('3.3.4');
const C = pack.combatData;
const ZA = C.zombieAwareness;

const section = (title) => {
    const i = jp.indexOf(`\n## ${title}`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return jp.slice(i + 1).split(/\n## /)[0];
};
const inOrder = (text, ...needles) => {
    let at = -1;
    for (const n of needles) {
        const i = text.indexOf(n, at + 1);
        assert.ok(i > at, `"${n}" after position ${at}`);
        at = i;
    }
};
const cfg = (file, re) => {
    const l = configs.split('\n').find((x) => x.startsWith(`config/${file}:`) && re.test(x));
    assert.ok(l, `${file} ${re}`);
    return l;
};

test('Zombie Awareness: every 40 ticks a tickable mob without a target takes the nearest visible player in a 16 x 8 box, NoAI or not', () => {
    // LivingUpdateEvent -> tickEntity: the 40-tick gate, canProcessEntity, EntityLiving -> tickAI.
    inOrder(section('ZAEventHandler.tickEntity'), 'field_72995_K', 'getEntityLiving', 'ZombieAwareness.tickEntity');
    inOrder(section('ZombieAwareness.tickEntity'), 'func_82737_E', 'func_145782_y', 'ladd', 'tickRateAILoop', 'lrem', 'canProcessEntity', 'instanceof', 'EntityLiving', 'ZAUtil.tickAI');
    const gate = section('ZombieAwareness.canProcessEntity');
    assert.match(gate, /canEntityBeProcessedOverride\(net\.minecraft\.entity\.Entity\);\n\s+Code:\n\s+0: iconst_1\n\s+1: ireturn/);
    inOrder(gate, 'getDefaultForEntity', 'EntityPigZombie', 'ireturn', 'EntityZombie');
    inOrder(section('ZAUtil.tickAI'), 'func_82737_E', 'func_145782_y', 'long 40l', 'lrem', 'omniscient', 'ai_FindTarget');
    const find = section('ZAUtil.ai_FindTarget');
    inOrder(find, 'sightRange', 'func_70638_az', 'bipush        100', 'nextInt', 'func_174813_aQ', 'long 2l', 'ldiv', 'func_72314_b', 'func_72839_b', 'isEnemy', 'seeThroughWalls', 'func_70685_l', 'sanityCheck', 'func_70032_d', 'huntTarget');
    inOrder(section('ZAUtil.huntTarget'), 'tryMoveToEntityLivingLongDist', 'func_70624_b');
    inOrder(section('ZAUtil.isEnemy'), 'EntityPlayer', 'field_75098_d', 'field_76441_p', 'func_70660_b');
    assert.match(section('ZAUtil.isEnemy'), /sanityCheck\(net\.minecraft\.entity\.Entity, net\.minecraft\.entity\.Entity\);\n\s+Code:\n\s+0: iconst_1\n\s+1: ireturn/);
    // No class checks isAIDisabled; the summon-help chance is read only by its own config class.
    const rows = section('Every Zombie Awareness class').split('\n').filter((l) => /: func_175446_cd/.test(l));
    assert.ok(rows.length >= 19);
    for (const r of rows) assert.match(r, /func_175446_cd 0,/, r);
    assert.deepEqual(rows.filter((r) => !/getstatic 0$/.test(r)).map((r) => r.split(':')[0]), ['ZombieAwareness.config.ZAConfigFeatures']);
    assert.doesNotMatch(section('ZAUtil.hookSetAttackTarget'), /func_70624_b/);
    inOrder(section('ZAUtil.hookSetAttackTarget'), 'EntityPlayer', 'tryPlayTargetSound');
    for (const [re, val] of [[/tickRateAILoop=/, '40'], [/sightRange=/, '16'], [/seeThroughWalls=/, 'false'], [/omniscient=/, 'false'], [/scentStrength=/, '40'], [/soundStrength=/, '50'], [/maxPFRangeSense=/, '50']]) {
        assert.ok(cfg('ZombieAwareness/General.cfg', re).endsWith(`=${val}`), String(re));
    }
    for (const n of ['Husk', 'Zombie', 'ZombieVillager', 'mod_lavacow\\.parasite']) assert.match(cfg('ZombieAwareness/MobLists.cfg', new RegExp(`B:${n}=`)), /=true$/, n);
    const t = ZA.targeting;
    assert.deepEqual([t.intervalTicks, t.boxHorizontal, t.boxVertical, t.lineOfSight, t.ignoresNoAI, t.researchChanceWithTarget], [40, 16, 8, true, true, 0.01]);
    assert.deepEqual(ZA.tickable, ['minecraft:zombie', 'minecraft:husk', 'minecraft:zombie_villager', 'mod_lavacow:parasite']);
    for (const n of ZA.tickable) assert.ok(pack.dump.entities.entities[n], n);
    assert.equal(ZA.confidence, 'verified');
});

test('Zombie Awareness senses and extra spawning; AggroTP does not touch zombies', () => {
    inOrder(section('ZAUtil.tickPlayer'), 'lastHealths', 'func_110143_aJ', 'SCENT_BLOOD', 'scentStrength', 'spawnOrBuffSenseAtPos');
    const sc = section('EntityScent.getRange');
    inOrder(sc, 'getStrengthScaled', 'float 100.0f', 'fdiv', 'maxPFRangeSense', 'fmul');
    inOrder(sc, 'getAgeScale', 'dmul');
    assert.match(sc, /sipush\s+600\n.*putstatic .*MAX_AGE/);
    assert.deepEqual([ZA.senses.bloodScent.strength, ZA.senses.bloodScent.maxAgeTicks, ZA.senses.soundStrength], [40, 600, 50]);
    assert.equal(ZA.senses.bloodScent.strength / 100 * 50, 20, 'a fresh blood scent reaches 20 blocks');
    // The clone branch needs no player within 32 blocks; extraSpawningAutoTarget is off.
    inOrder(section('ZombieAwareness.tickEntity'), 'EntityZombie', 'lastSpawnTime', 'double 32.0d', 'func_72890_a', 'ifnonnull', 'maxZombiesNightBaseRarity', 'nextInt');
    assert.match(cfg('ZombieAwareness/Spawning.cfg', /extraSpawningAutoTarget=/), /=false$/);
    assert.match(cfg('ZombieAwareness/Features.cfg', /zombieSummonHelpBaseChance=/), /=0\.1$/);
    // AggroTP: only mobs in mobTeleports, and only betterslimes:quazar is listed.
    inOrder(section('AggroTP EntityEventHandler.setAttackTargetEvent'), 'getEntityLiving', 'getRegistryName', 'mobTeleports', 'containsKey');
    const atp = configs.split('\n').filter((l) => l.startsWith('config/aggrotp.cfg:') && /;/.test(l) && !/:\s+#/.test(l));
    assert.deepEqual(atp.map((l) => l.split(': ')[1].trim().split(';')[0]), ['betterslimes:quazar']);
    assert.ok(ZA.notUsed.some((x) => /zombieSummonHelpBaseChance/.test(x)) && ZA.notUsed.some((x) => /AggroTP/.test(x)));
});

test('the sneak-attack note: realistic only on a mob that has not seen the bot', () => {
    assert.match(C.playerAttack.betterCombatPacket.crit.sneakAttack, /NoAI/);
    assert.match(C.playerAttack.betterCombatPacket.crit.sneakAttack, /#540/);
    const src = fs.readFileSync(path.join(HERE, '../src/combat.js'), 'utf8');
    assert.match(src, /sneakAttack: the mob has not noticed the bot[\s\S]*Zombie Awareness/);
});

test('Fish\'s Undead Rising parasite: 7 health, a bite every 20 ticks at the target\'s width + 0.1, spawned from a dying zombie', () => {
    const p = section('EntityParasite header');
    assert.match(p, /class com\.Fishmod\.mod_LavaCow\.entities\.EntityParasite extends net\.minecraft\.entity\.monster\.EntitySpider/);
    inOrder(p, 'float 0.4f', 'float 0.3f', 'func_70105_a');
    inOrder(p, 'EntityParasite$AIParasiteAttack', 'EntityAIHurtByTarget');
    inOrder(p, 'field_111267_a', 'Parasite_Health', 'field_111265_b', 'double 8.0d', 'field_111263_d', 'double 0.2d', 'field_111264_e', 'Parasite_Attack');
    const ai = section('EntityParasite$AIParasiteAttack');
    assert.match(ai, /extends net\.minecraft\.entity\.ai\.EntityAIAttackMelee/);
    assert.match(ai, /func_179512_a[\s\S]*field_70130_N:F\n.*float 0\.1f\n.*fadd/);
    const f = (re) => cfg('Fishs_Undead_Rising.cfg', re);
    assert.match(f(/"parasite health"=/), /=7\.0$/);
    assert.match(f(/"parasite attack"=/), /=1\.0$/);
    assert.match(f(/"parasite spawn rate"=/), /=5$/);
    assert.match(f(/"parasite attacks everything"=/), /=false$/);
    assert.match(f(/"parasite attacks by attaching onto target"=/), /=true$/);
    const hosts = configs.split('\n').filter((l) => /Fishs_Undead_Rising\.cfg:(60[7-9]):/.test(l)).map((l) => l.split(': ')[1].trim());
    const c = pack.combatOf('mod_lavacow:parasite');
    assert.deepEqual([c.maxHealth, c.armor, c.attackIntervalTicks, c.reach, c.spawnsFrom.chancePercent], [7, 0, 20, Math.round(Math.sqrt(0.6 + 0.1) * 100) / 100, 5]);
    assert.deepEqual(c.spawnsFrom.hosts, hosts);
    const m = pack.mobMelee('mod_lavacow:parasite');
    assert.deepEqual([m.damage, m.width, m.height, m.reach, m.intervalTicks, m.hitsThroughWalls, m.wallBlocks], [1, 0.4, 0.3, c.reach, 20, false, 0]);
    // The threat entry already says fight and explains the latching.
    assert.equal(pack.threatReactions.entities['mod_lavacow:parasite'].reaction, 'fight');
    // A stone sword kills one in 3 Better Combat hits (2.8 a hit after Damage Control), 2 if the first is a crit.
    const k = hitsToKill({ mob: 'mod_lavacow:parasite', weapon: 'minecraft:stone_sword' });
    assert.deepEqual([k.hits, k.minHits], [3, 2]);
});
