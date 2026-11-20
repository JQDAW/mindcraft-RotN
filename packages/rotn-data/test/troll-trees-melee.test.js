// Soak 5 (lead task, 2026-11-20): a troll dug into the shelter at night and killed the bot with one
// 18-damage hit. Checks the troll's threat entry and 'blasters' digging, the falling-tree data and the
// per-mob melee table against the javap excerpts and config lines in fixtures/troll-trees-melee-3.3.4/
// (from the pinned pack zip's jars and configs; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { UNKNOWN_MELEE as UNKNOWN_FROM_INDEX } from '../index.js';
import { UNKNOWN_MELEE } from '../src/melee.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/troll-trees-melee-3.3.4');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');
const troll = read('troll.javap.txt');
const trees = read('trees.javap.txt');
const melee = read('melee.javap.txt');
const configs = read('configs.txt');
const pack = loadRotnData('3.3.4');
const E = pack.dump.entities.entities;

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
/** The instructions with offsets from..to in a method body. */
const offsets = (body, from, to) => body.split('\n').filter((l) => {
    const m = /^\s+(\d+):/.exec(l);
    return m && +m[1] >= from && +m[1] <= to;
}).join('\n');

// ---- the troll ---------------------------------------------------------------------------------

test('troll: size, stats and config from EntityTroll and ice_and_fire.cfg', () => {
    const t = pack.threatOf('iceandfire:if_troll');
    const sec = section(troll, 'EntityTroll <init>');
    inOrder(method(sec, 'EntityTroll(net.minecraft.world.World)'), 'float 1.2f', 'float 3.5f', 'func_70105_a');
    const attrs = method(sec, 'func_110147_ax');
    inOrder(attrs, 'field_111263_d', 'double 0.35d', 'field_111264_e', 'trollAttackStrength', 'field_111267_a', 'trollMaxHealth', 'field_111266_c', 'dconst_1', 'field_188791_g', 'double 9.0d');
    assert.match(cfg('config/ice_and_fire.cfg', /Troll Attack Strength/), /=18\.0$/);
    assert.match(cfg('config/ice_and_fire.cfg', /Troll Max Health/), /=200\.0$/);
    assert.deepEqual([t.reaction, t.source, t.traits.width, t.traits.height, t.traits.speed, t.traits.armor, t.traits.knockbackResistance], ['avoid', 'verified', 1.2, 3.5, 0.35, 9, 1]);
    assert.equal(pack.mobMelee('iceandfire:if_troll').damage, 18);
    assert.equal(t.melee.damage, 18);
    assert.equal(t.melee.hitsToKill, 2);
    // Arrows do nothing; it targets players without line of sight (checkSight false).
    assert.match(method(sec, 'func_70097_a('), /String arrow[\s\S]*ireturn/);
    inOrder(method(sec, 'func_184651_r'), 'EntityAINearestAttackableTarget', 'class net/minecraft/entity/player/EntityPlayer', 'iconst_0', 'EntityAINearestAttackableTarget."<init>"');
    assert.deepEqual(t.traits.immuneTo, ['arrow']);
    assert.equal(t.traits.targetsWithoutSight, true);
    // Spawns only where the block above cannot see the sky.
    inOrder(method(sec, 'func_70601_bi'), 'trollSpawnCheckChance', 'func_177984_a', 'func_175678_i', 'ifne');
    assert.equal(t.traits.spawnsUnderCover, true);
    assert.equal(t.traits.trackingRange, E['iceandfire:if_troll'].tracking.range);
});

test('troll melee: the hit lands at strike tick 10 within 2 blocks, for ATTACK_DAMAGE, as mob damage', () => {
    const upd = section(troll, 'EntityTroll onLivingUpdate');
    const vertical = offsets(upd, 654, 729);
    inOrder(vertical, 'ANIMATION_STRIKE_VERTICAL', 'func_70068_e', 'double 4.0d', 'getAnimationTick', 'bipush        10', 'func_76358_a', 'field_111264_e', 'func_70097_a');
    inOrder(offsets(upd, 730, 804), 'ANIMATION_STRIKE_HORIZONTAL', 'double 4.0d', 'bipush        10', 'func_76358_a', 'field_111264_e', 'func_70097_a');
    // Strikes last 20 ticks (static init: Animation.create(20) for both strikes).
    inOrder(section(troll, 'EntityTroll static init'), 'bipush        20', 'ANIMATION_STRIKE_HORIZONTAL', 'bipush        20', 'ANIMATION_STRIKE_VERTICAL');
    const m = pack.mobMelee('iceandfire:if_troll');
    assert.deepEqual([m.reach, m.intervalTicks], [2, 20]);
    assert.match(cfg('config/rotm.cfg', /iceandfire:if_troll;potioncore:broken_armor;100;0;10;100/), /:511:/);
    assert.match(m.onHit, /Broken Armor I for 10 s/);
});

test('troll blast: breaks blocks below explosion resistance 8.37 when it has no path, 1.7 to 5.5 blocks from its target', () => {
    const upd = section(troll, 'EntityTroll onLivingUpdate');
    const blast = offsets(upd, 945, 1243);
    inOrder(blast, 'func_75500_f', 'func_70068_e', 'double 3.0d', 'func_70068_e', 'double 30.0d', 'String mobGriefing', 'bipush        15',
        'ANIMATION_STRIKE_VERTICAL', 'bipush        10', 'double 1.899999976158142d', 'func_70047_e', 'fconst_2', 'fdiv', 'BlockBreakExplosion', 'fconst_1', 'nextFloat', 'fadd',
        'GenericGriefEvent', 'func_77278_a', 'func_77279_a');
    // The ray rule: power = size x (0.7 + 0.6 x nextFloat), minus (resistance + 0.3) x 0.3, then 0.225 a step.
    const bbe = section(troll, 'BlockBreakExplosion <init>');
    const a = method(bbe, 'func_77278_a');
    inOrder(a, 'explosionSize', 'float 0.7f', 'nextFloat', 'float 0.6f', 'fmul', 'fadd', 'fmul', 'float 0.3f', 'func_180428_a', 'float 0.3f', 'fadd', 'float 0.3f', 'fmul', 'fsub', 'func_174816_a', 'canEntityDestroy', 'float 0.22500001f');
    inOrder(method(bbe, 'func_77279_a'), 'func_180653_a', 'onBlockExploded');
    const maxPower = 2 * (0.7 + 0.6); // size = 1 + nextFloat < 2
    const limit = maxPower / 0.3 - 0.3;
    const blaster = pack.mobDiggingData.blasters['iceandfire:if_troll'];
    assert.ok(Math.abs(blaster.breaksResistanceBelow - limit) < 1e-3, `${blaster.breaksResistanceBelow} vs ${limit}`);
    assert.deepEqual([blaster.blastAhead, blaster.minDistance, blaster.maxDistance], [1.9, 1.73, 5.47]);
    assert.ok(Math.abs(Math.sqrt(3) - blaster.minDistance) < 0.01 && Math.abs(Math.sqrt(30) - blaster.maxDistance) < 0.01);
    // ESM does not touch it.
    assert.match(cfg('config/esm/epicsiegemod.cfg', /iceandfire:if_troll$/), /:579:/);
    assert.equal(pack.mobDiggingData.diggers['iceandfire:if_troll'], undefined);
});

test('mobDigging/canMobDig: the troll is a blaster, answered by explosion resistance; ESM diggers say mechanism esm', () => {
    const d = pack.mobDigging('iceandfire:if_troll');
    assert.deepEqual([d.digs, d.mechanism, d.requiresTools, d.keepWithin], [true, 'blast', false, null]);
    for (const b of ['minecraft:cobblestone', 'minecraft:stone', 'minecraft:planks', 'minecraft:dirt', 'minecraft:glass']) {
        const r = pack.canMobDig('iceandfire:if_troll', b);
        assert.deepEqual([r.canDig, r.uncertain, r.needs], [true, false, null], b);
    }
    // Stone bricks have resistance 27.5 on this pack (vanilla 6): troll-proof.
    for (const b of ['minecraft:obsidian', 'minecraft:end_stone', 'minecraft:stonebrick']) {
        const r = pack.canMobDig('iceandfire:if_troll', b);
        assert.equal(r.canDig, false, b);
        assert.ok(pack.dump.blocks.blocks[b].states[0].explosionResistance >= 8.37, b);
    }
    assert.equal(pack.mobDigging('minecraft:zombie').mechanism, 'esm');
    assert.equal(pack.mobDigging('twilightforest:troll').mechanism, 'esm');
    assert.equal(pack.mobDigging('minecraft:skeleton'), null);
    const torch = pack.canMobDig('iceandfire:if_troll', 'minecraft:torch');
    assert.deepEqual([torch.canDig, torch.reason], [false, 'not a wall block']);
});

test('troll in daylight: stone only by day under open sky at brightness > 0.5; flees only from open sky; stone is for good', () => {
    const upd = section(troll, 'EntityTroll onLivingUpdate');
    inOrder(offsets(upd, 202, 383), 'func_72935_r', 'setAvoidSun', 'func_72935_r', 'field_72995_K', 'func_70013_c', 'float 0.5f', 'func_175678_i', 'StoneEntityProperties.isStone', 'iconst_1', 'putfield');
    const flee = section(troll, 'TrollAIFleeSun');
    inOrder(method(flee, 'TrollAIFleeSun('), 'iconst_1', 'func_75248_a');
    inOrder(method(flee, 'func_75250_a'), 'func_72935_r', 'ifne', 'iconst_0', 'func_175678_i', 'ifne', 'iconst_0', 'findPossibleShelter');
    inOrder(method(flee, 'Vec3d findPossibleShelter'), 'bipush        10', 'bipush        20', 'bipush        10', 'bipush        6', 'iconst_3', 'bipush        20', 'bipush        10', 'func_175678_i', 'ifne', 'func_180484_a');
    const stone = section(troll, 'ServerEvents.onEntityUpdate');
    inOrder(stone, 'StoneEntityProperties.isStone', 'field_70159_w', 'field_70179_y', 'func_94061_f', 'func_70624_b');
    assert.match(section(troll, 'ServerEvents.onEntityDespawn'), /isStone[\s\S]*DENY/);
    const t = pack.threatOf('iceandfire:if_troll');
    assert.deepEqual([t.traits.sunlight, t.traits.activeByDayInShade], ['turns-to-stone', true]);
    assert.match(t.summary, /in shade/);
    // Not on Ice and Fire's stone-immune list.
    const immune = configs.split('\n').filter((l) => l.startsWith('config/ice_and_fire.cfg:2'));
    assert.ok(immune.some((l) => /immune to being turned to stone/.test(l)) && !immune.some((l) => /if_troll/.test(l)));
});

test('troll spawns: 71 overworld biomes, weight 55, In Control only in dimension 10', () => {
    const biomes = new Set();
    for (const [b, cats] of Object.entries(pack.dump.spawns.biomes)) {
        for (const s of cats.monster ?? []) if (s.entity === 'iceandfire:if_troll') { biomes.add(b); assert.equal(s.weight, 55, b); }
    }
    assert.equal(biomes.size, 71);
    const t = pack.threatOf('iceandfire:if_troll');
    assert.deepEqual([t.traits.spawnBiomes, t.traits.spawnWeight], [71, 55]);
    assert.match(cfg('config/ice_and_fire.cfg', /Troll Spawn Weight/), /=55$/);
    const ic = configs.split('\n').filter((l) => l.startsWith('config/incontrol/spawn.json'));
    assert.ok(ic.length > 0 && ic.filter((l) => /"dimension"/.test(l)).every((l) => /"dimension": 10,/.test(l)));
    // Special AI gives it door breaking, idle fiddling and idle griefing (lights) at chance 1.0.
    for (const n of [120, 461, 713]) assert.ok(configs.includes(`config/Special_AI.cfg:${n}:         iceandfire:if_troll 1.0`), n);
    assert.match(cfg('config/Special_AI.cfg', /break_lights/), /=true/);
    assert.deepEqual([t.traits.breaksDoors, t.traits.breaksLights], [true, true]);
});

// ---- falling trees -----------------------------------------------------------------------------

test('falling trees: "fallingtree" damage, woodVolume x fall speed x 3 x 1.5 before the first bounce', () => {
    const src = section(trees, 'TreeDamageSource');
    assert.match(src, /String fallingtree/);
    assert.doesNotMatch(src, /func_76348_h|func_151518_m|setDamageBypassesArmor/);
    const hm = method(section(trees, 'AnimationHandlerFallover handleMotion'), 'void handleMotion');
    inOrder(hm, 'field_70122_E', 'getMassCenter', 'fconst_2', 'fmul', 'double 0.2d', 'ddiv', 'addRotation');
    inOrder(hm, 'bounces', 'float -0.25f');
    inOrder(hm, 'enableFallingTreeDamage', 'testEntityCollision', 'entitiesHit', 'woodVolume', 'Math.abs', 'fmul', 'float 3.0f', 'fmul', 'bounces', 'ifne', 'fconst_2', 'ifle', 'func_176734_d', 'fallingTreeDamageMultiplier', 'fmul', 'TREE_DAMAGE', 'func_70097_a');
    inOrder(section(trees, 'NodeNetVolume'), 'imul', 'bipush        64', 'imul', 'float 4096.0f', 'fdiv');
    inOrder(section(trees, 'BlockBranch.futureBreak'), 'func_70093_af', 'field_178784_b', 'func_176734_d', 'field_178784_b', 'destroyBranchFromNode');
    assert.match(cfg('config/dynamictrees.cfg', /enableFallingTreeDamage/), /=true$/);
    assert.match(cfg('config/dynamictrees.cfg', /enableFallingTrees=/), /=true$/);
    assert.match(cfg('config/dynamictrees.cfg', /fallingTreeDamageMultiplier/), /=1\.5$/);
    assert.match(cfg('config/dmgcontrol.cfg', /DamageModifier_fallingtree/), /=1\.0$/);
    const f = pack.fallingTree();
    assert.deepEqual([f.enabled, f.damageSource, f.multiplier, f.bypassesArmor, f.attacker], [true, 'fallingtree', 1.5, false, null]);
    assert.equal(f.evidence, undefined);
    // 2 logs of volume, mass centre 3 up, hit at the ground: 2 x sqrt(0.2 x 90 / 3) x 3 x 1.5.
    assert.equal(pack.fallingTreeDamage({ woodVolume: 2, massCenterHeight: 3 }), Math.round(2 * Math.sqrt(6) * 3 * 1.5 * 10) / 10);
    assert.equal(pack.fallingTreeDamage({ woodVolume: 0.1, massCenterHeight: 3 }), 0, 'below the 2 threshold');
    assert.ok(pack.fallingTreeDamage({ woodVolume: 2, massCenterHeight: 3, angle: 30 }) < pack.fallingTreeDamage({ woodVolume: 2, massCenterHeight: 3 }));
});

// ---- melee table -------------------------------------------------------------------------------

const MM = pack.mobMeleeData;

test('mob-melee.json: well formed, every mob in the dump, every entry cited', () => {
    assert.equal(MM.format, 'rotn-mob-melee/1');
    for (const [name, m] of Object.entries(MM.mobs)) {
        assert.ok(E[name] && pack.names.entities.has(name), name);
        assert.ok(typeof m.damage === 'number' && m.damage >= 0, name);
        assert.ok(m.maxDamage === undefined || m.maxDamage > m.damage, name);
        assert.ok(['verified', 'vanilla'].includes(m.confidence), name);
        assert.ok(m.evidence.length > 0 && m.evidence.some((e) => /\.jar|config\//.test(e)), name);
    }
    for (const re of [/scratchpad/i, /\/home\//, /\/tmp\//]) assert.doesNotMatch(JSON.stringify(MM), re);
});

test('vanilla damage from the obfuscated server jar: zombie 3, pigman 5, enderman 7, vindicator 5, silverfish 1, endermite 2, wither skeleton 4, default 2', () => {
    // adh.f is generic.attackDamage with default 2.0; ade (EntityMob) registers it.
    inOrder(section(melee, 'adh (SharedMonsterAttributes)'), 'String generic.attackDamage', 'double 2.0d', 'putstatic', 'Field f:');
    inOrder(section(melee, 'ade (EntityMob)'), 'adh.f', 'wg.b');
    const reg = section(melee, 'vi (EntityList) registrations');
    const want = { zombie: ['adt', 3], zombie_pigman: ['adf', 5], enderman: ['acu', 7], vindication_illager: ['adq', 5], silverfish: ['adj', 1], endermite: ['acv', 2] };
    for (const [n, [obf, dmg]] of Object.entries(want)) {
        inOrder(reg, `String ${n}\n`, `class ${obf}\n`);
        const sec = section(melee, `${obf} (`);
        const lit = dmg === 1 ? 'dconst_1' : `double ${dmg.toFixed(1)}d`;
        inOrder(sec, 'adh.f', lit, 'wd.a:(D)V');
        assert.equal(pack.mobMelee(`minecraft:${n}`).damage, dmg, n);
    }
    inOrder(section(melee, 'ads (wither_skeleton)'), 'adh.f', 'double 4.0d', 'wd.a:(D)V');
    assert.equal(pack.mobMelee('minecraft:wither_skeleton').damage, 4);
    // Spider, skeleton, stray: no ATTACK_DAMAGE of their own -> 2.0.
    assert.doesNotMatch(section(melee, 'adn (spider)'), /adh\.f/);
    for (const n of ['spider', 'skeleton', 'stray', 'cave_spider']) assert.equal(pack.mobMelee(`minecraft:${n}`).damage, 2, n);
    inOrder(section(melee, 'acr (cave_spider)'), 'bipush        7', 'bipush        15');
    for (const [obf, sup] of [['adb', 'adt'], ['adu', 'adt'], ['ado', 'acp'], ['adk', 'acp']]) assert.match(section(melee, `${obf} (`), new RegExp(`class ${obf} extends ${sup}`));
    // Slime: damage = size.
    inOrder(section(melee, 'adl (slime)'), 'int di()', 'Method dl:()I', 'ireturn');
});

test('modded damage from bytecode and config', () => {
    // Fish's Undead Rising reads its config; the field names map to these keys.
    const fur = section(melee, "Fish's Undead Rising Modconfig");
    for (const [field, key, name, dmg] of [['ZombieMushroom', 'mycosis', 'mod_lavacow:zombiemushroom', 3], ['ZombieFrozen', 'frigid', 'mod_lavacow:zombiefrozen', 3], ['Mummy', 'mummy', 'mod_lavacow:mummy', 4], ['Parasite', 'parasite', 'mod_lavacow:parasite', 1], ['SludgeLord', 'sludge lord', 'mod_lavacow:sludgelord', 7]]) {
        inOrder(fur, `String ${key} attack`, `Field ${field}_Attack:D`);
        assert.match(cfg('config/Fishs_Undead_Rising.cfg', new RegExp(`"${key} attack"`)), new RegExp(`=${dmg}\\.0$`));
        assert.equal(pack.mobMelee(name).damage, dmg, name);
    }
    assert.equal(pack.mobMelee('mod_lavacow:weta').damage, 3 + 1, 'Rough Mobs adds 1');
    assert.match(cfg('config/roughmobsrevamped.cfg', /mod_lavacow:weta;generic\.attackDamage;0;1/), /:583:/);
    inOrder(section(melee, 'Charm Spectre.configure'), 'float 0.01f', 'attackDamage');
    assert.equal(pack.mobMelee('charm:spectre').damage, 0.01);
    inOrder(section(melee, 'EntityShambler applyEntityAttributes'), 'field_111264_e', 'double 14.0d');
    assert.match(section(melee, 'EntityShamblerTwisted header'), /extends lykrast\.defiledlands\.common\.entity\.monster\.EntityShambler/);
    inOrder(section(melee, 'EntityGiant applyEntityAttributes'), 'field_111264_e', 'double 15.0d', 'GlobalDamageMultiplier', 'dmul');
    assert.match(cfg('config/ancientbeasts.cfg', /Global Damage Multiplier/), /=1\.0$/);
    for (const [cls, sup] of [['EntityZombiePlayer header (zombie_players', 'EntityZombie'], ['hordes EntityZombiePlayer header', 'EntityZombie'], ['EntityDweller header', 'EntityZombie']]) {
        assert.match(section(melee, cls), new RegExp(`extends net\\.minecraft\\.entity\\.monster\\.${sup} `), cls);
    }
    for (const n of ['zombie_players:zombie_player', 'hordes:zombie_player', 'quark:dweller']) assert.equal(pack.mobMelee(n).damage, 3, n);
});

test('Special Mobs variants: the vanilla base plus each adjustTypeAttributes addAttribute(ATTACK_DAMAGE)', () => {
    inOrder(section(melee, 'SpecialMobData.addAttribute'), 'func_111125_b', 'dadd', 'func_111128_a');
    const base = { zombie: 3, spider: 2, cavespider: 2, skeleton: 2 };
    const special = Object.keys(MM.mobs).filter((n) => n.startsWith('specialmobs:'));
    assert.equal(special.length, 36);
    for (const name of special) {
        const cls = E[name].class.split('.').pop();
        const fam = E[name].class.split('.').slice(-2)[0];
        const sec = section(melee, `${cls} (${fam})`);
        let add = 0;
        for (const m of sec.matchAll(/field_111264_e[^\n]*\n[^\n]*?(?:ldc2_w[^\n]*double (-?[\d.]+)d|(dconst_1))[^\n]*\n[^\n]*addAttribute/g)) {
            if (/adjustTypeAttributes/.test(sec.slice(0, m.index).split(/\n(?= {2}\S)/).pop())) add += m[1] ? +m[1] : 1;
        }
        assert.equal(pack.mobMelee(name).damage, base[fam] + add, name);
    }
    assert.match(section(melee, 'Entity_SpecialCaveSpider (cavespider)'), /extends net\.minecraft\.entity\.monster\.EntityCaveSpider /);
    inOrder(section(melee, 'EntityBruteZombie (zombie)'), 'onTypeAttack', 'fconst_2', 'causeLifeLoss');
});

test('nothing on the pack scales mob damage: difficulty normal, Scaling Health, ESM, Damage Control, Thicc Entities', () => {
    assert.match(cfg('server.properties', /difficulty=/), /difficulty=2$/);
    assert.match(cfg('config/scalinghealth/main.cfg', /"Damage Modifier"/), /=0\.0$/);
    assert.match(cfg('config/scalinghealth/main.cfg', /"Difficulty Weight"/), /=0\.00$/);
    assert.match(cfg('config/scalinghealth/main.cfg', /"Increase Per Second"/), /=0\.0$/);
    assert.match(configs, /config\/scalinghealth\/main\.cfg:416:\s+S:"Mob Potions" <\nconfig\/scalinghealth\/main\.cfg:417:\s+>/);
    assert.match(cfg('config/esm/epicsiegemod.cfg', /Boss Kill Modifier/), /=0\.0$/);
    assert.match(cfg('config/dmgcontrol.cfg', /DamageModifier_mob=/), /=1\.0$/);
    assert.match(cfg('config/dmgcontrol.cfg', /DamageModifier_player=/), /=0\.8$/);
    assert.match(section(configs, 'thiccentities.cfg (if_troll)'), /D:damage=1\.0/);
    assert.match(MM.general.summary, /80%/);
});

test('threatOf carries melee; nightThreats carries damage; the uncovered night threats are known', () => {
    assert.equal(pack.threatOf('minecraft:zombie').melee.damage, 3);
    assert.equal(pack.threatOf('minecraft:zombie').melee.evidence, undefined);
    assert.equal(pack.threatOf('minecraft:creeper').melee, null);
    assert.equal(pack.threatOf('iceandfire:firedragon').melee, null, 'dangerous branch has the field');
    const night = pack.nightThreats({ limit: 1000 });
    assert.equal(night.find((t) => t.name === 'iceandfire:if_troll').damage, 18);
    // Hostile night threats to fight or avoid whose damage was not read (no plain ATTACK_DAMAGE literal); listed so a gap is deliberate.
    const NOT_READ = ['ancientbeasts:ghost', 'ancientbeasts:nekros', 'ancientbeasts:sandy', 'ancientbeasts:zealot', 'betteranimalsplus:tarantula', 'defiledlands:scuttler', 'mowziesmobs:barakoana', 'rats:illager_piper'];
    const gaps = night.filter((t) => ['fight', 'avoid'].includes(t.reaction) && t.damage == null).map((t) => t.name).sort();
    assert.deepEqual(gaps, NOT_READ);
});

// ---- #496 review (lead): weapons, ESM demolition and damage, the troll's through-wall hit and blast, UNKNOWN_MELEE ----

test('zombie worst case: the stone axe (+8) and Sharpness II (+1.5) for every mob on Rough Mobs\' zombie list', () => {
    const axe = section(melee, 'agy (ItemAxe)');
    inOrder(axe, 'protected agy(ain$a)', 'Field f:[F', 'ain$a.ordinal', 'faload', 'putfield', 'Field b:F');
    inOrder(axe, 'static {}', 'newarray       float', 'float 6.0f', 'float 8.0f', 'float 8.0f', 'float 8.0f', 'float 6.0f', 'putstatic', 'Field f:[F');
    inOrder(section(melee, 'ahq (ItemTool)'), 'adh.f', 'String Tool modifier', 'Field b:F');
    inOrder(section(melee, 'ain$a (ToolMaterial)'), 'String WOOD', 'iconst_0', 'String STONE', 'iconst_1');
    inOrder(section(melee, 'ATOP ToolAxe'), 'float 6.0f', 'ItemAxe."<init>"');
    inOrder(section(melee, 'ATOP ModItems'), 'String MUD', 'fconst_0', 'addToolMaterial');
    for (const [line, v] of [[128, 'damageBase=4.0'], [131, 'damageMultiplier=1.0'], [178, 'damageBase=2.5'], [181, 'damageMultiplier=0.50']]) {
        assert.ok(configs.includes(`config/spartanweaponry.cfg:${line}:     S:${v}`), `spartan ${line}`);
    }
    assert.match(cfg('config/roughmobsrevamped.cfg', /_zombieEquipmentWeaponChance/), /:3153:.*=5$/);
    assert.match(cfg('config/roughmobsrevamped.cfg', /_zombieEquipmentEnchantChance/), /:3144:.*=20$/);
    assert.match(cfg('config/roughmobsrevamped.cfg', /_zombieEquipmentEnchantMultiplier/), /:3148:.*=0\.3$/);
    assert.match(cfg('config/roughmobsrevamped.cfg', /:3177:/), /stone_pickaxe;3/);
    assert.ok(configs.includes('config/roughmobsrevamped.cfg:3213:         sharpness;4'));
    // The zombie list, from the config lines 2904-2920.
    const list = configs.split('\n').filter((l) => /^config\/roughmobsrevamped\.cfg:(29\d\d):/.test(l) && +l.split(':')[1] > 2903 && +l.split(':')[1] < 2921).map((l) => l.split(': ')[1].trim());
    assert.ok(list.includes('minecraft:zombie') && list.includes('minecraft:husk') && list.includes('minecraft:zombie_villager'));
    const sharpnessII = 1 + 0.5 * (Math.ceil(5 * 0.3) - 1);
    for (const n of list.filter((x) => MM.mobs[x])) {
        const m = pack.mobMelee(n);
        assert.equal(m.maxDamage, m.damage + 8 + sharpnessII, n);
        assert.match(m.weapon, /stone axe/, n);
    }
    assert.deepEqual([pack.mobMelee('minecraft:zombie').maxDamage, pack.mobMelee('minecraft:husk').maxDamage, pack.mobMelee('minecraft:zombie_villager').maxDamage], [12.5, 12.5, 12.5]);
    // Not on the list: no weapon worst case.
    for (const n of ['zombie_players:zombie_player', 'minecraft:zombie_pigman', 'specialmobs:specialzombie']) assert.equal(pack.mobMelee(n).maxDamage, pack.mobMelee(n).damage, n);
});

test('ESM Demolition: 1 in 100 listed mobs carry TNT and drop it lit within 4 blocks, every 10 s', () => {
    inOrder(section(melee, 'ESM AdditionDemolition'), 'getTaskPriority', 'iconst_4', 'isValid', 'DEMOLITION', 'dconst_0', 'getAdditionalAI', 'nextDouble', 'DEMOLITION', 'OFFHAND', 'field_150335_W', 'func_184201_a', 'ESM_EntityAIDemolition');
    const ai = section(melee, 'ESM ESM_EntityAIDemolition');
    inOrder(ai, 'func_75250_a', 'delay', 'func_184614_ca', 'field_150335_W', 'func_184592_cb', 'field_150335_W', 'func_70638_az', 'func_70032_d', 'float 4.0f');
    inOrder(ai, 'func_75249_e', 'sipush        200', 'delay', 'EntityTNTPrimed', 'func_72838_d');
    assert.doesNotMatch(method(ai, 'func_75249_e'), /func_184201_a|func_190918_g/, 'the TNT stays in its hand');
    inOrder(section(melee, 'acm (EntityTNTPrimed)'), 'bipush        80', 'bipush        80', 'float 4.0f');
    inOrder(section(melee, 'vi (EntityList): tnt'), 'String tnt', 'class acm');
    // The members are exactly the entity_ai.json entries with Demolition > 0 (config lines in order).
    const lines = section(configs, 'esm/entity_ai.json').split('\n').filter((l) => l.startsWith('config/')).sort((a, b) => +a.split(':')[1] - +b.split(':')[1]);
    const want = {};
    let cur = null;
    for (const l of lines) {
        const ent = /"([a-z_]+:[a-z_]+)": \{$/.exec(l);
        if (ent) cur = ent[1];
        const d = /"Demolition": ([\d.]+)/.exec(l);
        if (d && cur && +d[1] > 0) want[cur] = +d[1];
    }
    const demo = pack.threatReactions.demolition;
    assert.deepEqual(demo.members, Object.fromEntries(Object.entries(want).sort()));
    assert.equal(Object.keys(demo.members).length, 12);
    assert.deepEqual(demo.explosive, { source: 'tnt', item: 'minecraft:tnt', slot: 'offhand', trigger: 4, fuseTicks: 80, power: 4, repeatTicks: 200, breaksResistanceBelow: 17 });
    assert.ok(Math.abs(4 * 1.3 / 0.3 - 0.3 - demo.explosive.breaksResistanceBelow) < 0.05);
    assert.deepEqual(pack.threatOf('minecraft:zombie').explosive, { ...demo.explosive, chance: 0.01 });
    assert.equal(pack.threatOf('minecraft:husk').explosive, null);
    assert.equal(pack.threatOf('minecraft:creeper').explosive, null);
    assert.equal(pack.canMobDig('iceandfire:if_troll', 'minecraft:cobblestone').canDig, true);
});

test('ESM per-mob Damage changes nothing: default 1.0 (no modifier), a missing key reads 0 (x0)', () => {
    const props = section(melee, 'ESM CfgProps');
    inOrder(props, 'String Demolition', 'double 0.1d', 'String Damage', 'dconst_1');
    inOrder(section(melee, 'ESM JsonHelper.getNumber'), 'iconst_0', 'getNumber', 'areturn');
    inOrder(section(melee, 'ESM GeneralEntityHandler'), 'MOD_DAMAGE', 'BOSS_DAMAGE', 'curBossMod', 'dconst_0', 'dadd', 'dconst_1', 'dcmpl', 'ifeq', 'field_111264_e', 'ESM_TWEAK_3', 'iconst_1', 'func_111121_a');
    const dmg = configs.split('\n').filter((l) => /^config\/esm\/entity_ai\.json:\d+:\s+"Damage"/.test(l));
    assert.deepEqual(dmg.map((l) => l.split(':')[1]), ['80'], 'only the default block has Damage');
    assert.match(dmg[0], /1\.0/);
    assert.ok(MM.general.evidence.some((e) => /ESM_TWEAK_3/.test(e) && /entity_ai\.json:80/.test(e)));
});

test('troll: the hit goes through a 1-block wall (distance only), and its blast hurts for at most 4.8 within 4 blocks', () => {
    const upd = section(troll, 'EntityTroll onLivingUpdate');
    for (const [from, to] of [[654, 729], [730, 804]]) {
        const hit = offsets(upd, from, to);
        assert.match(hit, /func_70068_e/);
        assert.doesNotMatch(hit, /func_70685_l|func_180495_p|func_72933_a|func_147447_a/, 'no canEntityBeSeen, block or ray trace');
    }
    const t = pack.threatOf('iceandfire:if_troll');
    assert.deepEqual([t.traits.hitsThroughWalls, t.traits.reach, t.melee.hitsThroughWalls], [true, 2, true]);
    assert.match(t.traits.reachMeaning, /no line-of-sight or block check/);
    assert.match(t.melee.note, /1-block wall/);
    // 0.6 (half its width) + 1 (wall) + 0.3 (half the player's) < 2 < 0.6 + 2 + 0.3.
    assert.ok(t.traits.width / 2 + 1 + 0.3 < 2 && t.traits.width / 2 + 2 + 0.3 > 2);
    const a = method(section(troll, 'BlockBreakExplosion <init>'), 'func_77278_a');
    inOrder(a, 'explosionSize', 'fconst_2', 'fmul', 'func_76358_a', 'double 2.0d', 'ddiv', 'double 7.0d', 'dmul', 'float 6.0f', 'fdiv', 'func_70097_a');
    const sizeMax = 2;
    assert.equal(t.traits.blastRadius, 2 * sizeMax);
    assert.equal(t.traits.blastDamageMax, Math.round(((1 + 1) / 2 * 7 * 2 * sizeMax + 1) / 6 * 10) / 10);
});

test('UNKNOWN_MELEE: the worst listed hit, exported; null melee means unknown', () => {
    const worst = Math.max(...Object.values(MM.mobs).map((m) => Math.max(m.damage, m.maxDamage ?? 0)));
    assert.equal(UNKNOWN_MELEE, worst);
    assert.equal(UNKNOWN_FROM_INDEX, 18);
    assert.equal(pack.mobMelee('rats:illager_piper'), null);
    assert.equal(pack.fallingTreeDamage(), 0, 'default argument');
    const readme = fs.readFileSync(path.join(HERE, '../README.md'), 'utf8');
    assert.match(readme, /UNKNOWN_MELEE/);
    assert.match(readme, /never zero/);
});
