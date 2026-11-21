// Builds 3.3.4/weapons.json: every sword, axe, pickaxe, shovel, hoe and other melee tool or weapon on the pinned pack,
// its main-hand attackDamage / attackSpeed where the code and configs settle them, and how Better Combat treats it
// (weapon coverage, #530 review; PR #534).
//
// The dump records each item's own class only (items.json `class`). This tool reads the class files of every jar in
// the pinned server pack zip (mods/**.jar; nothing is executed and nothing is extracted: the zip and its jars are read
// in memory) and, for each dumped item class, follows the superclass chain to net/minecraft/*, noting which classes
// override getItemAttributeModifiers (func_111205_h) or Forge's getAttributeModifiers, and which reference the fields
// Material Changer writes (ItemTool attackDamage/attackSpeed, ItemSword attackDamage, ItemHoe speed).
//
// The items: a class chain reaching ItemSword, ItemTool (and ItemAxe, ItemPickaxe, ItemSpade) or ItemHoe, a Spartan weapon
// class, any item with a tool class in the dump, or a registry name ending in _sword, _axe, _pickaxe, _shovel or _hoe;
// armour, bows, quivers, buckets, parachutes, baubles and item blocks are left out (by simple class name).
// The numbers: three families read from bytecode (the constants below; test/weapons-coverage.test.js checks each against
// the javap excerpts in test/fixtures/weapons-3.3.4/): vanilla, Pyrotech, Spartan Weaponry (its config formula); then
// Material Changer (config/materialchanger.cfg; the last entry wins); a class that inherits the vanilla modifiers gives
// what its vanilla base fixes (sword speed 1.6, pickaxe 1.2, shovel 1.0, hoe damage 1, a plain Item 1 at speed 4).
// Anything else is null: never a vanilla guess. Better Combat: config/bettercombat.cfg's Custom Weapon Tweaker (first
// substring match on the registry path), Sword Tweaker and its weapon class whitelist.
//
// Usage: ROTN_PACK_ZIP=<server-pack.zip> node packages/rotn-data/tools/build-weapons.mjs [--pack <zip>] [--check]
//   --check compares with the committed file and exits 1 on a difference.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { zipEntries, zipRead } from './build-falling-blocks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../3.3.4/weapons.json');
const PACK_SHA256 = '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205';
const f32 = Math.fround;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---- class files: this, super, method names, field-ref names ----

const OVERRIDE_METHODS = new Set(['func_111205_h', 'getAttributeModifiers', 'getItemAttributeModifiers']);
export const TOOL_FIELDS = new Set(['field_77865_bY', 'field_185065_c', 'field_150934_a', 'field_185072_b']); // ItemTool damage/speed, ItemSword damage, ItemHoe speed

export function parseItemClass(buf) {
    if (buf.readUInt32BE(0) !== 0xcafebabe) throw new Error('not a class file');
    const n = buf.readUInt16BE(8);
    const utf8 = new Array(n), classIdx = new Array(n), fieldRef = new Array(n), nat = new Array(n);
    let p = 10;
    for (let i = 1; i < n; i++) {
        const tag = buf[p];
        switch (tag) {
            case 1: { const len = buf.readUInt16BE(p + 1); utf8[i] = buf.toString('utf8', p + 3, p + 3 + len); p += 3 + len; break; }
            case 7: classIdx[i] = buf.readUInt16BE(p + 1); p += 3; break;
            case 9: fieldRef[i] = buf.readUInt16BE(p + 3); p += 5; break;          // Fieldref: class, name-and-type
            case 12: nat[i] = buf.readUInt16BE(p + 1); p += 5; break;              // NameAndType: name, descriptor
            case 8: case 16: case 19: case 20: p += 3; break;
            case 15: p += 4; break;
            case 3: case 4: case 10: case 11: case 17: case 18: p += 5; break;
            case 5: case 6: p += 9; i++; break;
            default: throw new Error(`constant pool tag ${tag}`);
        }
    }
    const cls = (i) => (i ? utf8[classIdx[i]] : null);
    const name = cls(buf.readUInt16BE(p + 2));
    const superName = cls(buf.readUInt16BE(p + 4));
    const fields = new Set(fieldRef.filter(Boolean).map((t) => utf8[nat[t]]).filter(Boolean));
    p += 6;
    p += 2 + 2 * buf.readUInt16BE(p);
    const members = (withNames) => {
        const names = [];
        const c = buf.readUInt16BE(p); p += 2;
        for (let i = 0; i < c; i++) {
            if (withNames) names.push([utf8[buf.readUInt16BE(p + 2)], utf8[buf.readUInt16BE(p + 4)]]);
            const ac = buf.readUInt16BE(p + 6); p += 8;
            for (let a = 0; a < ac; a++) p += 6 + buf.readUInt32BE(p + 2);
        }
        return names;
    };
    members(false);
    const methods = members(true);
    return { name, superName, methods, fields };
}

/** Superclass chains of the dumped item classes, from every mods/**.jar in the pack (first jar in name order wins). */
export function scanChains(zipBuf, top, itemClasses) {
    const index = new Map(); // name -> { superName, overrides: [name+desc], touches: [field] }
    const jars = {};
    for (const jar of [...top.keys()].filter((k) => /^mods\/.+\.jar$/.test(k)).sort()) {
        let jb, entries;
        try { jb = zipRead(zipBuf, top.get(jar)); entries = zipEntries(jb); } catch { continue; }
        jars[jar] = sha256(jb);
        for (const [n, e] of entries) {
            if (!n.endsWith('.class')) continue;
            let c;
            try { c = parseItemClass(zipRead(jb, e)); } catch { continue; }
            if (index.has(c.name)) continue;
            index.set(c.name, {
                superName: c.superName,
                overrides: [...new Set(c.methods.filter(([m]) => OVERRIDE_METHODS.has(m)).map(([m, d]) => m + d))].sort(),
                touches: [...c.fields].filter((x) => TOOL_FIELDS.has(x)).sort(),
            });
        }
    }
    const chains = {};
    for (const [item, klass] of itemClasses) {
        const chain = [], overrides = [], touches = [];
        let c = (klass ?? '').replace(/\./g, '/');
        while (c && !c.startsWith('net/minecraft/') && index.has(c)) {
            const x = index.get(c);
            chain.push(c);
            if (x.overrides.length) overrides.push(c.replace(/\//g, '.'));
            if (x.touches.length) touches.push(c.replace(/\//g, '.'));
            c = x.superName;
        }
        chain.push(c || '?');
        chains[item] = { chain: chain.map((x) => x.replace(/\//g, '.')), overrides, touches };
    }
    return { chains, classCount: index.size, jars };
}

// ---- the families read from bytecode ----

const MAT = { wooden: 0, stone: 1, iron: 2, diamond: 3, golden: 0 };                  // Item$ToolMaterial.getAttackDamage
const AXE = { wooden: [6, -3.2], stone: [8, -3.2], iron: [8, -3.1], diamond: [8, -3.0], golden: [6, -3.0] }; // ItemAxe f[], n[] by ordinal

/** [attackDamage field, attackSpeed field] as the vanilla constructors set them (Java floats). */
function tool(kind, mat, axe) {
    switch (kind) {
        case 'sword': return [f32(3 + mat), f32(-2.4)];
        case 'axe': return [f32(axe[0]), f32(axe[1])];                // ItemAxe(material) arrays, or Forge's (material, damage, speed)
        case 'pickaxe': return [f32(1 + mat), f32(-2.8)];
        case 'shovel': return [f32(1.5 + mat), f32(-3.0)];
        case 'hoe': return [0, f32(f32(mat + 1) - 4)];                 // damage modifier 0; speed field material + 1, modifier speed - 4
        case 'tool': return [f32(mat), 0];                              // ItemTool(material, blocks) = this(0, 0, ...)
        default: throw new Error(kind);
    }
}

function families() {
    const fam = {};
    for (const t of Object.keys(MAT)) for (const k of ['sword', 'axe', 'pickaxe', 'shovel', 'hoe']) fam[`minecraft:${t}_${k}`] = ['vanilla', ...tool(k, MAT[t], AXE[t])];
    // Pyrotech: ItemInitializer; crude = vanilla STONE (ItemAxe(STONE) arrays); bone, flint = athenaeum ModuleMaterials 1.0;
    // obsidian 2.0; redstone, quartz = ModuleCore$Materials 1.0; hammers ItemTool(material, blocks).
    const PM = { crude: 1, bone: 1, flint: 1, obsidian: 2, redstone: 1, quartz: 1 };
    const PAXE = { crude: AXE.stone, bone: [8, -3.2], flint: [8, -3.2], obsidian: [8, -3.0], redstone: [8, -2.8], quartz: [8, -2.8] };
    for (const [t, d] of Object.entries(PM)) {
        for (const k of ['axe', 'pickaxe', 'shovel', 'hoe', 'sword']) {
            if (t === 'crude' && k === 'sword') continue;
            fam[`pyrotech:${t}_${k}`] = ['pyrotech', ...tool(k, d, PAXE[t])];
        }
    }
    for (const [t, d] of Object.entries({ crude: 1, stone: 1, bone: 1, flint: 1, iron: 2, gold: 0, diamond: 3, obsidian: 2 })) fam[`pyrotech:${t}_hammer`] = ['pyrotech', ...tool('tool', d)];
    return fam;
}

const SW_TYPE = {
    ItemDagger: 'dagger', ItemLongsword: 'longsword', ItemKatana: 'katana', ItemSaber: 'saber', ItemRapier: 'rapier', ItemGreatsword: 'greatsword',
    ItemHammer: 'hammer', ItemWarhammer: 'warhammer', ItemSpear: 'spear', ItemHalberd: 'halberd', ItemPike: 'pike', ItemLance: 'lance',
    ItemBattleaxe: 'battleaxe', ItemMace: 'mace', ItemGlaive: 'glaive', ItemQuarterstaff: 'quarterstaff', ItemClub: 'club', ItemCaestus: 'caestus',
    ItemThrowingAxe: 'throwing_axe', ItemThrowingKnife: 'throwing_knife', ItemJavelin: 'javelin', ItemBoomerang: 'boomerang',
};
const SW_SPECIAL = { caestus: 'wood', caestus_studded: 'iron', club_wood: 'wood', club_studded: 'iron', staff: 'wood' };

// ---- configs (read from the zip; line numbers as in the zip) ----

const cfgText = (zipBuf, top, rel) => zipRead(zipBuf, top.get(rel)).toString('utf8').split(/\r?\n/);

function readConfigs(zipBuf, top) {
    const mc = {};
    cfgText(zipBuf, top, 'config/materialchanger.cfg').forEach((l, i) => {
        const m = l.match(/^\s+(ATTACK_DAMAGE|ATTACK_SPEED);([^;]+);([-\d.]+)\s*$/);
        if (m && i + 1 >= 82 && i + 1 <= 2145) (mc[m[2]] ??= {})[m[1] === 'ATTACK_DAMAGE' ? 'damage' : 'speed'] = [+m[3], i + 1];
    });
    const bc = cfgText(zipBuf, top, 'config/bettercombat.cfg');
    const list = (re) => {
        const i = bc.findIndex((l) => re.test(l));
        const out = [];
        for (let k = i + 1; k < bc.length && bc[k].trim() !== '>'; k++) out.push([k + 1, bc[k].trim()]);
        return out;
    };
    const tweak = [];
    for (const [ln, s] of list(/S:"Custom Weapon Tweaker" </)) {
        const m = s.match(/\[Weapon Substring=([^\]]+)\].*?\[Crit Chance=([-\d.]+)\]\s*\[Additional Crit Damage=([-\d.]+)\]/);
        if (m) tweak.push([m[1], +m[2], +m[3], ln]);
    }
    const swords = [];
    for (const [ln, s] of list(/S:"Sword Tweaker" </)) {
        const m = s.match(/\[Sword Substring=([^\]]+)\]\s*\[Additional Attack Speed=([-\d.]+)\]/);
        if (m) swords.push([m[1], +m[2], ln]);
    }
    const sw = {};
    let sec = null;
    for (const l of cfgText(zipBuf, top, 'config/spartanweaponry.cfg')) {
        const s = l.match(/^(\w+) \{/);
        if (s) { sec = s[1]; continue; }
        const m = l.match(/^\s+[SBI]:(\w+)=(\S+)/);
        if (m && sec) sw[`${sec}.${m[1]}`] = m[2];
    }
    const quality = [...top.keys()].filter((k) => k.startsWith('config/qualitytools/Quailities/') && !k.endsWith('/')).map((k) => k.slice('config/qualitytools/Quailities/'.length)).sort();
    return { mc, tweak, swords, sw, quality };
}

// ---- per item ----

const TOOL_BASES = new Set(['net.minecraft.item.ItemSword', 'net.minecraft.item.ItemTool', 'net.minecraft.item.ItemAxe', 'net.minecraft.item.ItemPickaxe', 'net.minecraft.item.ItemSpade', 'net.minecraft.item.ItemHoe']);
const SKIP = /Armor|Bow|Crossbow|Quiver|Bucket|Parachute|Bauble|ItemBlock|Dart|Longbow/; // on the simple class name
const WHITELIST_OF = {
    'net.minecraft.item.ItemSword': 'ItemSword', 'net.minecraft.item.ItemTool': 'ItemTool', 'net.minecraft.item.ItemAxe': 'ItemTool',
    'net.minecraft.item.ItemPickaxe': 'ItemTool', 'net.minecraft.item.ItemSpade': 'ItemTool', 'net.minecraft.item.ItemHoe': 'ItemHoe',
    'com.oblivioussp.spartanweaponry.item.ItemThrowingWeapon': 'ItemThrowingWeapon',
};
const SPARTAN_FIELD_READERS = new Set(['com.oblivioussp.spartanweaponry.item.ItemSwordBase']); // its getItemAttributeModifiers reads ItemSword.attackDamage
const r6 = (x) => (x === null ? null : Math.round(x * 1e6) / 1e6);
const bcTicks = (s) => Math.max(8, Math.trunc(20 / Math.min(Math.max(s, 0.1), 20) + 0.5));

export function computeWeapons(items, chains, cfg) {
    const fam = families();
    const swMat = { wood: 0, stone: 1, iron: 2, gold: 0, diamond: 3 };
    for (const m of ['copper', 'tin', 'bronze', 'steel', 'silver', 'invar', 'platinum', 'electrum', 'lead', 'nickel']) swMat[m] = +cfg.sw[`materials.damageBase${m[0].toUpperCase()}${m.slice(1)}`];
    const swSpeed = (t) => +(cfg.sw[`${t}.speed`] ?? cfg.sw[`${t}.meleeSpeed`]);
    const spartan = (name, simple, own) => {
        const typ = SW_TYPE[simple];
        const speed = f32(f32(swSpeed(typ)) - 4);
        if (typ === 'boomerang') return [0, 0, typ, null];               // ItemBoomerang.getItemAttributeModifiers: an empty map
        if (!own) return [null, speed, typ, null];
        const p = name.split(':')[1];
        const mat = SW_SPECIAL[p] ?? p.slice(p.lastIndexOf('_') + 1);
        if (swMat[mat] === undefined) throw new Error(`${name}: Spartan material ${mat}`);
        const field = Math.max(0.5, f32(f32(f32(f32(swMat[mat]) * f32(+cfg.sw[`${typ}.damageMultiplier`])) + f32(+cfg.sw[`${typ}.damageBase`])) - 1));
        return [field, speed, typ, mat];
    };

    const cand = Object.keys(items).filter((k) => {
        const v = items[k], c = chains[k];
        if (SKIP.test((v.class ?? '').split('.').pop())) return false;
        return TOOL_BASES.has(c.chain.at(-1)) || Object.keys(v.toolClasses ?? {}).length > 0 || /_(sword|axe|pickaxe|shovel|hoe)$/.test(k)
            || c.chain.some((x) => x.includes('ThrowingWeapon') || x.includes('ItemSwordBase'));
    }).sort();

    const out = {};
    for (const name of cand) {
        const { chain, overrides, touches } = chains[name];
        const base = chain.at(-1);
        const simple0 = chain[0].split('.').pop();
        const mod = name.split(':')[0];
        const e = { class: chain[0], base: base.split('.').pop() };
        let dmgF = null, spdF = null, source = null;
        let notes = [];
        if (fam[name]) {
            [source, dmgF, spdF] = fam[name];
        } else if (chain[0].startsWith('com.oblivioussp.spartanweaponry.item.') && SW_TYPE[simple0]) {
            const own = mod === 'spartanweaponry';
            const [d, s, typ, mat] = spartan(name, simple0, own);
            [dmgF, spdF] = [d, s];
            source = own ? 'spartan' : 'spartan-addon';
            e.spartanType = typ;
            if (mat) e.spartanMaterial = mat;
            if (!own) notes.push(`${mod} builds Spartan's ${typ} with its own material, whose damage was not read: speed from Spartan's ${typ} config only`);
            if (typ === 'boomerang') notes.push('ItemBoomerang gives no attribute modifiers: a melee hit with it counts as an empty hand (1, speed 4)');
        } else if (!overrides.length && !touches.length) {
            source = 'vanilla-class';
            const kind = base.split('.').pop();
            if (kind === 'ItemSword') spdF = f32(-2.4);
            else if (kind === 'ItemPickaxe') spdF = f32(-2.8);
            else if (kind === 'ItemSpade') spdF = f32(-3.0);
            else if (kind === 'ItemHoe') dmgF = 0;
            else if (kind === 'Item') [dmgF, spdF] = [0, 0];               // Item.getItemAttributeModifiers: an empty map
            if (kind === 'Item') { /* settled */ } else if (kind === 'ItemHoe') notes.push('inherits ItemHoe\'s modifiers (damage 0); its material (speed) was not read');
            else if (['ItemSword', 'ItemPickaxe', 'ItemSpade'].includes(kind)) notes.push(`inherits ${kind}'s modifiers; its material's damage was not read`);
            else notes.push(`inherits ${kind}'s modifiers; the values its constructor passes were not read`);
        } else {
            if (overrides.length) notes.push(`its class overrides the attribute modifiers (${overrides.map((o) => o.split('.').pop()).join(', ')}): not read`);
            if (touches.length) notes.push(`its class writes the tool damage/speed fields itself (${touches.map((t) => t.split('.').pop()).join(', ')}): not read`);
        }
        // Material Changer writes ItemSword field 0 / ItemTool fields 2, 3 at postInit. A constructor that writes the field runs
        // before that (Spartan's ItemSwordBase, read); other classes that write or override are not assumed to read it.
        const m = cfg.mc[name];
        if (m) {
            const reads = overrides.every((o) => SPARTAN_FIELD_READERS.has(o)) && touches.every((t) => SPARTAN_FIELD_READERS.has(t));
            const isSword = base === 'net.minecraft.item.ItemSword';
            const isTool = ['net.minecraft.item.ItemTool', 'net.minecraft.item.ItemAxe', 'net.minecraft.item.ItemPickaxe', 'net.minecraft.item.ItemSpade'].includes(base);
            e.materialChanger = Object.fromEntries(Object.entries(m).map(([k, [value, line]]) => [k, { value, line }]));
            if (reads && m.damage && (isSword || isTool)) { dmgF = f32(f32(m.damage[0]) - 1); source ??= 'materialchanger'; }
            if (reads && m.speed && isTool) spdF = f32(f32(m.speed[0]) - 4);
            if (!reads) notes.push('Material Changer\'s entry does not reach it (its modifiers do not read the field it writes)');
            if (m.speed && isSword) notes.push('Material Changer cannot change a sword\'s speed (it logs an error)');
        }
        if (source === 'vanilla-class' && dmgF !== null && spdF !== null) notes = notes.filter((x) => !x.startsWith('inherits'));
        const dmg = dmgF === null ? null : 1 + dmgF;
        const spd = spdF === null ? null : 4 + spdF;
        e.source = source;
        e.attackDamage = r6(dmg);
        e.attackSpeed = r6(spd);
        e.cooldownTicks = spd === null ? null : Math.round(20 / spd * 10) / 10;
        const wl = chain.map((x) => WHITELIST_OF[x]).find(Boolean) ?? null;
        const p = name.split(':')[1];
        const tw = wl ? cfg.tweak.find(([sub]) => p.includes(sub)) : null;
        e.bcWeapon = wl !== null;
        if (wl) e.bcWeaponClass = wl;
        e.bcCritChance = tw ? tw[1] : 0.05;
        e.bcCritMultiplier = Math.round((1.5 + (tw ? tw[2] : 0)) * 1e6) / 1e6;
        if (tw) e.bcTweakerLine = tw[3];
        let bspd;
        if (wl) {
            bspd = spd;
            const sw = base === 'net.minecraft.item.ItemSword' ? cfg.swords.find(([sub]) => p.includes(sub)) : null;
            if (sw && bspd !== null) { bspd += f32(sw[1]); e.bcSwordTweakerLine = sw[2]; }
            e.bcAttackDamage = r6(dmg);
        } else {
            bspd = spdF === null ? null : 1.5 + spdF;                     // "Unarmed & Non-Weapon Attack Speed" plus the item's modifiers
            e.bcAttackDamage = dmg === null ? null : r6(dmg - 0.5);
        }
        e.bcAttackSpeed = r6(bspd);
        e.bcCooldownTicks = bspd === null ? null : bcTicks(bspd);
        if (overrides.length) e.overrides = overrides.map((o) => o.split('.').pop());
        if (notes.length) e.note = notes.join('; ');
        out[name] = e;
    }
    return out;
}

export function render(out, quality) {
    if (quality.join(',') !== 'baubles.json') throw new Error(`Quality Tools qualities changed: ${quality.join(', ')}`);
    const n = Object.keys(out).length;
    const head = {
        format: 'rotn-weapons/1',
        pack: '3.3.4',
        description: (`Every sword, axe, pickaxe, shovel, hoe and other melee tool or weapon on this pack (${n} items: an item whose class extends `
            + 'ItemSword, ItemTool or ItemHoe, a Spartan weapon, any item with a tool class, or a registry name ending in _sword, _axe, _pickaxe, '
            + '_shovel or _hoe; armour, bows, quivers, buckets, parachutes, baubles and item blocks left out), for weaponStats. attackDamage / '
            + 'attackSpeed: the main-hand attribute totals (1 + the damage modifier, 4 + the speed modifier) after Material Changer, null '
            + 'where the code or config that sets them was not read; cooldownTicks: vanilla\'s 20 / attackSpeed. bc*: Better Combat\'s '
            + 'packet (playerAttack.betterCombatPacket in combat.json). Generated by tools/build-weapons.mjs from the class files of every jar in '
            + 'the pinned pack zip (superclass chains, which classes override getItemAttributeModifiers or write the tool fields) and its configs; '
            + 'the families read from bytecode are in source: vanilla, pyrotech, spartan (fixtures/weapons-3.3.4/).'),
        sources: {
            vanilla: 'minecraft:{wooden,stone,iron,golden,diamond}_{sword,axe,pickaxe,shovel,hoe}: Item$ToolMaterial damage WOOD 0, STONE 1, IRON 2, DIAMOND 3, GOLD 0; ItemSword 3 + material, -2.4; ItemAxe(material) its arrays f/n; ItemPickaxe 1 + material, -2.8; ItemSpade 1.5 + material, -3.0; ItemHoe damage modifier 0, speed field material + 1 (modifier field - 4); then Material Changer',
            pyrotech: 'pyrotech tools: ItemInitializer (bone, flint: athenaeum ModuleMaterials 1.0; obsidian 2.0; axes ItemAxe(material, 8, -3.2), obsidian -3.0), crude tools vanilla STONE (ItemAxe(STONE) arrays), redstone and quartz ModuleCore$Materials 1.0 with axes (8, -2.8), hammers ItemTool(material, blocks) = damage material, speed field 0 (attack speed 4); then Material Changer',
            spartan: 'spartanweaponry: ItemSwordBase / ItemThrowingWeapon set the damage field to max(0.5, base + multiplier x material - 1) and the speed to the type\'s speed (melee speed for throwing weapons), all from spartanweaponry.cfg; material damage: vanilla materials\' (wood 0, stone 1, iron 2, gold 0, diamond 3), modded ones its damageBase<Metal>; ItemBoomerang has no modifiers; Material Changer reaches it (getItemAttributeModifiers reads ItemSword.attackDamage)',
            'spartan-addon': 'spartanfire, spartancompat, spartantwilight: Spartan\'s own weapon classes and type config (speed), with the add-on\'s materials (damage not read unless Material Changer sets it)',
            'vanilla-class': 'a class that inherits the vanilla modifiers and does not write the tool fields: ItemSword speed 1.6, ItemPickaxe 1.2, ItemSpade 1.0, ItemHoe damage 1, a plain Item no modifiers (1, speed 4); the rest comes from its material or constructor (not read) unless Material Changer sets it',
            materialchanger: 'only Material Changer\'s ATTACK_DAMAGE / ATTACK_SPEED settles the number',
        },
        qualityTools: 'Quality Tools defines only baubles qualities on this pack (config/qualitytools/Quailities/baubles.json): no tool or weapon carries quality modifiers',
    };
    const h = JSON.stringify(head, null, 1);
    return `${h.slice(0, -2)},\n "items": {\n${Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n }\n}\n`;
}

export function buildWeapons(packPath) {
    const pack = loadRotnData('3.3.4');
    if (!pack.hasDump) throw new Error('no 3.3.4 dump imported');
    const zipBuf = fs.readFileSync(packPath);
    const packSha = sha256(zipBuf);
    if (packSha !== PACK_SHA256) throw new Error(`pack zip SHA-256 ${packSha}, expected the pinned ${PACK_SHA256}`);
    const top = zipEntries(zipBuf);
    const items = pack.dump.items.items;
    const { chains, classCount } = scanChains(zipBuf, top, Object.entries(items).map(([k, v]) => [k, v.class]));
    const cfg = readConfigs(zipBuf, top);
    const out = computeWeapons(items, chains, cfg);
    return { text: render(out, cfg.quality), classCount, count: Object.keys(out).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const i = args.indexOf('--pack');
    const packPath = i >= 0 ? args[i + 1] : process.env.ROTN_PACK_ZIP;
    if (!packPath) {
        console.error('usage: ROTN_PACK_ZIP=<server-pack.zip> node packages/rotn-data/tools/build-weapons.mjs [--pack <zip>] [--check]');
        process.exit(2);
    }
    const { text, classCount, count } = buildWeapons(packPath);
    if (args.includes('--check')) {
        const same = fs.readFileSync(OUT, 'utf8') === text;
        console.log(`build-weapons: ${count} items from ${classCount} classes; ${same ? 'matches' : 'DIFFERS FROM'} ${path.relative(process.cwd(), OUT)}`);
        process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(OUT, text);
    console.log(`build-weapons: wrote ${count} items (${classCount} classes scanned) to ${path.relative(process.cwd(), OUT)}`);
}
