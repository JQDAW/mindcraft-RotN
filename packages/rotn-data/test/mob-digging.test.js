// Digging mobs (lead task from G3 smoke round 9 B, 2026-11-07): mob-digging.json and src/digging.js
// against the pack's configs and the javap excerpts in fixtures/mob-digging-3.3.4/ (copies of
// config/esm/entity_ai.json, config/esmtweaks.cfg and config/tool_progression/block_overwrites.cfg
// from the pinned pack zip, and bytecode excerpts; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/mob-digging-3.3.4');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');
const pack = loadRotnData('3.3.4');
const data = pack.mobDiggingData;
const blocks = pack.dump.blocks.blocks;
const javap = read('mob-digging.javap.txt');
const section = (title) => {
    const i = javap.indexOf(`\n## ${title}\n`);
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

test('diggers: every entity_ai.json entry with Digging true; Requires Tools only where the entry says true', () => {
    const ai = JSON.parse(read('entity_ai.json'));
    const expected = {};
    for (const [name, e] of Object.entries(ai.entities)) if (e.Digging === true) expected[name] = { requiresTools: e['Requires Tools'] === true };
    assert.deepEqual(data.diggers, expected);
    assert.equal(Object.keys(expected).length, 56);
    const without = Object.entries(data.diggers).filter(([, d]) => !d.requiresTools).map(([n]) => n);
    assert.equal(without.length, 16);
    for (const n of ['minecraft:silverfish', 'minecraft:polar_bear', 'betteranimalsplus:brownbear', 'twilightforest:troll', 'netherex:wight']) assert.ok(without.includes(n), n);
    // The default block says true and has a blacklist, but no digger reads it: each has its own entry.
    assert.equal(ai.default['Requires Tools'], true);
    assert.equal(ai.default.Digging, false);
    assert.ok(ai.default['Digging Blacklist'].length > 0);
    for (const name of Object.keys(data.diggers)) assert.equal(ai.entities[name]['Digging Blacklist'], undefined, name);
    assert.equal(data.settings.blacklistApplies, false);
});

test('ESM reads only the mob\'s own entry, and a missing boolean is false', () => {
    const cfg = section('ESM EsmJsonConfig');
    // The default block is stored under the key null; get() falls back to it only when the mob has no entry.
    assert.match(method(cfg, 'public void readJson('), /aconst_null\n\s+\d+: aload_1\n\s+\d+: ldc +#\d+ +\/\/ String default/);
    assert.match(method(cfg, 'public com.google.gson.JsonObject get(net.minecraft.util.ResourceLocation);'), /ifnull[\s\S]*aconst_null\n\s+\d+: invokeinterface #\d+, +2 +\/\/ InterfaceMethod java\/util\/Map\.get/);
    // Each entity entry is stored as written (a deep copy), with no merge.
    const entry = method(cfg, 'lambda$readJson$1');
    assert.match(entry, /deepJsonCopy/);
    assert.doesNotMatch(entry, /entrySet|has:|addProperty/);
    // CfgProperty.get reads that one object; CfgPropBoolean's getter passes false as the default.
    assert.match(method(section('ESM CfgProperty'), 'public T get(net.minecraft.util.ResourceLocation, java.lang.String);'), /EsmJsonConfig\.get:[\s\S]*funcGet/);
    assert.match(method(section('ESM CfgPropBoolean'), 'lambda$new$0'), /iconst_0\n\s+3: invokestatic +#\d+ +\/\/ Method funwayguy\/epicsiegemod\/config\/JsonHelper\.getBoolean/);
    assert.match(section('ESM JsonHelper'), /JsonObject\.get:/);
    // The digging properties and their code defaults.
    const props = section('ESM CfgProps (static init, digging properties only)');
    inOrder(props, 'String Requires Tools', 'iconst_1', 'putstatic', 'DIG_TOOLS');
    assert.match(section('ESM ConfigHandler.initConfigs (entity_ai.json lines)'), /config\/esm\/entity_ai\.json[\s\S]*readJson[\s\S]*writeJson/);
});

test('settings match config/esmtweaks.cfg and the bytecode', () => {
    const cfg = read('esmtweaks.cfg');
    const flag = (k) => cfg.match(new RegExp(`^\\s*[BI]:${k}=(\\S+)$`, 'm'))?.[1];
    assert.equal(String(data.settings.tweakedAI), flag('useTweakedAI'));
    assert.equal(String(data.settings.mustHaveCorrectTool), flag('mustHaveCorrectTool'));
    assert.equal(String(data.settings.checkBothHands), flag('checkBothHands'));
    assert.equal(String(data.settings.legacyHarvestCheck), flag('legacyHarvestCheck'));
    assert.equal(String(data.settings.extraPickaxeOnSpawn), flag('shouldGetExtraTool'));
    assert.equal(String(data.settings.searchBlockInterval), flag('searchBlockInterval'));
    assert.equal(String(data.settings.harvestCheckInterval), flag('harvestCheckInterval'));
    // ESM-Tweaks replaces ESM's digger when useTweakedAI is on, at task priority 4, for Digging mobs.
    inOrder(section('ESM-Tweaks CommonProxy'), 'AdditionDigger', 'ModConfig$AI$Digging.useTweakedAI', 'DiggingAITaskAddition."<init>"');
    const add = section('ESM-Tweaks DiggingAITaskAddition');
    assert.match(method(add, 'getTaskPriority'), /iconst_4/);
    assert.match(method(add, 'isValid'), /CfgProps\.DIGGING/);
    assert.match(method(add, 'getAdditionalAI'), /AltEntityAIDigging/);
    // Reach 2 (getNextBlock(target, 2.0)), keep the block within 4 (distance squared 16).
    const ai = section('ESM-Tweaks AltEntityAIDigging');
    const should = method(ai, 'public boolean func_75250_a();');
    assert.match(should, /PathNavigate\.func_75500_f/); // noPath
    assert.match(should, /double 16\.0d/);
    assert.match(should, /double 2\.0d\n\s+\d+: invokevirtual +#\d+ +\/\/ Method getNextBlock/);
    assert.equal(data.settings.reach, 2);
    assert.equal(data.settings.keepWithin, 4);
    // Dig speed: / 30 when it can harvest, else / 100.
    const strength = method(section('ESM-Tweaks HarvestUtil'), 'getBlockStrength');
    assert.match(strength, /float 30\.0f[\s\S]*float 100\.0f/);
    assert.deepEqual(data.settings.ticksPerHardness, { noToolNeeded: 30, toolNeededButMissing: 100 });
});

test('canHarvest: unbreakable, blacklist, solid material, Requires Tools, then the correct tool', () => {
    const can = method(section('ESM-Tweaks AltEntityAIDigging'), 'public boolean canHarvest(');
    inOrder(can, 'legacyHarvestCheck', 'HarvestUtil.isBlockUnbreakable', 'CfgProps.DIG_BL:', 'Material.func_76220_a', 'CfgProps.DIG_TOOLS', 'mustHaveCorrectTool', 'Method canHarvestBlock');
    const hands = method(section('ESM-Tweaks AltEntityAIDigging'), 'public boolean canHarvestBlock(');
    inOrder(hands, 'MAIN_HAND', 'canBreakWithItem', 'checkBothHands', 'OFF_HAND', 'canBreakWithItem');
    const util = section('ESM-Tweaks HarvestUtil');
    inOrder(method(util, 'canBreakBlockByHand'), 'func_185887_b', 'ToolProgression.isLoaded', 'BlockOverwrite.toolRequired', 'Material.func_76229_l', 'getHarvestTool', 'String null');
    inOrder(method(util, 'canBreakWithItem'), 'canBreakBlockByHand', 'getHarvestTool', 'getHarvestLevel', 'getToolClasses', 'String.equals', 'if_icmplt');
});

test('Tool Progression exceptions: recomputed from block_overwrites.cfg and the dump', () => {
    const cfg = read('block_overwrites.cfg');
    const blockSec = cfg.slice(cfg.indexOf('\nblock {'), cfg.indexOf('\noredict {'));
    const oreSec = cfg.slice(cfg.indexOf('\noredict {'));
    // createFromConfigString: '?' = toolRequired false; parseBlockCategory: meta '*' = 0-15, a meta is required.
    assert.match(section('ToolProgression BlockHelper'), /\(\?<effective>\\\?\)\?/);
    assert.match(method(section('ToolProgression BlockOverwriteConfig'), 'parseBlockCategory'), /\[\\d\\\*\]\{1,2\}/);
    const parse = (val) => /^(?<force>!)?(?<eff>\?)?(?<tool>[^?=]+)=(?<lvl>-?\d+)(@(?<h>.+))?$/.exec(val.trim());
    const ow = new Map();
    for (const m of blockSec.matchAll(/^\s*S:"([^"]+)"=(.*)$/gm)) {
        const k = /^([^:]+):([^:]+):([\d*]{1,2})$/.exec(m[1]);
        const v = parse(m[2]);
        if (!k || !v || (v.groups.force && v.groups.eff)) continue;
        for (const meta of k[3] === '*' ? [...Array(16).keys()] : [Number(k[3])]) ow.set(`${k[1]}:${k[2]}:${meta}`, !v.groups.eff);
    }
    const byHand = [], needsTool = [];
    for (const [name, b] of Object.entries(blocks)) {
        for (const s of b.states) {
            const key = `${name}:${s.meta}`;
            if (!ow.has(key)) continue;
            const toolNull = s.harvestTool == null || s.harvestTool === 'null';
            const material = !s.toolRequired || toolNull, overwrite = !ow.get(key) || toolNull;
            if (material !== overwrite) (overwrite ? byHand : needsTool).push(key);
        }
    }
    assert.deepEqual(data.toolProgressionExceptions.byHand, byHand.sort());
    assert.deepEqual(data.toolProgressionExceptions.needsTool, needsTool.sort());
    // The oreDict section changes no by-hand answer (an item meta, or every state for the wildcard 32767).
    const ores = pack.dump.oredict?.ores ?? JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/oredict.json'), 'utf8')).ores;
    const exceptional = new Set([...byHand, ...needsTool]);
    for (const m of oreSec.matchAll(/S:"ore:([^"]+)"=(.*)$/gm)) {
        const required = !parse(m[2]).groups.eff;
        for (const it of ores[m[1]] ?? []) {
            const b = blocks[it.name];
            for (const s of (b?.states ?? []).filter((x) => it.meta === 32767 || x.meta === it.meta)) {
                const toolNull = s.harvestTool == null || s.harvestTool === 'null';
                assert.equal(!s.toolRequired || toolNull, !required || toolNull, `ore:${m[1]} ${it.name}:${s.meta}`);
                assert.ok(!exceptional.has(`${it.name}:${s.meta}`));
            }
        }
    }
});

test('canMobDig: a zombie digs dirt and wood by hand, not stone or cobblestone without a pickaxe', () => {
    const z = (block, opts) => pack.canMobDig('minecraft:zombie', block, opts);
    for (const b of ['minecraft:dirt', 'minecraft:grass', 'minecraft:sand', 'minecraft:gravel', 'minecraft:planks', 'minecraft:log', 'minecraft:glass', 'minecraft:leaves']) {
        const r = z(b);
        assert.equal(r.canDig, true, b);
        assert.equal(r.byHand, true, b);
    }
    assert.equal(z('minecraft:dirt').ticksByHand, 15);
    assert.equal(z('minecraft:planks').ticksByHand, 60);
    for (const b of ['minecraft:stone', 'minecraft:cobblestone', 'minecraft:mossy_cobblestone']) {
        const r = z(b);
        assert.equal(r.canDig, false, b);
        assert.deepEqual(r.needs, { type: 'pickaxe', minLevel: 0 }, b);
        assert.equal(z(b, { held: [{ type: 'pickaxe', level: 0 }] }).canDig, true, `${b} with a pickaxe`);
        assert.equal(z(b, { held: [{ type: 'shovel', level: 3 }] }).canDig, false, `${b} with a shovel`);
    }
    assert.deepEqual(z('minecraft:stonebrick').needs, { type: 'pickaxe', minLevel: 1 });
    assert.equal(z('minecraft:stonebrick', { held: [{ type: 'pickaxe', level: 0 }] }).canDig, false);
    // A Tool Progression exception: a wooden-material block that needs a pickaxe.
    assert.equal(z('malisisdoors:garage_door').canDig, false);
    // Unbreakable and non-solid blocks: no mob digs them.
    assert.equal(z('minecraft:barrier').reason, 'unbreakable');
    assert.equal(z('minecraft:tallgrass').reason, 'not solid');
    // The tool rule agrees with Tool Progression's own generated record for these blocks.
    for (const line of read('blocks.cfg.excerpt.txt').split('\n').filter((l) => /S:"/.test(l))) {
        const [, name, meta, val] = /S:"([^"]+):(\d+)"=(\S+)/.exec(line);
        assert.equal(z(name, { meta: Number(meta) }).byHand, val.startsWith('?'), line);
    }
});

test('canMobDig: mobs without Requires Tools dig stone and cobblestone by hand, slowly', () => {
    for (const mob of ['betteranimalsplus:brownbear', 'minecraft:silverfish', 'twilightforest:troll']) {
        const stone = pack.canMobDig(mob, 'minecraft:stone');
        assert.equal(stone.canDig, true, mob);
        assert.equal(stone.ticksByHand, 150, mob);
        assert.equal(pack.canMobDig(mob, 'minecraft:cobblestone').ticksByHand, 200, mob);
        assert.equal(pack.canMobDig(mob, 'minecraft:stonebrick').ticksByHand, 2750, mob);
        assert.equal(pack.canMobDig(mob, 'minecraft:barrier').canDig, false, mob);
    }
    // Not a digger: no answer.
    assert.equal(pack.canMobDig('minecraft:skeleton', 'minecraft:dirt'), null);
    assert.equal(pack.mobDigging('minecraft:skeleton'), null);
    assert.equal(pack.mobDigging('minecraft:zombie').requiresTools, true);
    assert.equal(pack.mobDigging('minecraft:polar_bear').requiresTools, false);
    assert.equal(pack.canMobDig('minecraft:zombie', 'no_such:block'), null);
});

test('sources name the ESM-Tweaks download (not in the pinned zip) and the jar hashes', () => {
    assert.match(data.sources.esmTweaks.from, /NOT in the pinned zip/);
    assert.match(data.sources.esmTweaks.from, /mod-director/);
    assert.match(javap, new RegExp(data.sources.esmTweaks.sha256));
    assert.match(javap, new RegExp(data.sources.epicSiegeMod.sha256));
    assert.match(javap, new RegExp(data.sources.toolProgression.sha256));
    // The dump's mod list has ESM-Tweaks 0.4.5 (the downloaded jar's version).
    const mods = JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/manifest.json'), 'utf8')).mods;
    assert.ok(mods.some((m) => m.id === 'esmtweaks' && m.version === '0.4.5'));
    assert.ok(mods.some((m) => m.id === 'epicsiegemod' && m.version === '13.169'));
});

test('bedrock: Universal Tweaks makes it hardness 200 for every digger; its tool whitelist is a player-click check only', () => {
    const ut = read('universaltweaks-bedrock.javap.txt');
    const utSection = (title) => {
        const i = ut.indexOf(`\n## ${title}`);
        assert.ok(i >= 0, `fixture section ${title}`);
        return ut.slice(i + 1).split(/\n## /)[0];
    };
    assert.match(ut, new RegExp(data.sources.universalTweaks.sha256));
    assert.ok(data.sources.configs.some((c) => c.startsWith('config/Universal Tweaks - Tweaks.cfg')));
    // The mixin redirects the 7th registerBlock(int, String, Block) call in Block.registerBlocks to a rock block, hardness 200.
    const mixin = utSection('UTBreakableBedrockMixin');
    assert.match(mixin, /Lnet\/minecraft\/block\/Block;registerBlock\(ILjava\/lang\/String;Lnet\/minecraft\/block\/Block;\)V/);
    assert.match(mixin, /#19 = Utf8 +registerBlocks/);
    assert.match(mixin, /#26 = Integer +6\n/);
    assert.match(mixin, /#17\(#18=\[s#19\],#20=@#21\(#7=s#22,#23=s#24,#25=I#26\)\)/); // @Redirect(method, @At(INVOKE, target, ordinal))
    inOrder(mixin, 'Material.field_151576_e', 'float 200.0f', 'func_149711_c', 'float 6000000.0f', 'func_149752_b', 'Block.func_176219_a');
    assert.match(utSection('universaltweaks.refmap.json'), /"registerBlocks": "Lnet\/minecraft\/block\/Block;func_149671_p\(\)V"/);
    // The server queues that mixin config only when the toggle is on; the code default is off, the pack turns it on.
    const plugin = utSection('UTLoadingPlugin.shouldMixinConfigQueue');
    inOrder(plugin, 'Field isClient:Z', 'ifeq          1176', '1176:', 'String mixins.tweaks.blocks.breakablebedrock.json', 'bipush        30',
        'tableswitch', '30: 3623', '3623:', 'BREAKABLE_BEDROCK', 'utBreakableBedrockToggle:Z', 'ireturn');
    const cat = utSection('UTConfigTweaks$BlocksCategory$BreakableBedrockCategory');
    inOrder(cat, '[1] Breakable Bedrock Toggle', '[2] Tool List', '[3] List Mode');
    inOrder(cat, 'iconst_0', 'utBreakableBedrockToggle:Z', 'EnumLists.BLACKLIST', 'utBreakableBedrockToolListMode');
    const cfg = utSection('config/Universal Tweaks - Tweaks.cfg');
    assert.match(cfg, /B:"\[1\] Breakable Bedrock Toggle"=true/);
    assert.match(cfg, /S:"\[2\] Tool List" <\n\s+twilightforest:fiery_pickaxe\n\s+>/);
    assert.match(cfg, /S:"\[3\] List Mode"=WHITELIST/);
    // The tool list is checked only on a player's LeftClickBlock event; mobs dig with World.destroyBlock.
    const click = utSection('UTBreakableBedrock.utMineBedrock');
    assert.match(click, /public static void utMineBedrock\(net\.minecraftforge\.event\.entity\.player\.PlayerInteractEvent\$LeftClickBlock\);/);
    assert.match(click, /#121 = Utf8 +Lnet\/minecraftforge\/fml\/common\/eventhandler\/SubscribeEvent;[\s\S]*RuntimeVisibleAnnotations:\n\s+0: #121\(\)/);
    inOrder(click, 'utBreakableBedrockToggle', 'func_184614_ca', 'EnumLists.WHITELIST', 'List.contains', 'Blocks.field_150357_h', 'setCanceled');
    inOrder(method(section('ESM-Tweaks AltEntityAIDigging'), 'public void func_75246_d();'), 'getBlockStrength', 'World.func_175655_b');
    assert.match(method(section('ESM-Tweaks HarvestUtil'), 'isBlockUnbreakable'), /fconst_0\n\s+\d+: fcmpg\n\s+\d+: ifge/);
    // The dump agrees: bedrock is the only hardness-200 block; rock, no harvest tool, resistance 6000000 (x 3 / 5).
    const b = blocks['minecraft:bedrock'].states[0];
    assert.deepEqual([b.hardness, b.material, b.harvestTool, b.toolRequired, b.explosionResistance], [200, 'rock', null, true, 6000000 * 3 / 5]);
    assert.deepEqual(Object.keys(blocks).filter((k) => blocks[k].states.some((s) => s.hardness === 200)), ['minecraft:bedrock']);
    // So any digger digs it by hand, at the 100 rate (rock needs a tool): about 20000 ticks.
    for (const mob of ['minecraft:zombie', 'betteranimalsplus:brownbear']) {
        const r = pack.canMobDig(mob, 'minecraft:bedrock');
        assert.equal(r.canDig, true, mob);
        assert.equal(r.byHand, true, mob);
        assert.equal(r.ticksByHand, 20000, mob);
    }
    assert.ok(data.evidence.some((e) => e.startsWith('Bedrock is breakable (Universal Tweaks 1.9.0')));
    assert.ok(!data.unverified.some((u) => /bedrock/i.test(u)));
});

test('hardness 0: ESM-Tweaks never finishes the dig, so canMobDig says no; ticksByHand comes after the checks', () => {
    const strength = method(section('ESM-Tweaks HarvestUtil'), 'getBlockStrength');
    assert.match(strength, /func_185887_b[^\n]*\n\s+\d+: fstore +5\n\s+\d+: fload +5\n\s+\d+: fconst_0\n\s+\d+: fcmpg\n\s+\d+: ifgt +32\n\s+30: fconst_0\n\s+31: freturn/);
    assert.match(method(section('ESM-Tweaks AltEntityAIDigging'), 'public void func_75246_d();'), /getBlockStrength[^\n]*\n[^\n]*\n[^\n]*digTick:I\n[^\n]*i2f\n[^\n]*fconst_1\n[^\n]*fadd\n[^\n]*fmul/);
    for (const mob of ['minecraft:zombie', 'betteranimalsplus:brownbear']) {
        const r = pack.canMobDig(mob, 'minecraft:tnt');
        assert.deepEqual(r, { canDig: false, byHand: false, needs: null, ticksByHand: null, reason: 'hardness 0: the dig never finishes' }, mob);
    }
    // The unverified note counts the dump's solid hardness-0 states.
    let n = 0;
    for (const b of Object.values(blocks)) for (const s of b.states) if (s.hardness === 0 && (s.solid || s.material === 'web')) n++;
    assert.ok(data.unverified.some((u) => u.startsWith(`The dump records hardness 0 for ${n} solid states`)), String(n));
    // No answer depends on ticksByHand being computed for a block the mob cannot dig.
    assert.equal(pack.canMobDig('minecraft:zombie', 'minecraft:barrier').ticksByHand, null);
});
