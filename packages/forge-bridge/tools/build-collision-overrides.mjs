// Builds packages/forge-bridge/data/collision-overrides-3.3.4.json: what src/collision.js needs
// beyond rotn-data's per-state playerCollision (#269) to give modded blocks safe shapes (#256, #259 review).
//
// The lead's rule (#259): walk-through is opt-in. A state the dump gives no box becomes walk-through
// only if its block is in a reviewed harmless class (plants, flowers, grass, saplings, crops, rock
// piles, ...); every other state with no box stays a solid full cube. Separately, modded fluids are
// marked liquid and trap, fire, portal, web and lava blocks get a hazard kind.
//
// What it reads (the pinned server pack zip only; no mod code is run):
// - every class in the vanilla server jar (mapped with Forge's notch-to-SRG table), the Forge jar
//   and every mod jar: superclass, interfaces, declared methods and the member names it references;
// - config/dynamictrees.cfg, for the Dynamic Trees leaves box;
// - rotn-data's 3.3.4 dump (blocks.json): class, and per state the material and playerCollision
//   (the boxes addCollisionBoxToList adds for a player, and whether they depend on the neighbours).
// Rules, per dumped modded block (class chain = the block's class up to net.minecraft.block.Block):
// - check, Dynamic Trees leaves: every state of a block whose chain contains BlockDynamicLeaves
//   must give a player the box the jar and the pack's config select (bytecode in
//   test/fixtures/dynamictrees-0.13.4/); the tool fails otherwise. Since #269 the data has that box,
//   so no shape override is written for them.
// - liquid: the chain contains BlockFluidBase or BlockLiquid, or implements IFluidBlock.
// - hazard (every state, or per meta):
//   'portal' (BlockPortal, BlockEndPortal, BlockEndGateway, or material portal),
//   'fire' (BlockFire or material fire), 'web' (BlockWeb or material web), 'lava' (a liquid with
//   material lava: it sets entities on fire), 'trap' (BlockCactus or BlockMagma, or a class in the
//   chain declares onEntityCollidedWithBlock (func_180634_a) or onEntityWalk (func_176199_a) and
//   references attackEntityFrom, addPotionEffect, setFire, setInWeb or an explosion), or a reviewed
//   per-variant entry (REVIEWED).
// - walkThrough: every state (or the reviewed metas) gives a player no box and does not depend on
//   its neighbours (playerCollision), the block is no liquid and no hazard, and either the chain
//   contains a vanilla plant class (PLANT_BASES) or every state's material is plants or vine, or the
//   class is a reviewed rock pile (ROCK_PILES); and no class in the chain declares
//   onEntityCollidedWithBlock, onEntityWalk or addCollisionBoxToList (func_185477_a: the dumper calls
//   it at an empty cell, and a tile entity could change what it adds), unless REVIEWED.
//
// Usage: node packages/forge-bridge/tools/build-collision-overrides.mjs --pack <server pack zip> [--check]
// --check compares with the committed file and exits 1 if they differ.
// Needs `xz` on PATH (Forge's SRG table is LZMA-compressed; Git for Windows ships it).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipEntries, zipRead, parseSrg } from '../../rotn-data/tools/build-falling-blocks.mjs';
import { loadRotnData } from '../../rotn-data/src/catalog.js';
import { DYNAMIC_LEAVES_BOX, HAZARD_KINDS } from '../src/collision.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(HERE, '../data/collision-overrides-3.3.4.json');
const PACK_SHA256 = '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205';
const SERVER_JAR = 'minecraft_server.1.12.2.jar';
const FORGE_JAR = 'forge-1.12.2-14.23.5.2860.jar';
const SRG_ENTRY = 'deobfuscation_data-1.12.2.lzma';
const MC = 'net/minecraft/block/';
const BLOCK = `${MC}Block`;
const DT_LEAVES = 'com/ferreusveritas/dynamictrees/blocks/BlockDynamicLeaves';
const DT_JAR = 'mods/DramaticTrees-1.12.2-0.13.4.jar';
const DT_CFG = 'config/dynamictrees.cfg';
const PASSABLE_LEAVES_MODID = 'passableleaves';

const M = {
    addCollisionBoxToList: 'func_185477_a',
    onEntityCollidedWithBlock: 'func_180634_a',
    onEntityWalk: 'func_176199_a',
};
// Members whose use in a contact method means harm (SRG names, as mod classes reference them).
const HARM_MEMBERS = {
    func_70097_a: 'attackEntityFrom', func_70690_d: 'addPotionEffect', func_70015_d: 'setFire',
    func_70110_aj: 'setInWeb', func_72876_a: 'createExplosion', func_72885_a: 'newExplosion',
};
const FLUID_BASES = ['net/minecraftforge/fluids/BlockFluidBase', `${MC}BlockLiquid`];
const IFLUID = 'net/minecraftforge/fluids/IFluidBlock';
const HAZARD_BASES = {
    [`${MC}BlockPortal`]: 'portal', [`${MC}BlockEndPortal`]: 'portal', [`${MC}BlockEndGateway`]: 'portal',
    [`${MC}BlockFire`]: 'fire', [`${MC}BlockWeb`]: 'web', [`${MC}BlockCactus`]: 'trap', [`${MC}BlockMagma`]: 'trap',
};
const HAZARD_MATERIALS = { portal: 'portal', fire: 'fire', web: 'web' };
const PLANT_BASES = ['BlockBush', 'BlockCrops', 'BlockSapling', 'BlockMushroom', 'BlockReed', 'BlockVine', 'BlockStem',
    'BlockTallGrass', 'BlockDoublePlant', 'BlockFlower', 'BlockDeadBush', 'BlockNetherWart'].map((c) => MC + c);
const PLANT_MATERIALS = new Set(['plants', 'vine']);
// Rock piles: no box in the dump, harvested by hand (rotn-data world-sources.json). Reviewed by class.
const ROCK_PILES = {
    'com/codetaylor/mc/pyrotech/modules/core/block/BlockRock': 'Pyrotech rock piles (pyrotech:rock, the first G3 resource)',
    'com/codetaylor/mc/pyrotech/modules/core/block/BlockRockGrass': 'Pyrotech grass-covered rock piles',
    'com/codetaylor/mc/pyrotech/modules/core/block/BlockRockNetherrack': 'Pyrotech netherrack rock piles',
    'trinsdar/pyrotech_compat/block/rocks/BlockRockBase': 'Pyrotech Compat rock piles (igneous, metamorphic, sedimentary, their sands, netherrack)',
};
// Classes whose contact method harms only some variants (javap -c on the pinned jar, the switch on
// the variant enum resolved through the class's $SwitchMap). The other variants are harmless plants.
const REVIEWED = {
    'biomesoplenty/common/block/BlockBOPPlant': {
        harmful: { poisonivy: 'trap', thorn: 'trap', tinycactus: 'trap' },
        evidence: 'BiomesOPlenty-1.12.2-7.0.1.2445-universal.jar: BlockBOPPlant.onEntityCollidedWithBlock (func_180634_a) switches on the variant (BlockBOPPlant$2): POISONIVY adds poison (MobEffects.field_76436_u, bytecode 116-124), THORN and TINYCACTUS deal cactus damage (DamageSource.field_76367_g, 183-187); every other variant does nothing',
    },
    'biomesoplenty/common/block/BlockBOPFlower': {
        harmful: { deathbloom: 'trap', burning_blossom: 'fire' },
        evidence: 'BiomesOPlenty-1.12.2-7.0.1.2445-universal.jar: BlockBOPFlower.onEntityCollidedWithBlock (func_180634_a) switches on the variant (BlockBOPFlower$1): DEATHBLOOM adds wither (MobEffects.field_82731_v, bytecode 65-74), BURNING_BLOSSOM sets the entity on fire (func_70015_d, 91); every other variant does nothing',
    },
};

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Class file: name, superclass, interfaces, declared methods (name + descriptor), and for each
// method the methods its bytecode invokes ({ owner, name, desc }).
export function parseClassFile(buf) {
    if (buf.readUInt32BE(0) !== 0xcafebabe) throw new Error('not a class file');
    const n = buf.readUInt16BE(8);
    const utf8 = new Array(n), classIdx = new Array(n), memberRef = new Array(n), nat = new Array(n);
    let p = 10;
    for (let i = 1; i < n; i++) {
        const tag = buf[p];
        switch (tag) {
            case 1: { const len = buf.readUInt16BE(p + 1); utf8[i] = buf.toString('utf8', p + 3, p + 3 + len); p += 3 + len; break; }
            case 7: classIdx[i] = buf.readUInt16BE(p + 1); p += 3; break;
            case 10: case 11: memberRef[i] = [buf.readUInt16BE(p + 1), buf.readUInt16BE(p + 3)]; p += 5; break;
            case 12: nat[i] = [buf.readUInt16BE(p + 1), buf.readUInt16BE(p + 3)]; p += 5; break;
            case 8: case 16: case 19: case 20: p += 3; break;
            case 15: p += 4; break;
            case 3: case 4: case 9: case 17: case 18: p += 5; break;
            case 5: case 6: p += 9; i++; break;
            default: throw new Error(`constant pool tag ${tag}`);
        }
    }
    const cls = (i) => (i ? utf8[classIdx[i]] : null);
    const ref = (i) => {
        const r = memberRef[i];
        if (!r || !nat[r[1]]) return null;
        return { owner: cls(r[0]), name: utf8[nat[r[1]][0]], desc: utf8[nat[r[1]][1]] };
    };
    const name = cls(buf.readUInt16BE(p + 2));
    const superName = cls(buf.readUInt16BE(p + 4));
    p += 6;
    const interfaces = [];
    const ic = buf.readUInt16BE(p); p += 2;
    for (let k = 0; k < ic; k++, p += 2) interfaces.push(cls(buf.readUInt16BE(p)));
    const members = (withNames) => {
        const out = [];
        const c = buf.readUInt16BE(p); p += 2;
        for (let i = 0; i < c; i++) {
            const m = { name: utf8[buf.readUInt16BE(p + 2)], desc: utf8[buf.readUInt16BE(p + 4)], invokes: [] };
            const ac = buf.readUInt16BE(p + 6); p += 8;
            for (let a = 0; a < ac; a++) {
                const len = buf.readUInt32BE(p + 2);
                if (withNames && utf8[buf.readUInt16BE(p)] === 'Code') m.invokes = invokesIn(buf.subarray(p + 14, p + 14 + buf.readUInt32BE(p + 10)), ref);
                p += 6 + len;
            }
            if (withNames) out.push(m);
        }
        return out;
    };
    members(false);
    const methods = members(true);
    return { name, superName, interfaces, methods };
}

// The method refs invoked by one method's bytecode (invokevirtual, invokespecial, invokestatic,
// invokeinterface), walking instruction by instruction.
function invokesIn(code, ref) {
    const out = [];
    for (let pc = 0; pc < code.length;) {
        const op = code[pc];
        if (op >= 0xb6 && op <= 0xb9) { const r = ref(code.readUInt16BE(pc + 1)); if (r) out.push(r); }
        if (op === 0xaa || op === 0xab) {
            let q = pc + 1;
            q += (4 - (q % 4)) % 4;
            if (op === 0xaa) { const low = code.readInt32BE(q + 4), high = code.readInt32BE(q + 8); q += 12 + (high - low + 1) * 4; }
            else q += 8 + code.readInt32BE(q + 4) * 8;
            pc = q;
            continue;
        }
        if (op === 0xc4) { pc += code[pc + 1] === 0x84 ? 6 : 4; continue; } // wide
        pc += OP_LEN[op] ?? 1;
    }
    return out;
}
const OP_LEN = (() => {
    const t = {};
    const set = (len, ...ops) => { for (const o of ops) t[o] = len; };
    set(2, 0x10, 0x12, 0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xa9, 0xbc);
    set(3, 0x11, 0x13, 0x14, 0x84, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7);
    for (let o = 0x99; o <= 0xa8; o++) t[o] = 3;
    set(4, 0xc5);
    set(5, 0xb9, 0xba, 0xc8, 0xc9);
    return t;
})();

function cfgFlag(lines, key) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*B:${key}=`).test(l));
    if (i < 0) throw new Error(`${DT_CFG}: no ${key}`);
    return { value: /=true\s*$/.test(lines[i]), line: i + 1 };
}

export function buildCollisionOverrides(packPath) {
    const zipBuf = fs.readFileSync(packPath);
    const packSha = sha256(zipBuf);
    if (packSha !== PACK_SHA256) throw new Error(`pack zip SHA-256 ${packSha}, expected the pinned ${PACK_SHA256}`);
    const top = zipEntries(zipBuf);
    const jarNames = [SERVER_JAR, FORGE_JAR, ...[...top.keys()].filter((n) => /^mods\/.+\.jar$/.test(n)).sort()];
    const forgeBuf = zipRead(zipBuf, top.get(FORGE_JAR));
    const lzma = zipRead(forgeBuf, zipEntries(forgeBuf).get(SRG_ENTRY));
    const srg = parseSrg(execFileSync('xz', ['--format=lzma', '-dc'], { input: lzma, maxBuffer: 64 << 20 }).toString('utf8'));

    const classes = new Map();
    let passableLeavesJar = null;
    let dtJarSha = null;
    for (const jar of jarNames) {
        const jb = zipRead(zipBuf, top.get(jar));
        if (jar === DT_JAR) dtJarSha = sha256(jb);
        const obf = jar === SERVER_JAR || jar === FORGE_JAR;
        const map = (c) => (obf && c ? (srg.cl.get(c) ?? c) : c);
        for (const [n, e] of zipEntries(jb)) {
            if (n === 'mcmod.info' && new RegExp(`"modid"\\s*:\\s*"${PASSABLE_LEAVES_MODID}"`).test(zipRead(jb, e).toString('utf8'))) passableLeavesJar = jar;
            if (!n.endsWith('.class')) continue;
            let c;
            try { c = parseClassFile(zipRead(jb, e)); } catch { continue; }
            const name = map(c.name);
            if (classes.has(name)) continue; // first jar wins (shaded copies come later)
            const methods = c.methods.map((m) => (obf ? srg.md.get(c.name + '/' + m.name + m.desc) ?? m.name : m.name));
            // Bytecode is kept for mod classes only (SRG names); vanilla hazards come from HAZARD_BASES.
            classes.set(name, { superName: map(c.superName), interfaces: c.interfaces.map(map), methods, code: obf ? null : c.methods, jar });
        }
    }
    if (!dtJarSha) throw new Error(`${DT_JAR} is not in the pack`);
    for (const c of [DT_LEAVES, ...FLUID_BASES, ...Object.keys(HAZARD_BASES), ...PLANT_BASES, ...Object.keys(ROCK_PILES), ...Object.keys(REVIEWED)]) {
        if (!classes.has(c)) throw new Error(`class ${c} not found in the pack`);
    }

    const cfg = zipRead(zipBuf, top.get(DT_CFG)).toString('utf8').split(/\r?\n/);
    const passable = cfgFlag(cfg, 'isLeavesPassable');
    const vanilla = cfgFlag(cfg, 'vanillaLeavesCollision');
    const leavesShapes = passableLeavesJar || vanilla.value ? [[0, 0, 0, 1, 1, 1]] : passable.value ? [] : [DYNAMIC_LEAVES_BOX];

    const chainOf = (cls) => {
        const chain = [];
        for (let c = cls; c && c !== 'java/lang/Object'; c = classes.get(c)?.superName) {
            if (!classes.has(c) || chain.length > 64) return null;
            chain.push(c);
        }
        return chain;
    };
    const interfacesOf = (chain) => {
        const seen = new Set();
        const add = (i) => { if (seen.has(i)) return; seen.add(i); for (const j of classes.get(i)?.interfaces ?? []) add(j); };
        for (const c of chain) for (const i of classes.get(c).interfaces) add(i);
        return seen;
    };

    // What the contact methods (and the mod methods they call, two levels down) invoke that harms.
    const harmsOnContact = (below) => {
        const found = new Set();
        const seen = new Set();
        const visit = (owner, name, desc, depth) => {
            const key = `${owner}.${name}${desc ?? ''}`;
            const k = classes.get(owner);
            if (seen.has(key) || !k?.code) return;
            seen.add(key);
            for (const m of k.code.filter((x) => x.name === name && (!desc || x.desc === desc))) {
                for (const inv of m.invokes) {
                    if (Object.hasOwn(HARM_MEMBERS, inv.name)) found.add(HARM_MEMBERS[inv.name]);
                    else if (depth < 2 && classes.get(inv.owner)?.code) visit(inv.owner, inv.name, inv.desc, depth + 1);
                }
            }
        };
        for (const c of below) for (const m of [M.onEntityCollidedWithBlock, M.onEntityWalk]) visit(c, m, null, 0);
        return [...found].sort();
    };

    const pack = loadRotnData('3.3.4');
    if (!pack.hasDump) throw new Error('no 3.3.4 dump imported');
    const blocks = {};
    const counts = { moddedBlocks: 0, withDumpStates: 0, statesWithoutBox: 0, walkThroughStates: 0, solidStatesWithoutBox: 0, dynamicLeavesChecked: 0 };
    const dot = (c) => c.replace(/\//g, '.');
    for (const [regName, b] of Object.entries(pack.dump.blocks.blocks).sort(([a], [z]) => a.localeCompare(z))) {
        if (regName.startsWith('minecraft:')) continue;
        counts.moddedBlocks++;
        const cls = (b.class ?? '').replace(/\./g, '/');
        const chain = chainOf(cls);
        if (!chain) throw new Error(`${regName}: class chain of ${b.class} not found in the pack`);
        const below = chain.slice(0, Math.max(0, chain.indexOf(BLOCK)));
        const declares = (m) => below.find((c) => classes.get(c).methods.includes(m)) ?? null;
        const states = Array.isArray(b.states) ? b.states : [];
        const out = { class: b.class };
        const rules = [];

        const player = (s) => pack.playerCollision({ name: regName, metadata: s.meta });
        const dtLeaves = chain.includes(DT_LEAVES);
        if (dtLeaves) {
            counts.dynamicLeavesChecked++;
            for (const s of states) {
                const pc = player(s);
                if (JSON.stringify(pc?.boxes) !== JSON.stringify(leavesShapes) || pc.varies === true) {
                    throw new Error(`${regName}:${s.meta}: a player gets ${JSON.stringify(pc)}, the jar and ${DT_CFG} give ${JSON.stringify(leavesShapes)}`);
                }
            }
        }

        const liquid = FLUID_BASES.some((f) => chain.includes(f)) || interfacesOf(chain).has(IFLUID);
        if (liquid) { out.liquid = true; rules.push(chain.find((c) => FLUID_BASES.includes(c)) ? 'fluid-class' : 'IFluidBlock'); }

        // Hazards: one kind for every state, or per meta.
        let hazard = null;
        const base = chain.find((c) => HAZARD_BASES[c]);
        if (base) { hazard = HAZARD_BASES[base]; rules.push(`hazard-base ${dot(base)}`); }
        const mat = states.map((s) => HAZARD_MATERIALS[s.material]).find(Boolean);
        if (!hazard && mat) { hazard = mat; rules.push(`hazard-material ${mat}`); }
        if (!hazard && liquid && states.some((s) => s.material === 'lava')) { hazard = 'lava'; rules.push('hazard-material lava'); }
        const contact = declares(M.onEntityCollidedWithBlock) ?? declares(M.onEntityWalk);
        const reviewed = REVIEWED[below.find((c) => REVIEWED[c]) ?? ''];
        const hazardByMeta = {};
        if (reviewed) {
            for (const s of states) {
                const k = reviewed.harmful[s.props?.variant];
                if (k) hazardByMeta[s.meta] = k;
            }
            rules.push(`reviewed ${dot(below.find((c) => REVIEWED[c]))}`);
        } else if (!hazard && contact) {
            const harms = harmsOnContact(below);
            if (harms.length) { hazard = 'trap'; rules.push(`hazard-contact ${dot(contact)} (${harms.join(', ')})`); }
        }
        if (hazard) out.hazard = hazard;
        if (Object.keys(hazardByMeta).length) out.hazardByMeta = hazardByMeta;

        // Walk-through: opt-in, per state.
        if (states.length) counts.withDumpStates++;
        const noBox = states.filter((s) => { const pc = player(s); return Array.isArray(pc?.boxes) && pc.boxes.length === 0 && pc.varies !== true; });
        counts.statesWithoutBox += noBox.length;
        const plantLike = PLANT_BASES.some((p) => chain.includes(p)) || (states.length > 0 && states.every((s) => PLANT_MATERIALS.has(s.material)));
        const pile = below.find((c) => ROCK_PILES[c]);
        const overrides = declares(M.addCollisionBoxToList) || (!reviewed && contact);
        if (noBox.length && !liquid && !hazard && !dtLeaves && (plantLike || pile) && !overrides) {
            const metas = noBox.map((s) => s.meta).filter((m) => !(m in hazardByMeta));
            if (metas.length) {
                out.walkThrough = metas.length === states.length ? 'all' : metas.sort((a, z) => a - z);
                rules.push(pile ? `rock-pile ${dot(pile)}` : 'plant');
                counts.walkThroughStates += metas.length;
            }
        }
        counts.solidStatesWithoutBox = counts.statesWithoutBox - counts.walkThroughStates;
        if (out.liquid || out.hazard || out.hazardByMeta || out.walkThrough) {
            out.rules = rules;
            blocks[regName] = out;
        }
    }
    for (const o of Object.values(blocks)) {
        for (const k of [o.hazard, ...Object.values(o.hazardByMeta ?? {})].filter(Boolean)) if (!HAZARD_KINDS.includes(k)) throw new Error(`hazard ${k}`);
    }
    const tally = (f) => Object.values(blocks).filter(f).length;
    return {
        description: 'What forge-bridge src/collision.js adds to rotn-data\'s per-state playerCollision for modded blocks: walk-through is opt-in (only the states listed in walkThrough; any other state a player has no box in is a solid full cube), liquid marks modded fluids, hazard/hazardByMeta mark trap, fire, portal, web and lava blocks; checks records what the tool verified in the data. Built by packages/forge-bridge/tools/build-collision-overrides.mjs from the pinned server pack zip (rules in its header); no mod code run.',
        pack: { version: '3.3.4', sha256: PACK_SHA256 },
        counts: {
            ...counts,
            blocks: { walkThrough: tally((o) => o.walkThrough), liquid: tally((o) => o.liquid), hazard: tally((o) => o.hazard || o.hazardByMeta) },
        },
        checks: {
            dynamicLeaves: {
                shapes: leavesShapes,
                evidence: `${DT_JAR} (SHA-256 ${dtJarSha}): BlockDynamicLeaves.addCollisionBoxToList (func_185477_a) gives a player `
                    + `vanilla's full cube if Passable Leaves is loaded or vanillaLeavesCollision is true, nothing if isLeavesPassable is true, `
                    + `else AxisAlignedBB(0.125, 0, 0.125, 0.875, 0.5, 0.875) (bytecode 96-128). On the pack: ${DT_CFG} isLeavesPassable=${passable.value} `
                    + `(line ${passable.line}), vanillaLeavesCollision=${vanilla.value} (line ${vanilla.line}), mod ${PASSABLE_LEAVES_MODID} `
                    + `${passableLeavesJar ? `loaded (${passableLeavesJar})` : 'not in the pack'}`,
            },
        },
        reviewed: Object.fromEntries([
            ...Object.entries(REVIEWED).map(([c, r]) => [dot(c), r.evidence]),
            ...Object.entries(ROCK_PILES).map(([c, e]) => [dot(c), `rock pile: ${e}; no player box in the dump, no contact or collision-box override`]),
        ]),
        blocks,
    };
}

function main() {
    const args = process.argv.slice(2);
    const packPath = args[args.indexOf('--pack') + 1];
    if (!args.includes('--pack') || !packPath) {
        console.error('usage: build-collision-overrides.mjs --pack <server pack zip> [--check]');
        process.exit(2);
    }
    const text = JSON.stringify(buildCollisionOverrides(packPath), null, 1) + '\n';
    if (args.includes('--check')) {
        const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') === text;
        console.log(same ? 'collision overrides: up to date' : 'collision overrides: differ from the committed file');
        process.exit(same ? 0 : 1);
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${JSON.stringify(JSON.parse(text).counts)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
