// Offline tests for the G2 scenarios (test/scenarios/g2/) together with the real driver side
// (attachG2 in test/runner/drivers/scenario-protocol.mjs). A simulated 1.12 server (console, log,
// world, entities, inventory) runs on a virtual clock; a fake mineflayer bot runs the real driver code.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { Vec3 } from 'vec3';
import { runScenario } from '../runner/lib/runner.mjs';
import { attachG2, pages, stockNames } from '../runner/drivers/scenario-protocol.mjs';
import { replyPages, testforblockVerdict, testforVerdict, isRegistryName, prng } from '../runner/lib/g2.mjs';
import blocks from '../scenarios/g2/g2-blocks-named.mjs';
import mobs, { VANILLA_COMMON_MOBS } from '../scenarios/g2/g2-mobs-named.mjs';
import items, { VANILLA_SAMPLE, parseItems } from '../scenarios/g2/g2-items-roundtrip.mjs';

const NAME = 'FRCFLD';
const UUID_V4 = '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const tick = () => new Promise((r) => setImmediate(r));

// The world near spawn: bedrock-free columns of stone, dirt, grass and air, with some ore and modded rock.
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
    'minecraft:cow': 'Cow', 'minecraft:pig': 'Pig', 'minecraft:sheep': 'Sheep', 'minecraft:chicken': 'Chicken', 'specialmobs:firecreeper': 'Fire Creeper' };

/**
 * sim({ names, lieAbout, ... }): the server, the fake bot (real attachG2 inside) and a virtual clock.
 * names: the bot's naming adapter (default: a correct RotN-style one built from the sim's truth).
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
    fake.blockAt = (v) => { const b = blockAtWorld(v.x, v.y, v.z); return { name: bare(b.name), metadata: b.meta, position: v }; };
    fake.inventory = { items: () => inventory.slice() };
    fake.chat = (text) => { if (online) add(`<${NAME}> ${text}`); };
    attachG2(fake, { names: opt.names ?? truthNames, pageDelayMs: 0, emit: () => {} });

    const server = {
        console(cmd, waitS = 1) {
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
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
                    const e = { id: nextId++, reg: m[1], tag: m[5], type: 'mob', name: bare(m[1]), position: new Vec3(Number(m[2]), Number(m[3]), Number(m[4])) };
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
    // Natural mobs, if asked for (a wandering cow the bot also reports).
    for (const n of opt.natural ?? []) {
        const e = { id: nextId++, reg: n.reg, tag: null, type: 'mob', name: bare(n.reg), position: new Vec3(...n.pos) };
        entities.push(e);
        fake.entities[e.id] = e;
    }
    return { server, bot, clock, lines: log, entities, inventory };
}

// The correct adapter: full registry names from the (fake) registry, and a translation table.
const TABLE = parseItems(VANILLA_SAMPLE);
const truthNames = {
    blockName: (b) => (b ? { name: b.name.includes(':') ? b.name : `minecraft:${b.name}`, meta: b.metadata } : null),
    entityName: (e) => (e.name.includes(':') ? e.name : `minecraft:${e.name}`),
    itemName: (i) => ({ name: i.name.includes(':') ? i.name : `minecraft:${i.name}`, meta: i.metadata }),
    toNew: (n, meta) => TABLE.find((x) => x.name === n && x.meta === meta)?.expected ?? null,
    toOld: (nw) => { const x = TABLE.find((y) => y.expected === nw); return x ? { name: x.name, meta: x.meta } : null; },
};
const fast = { settleMs: 1000, seeMs: 1000, pollMs: 1000, consoleWaitS: 0, replyTimeoutMs: 30000 };
const run = (scenario, s, params = {}) => runScenario(scenario, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('G2 helpers', () => {
    test('registry names: full ns:path only; unknown, null and numbers are not names', () => {
        for (const n of ['minecraft:stone', 'pyrotech:rock', 'contenttweaker:raw_iron', 'minecraft:log2']) assert.ok(isRegistryName(n), n);
        for (const n of ['stone', 'null', 'unknown', 'minecraft:unknown', 'pyrotech:unknown_block', '1:0', '', null, 42, 'Minecraft:Stone']) assert.ok(!isRegistryName(n), String(n));
    });

    test('pages: chat-sized pages, at least one; replyPages reassembles them in order and spots missing pages', () => {
        const entries = Array.from({ length: 30 }, (_, i) => `minecraft:block_number_${i} 0 ${100 - i} 1 2 3`);
        const ps = pages('blocks', 'abcdef', entries);
        assert.ok(ps.length > 1 && ps.every((l) => l.length <= 240), ps.map((l) => l.length).join(','));
        assert.deepEqual(pages('blocks', 'abcdef', []), ['blocks abcdef 1/1']);
        const line = (text) => `[12:00:00] [Server thread/INFO] [${DS}]: <${NAME}> ${text}`;
        const all = replyPages(ps.slice().reverse().map(line), NAME, 'blocks', 'abcdef');
        assert.equal(all.complete, true);
        assert.deepEqual(all.entries.map((e) => e[0]), entries.map((e) => e.split(' ')[0]));
        const part = replyPages(ps.slice(1).map(line), NAME, 'blocks', 'abcdef');
        assert.equal(part.complete, false);
        assert.equal(replyPages([line('blocks other 1/1 x 0 1 1 2 3')], NAME, 'blocks', 'abcdef'), null);
        assert.equal(replyPages([`[12:00:00] [Server thread/INFO] [${DS}]: [Server] <${NAME}> blocks abcdef 1/1 x 0 1 1 2 3`], NAME, 'blocks', 'abcdef'), null, 'the console cannot speak for the bot');
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

describe('g2-blocks-named on a simulated server', () => {
    test('a bot with correct names passes; the server confirmed every name', async () => {
        const s = sim();
        const r = await run(blocks, s, { seed: 7 });
        assert.equal(r.pass, true, JSON.stringify(r.checks, null, 1));
        const c = byName(r);
        assert.match(c.blocks_confirmed.detail, /^(\d+)\/\1 confirmed by testforblock/);
        assert.match(c.blocks_spotcheck.detail, /^40\/40 random positions named and confirmed \(seed 7\)/);
        assert.ok(r.notes.blocks.some((b) => b.startsWith('pyrotech:rock 6 ')), 'the modded block is in the top list');
        assert.ok(s.lines.filter((l) => l.includes('testforblock') || l.includes('Successfully found')).length > 40);
    });

    test('an unknown name fails blocks_named', async () => {
        const names = { ...truthNames, blockName: (b) => (b.name === 'pyrotech:rock' ? { name: 'unknown', meta: 0 } : truthNames.blockName(b)) };
        const c = byName(await run(blocks, sim({ names }), { seed: 7 }));
        assert.equal(c.blocks_named.pass, false);
        assert.match(c.blocks_named.detail, /unknown: \["unknown"\]/);
    });

    test('a wrong name or meta fails blocks_confirmed (the server, not the bot, decides)', async () => {
        const names = { ...truthNames, blockName: (b) => (b.name === 'dirt' ? { name: 'minecraft:gravel', meta: 0 } : b.name === 'stone' ? { name: 'minecraft:stone', meta: 0 } : truthNames.blockName(b)) };
        const r = await run(blocks, sim({ names }), { seed: 7 });
        const c = byName(r);
        assert.equal(c.blocks_named.pass, true, 'well-formed names');
        assert.equal(c.blocks_confirmed.pass, false);
        const wrong = r.notes.blocksWrong.first.join(' | ');
        assert.match(wrong, /is minecraft:dirt \(expected: minecraft:gravel\)/);
        assert.match(wrong, /had the data value of 5 \(expected: 0\)/);
        assert.equal(c.blocks_spotcheck.pass, false);
    });

    test('a bot that leaves its unknown blocks out of the top list is caught by the spot checks', async () => {
        // A selective bot: its top list looks perfect (dirt correctly named there), but it cannot really
        // name dirt; random positions the runner picks still hit dirt.
        let inTopList = false;
        const names = { ...truthNames, blockName: (b) => (b.name === 'dirt' && !inTopList ? null : truthNames.blockName(b)) };
        const s = sim({ names });
        const orig = s.server.console;
        s.server.console = (cmd, w) => {
            if (cmd.includes('scenario-')) inTopList = cmd.includes('scenario-blocks ');
            return orig(cmd, w);
        };
        const r = await run(blocks, s, { seed: 7 });
        const c = byName(r);
        assert.equal(c.blocks_named.pass, true, 'the top list alone would pass');
        assert.equal(c.blocks_confirmed.pass, true, 'and the server confirms it');
        assert.equal(c.blocks_spotcheck.pass, false, c.blocks_spotcheck.detail);
        assert.match(c.blocks_spotcheck.detail, /"null 0" is not a registry name/);
    });

    test('weakened parameters are a smoke run, never a G2 pass', async () => {
        for (const params of [{ topN: 20 }, { spotChecks: 5 }, { radius: 8 }, { minTypes: 3 }, { bot: 'OTHER' }]) {
            const r = await run(blocks, sim(), { seed: 7, ...params });
            assert.equal(r.pass, false, JSON.stringify(params));
            assert.equal(r.gateValid, false, JSON.stringify(params));
        }
    });

    test('no reply fails every naming check, with the reason', async () => {
        const s = sim();
        const orig = s.server.console;
        s.server.console = (cmd, w) => (cmd.startsWith('tell') ? orig('list', w) : orig(cmd, w));
        const c = byName(await run(blocks, s, { seed: 7, replyTimeoutMs: 5000 }));
        assert.match(c.blocks_named.detail, /no "blocks [0-9a-f]+" reply within 5s/);
        assert.equal(c.blocks_confirmed.pass, false);
        assert.equal(c.blocks_spotcheck.pass, false);
    });
});

describe('g2-mobs-named on a simulated server', () => {
    test('summoned mobs and a natural one, all named and confirmed; summons are tagged and removed', async () => {
        const s = sim({ natural: [{ reg: 'minecraft:cow', pos: [14.5, 64, -1.5] }] });
        const r = await run(mobs, s);
        assert.equal(r.pass, true, JSON.stringify(r.checks, null, 1));
        assert.match(byName(r).mobs_named.detail, /^8\/8 summoned mobs reported by registry name/);
        assert.match(byName(r).mobs_confirmed.detail, /^9\/9 reported entities confirmed by testfor/);
        assert.equal(s.entities.length, 1, 'only the natural cow is left');
        assert.ok(s.lines.some((l) => /summon minecraft:zombie|Object successfully summoned/.test(l)));
        assert.equal(VANILLA_COMMON_MOBS.split(',').length, 8);
    });

    test('a wrong or unknown mob name fails; a mob the server cannot summon fails mobs_named with that reason', async () => {
        const names = { ...truthNames, entityName: (e) => (e.name === 'creeper' ? 'minecraft:unknown' : e.name === 'pig' ? 'minecraft:cow' : truthNames.entityName(e)) };
        const c = byName(await run(mobs, sim({ names })));
        assert.equal(c.mobs_named.pass, false);
        assert.match(c.mobs_named.detail, /minecraft:creeper at .*reported as "minecraft:unknown"/);
        assert.equal(c.mobs_confirmed.pass, false);
        const c2 = byName(await run(mobs, sim({ cannotSummon: ['minecraft:sheep'] })));
        assert.match(c2.mobs_named.detail, /minecraft:sheep: the server could not summon it \(Unable to summon object\)/);
    });

    test('extraMobs adds modded mobs (still a gate run); another mob list is a smoke run', async () => {
        const r = await run(mobs, sim(), { extraMobs: 'specialmobs:firecreeper' });
        assert.equal(r.pass, true, JSON.stringify(r.checks, null, 1));
        assert.match(byName(r).mobs_named.detail, /^9\/9/);
        const smoke = await run(mobs, sim(), { mobs: 'minecraft:cow' });
        assert.equal(smoke.gateValid, false);
    });
});

describe('g2-items-roundtrip on a simulated server', () => {
    test('30 vanilla items given by 1.12 name: read, named in 1.21 style and round-tripped', async () => {
        const s = sim();
        const r = await run(items, s);
        assert.equal(r.pass, true, JSON.stringify(r.checks, null, 1));
        assert.match(byName(r).items_roundtrip.detail, /^30\/30 round-trip/);
        assert.equal(s.inventory.length, 0, 'the inventory is cleared afterwards');
        assert.equal(TABLE.length, 30);
        assert.ok(TABLE.some((x) => x.name === 'minecraft:dye' && x.meta === 1 && x.expected === 'red_dye'), '1.21 names, as rotn-data toNew gives them');
    });

    test('stock mineflayer names (no translation) fail items_named and items_roundtrip but pass items_read', async () => {
        const c = byName(await run(items, sim({ names: stockNames })));
        assert.equal(c.items_read.pass, true, c.items_read.detail);
        assert.equal(c.items_named.pass, false);
        assert.match(c.items_named.detail, /new name "null"/);
        assert.equal(c.items_roundtrip.pass, false);
    });

    test('a wrong new name, a broken way back, a misread meta, and an item the server cannot give each fail', async () => {
        const wrongNew = { ...truthNames, toNew: (n, m) => (n === 'minecraft:dye' && m === 1 ? 'rose_red' : truthNames.toNew(n, m)) };
        assert.match(byName(await run(items, sim({ names: wrongNew }))).items_named.detail, /minecraft:dye:1: new name "rose_red", expected "red_dye"/);
        const badBack = { ...truthNames, toOld: (nw) => (nw === 'charcoal' ? { name: 'minecraft:coal', meta: 0 } : truthNames.toOld(nw)) };
        assert.match(byName(await run(items, sim({ names: badBack }))).items_roundtrip.detail, /minecraft:coal:1 -> charcoal -> minecraft:coal:0/);
        const misread = { ...truthNames, itemName: (i) => ({ ...truthNames.itemName(i), meta: i.name === 'wool' ? 0 : i.metadata }) };
        assert.match(byName(await run(items, sim({ names: misread }))).items_read.detail, /minecraft:wool:14: not reported/);
        assert.match(byName(await run(items, sim({ cannotGive: ['minecraft:torch'] }))).items_read.detail, /minecraft:torch:0: the server could not give it/);
    });

    test('item specs are validated; a different list is a smoke run', async () => {
        assert.throws(() => parseItems('log:0=oak_log'), /bad item spec/);
        assert.deepEqual(parseItems('minecraft:coal:1=charcoal'), [{ name: 'minecraft:coal', meta: 1, expected: 'charcoal' }]);
        const r = await run(items, sim(), { items: 'minecraft:coal:1=charcoal' });
        assert.equal(r.checksPassed, true);
        assert.equal(r.gateValid, false);
    });
});
