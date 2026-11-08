// Offline tests for G4 #7 (with #2, #4, #5), test/scenarios/g4/g4-soak-2h.mjs, and its journal parsers
// (test/runner/lib/survival.mjs). A simulated test server (1.12 log lines) and a simulated CX23 service whose journal
// fills over simulated time with the agent's own lines: !nearbyBlocks, [survival] food/ate/fight/flee, [death], the
// agenda. Fakes only: no server, no ssh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import soak, { TBD } from '../scenarios/g4/g4-soak-2h.mjs';
import { agentExits, blockNameProblem, deathEvents, nearbyBlocksResults, survivalEvents } from '../runner/lib/survival.mjs';

const NAME = 'FRCFLD';
const MIN = 60000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;
const NEARBY = ['dirt', 'grass', 'dynamictrees:trunkshell', 'biomesoplenty:plant_0', 'stone', 'pyrotech:rock'];

/**
 * opt.driver (set-up T); opt.badName (a name in the !nearbyBlocks result); opt.noNearby; opt.memoryMb (per sample);
 * opt.nRestartsAt (minute when systemd restarts it); opt.agentRestartAt (an agent_process restart line); opt.leaveAt
 * (minute the bot leaves for good); opt.noAgenda; opt.lowFood (food drops to it once); opt.noEatAfterLow;
 * opt.deaths (minutes of deaths); opt.unreported (deaths with no report); opt.unitBot; opt.unitActive.
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
    // The bot's own lines, written as simulated time passes (once each).
    const at = (min, key, fn) => { if (started !== null && t - started >= min * MIN && !done.has(key)) { done.add(key); fn(); } };
    const advance = () => {
        if (started === null) return;
        at(0.3, 'join', () => { online = true; log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`); add(`${NAME} joined the game`); });
        if (!opt.noNearby) at(3, 'nearby', () => jr('Agent executed: !nearbyBlocks and got: ', 'NEARBY_BLOCKS', ...[...NEARBY, ...(opt.badName ? [opt.badName] : [])].map((n) => `- ${n}`), ''));
        for (let m = 1; m <= 125; m++) {
            at(m, `food${m}`, () => jr(`[survival] food ${opt.lowFood !== undefined && m === 50 ? opt.lowFood : 18} health 20 (${opt.lowFood !== undefined && m === 50 ? 'low' : 'check'})`));
            // the eat at 51.5 min, in time order with the food lines (a sample writes all lines that came due since the last one)
            if (m === 51 && opt.lowFood !== undefined && !opt.noEatAfterLow) at(51.5, 'eat', () => jr('[survival] ate minecraft:bread:0 food 5->10'));
        }
        at(30, 'fight', () => jr('[survival] fight start zombie (shelter)', '[survival] fight end zombie killed after 6 s'));
        at(35, 'flee', () => jr('[survival] flee creeper (low health)'));
        for (let m = 1; m <= 125; m += 1) at(m, `llm${m}`, () => jr('[openrouter] provider Wafer, finish_reason stop, content 300 chars'));
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
        ...(opt.driver ? {} : { kind: 'service', bot: opt.unitBot ?? 'frcfld', refresh: () => { advance(); return Promise.resolve(); } }),
        start() { started = t; unit.state = 'active'; jr('Starting mindcraft-rotn@frcfld.service - Mindcraft RotN bot frcfld...'); return Promise.resolve(); },
        alive: () => unit.state === 'active',
        needsStop: () => unit.state === 'active',
        exitCode: () => null,
        exitSignal: () => null,
        unitState: () => unit.state,
        output: () => { advance(); return journal; },
        metrics() {
            advance();
            const mb = opt.memoryMb ? opt.memoryMb[Math.min(sampleN++, opt.memoryMb.length - 1)] : 300;
            return Promise.resolve({ MemoryCurrent: mb * 1048576, MemoryPeak: '[not set]', NRestarts: unit.nrestarts, ActiveState: unit.state });
        },
        stop() { unit.state = 'inactive'; return Promise.resolve(); },
    };
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
        assert.deepEqual(nearbyBlocksResults(['Agent executed: !nearbyBlocks and got: ', 'NEARBY_BLOCKS', '- dirt', '- a:b', '', 'next']), [{ at: 0, names: ['dirt', 'a:b'] }]);
        for (const n of ['dirt', 'grass', 'dynamictrees:trunkshell', 'biomesoplenty:plant_0', 'minecraft:stone']) assert.equal(blockNameProblem(n), null, n);
        assert.deepEqual(['1', '35:2', 'unknown', 'mod:unknown_block', 'block_123', 'mod:entity_7', 'Dirt', ''].map(blockNameProblem),
            ['a numeric id', 'a numeric id', 'unknown', 'unknown', 'a placeholder', 'a placeholder', 'not a registry name', 'empty']);
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
        assert.match(c.usd_per_hour.detail, /^not reached: the CX23 key's spend is read separately \(lead, #389\), not by the runner; no target yet \(TBD\); \d+ LLM calls \([\d.]+\/h\)$/);
        assert.equal(r.notes.samples.length, 25, 'one at the start and every 5 min for 120 min');
        assert.deepEqual(r.notes.survival, { eats: 0, fights: 1, fightOutcomes: { killed: 1 }, flees: 1, foodLines: 120 });
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.some((w) => /targets are TBD/.test(w)));
    });

    test('with the targets set: peak memory passes within it and fails above it', async () => {
        const ok = byName(await run(sim({ memoryMb: [300, 500] }), { peakMemoryMaxMb: 1024, usdPerHourMax: 0.05 }));
        assert.equal(ok.peak_memory.pass, true);
        assert.equal(ok.peak_memory.detail, 'peak 500 MB (target 1024 MB)');
        assert.match(ok.usd_per_hour.detail, /target USD 0\.05\/h/);
        const over = byName(await run(sim({ memoryMb: [300, 1400] }), { peakMemoryMaxMb: 1024, usdPerHourMax: 0.05 }));
        assert.equal(over.peak_memory.pass, false);
        assert.equal(over.peak_memory.detail, 'peak 1400 MB (target 1024 MB)');
    });

    test('naming (#2): a numeric or unknown name fails; no !nearbyBlocks is not reached', async () => {
        const bad = byName(await run(sim({ badName: '35:2' })));
        assert.equal(bad.naming.pass, false);
        assert.equal(bad.naming.detail, '1 bad name(s): "35:2" (a numeric id)');
        assert.match(byName(await run(sim({ noNearby: true }))).naming.detail, /^not reached: the agent ran no !nearbyBlocks/);
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
        assert.match(c.usd_per_hour.detail, /^not reached: a rehearsal: the batch's key reading has the spend;/);
        for (const k of ['naming', 'agenda_done', 'food_floor', 'deaths_reported']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        assert.ok(r.weakenedParams.some((w) => /set-up T/.test(w)));
    });
});
