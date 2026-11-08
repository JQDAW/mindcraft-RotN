// Offline tests for G4 #7 (with #2, #4, #5), test/scenarios/g4/g4-soak-2h.mjs, and its journal parsers
// (test/runner/lib/survival.mjs). A simulated test server (1.12 log lines) and a simulated CX23 service whose journal
// fills over simulated time with the agent's own lines: !nearbyBlocks, [survival] food/ate/fight/flee, [death], the
// agenda. Fakes only: no server, no ssh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import soak, { NAMING_MIN_KINDS, TBD } from '../scenarios/g4/g4-soak-2h.mjs';
import { agentExits, blockNameProblem, deathEvents, entityNamingAtStart, isAir, llmUsage, namingAtStart, nearbyBlocksResults, survivalEvents } from '../runner/lib/survival.mjs';

const NAME = 'FRCFLD';
const MIN = 60000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;
// A real !nearbyBlocks result, as agent.js logs it (copied from test/evidence/g3/g3a-20261105/rocks/driver.log 149-158 and
// g3a-20261107-gate 460-463): the header on the line after "and got: ", a liquid with "(source)", the Block lines.
// The [naming] lines, copied from the merged src/agent/library/naming_report.test.js (#396: lines 53, 58, 64, 92, 98,
// 145) and from #397's body (the entity keys by type).
const NAMING_OK = '[naming] FRCFLD near spawn: 6 kinds; unknown 0; stone:100 dirt:60 dynamictrees:leaves0:20 grass:20 undergroundbiomes:metamorphic_stone:7 water:5';
const NAMING_EMPTY = '[naming] FRCFLD near spawn: 0 kinds; unknown 0;';
const NAMING_UNKNOWN = '[naming] FRCFLD near spawn: 9 kinds; unknown 7; stone:50 dirt:40 #4321:2:12 unknown:6 1234:4 #4322:0:3 4321:2:2 #97:5:1 rustic:unknown_block:1';
const NAMING_THREE = '[naming] FRCFLD near spawn: 3 kinds; unknown 0; stone:30 dirt:20 grass:5';
const ENTITIES_OK = '[naming] FRCFLD entities +120s: 1 kinds; unknown 0; cow:1';
const ENTITIES_NONE = '[naming] FRCFLD entities +240s: 0 kinds; unknown 0;';
const ENTITIES_396 = '[naming] FRCFLD entities +0s: 7 kinds; unknown 4; cow:2 #77:1 #?:1 mocreatures:entity_12:1 quark:crab:1 unknown:1 zombie:1';
const ENTITIES_397 = '[naming] FRCFLD entities +0s: 4 kinds; unknown 3; #mocreatures:12:2 #300:1 #5:1 quark:crab:1';
// naming_report.js line 116 (merged): console.warn(`[naming] near spawn: could not read the world (${err?.message ?? err})`)
const NAMING_WARNING = '[naming] near spawn: could not read the world (bot.entity is undefined)';
const REAL_NEARBY = ['Agent executed: !nearbyBlocks and got: ', 'NEARBY_BLOCKS', '- dynamictrees:trunkshell', '- biomesoplenty:plant_0', '- dirt',
    '- dynamictrees:sprucebranch', '- grass', '- tallgrass', '- dynamictrees:rootydirt', '- water (source)', '- rustic:cohosh',
    '- Block Below: undergroundbiomes:metamorphic_stone', '- Block at Legs: air', '- Block at Head: air', '- First Solid Block Above Head: none', ''];

/**
 * opt.driver (set-up T); opt.badName (a name in the !nearbyBlocks result); opt.noNearby; opt.memoryMb (per sample);
 * opt.nRestartsAt (minute when systemd restarts it); opt.agentRestartAt (an agent_process restart line); opt.leaveAt
 * (minute the bot leaves for good); opt.noAgenda; opt.lowFood (food drops to it once); opt.noEatAfterLow;
 * opt.deaths (minutes of deaths); opt.unreported (deaths with no report); opt.unitBot; opt.unitActive;
 * opt.nearbyAt (minute of the !nearbyBlocks result, default 3); opt.sameLineHeader; opt.nearbyNone (an empty result first);
 * opt.costUsd (per completion, default 0.0002); opt.unknownCost (one completion's cost unknown); opt.noUsage;
 * opt.refreshFailAt (minute from which journal reads fail; opt.refreshOkAt, the minute they work again). As in the
 * adapter, output() is then the cached journal of the last good read (#394 re-review), not the live one.
 * opt.unknownFrom/opt.unknownUntil (minutes the unit's state is 'unknown': status and metrics reads fail, alive() false,
 * stateUnknown set); opt.cutStart (the read lost the "Starting mindcraft-rotn@" line to the ctl's line cap);
 * opt.naming (the "[naming] ... near spawn" line at minute 0.9, NAMING_OK by default; null: none); opt.entities (the
 * entity line at minute 2, ENTITIES_OK by default; null: none).
 */
function sim(opt = {}) {
    let t = 0;
    const log = [];
    const journal = [];
    const unit = { state: opt.unitActive ? 'active' : 'inactive', nrestarts: 0 };
    let started = null;
    let online = false;
    const add = (msg) => log.push(line(t, msg));
    const jr = (...msgs) => journal.push(...msgs);
    const done = new Set();
    let cache = [];
    const sinceStart = () => (started === null ? -1 : (t - started) / MIN);
    const within = (from, until) => from !== undefined && sinceStart() >= from && (until === undefined || sinceStart() < until);
    const readOk = () => !within(opt.refreshFailAt, opt.refreshOkAt) && !within(opt.unknownFrom, opt.unknownUntil);
    const statusOk = () => !within(opt.unknownFrom, opt.unknownUntil);
    let stateUnknown = null;
    const read = () => { if (readOk()) cache = opt.cutStart ? journal.slice(1) : [...journal]; return readOk(); };
    // The bot's own lines, written as simulated time passes (once each).
    const at = (min, key, fn) => { if (started !== null && t - started >= min * MIN && !done.has(key)) { done.add(key); fn(); } };
    const advance = () => {
        if (started === null) return;
        at(0.3, 'join', () => { online = true; log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`); add(`${NAME} joined the game`); });
        if (opt.naming !== null) at(0.9, 'naming', () => jr(opt.naming ?? NAMING_OK));
        if (opt.entities !== null) at(2, 'entities', () => jr(opt.entities ?? ENTITIES_OK));
        if (opt.nearbyNone) at(2, 'nearbyNone', () => jr('Agent executed: !nearbyBlocks and got: ', 'NEARBY_BLOCKS: none', ''));
        if (!opt.noNearby) {
            at(opt.nearbyAt ?? 3, 'nearby', () => {
                const block = [...REAL_NEARBY];
                if (opt.badName) block.splice(3, 0, `- ${opt.badName}`);
                if (opt.sameLineHeader) block.splice(0, 2, 'Agent executed: !nearbyBlocks and got: NEARBY_BLOCKS');
                jr(...block);
            });
        }
        for (let m = 1; m <= 125; m++) {
            at(m, `food${m}`, () => jr(`[survival] food ${opt.lowFood !== undefined && m === 50 ? opt.lowFood : 18} health 20 (${opt.lowFood !== undefined && m === 50 ? 'low' : 'check'})`));
            // the eat at 51.5 min, in time order with the food lines (a sample writes all lines that came due since the last one)
            if (m === 51 && opt.lowFood !== undefined && !opt.noEatAfterLow) at(51.5, 'eat', () => jr('[survival] ate minecraft:bread:0 food 5->10'));
        }
        at(30, 'fight', () => jr('[survival] fight start zombie (shelter)', '[survival] fight end zombie killed after 6 s'));
        at(35, 'flee', () => jr('[survival] flee creeper (low health)'));
        for (let m = 1; m <= 125; m += 1) {
            at(m, `llm${m}`, () => {
                jr('[openrouter] provider Wafer, finish_reason stop, content 300 chars');
                if (!opt.noUsage) jr(`[openrouter] usage prompt_tokens 900, completion_tokens 80, cost_usd ${opt.unknownCost && m === 7 ? 'unknown' : opt.costUsd ?? 0.0002}`);
            });
        }
        if (!opt.noAgenda) at(40, 'agenda', () => { jr('agenda done'); add(`<${NAME}> agenda done`); });
        for (const d of opt.deaths ?? []) at(d, `death${d}`, () => { jr('[death] died at 1, 64, 2; waiting for the respawn'); if (!(opt.unreported ?? []).includes(d)) jr('[death] died at 1, 64, 2 (Zombie); lost 3 minecraft:dirt:0'); });
        if (opt.agentRestartAt) at(opt.agentRestartAt, 'arestart', () => jr(`[agent_process] ${NAME}: network; restarting in 10 s.`));
        if (opt.nRestartsAt) at(opt.nRestartsAt, 'nrestart', () => { unit.nrestarts++; });
        if (opt.leaveAt) at(opt.leaveAt, 'leave', () => { online = false; add(`${NAME} lost connection: Disconnected`); add(`${NAME} left the game`); unit.state = 'failed'; });
    };
    const server = {
        console(cmd, waitS = 1) {
            advance();
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            t += waitS * 1000;
            advance();
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(-n); },
    };
    let sampleN = 0;
    const bot = {
        ...(opt.driver ? {} : { kind: 'service', bot: opt.unitBot ?? 'frcfld',
            refresh: () => { advance(); return read() ? Promise.resolve() : Promise.reject(new Error("service journal: 'journal frcfld' exited 255")); } }),
        start() { started = t; unit.state = 'active'; jr('Starting mindcraft-rotn@frcfld.service - Mindcraft RotN bot frcfld...'); return Promise.resolve(); },
        alive() { advance(); if (!opt.driver && !statusOk()) stateUnknown = stateUnknown ?? { since: `minute ${Math.round(sinceStart())}`, failures: 3 }; return statusOk() && unit.state === 'active'; },
        needsStop: () => unit.state === 'active',
        exitCode: () => null,
        exitSignal: () => null,
        unitState: () => (statusOk() ? unit.state : 'unknown'),
        output: () => { advance(); if (opt.driver) return journal; read(); return cache; },
        metrics() {
            advance();
            if (!statusOk()) return Promise.reject(new Error("service metrics: 'metrics frcfld' exited 255"));
            const mb = opt.memoryMb ? opt.memoryMb[Math.min(sampleN++, opt.memoryMb.length - 1)] : 300;
            return Promise.resolve({ MemoryCurrent: mb * 1048576, MemoryPeak: '[not set]', NRestarts: unit.nrestarts, ActiveState: unit.state });
        },
        stop() { unit.state = 'inactive'; return Promise.resolve(); },
    };
    if (!opt.driver) Object.defineProperty(bot, 'stateUnknown', { get: () => stateUnknown });
    const clock = { now: () => t, sleep: async (ms) => { t += ms; advance(); for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, unit };
}
const run = (s, params = {}) => runScenario(soak, { ...s, runId: 'r1', params: { consoleWaitS: 0, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('g4-soak-2h: the module and the journal parsers', () => {
    test('G4, no runner LLM accounting; the targets are TBD placeholders; runMinutes', () => {
        assert.equal(soak.gate, 'G4');
        assert.equal(soak.llm, false);
        assert.equal(soak.defaults.peakMemoryMaxMb, TBD);
        assert.equal(soak.defaults.usdPerHourMax, TBD);
        assert.equal(soak.defaults.durationMinutes, 120);
        assert.equal(soak.defaults.sampleMinutes, 5);
        assert.equal(soak.runMinutes(soak.defaults), 125);
        assert.deepEqual(Object.keys(soak.checks), ['login_online', 'naming', 'no_crash', 'peak_memory', 'usd_per_hour', 'agenda_done', 'food_floor', 'ate_when_low', 'deaths_reported']);
    });

    test('survivalEvents, deathEvents, nearbyBlocksResults, blockNameProblem, agentExits', () => {
        const sv = survivalEvents(['[survival] ate minecraft:bread:0 food 5->10', '[survival] fight start zombie (open)', '[survival] fight end zombie gone after 4 s',
            '[survival] flee creeper (low health)', '[survival] food 12 health 18.5 (low)', '[survival] food unknown health 20 (check)', 'x']);
        assert.deepEqual([sv.ate.length, sv.fightStart.length, sv.fightEnd[0].outcome, sv.flee[0].why, sv.food[0].food, sv.food[0].reason, sv.food[1].food], [1, 1, 'gone', 'low health', 12, 'low', null]);
        const de = deathEvents(['[death] died at 1, 2, 3; waiting for the respawn', '[death] died at 1, 2, 3 (Zombie); lost nothing', '[death] chat: x']);
        assert.deepEqual([de.deaths.length, de.reports.length], [1, 1]);
        // #394 review: the real format (the header on the next line or the same), liquids' suffix, the Block lines, none.
        assert.deepEqual(nearbyBlocksResults(REAL_NEARBY), [{ at: 0, none: false, names: ['dynamictrees:trunkshell', 'biomesoplenty:plant_0', 'dirt', 'dynamictrees:sprucebranch',
            'grass', 'tallgrass', 'dynamictrees:rootydirt', 'water', 'rustic:cohosh', 'undergroundbiomes:metamorphic_stone', 'air', 'air'] }]);
        assert.deepEqual(nearbyBlocksResults(['Agent executed: !nearbyBlocks and got: NEARBY_BLOCKS', '- stone', '- First Solid Block Above Head: leaves (3 blocks up)']),
            [{ at: 0, none: false, names: ['stone', 'leaves'] }]);
        assert.deepEqual(nearbyBlocksResults(['Agent executed: !nearbyBlocks and got: ', 'NEARBY_BLOCKS: none']), [{ at: 0, none: true, names: [] }]);
        assert.deepEqual(nearbyBlocksResults(['Agent executed: !nearbyBlocks and got: ', 'NEARBY_BLOCKS', '- water (flowing)']), [{ at: 0, none: false, names: ['water'] }]);
        assert.deepEqual(llmUsage(['[openrouter] usage prompt_tokens 10, completion_tokens 5, cost_usd 0.0001', '[openrouter] usage prompt_tokens 1, completion_tokens 1, cost_usd 0.00025',
            '[openrouter] usage prompt_tokens unknown, completion_tokens unknown, cost_usd unknown', '[openrouter] provider Wafer']), { lines: 3, known: 2, unknown: 1, usd: 0.00035 });
        for (const n of ['dirt', 'grass', 'dynamictrees:trunkshell', 'biomesoplenty:plant_0', 'minecraft:stone']) assert.equal(blockNameProblem(n), null, n);
        assert.deepEqual(['1', '35:2', 'unknown', 'mod:unknown_block', 'block_123', 'mod:entity_7', 'Dirt', '', 'undefined', 'null'].map(blockNameProblem),
            ['a numeric id', 'a numeric id', 'unknown', 'unknown', 'a placeholder', 'a placeholder', 'not a registry name', 'empty', 'undefined', 'null']);
        assert.equal(agentExits(['[agent_process] FRCFLD: network; restarting in 10 s.', 'Agent process exited with code 1 and signal null', '[agent_process] OTHER: x; restarting in 1 s.', 'y'], NAME).length, 2);
    });
});

describe('g4-soak-2h on a simulated service', () => {
    test('two hours, all well: every check passes but the two TBD targets, which are not reached with the measurement; not-gate (TBD)', async () => {
        const r = await run(sim({ memoryMb: [300, 420, 610, 580] }));
        const c = byName(r);
        for (const k of ['login_online', 'naming', 'no_crash', 'agenda_done', 'food_floor', 'ate_when_low', 'deaths_reported']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(c.peak_memory.pass, false);
        assert.equal(c.peak_memory.detail, 'not reached: no target yet (TBD); measured peak 610 MB');
        assert.match(c.usd_per_hour.detail, /^not reached: no target yet \(TBD\); measured USD 0\.012\/h \(USD 0\.024 over 120 min, 120 completions\)$/);
        assert.equal(r.notes.samples.length, 25, 'one at the start and every 5 min for 120 min');
        assert.deepEqual(r.notes.survival, { eats: 0, fights: 1, fightOutcomes: { killed: 1 }, flees: 1, foodLines: 120 });
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.some((w) => /targets are TBD/.test(w)));
    });

    test('with the targets set: peak memory passes within it and fails above it', async () => {
        const ok = byName(await run(sim({ memoryMb: [300, 500] }), { peakMemoryMaxMb: 1024, usdPerHourMax: 0.05 }));
        assert.equal(ok.peak_memory.pass, true);
        assert.equal(ok.peak_memory.detail, 'peak 500 MB (target 1024 MB)');
        assert.equal(ok.usd_per_hour.pass, true);
        assert.match(ok.usd_per_hour.detail, /^USD 0\.012\/h \(target 0\.05; USD 0\.024 over 120 min, 120 completions\)$/);
        const costly = byName(await run(sim({ costUsd: 0.002 }), { peakMemoryMaxMb: 1024, usdPerHourMax: 0.05 }));
        assert.equal(costly.usd_per_hour.pass, false);
        assert.match(costly.usd_per_hour.detail, /^USD 0\.12\/h \(target 0\.05;/);
        const over = byName(await run(sim({ memoryMb: [300, 1400] }), { peakMemoryMaxMb: 1024, usdPerHourMax: 0.05 }));
        assert.equal(over.peak_memory.pass, false);
        assert.equal(over.peak_memory.detail, 'peak 1400 MB (target 1024 MB)');
    });

    test('naming (#2): a bad !nearbyBlocks name is a note, never the verdict; no [naming] line fails', async () => {
        const r = await run(sim({ badName: '35:2' }));
        assert.equal(byName(r).naming.pass, true, 'the [naming] line decides');
        assert.deepEqual(r.notes.nearbyBlocks.problems, [['35:2', 'a numeric id']]);
        const none = byName(await run(sim({ naming: null })));
        assert.equal(none.naming.pass, false);
        assert.equal(none.naming.detail, 'no "[naming] FRCFLD near spawn" line: the release lacks #396, or the bot never spawned');
    });

    test('no_crash (#7): systemd restarted it, an agent_process restart, or it left: each fails, named', async () => {
        assert.match(byName(await run(sim({ nRestartsAt: 60 }))).no_crash.detail, /^NRestarts 0 -> 1$/);
        assert.match(byName(await run(sim({ agentRestartAt: 70 }))).no_crash.detail, /^1 agent restart or exit line\(s\): "\[agent_process\] FRCFLD: network; restarting in 10 s\."$/);
        const left = byName(await run(sim({ leaveAt: 80 })));
        assert.equal(left.no_crash.pass, false);
        assert.match(left.no_crash.detail, /^gone at minute 8\d: /);
    });

    test('agenda (#4), food (#5): no agenda done; food below the floor; low food with no eat after it', async () => {
        assert.equal(byName(await run(sim({ noAgenda: true }))).agenda_done.detail, 'no "agenda done" within the soak');
        const low = byName(await run(sim({ lowFood: 5 })));
        assert.equal(low.food_floor.pass, false);
        assert.match(low.food_floor.detail, /^lowest food 5 \(floor 6;/);
        assert.equal(low.ate_when_low.pass, true, low.ate_when_low.detail);
        const unfed = byName(await run(sim({ lowFood: 5, noEatAfterLow: true })));
        assert.equal(unfed.ate_when_low.detail, '1 of 1 low food line(s) with no eat after them');
    });

    test('deaths (#5, as in #6): each reported passes; an unreported one fails', async () => {
        assert.equal(byName(await run(sim({ deaths: [45, 90] }))).deaths_reported.detail, 'each of 2 death(s) reported');
        const c = byName(await run(sim({ deaths: [45, 90], unreported: [45] })));
        assert.equal(c.deaths_reported.pass, false);
        assert.equal(c.deaths_reported.detail, '1 of 2 death(s) with no report');
    });

    test('S: another bot\'s unit, or a running unit: login_online fails and nothing starts', async () => {
        const a = sim({ unitBot: 'otherbot' });
        assert.equal(byName(await run(a)).login_online.detail, "the service's bot 'otherbot' is not this run's bot 'FRCFLD'");
        const b = sim({ unitActive: true });
        assert.match(byName(await run(b)).login_online.detail, /^the unit is active before the start/);
    });

    test('T (a spawned driver): a rehearsal; peak memory not reached; the journal checks still run', async () => {
        const r = await run(sim({ driver: true }));
        const c = byName(r);
        assert.equal(c.peak_memory.detail, 'not reached: not the CX23 service (no metrics)');
        assert.match(c.usd_per_hour.detail, /^not reached: no target yet \(TBD\); measured USD/, 'T reads the same usage lines');
        for (const k of ['naming', 'agenda_done', 'food_floor', 'deaths_reported']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        assert.ok(r.weakenedParams.some((w) => /set-up T/.test(w)));
    });

});

describe('#394 review: naming in the real format, a failed read is no crash, the naming window, USD from the usage lines', () => {
    test('the !nearbyBlocks note: the header on the same line too; an empty result first is skipped; never a pass without [naming]', async () => {
        assert.equal((await run(sim({ sameLineHeader: true }))).notes.nearbyBlocks.names.length, 12);
        assert.equal((await run(sim({ nearbyNone: true }))).notes.nearbyBlocks.names[0], 'dynamictrees:trunkshell');
        const r = await run(sim({ naming: null }));
        assert.equal(byName(r).naming.pass, false, 'a clean !nearbyBlocks result is no pass');
        assert.deepEqual(r.notes.nearbyBlocks.problems, []);
    });

    test('an undefined, null or unknown !nearbyBlocks name is recorded in the note', async () => {
        for (const bad of ['undefined', 'null', 'unknown']) {
            const r = await run(sim({ badName: bad }));
            assert.deepEqual(r.notes.nearbyBlocks.problems.map(([n]) => n), [bad], bad);
        }
    });

    test('journal reads that fail from minute 60 to 75: an infra note in the samples, never a crash; the later reads cover it', async () => {
        const r = await run(sim({ refreshFailAt: 60, refreshOkAt: 75 }));
        const c = byName(r);
        for (const k of ['no_crash', 'naming', 'agenda_done', 'food_floor', 'ate_when_low', 'deaths_reported']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        assert.equal(r.notes.infraSamples.count, 3, JSON.stringify(r.notes.infraSamples));
        assert.match(r.notes.infraSamples.first.readError, /exited 255/);
        assert.equal(r.notes.infraSamples.first.metricsError, undefined, 'the metrics read worked');
        assert.equal(r.notes.journalCoverage.complete, true);
    });

    test('usd_per_hour: a cost_usd unknown, or no usage line at all, is not reached with the count', async () => {
        assert.match(byName(await run(sim({ unknownCost: true }))).usd_per_hour.detail, /^not reached: 1 of 120 usage line\(s\) have cost_usd unknown; the known ones sum to USD 0\.0238$/);
        assert.match(byName(await run(sim({ noUsage: true }))).usd_per_hour.detail, /^not reached: no "\[openrouter\] usage \.\.\." line in the log \(120 LLM calls\): the release prints no usage line \(setup gap\?\)$/);
    });
});

describe('#394 re-review: the [naming] line first, journal coverage, an unknown unit state, the final read', () => {
    test('parser: the merged forms (#<type>:<meta> keys with colons, 0 kinds, the entity line, #397\'s keys, the warning, another bot)', () => {
        const n = namingAtStart(['x', NAMING_UNKNOWN], 'frcfld');
        assert.deepEqual([n.kinds, n.unknown, n.entries.slice(2, 3), n.entries.at(-1)], [9, 7, [{ name: '#4321:2', count: 12 }], { name: 'rustic:unknown_block', count: 1 }]);
        assert.deepEqual(namingAtStart([NAMING_EMPTY], NAME).entries, []);
        assert.match(namingAtStart([NAMING_WARNING], NAME).error, /^near spawn: could not read the world \(/);
        assert.equal(namingAtStart(['[naming] OTHER near spawn: 3 kinds; unknown 0; stone:1 dirt:1 sand:1', ENTITIES_OK], NAME), null, 'another bot\'s line, and the entity line, are not the block line');
        const e = entityNamingAtStart([NAMING_OK, ENTITIES_397], NAME);
        assert.deepEqual([e.secs, e.kinds, e.unknown, e.entries[0]], [0, 4, 3, { name: '#mocreatures:12', count: 2 }]);
        assert.deepEqual([entityNamingAtStart([ENTITIES_396], NAME).unknown, entityNamingAtStart([ENTITIES_NONE], NAME).kinds], [4, 0]);
        assert.equal(blockNameProblem('#4321:2'), 'unnamed (#<type>:<meta>)');
        assert.deepEqual(nearbyBlocksResults(['Agent executed: !nearbyBlocks and got: ', 'NEARBY_BLOCKS', '- dirt', '-']), [{ at: 0, none: false, names: ['dirt', ''] }], 'a bare "-" is an empty name');
        assert.deepEqual(['air', 'minecraft:cave_air', 'stone'].map(isAir), [true, true, false]);
    });

    test('naming_report.js\'s NAMING_MIN_KINDS is the scenario\'s (read from the source text, offline)', () => {
        const src = fs.readFileSync(new URL('../../src/agent/library/naming_report.js', import.meta.url), 'utf8');
        assert.equal(Number(/export const NAMING_MIN_KINDS = (\d+);/.exec(src)?.[1]), NAMING_MIN_KINDS);
        assert.equal(NAMING_MIN_KINDS, 3);
    });

    test('naming: the merged lines pass; unknown or #<type>:<meta> names, fewer than 3 kinds, 0 kinds and the warning fail', async () => {
        const good = byName(await run(sim()));
        assert.equal(good.naming.detail, '[naming]: 6 kinds, unknown 0, all real; entities: 1 kinds, unknown 0');
        assert.equal(byName(await run(sim({ naming: NAMING_THREE }))).naming.pass, true, 'exactly NAMING_MIN_KINDS passes');
        const unknown = byName(await run(sim({ naming: NAMING_UNKNOWN })));
        assert.equal(unknown.naming.pass, false);
        assert.match(unknown.naming.detail, /^unknown 7 in the block line; \d+ bad name\(s\): "#4321:2" \(unnamed \(#<type>:<meta>\)\), "unknown" \(unknown\), "1234" \(a numeric id\)/);
        assert.equal(byName(await run(sim({ naming: '[naming] FRCFLD near spawn: 2 kinds; unknown 0; stone:9 dirt:8' }))).naming.detail, '2 kind(s) near spawn (need at least 3)');
        assert.equal(byName(await run(sim({ naming: NAMING_EMPTY }))).naming.detail, '0 kind(s) near spawn (need at least 3)');
        const warned = byName(await run(sim({ naming: NAMING_WARNING, entities: null })));
        assert.equal(warned.naming.pass, false);
        assert.equal(warned.naming.detail, `the bot could not read the world near spawn: "${NAMING_WARNING}"`);
    });

    test('naming, the entity line: unknown > 0 fails (#396 and #397 keys); none near, or no entity line, is a note', async () => {
        const e397 = byName(await run(sim({ entities: ENTITIES_397 })));
        assert.equal(e397.naming.pass, false);
        assert.equal(e397.naming.detail, 'unknown 3 of 4 kind(s) in the entity line (#mocreatures:12 #300 #5)');
        assert.match(byName(await run(sim({ entities: ENTITIES_396 }))).naming.detail, /^unknown 4 of 7 kind\(s\) in the entity line/);
        const none = await run(sim({ entities: ENTITIES_NONE }));
        assert.equal(byName(none).naming.pass, true);
        assert.equal(none.notes.namingEntities, 'no entity near (+240s)');
        const absent = await run(sim({ entities: null }));
        assert.equal(byName(absent).naming.pass, true);
        assert.equal(absent.notes.namingEntities, 'no entity line (nothing near?)');
    });

    test('naming: no [naming] line in a journal with a gap is not reached (infra), not a fail', async () => {
        const c = byName(await run(sim({ naming: null, refreshFailAt: 0 })));
        assert.equal(c.naming.detail, 'not reached (infra): no journal read worked (reads failing: infra); no "[naming] FRCFLD near spawn" line in what was read');
        assert.match(c.usd_per_hour.detail, /^not reached \(infra\): no journal read worked .*; no covered minute to measure over \(USD 0 in what was read, 0 completions\)$/);
    });

    test('the repro: reads fail from minute 70 and a crash at 80 goes unseen: no_crash and the journal checks are not reached (infra), usd per hour over the covered 65 min', async () => {
        const r = await run(sim({ refreshFailAt: 70, agentRestartAt: 80, deaths: [90], unreported: [90] }));
        const c = byName(r);
        assert.equal(c.no_crash.pass, false);
        assert.match(c.no_crash.detail, /^not reached \(infra\): the journal was last read at minute 65 of 120 \(reads failing: infra\); on what was read: /);
        for (const k of ['food_floor', 'ate_when_low', 'deaths_reported']) assert.match(c[k].detail, /^not reached \(infra\): the journal was last read at minute 65/, k);
        assert.match(c.usd_per_hour.detail, /^not reached \(infra\): the journal was last read at minute 65 of 120 .*; measured USD 0\.012\/h over the covered time \(USD 0\.013 over 65 min, 65 completions\)$/);
        assert.equal(c.agenda_done.pass, true, 'a seen "agenda done" stands on a partial read');
        assert.deepEqual(r.notes.journalCoverage, { complete: false, coveredMinutes: 65, minutes: 120, gap: 'the journal was last read at minute 65 of 120 (reads failing: infra)' });
    });

    test('a read that lost the unit\'s start line (the ctl\'s line cap): the journal checks are not reached', async () => {
        const c = byName(await run(sim({ cutStart: true })));
        assert.match(c.deaths_reported.detail, /^not reached \(infra\): the journal read does not start at the unit's "Starting mindcraft-rotn@" line/);
        assert.match(c.no_crash.detail, /^not reached \(infra\)/);
    });

    test('an unknown unit state (status reads failing) is infra, never a crash: not reached at the end; a note if it recovers', async () => {
        const r = await run(sim({ unknownFrom: 100 }));
        const c = byName(r);
        assert.equal(c.no_crash.pass, false);
        assert.match(c.no_crash.detail, /^not reached \(infra\): the unit's state is unknown at the end \(status reads failing since minute 10\d\)$/);
        assert.equal(r.notes.samples.length, 25, 'the soak ran on: an unknown state is no departure');
        const back = await run(sim({ unknownFrom: 60, unknownUntil: 70 }));
        const b = byName(back);
        assert.equal(b.no_crash.pass, true, b.no_crash.detail);
        assert.match(b.no_crash.detail, /the unit's state was unknown for a while \(status reads failing, infra\)$/);
        assert.ok(back.notes.stateUnknown);
        assert.equal(back.notes.infraSamples.count, 2);
    });

});
