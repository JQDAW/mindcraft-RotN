// Soak 7 (lead task, 2026-11-21: a zombie with a chainmail helmet won a shelter fight): mob health, attack
// intervals and reach, the bot's weapons, the two attack packets and armour. Checks 3.3.4/combat.json and
// src/combat.js against the javap excerpts and config lines in fixtures/combat-3.3.4/ (from the pinned pack zip;
// vanilla classes as Forge's binpatches leave them; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { hitsToKill as hitsToKillFromIndex, afterArmor } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/combat-3.3.4');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');
const jp = read('combat.javap.txt');
const configs = read('configs.txt');
const pack = loadRotnData('3.3.4');
const C = pack.combatData;

const section = (text, title) => {
    const i = text.indexOf(`\n## ${title}`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return text.slice(i + 1).split(/\n## /)[0];
};
const method = (sec, sig) => {
    const parts = sec.split(/\n(?= {2}\S)/).filter((p) => p.split('\n')[0].includes(sig));
    assert.equal(parts.length, 1, `method ${sig}`);
    return parts[0];
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
    const l = configs.split('\n').find((x) => x.startsWith(`${file}:`) && re.test(x));
    assert.ok(l, `${file} ${re}`);
    return l;
};

test('combat.json: well formed, every fact cited', () => {
    assert.equal(C.format, 'rotn-combat/1');
    for (const [k, m] of Object.entries(C.mobs)) {
        assert.ok(pack.dump.entities.entities[k], k);
        assert.ok(m.maxHealth > 0 && m.armor >= 0 && m.confidence === 'verified' && m.evidence.length > 0, k);
    }
    for (const [k, w] of Object.entries(C.weapons)) {
        assert.ok(w.evidence.length > 0, k);
        assert.equal(w.cooldownTicks, Math.round(20 / w.attackSpeed * 10) / 10, k);
    }
    for (const re of [/scratchpad/i, /\/home\//, /\/tmp\//]) assert.doesNotMatch(JSON.stringify(C), re);
});

test('vanilla attack packet: Better Combat forces the target into its invulnerability window before the damage', () => {
    const bc = section(jp, 'Better Combat EventHandlers.cancelAttackEntityEvent');
    inOrder(bc, 'func_184614_ca', 'func_190926_b', 'func_184592_cb', 'func_190926_b', 'isBlacklisted', 'getTarget', 'instanceof', 'EntityLivingBase', 'field_70771_an', 'putfield', 'field_70172_ad');
    assert.doesNotMatch(bc, /setCanceled/);
    inOrder(section(jp, 'Better Combat ConfigurationHandler blacklist checks'), 'isItemClassBlackList', 'isItemBlackList', 'itemClassBlackArray', 'isInstance', 'itemBlacklist', 'getRegistryName');
    // The lists the code reads (category "white/black lists") are empty on this pack.
    assert.ok(configs.includes('config/bettercombat.cfg:803: "white/black lists" {'));
    assert.match(configs, /bettercombat\.cfg:834:\s+S:"\(Class\) Item Left\/Right Click Blacklist" <\nconfig\/bettercombat\.cfg:835:\s+>/);
    assert.match(configs, /bettercombat\.cfg:857:\s+S:"\(Resource Location\) Item Left\/Right Click Blacklist" <\nconfig\/bettercombat\.cfg:858:\s+>/);
    // No coremod, no mixins: only events and its own packets act on the server.
    const man = section(jp, 'Better Combat MANIFEST.MF').split('\n').slice(1).join('\n');
    assert.match(man, /FMLCorePlugin: com\.bettercombat\.util\.asm\.CustomASMTransformer/);
    assert.doesNotMatch(man, /^com\/bettercombat\//m);
    assert.doesNotMatch(man, /MixinConfigs/);
    // Forge-patched EntityPlayer.attackTargetEntityWithCurrentItem: the event first, then the cooldown scaling.
    const f = section(jp, 'aed (EntityPlayer, Forge-patched) attackTargetEntityWithCurrentItem f(vg): head');
    inOrder(f, '2: invokestatic', 'ForgeHooks.onPlayerAttackTarget', 'float 0.5f', 'Method n:(F)F', 'float 0.2f', 'fload         4', 'fload         4', 'fmul', 'float 0.8f', 'fmul', 'fadd', 'fmul', 'Method ds:()V', 'float 0.9f');
    inOrder(section(jp, 'aed (EntityPlayer, Forge-patched) attackTargetEntityWithCurrentItem f(vg): calls'), 'onPlayerAttackTarget', 'Method vg.a:(Lur;F)Z');
    inOrder(section(jp, 'aed getCooldownPeriod dr()'), 'dconst_1', 'adh.g', 'ddiv', 'double 20.0d', 'dmul');
    inOrder(section(jp, 'aed getCooledAttackStrength n(float)'), 'Field aE:I', 'fload_1', 'fadd', 'Method dr:()F', 'fdiv', 'fconst_0', 'fconst_1');
    inOrder(section(jp, 'aed onUpdate B_()'), 'Field aE:I', 'iconst_1', 'iadd', 'putfield', 'Method aip.b:(Laip;Laip;)Z', 'Method aip.d:(Laip;Laip;)Z', 'Method ds:()V');
    assert.doesNotMatch(section(jp, 'pa (NetHandlerPlayServer, Forge-patched) handleAnimation'), /ds:\(\)V|Field aE/);
    // Forge-patched EntityLivingBase.attackEntityFrom: inside the window only the excess over lastDamage counts.
    const a = section(jp, 'vp (EntityLivingBase, Forge-patched) attackEntityFrom');
    inOrder(a, 'ForgeHooks.onLivingAttack', 'Field V:I', 'Field aI:I', 'fconst_2', 'fdiv', 'fcmpl', 'ifle', 'Field bc:F', 'fcmpg', 'ifgt', 'iconst_0', 'ireturn', 'Field bc:F', 'fsub', 'Method d:(Lur;F)V', 'putfield      #1170', 'Field aI:I', 'putfield      #568', 'Method d:(Lur;F)V');
    const v = C.playerAttack.vanillaPacket;
    assert.deepEqual([v.forcedInvulnerability, v.beforeCooldown], [true, 'reduced, not cancelled (down to 0.2 x attackDamage at c = 0)']);
    // So with the vanilla packet only the first hit on a fresh mob counts, then nothing.
    assert.equal(pack.meleeHitDamage({ weapon: 'minecraft:stone_sword', path: 'vanilla', lastDamage: 3.5 }), 0);
    assert.ok(pack.meleeHitDamage({ weapon: 'minecraft:stone_sword', path: 'vanilla' }) > 0);
    assert.equal(pack.hitsToKill({ mob: 'minecraft:zombie', weapon: 'minecraft:stone_sword', path: 'vanilla' }).hits, Infinity);
});

test('Better Combat\'s own packet: channel bettercombat, discriminator 5, full damage every hit, no cooldown scaling', () => {
    inOrder(section(jp, 'Better Combat CommonProxy'), 'String bettercombat', 'registerChannel');
    inOrder(section(jp, 'Better Combat PacketHandler.registerServerMessages'), 'PacketMainhandAttack$Handler', 'PacketMainhandAttack', 'iconst_5', 'Side.SERVER');
    const pk = section(jp, 'Better Combat PacketMainhandAttack\n');
    inOrder(method(pk, 'void toBytes('), 'writeBoolean', 'entityId', 'iconst_4', 'writeVarInt');
    inOrder(section(jp, 'Better Combat PacketMainhandAttack$Handler'), 'func_73045_a', 'iconst_1', 'Helpers.playerAttackVictim');
    const w = section(jp, 'Better Combat Helpers.playerAttackVictimWithWeapon');
    assert.doesNotMatch(w, /func_184825_o/, 'never getCooledAttackStrength');
    inOrder(w, 'getMainhandAttackDamage', 'playerAttackedVictim');
    inOrder(section(jp, 'Better Combat Helpers.playerAttackedVictim'), 'iconst_0', 'putfield', 'field_70172_ad', 'func_70097_a', 'iconst_0', 'putfield', 'field_70172_ad');
    const p = C.playerAttack.betterCombatPacket;
    assert.deepEqual([p.channel, p.discriminator, p.cooldownScaling, p.resetsTargetInvulnerability, p.serverReachCheck], ['bettercombat', 5, false, true, false]);
    assert.match(cfg('config/bettercombat.cfg', /Minimum Attack Speed Tick Cooldown/), /=8$/);
    assert.equal(pack.meleeHitDamage({ weapon: 'minecraft:stone_sword', lastDamage: 3.5 }), pack.meleeHitDamage({ weapon: 'minecraft:stone_sword' }), 'lastDamage does not matter');
});

test('Better Hurt Timer leaves player hits alone and lets every mob land a full hit', () => {
    const hm = section(jp, 'Better Hurt Timer HurtTimeMixin');
    assert.match(hm, /#145 = Utf8\s+Lnet\/minecraft\/entity\/EntityLivingBase;hurtResistantTime:I/);
    assert.match(hm, /#147 = Integer\s+0/, 'redirects the first read: the half-max check');
    inOrder(method(hm, 'attackResistantOverride'), 'isAttack', 'Capabilities.hurt', 'meleeMap', 'override', 'ifeq', 'override', 'field_70771_an', 'ireturn', 'field_70172_ad', 'ireturn');
    inOrder(method(hm, 'hurtResistantTime(net'), 'damageFrames', 'hurtResistantTime', 'putfield', 'field_70172_ad');
    inOrder(section(jp, 'Better Hurt Timer Events.getThreshold'), 'attackThresholdDefault', 'EntityPlayer', 'attackThresholdPlayer');
    inOrder(section(jp, 'Better Hurt Timer Events.getHurtTime'), 'aload_1', 'getThreshold', 'canSwing', 'getCoolPeriod', 'dload_2', 'dmul', 'getHurtResistantTime', 'getAttackSpeed', 'dmul', 'dmul');
    inOrder(section(jp, 'Better Hurt Timer Events.getAttackSpeed'), 'field_188790_f', 'func_111110_b', 'double 1.2d', 'double 1.2d', 'double 1.2d', 'dload_1', 'double 1.2d', 'dmul', 'ddiv', 'double 20.0d', 'dmul', 'ddiv', 'dsub');
    inOrder(section(jp, 'Better Hurt Timer Events.lambda$onEntityAttack$4'), 'getHurtTime', 'ticksSinceLastMelee', 'if_icmpge', 'override', 'setCanceled', 'ticksSinceLastMelee');
    assert.match(section(jp, 'Better Hurt Timer Events: onEntityAttack priority'), /LOWEST/);
    assert.match(section(jp, 'Better Hurt Timer HurtCapability$Handler'), /instanceof\s+#\d+\s+\/\/ class net\/minecraft\/entity\/EntityLivingBase/);
    for (const [re, val] of [[/I:hurtResistantTime=/, '0'], [/attackThresholdPlayer=/, '0.0'], [/attackThresholdDefault=/, '1.0'], [/turnOffMixins=/, 'false']]) {
        assert.ok(cfg('config/betterhurttimer.cfg', re).endsWith(`=${val}`), String(re));
    }
    // An unarmed mob: int(20 x (1.2 - 0.06 x 4)) = 19 ticks, under every listed 20-tick melee interval.
    const gap = Math.trunc(20 * (1.2 - 1.2 / (20 / 4)));
    assert.equal(C.mobsHittingPlayer.minGapTicksUnarmedMob, gap);
    for (const m of Object.values(C.mobs)) if (m.attackIntervalTicks) assert.ok(m.attackIntervalTicks >= gap);
    assert.ok(C.notSettled.some((s) => /getCoolPeriod/.test(s) && /NullPointerException/.test(s)));
});

test('Damage Control: x0.8 on the player\'s hits, before armour; its max health entries are off', () => {
    const dh = section(jp, 'Damage Control DamageHandler');
    inOrder(method(dh, 'onEntityHurt('), 'getAmount', 'getDamageModifier', 'fmul', 'setAmount');
    inOrder(method(dh, 'onEntityJoinWorld('), 'healthAllowed', 'ifeq');
    assert.match(cfg('config/dmgcontrol.cfg', /DamageModifier_player=/), /=0\.8$/);
    assert.match(cfg('config/dmgcontrol.cfg', /AllowHealthModification/), /=false$/);
    inOrder(section(jp, 'vp damageEntity d(ur, float): calls'), 'ForgeHooks.onLivingHurt', 'Method b:(Lur;F)F', 'Method c:(Lur;F)F', 'ForgeHooks.onLivingDamage');
    assert.equal(C.playerAttack.damageModifier, 0.8);
});

test('weapons: Material Changer rewrites the stone axe, stone sword and crude axe', () => {
    const mc = section(jp, 'Material Changer postInit');
    inOrder(method(mc, 'changeAttackDamage('), 'ItemSword', 'fconst_1', 'fsub', 'iconst_0', 'setPrivateValue', 'ItemTool', 'fconst_1', 'fsub', 'iconst_2', 'setPrivateValue');
    inOrder(method(mc, 'changeAttackSpeed('), 'ItemSword', 'ItemTool', 'float 4.0f', 'fsub', 'iconst_3', 'setPrivateValue');
    // Declared field order: ItemTool e, a, b (attackDamage), c (attackSpeed), d; ItemSword a (attackDamage), b.
    const tool = section(jp, 'ahq (ItemTool)');
    inOrder(tool, 'Set<aow> e;', 'float a;', 'float b;', 'float c;', 'ain$a d;', 'String Tool modifier', 'Field b:F', 'String Tool modifier', 'Field c:F');
    assert.match(section(jp, 'SRG names'), /FD: ahq\/b net\/minecraft\/item\/ItemTool\/field_77865_bY/);
    assert.match(section(jp, 'SRG names'), /FD: ahq\/c net\/minecraft\/item\/ItemTool\/field_185065_c/);
    inOrder(section(jp, 'ajy (ItemSword)'), 'float a;', 'ain$a b;', 'String Weapon modifier', 'Field a:F', 'double -2.4000000953674316d');
    const line = (n) => cfg('config/materialchanger.cfg', new RegExp(`^config/materialchanger\\.cfg:${n}:`)).split(': ')[1].trim();
    assert.deepEqual([line(481), line(482), line(1717), line(1728), line(1729), line(1727)], ['ATTACK_SPEED;minecraft:stone_axe;0.4', 'ATTACK_DAMAGE;minecraft:stone_axe;3', 'ATTACK_DAMAGE;minecraft:stone_sword;3.5', 'ATTACK_DAMAGE;pyrotech:crude_axe;3', 'ATTACK_SPEED;pyrotech:crude_axe;0.9', 'DURABILITY;pyrotech:crude_axe;8']);
    assert.ok(configs.includes('config/materialchanger.cfg:82:     S:changer <') && configs.includes('config/materialchanger.cfg:2145:      >'));
    assert.match(section(jp, 'Pyrotech ItemCrudeAxe'), /extends com\.codetaylor\.mc\.pyrotech\.modules\.tool\.item\.spi\.ItemAxeBase[\s\S]*ToolMaterial\.STONE/);
    assert.match(section(jp, 'Pyrotech ItemAxeBase'), /extends net\.minecraft\.item\.ItemAxe /);
    assert.doesNotMatch(section(jp, 'Pyrotech ItemCrudeAxe') + section(jp, 'Pyrotech ItemAxeBase'), /func_111205_h|getAttributeModifiers/);
    const W = (k) => pack.weaponStats(k);
    assert.deepEqual([W('minecraft:stone_axe').attackDamage, W('minecraft:stone_axe').attackSpeed, W('minecraft:stone_axe').cooldownTicks], [3, 0.4, 50]);
    assert.deepEqual([W('pyrotech:crude_axe').attackDamage, W('pyrotech:crude_axe').attackSpeed, W('pyrotech:crude_axe').durability], [3, 0.9, 8]);
    assert.deepEqual([W('minecraft:stone_sword').attackDamage, W('minecraft:stone_sword').attackSpeed], [3.5, 1.6]);
    assert.deepEqual([W('minecraft:wooden_sword').attackDamage, W('hand').attackDamage, W('hand').cooldownTicks], [4, 1, 5]);
    assert.match(W('minecraft:wooden_sword').note, /removeAndHide/);
    assert.ok(configs.includes('scripts/minecraft_(max-file-size).zs:1079: JEI.removeAndHide(<minecraft:wooden_sword>);'));
    assert.equal(W('minecraft:nothing'), null);
});

test('mob health: vanilla attributes, nothing on the pack changes them; the zombie leader bonus', () => {
    const bM = (t) => section(jp, t);
    inOrder(bM('adh (SharedMonsterAttributes)'), 'String generic.maxHealth', 'double 20.0d', 'String generic.attackSpeed', 'double 4.0d');
    inOrder(bM('adt (EntityZombie) header'), 'class adt extends ade', 'double 35.0d', 'double 0.23', 'adh.f', 'double 3.0d', 'adh.h', 'double 2.0d');
    assert.doesNotMatch(bM('adt (EntityZombie) header'), /adh\.a:/, 'no maxHealth of its own: 20');
    inOrder(bM('adn (EntitySpider) header'), 'adh.a', 'double 16.0d');
    inOrder(bM('acr (EntityCaveSpider) header'), 'class acr extends adn', 'adh.a', 'double 12.0d');
    for (const t of ['acp (AbstractSkeleton) header', 'acs (EntityCreeper) header']) assert.doesNotMatch(bM(t), /adh\.a:/, t);
    for (const [t, sup] of [['adb (EntityHusk)', 'adt'], ['adu (EntityZombieVillager)', 'adt'], ['adk (EntitySkeleton)', 'acp']]) {
        const s = bM(t);
        assert.match(s, new RegExp(`extends ${sup}`), t);
        assert.doesNotMatch(s, / bM\(\);/, t);
    }
    inOrder(bM('adt (EntityZombie) onInitialSpawn'), 'Method ua.d:()F', 'nextFloat', 'float 0.05f', 'fmul', 'String Leader zombie bonus', 'adh.a', 'String Leader zombie bonus', 'nextDouble', 'double 3.0d', 'dmul', 'dconst_1', 'dadd', 'iconst_2');
    // ESM: the health modifier uses the entry's number with operation 1; the entries have no Health key (0: no change).
    inOrder(bM('ESM GeneralEntityHandler'), 'MOD_HEALTH', 'BOSS_HEALTH', 'dconst_1', 'dcmpl', 'ifeq', 'field_111267_a', 'String ESM_TWEAK_1', 'dload         5', 'iconst_1');
    assert.equal(configs.split('\n').filter((l) => /entity_ai\.json:\d+:\s+"Health"/.test(l)).length, 1);
    assert.match(cfg('config/esm/entity_ai.json', /"Health"/), /:79:/);
    assert.match(cfg('config/scalinghealth/main.cfg', /Allow Hostile Extra Health/), /=false$/);
    assert.match(cfg('config/scalinghealth/main.cfg', /"Base Health Modifier"=/), /=0\.0$/);
    for (const l of configs.split('\n').filter((x) => /thiccentities\.cfg:\d+:\s+D:health=/.test(x))) assert.match(l, /=1\.0$/);
    for (const l of configs.split('\n').filter((x) => /roughmobsrevamped\.cfg:\d+:\s+\S*(zombie|husk|spider|skeleton|creeper)\S*;generic/.test(x))) assert.doesNotMatch(l, /maxHealth/);
    inOrder(bM('Zombie Players EntityZombiePlayer'), 'extends net.minecraft.entity.monster.EntityZombie', 'field_111267_a', 'double 20.0d', 'func_111128_a');
    assert.doesNotMatch(bM('Zombie Players EntityZombiePlayer'), /func_110147_ax\(\)/);
    assert.doesNotMatch(bM('The Hordes EntityZombiePlayer'), /func_110147_ax\(\)/);
    const H = (k) => pack.combatOf(k).maxHealth;
    assert.deepEqual(['minecraft:zombie', 'minecraft:husk', 'minecraft:zombie_villager', 'zombie_players:zombie_player', 'hordes:zombie_player', 'minecraft:spider', 'minecraft:cave_spider', 'minecraft:skeleton', 'minecraft:creeper', 'iceandfire:if_troll'].map(H), [20, 20, 20, 20, 20, 16, 12, 20, 20, 200]);
    assert.equal(pack.combatOf('minecraft:zombie').armor, 2);
    assert.equal(pack.combatOf('minecraft:nothing'), null);
});

test('attack intervals and reach: 20 ticks for melee, the skeleton\'s bow 40 on normal, the creeper\'s fuse 30', () => {
    inOrder(section(jp, 'acp (AbstractSkeleton) setCombatTask dm()'), 'bipush        20', 'tz.d', 'if_acmpeq', 'bipush        40', 'ye.b:(I)V');
    assert.match(cfg('server.properties', /difficulty=/), /=2$/);
    inOrder(section(jp, 'acs (EntityCreeper) <init>'), 'bipush        30', 'Field bz:I', 'iconst_3', 'Field bA:I');
    assert.match(section(jp, 'SRG names'), /FD: acs\/bz net\/minecraft\/entity\/monster\/EntityCreeper\/field_82225_f/);
    inOrder(section(jp, 'adt (EntityZombie) initEntityAI r()'), 'new', 'class yq');
    const c = (k) => pack.combatOf(k);
    assert.deepEqual([c('minecraft:skeleton').bowIntervalTicks, c('minecraft:creeper').fuseTicks, c('minecraft:creeper').explosionRadius], [40, 30, 3]);
    // Reach agrees with mob-melee.json where both have it.
    for (const [k, m] of Object.entries(C.mobs)) {
        const mm = pack.mobMelee(k);
        if (m.reach && mm?.reach) assert.equal(m.reach, mm.reach, k);
        if (m.attackIntervalTicks && mm?.intervalTicks) assert.equal(m.attackIntervalTicks, mm.intervalTicks, k);
    }
    assert.equal(c('minecraft:zombie').reach, Math.round(Math.sqrt(1.2 ** 2 + 0.6) * 100) / 100);
});

test('armour: vanilla formula and materials; In Control gives a zombie at most one leather or chainmail piece', () => {
    const up = section(jp, 'up (CombatRules)');
    inOrder(up, 'fconst_2', 'float 4.0f', 'fdiv', 'fadd', 'fdiv', 'fsub', 'float 0.2f', 'fmul', 'float 20.0f', 'rk.a:(FFF)F', 'fconst_1', 'float 25.0f', 'fdiv', 'fsub', 'fmul');
    const av = section(jp, 'agv$a (ItemArmor$ArmorMaterial)');
    // Each material: name, then 4 armour values (boots, legs, chest, helmet) pushed as iconst_N.
    const vals = (name) => {
        const s = av.slice(av.indexOf(`String ${name}\n`));
        const after = s.slice(s.indexOf('newarray'));
        const nums = [...after.matchAll(/(?:iconst_|bipush\s+)(\d+)/g)].slice(0, 8).map((m) => +m[1]);
        assert.deepEqual([nums[0], nums[2], nums[4], nums[6]], [0, 1, 2, 3], `${name}: array indices`);
        return [nums[1], nums[3], nums[5], nums[7]];
    };
    const want = { LEATHER: ['leather', [1, 2, 3, 1]], CHAIN: ['chainmail', [1, 4, 5, 2]], IRON: ['iron', [2, 5, 6, 2]], GOLD: ['golden', [1, 3, 5, 2]] };
    for (const [mat, [id, arr]] of Object.entries(want)) {
        assert.deepEqual(vals(mat), arr, mat);
        const items = ['boots', 'leggings', 'chestplate', 'helmet'].map((p) => C.armor.items[`minecraft:${id}_${p}`]);
        assert.deepEqual(items, arr, mat);
    }
    // In Control: four 10% rules, the first match wins.
    inOrder(section(jp, 'In Control ForgeEventHandlers.onEntitySpawnEvent'), 'SpawnRule.match', 'getResult', 'SpawnRule.action', 'return', 'iinc', 'goto');
    for (const [n, slot] of [[39, 'armorhelmet'], [44, 'armorchest'], [49, 'armorlegs'], [55, 'armorboots']]) assert.match(cfg('config/incontrol/spawn.json', new RegExp(`^config/incontrol/spawn\\.json:${n}:`)), new RegExp(`"${slot}": \\["minecraft:leather_\\w+", "minecraft:chainmail_\\w+"\\]`));
    const ps = C.spawnArmor.incontrol.perSpawn;
    assert.deepEqual([ps.head, ps.chest, ps.legs, ps.feet].map((x) => Math.round(x * 1e4)), [0.1, 0.9 * 0.1, 0.81 * 0.1, 0.729 * 0.1].map((x) => Math.round(x * 1e4)));
    assert.match(cfg('config/roughmobsrevamped.cfg', /_zombieEquipmentArmorChance/), /=0$/);
    inOrder(section(jp, 'vq (EntityLiving) setEquipmentBasedOnDifficulty'), 'float 0.15f', 'Method ua.d:()F', 'fmul', 'float 0.1f', 'float 0.25f', 'float 0.095f');
    assert.equal(afterArmor(10, 0), 10);
    assert.equal(afterArmor(2.4, 4), 2.4 * (1 - (4 - 1.2) / 25));
    assert.equal(afterArmor(0.8, 2), 0.8 * (1 - 1.6 / 25));
});

test('the soak 7 fight: a zombie with a chainmail helmet', () => {
    const fight = (weapon, path, armorItems = ['minecraft:chainmail_helmet']) => hitsToKillFromIndex({ mob: 'minecraft:zombie', weapon, path, armorItems });
    // Better Combat's packet: every hit counts.
    assert.deepEqual([fight('minecraft:stone_axe').hits, fight('pyrotech:crude_axe').hits, fight('minecraft:stone_sword').hits, fight('hand').hits], [10, 10, 8, 30]);
    assert.equal(fight('minecraft:stone_axe').armor, 4);
    // Without the helmet the axe needs one hit fewer; full chainmail (armour 14) about doubles every count.
    assert.equal(fight('minecraft:stone_axe', 'bettercombat', []).hits, 9);
    assert.equal(fight('minecraft:stone_axe', 'bettercombat', ['minecraft:chainmail_helmet', 'minecraft:chainmail_chestplate', 'minecraft:chainmail_leggings', 'minecraft:chainmail_boots']).hits, 18);
    // The vanilla packet: the first hit (2.4 after x0.8) is all the zombie ever takes.
    for (const w of ['minecraft:stone_axe', 'minecraft:stone_sword', 'hand']) assert.equal(fight(w, 'vanilla').hits, Infinity, w);
    // The stone sword is the better weapon here: more damage per tick of cooldown than either axe.
    const per = (w) => pack.meleeHitDamage({ weapon: w }) / pack.weaponStats(w).cooldownTicks;
    assert.ok(per('minecraft:stone_sword') > per('pyrotech:crude_axe') && per('pyrotech:crude_axe') > per('minecraft:stone_axe'));
    assert.throws(() => pack.meleeHitDamage({ path: 'other' }));
});

test('mob-melee.json: the zombie weapon worst case is +6 with Material Changer (#496 used +8)', () => {
    const sb = section(jp, 'Spartan Weaponry ItemSwordBase');
    inOrder(sb, 'getAttackDamage', 'fload         4', 'fmul', 'fload_3', 'fadd', 'fconst_1', 'fsub', 'putfield', 'field_150934_a');
    inOrder(section(jp, 'Spartan Weaponry ItemRegistrySW: club_studded'), 'String club_studded', 'ToolMaterialEx.IRON');
    inOrder(section(jp, 'agy (ItemAxe) static init'), 'float 6.0f', 'float 8.0f');
    const line = (n) => cfg('config/materialchanger.cfg', new RegExp(`^config/materialchanger\\.cfg:${n}:`));
    assert.match(line(480), /ATTACK_SPEED;minecraft:wooden_axe;0\.6/, 'the wooden axe keeps its +6');
    assert.match(line(1706), /ATTACK_DAMAGE;atop:mud_sword;6/);
    for (const n of ['minecraft:zombie', 'minecraft:husk', 'minecraft:zombie_villager', 'specialmobs:giantzombie']) {
        const m = pack.mobMelee(n);
        assert.equal(m.maxDamage, m.damage + 6 + 1.5, n);
        assert.ok(m.evidence.some((e) => /combat-3\.3\.4/.test(e) && /materialchanger\.cfg:482/.test(e)), n);
        assert.ok(!m.evidence.some((e) => /the strongest is the stone axe/.test(e)), n);
    }
});
