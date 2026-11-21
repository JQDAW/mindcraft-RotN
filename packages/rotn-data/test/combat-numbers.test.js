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
        // Better Combat's client pacing and its unarmed & non-weapon reduction.
        assert.equal(w.bcCooldownTicks, Math.max(8, Math.trunc(20 / w.bcAttackSpeed + 0.5)), k);
        assert.equal(w.bcAttackDamage, w.attackDamage - (w.bcWeapon ? 0 : C.playerAttack.betterCombatPacket.unarmedDamageReduction), k);
        assert.ok(w.bcCritChance > 0 && w.bcCritChance < 1, k);
    }
    for (const re of [/scratchpad/i, /\/home\//, /\/tmp\//]) assert.doesNotMatch(JSON.stringify(C), re);
});

test('vanilla attack packet: Better Combat forces the target into its invulnerability window before the damage', () => {
    const bc = section(jp, 'Better Combat EventHandlers.cancelAttackEntityEvent');
    inOrder(bc, 'func_184614_ca', 'func_190926_b', 'func_184592_cb', 'func_190926_b', 'isBlacklisted', 'getTarget', 'instanceof', 'EntityLivingBase', 'field_70771_an', 'putfield', 'field_70172_ad');
    assert.doesNotMatch(bc, /setCanceled/);
    inOrder(bc, 'field_70172_ad', 'func_85031_j', 'return');
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
    assert.match(v.lastDamageResets, /only on a later full hit/);
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
    // An armed mob takes the same null-safe path: the capability sets ticksSinceLastSwing to -1, canSwing needs >= 0,
    // and only EntityPlayer advances it, so getCoolPeriod (the mob's missing ATTACK_SPEED) is never reached.
    inOrder(section(jp, 'Better Hurt Timer HurtCapability$Handler'), 'instanceof', 'EntityLivingBase', 'ticksSinceLastSwingField', 'iconst_m1', 'Field.setInt');
    inOrder(section(jp, 'Better Hurt Timer BHTAPI'), 'String ticksSinceLastSwing', 'String field_184617_aD', 'ObfuscationReflectionHelper.findField', 'ticksSinceLastSwingField');
    inOrder(section(jp, 'Better Hurt Timer Events.canSwing'), 'ticksSinceLastSwingField', 'getInt', 'iflt');
    assert.match(section(jp, 'SRG names'), /FD: vp\/aE net\/minecraft\/entity\/EntityLivingBase\/field_184617_aD/);
    // Every access of aE (ticksSinceLastSwing) and bc (lastDamage) in the patched vp and aed: vp never touches aE, only
    // aed's onUpdate and resetCooldown write it; lastDamage is read and written only in vp's attackEntityFrom.
    const acc = section(jp, 'vp and aed (Forge-patched): every access of aE and bc');
    const listed = (cls, fld) => {
        const m = acc.match(new RegExp(`^# ${cls}: every access of ${fld} \\(.*\\): (\\d+)$`, 'm'));
        assert.ok(m, `${cls} ${fld}`);
        const rows = acc.slice(m.index).split('\n').slice(1).filter((l) => !l.startsWith('#')).slice(0, +m[1]);
        rows.forEach((r) => assert.match(r, new RegExp(`Field ${fld}:`)));
        return rows.map((r) => `${r.split(' :: ')[0].replace(/^\S+ \S+ /, '')} ${r.split(' :: ')[1].split(/\s+/)[1]}`);
    };
    assert.deepEqual(listed('vp', 'aE'), []);
    assert.deepEqual(listed('aed', 'aE'), ['B_(); getfield', 'B_(); putfield', 'n(float); getfield', 'ds(); putfield']);
    assert.deepEqual(listed('vp', 'bc'), ['a(ur, float); getfield', 'a(ur, float); getfield', 'a(ur, float); putfield', 'a(ur, float); putfield']);
    assert.deepEqual(listed('aed', 'bc'), []);
    assert.match(section(jp, 'SRG names'), /FD: vp\/bc net\/minecraft\/entity\/EntityLivingBase\/field_110153_bc/);
    inOrder(section(jp, 'aed onUpdate B_()'), 'Field aE:I', 'iadd', 'putfield');
    assert.ok(!C.notSettled.some((x) => /NullPointerException|getCoolPeriod/.test(x)));
    assert.match(C.mobsHittingPlayer.summary, /An armed mob takes the same path/);
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
    // Better Combat's packet: [damage, speed, ticks, crit chance].
    const bc = (k) => [W(k).bcAttackDamage, W(k).bcAttackSpeed, W(k).bcCooldownTicks, W(k).bcCritChance];
    assert.deepEqual(['minecraft:stone_axe', 'pyrotech:crude_axe', 'minecraft:stone_sword', 'minecraft:wooden_sword', 'hand'].map(bc),
        [[3, 0.4, 50, 0.25], [3, 0.9, 22, 0.25], [3.5, 1.5, 13, 0.1], [4, 1.8, 11, 0.1], [0.5, 1.5, 13, 0.05]]);
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

test('Better Combat\'s packet: 0.5 off an empty hand, random and sneak-attack crits, its client\'s pacing', () => {
    const p = C.playerAttack.betterCombatPacket;
    // The unarmed & non-weapon reduction: a flat subtraction unless the item is in the weapon class whitelist.
    const u = section(jp, 'Better Combat Helpers.playerAttackVictimWithWeapon: weapon check');
    inOrder(u, 'getMainhandAttackDamage', 'dstore        22', 'isConfigWeapon', 'ifeq          530', '530: dload         22', 'fistAndNonWeaponDamageReduction', 'dsub', 'dstore        22');
    inOrder(section(jp, 'Better Combat ConfigurationHandler.isConfigWeapon'), 'isItemClassWhiteList', 'isBlacklisted', 'itemClassWhiteArray', 'Class.isInstance');
    const keys = section(jp, 'Better Combat ConfigurationHandler: config keys read');
    inOrder(keys, '# fistAndNonWeaponDamageReduction', 'String Unarmed & Non-Weapon Damage Reduction', 'putstatic', 'fistAndNonWeaponDamageReduction');
    inOrder(keys, '# fistAndNonWeaponAttackSpeed', 'String Unarmed\n', 'String Unarmed & Non-Weapon Attack Speed', 'fistAndNonWeaponAttackSpeed');
    inOrder(keys, '# itemClassWhitelist', 'String White/Black Lists', 'String (Class) Item Weapon Whitelist', 'itemClassWhitelist');
    inOrder(keys, '# swordList', 'String Swords', 'String Sword Tweaker', 'swordList');
    inOrder(keys, '# autoCritOnSneakAttacks', 'String Critical Strikes', 'String Auto Critical On Sneak Attacks', 'autoCritOnSneakAttacks');
    assert.match(cfg('config/bettercombat.cfg', /"Unarmed & Non-Weapon Damage Reduction"=/), /:732: .*=0\.5$/);
    assert.match(cfg('config/bettercombat.cfg', /"Unarmed & Non-Weapon Attack Speed"=/), /:729: .*=1\.5$/);
    assert.match(cfg('config/bettercombat.cfg', /^config\/bettercombat\.cfg:727: unarmed \{/), /unarmed/);
    for (const [n, cls] of [[840, 'ItemSword'], [841, 'ItemTool'], [842, 'ItemHoe']]) assert.match(cfg('config/bettercombat.cfg', new RegExp(`:${n}:`)), new RegExp(`net\\.minecraft\\.item\\.${cls}$`));
    assert.match(cfg('config/bettercombat.cfg', /:839:/), /\(Class\) Item Weapon Whitelist/);
    assert.equal(p.unarmedDamageReduction, 0.5);
    assert.equal(C.weapons.hand.bcWeapon, false);
    // Crits: chance = the attribute + (the matched weapon's [Crit Chance] - its base); x CRIT_DAMAGE; sneak attacks always crit.
    const cr = section(jp, 'Better Combat Helpers.playerAttackVictimWithWeapon: crits');
    inOrder(cr, 'autoCritOnSneakAttacks', 'IMob', 'EntityLiving', 'func_70638_az', 'if_acmpeq', 'func_70643_av', 'if_acmpeq', 'iconst_1', 'istore        5');
    inOrder(cr, 'baseCritPercentChance', 'jumpCrits', 'luckCritModifier', 'nextFloat', 'dcmpl', 'istore        5', 'iload         5', 'ForgeHooks.getCriticalHit', 'dload         22', 'dload         12', 'dmul', 'dstore        22', 'playerAttackedVictim');
    inOrder(section(jp, 'Better Combat Helpers.playerAttackVictimWithWeapon: calls and field reads'), 'critChanceMod', 'func_111125_b', 'additionalCritDamageMod');
    inOrder(section(jp, 'Better Combat EventHandlers static init'), 'String bettercombat.critChance', 'baseCritPercentChance', 'CRIT_CHANCE', 'String bettercombat.critDamage', 'baseCritPercentDamage', 'CRIT_DAMAGE');
    assert.match(cfg('config/bettercombat.cfg', /"Base Critical Percent Chance"=/), /=0\.05$/);
    assert.match(cfg('config/bettercombat.cfg', /"Base Critical Percent Damage"=/), /=1\.5$/);
    assert.match(cfg('config/bettercombat.cfg', /"Auto Critical On Sneak Attacks"=/), /=true$/);
    assert.match(cfg('config/bettercombat.cfg', /Weapon Substring=_sword\]/), /:343: .*\[Crit Chance=0\.1\]\s+\[Additional Crit Damage=0\.0\]/);
    assert.match(cfg('config/bettercombat.cfg', /Weapon Substring=_axe\]/), /:350: .*\[Crit Chance=0\.25\]\s+\[Additional Crit Damage=0\.0\]/);
    assert.equal(p.crit.multiplier, 1.5);
    // Client pacing: (int)(20 / speed + 0.5), at least 8; a non-weapon uses 1.5; the Sword Tweaker shifts vanilla swords.
    const pace = section(jp, 'Better Combat EventHandlersClient.getMainhandCooldown');
    inOrder(pace, 'hasConfigWeapon', 'field_188790_f', 'func_111125_b', 'fistAndNonWeaponAttackSpeed', 'func_111122_c', 'ItemSword', 'swords', 'String.contains', 'attackSpeed', 'dadd', 'calculateAttackSpeedTicks');
    inOrder(method(pace, 'calculateAttackSpeedTicks('), 'double 20.0d', 'calculateAttribute', 'double 0.1d', 'double 20.0d', 'ddiv', 'addedSwingTickCooldown', 'dadd', 'd2i');
    inOrder(section(jp, 'Better Combat BetterCombatHand.setAttackCooldown'), 'minimumAttackSpeedTicks', 'if_icmpge', 'minimumAttackSpeedTicks', 'putfield');
    assert.match(cfg('config/bettercombat.cfg', /Sword Substring=stone_sword/), /:688: .*\[Additional Attack Speed=-0\.1\]/);
    assert.match(cfg('config/bettercombat.cfg', /Sword Substring=wooden_sword/), /:689: .*\[Additional Attack Speed=0\.2\]/);
    assert.match(cfg('config/bettercombat.cfg', /Added Attack Speed Tick Cooldown"=/), /=0\.5$/);
    assert.deepEqual([p.clientPacing.minimumTicks, p.clientPacing.addedTicks, p.clientPacing.unarmedAttackSpeed], [8, 0.5, 1.5]);
    assert.ok(!C.notSettled.some((x) => /pacing/.test(x)));
    // A crit, and lastDamage still does not matter on this path.
    assert.equal(pack.meleeHitDamage({ weapon: 'minecraft:stone_sword', crit: true }), 3.5 * 1.5 * 0.8);
    assert.equal(pack.meleeHitDamage({ weapon: 'hand' }), 0.5 * 0.8);
    assert.equal(pack.meleeHitDamage({ weapon: 'hand', path: 'vanilla' }), 1 * 0.8, 'the vanilla packet has no unarmed reduction');
});

test('the soak 7 fight: a zombie with a chainmail helmet', () => {
    const fight = (weapon, path, armorItems = ['minecraft:chainmail_helmet']) => hitsToKillFromIndex({ mob: 'minecraft:zombie', weapon, path, armorItems });
    // Better Combat's packet: every hit counts.
    assert.deepEqual([fight('minecraft:stone_axe').hits, fight('pyrotech:crude_axe').hits, fight('minecraft:stone_sword').hits, fight('hand').hits], [10, 10, 8, 59]);
    // Without the helmet (the net-forge test-server run): stone sword 8, stone axe 9, bare hand 54 (0.5 - not 1 - a punch).
    assert.deepEqual(['minecraft:stone_sword', 'minecraft:stone_axe', 'hand'].map((w) => fight(w, 'bettercombat', []).hits), [8, 9, 54]);
    // Random crits only lower the count: every hit a crit is the fewest; a sneak attack crits the first hit.
    assert.deepEqual(['minecraft:stone_sword', 'minecraft:stone_axe', 'hand'].map((w) => fight(w, 'bettercombat', []).minHits), [5, 6, 36]);
    // (stone sword 4.13 then 2.73s: 7; the hand's 0.56 crit saves none of its 54.)
    assert.equal(hitsToKillFromIndex({ mob: 'minecraft:zombie', weapon: 'minecraft:stone_sword', sneakAttack: true }).hits, 7);
    assert.equal(hitsToKillFromIndex({ mob: 'minecraft:zombie', weapon: 'hand', sneakAttack: true }).hits, 54);
    // Ticks at Better Combat's pacing: the stone sword 13 a hit, the hand 13, the stone axe 50.
    assert.deepEqual([fight('minecraft:stone_sword').ticks, fight('hand', 'bettercombat', []).ticks, fight('minecraft:stone_axe', 'bettercombat', []).ticks], [7 * 13, 53 * 13, 8 * 50]);
    assert.equal(fight('minecraft:stone_sword', 'vanilla').cooldownTicks, 12.5);
    assert.equal(fight('minecraft:stone_axe').armor, 4);
    // Without the helmet the axe needs one hit fewer; full chainmail (armour 14) about doubles every count.
    assert.equal(fight('minecraft:stone_axe', 'bettercombat', []).hits, 9);
    assert.equal(fight('minecraft:stone_axe', 'bettercombat', ['minecraft:chainmail_helmet', 'minecraft:chainmail_chestplate', 'minecraft:chainmail_leggings', 'minecraft:chainmail_boots']).hits, 18);
    // The vanilla packet: the first hit (2.4 after x0.8) is all the zombie ever takes.
    for (const w of ['minecraft:stone_axe', 'minecraft:stone_sword', 'hand']) assert.equal(fight(w, 'vanilla').hits, Infinity, w);
    // The stone sword is the better weapon here: more damage per tick of cooldown than either axe.
    const per = (w) => pack.meleeHitDamage({ weapon: w }) / pack.weaponStats(w).bcCooldownTicks;
    assert.ok(per('minecraft:stone_sword') > per('pyrotech:crude_axe') && per('pyrotech:crude_axe') > per('minecraft:stone_axe') && per('minecraft:stone_axe') > per('hand'));
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

test('durability: an item breaks only when its damage goes above its durability, so the crude axe breaks on its 5th hit (#550 review)', () => {
    // ItemStack.attemptDamageItem: damage += amount, then return damage > max damage (if_icmple skips the true).
    const attempt = section(jp, 'aip (ItemStack, Forge-patched) attemptDamageItem');
    inOrder(attempt, 'Method i:()I', 'iload_1', 'iadd', 'Method b:(I)V', 'Method i:()I', 'Method k:()I', 'if_icmple', 'iconst_1', 'iconst_0', 'ireturn');
    // damageItem shrinks the stack (g(1)) only when attemptDamageItem returned true.
    inOrder(section(jp, 'aip (ItemStack, Forge-patched) damageItem'), 'Method a:(ILjava/util/Random;Loq;)Z', 'ifeq', 'Method g:(I)V');
    const getSet = section(jp, 'aip (ItemStack, Forge-patched) hitEntity');
    inOrder(getSet, 'public void a(vp, aed);', 'Method ain.a:(Laip;Lvp;Lvp;)Z', 'public int i();', 'ain.getDamage', 'public int k();', 'ain.getMaxDamage', 'public void b(int);', 'ain.setDamage');
    // Item.setDamage only clamps below 0; Item.getMaxDamage(stack) is the item's own max damage (Material Changer sets 8).
    const item = section(jp, 'ain (Item, Forge-patched)');
    inOrder(item, 'public int getMaxDamage(aip);', 'Method l:()I', 'public void setDamage(aip, int);', 'putfield', 'ifge', 'iconst_0', 'putfield');
    assert.doesNotMatch(item, /if_icm/);
    // ItemTool.hitEntity costs 2; nothing between it and the crude axe overrides the durability path.
    inOrder(section(jp, 'ahq (ItemTool) hitEntity'), 'iconst_2', 'Method aip.a:(ILvp;)V');
    assert.deepEqual(section(jp, 'agy (ItemAxe), ItemAxeBase, ItemCrudeAxe').trim().split('\n').slice(1).map((l) => l.split(': ')[1]), ['0', '0', '0']);
    assert.match(section(jp, 'SRG names for the durability excerpts'), /MD: aip\/a \(ILjava\/util\/Random;Loq;\)Z net\/minecraft\/item\/ItemStack\/func_96631_a /);
    assert.match(section(jp, 'SRG names for the durability excerpts'), /MD: ahq\/a \(Laip;Lvp;Lvp;\)Z net\/minecraft\/item\/ItemTool\/func_77644_a /);
    // Vanilla calls hitEntity only after attackEntityFrom returned true; Better Combat after every attack on a living entity.
    inOrder(section(jp, 'aed (EntityPlayer, Forge-patched) attackTargetEntityWithCurrentItem f(vg): hitEntity only'), 'Method vg.a:(Lur;F)Z', 'istore        22', 'iload         22', 'ifeq          1256', 'Method aip.a:(Lvp;Laed;)V');
    const bcHit = section(jp, 'Better Combat Helpers.playerAttackVictim: hitEntity');
    inOrder(bcHit, 'playerAttackVictimWithWeapon', 'istore        5', 'instanceof', 'EntityLivingBase', 'ItemStack.func_77961_a');
    assert.doesNotMatch(bcHit, /iload +5\n/);
    assert.deepEqual(section(jp, 'Every Better Combat class that calls setItemDamage').trim().split('\n').slice(1),
        ['bettercombat.mod.server.EventHandlers: setItemDamage 0, damageItem 1, attemptDamageItem 0, hitEntity 0',
            'bettercombat.mod.util.Helpers: setItemDamage 1, damageItem 0, attemptDamageItem 0, hitEntity 2']);
    inOrder(section(jp, 'Better Combat Helpers.playerAttackVictimWithWeapon: its one setItemDamage'), 'String wards:effect_unbreaking', 'bipush        8', '8: 1444', '1444:', 'func_77952_i', 'iconst_1', 'isub', 'func_77964_b');
    // The crude axe: 8 durability, 2 a hit. Hits until the damage first goes above 8.
    const axe = pack.weaponStats('pyrotech:crude_axe');
    assert.deepEqual([axe.durability, axe.durabilityPerHit], [8, 2]);
    let damage = 0, hits = 0;
    while (!(damage > axe.durability)) { damage += axe.durabilityPerHit; hits++; }
    assert.equal(hits, 5);
    assert.equal(Math.floor(axe.durability / axe.durabilityPerHit) + 1, hits);
    assert.match(axe.note, /the 5th hit breaks it \(damage 10 > 8\)/);
    assert.doesNotMatch(axe.note, /after 4 hits/);
});
