// Offline tests for G3 (b), test/scenarios/g3/g3-first-night.mjs, and lib/g3.mjs's deathLines. A simulated
// RotN server keeps S1-A's measured day cycle (Extended Days: the vanilla rate, about 1,200 ticks a minute,
// with two freezes of 10 min at 3000 and 16000: a 40 min cycle) on the fake clock, and answers the
// scenario's commands in 1.12's forms. No server, no LLM, no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { G3_CONSOLE_ALLOW, deathLines } from '../runner/lib/g3.mjs';
import g3b, { dawnOf } from '../scenarios/g3/g3-first-night.mjs';

const NAME = 'FRCFLD';
const MIN = 60000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;

/** S1-A's cycle: [from, to, seconds] segments; a freeze has from === to. 40 min in all. */
const CYCLE = [[0, 3000, 150], [3000, 3000, 600], [3000, 16000, 650], [16000, 16000, 600], [16000, 24000, 400]];
const CYCLE_S = CYCLE.reduce((n, [, , s]) => n + s, 0);
function daytimeAt(ms, start = 0) {
    let s = (ms / 1000) % CYCLE_S;
    let base = 0;
    for (const [from, to, secs] of CYCLE) {
        if (s <= secs) { base = from + ((to - from) * s) / secs; break; }
        s -= secs;
    }
    return Math.floor(base + start) % 24000;
}

/**
 * opt.dieAt: the minute the bot dies (a death line and stat.deaths 1); opt.statOnly / opt.lineOnly: only one
 * of the two; opt.kickAt: the minute it is kicked; opt.hungry: the food level falls 1 point every 10 min
 * (otherwise it stays 20, so 1.12 never writes a food score);
 * opt.frozen: the time never moves (a freeze that never ends); opt.offsetS: where in the cycle the server is at
 * t=0 (1300 s is daytime 14000, mid-night); opt.start: inventory at the join ({item: n}); opt.noPack: no
 * first-join kit lines; opt.rotateAt: the minute after the join when log4j rolls latest.log over (log() then
 * shows only the new file; logRotated() the newest rolled-over file plus latest.log, unless opt.noRotatedReader).
 */
function sim(opt = {}) {
    const log = [];
    let t = 0;
    let joinT = null;
    let online = false;
    let alive = false;
    let deaths = 0;
    let foodAtAdd = null;
    const foodNow = () => (opt.hungry && joinT !== null ? 20 - Math.floor((t - joinT) / (10 * MIN)) : 20);
    const objectives = new Map();
    const sent = [];
    const add = (msg) => log.push(line(t, msg));
    const pending = new Set(['die', 'kick', 'rotate']);
    let rotIdx = 0;   // where latest.log starts in `log`
    const advance = () => {
        if (joinT === null) return;
        const m = (t - joinT) / MIN;
        if (opt.dieAt !== undefined && m >= opt.dieAt && pending.delete('die')) {
            if (!opt.statOnly) add(`${NAME} was slain by Zombie`);
            if (!opt.lineOnly) deaths++;
        }
        if (opt.rotateAt !== undefined && m >= opt.rotateAt && pending.delete('rotate')) rotIdx = log.length;
        if (opt.kickAt !== undefined && m >= opt.kickAt && pending.delete('kick')) {
            online = false;
            add(`${NAME} lost connection: Kicked by an operator`);
            add(`${NAME} left the game`);
        }
    };
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if (cmd === 'time query daytime') add(`Time is ${opt.frozen ? 6000 : daytimeAt(t + (opt.offsetS ?? 0) * 1000)}`);
            else if ((m = /^clear (\S+) (\S+) -?\d+ 0$/.exec(cmd))) {
                const n = (opt.start ?? {})[m[2]] ?? 0;
                add(n ? `${m[1]} has ${n} items that match the criteria` : `Could not clear the inventory of ${m[1]}, no items to remove`);
            }
            else if ((m = /^scoreboard objectives add (\S+) (\S+)$/.exec(cmd))) {
                objectives.set(m[1], m[2]);
                if (m[2] === 'food') foodAtAdd = foodNow();
                add(`Added new objective '${m[1]}' successfully`);
            } else if ((m = /^scoreboard objectives remove (\S+)$/.exec(cmd))) {
                if (objectives.delete(m[1])) add(`Removed objective '${m[1]}' successfully`);
                else add(`No objective was found by the name '${m[1]}'`);
            } else if (cmd === `scoreboard players list ${NAME}`) {
                const played = Math.floor((t - joinT) / 50);
                // 1.12: a food score exists only once the level changed after the objective was added (P1).
                const val = (c) => (c === 'stat.deaths' ? deaths : c === 'food' ? (foodNow() !== foodAtAdd ? foodNow() : 0) : played);
                const shown = [...objectives].map(([o, c]) => [o, val(c)]).filter(([, v]) => v > 0);
                if (!shown.length) add(`Player ${NAME} has no scores recorded`);
                else {
                    add(`Showing ${shown.length} tracked objective(s) for ${NAME}:`);
                    for (const [o, v] of shown) add(`- ${o}: ${v} (${o})`);
                }
            }
            t += waitS * 1000;
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(Math.max(rotIdx, log.length - n)); },
    };
    if (!opt.noRotatedReader) {
        server.logRotated = (n) => { advance(); return { files: rotIdx ? ['2026-11-05-1.log.gz', 'latest.log'] : ['latest.log'], lines: log.slice(-n) }; };
    }
    const bot = {
        start() {
            alive = true;
            online = true;
            joinT = t;
            log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
            add(`${NAME} joined the game`);
            if (!opt.noPack) {
                add(`[${NAME}: Given    [Bread] * 1 to ${NAME}]`);
                add(`[${NAME}: Given    [Bundle] * 1 to ${NAME}]`);
            }
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => [],
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent };
}

const fast = { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000 };
const run = (s, params = {}) => runScenario(g3b, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('the night helpers', () => {
    test('dawnOf: the night is the first sample at 13000 or more, dawn the first below 12000 after it', () => {
        const s = (min, daytime) => ({ min, daytime });
        assert.deepEqual(dawnOf([s(0, 100), s(10, 3000), s(30, 16000), s(41, 300)]), { dusk: s(10, 3000), night: s(30, 16000), dawn: s(41, 300) });
        assert.deepEqual(dawnOf([s(0, 100), s(10, 11000)]), { dusk: s(10, 11000), night: null, dawn: null }, 'a daytime below 12000 before any night is not dawn');
        // A mid-night start (#203 review): no dusk yet, so these night samples and the next dawn do not count.
        assert.deepEqual(dawnOf([s(0, 14000), s(5, 20000), s(6, null)]), { dusk: null, night: null, dawn: null });
        assert.deepEqual(dawnOf([s(0, 14000), s(5, 20000), s(10, 500), s(20, 3000), s(30, 13500), s(40, 600)]),
            { dusk: s(20, 3000), night: s(30, 13500), dawn: s(40, 600) }, 'the first full night after the join');
    });

    test('deathLines: vanilla death messages and raw modded keys for the bot only', () => {
        const L = (m) => line(0, m);
        const lines = [L(`${NAME} was slain by Zombie`), L(`${NAME} drowned`), L(`${NAME} fell from a high place`), L(`death.attack.bleed ${NAME}`),
            L(`${NAME} joined the game`), L(`${NAME} lost connection: Timed out`), L(`<${NAME}> I was slain by nothing`), L('JQDAW was slain by Zombie'), L(`${NAME}2 died`)];
        assert.deepEqual(deathLines(lines, NAME).map((d) => d.msg), [`${NAME} was slain by Zombie`, `${NAME} drowned`, `${NAME} fell from a high place`, `death.attack.bleed ${NAME}`]);
    });
});

describe('g3-first-night on a simulated server', () => {
    test('the module: G3, the real agent, maxMinutes 55 and the dawn rule compared equal', () => {
        assert.equal(g3b.gate, 'G3');
        assert.equal(g3b.llm, true);
        assert.deepEqual(g3b.gateParams, { maxMinutes: 'equal', nightFrom: 'equal', dawnBelow: 'equal', maxBatchUsd: 'equal' });
        assert.equal(g3b.defaults.maxMinutes, 55);
        assert.equal(g3b.defaults.maxBatchUsd, 2);
    });

    test('a quiet night: dawn about 40 min after the join, every check passes, the time is never touched and no tp is sent', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(g3b.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.match(r.notes.end.reason, /^dawn: /);
        assert.ok(r.notes.end.minutes >= 39 && r.notes.end.minutes <= 42, String(r.notes.end.minutes));
        assert.equal(r.notes.shelterAtMidnight.taken, false, 'no position without tp (lead, #201 review)');
        assert.deepEqual(r.notes.foodAtEnd, { food: null, objective: 'added', gating: false, why: 'no food score: the level has not changed since the objective was added (1.12)' });
        for (const cmd of s.sent) {
            assert.ok(G3_CONSOLE_ALLOW.some((re) => re.test(cmd)), `not approved: ${cmd}`);
            assert.ok(!/^(time set|gamerule)/.test(cmd), `the scenario touched the time: ${cmd}`);
            assert.ok(!/^tp /.test(cmd), `no tp in G3: ${cmd}`);
        }
        assert.equal(r.gateValid, true, r.weakenedParams.join('; '));
    });

    test('hunger at dawn is recorded as evidence, never gating (lead, #203)', async () => {
        const r = await run(sim({ hungry: true }));
        assert.equal(byName(r).survived_night.pass, true);
        assert.equal(r.notes.foodAtEnd.food, 16, JSON.stringify(r.notes.foodAtEnd));
        assert.equal(r.notes.foodAtEnd.gating, false);
        assert.ok(r.notes.samples.some((x) => x.food === null) && r.notes.samples.at(-1).food === 16, 'no score until the level first changes');
    });

    test('a death at night ends the run early and fails survived_night; the stat or the line alone is enough', async () => {
        for (const opt of [{}, { statOnly: true }, { lineOnly: true }]) {
            const r = await run(sim({ dieAt: 30, ...opt }));
            const c = byName(r);
            assert.equal(c.survived_night.pass, false, JSON.stringify(opt));
            assert.match(r.notes.end.reason, /^the bot died/);
            assert.ok(r.notes.end.minutes < 33, String(r.notes.end.minutes));
        }
    });

    test('a death in the uncounted gap before the objectives exist is still caught by its log line', async () => {
        const r = await run(sim({ dieAt: 0, lineOnly: true }));
        assert.equal(byName(r).survived_night.pass, false);
        assert.match(byName(r).survived_night.detail, /death lines 1: FRCFLD was slain by Zombie/);
    });

    test('a kick fails stayed_online and survived_night, with the reason', async () => {
        const r = await run(sim({ kickAt: 20 }));
        const c = byName(r);
        assert.equal(c.stayed_online.pass, false);
        assert.match(c.stayed_online.detail, /lost \(Kicked by an operator\)/);
        assert.equal(c.survived_night.pass, false);
    });

    test('no night within maxMinutes (the time never moves): the run stops at 55 min and survived_night fails', async () => {
        const r = await run(sim({ frozen: true }));
        assert.match(r.notes.end.reason, /^maxMinutes \(55\) reached before dawn/);
        assert.equal(byName(r).survived_night.pass, false);
        assert.equal(r.notes.shelterAtMidnight.taken, false);
    });

    test('a run that joins mid-night: the partial night and its dawn do not count, so survived_night fails within maxMinutes (#203 review)', async () => {
        const r = await run(sim({ offsetS: 1300 }));
        assert.equal(r.notes.samples[0].daytime >= 13000, true, String(r.notes.samples[0].daytime));
        assert.ok(r.notes.samples.some((x) => x.daytime < 12000), 'the wrap past 24000 happened, but without a dusk before it');
        assert.match(r.notes.end.reason, /^maxMinutes \(55\) reached before dawn/);
        assert.equal(byName(r).survived_night.pass, false);
    });

    test('fresh_start: a target item at the start, or no first-join kit in the log, fails it (#203 review)', async () => {
        const held = await run(sim({ start: { 'minecraft:stone_pickaxe': 1 } }));
        assert.equal(byName(held).fresh_start.pass, false);
        assert.match(byName(held).fresh_start.detail, /held at the start: minecraft:stone_pickaxe 1/);
        const noKit = await run(sim({ noPack: true }));
        assert.equal(byName(noKit).fresh_start.pass, false);
        assert.match(byName(noKit).fresh_start.detail, /not a first join: the pack's give_bread and give_bundle/);
    });

    test('a weaker dawn rule or a longer limit is never a gate pass', async () => {
        for (const params of [{ maxMinutes: 60 }, { nightFrom: 12000 }, { dawnBelow: 13000 }]) {
            const r = await run(sim(), params);
            assert.equal(r.gateValid, false, JSON.stringify(params));
        }
    });
});

describe('the server log rolls over at 00:00 UTC mid-run (round 3 batch B)', () => {
    test('the marker rotated out: the session reads the rolled-over file plus latest.log, records the files, and every check passes', async () => {
        const r = await run(sim({ rotateAt: 30 }));
        const c = byName(r);
        assert.equal(r.error ?? null, null);
        for (const k of Object.keys(g3b.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        assert.equal(r.notes.logWindow.length, 1);
        assert.equal(r.notes.logWindow[0].files, '2026-11-05-1.log.gz,latest.log');
        assert.equal(r.notes.logWindow[0].markerFound, true);
        assert.ok(r.notes.logWindow[0].sessionMin >= 30, `found after the rotation: ${r.notes.logWindow[0].sessionMin}`);
    });

    test('a death before the rotation still counts afterwards (the window spans both files)', async () => {
        const c = byName(await run(sim({ rotateAt: 30, dieAt: 10 })));
        assert.equal(c.survived_night.pass, false);
        assert.match(c.survived_night.detail, /death lines 1/);
    });

    test('without the rotated reader, round 3 batch B\'s failure: a scenario error, and no window is recorded', async () => {
        const r = await run(sim({ rotateAt: 30, noRotatedReader: true }));
        assert.match(String(r.error), /scenario marker not in the last \d+ log lines; raise logTail/);
        assert.equal(r.notes.logWindow, undefined);
    });

    test('no rotation: the rotated reader is never used', async () => {
        const r = await run(sim());
        assert.equal(r.notes.logWindow, undefined);
    });
});
