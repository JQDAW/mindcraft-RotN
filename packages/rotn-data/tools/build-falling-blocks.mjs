// Builds 3.3.4/falling-blocks.json: which dumped blocks fall (gravity), from the pinned pack's bytecode.
//
// The dump records each block's own class only (blocks.json `class`), not its superclasses.
// This tool reads the class files in the pinned server pack zip (the mods' jars, Forge's jar
// and minecraft_server.1.12.2.jar), follows each dumped block class's superclass chain, and
// marks a block as falling when the chain reaches net.minecraft.block.BlockFalling, the class
// whose onBlockAdded / neighborChanged / updateTick spawn an EntityFallingBlock.
// The vanilla server jar is obfuscated; its class and method names are mapped with Forge's own
// notch-to-SRG table (deobfuscation_data-1.12.2.lzma in the Forge jar; 1.12 SRG class names
// are the MCP names the dump reports). Nothing is executed: the class files are parsed as data.
//
// Blocks that do not extend BlockFalling but whose class (or a superclass below
// net.minecraft.block.Block) names EntityFallingBlock or a subclass of it may make their own
// falling entity. Each is decided, never guessed: by REVIEWED (a hand review of the class's
// bytecode, cited), or by a mod rule read from the pack (Ore Stone Variants: the background
// block and config/osv.cfg bgImitation; ContentTweaker: the scripts' gravity property).
// Anything left goes to `unreviewed`, which the tests require to be empty.
// `overridesFall` lists falling blocks whose own class overrides one of the three methods that
// start a fall, so the fall may be conditional (e.g. concrete powder hardens next to water);
// those overrides are listed, not reviewed.
// Not reflected: coremod or mixin changes to gravity, and blocks that fall through a helper
// class (the reference must be in the block's own class chain).
//
// Usage: node packages/rotn-data/tools/build-falling-blocks.mjs --pack <server-pack.zip> [--check]
//   needs `xz` on PATH (for the Forge jar's LZMA table); --check compares with the committed file.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../3.3.4/falling-blocks.json');
const PACK_SHA256 = '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205';
const SERVER_JAR = 'minecraft_server.1.12.2.jar';
const FORGE_JAR = 'forge-1.12.2-14.23.5.2860.jar';
const SRG_ENTRY = 'deobfuscation_data-1.12.2.lzma';
const FALLING = 'net/minecraft/block/BlockFalling';
const FALLING_ENTITY = 'net/minecraft/entity/item/EntityFallingBlock';
const BLOCK = 'net/minecraft/block/Block';
// BlockFalling's methods that start a fall (SRG names, from the same table:
// onBlockAdded, neighborChanged, updateTick). checkFallable (func_176503_e) is private.
const FALL_METHODS = { func_176213_c: 'onBlockAdded', func_189540_a: 'neighborChanged', func_180650_b: 'updateTick' };

const OSV_CFG = 'config/osv.cfg';
const OSV_VARIANT = 'com/personthecat/orestonevariants/blocks/BaseOreVariant';
const COT_BLOCK = 'com/teamacronymcoders/contenttweaker/modules/vanilla/blocks/BlockContent';

// Hand review of the block classes that make a falling entity without extending BlockFalling
// (javap -c -p on the pinned pack's jars; bytecode offsets in the evidence). Keyed by class;
// `when`: 'unsupported-below' = falls like sand when the block under it can be fallen through,
// 'loses-support' = falls only when it loses what holds it (hanging or standing),
// 'player-nearby' = falls when a player comes close, 'redstone-powered' = falls when powered.
// Every BlockFalling subclass counts as 'unsupported-below' (its overrides are in overridesFall).
const UB_SAND = (c) => ({
    falls: true, when: 'unsupported-below',
    evidence: `UndergroundBiomesConstructs-1.12-1.3.14.jar: ${c}.updateTick (func_180650_b) calls its private checkFallable, a copy of BlockFalling's: when BlockFalling.canFallThrough (func_185759_i) is true for the block below it spawns an EntityFallingBlock (IgneousSand/IgneousGravel bytecode 8-11 and 64-97; the metamorphic and sedimentary classes have the same one call from updateTick and one new EntityFallingBlock)`,
});
export const REVIEWED = {
    'exterminatorjeff.undergroundbiomes.common.block.IgneousSand': UB_SAND('IgneousSand'),
    'exterminatorjeff.undergroundbiomes.common.block.IgneousGravel': UB_SAND('IgneousGravel'),
    'exterminatorjeff.undergroundbiomes.common.block.MetamorphicSand': UB_SAND('MetamorphicSand'),
    'exterminatorjeff.undergroundbiomes.common.block.MetamorphicGravel': UB_SAND('MetamorphicGravel'),
    'exterminatorjeff.undergroundbiomes.common.block.SedimentarySand': UB_SAND('SedimentarySand'),
    'exterminatorjeff.undergroundbiomes.common.block.SedimentaryGravel': UB_SAND('SedimentaryGravel'),
    'alsender.earthworks.block.Block_Gabion_Falling': {
        falls: true, when: 'unsupported-below',
        evidence: 'Earthworks-1.12-1.3.6.jar: Block_Gabion_Falling.updateTick (func_180650_b, bytecode 4) calls its private fall(), which spawns an EntityFallingBlock (40-73) when Block.isAir is true for the position it checks (26-29)',
    },
    'vazkii.quark.decoration.block.BlockCandle': {
        falls: true, when: 'unsupported-below',
        evidence: 'QuarkRotN-r1.6-190.jar: BlockCandle.updateTick (func_180650_b, bytecode 16) calls its private checkFallable: World.isAirBlock (func_175623_d) or BlockFalling.canFallThrough below (5-22), then a new EntityFallingBlock (72-105)',
    },
    'com.codetaylor.mc.pyrotech.modules.tech.bloomery.block.BlockBloom': {
        falls: true, when: 'unsupported-below',
        evidence: 'pyrotech-1.12.2-1.5.25.jar: BlockBloom.updateTick (func_180650_b, bytecode 11) calls its private checkFall: World.isAirBlock or BlockFalling.canFallThrough below (5-22), then an EntityFallingBlock carrying the tile entity NBT (field_145810_d, 134)',
    },
    'net.minecraft.block.BlockDragonEgg': {
        falls: true, when: 'unsupported-below',
        evidence: 'minecraft_server.1.12.2.jar: BlockDragonEgg (aqc) checkFall (aqc.b(amu, et) = func_180683_d) makes an EntityFallingBlock (ack, bytecode 121); vanilla: the egg falls like sand (and teleports when hit)',
    },
    'svenhjol.charm.crafting.block.BlockLantern': {
        falls: true, when: 'loses-support',
        evidence: 'Charm-1.12.2-1.4.1.jar: BlockLantern.updateTick (func_180650_b, bytecode 9) calls its private checkFallable, which returns early while the lantern can stay (the HANGING property with canPlaceBelow / canPlaceAbove, 5-47) and otherwise falls like sand (isAirBlock / BlockFalling.canFallThrough 53-70, new EntityFallingBlock 127)',
    },
    'betterwithaddons.block.BlockChandelier': {
        falls: true, when: 'loses-support',
        evidence: 'Better With Addons-0.51.jar: BlockChandelier.updateTick (func_180650_b, bytecode 3) and neighborChanged (func_189540_a, 14) call checkAndDrop, which spawns an EntityFallingBlock (43-76) on the server when canBlockStay is false (10-13)',
    },
    'com.ferreusveritas.dynamictreesphc.blocks.BlockPamFruit': {
        falls: true, when: 'player-nearby',
        evidence: 'DynamicTreesPHC-1.12.2-2.0.6.jar: BlockPamFruit.updateTick (func_180650_b, bytecode 53) and neighborChanged (func_189540_a, 48) call its private blockFall, which returns when distanceFromPlayerToFall is 0, needs a player within that distance unless it is -1 (World.getClosestPlayer, 9-43), and the block below to be air (World.isAirBlock, 49-52); it then spawns BlockPamFruit$1, an EntityFallingBlock subclass (113-144). The pack: config/dynamictreesphc.cfg line 5 S:fallingFruitFallChance=10, whose comment (line 4) describes it as that distance (default 10; 0 disables). Which field the key loads into was not traced',
    },
    'vazkii.quark.automation.block.BlockGravisand': {
        falls: true, when: 'redstone-powered',
        evidence: 'QuarkRotN-r1.6-190.jar: BlockGravisand.checkRedstone calls World.isBlockPowered (func_175640_z, bytecode 2) before tryFall, which spawns an EntityGravisand (an EntityFallingBlock subclass, 35-73); scripts/jei_descriptions.zs line 417: it "will only fall when activated with redstone" and floats up when it is already on the ground',
    },
    'thedarkcolour.futuremc.block.villagepillage.ScaffoldingBlock': {
        falls: true, when: 'loses-support',
        evidence: 'Future-MC-0.2.21.jar: ScaffoldingBlock.updateTick (func_180650_b) recomputes the DISTANCE and BOTTOM properties (bytecode 25-115) and spawns an EntityFallingBlock (146-175) when the scaffolding is too far from support',
    },
};

// Rules for whole mods whose block class can fall depending on configuration.
const rules = () => ({
    'osv-background': {
        falls: false,
        evidence: [
            'Ore Stone Variants-5.14.jar: BaseOreVariant.initGravity: hasGravity = Cfg$BlocksCat.bgImitation && bgBlock.getBlock() instanceof BlockFalling (bytecode 0-26); updateTick calls checkFallable only when hasGravity (1052-1058). Names: CommonMethods.formatBlock (the background\'s namespace unless minecraft, its path unless stone, its metadata unless 0)',
            'These ore variants sit on a background that is not a BlockFalling subclass (sandstone, dirt, stone, ...), so they do not fall',
        ],
    },
    contenttweaker: {
        falls: false,
        evidence: [
            'ContentTweaker-1.12.2-4.10.0.jar: BlockContent spawns an EntityFallingBlock only when BlockRepresentation.hasGravity() (bytecode 18-124 of its fall check, with BlockFalling.canFallThrough below, 50); BlockRepresentation.<init> sets gravity = false (24-25), a @ZenProperty the scripts set with setGravity(true)',
        ],
    },
});
let RULES = rules();

// ---- zip (stored and deflated entries; no ZIP64: the pack and its jars are below 4 GB) ----

export function zipEntries(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip (no end of central directory)');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 is not supported');
    const out = new Map();
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
        const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        out.set(name, { method, csize, local });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

export function zipRead(buf, e) {
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`zip method ${e.method} not supported`);
}

// ---- class files: this class, superclass, class references, method names ----

export function parseClass(buf) {
    if (buf.readUInt32BE(0) !== 0xcafebabe) throw new Error('not a class file');
    const n = buf.readUInt16BE(8);
    const utf8 = new Array(n), classIdx = new Array(n);
    let p = 10;
    for (let i = 1; i < n; i++) {
        const tag = buf[p];
        switch (tag) {
            case 1: { const len = buf.readUInt16BE(p + 1); utf8[i] = buf.toString('utf8', p + 3, p + 3 + len); p += 3 + len; break; } // modified UTF-8; class names are ASCII
            case 7: classIdx[i] = buf.readUInt16BE(p + 1); p += 3; break;
            case 8: case 16: case 19: case 20: p += 3; break;
            case 15: p += 4; break;
            case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18: p += 5; break;
            case 5: case 6: p += 9; i++; break;
            default: throw new Error(`constant pool tag ${tag}`);
        }
    }
    const cls = (i) => (i ? utf8[classIdx[i]] : null);
    const name = cls(buf.readUInt16BE(p + 2));
    const superName = cls(buf.readUInt16BE(p + 4));
    const refs = new Set(classIdx.filter(Boolean).map((u) => utf8[u]));
    p += 6;
    p += 2 + 2 * buf.readUInt16BE(p); // interfaces
    const skipMembers = (withNames) => {
        const names = [];
        const c = buf.readUInt16BE(p); p += 2;
        for (let i = 0; i < c; i++) {
            if (withNames) names.push(utf8[buf.readUInt16BE(p + 2)] + utf8[buf.readUInt16BE(p + 4)]);
            const ac = buf.readUInt16BE(p + 6); p += 8;
            for (let a = 0; a < ac; a++) p += 6 + buf.readUInt32BE(p + 2);
        }
        return names;
    };
    skipMembers(false);
    const methods = skipMembers(true); // name + descriptor
    return { name, superName, refs, methods };
}

// ---- Forge's notch -> SRG table ----

export function parseSrg(text) {
    const cl = new Map(), md = new Map();
    for (const line of text.split('\n')) {
        const f = line.trim().split(' ');
        if (f[0] === 'CL:') cl.set(f[1], f[2]);
        else if (f[0] === 'MD:') md.set(f[1] + f[2], f[3].slice(f[3].lastIndexOf('/') + 1));
    }
    return { cl, md };
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export function buildFallingBlocks(packPath) {
    RULES = rules();
    const pack = loadRotnData('3.3.4');
    if (!pack.hasDump) throw new Error('no 3.3.4 dump imported');
    const zipBuf = fs.readFileSync(packPath);
    const packSha = sha256(zipBuf);
    if (packSha !== PACK_SHA256) throw new Error(`pack zip SHA-256 ${packSha}, expected the pinned ${PACK_SHA256}`);
    const top = zipEntries(zipBuf);
    const jarNames = [SERVER_JAR, FORGE_JAR, ...[...top.keys()].filter((n) => /^mods\/.+\.jar$/.test(n)).sort()]; // mods/1.12.2/ and mods/memory_repo/ load too

    const forgeBuf = zipRead(zipBuf, top.get(FORGE_JAR));
    const lzma = zipRead(forgeBuf, zipEntries(forgeBuf).get(SRG_ENTRY));
    const srg = parseSrg(execFileSync('xz', ['--format=lzma', '-dc'], { input: lzma, maxBuffer: 64 << 20 }).toString('utf8'));

    // class name (SRG/MCP, slashes) -> { superName, refs, methods (SRG names), jar }
    const classes = new Map();
    const jars = {};
    for (const jar of jarNames) {
        const jb = zipRead(zipBuf, top.get(jar));
        jars[jar] = sha256(jb);
        const obf = jar === SERVER_JAR || jar === FORGE_JAR; // both are notch-named in production; FML maps them at runtime
        const map = (c) => (obf && c ? (srg.cl.get(c) ?? c) : c);
        for (const [n, e] of zipEntries(jb)) {
            if (!n.endsWith('.class')) continue;
            let c;
            try { c = parseClass(zipRead(jb, e)); } catch { continue; }
            const name = map(c.name);
            if (classes.has(name)) continue; // first jar wins (shaded copies come later)
            const methods = obf ? c.methods.map((m) => {
                const i = m.indexOf('(');
                return srg.md.get(c.name + '/' + m.slice(0, i) + m.slice(i)) ?? m.slice(0, i);
            }) : c.methods.map((m) => m.slice(0, m.indexOf('(')));
            classes.set(name, { superName: map(c.superName), refs: new Set([...c.refs].map(map)), methods, jar });
        }
    }

    const chainOf = (cls) => {
        const chain = [];
        for (let c = cls; c && c !== 'java/lang/Object'; c = classes.get(c)?.superName) {
            chain.push(c);
            if (!classes.has(c) || chain.length > 64) return { chain, resolved: false };
        }
        return { chain, resolved: true };
    };
    const dot = (c) => c.replace(/\//g, '.');

    // Falling-entity classes: EntityFallingBlock and every class on the pack that extends it.
    const fallingEntities = new Set([...classes.keys()].filter((c) => chainOf(c).chain.includes(FALLING_ENTITY)));
    // Pack settings the rules read (cited by line).
    const osvCfg = zipRead(zipBuf, top.get(OSV_CFG)).toString('utf8').split(/\r?\n/);
    const osvLine = osvCfg.findIndex((l) => /^\s*B:bgImitation=/.test(l));
    if (osvLine < 0) throw new Error(`${OSV_CFG}: no bgImitation`);
    const bgImitation = /=true\s*$/.test(osvCfg[osvLine]);
    // ContentTweaker blocks with gravity: `var x = VanillaFactory.createBlock("name", ...)` and then
    // `x.setGravity(true)` (or `x.gravity = true`) in the pack's scripts. A gravity line this cannot
    // place stops the build.
    const cotGravity = new Map();
    let gravityLines = 0;
    for (const n of [...top.keys()].filter((k) => /^scripts\/.+\.zs$/.test(k)).sort()) {
        const lines = zipRead(zipBuf, top.get(n)).toString('utf8').split(/\r?\n/);
        const vars = new Map();
        lines.forEach((l, i) => {
            const v = l.match(/^\s*var\s+(\w+)\s*=\s*VanillaFactory\.create\w*\(\s*"([^"]+)"/);
            if (v) vars.set(v[1], v[2]);
            if (!/gravity/i.test(l)) return;
            gravityLines++;
            const g = l.match(/^\s*(\w+)\.(?:setGravity\(\s*(true|false)\s*\)|gravity\s*=\s*(true|false))\s*;/);
            if (!g || !vars.has(g[1])) throw new Error(`${n} line ${i + 1}: a gravity line this tool cannot place: ${l.trim()}`);
            if ((g[2] ?? g[3]) === 'true') cotGravity.set(`contenttweaker:${vars.get(g[1])}`, `${n} line ${i + 1}: ${l.trim()}`);
            else cotGravity.delete(`contenttweaker:${vars.get(g[1])}`);
        });
    }

    const dumped = Object.entries(pack.dump.blocks.blocks).sort(([a], [z]) => a.localeCompare(z));
    const isBlockFalling = new Set(dumped.filter(([, b]) => chainOf((b.class ?? '').replace(/\./g, '/')).chain.includes(FALLING)).map(([n]) => n));
    // OSV registry names: osv:<ore>_<formatBlock(background)> (CommonMethods.formatBlock: the namespace
    // unless minecraft, the path unless stone, the metadata unless 0). Longest match wins.
    const osvKeys = [];
    for (const [n, b] of dumped) {
        const [ns, p] = n.split(':');
        for (const s of b.states ?? [{ meta: 0 }]) {
            const key = [ns === 'minecraft' ? null : ns, p === 'stone' ? null : p, s.meta ? String(s.meta) : null].filter(Boolean).join('_');
            if (key) osvKeys.push([key, n]);
        }
    }
    const osvBackground = (name) => {
        const p = name.slice(name.indexOf(':') + 1);
        let best = null;
        for (const [key, n] of osvKeys) if (p.endsWith('_' + key) && (!best || key.length > best[0].length)) best = [key, n];
        return best?.[1] ?? null;
    };

    const blocks = {}, overridesFall = {}, notFalling = {}, unreviewed = {}, unresolved = [];
    const noFall = (rule, name) => { (notFalling[rule] ??= { ...RULES[rule], blocks: [] }).blocks.push(name); };
    for (const [name, b] of dumped) {
        const cls = (b.class ?? '').replace(/\./g, '/');
        const { chain, resolved } = chainOf(cls);
        const fi = chain.indexOf(FALLING);
        if (fi >= 0) {
            blocks[name] = { via: 'BlockFalling', when: 'unsupported-below', class: b.class, chain: chain.slice(0, fi + 1).map(dot), jar: classes.get(cls).jar };
            const ov = chain.slice(0, fi).flatMap((c) => classes.get(c).methods.filter((m) => FALL_METHODS[m]).map((m) => `${dot(c)}.${FALL_METHODS[m]} (${m})`));
            if (ov.length) overridesFall[name] = [...new Set(ov)];
            continue;
        }
        if (!resolved) { unresolved.push({ name, class: b.class, missing: dot(chain[chain.length - 1]) }); continue; }
        const bi = chain.indexOf(BLOCK);
        const own = bi >= 0 ? chain.slice(0, bi) : chain;
        const refBy = own.filter((c) => [...classes.get(c).refs].some((r) => fallingEntities.has(r)));
        if (!refBy.length) continue;
        const reviewed = own.map(dot).find((c) => REVIEWED[c]);
        if (chain.includes(OSV_VARIANT)) {
            const bg = osvBackground(name);
            if (bgImitation && bg && isBlockFalling.has(bg)) blocks[name] = { via: 'osv-background', when: 'unsupported-below', class: b.class, background: bg, jar: classes.get(OSV_VARIANT).jar };
            else if (bg) noFall('osv-background', name);
            else unreviewed[name] = { class: b.class, refsIn: refBy.map(dot), why: 'OSV background not found' };
        } else if (chain.includes(COT_BLOCK)) {
            if (cotGravity.has(name)) blocks[name] = { via: 'contenttweaker-gravity', class: b.class, when: 'unsupported-below', script: cotGravity.get(name), jar: classes.get(COT_BLOCK).jar };
            else noFall('contenttweaker', name);
        } else if (reviewed) {
            const r = REVIEWED[reviewed];
            if (r.falls) blocks[name] = { via: 'own-code', class: b.class, reviewed, when: r.when, evidence: r.evidence, jar: classes.get(reviewed.replace(/\./g, '/')).jar };
            else noFall(reviewed, name);
        } else {
            unreviewed[name] = { class: b.class, refsIn: refBy.map(dot), jar: classes.get(refBy[0]).jar };
        }
    }
    RULES['osv-background'].evidence.push(`${OSV_CFG} line ${osvLine + 1}: ${osvCfg[osvLine].trim()}`);
    RULES.contenttweaker.evidence.push(`Every line of scripts/**/*.zs that mentions gravity (${gravityLines}) is a setGravity on a VanillaFactory.createBlock variable; these blocks are not among the ${cotGravity.size} it sets true for`);
    const missing = [...cotGravity.keys()].filter((n) => !blocks[n]);
    if (missing.length) throw new Error(`scripts set gravity on blocks that are not dumped ContentTweaker blocks: ${missing.join(', ')}`);
    return {
        about: 'Blocks that fall (gravity) on RotN 3.3.4, from bytecode. `blocks` lists every dumped block that falls: via "BlockFalling" (its class extends net.minecraft.block.BlockFalling), "own-code" (its class makes an EntityFallingBlock itself; reviewed, with the condition in `when`) "contenttweaker-gravity" (a ContentTweaker block a pack script gives gravity, cited by line) or "osv-background" (an Ore Stone Variants ore on a BlockFalling background, with bgImitation on). Any other dumped block does not fall. Built by tools/build-falling-blocks.mjs from the pinned server pack zip; see that file for the method and what is not reflected.',
        source: {
            packZipSha256: packSha,
            srg: `${FORGE_JAR}!/${SRG_ENTRY} (notch to SRG; maps ${SERVER_JAR} and ${FORGE_JAR})`,
            jars: { [SERVER_JAR]: jars[SERVER_JAR], [FORGE_JAR]: jars[FORGE_JAR] },
            modJars: jarNames.length - 2,
            classesRead: classes.size,
            dump: pack.dump.manifest?.dumpedAt ?? pack.dump.manifest?.created ?? null,
        },
        fallMethods: FALL_METHODS,
        fallingEntityClasses: [...fallingEntities].sort().map(dot),
        blocks,
        overridesFall,
        notFalling,
        unreviewed,
        unresolved,
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const a = process.argv.slice(2);
    const packPath = a[a.indexOf('--pack') + 1];
    if (!a.includes('--pack') || !packPath) { console.error('usage: build-falling-blocks.mjs --pack <server-pack.zip> [--check]'); process.exit(2); }
    const json = JSON.stringify(buildFallingBlocks(packPath), null, 1) + '\n';
    if (a.includes('--check')) {
        const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') === json;
        console.log(same ? 'falling-blocks.json is up to date' : 'falling-blocks.json differs from a rebuild');
        process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(OUT, json);
    const r = JSON.parse(json);
    const nf = Object.values(r.notFalling).reduce((a, x) => a + x.blocks.length, 0);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(r.blocks).length} falling, ${Object.keys(r.overridesFall).length} override a fall method, ${nf} candidates ruled out, ${Object.keys(r.unreviewed).length} unreviewed, ${r.unresolved.length} unresolved`);
}
