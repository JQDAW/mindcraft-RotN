// Offline tests for the G2 scenarios (test/scenarios/g2/) together with the real driver side
// (attachG2 in test/runner/drivers/scenario-protocol.mjs). A simulated 1.12 server (console, log,
// world, entities, inventory) runs on a virtual clock; a fake mineflayer bot runs the real driver code.
// Gate data (rotn-data's flattening table and module, common-mobs.json) comes from fixtures under a
// temp dataRoot, so these tests do not depend on rotn-data's PRs.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { Vec3 } from 'vec3';
import { runScenario } from '../runner/lib/runner.mjs';
import { attachG2, pages, stockNames, agentNames } from '../runner/drivers/scenario-protocol.mjs';
import { replyPages, testforblockVerdict, testforVerdict, isRegistryName, prng, agentNaming } from '../runner/lib/g2.mjs';
import blocks from '../scenarios/g2/g2-blocks-named.mjs';
import mobs, { VANILLA_COMMON_MOBS, chooseMobs, readCommonMobs } from '../scenarios/g2/g2-mobs-named.mjs';
import items, { VANILLA_SAMPLE, parseItems, checkFullTable } from '../scenarios/g2/g2-items-roundtrip.mjs';

const NAME = 'FRCFLD';
const UUID_V4 = '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const tick = () => new Promise((r) => setImmediate(r));

// The world near spawn: stone, ores, dirt layers, grass with modded rock, plants, trees, then air.
const mod = (a, b) => ((a % b) + b) % b;
function blockAtWorld(x, y, z) {
    if (y < 56) return (x * 7 + z * 3 + y) % 23 === 0 ? { name: 'minecraft:coal_ore', meta: 0 } : { name: 'minecraft:stone', meta: (x + z) % 4 === 0 ? 1 : 0 };
    if (y < 58) return [{ name: 'minecraft:gravel', meta: 0 }, { name: 'minecraft:stone', meta: 5 }, { name: 'minecraft:iron_ore', meta: 0 }][mod(x * 5 + z, 3)];
    if (y < 61) return (x + 2 * z) % 5 === 0 ? { name: 'minecraft:clay', meta: 0 } : { name: 'minecraft:dirt', meta: 1 };
    if (y < 63) return { name: 'minecraft:dirt', meta: 0 };
    if (y === 63) return (x + z) % 9 === 0 ? { name: 'pyrotech:rock', meta: 6 } : { name: 'minecraft:grass', meta: 0 };
    if (y === 64 && (x * z) % 13 === 1) return { name: 'minecraft:tallgrass', meta: 1 };
    if (y >= 64 && y < 70 && x % 11 === 0 && z % 11 === 0) return { name: 'minecraft:log', meta: 0 };
    if (y >= 68 && y < 71 && Math.abs(x % 11) <= 1 && Math.abs(z % 11) <= 1) return { name: 'minecraft:leaves', meta: 0 };
    return { name: 'minecraft:air', meta: 0 };
}
const ENTITY_DISPLAY = { 'minecraft:zombie': 'Zombie', 'minecraft:skeleton': 'Skeleton', 'minecraft:spider': 'Spider', 'minecraft:creeper': 'Creeper',
    'minecraft:cow': 'Cow', 'minecraft:pig': 'Pig', 'minecraft:sheep': 'Sheep', 'minecraft:chicken': 'Chicken', 'specialmobs:firecreeper': 'Fire Creeper',
    'specialmobs:specialzombie': 'Special Zombie' };

/**
 * sim(opt): the server, the fake bot (real attachG2 inside) and a virtual clock.
 *   names: the bot's naming adapter (default: correct, built from the sim's truth)
 *   chatEdit(text): rewrite or drop (return null) what the bot says, to model a lying census
 */
function sim(opt = {}) {
    const log = [];
    let t = 0;
    let online = false;
    const pos = new Vec3(10.5, 64, -3.5);
    const entities = [];
    const inventory = [];
    let nextId = 1;
    const hms = () => new Date(Date.UTC(2026, 10, 1, 12) + t).toISOString().slice(11, 19);
    const add = (msg, thread = 'Server thread', logger = DS) => log.push(`[${hms()}] [${thread}/INFO] [${logger}]: ${msg}`);

    // The fake mineflayer bot. Vanilla names are unprefixed, as mineflayer gives them.
    const bare = (n) => (n.startsWith('minecraft:') ? n.slice(10) : n);
    const fake = new EventEmitter();
    fake.entity = { position: pos };
    fake.entities = {};
    let waited = false;
    let loadedAt = Infinity;   // loadAfterMs: the chunks arrive that long (real time) after the first lookup that missed
    fake.blockAt = (v) => {
        const late = Date.now() >= loadedAt;
        if (opt.unloaded && !(opt.loadOnWait && waited) && !late && opt.unloaded(v.x, v.y, v.z)) {
            if (opt.loadAfterMs && loadedAt === Infinity) loadedAt = Date.now() + opt.loadAfterMs;
            return null;   // no chunk there
        }
        const b = blockAtWorld(v.x, v.y, v.z);
        return { name: bare(b.name), metadata: b.meta, position: v };
    };
    if (opt.loadOnWait) fake.waitForChunksToLoad = () => { waited = true; return Promise.resolve(); };
    fake.inventory = { items: () => inventory.slice() };
    fake.chat = (text) => {
        const said = opt.chatEdit ? opt.chatEdit(text) : text;
        if (online && said) add(`<${NAME}> ${said}`);
    };
    attachG2(fake, { names: opt.names ?? truthNames, pageDelayMs: 0, emit: () => {}, random: prng(opt.driverSeed ?? 1),
        chunkWaitMs: opt.chunkWaitMs ?? 0, chunkPollMs: 1 });

    const server = {
        console(cmd, waitS = 1) {
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add(opt.noSeed ? 'Unknown command. Try /help for a list of commands' : 'Seed: -4172144997902289642');
            else if (cmd === `tp ${NAME} ~ ~ ~`) add(online ? `Teleported ${NAME} to ${pos.x}, ${pos.y}, ${pos.z}` : 'Player not found');
            else if ((m = /^tell (\S+) (.*)$/.exec(cmd)) && online) fake.emit('messagestr', `Server whispers to you: ${m[2]}`);
            else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+) (\d+)$/.exec(cmd))) {
                const [x, y, z] = [m[1], m[2], m[3]].map(Number);
                const b = blockAtWorld(x, y, z);
                const want = m[4].includes(':') ? m[4] : `minecraft:${m[4]}`;
                if (b.name !== want) add(`The block at ${x},${y},${z} is ${b.name} (expected: ${want}).`);
                else if (b.meta !== Number(m[5])) add(`The block at ${x},${y},${z} had the data value of ${b.meta} (expected: ${m[5]}).`);
                else add(`Successfully found the block at ${x},${y},${z}.`);
            } else if ((m = /^testfor @e\[type=([^,]+),x=(-?\d+),y=(-?\d+),z=(-?\d+),r=(\d+)\]$/.exec(cmd))) {
                const c = new Vec3(Number(m[2]), Number(m[3]), Number(m[4]));
                const e = entities.find((x) => x.reg === m[1] && x.position.distanceTo(c) <= Number(m[5]));
                add(e ? `Found ${ENTITY_DISPLAY[e.reg] ?? e.reg}` : 'Selector \'@e\' found nothing');
            } else if ((m = /^summon (\S+) (\S+) (\S+) (\S+) \{.*Tags:\["([^"]+)"\]\}$/.exec(cmd))) {
                if (!ENTITY_DISPLAY[m[1]] || opt.cannotSummon?.includes(m[1])) add('Unable to summon object');
                else {
                    const e = { id: nextId++, reg: m[1], tag: m[5], type: 'mob', name: m[1].startsWith('minecraft:') ? bare(m[1]) : m[1], position: new Vec3(Number(m[2]), Number(m[3]), Number(m[4])) };
                    entities.push(e);
                    fake.entities[e.id] = e;
                    add('Object successfully summoned');
                }
            } else if ((m = /^kill @e\[tag=(\S+)\]$/.exec(cmd))) {
                for (const e of entities.filter((x) => x.tag === m[1])) { delete fake.entities[e.id]; entities.splice(entities.indexOf(e), 1); }
            } else if (cmd === `clear ${NAME}`) inventory.length = 0;
            else if ((m = /^give (\S+) (\S+) 1 (\d+)$/.exec(cmd))) {
                if (opt.cannotGive?.includes(m[2])) add(`There is no such item with name ${m[2]}`);
                else {
                    inventory.push({ slot: 9 + inventory.length, name: bare(m[2]), metadata: Number(m[3]) });
                    add(`Given [${m[2]}] * 1 to ${NAME}`);
                }
            }
            t += waitS * 1000;
            return log.slice(before);
        },
        log: (n) => log.slice(-n),
    };
    let alive = false;
    const bot = {
        start() {
            alive = true;
            add(`UUID of player ${NAME} is ${UUID_V4}`, 'User Authenticator #1', 'net.minecraft.server.network.NetHandlerLoginServer');
            online = true;
            add(`${NAME} joined the game`);
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => [],
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 5; i++) await tick(); } };
    for (const n of opt.natural ?? []) {
        const e = { id: nextId++, reg: n.reg, tag: null, type: 'mob', name: bare(n.reg), position: new Vec3(...n.pos) };
        entities.push(e);
        fake.entities[e.id] = e;
    }
    return { server, bot, clock, lines: log, entities, inventory };
}

// The correct adapter: full registry names (modded names keep their namespace), and the table.
const TABLE = parseItems(VANILLA_SAMPLE);
const truthNames = {
    blockName: (b) => (b ? { name: b.name.includes(':') ? b.name : `minecraft:${b.name}`, meta: b.metadata } : null),
    entityName: (e) => (e.name.includes(':') ? e.name : `minecraft:${e.name}`),
    itemName: (i) => ({ name: i.name.includes(':') ? i.name : `minecraft:${i.name}`, meta: i.metadata }),
    toNew: (n, meta) => TABLE.find((x) => x.name === n && x.meta === meta)?.expected ?? null,
    toOld: (nw) => { const x = TABLE.find((y) => y.expected === nw); return x ? { name: x.name, meta: x.meta } : null; },
};

// Fixture gate data: a dataRoot with rotn-data's table, module and common-mobs.json.
let DATA;
const WIRED_MCDATA = "// the agent's mcdata.js, wired to rotn-data (brief item 4)\nexport { toNew, toOld } from '../../packages/rotn-data/index.js';\n";
function writeData(root, { mobsList, tableEntries, moduleBody, mcdataBody = WIRED_MCDATA } = {}) {
    fs.mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'utils', 'mcdata.js'), mcdataBody);
    fs.mkdirSync(path.join(root, 'packages', 'rotn-data', 'vanilla'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages', 'rotn-data', '3.3.4'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    const entries = tableEntries ?? [...TABLE.map((x) => ({ old: x.name, meta: x.meta, new: x.expected })), { old: 'minecraft:dye', meta: 2, new: 'green_dye' }];
    fs.writeFileSync(path.join(root, 'packages', 'rotn-data', 'vanilla', 'flattening-items.json'), JSON.stringify({ description: 'fixture', count: entries.length, entries }));
    fs.writeFileSync(path.join(root, 'packages', 'rotn-data', 'index.js'), moduleBody ?? [
        "import fs from 'node:fs';",
        "const t = JSON.parse(fs.readFileSync(new URL('./vanilla/flattening-items.json', import.meta.url), 'utf8')).entries;",
        'export const toNew = (o, m = 0) => t.find((e) => e.old === o && e.meta === m)?.new ?? null;',
        'export const toOld = (n) => { const e = t.find((x) => x.new === n); return e ? { name: e.old, meta: e.meta } : null; };',
        "export const registryName = (x) => (x.name.includes(':') ? x.name : `minecraft:${x.name}`);",
    ].join('\n'));
    if (mobsList !== undefined) {
        fs.writeFileSync(path.join(root, 'packages', 'rotn-data', '3.3.4', 'common-mobs.json'), JSON.stringify({ description: 'fixture', mobs: mobsList.map((name, i) => ({ name, weight: 100 - i })) }));
    }
    return root;
}
before(() => {
    DATA = writeData(fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-')), {
        mobsList: ['minecraft:zombie', 'minecraft:skeleton', 'specialmobs:firecreeper', 'minecraft:cow', 'specialmobs:specialzombie', 'minecraft:sheep'],
    });
});

const fast = { settleMs: 1000, seeMs: 1000, pollMs: 1000, consoleWaitS: 0, replyTimeoutMs: 30000 };
const run = (scenario, s, params = {}) => runScenario(scenario, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('G2 helpers', () => {
    test('registry names: full ns:path only; unknown, null and numbers are not names', () => {
        for (const n of ['minecraft:stone', 'pyrotech:rock', 'contenttweaker:raw_iron', 'minecraft:log2']) assert.ok(isRegistryName(n), n);
        for (const n of ['stone', 'null', 'unknown', 'minecraft:unknown', 'pyrotech:unknown_block', '1:0', '', null, 42, 'Minecraft:Stone']) assert.ok(!isRegistryName(n), String(n));
    });

    test('pages: chat-sized pages, at least one; replyPages reassembles them in order and spots missing pages', () => {
        const entries = Array.from({ length: 30 }, (_, i) => `minecraft:block_number_${i} 0 ${100 - i} 1,2,3`);
        const ps = pages('blocks', 'abcdef', entries);
        assert.ok(ps.length > 1 && ps.every((l) => l.length <= 240), ps.map((l) => l.length).join(','));
        assert.deepEqual(pages('blocks', 'abcdef', []), ['blocks abcdef 1/1']);
        const line = (text) => `[12:00:00] [Server thread/INFO] [${DS}]: <${NAME}> ${text}`;
        const all = replyPages(ps.slice().reverse().map(line), NAME, 'blocks', 'abcdef');
        assert.equal(all.complete, true);
        assert.deepEqual(all.entries.map((e) => e[0]), entries.map((e) => e.split(' ')[0]));
        assert.equal(replyPages(ps.slice(1).map(line), NAME, 'blocks', 'abcdef').complete, false);
        assert.equal(replyPages([`[12:00:00] [Server thread/INFO] [${DS}]: [Server] <${NAME}> blocks abcdef 1/1 x 0 1 1,2,3`], NAME, 'blocks', 'abcdef'), null, 'the console cannot speak for the bot');
    });

    test('testforblock and testfor verdicts need the exact success line', () => {
        const l = (m) => `[12:00:00] [Server thread/INFO] [${DS}]: ${m}`;
        assert.equal(testforblockVerdict([l('Successfully found the block at 1,64,-3.')], [1, 64, -3]).ok, true);
        assert.equal(testforblockVerdict([l('Successfully found the block at 1,64,-4.')], [1, 64, -3]).ok, false, 'other coordinates');
        assert.match(testforblockVerdict([l('The block at 1,64,-3 had the data value of 2 (expected: 0).')], [1, 64, -3]).detail, /data value/);
        assert.equal(testforblockVerdict([], [1, 64, -3]).detail, 'no answer from the server');
        assert.equal(testforVerdict([l('Found Zombie')]).ok, true);
        assert.equal(testforVerdict([l('Selector \'@e\' found nothing')]).ok, false);
    });

    test('the spot-check PRNG is reproducible from its seed', () => {
        const a = prng(42), b = prng(42);
        assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
    });
});

describe('the agent\'s naming path (PR #36 re-review item 3)', () => {
    const at = (body) => writeData(fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-mc-')), { mcdataBody: body });
    test('agentNaming: a child process imports mcdata.js; wired only if toNew/toOld are functions AND the full table round-trips through them', () => {
        const ok = agentNaming(DATA);
        assert.equal(ok.wired, true, ok.why);
        assert.equal(ok.entries, 31);
        assert.match(ok.why, /all 31 table entries round-trip through them/);
        // The reviewer's case: a text match would accept these; the real import does not.
        assert.match(agentNaming(at('export const toNew = null;\nexport const toOld = null;\n')).why, /does not export toNew and toOld as functions/);
        assert.match(agentNaming(at("// import { toNew, toOld } from '../../packages/rotn-data/index.js';\nexport { toNew } from '../../packages/rotn-data/index.js';\n")).why, /does not export toOld as functions/);
        assert.match(agentNaming(at('export function getBlockName() {}\n')).why, /does not export toNew and toOld/);
        // Exported but wrong: the round trip through the agent's functions decides.
        // One wrong mapping in an otherwise correct mcdata.js is enough to fail.
        const wrong = agentNaming(at("import * as rd from '../../packages/rotn-data/index.js';\nexport const toNew = (o, m) => (o === 'minecraft:coal' && m === 1 ? 'coal' : rd.toNew(o, m));\nexport const toOld = rd.toOld;\n"));
        assert.equal(wrong.wired, false);
        assert.equal(wrong.failureCount, 1);
        assert.match(wrong.why, /^1 failure\(s\) in the 31-entry round trip through mcdata\.js toNew\/toOld; first: toNew\(minecraft:coal, 1\) = "coal", table says charcoal$/);
        assert.match(agentNaming(at('export const toNew = (;\n')).why, /could not be imported/);
        assert.match(agentNaming(at('export const toNew = () => { throw new Error("boom"); };\nexport const toOld = () => null;\n')).failures[0], /threw: boom/);
        const noTable = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-notable-'));
        fs.mkdirSync(path.join(noTable, 'src', 'utils'), { recursive: true });
        fs.writeFileSync(path.join(noTable, 'package.json'), '{"type":"module"}\n');
        fs.writeFileSync(path.join(noTable, 'src', 'utils', 'mcdata.js'), 'export const toNew = () => null;\nexport const toOld = () => null;\n');
        assert.match(agentNaming(noTable).why, /flattening-items\.json not available/);
        assert.match(agentNaming(fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-nomc-'))).why, /could not be imported/);
        // A child that never answers is a failed check, not a pass.
        assert.equal(agentNaming(DATA, { run: () => ({ status: 1, stdout: '', stderr: 'killed' }) }).wired, false);
        assert.equal(agentNaming(DATA, { run: () => ({ status: 0, stdout: 'G2NAMING {nope', stderr: '' }) }).wired, false);
    });

    test('a run on an unwired naming path, or without a world seed, is never a gate run', async () => {
        const unwired = at('export function getBlockName() {}\n');
        const r = await run(blocks, sim(), { seed: 7, dataRoot: unwired });
        assert.equal(r.checksPassed, true, JSON.stringify(r.checks, null, 1));
        assert.ok(r.weakenedParams.some((w) => /^mcdata\.js not wired to rotn-data: src\/utils\/mcdata\.js does not export toNew and toOld as functions$/.test(w)), JSON.stringify(r.weakenedParams));
        assert.equal(r.notes.naming.wired, false);
        const r2 = await run(blocks, sim({ noSeed: true }), { seed: 7, dataRoot: DATA });
        assert.equal(r2.notes.worldSeed, null);
        assert.ok(r2.weakenedParams.some((w) => /no world seed/.test(w)), JSON.stringify(r2.weakenedParams));
    });

    test('agentNames: names as world.js reads them; translation only from mcdata.js exports', () => {
        const without = agentNames({ getBlockName: () => 'x' });
        assert.equal(without.translation, false);
        assert.equal(without.names.toNew, null);
        assert.match(without.source, /translation: none exported yet/);
        assert.deepEqual(without.names.blockName({ name: 'stone', metadata: 3 }), { name: 'minecraft:stone', meta: 3 });
        assert.deepEqual(without.names.blockName({ name: 'pyrotech:rock', metadata: 6 }), { name: 'pyrotech:rock', meta: 6 });
        assert.equal(without.names.entityName({ name: 'zombie' }), 'minecraft:zombie');
        const mc = { toNew: (o, m) => (o === 'minecraft:coal' && m === 1 ? 'charcoal' : null), toOld: () => ({ name: 'minecraft:coal', meta: 1 }) };
        const withT = agentNames(mc);
        assert.equal(withT.translation, true);
        assert.equal(withT.names.toNew('minecraft:coal', 1), 'charcoal');
        assert.equal(withT.names.toOld, mc.toOld, 'the agent\'s own function, not a copy');
    });
});

describe('g2-blocks-named on a simulated server', () => {
    test('a bot with correct names passes: census without air, runner-picked samples, 40 non-air spot checks, consistent shares', async () => {
        const s = sim();
        const r = await run(blocks, s, { seed: 7, dataRoot: DATA });
        assert.equal(r.checksPassed, true, JSON.stringify(r.checks, null, 1));
        assert.deepEqual(r.weakenedParams, [`dataRoot=${DATA} (gate needs = )`], 'with a wired mcdata.js and a seed, only the fixture dataRoot keeps it from counting');
        const c = byName(r);
        // Exactly min(count, candidates, samplesPerType) samples per type, all confirmed.
        const want = r.notes.census.reduce((a, line) => a + Math.min(Number(line.split(' ')[2]), 8, 3), 0);
        assert.ok(c.blocks_confirmed.detail.startsWith(`${want}/${want} runner-picked samples (3 per type) confirmed`), c.blocks_confirmed.detail);
        assert.match(c.blocks_spotcheck.detail, /^4\d confirmed non-air answers of 40 needed/);
        assert.ok(r.notes.census.some((b) => b.startsWith('pyrotech:rock 6 ')), 'the modded block is in the census');
        assert.ok(!r.notes.census.some((b) => b.startsWith('minecraft:air')), 'no air in the census');
        assert.equal(r.notes.worldSeed, '-4172144997902289642', 'the world seed is evidence (finding 5)');
        assert.deepEqual(r.notes.cube, { center: [10, 64, -4], radius: 16 });
        assert.equal(r.notes.spotSkew.length, 0);
    });

    test('a fully loaded cube: nothing unloaded, recorded in notes.unloaded', async () => {
        const r = await run(blocks, sim(), { seed: 7, dataRoot: DATA });
        assert.deepEqual(r.notes.unloaded, { census: 0, cube: 35937, censusShare: 0, spot: 0, spotAsked: r.notes.unloaded.spotAsked, spotShare: 0, maxShare: 0.01 });
        assert.deepEqual(r.weakenedParams, [`dataRoot=${DATA} (gate needs = )`]);
    });

    test('unloaded positions are never a block type: a small unloaded edge (<1%) is recorded and the run still counts', async () => {
        // One column at the cube's edge has no chunk: 33 of 35937 positions (0.09%).
        const s = sim({ unloaded: (x, y, z) => x === 26 && z === 12 });
        const r = await run(blocks, s, { seed: 7, dataRoot: DATA });
        assert.equal(r.checksPassed, true, JSON.stringify(r.checks, null, 1));
        assert.equal(r.notes.unloaded.census, 33);
        assert.ok(!r.notes.census.some((b) => /^(null|#unloaded)/.test(b)), 'no null or #unloaded type in the census');
        assert.deepEqual(r.weakenedParams, [`dataRoot=${DATA} (gate needs = )`], 'below 1%: still a gate run');
    });

    test('more than 1% unloaded (census or spot) makes the run not a gate run, with the counts in notes', async () => {
        // Everything east of x = 15 has no chunk: a third of the cube.
        const s = sim({ unloaded: (x) => x >= 16 });
        const r = await run(blocks, s, { seed: 7, dataRoot: DATA });
        assert.equal(byName(r).blocks_named.pass, true, byName(r).blocks_named.detail);
        assert.ok(r.notes.unloaded.censusShare > 0.3 && r.notes.unloaded.spot > 0, JSON.stringify(r.notes.unloaded));
        assert.ok(r.weakenedParams.some((w) => /% of the cube was unloaded in the census \(max 1%\)/.test(w)), JSON.stringify(r.weakenedParams));
        assert.ok(r.weakenedParams.some((w) => /spot positions were unloaded \(max 1%\)/.test(w)), JSON.stringify(r.weakenedParams));
        assert.match(byName(r).blocks_spotcheck.detail, /\(\d+ positions asked, \d+ unloaded, seed 7\)/);
        assert.equal(r.gateValid, false);
    });

    test('the driver waits for the cube\'s chunks first (waitForChunksToLoad), so late chunks are not unloaded', async () => {
        const r = await run(blocks, sim({ unloaded: (x) => x >= 16, loadOnWait: true, chunkWaitMs: 1000 }), { seed: 7, dataRoot: DATA });
        assert.equal(r.notes.unloaded.census, 0);
        assert.equal(r.checksPassed, true, JSON.stringify(r.checks, null, 1));
    });

    test('chunks that arrive a moment later, without waitForChunksToLoad, are found by polling the columns', async () => {
        // The driver polls in real time; the scenario's virtual clock gets a long reply timeout to wait for it.
        const r = await run(blocks, sim({ unloaded: (x) => x >= 16, loadAfterMs: 30, chunkWaitMs: 5000 }), { seed: 7, dataRoot: DATA, replyTimeoutMs: 3600000 });
        assert.equal(r.notes.unloaded.census, 0, JSON.stringify(r.notes.unloaded));
    });

    test('a census without the "#unloaded U T" entry (an old driver) fails blocks_named', async () => {
        const chatEdit = (text) => (text.startsWith('blocks ') ? text.replace(/#unloaded \d+ \d+(; )?/, '') : text);
        const c = byName(await run(blocks, sim({ chatEdit }), { seed: 7, dataRoot: DATA }));
        assert.equal(c.blocks_named.pass, false);
        assert.match(c.blocks_named.detail, /no valid "#unloaded U 35937" entry/);
    });

    test('an unknown name fails blocks_named', async () => {
        const names = { ...truthNames, blockName: (b) => (b.name === 'pyrotech:rock' ? { name: 'unknown', meta: 0 } : truthNames.blockName(b)) };
        const c = byName(await run(blocks, sim({ names }), { seed: 7 }));
        assert.equal(c.blocks_named.pass, false);
        assert.match(c.blocks_named.detail, /unknown name "unknown"/);
    });

    test('a type that merges two blocks under one name fails on the runner-picked samples (finding 2)', async () => {
        // dirt:1 (coarse dirt) reported as dirt:0: one census type, two real blocks.
        const names = { ...truthNames, blockName: (b) => (b.name === 'dirt' ? { name: 'minecraft:dirt', meta: 0 } : truthNames.blockName(b)) };
        const r = await run(blocks, sim({ names }), { seed: 7 });
        const c = byName(r);
        assert.equal(c.blocks_named.pass, true, 'the census itself looks fine');
        assert.equal(c.blocks_confirmed.pass, false, c.blocks_confirmed.detail);
        assert.match(r.notes.blocksWrong.first.join(' | '), /minecraft:dirt 0 at .* had the data value of 1 \(expected: 0\)/);
    });

    test('air is left out of the census and minTypes even if a bot reports it', async () => {
        const chatEdit = (text) => (/^blocks [0-9a-f]+ 1\//.test(text) ? text.replace(/^(blocks [0-9a-f]+ 1\/\d+ )/, '$1minecraft:air 0 9999 10,70,-4; ') : text);
        const r = await run(blocks, sim({ chatEdit }), { seed: 7 });
        assert.equal(byName(r).blocks_named.pass, true, byName(r).blocks_named.detail);
        assert.match(byName(r).blocks_named.detail, /air left out/);
        assert.ok(!r.notes.census.some((b) => b.startsWith('minecraft:air')));
    });

    test('a census that hides a common type, or inflates a rare one, fails on the spot-check weighting (finding 2)', async () => {
        const drop = (text) => (text.startsWith('blocks ') ? text.replace(/(^| |; )minecraft:stone 0 \d+ [\d,\- ]+?(?=;|$)/, '$1').replace(/ ; /g, ' ').replace(/; ;/g, ';') : text);
        const r1 = await run(blocks, sim({ chatEdit: drop }), { seed: 7 });
        assert.equal(byName(r1).blocks_spotcheck.pass, false, byName(r1).blocks_spotcheck.detail);
        assert.match(byName(r1).blocks_spotcheck.detail, /census inconsistent: minecraft:stone 0: \d+ spot hits but not in the census/);
        // A type the census claims in bulk but the world does not have: only the "no spot hit" rule sees it.
        const invent = (text) => (/^blocks [0-9a-f]+ 1\//.test(text) ? text.replace(/^(blocks [0-9a-f]+ 1\/\d+ )/, '$1minecraft:diamond_block 0 9000 10,60,-4; ') : text);
        const r2 = await run(blocks, sim({ chatEdit: invent }), { seed: 7 });
        assert.equal(byName(r2).blocks_spotcheck.pass, false);
        assert.deepEqual(r2.notes.spotSkew.filter((x) => !x.startsWith('minecraft:diamond_block')), [], 'no other type is off');
        assert.match(byName(r2).blocks_spotcheck.detail, /census inconsistent: minecraft:diamond_block 0: census share 0\.\d+ but no spot hit/);
    });

    test('a wrong name or meta fails (the server, not the bot, decides)', async () => {
        const names = { ...truthNames, blockName: (b) => (b.name === 'gravel' ? { name: 'minecraft:sand', meta: 0 } : truthNames.blockName(b)) };
        const r = await run(blocks, sim({ names }), { seed: 7 });
        assert.equal(byName(r).blocks_confirmed.pass, false);
        assert.match(r.notes.blocksWrong.first.join(' | '), /is minecraft:gravel \(expected: minecraft:sand\)/);
    });

    test('a selective bot (perfect census, but it cannot name dirt) is caught by the spot checks', async () => {
        let inCensus = false;
        const names = { ...truthNames, blockName: (b) => (b.name === 'dirt' && !inCensus ? null : truthNames.blockName(b)) };
        const s = sim({ names });
        const orig = s.server.console;
        s.server.console = (cmd, w) => {
            if (cmd.includes('scenario-')) inCensus = cmd.includes('scenario-blocks ');
            return orig(cmd, w);
        };
        const c = byName(await run(blocks, s, { seed: 7 }));
        assert.equal(c.blocks_named.pass, true);
        assert.equal(c.blocks_confirmed.pass, true);
        assert.equal(c.blocks_spotcheck.pass, false);
        assert.match(c.blocks_spotcheck.detail, /"null 0" is not a registry name/);
    });

    test('weakened parameters are a smoke run, never a G2 pass', async () => {
        for (const params of [{ topN: 20 }, { spotChecks: 5 }, { radius: 8 }, { minTypes: 3 }, { candidates: 2 }, { samplesPerType: 1 }, { maxShareGap: 0.9 }, { bot: 'OTHER' }]) {
            const r = await run(blocks, sim(), { seed: 7, ...params });
            assert.equal(r.gateValid, false, JSON.stringify(params));
        }
    });

    test('no reply fails every naming check, with the reason', async () => {
        const s = sim();
        const orig = s.server.console;
        s.server.console = (cmd, w) => (cmd.startsWith('tell') ? orig('list', w) : orig(cmd, w));
        const c = byName(await run(blocks, s, { seed: 7, replyTimeoutMs: 5000, spotMaxPositions: 16 }));
        assert.match(c.blocks_named.detail, /no "blocks [0-9a-f]+" reply within 5s/);
        assert.equal(c.blocks_confirmed.pass, false);
        assert.equal(c.blocks_spotcheck.pass, false);
    });
});

describe('g2-mobs-named: the mob list comes from data (finding 1)', () => {
    const p = (o = {}) => ({ ...mobs.defaults, ...o });
    test('common-mobs.json with a modded mob is the gate list; extraMobs adds', () => {
        const c = chooseMobs(p(), DATA);
        assert.equal(c.notGate, null);
        assert.ok(c.mobs.includes('specialmobs:firecreeper'));
        assert.equal(c.mobs.length, 6);
        assert.deepEqual(chooseMobs(p({ maxMobs: 2 }), DATA).mobs, ['minecraft:zombie', 'minecraft:skeleton']);
        assert.match(chooseMobs(p({ maxMobs: 2 }), DATA).notGate, /lists no modded mob in its first 2/);
        assert.ok(chooseMobs(p({ extraMobs: 'minecraft:pig' }), DATA).mobs.includes('minecraft:pig'));
    });

    test('no common-mobs.json: the vanilla eight, and never a gate run; a hand-given list is never a gate run', () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-none-'));
        const c = chooseMobs(p(), empty);
        assert.deepEqual(c.mobs, VANILLA_COMMON_MOBS.split(','));
        assert.match(c.notGate, /common-mobs\.json is not available yet/);
        assert.match(chooseMobs(p({ mobs: 'minecraft:cow,specialmobs:firecreeper' }), DATA).notGate, /given by hand/);
        assert.deepEqual(readCommonMobs(path.join(DATA, 'packages/rotn-data/3.3.4/common-mobs.json')).slice(0, 2), ['minecraft:zombie', 'minecraft:skeleton']);
    });

    test('a run on the data list names every mob, modded ones included, and the server confirms them', async () => {
        const s = sim({ natural: [{ reg: 'minecraft:cow', pos: [14.5, 64, -1.5] }] });
        const r = await run(mobs, s, { dataRoot: DATA });
        assert.equal(r.checksPassed, true, JSON.stringify(r.checks, null, 1));
        assert.deepEqual(r.weakenedParams, [`dataRoot=${DATA} (gate needs = )`], 'only the fixture dataRoot keeps it from being a gate run');
        assert.match(byName(r).mobs_named.detail, /^6\/6 summoned mobs reported by registry name/);
        assert.match(byName(r).mobs_confirmed.detail, /^7\/7 reported entities confirmed by testfor/);
        assert.equal(s.entities.length, 1, 'only the natural cow is left');
        assert.equal(r.notes.mobSource, 'packages/rotn-data/3.3.4/common-mobs.json');
    });

    test('without the data file the run says why it is not a gate run', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-none-'));
        const r = await run(mobs, sim(), { dataRoot: empty });
        assert.equal(r.checksPassed, true);
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.some((w) => /common-mobs\.json is not available yet/.test(w)), JSON.stringify(r.weakenedParams));
    });

    test('a wrong or unknown modded mob name fails; a mob the server cannot summon fails with that reason', async () => {
        const names = { ...truthNames, entityName: (e) => (e.name === 'specialmobs:firecreeper' ? 'minecraft:creeper' : e.name === 'zombie' ? 'minecraft:unknown' : truthNames.entityName(e)) };
        const c = byName(await run(mobs, sim({ names }), { dataRoot: DATA }));
        assert.equal(c.mobs_named.pass, false);
        assert.match(c.mobs_named.detail, /specialmobs:firecreeper at .*reported as "minecraft:creeper"|minecraft:zombie at .*reported as "minecraft:unknown"/);
        assert.equal(c.mobs_confirmed.pass, false);
        const c2 = byName(await run(mobs, sim({ cannotSummon: ['minecraft:sheep'] }), { dataRoot: DATA }));
        assert.match(c2.mobs_named.detail, /minecraft:sheep: the server could not summon it \(Unable to summon object\)/);
    });
});

describe('g2-items-roundtrip on a simulated server', () => {
    test('30 vanilla items read, named, round-tripped; the full table checked through the module (finding 4)', async () => {
        const s = sim();
        const r = await run(items, s, { dataRoot: DATA });
        assert.equal(r.checksPassed, true, JSON.stringify(r.checks, null, 1));
        assert.match(byName(r).items_roundtrip.detail, /^30\/30 round-trip/);
        assert.match(byName(r).items_table.detail, /^agent naming \(src\/utils\/mcdata\.js toNew\/toOld\): mcdata\.js exports toNew and toOld; all 31 table entries round-trip through them; sample: all 30 in the table$/);
        assert.equal(s.inventory.length, 0, 'the inventory is cleared afterwards');
        assert.ok(TABLE.some((x) => x.name === 'minecraft:dye' && x.meta === 1 && x.expected === 'red_dye'), '1.21 names, as rotn-data toNew gives them');
    });

    test('items_table fails unless the agent naming check passes and the sample is a subset of the table', async () => {
        const wired = { wired: true, why: 'ok', failures: [] };
        assert.equal(checkFullTable(TABLE, wired, { repo: DATA }).ok, true);
        assert.equal(checkFullTable(TABLE, { wired: false, why: 'no toNew', failures: ['x'] }, { repo: DATA }).ok, false);
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-none-'));
        assert.match(checkFullTable(TABLE, wired, { repo: empty }).detail, /flattening-items\.json not available/);
        const short = writeData(fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-short-')), { tableEntries: [{ old: 'minecraft:log', meta: 0, new: 'oak_log' }] });
        const sub = checkFullTable(TABLE, wired, { repo: short });
        assert.equal(sub.ok, false);
        assert.match(sub.failures.join('\n'), /sample minecraft:coal:1=charcoal not in the table/);
        // In a run: an agent whose mcdata.js does not translate fails items_table and is not a gate run.
        const unwired = writeData(fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-g2-unw-')), { mcdataBody: 'export function getItemName() {}\n' });
        const r = await run(items, sim(), { dataRoot: unwired });
        assert.equal(byName(r).items_table.pass, false, 'G2 is gated on the full table through the agent');
        assert.match(byName(r).items_table.detail, /does not export toNew and toOld as functions/);
        assert.equal(r.gateValid, false);
        assert.equal(r.pass, false);
    });

    test('stock mineflayer names (no translation) fail items_named and items_roundtrip but pass items_read', async () => {
        const c = byName(await run(items, sim({ names: stockNames }), { dataRoot: DATA }));
        assert.equal(c.items_read.pass, true, c.items_read.detail);
        assert.equal(c.items_named.pass, false);
        assert.match(c.items_named.detail, /new name "null"/);
        assert.equal(c.items_roundtrip.pass, false);
    });

    test('a wrong new name, a broken way back, a misread meta, and an item the server cannot give each fail', async () => {
        const go = async (opt) => byName(await run(items, sim(opt), { dataRoot: DATA }));
        const wrongNew = { ...truthNames, toNew: (n, m) => (n === 'minecraft:dye' && m === 1 ? 'rose_red' : truthNames.toNew(n, m)) };
        assert.match((await go({ names: wrongNew })).items_named.detail, /minecraft:dye:1: new name "rose_red", expected "red_dye"/);
        const badBack = { ...truthNames, toOld: (nw) => (nw === 'charcoal' ? { name: 'minecraft:coal', meta: 0 } : truthNames.toOld(nw)) };
        assert.match((await go({ names: badBack })).items_roundtrip.detail, /minecraft:coal:1 -> charcoal -> minecraft:coal:0/);
        const misread = { ...truthNames, itemName: (i) => ({ ...truthNames.itemName(i), meta: i.name === 'wool' ? 0 : i.metadata }) };
        assert.match((await go({ names: misread })).items_read.detail, /minecraft:wool:14: not reported/);
        assert.match((await go({ cannotGive: ['minecraft:torch'] })).items_read.detail, /minecraft:torch:0: the server could not give it/);
    });

    test('item specs are validated; a different list is a smoke run', async () => {
        assert.throws(() => parseItems('log:0=oak_log'), /bad item spec/);
        assert.deepEqual(parseItems('minecraft:coal:1=charcoal'), [{ name: 'minecraft:coal', meta: 1, expected: 'charcoal' }]);
        const r = await run(items, sim(), { items: 'minecraft:coal:1=charcoal', dataRoot: DATA });
        assert.equal(r.checksPassed, true, JSON.stringify(r.checks, null, 1));
        assert.equal(r.gateValid, false);
    });
});
