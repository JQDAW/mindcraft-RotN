// Offline tests for S1 (test/scenarios/s1/, test/runner/lib/s1.mjs): the reply parsers on the 1.12
// reply forms, and the three S1 scenarios on a small simulated server with a fake mineflayer bot that
// runs the real driver side (attachG2 for the census, attachScenario for the whisper probe).
import './isolate-tmp.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers';
import { Vec3 } from 'vec3';
import { runScenario } from '../runner/lib/runner.mjs';
import { attachG2, attachScenario } from '../runner/drivers/scenario-protocol.mjs';
import {
    clearTestCount, clearTestCommand, scoreboardAddResult, playerScores, timeQuery, classifyCensus, dayCycleSummary,
    containerReason, loadBlockClasses, S1_CRITERIA, S1_NOT_GATE, ROCK_RE, TREE_RE,
} from '../runner/lib/s1.mjs';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import survey from '../scenarios/s1/s1-site-survey.mjs';
import arbiters, { whisperEvent } from '../scenarios/s1/s1-arbiters.mjs';
import dayCycle from '../scenarios/s1/s1-day-cycle.mjs';

const NAME = 'FRCFLD';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const L = (msg, logger = DS) => `[12:00:00] [Server thread/INFO] [${logger}]: ${msg}`;
const tick = () => new Promise((r) => setImmediate(r));
// An empty data root: no naming module and no block dump (the naming check only adds a notGate reason).
const NO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 's1-nodata-'));
/** A data root holding only rotn-data's block dump, with these block classes (name -> Java class). */
function dumpRoot(classes) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's1-dump-'));
    const dir = path.join(root, 'packages', 'rotn-data', '3.3.4');
    fs.mkdirSync(dir, { recursive: true });
    const blocks = Object.fromEntries(Object.entries(classes).map(([n, c]) => [n, { defaultMeta: 0, class: c, states: [] }]));
    fs.writeFileSync(path.join(dir, 'blocks.json.br'), zlib.brotliCompressSync(Buffer.from(JSON.stringify({ format: 'rotn-dump/1', blocks }))));
    return root;
}
const DUMP = dumpRoot({
    'minecraft:chest': 'net.minecraft.block.BlockChest',
    'pyrotech:rock': 'com.codetaylor.mc.pyrotech.modules.core.block.BlockRock',
    'mymod:thing': 'com.example.BlockTileEntityThing',   // a container only by its class
    'rustic:wildberry_bush': 'rustic.common.blocks.crops.BlockBerryBush',
});

describe('S1 reply parsers (1.12 en_us forms)', () => {
    test('clear in test mode: "has N items", and the failure form means 0', () => {
        assert.deepEqual(clearTestCount([L(`${NAME} has 3 items that match the criteria`)], NAME), { count: 3, line: `${NAME} has 3 items that match the criteria` });
        assert.equal(clearTestCount([L(`Could not clear the inventory of ${NAME}, no items to remove`)], NAME).count, 0);
        assert.equal(clearTestCount([L('OtherBot has 3 items that match the criteria')], NAME), null, 'another player');
        assert.equal(clearTestCount([L('There is no such item with name pyrotech:nope')], NAME), null, 'an unknown item is no count');
        assert.equal(clearTestCommand(NAME, 'minecraft:stone_pickaxe'), `clear ${NAME} minecraft:stone_pickaxe -1 0`, 'maxCount 0: never a real clear');
    });

    test('scoreboard objectives add: added, invalid, exists, too long, or unknown', () => {
        assert.equal(scoreboardAddResult([L("Added new objective 's1_c_table' successfully")], 's1_c_table'), 'added');
        const invalid = [L("Invalid objective criteria type 'stat.craftItem.pyrotech.crude_axe'")];
        assert.equal(scoreboardAddResult(invalid, 's1_c_crudeaxe', 'stat.craftItem.pyrotech.crude_axe'), 'invalid');
        assert.equal(scoreboardAddResult(invalid, 's1_c_ctools', 'stat.craftItem.contenttweaker.crafting_tools'), null, 'a reply about another criterion is not this one (#106 finding 4)');
        assert.equal(S1_CRITERIA.find((c) => c.criteria.endsWith('minecraft.cobblestone')).vanilla, false, 'no vanilla cobblestone recipe (#106 finding 3)');
        assert.equal(scoreboardAddResult([L("An objective with the name 's1_deaths' already exists")], 's1_deaths'), 'exists');
        assert.equal(scoreboardAddResult([L("The name 'a_very_long_objective' is too long for an objective, it can be at most 16 characters long")], 'a_very_long_objective'), 'too-long');
        assert.equal(scoreboardAddResult([L('Unknown command')], 'x'), null);
        for (const c of S1_CRITERIA) assert.ok(c.obj.length <= 16, `${c.obj}: objective names have at most 16 characters`);
    });

    test('scoreboard players list: scores by objective name, or none', () => {
        const lines = [L(`Showing 2 tracked objective(s) for ${NAME}:`), L('- s1_deaths: 0 (s1_deaths)'), L('- Played: 1234 (s1_played)'), L('Some later line')];
        assert.deepEqual(playerScores(lines, NAME), { s1_deaths: 0, s1_played: 1234 });
        assert.deepEqual(playerScores([L(`Player ${NAME} has no scores recorded`)], NAME), {});
        assert.equal(playerScores([L('nothing')], NAME), null);
    });

    test('time query', () => {
        assert.equal(timeQuery([L('Time is 13500')]), 13500);
        assert.equal(timeQuery([L('Time is now 13500')]), null);
    });

    test('census groups: rocks, trees, stone and containers by registry name', () => {
        for (const n of ['pyrotech:rock', 'pyrotech_compat:rock_igneous']) assert.ok(ROCK_RE.test(n), n);
        for (const n of ['pyrotech:rock_pile', 'pyrotech:pile_slag', 'minecraft:stone']) assert.ok(!ROCK_RE.test(n), n);
        for (const n of ['minecraft:log', 'minecraft:log2', 'dynamictrees:oakbranch', 'dynamictreesbop:sprucebranch', 'dynamictrees:trunkshell']) assert.ok(TREE_RE.test(n), n);
        for (const n of ['dynamictrees:leaves0', 'minecraft:leaves']) assert.ok(!TREE_RE.test(n), `${n}: leaves are not wood`);
        const g = classifyCensus([
            { name: 'undergroundbiomes:sedimentary_stone', meta: 0, count: 900, cand: [[1, 2, 3]] },
            { name: 'pyrotech:rock', meta: 0, count: 4, cand: [[5, 65, 5], [6, 65, 6]] },
            { name: 'minecraft:chest', meta: 2, count: 1, cand: [[9, 65, 9]] },
        ]);
        assert.deepEqual([g.stone.blocks, g.rocks.blocks, g.containers.blocks, g.trees.blocks], [900, 4, 1, 0]);
        assert.deepEqual(g.rocks.cand[1], { name: 'pyrotech:rock', meta: 0, pos: [6, 65, 6] });
    });

    test('containers fail closed: by name, as a vanilla inventory or spawner, or by the dump class (#106 finding 2)', () => {
        const classes = loadBlockClasses(DUMP);
        assert.equal(classes.get('mymod:thing'), 'com.example.BlockTileEntityThing');
        assert.equal(loadBlockClasses(NO_DATA), null, 'no dump: null, never an empty map');
        assert.equal(containerReason('minecraft:chest', null), 'vanilla inventory');
        assert.equal(containerReason('minecraft:furnace', null), 'vanilla inventory');
        assert.equal(containerReason('minecraft:mob_spawner', null), 'vanilla inventory', 'a spawner means a dungeon with loot chests');
        assert.equal(containerReason('quark:custom_chest', null), 'name');
        assert.equal(containerReason('basketcase:basket_small_generic', null), 'name');
        assert.equal(containerReason('mymod:thing', null), null, 'without the dump its class is unknown');
        assert.equal(containerReason('mymod:thing', classes), 'class BlockTileEntityThing');
        for (const n of ['minecraft:crafting_table', 'minecraft:stone', 'pyrotech:rock']) assert.equal(containerReason(n, classes), null, n);
        const g = classifyCensus([
            { name: 'mymod:thing', meta: 0, count: 1, cand: [[1, 65, 1]] },
            { name: 'rustic:wildberry_bush', meta: 0, count: 3, cand: [] },
            { name: 'minecraft:grass', meta: 0, count: 100, cand: [] },
        ], classes);
        assert.deepEqual(g.containers.types, ['mymod:thing 0 1 (class BlockTileEntityThing)']);
        assert.deepEqual(g.unclassifiedModded, ['rustic:wildberry_bush 0 3 <BlockBerryBush>'], 'every modded type no group claims is listed; vanilla ones are not');
    });

    test('day cycle: the median rate, the implied day length and the wraps', () => {
        const samples = [0, 60, 120, 180, 240].map((s, i) => ({ s, daytime: (23000 + i * 600) % 24000 }));
        samples.push({ s: 300, daytime: null });
        const r = dayCycleSummary(samples);
        assert.equal(r.ticksPerMinute, 600, 'half the vanilla rate');
        assert.equal(r.cycleMinutes, 40);
        assert.deepEqual(r.wraps, [{ s: 120, from: 23600, to: 200 }]);
        assert.deepEqual([r.samples, r.parsed], [6, 5]);
    });
});

/**
 * A small simulated 1.12 server plus a fake bot running the real driver side.
 *   opt.world(x, y, z): {name, meta}; opt.moddedStats: RotN stat criteria that exist; opt.ticksPerMinute
 *   opt.whisperName: the sender mineflayer reports for a console tell; opt.dropAtMs: the bot is kicked then
 *   opt.leftoverObjectives: objective names an earlier run left behind
 */
function sim(opt = {}) {
    const world = opt.world ?? ((x, y, z) => {
        if (y < 64) return { name: 'undergroundbiomes:sedimentary_stone', meta: 0 };
        if (y === 64) return { name: 'minecraft:grass', meta: 0 };
        if (y === 65 && x % 4 === 0 && z % 4 === 0) return { name: 'pyrotech:rock', meta: 0 };
        if (y >= 65 && y < 69 && x === 3 && z === -3) return { name: 'minecraft:log', meta: 0 };
        if (y === 65 && x === -3 && z === 2) return { name: 'rustic:wildberry_bush', meta: 0 };
        return { name: 'minecraft:air', meta: 0 };
    });
    const log = [];
    let t = 0;
    let online = false;
    let joinedAt = null;
    const inventory = new Map();
    const objectives = new Map((opt.leftoverObjectives ?? []).map((o) => [o, 'stat.deaths']));
    const vanillaStats = new Set(S1_CRITERIA.filter((c) => c.vanilla).map((c) => c.criteria));
    const add = (msg, logger = DS) => log.push(L(msg, logger));
    const output = [];
    const emit = (type, data = {}) => output.push(`DRIVER ${JSON.stringify({ type, ...data })}`);
    const fake = new EventEmitter();
    fake.entity = { position: new Vec3(0.5, 65, 0.5) };
    fake.blockAt = (v) => { const b = world(v.x, v.y, v.z); return { name: b.name.replace(/^minecraft:/, ''), metadata: b.meta, position: v }; };
    fake.chat = (text) => { if (online) add(`<${NAME}> ${text}`); };
    const names = { blockName: (b) => (b ? { name: b.name.includes(':') ? b.name : `minecraft:${b.name}`, meta: b.metadata } : null) };
    attachG2(fake, { names, pageDelayMs: 0, emit: () => {}, chunkWaitMs: 0, chunkPollMs: 1 });
    attachScenario(fake, { hello: null, emit });
    const daytime = () => Math.floor((1000 + (t / 60000) * (opt.ticksPerMinute ?? 600)) % 24000);
    const server = {
        console(cmd, waitS = 1) {
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 8796110535854059511');
            else if (cmd === `tp ${NAME} ~ ~ ~`) add(online ? `Teleported ${NAME} to 0.5, 65.0, 0.5` : 'Player not found');
            else if ((m = /^tell (\S+) (.*)$/.exec(cmd)) && online) {
                if (m[2].startsWith('s1-whisper-')) { if (!opt.noWhisper) fake.emit('whisper', opt.whisperName ?? 'Server', m[2]); }
                else fake.emit('messagestr', `Server whispers to you: ${m[2]}`);
            } else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+) (\d+)$/.exec(cmd))) {
                const b = world(Number(m[1]), Number(m[2]), Number(m[3]));
                const lie = opt.lieAbout === m[4];   // the server has something else wherever the bot names this block
                if (b.name === m[4] && b.meta === Number(m[5]) && !lie) add(`Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}`);
                else add(`The block at ${m[1]}, ${m[2]}, ${m[3]} is ${lie ? 'minecraft:air' : b.name} (expected: ${m[4]})`);
            } else if ((m = /^scoreboard objectives add (\S+) (\S+)$/.exec(cmd))) {
                if (objectives.has(m[1])) add(`An objective with the name '${m[1]}' already exists`);
                else if (vanillaStats.has(m[2]) || (opt.moddedStats ?? []).includes(m[2])) { objectives.set(m[1], m[2]); add(`Added new objective '${m[1]}' successfully`); }
                else add(`Invalid objective criteria type '${m[2]}'`);
            } else if ((m = /^scoreboard objectives remove (\S+)$/.exec(cmd))) {
                if (objectives.delete(m[1])) add(`Removed objective '${m[1]}' successfully`);
                else add(`No objective was found by the name '${m[1]}'`);
            } else if (cmd === `scoreboard players list ${NAME}`) {
                if (!objectives.size) add(`Player ${NAME} has no scores recorded`);
                else {
                    add(`Showing ${objectives.size} tracked objective(s) for ${NAME}:`);
                    for (const k of objectives.keys()) add(`- ${k}: 0 (${k})`);
                }
            } else if ((m = /^give (\S+) (\S+) 1 0$/.exec(cmd))) {
                inventory.set(m[2], (inventory.get(m[2]) ?? 0) + 1);
                add(`Given [${m[2]}] * 1 to ${m[1]}`);
            } else if ((m = /^clear (\S+) (\S+) (-?\d+) (\d+)$/.exec(cmd))) {
                const n = inventory.get(m[2]) ?? 0;
                if (m[4] !== '0') inventory.delete(m[2]);   // a real clear (never sent by S1)
                if (n === 0) add(`Could not clear the inventory of ${m[1]}, no items to remove`);
                else add(`${m[1]} has ${n} items that match the criteria`);
            } else if (cmd === 'time query daytime') add(opt.noTime ? 'Unknown command' : `Time is ${daytime()}`);
            else if (cmd === 'gamerule doDaylightCycle') add('doDaylightCycle = true');
            t += waitS * 1000;
            if (opt.dropAtMs && online && joinedAt !== null && t - joinedAt >= opt.dropAtMs) {
                online = false;
                add(`${NAME} lost connection: Disconnected`, 'net.minecraft.network.NetHandlerPlayServer');
            }
            return log.slice(before);
        },
        log: (n) => log.slice(-n),
    };
    let alive = false;
    const bot = {
        start() {
            alive = true;
            add(`UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`, 'net.minecraft.server.network.NetHandlerLoginServer');
            online = true;
            joinedAt = t;
            add(`${NAME} joined the game`);
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => output,
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 5; i++) await tick(); } };
    return { server, bot, clock, inventory, objectives, output };
}

const fast = { settleMs: 1000, pollMs: 1000, consoleWaitS: 0, dataRoot: NO_DATA };
const run = (scenario, s, params = {}) => runScenario(scenario, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));
/** S1 is never a gate pass (#106 finding 1): not gate-valid, and its reason is recorded. */
const neverGate = (r) => {
    assert.equal(r.gateValid, false);
    assert.equal(r.pass, false);
    assert.ok(r.weakenedParams.includes(S1_NOT_GATE), JSON.stringify(r.weakenedParams));
    assert.notEqual(r.verdict, 'PASS');
};

describe('s1-site-survey on a simulated server', () => {
    test('a complete census: rocks, trees and no containers, with sampled positions confirmed', async () => {
        const r = await run(survey, sim(), { radius: 6, dataRoot: DUMP });
        const c = byName(r);
        for (const k of ['login_online', 'census_complete', 'no_containers', 'findings_confirmed']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(r.verdict, 'SMOKE-PASS (not a gate pass)');
        neverGate(r);
        assert.deepEqual(r.notes.findings.unclassifiedModded, ['rustic:wildberry_bush 0 1 <BlockBerryBush>'], 'listed for the lead');
        assert.deepEqual(r.notes.findings.containerSignals, { names: true, vanillaInventory: true, dumpClasses: true });
        assert.deepEqual(r.notes.spawn, [0.5, 65, 0.5]);
        assert.equal(r.notes.findings.rocks.blocks, 9, 'rock piles where x and z are multiples of 4: x, z in {-4, 0, 4} within radius 6');
        assert.equal(r.notes.findings.trees.blocks, 4);
        assert.equal(r.notes.findings.containers.blocks, 0, 'no loot containers near spawn');
        assert.ok(r.notes.confirmed.length > 0 && r.notes.confirmed.every((x) => x.ok));
    });

    test('without rotn-data\'s block dump no_containers fails closed', async () => {
        const r = await run(survey, sim(), { radius: 6, dataRoot: NO_DATA });
        const c = byName(r).no_containers;
        assert.equal(c.pass, false);
        assert.match(c.detail, /block dump is missing.*fails closed/);
        neverGate(r);
    });

    test('a block that is a container only by its dump class is found', async () => {
        const world = (x, y, z) => (x === 1 && y === 65 && z === 1 ? { name: 'mymod:thing', meta: 0 }
            : y < 64 ? { name: 'minecraft:stone', meta: 0 } : { name: 'minecraft:air', meta: 0 });
        const r = await run(survey, sim({ world }), { radius: 4, dataRoot: DUMP });
        const c = byName(r).no_containers;
        assert.equal(c.pass, false);
        assert.equal(c.detail, 'CONTAINERS FOUND within 4 blocks: mymod:thing 0 1 (class BlockTileEntityThing)');
    });

    test('a chest near spawn is a finding, and the census lists it', async () => {
        const world = (x, y, z) => (x === -2 && y === 65 && z === 2 ? { name: 'minecraft:chest', meta: 2 }
            : y < 64 ? { name: 'minecraft:stone', meta: 0 } : { name: 'minecraft:air', meta: 0 });
        const r = await run(survey, sim({ world }), { radius: 5, dataRoot: DUMP });
        assert.equal(r.notes.findings.containers.blocks, 1);
        assert.deepEqual(r.notes.findings.containers.types, ['minecraft:chest 2 1 (vanilla inventory)']);
        assert.equal(byName(r).no_containers.pass, false, 'a container within the radius is reported prominently');
        assert.match(byName(r).no_containers.detail, /^CONTAINERS FOUND within 5 blocks: minecraft:chest 2 1/);
        assert.equal(byName(r).findings_confirmed.pass, true);
    });

    test('a position the server does not confirm fails findings_confirmed', async () => {
        const r = await run(survey, sim({ lieAbout: 'pyrotech:rock' }), { radius: 6, dataRoot: DUMP });
        const c = byName(r).findings_confirmed;
        assert.equal(c.pass, false);
        assert.match(c.detail, /not confirmed: -?\d+,65,-?\d+ pyrotech:rock 0: The block at/);
    });

    test('a census cut off at topN is not complete (rare rock types could be missing)', async () => {
        const r = await run(survey, sim(), { radius: 6, topN: 2 });
        assert.equal(byName(r).census_complete.pass, false);
    });
});

describe('s1-arbiters on a simulated server', () => {
    test('vanilla criteria added, modded ones found or not, clear counts without removing, time and whisper seen', async () => {
        const s = sim({ moddedStats: ['stat.craftItem.pyrotech.crude_axe'] });
        const r = await run(arbiters, s);
        const c = byName(r);
        for (const k of ['login_online', 'stat_criteria', 'clear_test', 'time_query', 'whisper_seen']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        const byCrit = Object.fromEntries(r.notes.statCriteria.map((x) => [x.criteria, x.result]));
        assert.equal(byCrit['stat.craftItem.pyrotech.crude_axe'], 'added');
        assert.equal(byCrit['stat.craftItem.contenttweaker.crafting_tools'], 'invalid', 'a missing RotN stat is a finding, not a failure');
        assert.equal(s.objectives.size, 0, 'the objectives are removed again');
        assert.deepEqual(r.notes.clearTest.counts['minecraft:stone_pickaxe'], [1, 1], 'the test mode removed nothing');
        assert.equal(s.inventory.get('minecraft:stone_pickaxe'), 1);
        assert.deepEqual(r.notes.whisper, { username: 'Server' });
        neverGate(r);
    });

    test('objectives an earlier run left are removed before adding, so the criteria are really tested (#106 finding 4)', async () => {
        const s = sim({ leftoverObjectives: ['s1_deaths', 's1_c_table'] });
        const r = await run(arbiters, s);
        const byCrit = Object.fromEntries(r.notes.statCriteria.map((x) => [x.criteria, x.result]));
        assert.equal(byCrit['stat.deaths'], 'added', 'not "exists"');
        assert.equal(byCrit['stat.craftItem.minecraft.crafting_table'], 'added');
        assert.equal(byName(r).stat_criteria.pass, true, byName(r).stat_criteria.detail);
        assert.equal(s.objectives.size, 0);
    });

    test('a missing vanilla criterion or an unknown reply fails stat_criteria', async () => {
        const s = sim();
        const orig = s.server.console;
        s.server.console = (cmd, w) => (cmd.includes('stat.deaths') ? [L('Unknown command. Try /help for a list of commands')] : orig(cmd, w));
        const r = await run(arbiters, s);
        assert.equal(byName(r).stat_criteria.pass, false);
        assert.match(byName(r).stat_criteria.detail, /stat\.deaths: no known reply/);
    });

    test('no whisper event, no time reply: those checks fail, with the reason', async () => {
        const r = await run(arbiters, sim({ noWhisper: true, noTime: true }), { whisperTimeoutMs: 3000 });
        assert.equal(byName(r).whisper_seen.pass, false);
        assert.match(byName(r).whisper_seen.detail, /no whisper event within 3s/);
        assert.equal(byName(r).time_query.pass, false);
    });

    test('the whisper sender is recorded as the bot saw it', async () => {
        const r = await run(arbiters, sim({ whisperName: 'CONSOLE' }));
        assert.deepEqual(r.notes.whisper, { username: 'CONSOLE' });
        assert.equal(byName(r).whisper_seen.pass, true);
    });

    test('whisperEvent reads only DRIVER whisper events with the token', () => {
        const out = ['noise', 'DRIVER {"type":"whisper","username":"Server","token":"abc123"}', 'DRIVER {broken'];
        assert.deepEqual(whisperEvent(out, 'abc123'), { type: 'whisper', username: 'Server', token: 'abc123' });
        assert.equal(whisperEvent(out, 'ffff00'), null);
    });
});

describe('s1-day-cycle on a simulated server', () => {
    test('measures the rate and the wraps over the duration', async () => {
        const r = await run(dayCycle, sim({ ticksPerMinute: 600 }), { durationMs: 60 * 60000, sampleMs: 60000 });
        const c = byName(r);
        for (const k of ['login_online', 'samples_ok', 'time_advances', 'stayed_online']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        neverGate(r);
        assert.equal(r.notes.cycle.ticksPerMinute, 600);
        assert.equal(r.notes.cycle.cycleMinutes, 40);
        assert.equal(r.notes.cycle.wraps.length, 1, 'one new day within the hour');
    });

    test('a dropped bot ends the measurement and fails stayed_online', async () => {
        const r = await run(dayCycle, sim({ dropAtMs: 5 * 60000 }), { durationMs: 30 * 60000, sampleMs: 60000 });
        assert.equal(byName(r).stayed_online.pass, false);
        assert.ok(r.notes.samples.length < 30);
    });

    test('no time replies: samples_ok and time_advances fail', async () => {
        const r = await run(dayCycle, sim({ noTime: true }), { durationMs: 5 * 60000, sampleMs: 60000 });
        assert.equal(byName(r).samples_ok.pass, false);
        assert.equal(byName(r).time_advances.pass, false);
    });
});
