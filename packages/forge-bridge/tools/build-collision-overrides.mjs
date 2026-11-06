// Builds packages/forge-bridge/data/collision-overrides-3.3.4.json: the modded blocks whose
// collision rotn-data's dump does not record correctly, and what src/collision.js uses instead.
//
// Why: the dump's per-state `collision` comes from getCollisionBoundingBox. An entity collides
// with what addCollisionBoxToList (SRG func_185477_a) adds, and a class that overrides it can
// differ. Dynamic Trees' leaves are the known case: the dump records a full cube, a player
// collides with a half-height box.
//
// What it does (reads the pinned server pack zip only; runs no mod code):
// - indexes every class in the vanilla server jar (mapped with Forge's notch-to-SRG table), the
//   Forge jar and every mod jar, with rotn-data's zip and class-file readers;
// - walks each dumped modded block's class chain up to net.minecraft.block.Block and notes the
//   first class that declares func_185477_a;
// - Dynamic Trees leaves (the chain contains BlockDynamicLeaves): the box the pack's config selects
//   (config/dynamictrees.cfg isLeavesPassable, vanillaLeavesCollision; Passable Leaves not on the pack),
//   from the bytecode reviewed in test/fixtures/dynamictrees-0.13.4/;
// - any other block with that override whose dump default state has no box: kept a full cube,
//   because its class adds a box the dump did not see (a lily pad holds a player up).
//
// Usage: node packages/forge-bridge/tools/build-collision-overrides.mjs --pack <server pack zip> [--check]
// --check compares with the committed file and exits 1 if they differ. Needs `xz` (Forge's SRG table).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipEntries, zipRead, parseClass, parseSrg } from '../../rotn-data/tools/build-falling-blocks.mjs';
import { loadRotnData } from '../../rotn-data/src/catalog.js';
import { DYNAMIC_LEAVES_BOX } from '../src/collision.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(HERE, '../data/collision-overrides-3.3.4.json');
const PACK_SHA256 = '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205';
const SERVER_JAR = 'minecraft_server.1.12.2.jar';
const FORGE_JAR = 'forge-1.12.2-14.23.5.2860.jar';
const SRG_ENTRY = 'deobfuscation_data-1.12.2.lzma';
const BLOCK = 'net/minecraft/block/Block';
const ADD_COLLISION = 'func_185477_a';
const DT_LEAVES = 'com/ferreusveritas/dynamictrees/blocks/BlockDynamicLeaves';
const DT_JAR = 'mods/DramaticTrees-1.12.2-0.13.4.jar';
const DT_CFG = 'config/dynamictrees.cfg';
const PASSABLE_LEAVES_MODID = 'passableleaves';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

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
            try { c = parseClass(zipRead(jb, e)); } catch { continue; }
            const name = map(c.name);
            if (classes.has(name)) continue; // first jar wins
            const methods = obf ? c.methods.map((m) => {
                const i = m.indexOf('(');
                return srg.md.get(c.name + '/' + m.slice(0, i) + m.slice(i)) ?? m.slice(0, i);
            }) : c.methods.map((m) => m.slice(0, m.indexOf('(')));
            classes.set(name, { superName: map(c.superName), methods, jar });
        }
    }
    if (!dtJarSha) throw new Error(`${DT_JAR} is not in the pack`);

    // The box Dynamic Trees' addCollisionBoxToList gives a player (bytecode in test/fixtures/dynamictrees-0.13.4/).
    const cfg = zipRead(zipBuf, top.get(DT_CFG)).toString('utf8').split(/\r?\n/);
    const passable = cfgFlag(cfg, 'isLeavesPassable');
    const vanilla = cfgFlag(cfg, 'vanillaLeavesCollision');
    const leavesShapes = passableLeavesJar || vanilla.value ? [[0, 0, 0, 1, 1, 1]] : passable.value ? [] : [DYNAMIC_LEAVES_BOX];
    const leavesEvidence = `${DT_JAR} (SHA-256 ${dtJarSha}): BlockDynamicLeaves.addCollisionBoxToList (func_185477_a) gives a player `
        + `vanilla's full cube if Passable Leaves is loaded or vanillaLeavesCollision is true, nothing if isLeavesPassable is true, `
        + `else AxisAlignedBB(0.125, 0, 0.125, 0.875, 0.5, 0.875) (bytecode 96-128). On the pack: ${DT_CFG} isLeavesPassable=${passable.value} `
        + `(line ${passable.line}), vanillaLeavesCollision=${vanilla.value} (line ${vanilla.line}), mod ${PASSABLE_LEAVES_MODID} `
        + `${passableLeavesJar ? `loaded (${passableLeavesJar})` : 'not in the pack'}`;

    const pack = loadRotnData('3.3.4');
    if (!pack.hasDump) throw new Error('no 3.3.4 dump imported');
    const blocks = {};
    let moddedBlocks = 0;
    let withOverride = 0;
    const unresolved = [];
    for (const [regName, b] of Object.entries(pack.dump.blocks.blocks).sort(([a], [z]) => a.localeCompare(z))) {
        if (regName.startsWith('minecraft:')) continue;
        moddedBlocks++;
        const chain = [];
        let resolved = true;
        for (let c = (b.class ?? '').replace(/\./g, '/'); c && c !== BLOCK && c !== 'java/lang/Object'; c = classes.get(c)?.superName) {
            if (!classes.has(c) || chain.length > 64) { resolved = false; break; }
            chain.push(c);
        }
        if (!resolved) { unresolved.push(regName); continue; }
        const addAt = chain.find((c) => classes.get(c).methods.includes(ADD_COLLISION));
        if (!addAt) continue;
        withOverride++;
        const dot = (c) => c.replace(/\//g, '.');
        if (chain.includes(DT_LEAVES)) {
            blocks[regName] = { use: 'dynamicLeaves', class: b.class, addCollisionBoxToList: dot(addAt) };
            continue;
        }
        const def = b.states?.find((s) => s.meta === b.defaultMeta) ?? b.states?.[0];
        if (def && Array.isArray(def.collision) && def.collision.length === 0) {
            blocks[regName] = { use: 'fullCube', class: b.class, addCollisionBoxToList: dot(addAt) };
        }
    }
    if (unresolved.length) throw new Error(`class chain not found in the pack for ${unresolved.length} blocks: ${unresolved.slice(0, 5).join(', ')}`);
    return {
        description: 'Modded blocks whose collision the rotn-data dump (getCollisionBoundingBox) does not record correctly, and what forge-bridge src/collision.js uses instead. Every other modded block takes the dump\'s per-state collision. Built by packages/forge-bridge/tools/build-collision-overrides.mjs from the pinned server pack zip; no mod code run.',
        pack: { version: '3.3.4', sha256: PACK_SHA256 },
        scanned: { moddedBlocks, addCollisionBoxToListOverride: withOverride },
        shapes: {
            dynamicLeaves: { shapes: leavesShapes, evidence: leavesEvidence },
            fullCube: { shapes: [[0, 0, 0, 1, 1, 1]], evidence: 'The class chain overrides addCollisionBoxToList (func_185477_a, the class named per block) and the dump\'s default state has no box, so the dump missed a box the class adds (BlockLilyPad adds one for every entity but boats). Kept a solid full cube, forge-bridge\'s default, rather than made walk-through; not reviewed per class.' },
        },
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
    const text = JSON.stringify(buildCollisionOverrides(packPath), null, 2) + '\n';
    if (args.includes('--check')) {
        const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') === text;
        console.log(same ? 'collision overrides: up to date' : 'collision overrides: differ from the committed file');
        process.exit(same ? 0 : 1);
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    const counts = {};
    for (const b of Object.values(JSON.parse(text).blocks)) counts[b.use] = (counts[b.use] ?? 0) + 1;
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${JSON.stringify(counts)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
