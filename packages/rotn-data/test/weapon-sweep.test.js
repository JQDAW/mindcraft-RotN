// Weapon sweeps (lead task for skills-rotn's herd rule, soak 15 / soak 16 plan F5): weapon-sweep.json and
// src/sweep.js against config/bettercombat.cfg and the javap excerpts in fixtures/weapon-sweep-3.3.4/ (Better Combat
// 1.5.6 = ImmersiveCombat-12-13-25.jar and the vanilla server jar of the pinned pack zip; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { sweepRadius } from '../src/sweep.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/weapon-sweep-3.3.4');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');
const pack = loadRotnData('3.3.4');
const data = pack.weaponSweepData;
const javap = read('weapon-sweep.javap.txt');
const section = (title) => {
    const i = javap.indexOf(`\n## ${title}`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return javap.slice(i + 1).split(/\n## /)[0];
};
/** The bytecode lines of a section as [offset, text]. */
const code = (text) => [...text.matchAll(/^\s+(\d+): (.*)$/gm)].map((m) => [Number(m[1]), m[2].trim()]);
/** The text at one offset of a section. */
const at = (text, offset) => code(text).find(([o]) => o === offset)?.[1] ?? null;

/** The config excerpt's lines as { line: text }. */
const cfg = Object.fromEntries(read('bettercombat.cfg.excerpt.txt').split('\n').filter((l) => /^\d+\t/.test(l)).map((l) => {
    const [n, ...rest] = l.split('\t');
    return [Number(n), rest.join('\t')];
}));

test('the tweaker entries are config/bettercombat.cfg\'s Custom Weapon Tweaker, in order, with each Sweep', () => {
    assert.match(cfg[315], /S:"Custom Weapon Tweaker" </);
    assert.match(cfg[353], /^\s*>\s*$/);
    const want = [];
    for (let n = 316; n < 353; n++) {
        const m = cfg[n].match(/\[Weapon Substring=([^\]]+)\].*\[Sweep=(\d+)\]/);
        assert.ok(m, `line ${n}`);
        want.push({ line: n, substring: m[1], sweep: Number(m[2]) });
    }
    assert.deepEqual(data.betterCombat.entries, want);
    assert.equal(want.length, 37);
    const sweeping = want.filter((e) => e.sweep > 0).map((e) => `${e.substring}=${e.sweep}`);
    assert.deepEqual(sweeping, ['celeste=2', 'gladiolus=1', 'dawn_star=1', 'wither_bane=1', 'blade=1', 'aethers_guard=1', '_infinity=1',
        'glaive_=2', 'staff=2', 'greatsword_=3', 'longsword_=1', 'saber_=1', '_sword=1', '_cutlass=1', '_scythe=2', 'nyx:scythe=2']);
    // The class whitelist that decides which items are Better Combat weapons at all.
    assert.deepEqual([867, 868, 869, 870].map((n) => cfg[n].trim()),
        ['net.minecraft.item.ItemSword', 'net.minecraft.item.ItemTool', 'net.minecraft.item.ItemHoe', 'com.oblivioussp.spartanweaponry.item.ItemThrowingWeapon']);
});

test('Better Combat takes the first entry whose substring is in the registry path, only for a config weapon; else Sweep 0', () => {
    const m = section('Better Combat Helpers.playerAttackVictimWithWeapon (tweaker match');
    assert.match(at(m, 282), /isConfigWeapon/);
    assert.match(at(m, 285), /^ifeq\s+530$/, 'a non-weapon skips the tweaker');
    assert.match(at(m, 293), /getRegistryNameFromItem/);
    assert.match(at(m, 308), /ConfigurationHandler\.weapons:Ljava\/util\/ArrayList/);
    assert.match(at(m, 345), /String\.contains/);
    assert.match(at(m, 358), /ConfigWeapon\.sweepMod:I/);
    assert.match(at(m, 362), /^istore\s+9$/);
    assert.match(at(m, 435), /^goto\s+441$/, 'the first match ends the search');
    assert.match(at(m, 451), /ConfigWeapon\.sweepMod:I/);
    assert.match(at(m, 448), /DEFAULT_CUSTOM_WEAPON/);
    const reg = section('Better Combat Helpers.getRegistryNameFromItem');
    assert.match(reg, /getRegistryName[\s\S]*ResourceLocation\.func_110623_a/, 'the path, without the mod id');
    const def = section('Better Combat ConfigurationHandler.setDefaultConfigWeaponVariables');
    assert.match(def, /iconst_0\s*\n[^\n]*putfield[^\n]*ConfigWeapon\.sweepMod:I/, 'the default weapon has Sweep 0');
    assert.match(def, /isItemClassWhiteList[\s\S]*isBlacklisted/);
});

test('the sweep level adds the wards:effect_sweeping potion (amplifier + 1) and the Sweeping enchantment', () => {
    const p = section('Better Combat Helpers.playerAttackVictimWithWeapon (the wards:effect_sweeping potion');
    assert.match(at(p, 1190), /String wards:effect_sweeping/);
    assert.match(at(p, 1199), /^bipush\s+7$/);
    assert.match(p, /^\s+7: 1429$/m, 'case 7 of the switch');
    assert.match(p, /1429: iload\s+9\s*\n\s+1431: iconst_1\s*\n[^\n]*\n[^\n]*func_76458_c[\s\S]*1439: istore\s+9/);
    const s = section('Better Combat Helpers.playerAttackVictimWithWeapon (Sweeping enchantment and the sweep');
    assert.match(at(s, 2153), /Enchantments\.field_191530_r/);
    assert.match(s, /2164: iload\s+9\s*\n\s+2166: iload\s+40\s*\n\s+2168: iadd\s*\n\s+2169: istore\s+9/);
});

test('the sweep runs only after the main hit landed, with radius 1 + width + 0.25 x (level - 1) around the struck mob', () => {
    const g = section('Better Combat Helpers.playerAttackVictimWithWeapon (main hit gate');
    assert.match(at(g, 1880), /playerAttackedVictim/);
    assert.match(at(g, 1883), /^ifeq\s+3392$/, 'a missed main hit jumps past the sweep (2177-2633)');
    const s = section('Better Combat Helpers.playerAttackVictimWithWeapon (Sweeping enchantment and the sweep');
    assert.match(s, /2177: iload\s+9\s*\n\s+2179: iinc\s+9, -1\s*\n\s+2182: ifle\s+2633/, 'level >= 1, then level - 1');
    assert.match(s, /2188: dconst_1\s*\n[^\n]*\n[^\n]*field_70130_N[^\n]*\n[^\n]*f2d\s*\n[^\n]*dadd\s*\n[^\n]*iload\s+9\s*\n[^\n]*i2d\s*\n[^\n]*double 0\.25d\s*\n[^\n]*dmul\s*\n[^\n]*dadd\s*\n\s+2203: dstore\s+38/);
    assert.match(s, /2242: dload\s+38\s*\n[^\n]*field_180189_a[^\n]*\n[^\n]*f2d\s*\n[^\n]*dmul\s*\n[^\n]*dconst_1\s*\n[^\n]*dload\s+38\s*\n[^\n]*field_180189_a[\s\S]*?func_72314_b/,
        'box: r x SQRT_2 sideways, 1 up and down');
    assert.match(s, /2350: [^\n]*func_70068_e[^\n]*\n\s+2353: dload\s+38\s*\n\s+2355: dload\s+38\s*\n\s+2357: dmul\s*\n\s+2358: dcmpg\s*\n\s+2359: ifgt/, 'within r of the struck mob');
    assert.match(s, /2320: [^\n]*func_70068_e[\s\S]*?2343: ifgt/, 'within reach + width of the attacker');
    assert.match(section('Vanilla MathHelper static init'), /fconst_2\s*\n[^\n]*Method c:\(F\)F\s*\n[^\n]*putstatic[^\n]*Field a:F/, 'rk.a = sqrt(2)');
    assert.equal(data.betterCombat.attackerWidth, 0.6);
    for (const [level, r] of Object.entries(data.betterCombat.radiusByLevel)) assert.equal(r, sweepRadius(Number(level)), level);
    assert.deepEqual([1, 2, 3].map((l) => sweepRadius(l)), [1.6, 1.85, 2.1]);
    assert.equal(sweepRadius(0), 0);
});

test('the vanilla fallback sweeps with an ItemSword: box grown (1, 0.25, 1), within 3 blocks of the player', () => {
    const v = section('Vanilla EntityPlayer.attackTargetEntityWithCurrentItem');
    assert.match(v, /instanceof\s+#\d+\s+\/\/ class ajy/, 'ajy = ItemSword');
    assert.match(v, /601: dconst_1\s*\n\s+602: ldc2_w[^\n]*double 0\.25d\s*\n\s+605: dconst_1\s*\n\s+606: [^\n]*bhb\.c:\(DDD\)/);
    assert.match(v, /double 9\.0d/);
    assert.deepEqual(data.vanillaFallback.boxGrow, { x: 1, y: 0.25, z: 1 });
    assert.equal(data.vanillaFallback.maxPlayerDistance, 3);
});

test('weaponSweep: the bot\'s weapons, the hand, enchantments and the vanilla path', () => {
    const s = (item, opts) => pack.weaponSweep(item, opts);
    assert.deepEqual(s('minecraft:iron_sword'), { item: 'minecraft:iron_sword', path: 'bettercombat', weapon: true,
        entry: { line: 343, substring: '_sword', sweep: 1 }, level: 1, sweeps: true, radius: 1.6, alsoWithinReach: true });
    assert.equal(s('iron_sword').item, 'minecraft:iron_sword', 'a bare vanilla path');
    assert.equal(s({ name: 'stone_sword' }).radius, 1.6, 'a held stack');
    for (const item of ['spartanweaponry:club_wood', 'pyrotech:crude_axe', 'minecraft:stone_pickaxe', 'minecraft:stone_axe', 'minecraft:iron_shovel']) {
        const r = s(item);
        assert.equal(r.weapon, true, item);
        assert.equal(r.sweeps, false, item);
        assert.equal(r.radius, 0, item);
    }
    assert.equal(s('spartanweaponry:club_wood').entry.substring, 'club_');
    assert.equal(s('spartanweaponry:greatsword_iron').radius, 2.1);
    assert.equal(s('spartanweaponry:longsword_iron').entry.substring, 'longsword_', 'longsword_ comes before _sword');
    for (const hand of ['hand', null, '', 'air']) assert.equal(s(hand).sweeps, false, String(hand));
    // The Sweeping enchantment and the potion add levels even to a Sweep 0 weapon.
    assert.equal(s('spartanweaponry:club_wood', { enchantment: 2 }).radius, 1.85);
    assert.equal(s('hand', { potion: 1 }).radius, 1.6);
    // The vanilla fallback: any ItemSword subclass (a Spartan club too), never an axe or pickaxe.
    assert.equal(s('spartanweaponry:club_wood', { path: 'vanilla' }).sweeps, true);
    assert.equal(s('minecraft:iron_sword', { path: 'vanilla' }).sweeps, true);
    assert.equal(s('minecraft:stone_pickaxe', { path: 'vanilla' }).sweeps, false);
    assert.throws(() => s('minecraft:iron_sword', { path: 'nope' }), /unknown attack path/);
});

test('#621 review 2: an item weapons.json does not list is unknown (null), never "does not sweep"; the hand is known', () => {
    const s = (item, opts) => pack.weaponSweep(item, opts);
    for (const item of ['minecraft:stick', 'minecraft:dirt', 'betterwithmods:dirt_pile', 'somemod:unknown_blade']) {
        assert.equal(pack.weaponsData.items[item], undefined, item);
        assert.deepEqual(s(item), { item, path: 'bettercombat', weapon: null, entry: null, level: null, sweeps: null, radius: null, alsoWithinReach: true }, item);
        const v = s(item, { path: 'vanilla' });
        assert.equal(v.weapon, null, `${item} vanilla`);
        assert.equal(v.sweeps, null, `${item} vanilla`);
    }
    // Unknown even with a Sweeping enchantment or the potion: the base level is not known.
    assert.equal(s('minecraft:stick', { enchantment: 2 }).sweeps, null);
    const hand = s('hand');
    assert.equal(hand.weapon, false);
    assert.equal(hand.sweeps, false);
    assert.equal(hand.radius, 0);
    assert.equal(s('hand', { path: 'vanilla' }).weapon, false);
    assert.equal(s('hand', { path: 'vanilla' }).sweeps, false);
    assert.match(data.unknownItems, /never 'does not sweep'/);
});

test('#621 review 3: on the vanilla path weapon means what it means on the Better Combat path (bcWeapon)', () => {
    for (const [name, w] of Object.entries(pack.weaponsData.items)) {
        const bc = pack.weaponSweep(name);
        const v = pack.weaponSweep(name, { path: 'vanilla' });
        assert.equal(v.weapon, bc.weapon, name);
        assert.equal(v.weapon, !!w.bcWeapon, name);
        assert.equal(v.sweeps, w.base === 'ItemSword', name);
    }
    // A pickaxe is a Better Combat weapon on both paths, but only an ItemSword sweeps on the vanilla one.
    const pick = pack.weaponSweep('minecraft:stone_pickaxe', { path: 'vanilla' });
    assert.equal(pick.weapon, true);
    assert.equal(pick.sweeps, false);
    assert.equal(data.sources.config.classWhitelistLines, '867-870');
});

test('every Better Combat weapon in weapons.json gets the same first match; 261 of them sweep; mod-id entries never match', () => {
    const items = pack.weaponsData.items;
    let sweeping = 0;
    for (const [name, w] of Object.entries(items)) {
        const r = pack.weaponSweep(name);
        assert.equal(r.weapon, !!w.bcWeapon, name);
        if (!w.bcWeapon) continue;
        assert.equal(r.entry?.line ?? null, w.bcTweakerLine ?? null, name);
        if (r.sweeps) sweeping++;
    }
    assert.equal(sweeping, 261);
    const dead = data.betterCombat.entries.filter((e) => e.substring.includes(':'));
    assert.deepEqual(dead.map((e) => e.substring), ['nyx:scythe', 'spartanweaponry:pike_invar']);
    for (const name of Object.keys(items)) for (const e of dead) assert.ok(!name.split(':')[1].includes(e.substring), `${name} ${e.substring}`);
});
