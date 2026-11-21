// Weapon coverage (#530 review, lead task 2026-11-21): 3.3.4/weapons.json lists every sword, axe, pickaxe, shovel, hoe
// and other melee tool or weapon on the pack. These tests recompute its numbers independently from the javap excerpts
// and config lines in fixtures/weapons-3.3.4/ (vanilla, Pyrotech and Spartan Weaponry from bytecode; Material Changer;
// Better Combat's weapon whitelist, crit table and Sword Tweaker), with Java's float arithmetic (Math.fround).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { weaponStats, meleeHitDamage, hitsToKill } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (d, f) => fs.readFileSync(path.join(HERE, 'fixtures', d, f), 'utf8').replace(/\r\n/g, '\n');
const jp = read('weapons-3.3.4', 'weapons.javap.txt');
const configs = read('weapons-3.3.4', 'configs.txt');
const combatJp = read('combat-3.3.4', 'combat.javap.txt');
const pack = loadRotnData('3.3.4');
const W = pack.weaponsData;
const items = W.items;
const f = Math.fround;

const section = (text, title) => {
    const i = text.indexOf(`\n## ${title}`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return text.slice(i + 1).split(/\n## /)[0];
};
const cfgLines = (file) => configs.split('\n').filter((l) => l.startsWith(`config/${file}:`)).map((l) => {
    const m = l.match(/^config\/[^:]+:(\d+): (.*)$/);
    return { n: +m[1], text: m[2] };
});
// The constants a javap excerpt pushes, in order (ints and floats).
const pushes = (text) => [...text.matchAll(/(iconst_(m1|\d)|fconst_(\d)|bipush\s+(-?\d+)|sipush\s+(-?\d+)|\/\/ float (-?[\d.]+)f|\/\/ int (-?\d+))/g)]
    .map((m) => (m[2] !== undefined ? (m[2] === 'm1' ? -1 : +m[2]) : m[3] !== undefined ? +m[3] : +(m[4] ?? m[5] ?? m[6] ?? m[7])));
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-5, `${what}: ${a} vs ${b}`);

// Material Changer: the last ATTACK_DAMAGE / ATTACK_SPEED entry in the changer list wins (toList keeps config order).
const MC = {};
for (const { n, text } of cfgLines('materialchanger.cfg')) {
    const m = text.match(/^\s+(ATTACK_DAMAGE|ATTACK_SPEED);([^;]+);([-\d.]+)$/);
    if (m && n >= 82 && n <= 2145) (MC[m[2]] ??= {})[m[1] === 'ATTACK_DAMAGE' ? 'damage' : 'speed'] = +m[3];
}
// Totals from the constructor fields, then Material Changer (field = value - 1, speed field = value - 4).
const totals = (name, dmgField, spdField, { tool = true } = {}) => {
    const mc = MC[name] ?? {};
    const d = mc.damage !== undefined ? f(f(mc.damage) - 1) : dmgField;
    const s = mc.speed !== undefined && tool ? f(f(mc.speed) - 4) : spdField;
    return [1 + d, 4 + s];
};
const check = (name, [d, s]) => {
    const e = items[name];
    assert.ok(e, name);
    close(e.attackDamage, d, `${name} attackDamage`);
    close(e.attackSpeed, s, `${name} attackSpeed`);
    assert.equal(e.cooldownTicks, Math.round(20 / s * 10) / 10, `${name} cooldownTicks`);
};

test('weapons.json: well formed; every item is in the dump with the dumped class; every _sword/_axe/_pickaxe/_shovel/_hoe is listed', () => {
    assert.equal(W.format, 'rotn-weapons/1');
    const dump = pack.dump.items.items;
    assert.equal(Object.keys(items).length, 1150);
    for (const [k, e] of Object.entries(items)) {
        assert.ok(dump[k], k);
        assert.equal(e.class, dump[k].class, k);
        for (const x of ['attackDamage', 'attackSpeed', 'bcAttackDamage', 'bcAttackSpeed']) assert.ok(e[x] === null || Number.isFinite(e[x]), `${k} ${x}`);
    }
    const missing = Object.keys(dump).filter((k) => /_(sword|axe|pickaxe|shovel|hoe)$/.test(k) && !items[k]);
    assert.deepEqual(missing, []);
    for (const re of [/scratchpad/i, /\/home\//, /\/tmp\//]) assert.doesNotMatch(JSON.stringify(W), re);
    assert.match(W.qualityTools, /only baubles/);
    assert.deepEqual(cfgLines('qualitytools/Quailities (every file)').length, 0);
    assert.deepEqual(configs.split('\n').filter((l) => l.startsWith('config/qualitytools/Quailities/')), ['config/qualitytools/Quailities/baubles.json']);
});

test('vanilla tools: Item$ToolMaterial, the five tool classes (Forge-patched where Forge patches them) and Material Changer', () => {
    // Material damage: the 5th constant of each enum entry (name, ordinal, harvest, uses, efficiency, damage, enchantability).
    const tm = section(jp, 'ain$a (Item$ToolMaterial) static init');
    const mat = {};
    for (const [name, key] of [['WOOD', 'wooden'], ['STONE', 'stone'], ['IRON', 'iron'], ['DIAMOND', 'diamond'], ['GOLD', 'golden']]) {
        const part = tm.slice(tm.indexOf(`String ${name}\n`)).split('putstatic')[0];
        mat[key] = pushes(part)[4]; // ordinal, harvest, uses, efficiency, damage, enchantability
    }
    assert.deepEqual(mat, { wooden: 0, stone: 1, iron: 2, diamond: 3, golden: 0 });
    // ItemAxe(material): the f (damage) and n (speed) arrays by ordinal.
    const axe = section(combatJp, 'agy (ItemAxe) static init');
    const fl = [...axe.matchAll(/\/\/ float (-?[\d.]+)f/g)].map((m) => +m[1]);
    const ord = ['wooden', 'stone', 'iron', 'diamond', 'golden'];
    const AXE = Object.fromEntries(ord.map((t, i) => [t, [fl[i], fl[5 + i]]]));
    assert.deepEqual(AXE.stone, [8, -3.2]);
    // The constructors.
    assert.match(section(jp, 'ajb (ItemPickaxe) <init>'), /fconst_1\n.*float -2\.8f[\s\S]*ahq\."<init>":\(FFLain\$a;Ljava\/util\/Set;\)V/);
    assert.match(section(jp, 'ajn (ItemSpade) <init>'), /float 1\.5f\n.*float -3\.0f[\s\S]*ahq\."<init>"/);
    assert.match(section(jp, 'ajy (ItemSword, Forge-patched) <init>'), /float 3\.0f[\s\S]*Method ain\$a\.c:\(\)F\n.*fadd\n.*putfield .*Field a:F/);
    const hoe = section(jp, 'aim (ItemHoe, Forge-patched)');
    assert.match(hoe, /Method ain\$a\.c:\(\)F\n.*fconst_1\n.*fadd\n.*putfield .*Field b:F/);
    assert.match(hoe, /String Weapon modifier\n.*dconst_0[\s\S]*String Weapon modifier\n.*aload_0\n.*getfield .*Field b:F\n.*float 4\.0f\n.*fsub/);
    const tool = section(jp, 'ahq (ItemTool, Forge-patched) constructors');
    assert.match(tool, /fload_1\n.*aload_3\n.*Method ain\$a\.c:\(\)F\n.*fadd\n.*putfield .*Field b:F\n.*aload_0\n.*fload_2\n.*putfield .*Field c:F/);
    assert.match(tool, /protected ahq\(ain\$a, java\.util\.Set<aow>\);\n.*\n.*aload_0\n.*fconst_0\n.*fconst_0/);
    assert.match(section(jp, 'agy (ItemAxe, Forge-patched) constructors'), /protected agy\(ain\$a, float, float\);[\s\S]*fload_2\n.*putfield .*Field b:F\n.*aload_0\n.*fload_3\n.*putfield .*Field c:F/);
    for (const t of ord) {
        const m = mat[t];
        check(`minecraft:${t}_sword`, totals(`minecraft:${t}_sword`, f(3 + m), f(-2.4), { tool: false }));
        check(`minecraft:${t}_axe`, totals(`minecraft:${t}_axe`, f(AXE[t][0]), f(AXE[t][1])));
        check(`minecraft:${t}_pickaxe`, totals(`minecraft:${t}_pickaxe`, f(1 + m), f(-2.8)));
        check(`minecraft:${t}_shovel`, totals(`minecraft:${t}_shovel`, f(1.5 + m), f(-3.0)));
        check(`minecraft:${t}_hoe`, [1, 4 + f(f(m + 1) - 4)]);
        for (const k of ['sword', 'axe', 'pickaxe', 'shovel', 'hoe']) assert.equal(items[`minecraft:${t}_${k}`].source, 'vanilla');
    }
    // The ones the #530 review named: the iron axe is 9 every 50 ticks here, not vanilla's 9 every 25.
    assert.deepEqual([items['minecraft:iron_axe'].attackDamage, items['minecraft:iron_axe'].cooldownTicks], [9, 50]);
    assert.deepEqual([items['minecraft:diamond_sword'].attackDamage, items['minecraft:diamond_axe'].attackDamage, items['minecraft:wooden_pickaxe'].attackSpeed], [8, 7, 4]);
});

test('Pyrotech: ItemInitializer, its materials, the crude, redstone, quartz and hammer classes, and Material Changer', () => {
    const init = section(jp, 'Pyrotech ItemInitializer.onRegister');
    // The axes' (damage, speed) per tier, in registration order: the two floats before the tier's name.
    const axeArgs = {};
    for (const m of init.matchAll(/float (-?[\d.]+)f\n.*float (-?[\d.]+)f\n(?:.*String (\w+)\n)?.*\n?.*String (\w+_axe)\n/g)) axeArgs[m[4].replace('_axe', '')] = [+m[1], +m[2]];
    assert.deepEqual(axeArgs, { bone: [8, -3.2], flint: [8, -3.2], redstone: [8, -2.8], quartz: [8, -2.8], obsidian: [8, -3.0] });
    assert.match(init, /EnumMaterial\.BONE[\s\S]*String bone_axe[\s\S]*EnumMaterial\.FLINT[\s\S]*String flint_axe[\s\S]*ModuleMaterials\.OBSIDIAN[\s\S]*String obsidian_axe/);
    const mm = section(jp, 'athenaeum ModuleMaterials static init');
    const dmgOf = (text, name) => pushes(text.slice(text.indexOf(`String ${name}\n`)).split('addToolMaterial')[0])[3];
    const matDmg = { bone: dmgOf(mm, 'athenaeum:BONE'), flint: dmgOf(mm, 'athenaeum:FLINT'), obsidian: dmgOf(mm, 'athenaeum:OBSIDIAN') };
    const core = section(jp, 'Pyrotech ModuleCore$Materials static init');
    Object.assign(matDmg, { redstone: dmgOf(core, 'pyrotech:redstone'), quartz: dmgOf(core, 'pyrotech:quartz'), crude: 1 });
    assert.deepEqual(matDmg, { bone: 1, flint: 1, obsidian: 2, redstone: 1, quartz: 1, crude: 1 });
    assert.match(section(jp, 'athenaeum EnumMaterial static init'), /String BONE[\s\S]*ModuleMaterials\.BONE/);
    for (const c of ['ItemCrudeAxe', 'ItemCrudeHoe', 'ItemCrudePickaxe', 'ItemCrudeShovel']) assert.match(section(jp, `Pyrotech ${c} <init>`), /ToolMaterial\.STONE[\s\S]*spi\/Item\w+Base\."<init>":\(Lnet\/minecraft\/item\/Item\$ToolMaterial;Ljava\/lang\/String;\)V/, c);
    for (const t of ['Redstone', 'Quartz']) for (const k of ['Hoe', 'Pickaxe', 'Shovel', 'Sword', 'Axe']) assert.match(section(jp, `Pyrotech Item${t}${k} <init>`), new RegExp(`Materials\\.${t.toUpperCase()}`));
    for (const k of ['Axe', 'Pickaxe', 'Shovel', 'Hoe', 'Sword']) {
        const vanilla = { Axe: 'ItemAxe', Pickaxe: 'ItemPickaxe', Shovel: 'ItemSpade', Hoe: 'ItemHoe', Sword: 'ItemSword' }[k];
        assert.match(section(jp, `Pyrotech Item${k}Base`), new RegExp(`extends net\\.minecraft\\.item\\.${vanilla} `));
    }
    // The crude axe uses ItemAxe(STONE): the vanilla arrays.
    assert.match(section(jp, 'Pyrotech ItemAxeBase'), /ItemAxeBase\(net\.minecraft\.item\.Item\$ToolMaterial, java\.lang\.String\);\n.*\n.*\n.*\n.*ItemAxe\."<init>":\(Lnet\/minecraft\/item\/Item\$ToolMaterial;\)V/);
    const AX = { ...axeArgs, crude: [8, -3.2] };
    for (const [t, d] of Object.entries(matDmg)) {
        check(`pyrotech:${t}_axe`, totals(`pyrotech:${t}_axe`, f(AX[t][0]), f(AX[t][1])));
        check(`pyrotech:${t}_pickaxe`, totals(`pyrotech:${t}_pickaxe`, f(1 + d), f(-2.8)));
        check(`pyrotech:${t}_shovel`, totals(`pyrotech:${t}_shovel`, f(1.5 + d), f(-3.0)));
        check(`pyrotech:${t}_hoe`, [1, 4 + f(f(d + 1) - 4)]);
        if (t !== 'crude') check(`pyrotech:${t}_sword`, totals(`pyrotech:${t}_sword`, f(3 + d), f(-2.4), { tool: false }));
    }
    // Hammers: ItemTool(material, blocks) = damage = material, speed field 0 (attack speed 4), then Material Changer.
    assert.match(section(jp, 'Pyrotech ItemHammerBase'), /extends net\.minecraft\.item\.ItemTool [\s\S]*ItemTool\."<init>":\(Lnet\/minecraft\/item\/Item\$ToolMaterial;Ljava\/util\/Set;\)V/);
    const hm = { Crude: ['STONE', 1], Stone: ['STONE', 1], Bone: ['EnumMaterial.BONE', 1], Flint: ['EnumMaterial.FLINT', 1], Iron: ['IRON', 2], Gold: ['GOLD', 0], Diamond: ['DIAMOND', 3], Obsidian: ['ModuleMaterials.OBSIDIAN', 2] };
    for (const [h, [src, d]] of Object.entries(hm)) {
        assert.ok(section(jp, `Pyrotech Item${h}Hammer <init>`).includes(src), h);
        check(`pyrotech:${h.toLowerCase()}_hammer`, totals(`pyrotech:${h.toLowerCase()}_hammer`, f(d), 0));
    }
    // The obsidian hammer has two Material Changer damage entries; the later one (4, :1726) wins.
    assert.deepEqual([items['pyrotech:obsidian_hammer'].attackDamage, items['pyrotech:obsidian_hammer'].materialChanger.damage.line], [4, 1726]);
    assert.match(section(jp, 'Material Changer toList'), /new\s+#\d+\s+\/\/ class java\/util\/ArrayList[\s\S]*arraylength/);
    assert.equal(Object.keys(items).filter((k) => k.startsWith('pyrotech:') && items[k].source === 'pyrotech').length, 37);
});

test('Spartan Weaponry: max(0.5, base + multiplier x material - 1) + 1 and the type\'s speed, from spartanweaponry.cfg; boomerangs have no modifiers', () => {
    const cfg = {};
    let sec = null;
    for (const { text } of cfgLines('spartanweaponry.cfg')) {
        const s = text.match(/^(\w+) \{/);
        if (s) { sec = s[1]; continue; }
        const m = text.match(/^\s+S:(\w+)=(\S+)/);
        if (m) cfg[`${sec}.${m[1]}`] = +m[2];
    }
    const sw = section(combatJp, 'Spartan Weaponry ItemSwordBase');
    assert.match(sw, /float 0\.5f[\s\S]*getAttackDamage:\(\)F\n.*fload\s+4\n.*fmul\n.*fload_3\n.*fadd\n.*fconst_1\n.*fsub\n.*Math\.max/);
    assert.match(section(jp, 'Spartan ItemThrowingWeapon'), /float 0\.5f[\s\S]*fload\s+4\n.*fmul\n.*fload_3\n.*fadd\n.*fconst_1\n.*fsub\n.*Math\.max[\s\S]*fload\s+5\n.*f2d\n.*putfield .*Field attackSpeed:D/);
    assert.match(section(jp, 'Spartan ItemThrowingWeapon'), /func_111205_h[\s\S]*getDirectAttackDamage:\(\)F\n.*f2d[\s\S]*getfield .*Field attackSpeed:D\n.*double 4\.0d\n.*dsub/);
    assert.match(section(jp, 'Spartan ItemBoomerang.func_111205_h'), /HashMultimap\.create[^\n]*\n\s+\d+: astore_2\n\s+\d+: aload_2\n\s+\d+: areturn/);
    const TYPES = { Dagger: 'dagger', Longsword: 'longsword', Katana: 'katana', Saber: 'saber', Rapier: 'rapier', Greatsword: 'greatsword', Hammer: 'hammer', Warhammer: 'warhammer', Spear: 'spear', Halberd: 'halberd', Pike: 'pike', Lance: 'lance', Battleaxe: 'battleaxe', Mace: 'mace', Glaive: 'glaive', Quarterstaff: 'quarterstaff', Club: 'club', Caestus: 'caestus', ThrowingAxe: 'throwing_axe', ThrowingKnife: 'throwing_knife', Javelin: 'javelin', Boomerang: 'boomerang' };
    for (const [c, t] of Object.entries(TYPES)) {
        const s = section(jp, `Spartan Item${c} <init>`);
        const cap = c;
        const speedKey = /Throwing|Javelin|Boomerang/.test(c) ? `meleeSpeed${cap}` : `speed${cap}`;
        assert.match(s, new RegExp(`ConfigHandler\\.damageBase${cap}[\\s\\S]*ConfigHandler\\.damageMultiplier${cap}[\\s\\S]*ConfigHandler\\.${speedKey}`), c);
        assert.match(section(jp, 'Spartan ConfigHandler'), new RegExp(`^damageBase${cap} <- .*damageBase \\| ${t}`, 'm'), c);
    }
    // Materials: vanilla ones by Item$ToolMaterial (the ToolMaterialEx(name, material, ore) constructor reads c()), modded ones from the config.
    const te = section(jp, 'Spartan ToolMaterialEx');
    assert.match(te, /Method net\/minecraft\/item\/Item\$ToolMaterial\.func_78000_c:\(\)F\n.*putfield .*Field baseDamage:F/);
    assert.match(te, /fload\s+9\n.*putfield .*Field baseDamage:F/);
    for (const m of ['Copper', 'Tin', 'Bronze', 'Steel', 'Silver', 'Invar', 'Platinum', 'Electrum', 'Lead', 'Nickel']) {
        assert.match(section(jp, 'Spartan ConfigHandler'), new RegExp(`^damageMaterial${m} <- .*damageBase${m} \\| materials`, 'm'), m);
    }
    const reg = section(jp, 'Spartan ItemRegistrySW: vanilla-material registrations');
    const MAT = { wood: 0, stone: 1, iron: 2, gold: 0, diamond: 3 };
    for (const m of ['copper', 'tin', 'bronze', 'steel', 'silver', 'invar', 'platinum', 'electrum', 'lead', 'nickel']) MAT[m] = cfg[`materials.damageBase${m[0].toUpperCase()}${m.slice(1)}`];
    const SPECIAL = { caestus: 'wood', caestus_studded: 'iron', club_wood: 'wood', club_studded: 'iron', staff: 'wood' };
    for (const [name, mat] of Object.entries(SPECIAL)) assert.match(reg, new RegExp(`String ${name}\\n.*ToolMaterialEx\\.${mat.toUpperCase()}:`), name);
    let n = 0;
    for (const [k, e] of Object.entries(items)) {
        if (!k.startsWith('spartanweaponry:')) continue;
        const cls = e.class.split('.').pop().replace(/^Item/, '');
        const t = TYPES[cls];
        assert.ok(t, k);
        const p = k.split(':')[1];
        const mat = SPECIAL[p] ?? p.slice(p.lastIndexOf('_') + 1);
        if (MAT[mat] === undefined) assert.fail(`${k}: material ${mat}`);
        if (['wood', 'stone', 'iron', 'gold', 'diamond'].includes(mat) && !SPECIAL[p]) assert.match(reg, new RegExp(`String ${p}\\n.*ToolMaterialEx\\.${mat.toUpperCase()}:[\\s\\S]{0,200}Item${cls}\\."<init>"`), k);
        const speed = cfg[`${t}.speed`] ?? cfg[`${t}.meleeSpeed`];
        if (t === 'boomerang') {
            check(k, [1, 4]);
        } else {
            const field = Math.max(0.5, f(f(f(f(MAT[mat]) * f(cfg[`${t}.damageMultiplier`])) + f(cfg[`${t}.damageBase`])) - 1));
            check(k, totals(k, field, f(f(speed) - 4), { tool: false }));
        }
        assert.equal(e.source, 'spartan', k);
        n++;
    }
    assert.equal(n, 244);
    // Material Changer reaches Spartan (its getItemAttributeModifiers reads ItemSword.attackDamage): the invar halberd is 13.
    assert.match(sw, /public float getDirectAttackDamage\(\);\n.*\n.*aload_0\n.*getfield .*field_150934_a:F/);
    assert.equal(items['spartanweaponry:halberd_invar'].attackDamage, 13);
    // The add-ons use Spartan's classes: their speed is the type's; damage only where Material Changer sets it.
    for (const [k, e] of Object.entries(items)) {
        if (!/^spartan(fire|compat|twilight):/.test(k) || !/spartanweaponry\.item\.Item/.test(e.class)) continue;
        const t = TYPES[e.class.split('.').pop().replace(/^Item/, '')];
        if (!t) continue;
        assert.equal(e.source, 'spartan-addon', k);
        if (t !== 'boomerang') close(e.attackSpeed, 4 + f(f(cfg[`${t}.speed`] ?? cfg[`${t}.meleeSpeed`]) - 4), k);
        if (MC[k]?.damage !== undefined) assert.equal(e.attackDamage, MC[k].damage, k);
        else if (t !== 'boomerang') assert.equal(e.attackDamage, null, k);
    }
});

test('Material Changer: every attack entry that reaches its item sets the number; those that do not are noted', () => {
    for (const [k, mc] of Object.entries(MC)) {
        const e = items[k];
        if (!e) continue;
        if (/does not reach/.test(e.note ?? '')) {
            assert.ok(e.attackDamage === null || mc.damage === undefined || e.attackDamage !== mc.damage || e.source === 'spartan-addon', k);
            continue;
        }
        if (mc.damage !== undefined) assert.equal(e.attackDamage, mc.damage, k);
        if (mc.speed !== undefined && e.base !== 'ItemSword') close(e.attackSpeed, mc.speed, k);
    }
    // An overriding class Material Changer does not reach: Aether's zanite sword (its own modifiers).
    assert.match(section(jp, 'Class headers (mods)'), /ItemZaniteSword extends net\.minecraft\.item\.ItemSword[^\n]*\n\s+public [^\n]*func_111205_h/);
    assert.equal(items['aether_legacy:zanite_sword'].attackDamage, null);
});

test('Better Combat: the weapon class whitelist, crit chance by registry path, the Sword Tweaker and its pacing, for every item', () => {
    const bc = cfgLines('bettercombat.cfg');
    const tweak = [];
    const swords = [];
    for (const { n, text } of bc) {
        const m = text.match(/\[Weapon Substring=([^\]]+)\].*?\[Crit Chance=([-\d.]+)\]\s*\[Additional Crit Damage=([-\d.]+)\]/);
        if (m) tweak.push({ sub: m[1], chance: +m[2], extra: +m[3], n });
        const s = text.match(/\[Sword Substring=([^\]]+)\]\s*\[Additional Attack Speed=([-\d.]+)\]/);
        if (s) swords.push({ sub: s[1], add: +s[2] });
    }
    assert.ok(tweak.length >= 30);
    assert.deepEqual(swords.map((s) => s.sub), ['golden_sword', 'stone_sword', 'wooden_sword']);
    // Better Combat matches the path only (ResourceLocation.getPath), so a "modid:" substring never matches.
    assert.match(section(jp, 'Better Combat Helpers.getRegistryNameFromItem'), /getRegistryName[\s\S]*ResourceLocation\.func_110623_a/);
    assert.match(section(jp, 'Better Combat ConfigurationHandler.setDefaultConfigWeaponVariables'), /baseCritPercentChance:D\n.*putfield .*critChanceMod:D\n.*\n.*dconst_0\n.*putfield .*additionalCritDamageMod:D/);
    const WL = { ItemSword: 'ItemSword', ItemTool: 'ItemTool', ItemAxe: 'ItemTool', ItemPickaxe: 'ItemTool', ItemSpade: 'ItemTool', ItemHoe: 'ItemHoe' };
    for (const [k, e] of Object.entries(items)) {
        const p = k.split(':')[1];
        const wl = WL[e.base] ?? (/spartanweaponry\.item\.Item(Throwing|Javelin|Boomerang)/.test(e.class) ? 'ItemThrowingWeapon' : null);
        assert.equal(e.bcWeapon, wl !== null, k);
        if (wl) assert.equal(e.bcWeaponClass, wl, k);
        const t = wl ? tweak.find((x) => p.includes(x.sub)) : null;
        assert.equal(e.bcCritChance, t ? t.chance : 0.05, k);
        assert.equal(e.bcCritMultiplier, 1.5 + (t ? t.extra : 0), k);
        let s = e.attackSpeed;
        if (s !== null) {
            if (!wl) s = 1.5 + (s - 4);
            else if (e.base === 'ItemSword') { const sw = swords.find((x) => p.includes(x.sub)); if (sw) s += f(sw.add); }
            close(e.bcAttackSpeed, s, `${k} bcAttackSpeed`);
            assert.equal(e.bcCooldownTicks, Math.max(8, Math.trunc(20 / Math.min(Math.max(e.bcAttackSpeed, 0.1), 20) + 0.5)), k);
        } else {
            assert.equal(e.bcAttackSpeed, null, k);
            assert.equal(e.bcCooldownTicks, null, k);
        }
        if (e.attackDamage === null) assert.equal(e.bcAttackDamage, null, k);
        else close(e.bcAttackDamage, e.attackDamage - (wl ? 0 : 0.5), k);
    }
    // The non-weapons among them: Better Combat hits with these as with an empty hand (0.5 off, speed 1.5 plus their modifiers).
    assert.deepEqual(Object.keys(items).filter((k) => !items[k].bcWeapon), ['contenttweaker:mythril_masonpick', 'contenttweaker:mythril_mattock', 'contenttweaker:sfs_masonpick', 'contenttweaker:steel_crowbar', 'dynamictrees:staff', 'earthworks:tool_hand_axe', 'quark:pickarang']);
    const heads = section(jp, 'Class headers (mods)');
    // A plain Item that does not override them has no modifiers: 1 damage, speed 4 (Better Combat: 0.5 every 13 ticks).
    assert.match(section(jp, 'ain (Item) getItemAttributeModifiers a(vl)'), /HashMultimap\.create[^\n]*\n\s+\d+: areturn/);
    const ha = items['earthworks:tool_hand_axe'];
    assert.deepEqual([ha.attackDamage, ha.attackSpeed, ha.bcAttackDamage, ha.bcCooldownTicks], [1, 4, 0.5, 13]);
    for (const re of [/ItemContent extends com\.teamacronymcoders\.base\.items\.ItemBase /, /items\.ItemBase extends com\.teamacronymcoders\.base\.items\.ItemBaseNoModel /, /ItemBaseNoModel extends net\.minecraft\.item\.Item /,
        /ItemPickarang extends vazkii\.arl\.item\.ItemMod /, /ItemMod extends net\.minecraft\.item\.Item /, /items\.Staff extends net\.minecraft\.item\.Item /,
        /Tools\.ToolAxe extends net\.minecraft\.item\.ItemAxe /, /ItemZaniteTool extends com\.gildedgames\.the_aether\.items\.tools\.ItemAetherTool /, /ItemAetherTool extends net\.minecraft\.item\.ItemTool /]) assert.match(heads, re);
    // Spot checks: a pickaxe crits 10% here (the pack's _pickaxe entry), a dagger 5% (no entry).
    assert.deepEqual([items['minecraft:iron_pickaxe'].bcCritChance, items['spartanweaponry:dagger_iron'].bcCritChance, items['spartanweaponry:katana_iron'].bcCritMultiplier], [0.1, 0.05, 2]);
});

test('weaponStats: combat.json\'s hand-written weapons agree with weapons.json; others come from it; unknown numbers stay null', () => {
    for (const k of Object.keys(pack.combatData.weapons)) {
        if (k === 'hand') continue;
        const a = weaponStats(k);
        const b = items[k];
        for (const x of ['attackDamage', 'attackSpeed', 'cooldownTicks', 'bcWeapon', 'bcAttackDamage', 'bcAttackSpeed', 'bcCooldownTicks', 'bcCritChance']) assert.equal(a[x], b[x], `${k} ${x}`);
    }
    const ia = weaponStats('minecraft:iron_axe');
    assert.deepEqual([ia.attackDamage, ia.cooldownTicks, ia.bcCooldownTicks, ia.source], [9, 50, 50, 'vanilla']);
    assert.equal(ia.class, undefined);
    assert.equal(pack.weaponStats('spartanweaponry:club_studded').attackDamage, 6);
    const z = weaponStats('aether_legacy:zanite_sword');
    assert.equal(z.attackDamage, null);
    assert.equal(meleeHitDamage({ weapon: 'aether_legacy:zanite_sword' }), null);
    assert.equal(hitsToKill({ mob: 'minecraft:zombie', weapon: 'aether_legacy:zanite_sword' }), null);
    assert.equal(weaponStats('minecraft:stick'), null);
    // A weapon with damage but no speed read: hits are counted, ticks are null.
    const ns = Object.keys(items).find((k) => items[k].attackDamage !== null && items[k].attackSpeed === null);
    assert.ok(ns);
    assert.equal(hitsToKill({ mob: 'minecraft:zombie', weapon: ns }).ticks, null);
    // The iron sword against a zombie on Better Combat's packet: 6 x 0.8 after 2 armour, 5 hits.
    assert.equal(hitsToKill({ mob: 'minecraft:zombie', weapon: 'minecraft:iron_sword' }).hits, 5);
});
