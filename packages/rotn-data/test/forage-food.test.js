// Wild food blocks (lead task G4 #5 food, 2026-11-08): forage-food.json and src/forage.js against the
// javap excerpts and the pack files in fixtures/forage-food-3.3.4/ (scripts/dropt.zs, config/rustic.cfg
// and config/harvestcraft.cfg copied from the pinned pack zip, an excerpt of scripts/events.zs, and
// bytecode excerpts of Rustic, Biomes O' Plenty, HarvestCraft, Dropt, athenaeum and CraftTweaker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/forage-food-3.3.4');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');
const pack = loadRotnData('3.3.4');
const data = pack.forageData;
const blocks = pack.dump.blocks.blocks;
const javap = read('forage-food.javap.txt');
const section = (title) => {
    const i = javap.indexOf(`\n## ${title}`);
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
const entry = (id) => {
    const e = data.blocks.find((b) => b.id === id);
    assert.ok(e, id);
    return e;
};
const st = (name, count = 1, meta = 0) => ({ name, meta, count });

/** The rules of one Dropt.list(...) in dropt.zs: [{ blocks, replaceStrategy, drops: [{ force, weight, silktouch, items }] }]. */
function droptList(name) {
    const zs = read('dropt.zs');
    const start = zs.indexOf(`Dropt.list("${name}")`);
    assert.ok(start >= 0, name);
    const end = zs.indexOf('Dropt.list(', start + 1);
    const text = zs.slice(start, end < 0 ? undefined : end);
    return text.split('.add(Dropt.rule()').slice(1).map((r) => ({
        blocks: JSON.parse(/\.matchBlocks\((\[[^\]]*\])\)/.exec(r)[1]),
        replaceStrategy: /\.replaceStrategy\("(\w+)"\)/.exec(r)?.[1] ?? null,
        drops: r.split('.addDrop(Dropt.drop()').slice(1).map((d) => {
            const sel = /\.selector\(Dropt\.weight\((\d+)\)(?:, "(\w+)")?/.exec(d);
            const items = [...d.matchAll(/<([\w:]+?)(?::(\d+))?>\]?(?:, Dropt\.range\((\d+)\))?/g)].map((m) => {
                const [ns, p] = m[1].split(':');
                return { name: `${ns}:${p}`, meta: Number(m[2] ?? 0), count: Number(m[3] ?? 1) };
            });
            return { force: /\.force\(\)/.test(d), weight: sel ? Number(sel[1]) : null, silktouch: sel?.[2] ?? 'ANY', items };
        }),
    }));
}

test('wildberry bush: a right-click on a berried bush gives 1 wildberries and keeps the bush', () => {
    const bush = section('Rustic BlockBerryBush');
    const act = method(bush, 'func_180639_a');
    // BERRIES true, and not holding bone meal (dye meta 15) ...
    assert.match(act, /Field BERRIES[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*booleanValue[^\n]*\n\s+\d+: ifeq +119/);
    inOrder(act, 'Items.field_151100_aR', 'func_77960_j', 'bipush        15', 'if_icmpeq     119');
    // ... set BERRIES false (flag 3), give one getBerries() stack (inventory, else dropped), return true.
    inOrder(act, 'Field BERRIES', 'iconst_0', 'Boolean.valueOf', 'iconst_3', 'World.func_180501_a', 'Method getBerries',
        'ItemStack."<init>":(Lnet/minecraft/item/Item;)V', 'EntityPlayer.func_191521_c', 'Block.func_180635_a', '117: iconst_1', '118: ireturn', '119: iconst_0');
    assert.match(section('Rustic ModBlocks$3'), /getBerries\(\);\n\s+Code:\n\s+0: getstatic[^\n]*ModItems\.WILDBERRIES/);
    assert.equal(blocks['rustic:wildberry_bush'].class, 'rustic.common.blocks.ModBlocks$3');
    const e = entry('wildberry-bush');
    assert.deepEqual(e.rightClick.gives, [st('rustic:wildberries')]);
    assert.equal(e.rightClick.becomesMeta, 0);
    assert.equal(e.rightClick.keepsBlock, true);
    assert.deepEqual(e.rightClick.notWhenHolding, [{ name: 'minecraft:dye', meta: 15 }]);
    assert.equal(e.rightClick.harm, null);
    assert.deepEqual(e.how, { 0: 'wait', 1: 'right-click' });
    // Meta 1 = berries (getMetaFromState), as the dump has it.
    assert.match(method(bush, 'public int func_176201_c'), /Field BERRIES[\s\S]*ifeq +22\n\s+18: iconst_1/);
    assert.deepEqual(blocks['rustic:wildberry_bush'].states.map((s) => [s.meta, s.props.berries]), [[0, 'false'], [1, 'true']]);
    assert.deepEqual(e.readyMetas, [1]);
});

test('wildberry bush: regrowth, touch and spawning', () => {
    const bush = section('Rustic BlockBerryBush');
    const tick = method(bush, 'func_180650_b');
    inOrder(tick, 'World.func_175671_l', 'bipush        9', 'if_icmplt', 'Field BERRIES', 'ifne', 'fconst_2', 'float 40.0f', 'fdiv', 'f2i', 'iconst_1', 'iadd', 'Random.nextInt',
        'ForgeHooks.onCropsGrowPre', 'Field BERRIES', 'iconst_1', 'World.func_180501_a');
    const e = entry('wildberry-bush');
    assert.equal(e.regrow.lightAbove, 9);
    assert.equal(e.regrow.chancePerRandomTick, 1 / (Math.trunc(40 / 2) + 1));
    assert.equal(e.regrow.expectedMinutes, Math.round((21 * 4096) / 3 / 20 / 60));
    // No collision box; 0.6x speed inside; hardness 0.2, plants.
    assert.match(method(bush, 'func_180646_a'), /field_185506_k/);
    assert.equal((method(bush, 'func_180634_a').match(/double 0\.6000000238418579d/g) ?? []).length, 2);
    inOrder(method(bush, 'BlockBerryBush(java.lang.String)'), 'Material.field_151585_k', 'float 0.2f', 'func_149711_c');
    assert.deepEqual([blocks['rustic:wildberry_bush'].states[0].hardness, blocks['rustic:wildberry_bush'].states[0].material], [0.2, 'plants']);
    assert.deepEqual([e.touch.slows, e.touch.collision, e.touch.harm], [0.6, false, null]);
    // Spawning: biome blacklist, half start with berries, config chance and attempts.
    const gen = section('Rustic WorldGenWildberries');
    const types = [...method(gen, 'static {}').matchAll(/BiomeDictionary\$Type\.(\w+):/g)].map((m) => m[1]);
    assert.deepEqual(e.spawn.notInBiomeTypes, types);
    inOrder(method(gen, 'generateBush'), 'BlockBerryBush.BERRIES', 'Random.nextBoolean');
    const cfg = read('rustic.cfg');
    assert.equal(String(e.spawn.chunkChance), /S:"Wildberry Generation Chance"=(\S+)/.exec(cfg)[1]);
    assert.equal(String(e.spawn.attempts), /I:"Max Wildberry Generation Attempts"=(\S+)/.exec(cfg)[1]);
});

test('Dropt: how the pack\'s rules pick drops (bytecode)', () => {
    // An entry without a meta parses as meta 0; '*' is 32767.
    const parse = method(section('athenaeum RecipeItemParser'), 'ParseResult parse(');
    inOrder(parse, 'iconst_0', 'ParseResult.setMeta', 'String :', 'sipush        32767', 'ParseResult.setMeta');
    // A block entry matches on getMetaFromState == meta, or any meta for 32767.
    inOrder(method(section('Dropt BlockMatchEntry'), 'public boolean matches('), 'Block.func_176201_c', 'Field meta:I', 'sipush        32767');
    // The first matching rule wins unless it falls through.
    assert.match(method(section('Dropt RuleLocator'), 'matchRules('), /List\.add[\s\S]*Rule\.fallthrough:Z\n\s+\d+: ifeq/);
    const rule = section('Dropt Rule (defaults)');
    inOrder(rule, 'EnumReplaceStrategy.REPLACE_ALL:', 'EnumDropStrategy.REPEAT', 'RandomFortuneInt', 'iconst_1', 'Field dropCount', 'iconst_0', 'Field fallthrough');
    inOrder(method(section('Dropt RuleDropItem'), 'RuleDropItem();'), 'RandomFortuneInt', 'iconst_1', 'Field quantity');
    inOrder(method(section('Dropt RuleDropSelector'), 'isValidCandidate'), 'EnumSilktouch.REQUIRED', 'EnumSilktouch.EXCLUDED');
    const mod = method(section('Dropt DropModifier'), 'modifyDrops(');
    inOrder(mod, 'RuleDrop.force:Z', 'List.add', 'isValidCandidate', 'WeightedPicker.add', 'Rule.dropCount', 'WeightedPicker.get', 'EnumReplaceStrategy.REPLACE_ALL_IF_SELECTED', 'List.clear');
});

test('wildberry bush: breaking follows the pack\'s Dropt rules (mostly sticks), not Rustic\'s getDrops', () => {
    const [bare, berried] = droptList('Berry_Good');
    assert.deepEqual(bare.blocks, ['rustic:wildberry_bush']); // meta 0 only (see the Dropt test)
    assert.deepEqual(berried.blocks, ['rustic:wildberry_bush:1']);
    const e = entry('wildberry-bush');
    for (const [meta, r] of [[0, bare], [1, berried]]) {
        assert.equal(r.replaceStrategy, 'REPLACE_ALL_IF_SELECTED');
        const want = e.break.byMeta[meta];
        assert.deepEqual(want.forced, r.drops.filter((d) => d.force).flatMap((d) => d.items), `forced ${meta}`);
        assert.deepEqual(want.pickOne, r.drops.filter((d) => !d.force && d.silktouch === 'EXCLUDED').map((d) => ({ weight: d.weight, items: d.items })), `pickOne ${meta}`);
        assert.deepEqual(r.drops.filter((d) => d.silktouch === 'REQUIRED').flatMap((d) => d.items), e.break.silkTouch, `silk ${meta}`);
        assert.equal(want.replacesBlockDrops, true);
    }
    // No other rule in dropt.zs names the bush.
    const zs = read('dropt.zs');
    assert.equal((zs.match(/"rustic:wildberry_bush(:\d+)?"/g) ?? []).length, 2);
    // Rustic's own getDrops (replaced) would give the bush plus the berries.
    inOrder(method(section('Rustic BlockBerryBush'), 'getDrops('), 'BlockBase.getDrops', 'Field BERRIES', 'Method getBerries');
});

test('hawthorn (BoP berry bush): right-clicking poisons and hurts (the pack\'s script); breaking gives 1 berry safely', () => {
    const ev = read('events.zs.excerpt.txt');
    assert.match(ev, /^201: events\.onPlayerInteractBlock\(function\(event as crafttweaker\.event\.PlayerInteractBlockEvent\) \{$/m);
    assert.match(ev, /^222: \tif \(event\.block\.definition\.id == "biomesoplenty:plant_0" & event\.block\.meta == 5\) \{$/m);
    assert.match(ev, /^223: .*<potion:minecraft:poison>\.makePotionEffect\(40, 1\)/m);
    assert.match(ev, /^225: .*attackEntityFrom\(<damageSource:CACTUS>, 4\);$/m);
    assert.match(ev, /^226: \t\treturn;$/m);
    assert.doesNotMatch(ev.split('\n').filter((l) => /^22[1-6]:/.test(l)).join('\n'), /cancel/);
    // onPlayerInteractBlock is the right-click event.
    assert.match(method(section('CraftTweaker MTEventManager'), 'onPlayerInteractBlock('), /Method onPlayerRightClickBlock:/);
    assert.match(section('CraftTweaker CommonEventHandler'), /onPlayerRightClickBlockEvent\(net\.minecraftforge\.event\.entity\.player\.PlayerInteractEvent\$RightClickBlock\)[\s\S]*publishPlayerRightClickBlock/);
    const harm = entry('hawthorn').rightClick.harm;
    assert.deepEqual(harm.effects, [{ effect: 'poison', seconds: 40 / 20, level: 1 + 1 }]);
    assert.deepEqual([harm.damage, harm.damageSource], [4, 'cactus']);
    // meta 5 is BERRYBUSH: enum order and the dump agree.
    const order = [...section('BoP BOPPlants (enum order)').matchAll(/String ([A-Z]+)$/gm)].map((m) => m[1]);
    for (const s of blocks['biomesoplenty:plant_0'].states) assert.equal(order[s.meta], s.props.variant.toUpperCase());
    for (const s of blocks['biomesoplenty:plant_1'].states) assert.equal(order[16 + s.meta], s.props.variant.toUpperCase());
    // BoP: switch index 5 = BERRYBUSH; right-click -> BUSH + a berry handed over; getDrops -> one berry.
    const map = section('BoP BlockBOPPlant$2 (switch map)');
    const idx = (n) => Number(new RegExp(`BOPPlants\\.${n}:[^\\n]*\\n[^\\n]*ordinal[^\\n]*\\n\\s+\\d+: (?:iconst_|bipush\\s+)(\\d+)`).exec(map)[1]);
    assert.equal(idx('BERRYBUSH'), 5);
    const plant = section('BoP BlockBOPPlant');
    inOrder(method(plant, 'func_180639_a'), '5: 40', 'BOPPlants.BUSH', 'World.func_175656_a', 'BOPItems.berries', 'World.func_72838_d', 'FakePlayer', 'EntityItem.func_70100_b_', '119: iconst_1');
    inOrder(method(plant, 'getDrops('), '5: 222', '222: aload', 'BOPItems.berries', 'List.add', 'goto          320');
    assert.match(section('BoP ModItems (berries)'), /iconst_1\n[^\n]*float 0\.1f\n[^\n]*bipush +8\n[^\n]*ItemBOPFood\."<init>":\(IFI\)V\n[^\n]*String berries/);
    assert.doesNotMatch(section('BoP ItemBOPFood'), /func_185070_a|PotionEffect|func_77849_c/);
    const e = entry('hawthorn');
    assert.deepEqual(e.how, { 5: 'break' });
    assert.deepEqual(e.break.byMeta[5].forced, [st('biomesoplenty:berries')]);
    assert.deepEqual(e.rightClick.becomes, { block: 'biomesoplenty:plant_0', meta: blocks['biomesoplenty:plant_0'].states.find((s) => s.props.variant === 'bush').meta });
    assert.equal(pack.avoidFood('biomesoplenty:berries'), null); // the berry itself is harmless
});

test('plant hazards: poison ivy, thorns and tiny cacti on touch, unless wearing boots and leggings', () => {
    const map = section('BoP BlockBOPPlant$2 (switch map)');
    const idx = (n) => Number(new RegExp(`BOPPlants\\.${n}:[^\\n]*\\n[^\\n]*ordinal[^\\n]*\\n\\s+\\d+: (?:iconst_|bipush\\s+)(\\d+)`).exec(map)[1]);
    assert.deepEqual([idx('POISONIVY'), idx('THORN'), idx('TINYCACTUS')], [3, 16, 22]);
    const touch = method(section('BoP BlockBOPPlant'), 'func_180634_a');
    inOrder(touch, '3: 56', '16: 130', '22: 130', '56: aload', 'field_70460_b', 'iconst_0', 'field_70460_b', 'iconst_1', 'MobEffects.field_76436_u', 'bipush        100', '130: aload', 'iconst_0', 'iconst_1', 'DamageSource.field_76367_g', 'fconst_1');
    const variant = (b, m) => blocks[b].states.find((s) => s.meta === m).props.variant;
    const [ivy, thorns, hawthorn] = data.hazards;
    assert.deepEqual([ivy.block, ivy.metas.map((m) => variant(ivy.block, m))], ['biomesoplenty:plant_0', ['poisonivy']]);
    assert.deepEqual(ivy.effects, [{ effect: 'poison', seconds: 100 / 20, level: 1 }]);
    assert.deepEqual([thorns.block, thorns.metas.map((m) => variant(thorns.block, m))], ['biomesoplenty:plant_1', ['thorn', 'tinycactus']]);
    assert.deepEqual([thorns.damage, thorns.damageSource], [1, 'cactus']);
    for (const h of [ivy, thorns]) assert.deepEqual([h.on, h.unlessWearing], ['touch', ['feet', 'legs']]);
    assert.deepEqual([hawthorn.on, hawthorn.metas, hawthorn.damage], ['right-click', [5], 4]);
    assert.deepEqual(hawthorn.effects, entry('hawthorn').rightClick.harm.effects);
});

test('Rustic herbs: wild ones spawn grown; breaking gives 1 plus 2 rolls of 4 in 6', () => {
    const base = section('Rustic BlockHerbBase');
    inOrder(method(base, 'getDrops('), 'BlockBush.getDrops', 'getAge', 'getMaxAge', 'if_icmplt', 'iconst_2', 'iload         4', 'iadd', 'iconst_2', 'getMaxAge', 'imul', 'Random.nextInt', 'if_icmpgt', 'Method getHerb');
    assert.match(method(base, 'getMaxAge'), /iconst_3\n\s+1: ireturn/);
    assert.match(method(base, 'func_180660_a'), /Method getHerb/);
    assert.doesNotMatch(base, /func_180639_a/); // no right-click harvest
    inOrder(method(section('Rustic WorldGenSurfaceHerbs'), 'generateHerb'), 'BlockHerbBase.AGE', 'iconst_3');
    const getHerb = section('Rustic Herbs getHerb');
    for (const [id, field] of [['cloudsbluff', 'CLOUDSBLUFF'], ['core-root', 'CORE_ROOT'], ['ginseng', 'GINSENG'], ['marsh-mallow', 'MARSH_MALLOW']]) {
        const e = entry(id);
        assert.equal(blocks[e.block].class, e.blockClass, id);
        const cls = e.blockClass.split('.').pop();
        assert.match(getHerb, new RegExp(`class rustic\\.common\\.blocks\\.crops\\.${cls.replace('$', '\\$')} [\\s\\S]*?Herbs\\.${field}:Lrustic/common/items/ItemHerbEdible`), id);
        assert.deepEqual(e.how, { 0: 'break', 1: 'break', 2: 'break', 3: 'break' });
        assert.deepEqual(e.readyMetas, [3]);
        assert.deepEqual(e.break.byMeta[3], { forced: [st(e.block)], rolls: [{ item: st(e.block), times: 2, chance: 4 / 6 }] });
        assert.ok(pack.foodValues(e.block), `${id} is food`);
        assert.equal(!!pack.avoidFood(e.block), id === 'cloudsbluff', id);
        assert.deepEqual(blocks[e.block].states.map((s) => s.props.age), ['0', '1', '2', '3']);
    }
    // The herb item takes the block's registry name and adds no eating effect.
    const item = section('Rustic ItemHerbEdible');
    inOrder(item, 'ItemFood."<init>":(IFZ)V', 'BlockHerbBase.getRegistryName', 'setRegistryName');
    assert.doesNotMatch(item, /func_185070_a|PotionEffect|func_77849_c/);
    const biome = section('Rustic Herbs.getRandomHerbForBiome');
    inOrder(biome, 'Type.JUNGLE', 'MARSH_MALLOW_CROP', 'Type.MOUNTAIN', 'CLOUDSBLUFF_CROP', 'Type.SWAMP', 'MARSH_MALLOW_CROP', 'Type.FOREST', 'GINSENG_CROP');
    assert.doesNotMatch(biome, /CORE_ROOT/);
    const cfg = read('rustic.cfg');
    assert.match(cfg, /S:"Herb Generation Chance"=0\.125/);
    assert.match(cfg, /I:"Max Herb Generation Attempts"=8/);
});

test('HarvestCraft gardens: breaking (not sneaking) gives 2 different items from the pack\'s list', () => {
    const cfg = read('harvestcraft.cfg');
    const g = section('HarvestCraft BlockBaseGarden');
    inOrder(method(g, 'getDrops('), 'Field drops', 'Collections.shuffle', 'gardendropAmount', 'List.size', 'Math.min', 'List.get');
    inOrder(method(g, 'func_180657_a'), 'func_70093_af', 'ifne          44', 'canSilkHarvest', '44:', 'func_180643_i', '134:', 'func_176226_b');
    assert.match(cfg, /I:gardendropAmount=2/);
    for (const [id, key] of [['arid-garden', 'aridGarden'], ['frost-garden', 'frostGarden'], ['shaded-garden', 'shadedGarden'], ['soggy-garden', 'soggyGarden'], ['tropical-garden', 'tropicalGarden'], ['windy-garden', 'windyGarden']]) {
        const e = entry(id);
        assert.match(cfg, new RegExp(`B:enable${e.block.split(':')[1]}Generation=true`), id);
        const list = new RegExp(`S:${key} <([^>]*)>`).exec(cfg)[1].split(/\s+/).filter(Boolean).map((s) => { const [a, b, c] = s.split(':'); return { name: `${a}:${b}`, meta: Number(c ?? 0) }; });
        assert.deepEqual(e.break.byMeta[0].fromList, { distinct: 2, list }, id);
        assert.equal(e.break.notWhileSneaking, true);
        assert.ok(blocks[e.block], id);
    }
    // One listed item does not exist on this pack (unverified: how the slot is filled).
    assert.ok(!pack.isKnown('harvestcraft:juniperitem'));
    assert.ok(data.unverified.some((u) => u.includes('harvestcraft:juniperitem')));
});

test('mushrooms: not food raw; smelting makes them food', () => {
    for (const b of ['minecraft:brown_mushroom', 'minecraft:red_mushroom']) {
        assert.deepEqual(blocks[b].states[0].drops, [{ name: b, meta: 0, count: 1 }]);
        assert.equal(pack.foodValues(b), null);
        const r = pack.forageFood(b);
        assert.deepEqual(r.food, []);
        assert.equal(r.cook.length, 1);
        assert.ok(pack.foodValues(r.cook[0].output.name), r.cook[0].output.name);
        assert.deepEqual(r.cook[0].avoid, pack.avoidFood(r.cook[0].output.name));
    }
    // Better With Addons (in the pinned zip): the baked mushroom is plain food, the baked amanita always poisons.
    const bwa = section('Better With Addons ModItems');
    assert.match(bwa, /String food_mushroom_baked\n[^\n]*ItemFood\n[^\n]*dup\n[^\n]*iconst_3\n[^\n]*float 0\.2f\n[^\n]*iconst_0\n[^\n]*ItemFood\."<init>":\(IFZ\)V\n[^\n]*registerItem/);
    assert.match(bwa, /String food_amanita_baked\n[^\n]*ItemFood\n[^\n]*dup\n[^\n]*iconst_3\n[^\n]*float 0\.2f\n[^\n]*iconst_0\n[^\n]*ItemFood\."<init>":\(IFZ\)V\n[^\n]*PotionEffect\n[^\n]*dup\n[^\n]*MobEffects\.field_76436_u[^\n]*\n[^\n]*bipush +100\n[^\n]*iconst_0\n[^\n]*PotionEffect\."<init>"[^\n]*\n[^\n]*fconst_1\n[^\n]*func_185070_a/);
    assert.deepEqual(pack.avoidFood('betterwithaddons:food_amanita_baked').effects, [{ effect: 'poison', seconds: 100 / 20, level: 0 + 1, chance: 1 }]);
    assert.equal(pack.avoidFood('betterwithaddons:food_mushroom_baked'), null);
    assert.ok(pack.forageFood('minecraft:red_mushroom').cook[0].avoid);
    assert.equal(pack.forageFood('minecraft:brown_mushroom').cook[0].avoid, null);
    const mods = JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/manifest.json'), 'utf8')).mods;
    assert.ok(mods.some((m) => m.id === 'betterwithaddons' && m.version === '0.51'));
});

test('forageFood, forageSources and forageHazard', () => {
    const berried = pack.forageFood('rustic:wildberry_bush', 1);
    assert.deepEqual([berried.how, berried.ready, berried.rightClick.gives], ['right-click', true, [st('rustic:wildberries')]]);
    assert.deepEqual(berried.food.map((f) => [f.name, f.values.hunger, f.avoid]), [['rustic:wildberries', pack.foodValues('rustic:wildberries').hunger, null]]);
    // Breaking a berried bush: 1 berry for sure, 35/26 sticks; a bare one: 10/56 berries.
    assert.deepEqual(berried.break.drops.find((d) => d.name === 'rustic:wildberries'), { name: 'rustic:wildberries', meta: 0, mean: 1, max: 1 });
    assert.equal(berried.break.drops.find((d) => d.name === 'minecraft:stick').mean, Math.round((35 / 26) * 10000) / 10000);
    const bare = pack.forageFood('rustic:wildberry_bush:0');
    assert.deepEqual([bare.how, bare.ready, bare.rightClick], ['wait', false, null]);
    assert.equal(bare.break.drops.find((d) => d.name === 'rustic:wildberries').mean, Math.round((10 / 56) * 10000) / 10000);
    // A mineflayer block object works too.
    assert.deepEqual(pack.forageFood({ name: 'rustic:wildberry_bush', metadata: 1 }), berried);
    const haw = pack.forageFood('biomesoplenty:plant_0', 5);
    assert.equal(haw.how, 'break');
    assert.ok(haw.rightClick.harm);
    assert.deepEqual(haw.hazards.map((h) => h.id), ['hawthorn']);
    assert.equal(pack.forageFood('biomesoplenty:plant_0'), null); // meta 0 is short grass
    assert.equal(pack.forageFood('biomesoplenty:plant_0', 4), null); // poison ivy is no food ...
    assert.deepEqual(pack.forageHazard('biomesoplenty:plant_0', 4).map((h) => h.id), ['poison-ivy']); // ... but a hazard
    assert.deepEqual(pack.forageHazard('biomesoplenty:plant_1:6').map((h) => h.id), ['thorns']);
    assert.equal(pack.forageHazard('minecraft:dirt'), null);
    assert.equal(pack.forageFood('minecraft:dirt'), null);
    const ginseng = pack.forageFood('rustic:ginseng', 3);
    assert.deepEqual(ginseng.break.drops, [{ name: 'rustic:ginseng', meta: 0, mean: Math.round((1 + 2 * 4 / 6) * 10000) / 10000, max: 3 }]);
    // A young herb: breaking is possible ('break') but wasteful; ready says to leave it.
    const young = pack.forageFood('rustic:ginseng', 0);
    assert.deepEqual([young.how, young.ready, young.break.drops[0].mean], ['break', false, 1]);
    assert.ok(!pack.forageSources().find((x) => x.id === 'ginseng').readyMetas.includes(0));
    const garden = pack.forageFood('harvestcraft:windygarden');
    assert.equal(garden.break.notWhileSneaking, true);
    assert.ok(garden.food.some((f) => f.name === 'minecraft:carrot'));
    assert.ok(garden.food.every((f) => pack.foodValues(f.name, f.meta)));
    // Sources: no cloudsbluff (avoidFood) and no mushrooms unless asked.
    const ids = pack.forageSources().map((s) => s.id);
    assert.equal(ids[0], 'wildberry-bush');
    assert.ok(!ids.includes('cloudsbluff') && !ids.includes('brown-mushroom'));
    assert.ok(pack.forageSources({ includeAvoided: true }).some((s) => s.id === 'cloudsbluff'));
    assert.ok(pack.forageSources({ includeNotFood: true }).some((s) => s.id === 'brown-mushroom'));
    for (const s of pack.forageSources({ includeAvoided: true, includeNotFood: true })) {
        assert.ok(blocks[s.block], s.block);
        for (const m of s.metas) assert.ok(blocks[s.block].states.some((x) => x.meta === m), `${s.block}:${m}`);
    }
});

test('sources: jar and file hashes match the fixtures', () => {
    for (const k of ['rustic', 'biomesOPlenty', 'harvestCraft', 'dropt', 'athenaeum', 'craftTweaker']) {
        assert.match(javap.slice(0, 2000), new RegExp(`${data.sources[k].file.split('/').pop().replace(/[.()']/g, '.')}\\s+${data.sources[k].sha256}`), k);
    }
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(FIX, f))).digest('hex');
    for (const [f, file] of [['dropt.zs', 'scripts/dropt.zs'], ['rustic.cfg', 'config/rustic.cfg'], ['harvestcraft.cfg', 'config/harvestcraft.cfg']]) {
        assert.ok(data.sources.files.includes(`${file} (SHA-256 ${sha(f)})`), f);
    }
    assert.match(read('events.zs.excerpt.txt'), new RegExp(data.sources.files.find((f) => f.startsWith('scripts/events.zs')).match(/[0-9a-f]{64}/)[0]));
});
