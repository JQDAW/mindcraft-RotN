// Builds 3.3.4/food-values.json: what each food gives on this pack (hunger and saturation), and
// which foods harm the player (avoid), from the pinned server pack zip.
//
// The dump's food values (items.json `food`) are vanilla ItemFood values. On this pack two
// AppleCore listeners change them (bytecode, below):
//   1. Hunger Overhaul, FoodModifier.getModifiedFoodValues on FoodEvent$GetFoodValues at
//      EventPriority.HIGHEST: if modifyFoodValues, a blacklisted item keeps its values, an item in
//      its table (VanillaModule, HarvestCraftModule, BiomesOPlentyModule, JSON files, IMC; only
//      when useHOFoodValues) gets the table's values, and any other food gets
//      hunger = max(1, round(hunger / foodHungerDivider)) and
//      saturationModifier = (that hunger / foodHungerToSaturationDivider, unless it is 0) / foodSaturationDivider;
//   2. HungerTweaker, ModEventHandler.on(FoodEvent$GetFoodValues) at EventPriority.LOWEST, so last:
//      the scripts' `<item>.foodValues.hunger` / `.saturationModifier` (scripts/food.zs, ...).
// So a food a script sets has the script's values; any other food has Hunger Overhaul's.
// Hunger Overhaul's HarvestCraft and Biomes O' Plenty tables (640 and 4 entries, some behind
// runtime checks) are not read: those mods' foods that no script sets are listed in
// `notComputed` instead of being guessed. Every other food is computed.
//
// Usage: node packages/rotn-data/tools/build-food-values.mjs --pack <server-pack.zip> [--check]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { zipEntries, zipRead, parseClass } from './build-falling-blocks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../3.3.4/food-values.json');
const PACK_SHA256 = '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205';
const HO_CFG = 'config/hungeroverhaul/HungerOverhaul.cfg';
const HO_JAR = 'mods/HungerOverhaul-1.12.2-1.3.3.jenkins148.jar';
const BWM_CFG = 'config/betterwithmods.cfg';
const HO_TABLE_MODS = ['harvestcraft', 'biomesoplenty']; // their Hunger Overhaul tables are not read
const FOOD_EVENTS = ['squeek/applecore/api/food/FoodEvent$GetFoodValues', 'squeek/applecore/api/food/FoodEvent$GetPlayerFoodValues'];

const EVIDENCE = {
    order: 'HungerOverhaul-1.12.2-1.3.3.jenkins148.jar: FoodModifier.getModifiedFoodValues(FoodEvent$GetFoodValues) is @SubscribeEvent(priority = HIGHEST); HungerTweaker-1.12.2-1.3.0.jar: ModEventHandler.on(FoodEvent$GetFoodValues) is @SubscribeEvent(priority = LOWEST) and applies CTFoodValues (the scripts\' foodValues) last',
    rule: 'HungerOverhaul FoodModifier.getModifiedFoodValues: returns unless Config.modifyFoodValues (bytecode 0-6); a blacklisted item keeps its values (7-20); lookupModifiedFoodValues (the table, matched with ItemStack.isItemEqual, so meta 0 for Item keys) wins (22-38); otherwise hunger = max(1, Math.round(hunger / foodHungerDivider)) (42-57) and saturationModifier = hunger / foodHungerToSaturationDivider when that is not 0 (62-83), then / foodSaturationDivider (88-91)',
    table: 'HungerOverhaul VanillaModule: FoodModifier.setModifiedFoodValues(Items.X, new FoodValues(hunger, saturationModifier)) for 19 vanilla foods when Config.useHOFoodValues (bytecode 50-53); setModifiedFoodValues(Item) keys new ItemStack(item), meta 0',
    cast: 'HungerTweaker ModEventHandler.on(FoodEvent$GetFoodValues): new hunger = (int) hunger.eval(old hunger) (Expression.eval then d2i, bytecode 91-96), so a script hunger of 0.1 gives 0; saturationModifier is a float',
    saturation: 'AppleCore FoodValues: the saturation a food adds is hunger * saturationModifier * 2 (vanilla FoodStats.addStats), capped at the food level',
};

// Hunger Overhaul's VanillaModule table (meta 0), bytecode offsets of each setModifiedFoodValues.
// Items.field_* mapped with MCP stable-39 fields.csv (APPLE = field_151034_e, ...).
const HO_VANILLA = {
    'minecraft:apple': [1, 0.05, 69], 'minecraft:bread': [3, 0.2, 85], 'minecraft:porkchop': [1, 0.05, 101],
    'minecraft:cooked_porkchop': [2, 0.15, 117], 'minecraft:fish': [1, 0.05, 133], 'minecraft:cooked_fish': [2, 0.1, 149],
    'minecraft:cookie': [1, 0.05, 165], 'minecraft:melon': [1, 0.05, 181], 'minecraft:beef': [1, 0.05, 197],
    'minecraft:cooked_beef': [2, 0.15, 213], 'minecraft:chicken': [1, 0.05, 229], 'minecraft:cooked_chicken': [2, 0.15, 245],
    'minecraft:rotten_flesh': [1, 0.05, 261], 'minecraft:baked_potato': [2, 0.15, 277], 'minecraft:poisonous_potato': [1, 0.05, 293],
    'minecraft:pumpkin_pie': [3, 0.15, 309], 'minecraft:mushroom_stew': [2, 0.1, 325], 'minecraft:carrot': [1, 0.05, 341],
    'minecraft:potato': [1, 0.05, 357],
};

// Foods that harm the player when eaten. `metas` null = every meta. Effects: seconds, level (1 = I), chance.
const VANILLA_REG = 'minecraft_server.1.12.2.jar: Item.registerItems (ain.t, func_150900_l) registers it as new ItemFood(...).setPotionEffect(new PotionEffect(MobEffects.X, ticks, amplifier), chance) (ItemFood.func_185070_a = aij.a; MobEffects mapped with Forge\'s SRG table and MCP fields.csv)';
const AVOID = {
    'minecraft:rotten_flesh': { metas: null, effects: [{ effect: 'hunger', seconds: 30, level: 1, chance: 0.8 }], confidence: 'verified', evidence: [`${VANILLA_REG}: Hunger 600 ticks, amplifier 0, chance 0.8 (bytecode 5202-5227)`] },
    'minecraft:chicken': { metas: null, effects: [{ effect: 'hunger', seconds: 30, level: 1, chance: 0.3 }], confidence: 'verified', evidence: [`${VANILLA_REG}: raw chicken, Hunger 600 ticks, amplifier 0, chance 0.3 (5127-5152)`] },
    'minecraft:spider_eye': { metas: null, effects: [{ effect: 'poison', seconds: 5, level: 1, chance: 1 }], confidence: 'verified', evidence: [`${VANILLA_REG}: Poison 100 ticks, amplifier 0, chance 1.0 (5432-5454)`] },
    'minecraft:poisonous_potato': { metas: null, effects: [{ effect: 'poison', seconds: 5, level: 1, chance: 0.6 }], confidence: 'verified', evidence: [`${VANILLA_REG}: Poison 100 ticks, amplifier 0, chance 0.6 (5968-5992)`] },
    'minecraft:fish': {
        metas: [3], effects: [{ effect: 'poison', seconds: 60, level: 4, chance: 1 }, { effect: 'hunger', seconds: 15, level: 3, chance: 1 }, { effect: 'nausea', seconds: 15, level: 2, chance: 1 }],
        confidence: 'verified', evidence: ['minecraft_server.1.12.2.jar: ItemFishFood.onFoodEaten (aig.a, func_77849_c), for the pufferfish (meta 3): Poison 1200 ticks amplifier 3, Hunger 300 ticks amplifier 2, Nausea 300 ticks amplifier 1 (bytecode 19-65)'],
    },
};
// Effects the pack's scripts add on eating; each line is checked against the script at build time.
const SCRIPT_AVOID = [
    { item: 'cyclicmagic:inventory_food', file: 'scripts/events.zs', lines: [135, 136, 138, 140], effects: [{ effect: 'poison', seconds: 10, level: 3, chance: 1 }, { effect: 'nausea', seconds: 20, level: 1, chance: 1 }, { effect: 'blindness', seconds: 20, level: 1, chance: 1 }] },
    { item: 'iceandfire:pixie_dust', file: 'scripts/events.zs', lines: [145, 146], effects: [{ effect: 'nausea', seconds: 5, level: 1, chance: 1 }] },
    { item: 'betterwithmods:raw_egg', file: 'scripts/events.zs', lines: [151, 152, 156, 158], effects: [{ effect: 'nausea', seconds: 10, level: 2, chance: 1 }, { effect: 'blindness', seconds: 2.5, level: 1, chance: 1 }, { effect: 'potioncore:vulnerable', seconds: 5, level: 1, chance: 1 }], note: 'also Regeneration I for 10 s' },
    { item: 'rustic:ironberries', file: 'scripts/events.zs', lines: [177, 179], effects: [{ effect: 'potioncore:weight', seconds: 10, level: 50, chance: 1 }], note: 'Weight 50 roots the player for 10 s' },
    { ore: 'listAllvenisonraw', file: 'scripts/events.zs', lines: [184, 185], effects: [{ effect: 'hunger', seconds: 5, level: 1, chance: 0.75 }] },
];
// Documented by the research (docs/research/rotn-progression.md, the pack's handbook).
const DOC_AVOID = {
    'rustic:cloudsbluff': { metas: null, effects: [{ effect: 'levitation', seconds: null, level: null, chance: 1 }], confidence: 'documented', evidence: ['docs/research/rotn-progression.md line 98: Cloudsbluff (rustic:cloudsbluff), eating it makes you float upward; do not eat it [HB newbeginning/getting_food_1]'] },
};

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const round4 = (x) => Math.round(x * 1e4) / 1e4;

/** Strip // and block comments, keeping line numbers (strings are kept as they are). */
export function stripComments(text) {
    let out = '', inBlock = false, inStr = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i], d = text[i + 1];
        if (inBlock) { if (c === '*' && d === '/') { inBlock = false; i++; } else if (c === '\n') out += c; continue; }
        if (inStr) { out += c; if (c === '\\') { out += d ?? ''; i++; } else if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'") { inStr = c; out += c; continue; }
        if (c === '/' && d === '*') { inBlock = true; i++; continue; }
        if (c === '/' && d === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
        out += c;
    }
    return out;
}

/** The scripts' foodValues lines: Map "name|meta" -> { hunger?, saturationModifier?, lines: [file:line] }. */
export function parseFoodScripts(files) {
    const out = new Map();
    const owner = new Map(); // "key|field" -> file, to refuse cross-file conflicts (load order is not modelled)
    for (const [file, text] of files) {
        stripComments(text).split(/\r?\n/).forEach((l, i) => {
            if (!l.includes('foodValues')) return;
            const m = l.match(/^\s*<([a-z0-9_.-]+:[a-z0-9_./-]+)(?::(\d+|\*))?>\.foodValues\.(hunger|saturationModifier)\s*=\s*(-?\d+(?:\.\d+)?)\s*;\s*$/);
            if (!m) throw new Error(`${file} line ${i + 1}: a foodValues line this tool cannot read: ${l.trim()}`);
            const key = `${m[1]}|${m[2] ?? 0}`;
            const prev = owner.get(`${key}|${m[3]}`);
            if (prev && prev !== file) throw new Error(`${key} ${m[3]} is set in ${prev} and ${file}; script load order is not modelled`);
            owner.set(`${key}|${m[3]}`, file);
            const e = out.get(key) ?? { lines: [] };
            e[m[3]] = Number(m[4]);
            e.lines.push(`${file}:${i + 1}`);
            out.set(key, e);
        });
    }
    return out;
}

function readCfg(lines, key) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*[BSI]:${key}=`).test(l));
    if (i < 0) throw new Error(`${HO_CFG}: no ${key}`);
    const v = lines[i].trim().split('=')[1];
    return { value: v === 'true' ? true : v === 'false' ? false : Number(v), line: i + 1 };
}

export function buildFoodValues(packPath) {
    const pack = loadRotnData('3.3.4');
    if (!pack.hasDump) throw new Error('no 3.3.4 dump imported');
    const zipBuf = fs.readFileSync(packPath);
    const packSha = sha256(zipBuf);
    if (packSha !== PACK_SHA256) throw new Error(`pack zip SHA-256 ${packSha}, expected the pinned ${PACK_SHA256}`);
    const top = zipEntries(zipBuf);
    const text = (n) => zipRead(zipBuf, top.get(n)).toString('utf8');

    const cfgLines = text(HO_CFG).split(/\r?\n/);
    const cfg = Object.fromEntries(['modifyFoodValues', 'useHOFoodValues', 'foodHungerDivider', 'foodHungerToSaturationDivider', 'foodSaturationDivider'].map((k) => [k, readCfg(cfgLines, k)]));
    if ([...top.keys()].some((n) => /^config\/hungeroverhaul\/json\/.+\.json$/i.test(n))) throw new Error('Hunger Overhaul JSON food files are present; this tool does not read them');
    // Better With Mods' HCHunger also listens to the food-value events; the pack turns it off.
    const bwmLines = text(BWM_CFG).split(/\r?\n/);
    const bwmLine = bwmLines.findIndex((l) => /^\s*B:HCHunger=/.test(l));
    if (bwmLine < 0 || !/=false\s*$/.test(bwmLines[bwmLine])) throw new Error(`${BWM_CFG}: HCHunger is not false; its food changes are not modelled`);

    // Who else changes food values: classes that reference AppleCore's food-value events, or send
    // IMC to Hunger Overhaul (the string "hungeroverhaul" outside its own jar).
    const listeners = {}, imc = [];
    for (const jar of [...top.keys()].filter((n) => /^mods\/.+\.jar$/.test(n)).sort()) {
        const jb = zipRead(zipBuf, top.get(jar));
        for (const [n, e] of zipEntries(jb)) {
            if (!n.endsWith('.class')) continue;
            const cb = zipRead(jb, e);
            let c;
            try { c = parseClass(cb); } catch { continue; }
            if (FOOD_EVENTS.some((ev) => c.refs.has(ev))) (listeners[jar] ??= []).push(c.name.replace(/\//g, '.'));
            if (jar !== HO_JAR && cb.includes('hungeroverhaul')) imc.push(`${jar}: ${c.name.replace(/\//g, '.')}`);
        }
    }

    const scripts = [...top.keys()].filter((n) => /^scripts\/.+\.zs$/.test(n)).sort().map((n) => [n, text(n)]);
    const ct = parseFoodScripts(scripts);
    const scriptLines = new Map(scripts.map(([n, t]) => [n, t.split(/\r?\n/)]));

    const ho = (name, meta, base) => {
        if (!cfg.modifyFoodValues.value) return { hunger: base.hunger, saturationModifier: base.saturation, source: 'vanilla' };
        const t = cfg.useHOFoodValues.value && meta === 0 ? HO_VANILLA[name] : null;
        if (t) return { hunger: t[0], saturationModifier: t[1], source: 'hungeroverhaul-table', at: t[2] };
        if (cfg.useHOFoodValues.value && HO_TABLE_MODS.includes(name.split(':')[0])) return null;
        const hunger = Math.max(1, Math.round(Math.fround(base.hunger / cfg.foodHungerDivider.value)));
        const div = cfg.foodHungerToSaturationDivider.value;
        const sm = (div !== 0 ? hunger / div : base.saturation) / cfg.foodSaturationDivider.value;
        return { hunger, saturationModifier: sm, source: 'hungeroverhaul-rule' };
    };

    const foods = {}, notComputed = {}, used = new Set();
    const items = Object.entries(pack.dump.items.items).sort(([a], [z]) => a.localeCompare(z));
    for (const [name, it] of items) {
        for (const v of it.variants ?? []) {
            if (!v.food) continue;
            const key = ct.has(`${name}|${v.meta}`) ? `${name}|${v.meta}` : ct.has(`${name}|*`) ? `${name}|*` : null;
            const s = key ? ct.get(key) : null;
            if (key) used.add(key);
            const h = (s?.hunger == null || s?.saturationModifier == null) ? ho(name, v.meta, v.food) : null;
            // HungerTweaker casts the evaluated hunger to int (d2i): 0.1 -> 0.
            const hunger = s?.hunger != null ? Math.trunc(s.hunger) : h?.hunger ?? null;
            const sm = s?.saturationModifier ?? h?.saturationModifier ?? null;
            if (hunger == null || sm == null) { (notComputed[name] ??= []).push(v.meta); continue; }
            const e = { hunger, saturationModifier: round4(sm), saturation: round4(hunger * sm * 2), source: s ? (h ? 'crafttweaker+' + h.source : 'crafttweaker') : h.source, vanilla: { hunger: v.food.hunger, saturationModifier: v.food.saturation } };
            if (s) e.script = s.lines;
            if (s?.hunger != null && s.hunger !== hunger) e.scriptHunger = s.hunger;
            if (h?.at != null) e.hoTableAt = h.at;
            (foods[name] ??= {})[v.meta] = e;
        }
    }
    const scriptNotDumped = [...ct.keys()].filter((k) => !used.has(k)).map((k) => ({ item: k.replace('|', ':'), lines: ct.get(k).lines }));

    // Avoid: vanilla effects, the scripts' eating effects (lines checked here), the research.
    const avoid = {};
    for (const [n, a] of Object.entries(AVOID)) avoid[n] = { ...a };
    for (const a of SCRIPT_AVOID) {
        const lines = scriptLines.get(a.file);
        const cited = a.lines.map((ln) => lines[ln - 1].trim());
        const want = a.item ? `<${a.item}>` : `<ore:${a.ore}>`;
        if (!cited[0].includes(want)) throw new Error(`${a.file} line ${a.lines[0]} no longer names ${want}`);
        for (const [i, ef] of a.effects.entries()) {
            const id = ef.effect.includes(':') ? ef.effect : `minecraft:${ef.effect}`;
            if (!cited.slice(1).some((l) => l.includes(`<potion:${id}>`))) throw new Error(`${a.file}: no ${id} line among ${a.lines.slice(1).join(', ')} (effect ${i})`);
        }
        const entry = { metas: null, effects: a.effects, confidence: 'verified', evidence: [`${a.file} lines ${a.lines.join(', ')}: ${cited.join(' | ')}`], ...(a.note ? { note: a.note } : {}) };
        const names = a.item ? [a.item] : (pack.oreDict(a.ore) ?? []).map((s) => s.name);
        if (!names.length) throw new Error(`no items for ${want}`);
        for (const n of names) avoid[n] = { ...entry, ...(a.ore ? { ore: a.ore } : {}) };
    }
    for (const [n, a] of Object.entries(DOC_AVOID)) avoid[n] = { ...a };
    for (const n of Object.keys(avoid)) if (!pack.dump.items.items[n]) throw new Error(`avoid: ${n} is not a dumped item`);

    return {
        about: 'Food values on RotN 3.3.4 (hunger, saturationModifier, saturation = hunger * saturationModifier * 2) and foods to avoid. A food a pack script sets (HungerTweaker, applied last) has the script\'s values, cited by line; any other food has Hunger Overhaul\'s (its vanilla table, or its divide rule with this pack\'s config). Built by tools/build-food-values.mjs from the pinned server pack zip; see that file for the method.',
        source: { packZipSha256: packSha, scripts: scripts.filter(([n]) => [...ct.values()].some((e) => e.lines.some((l) => l.startsWith(n + ':')))).map(([n]) => n) },
        betterWithModsHCHunger: { value: false, at: `${BWM_CFG} line ${bwmLine + 1}`, note: 'Better With Mods registers the event handlers of a feature only when the feature is enabled' },
        hungerOverhaul: { config: Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, { value: v.value, at: `${HO_CFG} line ${v.line}` }])), notReadTables: HO_TABLE_MODS },
        evidence: EVIDENCE,
        foodValueListeners: listeners,
        hungerOverhaulImc: imc,
        notReflected: [
            'IMC from other mods to Hunger Overhaul (its table and blacklist); hungerOverhaulImc lists the classes that name it',
            'Hunger Overhaul\'s HarvestCraft and Biomes O\' Plenty tables: those mods\' foods no script sets are in notComputed',
            'per-player changes (FoodEvent$GetPlayerFoodValues listeners, e.g. diminishing returns) and the food level cap on saturation',
        ],
        foods,
        notComputed,
        scriptNotDumped,
        avoid,
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const a = process.argv.slice(2);
    const packPath = a[a.indexOf('--pack') + 1];
    if (!a.includes('--pack') || !packPath) { console.error('usage: build-food-values.mjs --pack <server-pack.zip> [--check]'); process.exit(2); }
    const json = JSON.stringify(buildFoodValues(packPath), null, 1) + '\n';
    if (a.includes('--check')) {
        const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') === json;
        console.log(same ? 'food-values.json is up to date' : 'food-values.json differs from a rebuild');
        process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(OUT, json);
    const r = JSON.parse(json);
    const by = {};
    for (const m of Object.values(r.foods)) for (const e of Object.values(m)) by[e.source] = (by[e.source] ?? 0) + 1;
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${JSON.stringify(by)}, notComputed ${Object.values(r.notComputed).flat().length}, avoid ${Object.keys(r.avoid).length}, listeners ${Object.keys(r.foodValueListeners).length}, imc ${r.hungerOverhaulImc.length}`);
}
