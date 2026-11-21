// Offline tests for probe BC (the lead's Better Combat plan, step 3): the console allowlist with summon and
// kill (disposable test server only), the bc-hit driver core (test/runner/drivers/bc-attack.mjs) against a
// fake world (fixtures/bc-world.mjs: a fake of net-forge #521's wrapper and a server with #518's rules), the
// judgments, and the scenario (test/scenarios/probe/probe-bc-attack.mjs) on a simulated server and log
// whose driver is that same core.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import {
    BC_CONSOLE_ALLOW, BC_DRIVER_ENV, BC_NOT_GATE, BC_PLAN, P1_CONSOLE_ALLOW, bcHit, bcLaneBlocks, bcLogProblems, bcReply, guardBcConsole,
    judgeSeries, nearHits, projectedHits,
} from '../runner/lib/probe.mjs';
import { attachBcAttack, attribute, gapsOf, parseBcHit, whisperOf } from '../runner/drivers/bc-attack.mjs';
import probe from '../scenarios/probe/probe-bc-attack.mjs';
import { bcWorld } from './fixtures/bc-world.mjs';

const NAME = 'FRCFLD';
const SERVER = 'mcr-test-20261121-101500';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const L = (msg, logger = DS, level = 'INFO') => `[12:00:00] [Server thread/${level}] [${logger}]: ${msg}`;
const tick = () => new Promise((r) => setImmediate(r));
const allowed = (cmd) => BC_CONSOLE_ALLOW.some((re) => re.test(cmd));

describe('probe BC\'s console: summon and kill for this probe only, on a disposable test server only', () => {
    test('every command the scenario sends is on the list', () => {
        const p = BC_PLAN;
        const sent = [
            'say scenario-probe-bc-attack-r1-begin', 'seed', 'gamerule doDaylightCycle false', 'time set day', 'kill @e[type=zombie]',
            ...bcLaneBlocks().map(([x, y, z, b]) => `setblock ${x} ${y} ${z} ${b}`),
            `testforblock -45 65 -66 minecraft:stone`, `testforblock -45 66 -66 minecraft:air`,
            `tp ${NAME} ${p.landing.join(' ')}`, `tp ${NAME} ~ ~ ~`, `clear ${NAME}`,
            ...p.weapons.filter((w) => w.give).map((w) => `give ${NAME} ${w.item} ${w.give} 0`),
            `summon minecraft:zombie ${p.zombieA.join(' ')} {NoAI:1}`, `summon minecraft:zombie ${p.zombieB.join(' ')} {NoAI:1}`, `summon minecraft:zombie ${p.zombieAi.join(' ')}`,
            ...p.weapons.flatMap((w) => [bcHit(NAME, 'abc123', 'vanilla', p.zombieA, w.item), bcHit(NAME, 'abc123', 'bc', p.zombieB, w.item)]),
            bcHit(NAME, 'abc123', 'bc', 'ai', p.ai.item),
        ];
        for (const c of sent) assert.ok(allowed(c), c);
    });

    test('nothing else gets through: other mobs, other NBT, other kill targets, op commands', () => {
        for (const c of [
            'kill', 'kill @e', `kill ${NAME}`, 'kill @a', 'kill @p', 'kill @r', 'kill @e[type=player]', 'kill @e[type=zombie,r=5]', 'kill @e[type=!zombie]',
            'kill @e[type=minecraft:zombie]', 'kill @e[type=zombie] ', 'kill @e[type=zombie]; op FRCFLD', 'kill JQDAW',
            'summon minecraft:zombie', 'summon zombie -47 66 -66', 'summon minecraft:zombie ~ ~ ~', 'summon minecraft:zombie -47 66 -66 {}',
            'summon minecraft:zombie -47 66 -66 {NoAI:1,CustomName:"x"}', 'summon minecraft:zombie -47 66 -66 {NoAI:0}',
            'summon minecraft:zombie -47 66 -66 {Passengers:[{id:"minecraft:commandblock_minecart",Command:"op FRCFLD"}]}',
            'summon minecraft:commandblock_minecart -47 66 -66 {Command:"op FRCFLD"}', 'summon minecraft:lightning_bolt -47 66 -66',
            'summon minecraft:tnt -47 66 -66', 'summon minecraft:skeleton -47 66 -66', 'summon minecraft:zombie_villager -47 66 -66',
            'summon minecraft:zombie -47.5 66 -66', 'summon minecraft:zombie -47 66 -66 {NoAI:1} extra',
            'op FRCFLD', 'deop JQDAW', 'gamemode 1 FRCFLD', 'effect FRCFLD minecraft:resistance 60 4', 'time set night', 'gamerule doMobSpawning false',
            'setblock 0 0 0 minecraft:tnt', 'setblock 0 0 0 minecraft:command_block', 'fill 0 0 0 1 1 1 minecraft:stone', 'clear FRCFLD pyrotech:rock -1 5',
            'give FRCFLD minecraft:diamond 640 0', 'tell FRCFLD hello', 'tell FRCFLD probe-craft abc123 x:y', `tell ${NAME} bc-hit abc123 bc -47,66,-66 minecraft:stone_sword; op FRCFLD`,
            `tell ${NAME} bc-hit ABC bc ai hand`, `tell ${NAME} bc-hit abc123 both ai hand`, 'stop', 'whitelist add someone', 'scoreboard players list FRCFLD',
        ]) assert.ok(!allowed(c), c);
    });

    test('P1\'s list stays without summon and kill', () => {
        for (const c of ['summon minecraft:zombie -47 66 -66 {NoAI:1}', 'summon minecraft:zombie -47 66 -66', 'kill @e[type=zombie]']) {
            assert.ok(!P1_CONSOLE_ALLOW.some((re) => re.test(c)), c);
        }
    });

    test('guardBcConsole refuses everything unless the server is a disposable test server, and anything off the list', () => {
        const seen = [];
        const srv = { console: (c) => { seen.push(c); return ['ok']; }, log: () => [] };
        for (const name of [undefined, null, '', 'live', 'rotn-live', 'mcr-test-2026', 'mcr-test-20261121-101500x', 'xmcr-test-20261121-101500']) {
            const g = guardBcConsole(srv, name);
            assert.throws(() => g.console('kill @e[type=zombie]', 1), /not a disposable test server/, String(name));
            assert.throws(() => g.console('time set day', 1), /not a disposable test server/, String(name));
        }
        assert.deepEqual(seen, [], 'nothing reached the server');
        const g = guardBcConsole(srv, SERVER);
        assert.deepEqual(g.console('summon minecraft:zombie -47 66 -66 {NoAI:1}', 1), ['ok']);
        assert.throws(() => g.console('kill @e', 1), /console command refused/);
        assert.throws(() => g.console('op FRCFLD', 1), /console command refused/);
        assert.deepEqual(seen, ['summon minecraft:zombie -47 66 -66 {NoAI:1}']);
    });

    test('bcHit builds the driver\'s command, the driver parses it back, and the reply is found by token', () => {
        assert.equal(bcHit(NAME, 'abc123', 'vanilla', [-47, 66, -66], 'minecraft:stone_sword'), 'tell FRCFLD bc-hit abc123 vanilla -47,66,-66 minecraft:stone_sword');
        assert.equal(bcHit(NAME, 'abc123', 'bc', 'ai', 'hand'), 'tell FRCFLD bc-hit abc123 bc ai hand');
        assert.throws(() => bcHit(NAME, 'abc123', 'both', 'ai', 'hand'), /bad bc-hit path/);
        assert.throws(() => bcHit(NAME, 'XYZ', 'bc', 'ai', 'hand'), /bad probe token/);
        assert.deepEqual(parseBcHit('bc-hit abc123 vanilla -47,66,-66 pyrotech:crude_axe'), { token: 'abc123', path: 'vanilla', target: [-47, 66, -66], item: 'pyrotech:crude_axe' });
        assert.deepEqual(parseBcHit('bc-hit abc123 bc ai hand'), { token: 'abc123', path: 'bc', target: 'ai', item: 'hand' });
        for (const bad of ['bc-hit abc123 bc ai', 'bc-hit abc123 bc ai hand extra', 'bc-hit abc123 bc 1,2 hand', 'x bc-hit abc123 bc ai hand']) assert.equal(parseBcHit(bad), null, bad);
        assert.deepEqual(whisperOf({ translate: 'commands.message.display.incoming', with: ['Server', 'bc-hit abc123 bc ai hand'] }), { from: 'Server', msg: 'bc-hit abc123 bc ai hand' });
        assert.equal(whisperOf({ translate: 'chat.type.announcement', with: ['Server', 'bc-hit abc123 bc ai hand'] }), null);
        const out = ['x', 'DRIVER {"type":"bc_hit","token":"other1","ok":true}', 'DRIVER {"type":"bc_hit","token":"abc123","ok":false}'];
        assert.deepEqual(bcReply(out, 'abc123'), { type: 'bc_hit', token: 'abc123', ok: false });
        assert.equal(bcReply(out, 'ffffff'), null);
        assert.deepEqual(BC_DRIVER_ENV, { ROTN_DRIVER_BC_ATTACK: 'on' });
    });
});

describe('the judgments (the plan\'s pass rules)', () => {
    const hit = (i, drop, path = 'bettercombat', extra = {}) => ({ i, t: i * 650, path, sent: true, drop, ...extra });
    const bc = (drops, extra = {}) => ({ ok: true, target: { id: 1, startHealth: 20 }, end: 'dead', hits: drops.map((d, k) => hit(k + 1, d)), gaps: { bettercombat: drops.slice(1).map(() => 650) }, ...extra });
    const van = (drops, extra = {}) => ({ ok: true, target: { id: 1, startHealth: 20 }, end: 'maxMs', hits: drops.map((d, k) => hit(k + 1, d, 'vanilla')), gaps: { bettercombat: [] }, ...extra });

    test('nearHits: within max(1, 15%) of one expected count', () => {
        assert.equal(nearHits(8, [8]), 8);
        assert.equal(nearHits(9, [8]), 8);
        assert.equal(nearHits(10, [8]), null);
        assert.equal(nearHits(31, [27, 54]), 27);
        assert.equal(nearHits(50, [27, 54]), 54);
        assert.equal(nearHits(40, [27, 54]), null);
        assert.equal(nearHits(null, [8]), null);
    });

    test('vanilla: the first hit lowers the health and no later one does', () => {
        assert.equal(judgeSeries(van([3, 0, 0, 0]), { path: 'vanilla' }).ok, true);
        assert.match(judgeSeries(van([3, 0, 2.5, 0]), { path: 'vanilla' }).why, /1 later hit\(s\) changed the health \(#3\)/);
        assert.match(judgeSeries(van([0, 0, 0]), { path: 'vanilla' }).why, /the first hit did not lower the health/);
        assert.match(judgeSeries(van([3]), { path: 'vanilla' }).why, /only 1 hit/);
        assert.match(judgeSeries({ ...van([3, 0]), hits: [hit(1, 3, 'vanilla'), hit(2, 0, 'bettercombat')] }, { path: 'vanilla' }).why, /1 hit\(s\) not on the vanilla path \(#2\)/);
        assert.match(judgeSeries(van([3, 0], { burned: true }), { path: 'vanilla' }).why, /burned/);
        assert.match(judgeSeries(null, { path: 'vanilla' }).why, /no reply/);
    });

    test('Better Combat: every hit lands, it dies near #518\'s count, no gap under the cooldown, no trip', () => {
        const ok = judgeSeries(bc(Array(8).fill(2.6)), { path: 'bc', hits: [8], cooldownTicks: 13 });
        assert.deepEqual([ok.ok, ok.projected, ok.matched], [true, 8, 8]);
        assert.match(judgeSeries(bc([2.6, 0, 2.6, 2.6, 2.6, 2.6, 2.6, 2.6, 2.6]), { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /1 hit\(s\) did not lower the health \(#2\)/);
        assert.match(judgeSeries(bc(Array(12).fill(1.7)), { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /12 hits to kill, not near #518's 8/);
        assert.match(judgeSeries(bc(Array(8).fill(2.6), { gaps: { bettercombat: [650, 549, 650] } }), { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /1 gap\(s\) between Better Combat packets under 13 ticks \(549 ms\)/);
        assert.equal(judgeSeries(bc(Array(8).fill(2.6), { gaps: { bettercombat: [649, 648] } }), { path: 'bc', hits: [8], cooldownTicks: 13 }).ok, true, 'a timer may fire up to 2 ms early');
        assert.match(judgeSeries(bc(Array(8).fill(2.6), { tripped: true }), { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /self-check tripped/);
        assert.match(judgeSeries(bc(Array(8).fill(2.6), { end: 'maxMs' }), { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /did not die \(maxMs\)/);
        const off = bc(Array(8).fill(2.6));
        off.hits[3].path = 'vanilla';
        assert.match(judgeSeries(off, { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /1 hit\(s\) not on the bettercombat path \(#4\)/);
        const replaced = bc(Array(8).fill(2.6));
        replaced.hits[2].sent = false;
        assert.match(judgeSeries(replaced, { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /1 call\(s\) sent nothing/);
    });

    test('the bare hand: 40 hits without a kill is judged by the projection (#518: 27, or about 54 with the 0.5 reduction)', () => {
        const half = bc(Array(40).fill(0.37), { end: 'maxHits' });
        assert.equal(projectedHits(half), 55);
        assert.deepEqual([judgeSeries(half, { path: 'bc', hits: [27, 54], cooldownTicks: 13 }).ok, judgeSeries(half, { path: 'bc', hits: [27, 54], cooldownTicks: 13 }).matched], [true, 54]);
        assert.match(judgeSeries(bc(Array(40).fill(0.2), { end: 'maxHits' }), { path: 'bc', hits: [27, 54], cooldownTicks: 13 }).why, /100 hits to kill \(projected\), not near #518's 27 or 54/);
        assert.match(judgeSeries(bc(Array(40).fill(0.37), { end: 'maxHits' }), { path: 'bc', hits: [8], cooldownTicks: 13 }).why, /did not die \(maxHits\)/, 'a weapon must kill');
        assert.equal(judgeSeries(bc(Array(27).fill(0.75)), { path: 'bc', hits: [27, 54], cooldownTicks: 13 }).matched, 27);
    });

    test('the AI zombie: every hit lands and it dies; no count is judged', () => {
        assert.equal(judgeSeries(bc(Array(11).fill(1.9)), { path: 'bc', cooldownTicks: 13, ai: true }).ok, true);
        assert.match(judgeSeries(bc(Array(5).fill(2), { end: 'maxMs' }), { path: 'bc', cooldownTicks: 13, ai: true }).why, /did not die/);
    });

    test('bcLogProblems: the codec exception and WARN/ERROR lines naming bettercombat; nothing else', () => {
        const lines = [
            L('FRCFLD joined the game'),
            L('[bettercombat]: loaded config', 'bettercombat'),
            L('FMLIndexedMessageCodec exception caught', 'FML', 'ERROR'),
            L('java.lang.NullPointerException: Undefined message for discriminator 9 in channel bettercombat', 'FML', 'ERROR'),
            L('Something about bettercombat', 'bettercombat', 'WARN'),
            L('Can\'t keep up! Did the system time change, or is the server overloaded?', DS, 'WARN'),
        ];
        assert.deepEqual(bcLogProblems(lines), [lines[2], lines[3], lines[4]]);
    });

    test('attribute: each hit gets the updates until the next hit; gaps between packets', () => {
        const events = [{ t: 160, kind: 'health', value: 17 }, { t: 160, kind: 'hurt', value: true }, { t: 760, kind: 'health', value: 14 }, { t: 1500, kind: 'dead', value: true }];
        const hs = attribute([{ i: 1, t: 100 }, { i: 2, t: 700 }, { i: 3, t: 1300 }], events, 20, 3000);
        assert.deepEqual(hs.map((h) => [h.healthBefore, h.healthAfter, h.drop, h.hurt, h.died]), [[20, 17, 3, true, false], [17, 14, 3, false, false], [14, 0, 14, false, true]]);
        assert.deepEqual(gapsOf([0, 650, 1300, 1950]), [650, 650, 650]);
    });
});

describe('the bc-hit driver core against a fake world (#521\'s wrapper, #518\'s server rules)', () => {
    const attach = (w, limits = {}) => {
        const out = [];
        attachBcAttack(w.bot, { emit: (type, data) => out.push({ type, ...data }), now: w.clock.now, sleep: w.clock.sleep, limits });
        const reply = async (token) => {
            for (let i = 0; i < 20000; i++) {
                const r = out.find((e) => e.type === 'bc_hit' && e.token === token);
                if (r) return r;
                await w.clock.sleep(50);
            }
            return null;
        };
        return { out, reply };
    };

    test('stone sword: vanilla lands once in 40 hits paced at 13 ticks; Better Combat kills in 8 with 650-ms gaps', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_sword');
        const a = w.summon(-47, 66, -66);
        const b = w.summon(-43, 66, -66);
        w.whisper('bc-hit aaa111 vanilla -47,66,-66 minecraft:stone_sword');
        const rv = await reply('aaa111');
        assert.equal(rv.ok, true, JSON.stringify(rv));
        assert.equal(rv.target.id, a.id);
        assert.equal(rv.end, 'maxHits');
        assert.equal(rv.hits.length, 40);
        assert.deepEqual(rv.hits.slice(0, 3).map((h) => [h.path, h.healthBefore, h.healthAfter, h.drop, h.hurt]), [['vanilla', 20, 17.4, 2.6, true], ['vanilla', 17.4, 17.4, 0, false], ['vanilla', 17.4, 17.4, 0, false]]);
        assert.ok(rv.gaps.vanilla.every((g) => g >= 650), rv.gaps.vanilla.join(','));
        assert.equal(rv.packets.use_entity, 40);
        assert.equal(rv.packets.bettercombat, 0);
        assert.equal(judgeSeries(rv, { path: 'vanilla' }).ok, true);
        w.whisper('bc-hit bbb222 bc -43,66,-66 minecraft:stone_sword');
        const rb = await reply('bbb222');
        assert.equal(rb.target.id, b.id);
        assert.equal(rb.end, 'dead');
        assert.equal(rb.hits.length, 8);
        assert.ok(rb.hits.every((h) => h.path === 'bettercombat' && h.drop > 0 && h.hurt === (h.healthAfter > 0)), JSON.stringify(rb.hits));
        assert.equal(rb.hits.at(-1).healthAfter, 0);
        assert.ok(rb.gaps.bettercombat.length === 7 && rb.gaps.bettercombat.every((g) => g >= 650), rb.gaps.bettercombat.join(','));
        assert.equal(rb.packets.use_entity, 0, 'never use_entity on Better Combat\'s path');
        assert.deepEqual([rb.statsAfter.bettercombat - rb.statsBefore.bettercombat, rb.tripped, rb.burned], [8, false, false]);
        const v = judgeSeries(rb, { path: 'bc', hits: [8], cooldownTicks: 13 });
        assert.deepEqual([v.ok, v.projected], [true, 8], v.why);
    });

    test('stone axe: vanilla paced at 50 ticks (60 s: 24 hits); Better Combat in 9', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_axe');
        w.summon(-47, 66, -66);
        w.summon(-43, 66, -66);
        w.whisper('bc-hit aaa111 vanilla -47,66,-66 minecraft:stone_axe');
        const rv = await reply('aaa111');
        assert.equal(rv.end, 'maxMs');
        assert.ok(rv.hits.length >= 23 && rv.hits.length <= 24, String(rv.hits.length));
        assert.ok(rv.gaps.vanilla.every((g) => g >= 2500));
        w.whisper('bc-hit bbb222 bc -43,66,-66 minecraft:stone_axe');
        const rb = await reply('bbb222');
        assert.deepEqual([rb.end, rb.hits.length], ['dead', 9]);
        assert.equal(judgeSeries(rb, { path: 'bc', hits: [9], cooldownTicks: 50 }).ok, true);
    });

    test('crude axe: it breaks after 4 hits; the driver takes the next one (the cooldown restarts) and kills in 9', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('pyrotech:crude_axe', 6);
        w.summon(-43, 66, -66);
        w.whisper('bc-hit bbb222 bc -43,66,-66 pyrotech:crude_axe');
        const rb = await reply('bbb222');
        assert.deepEqual([rb.end, rb.hits.length], ['dead', 9]);
        assert.deepEqual(rb.reequips.map((x) => x.afterHit), [4, 8]);
        assert.ok(rb.gaps.bettercombat.every((g) => g >= 1100), rb.gaps.bettercombat.join(','));
        assert.equal(judgeSeries(rb, { path: 'bc', hits: [9], cooldownTicks: 22 }).ok, true);
        // Out of axes: the series ends item_gone.
        const w2 = bcWorld();
        const t2 = attach(w2);
        w2.give('pyrotech:crude_axe', 1);
        w2.summon(-43, 66, -66);
        w2.whisper('bc-hit ccc333 bc -43,66,-66 pyrotech:crude_axe');
        const r2 = await t2.reply('ccc333');
        assert.deepEqual([r2.end, r2.hits.length], ['item_gone', 4]);
        assert.match(judgeSeries(r2, { path: 'bc', hits: [9], cooldownTicks: 22 }).why, /did not die \(item_gone\)/);
    });

    test('empty hand: an empty hotbar slot; 27 hits on Better Combat\'s path; with the 0.5 reduction, 40 hits and a projection of 54', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.summon(-43, 66, -66);
        w.whisper('bc-hit bbb222 bc -43,66,-66 hand');
        const rb = await reply('bbb222');
        assert.deepEqual([rb.end, rb.hits.length], ['dead', 27]);
        assert.equal(judgeSeries(rb, { path: 'bc', hits: [27, 54], cooldownTicks: 13 }).matched, 27);
        const w2 = bcWorld({ handDrop: 0.375 });
        const t2 = attach(w2);
        w2.summon(-43, 66, -66);
        w2.whisper('bc-hit ccc333 bc -43,66,-66 hand');
        const r2 = await t2.reply('ccc333');
        assert.deepEqual([r2.end, r2.hits.length], ['maxHits', 40]);
        const v = judgeSeries(r2, { path: 'bc', hits: [27, 54], cooldownTicks: 13 });
        assert.deepEqual([v.ok, v.projected, v.matched], [true, 54, 54], v.why);
    });

    test('the AI zombie: no swing until it is within 3 blocks; then Better Combat kills it', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_sword');
        const z = w.summon(-39, 66, -66, { ai: true });   // 5 blocks east
        w.whisper('bc-hit ddd444 bc ai minecraft:stone_sword');
        const r = await reply('ddd444');
        assert.equal(r.target.id, z.id);
        assert.equal(r.end, 'dead');
        assert.ok(r.hits[0].t >= 2000, `the first swing waited for the zombie (${r.hits[0].t} ms)`);
        assert.equal(judgeSeries(r, { path: 'bc', cooldownTicks: 13, ai: true }).ok, true);
    });

    test('a wrong world is caught: a fallback to vanilla, an early swing, a hit that does not land, fire, a tripped self-check', async () => {
        const series = async (opt, judge = { path: 'bc', hits: [8], cooldownTicks: 13 }) => {
            const w = bcWorld(opt);
            const { reply } = attach(w);
            w.give('minecraft:stone_sword');
            w.summon(-43, 66, -66);
            w.whisper('bc-hit eee555 bc -43,66,-66 minecraft:stone_sword');
            return judgeSeries(await reply('eee555'), judge).why;
        };
        assert.match(await series({ offPathAt: 3 }), /1 hit\(s\) not on the bettercombat path \(#3\)/);
        assert.match(await series({ earlyAt: 4 }), /1 gap\(s\) between Better Combat packets under 13 ticks \(550 ms\)/);
        assert.match(await series({ missAt: 2 }), /1 hit\(s\) did not lower the health \(#2\)/);
        assert.match(await series({ burn: true }), /burned/);
        assert.match(await series({ tripped: true }), /self-check tripped/);
        // A server where vanilla lands every time (no Better Combat rule) fails the vanilla check.
        const w = bcWorld({ vanillaAlways: true });
        const { reply } = attach(w);
        w.give('minecraft:stone_sword');
        w.summon(-47, 66, -66);
        w.whisper('bc-hit fff666 vanilla -47,66,-66 minecraft:stone_sword');
        assert.match(judgeSeries(await reply('fff666'), { path: 'vanilla' }).why, /later hit\(s\) changed the health \(#2, #3, #4, #5, #6, #7, #8\)/);
    });

    test('refusals: only the console, each token once, one series at a time, no wrapper, path off, no zombie, no item', async () => {
        const w = bcWorld();
        const { out, reply } = attach(w);
        w.give('minecraft:stone_sword');
        w.summon(-43, 66, -66);
        w.whisper('bc-hit aaa111 bc -43,66,-66 minecraft:stone_sword', 'JQDAW');
        assert.deepEqual(out.map((e) => e.type), ['bc_ignored'], 'a player\'s whisper is ignored');
        w.whisper('bc-hit aaa111 bc 1,2 hand');
        assert.match((await reply('aaa111')).error, /malformed/);
        w.whisper('bc-hit bbb222 bc -47,66,-66 minecraft:stone_sword');
        assert.match((await reply('bbb222')).error, /no zombie at -47,66,-66/);
        w.whisper('bc-hit bbb222 bc -43,66,-66 minecraft:stone_sword');
        assert.equal(out.filter((e) => e.token === 'bbb222' && e.type === 'bc_hit').length, 1, 'a used token is not run again');
        w.whisper('bc-hit ccc333 bc -43,66,-66 minecraft:stone_axe');
        assert.match((await reply('ccc333')).error, /holds no minecraft:stone_axe/);
        w.whisper('bc-hit ddd444 bc -43,66,-66 minecraft:stone_sword');
        w.whisper('bc-hit eee555 bc -43,66,-66 minecraft:stone_sword');
        assert.match((await reply('eee555')).error, /another bc-hit is running/);
        assert.equal((await reply('ddd444')).end, 'dead');
        const off = bcWorld({ bcActive: false });
        const t2 = attach(off);
        off.give('minecraft:stone_sword');
        off.summon(-43, 66, -66);
        off.whisper('bc-hit fff666 bc -43,66,-66 minecraft:stone_sword');
        assert.match((await t2.reply('fff666')).error, /not active: bettercombat attack: off/);
        const none = bcWorld({ noWrapper: true });
        const t3 = attach(none);
        none.whisper('bc-hit aaa999 vanilla -43,66,-66 hand');
        assert.match((await t3.reply('aaa999')).error, /no Better Combat wrapper/);
    });
});

/**
 * A simulated test server whose driver is the real bc-hit core on a fake world (fixtures/bc-world.mjs).
 * The console's setblock, testforblock, give, clear, summon and kill act on that world; `tell <bot> bc-hit`
 * reaches the core as the console's whisper. opt: world (bcWorld options), log (extra server log lines
 * after the join), kick (a command prefix at which the server kicks the bot), noEnv (the driver ignores
 * the scenario's env: Better Combat stays off), noSummon.
 */
function sim(opt = {}) {
    const log = [];
    let t = 0;
    let online = false;
    let alive = false;
    let startEnv = null;
    const blocks = new Map();
    const add = (msg, logger = DS, level = 'INFO') => log.push(L(msg, logger, level));
    const output = [];
    let w = null;
    const cmds = [];
    const server = {
        console(cmd, waitS = 1) {
            cmds.push(cmd);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if ((m = /^tp (\S+) (-?\d+) (-?\d+) (-?\d+)$/.exec(cmd))) add(`Teleported ${m[1]} to ${Number(m[2]) + 0.5}, ${m[3]}.0, ${Number(m[4]) + 0.5}`);
            else if (cmd === `tp ${NAME} ~ ~ ~`) add(`Teleported ${NAME} to -44.5, 66.0, -65.5`);
            else if (cmd === `clear ${NAME}`) { w?.clear(); add(`Cleared the inventory of ${NAME}, removing 1 items`); }
            else if ((m = /^give (\S+) (\S+) (\d+) \d+$/.exec(cmd))) { w?.give(m[2], Number(m[3])); add(`Given [${m[2]}] * ${m[3]} to ${m[1]}`); }
            else if ((m = /^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) { blocks.set(`${m[1]},${m[2]},${m[3]}`, m[4]); add('Block placed'); }
            else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
                const b = blocks.get(`${m[1]},${m[2]},${m[3]}`) ?? 'minecraft:grass';
                add(b === m[4] ? `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}` : `The block at ${m[1]}, ${m[2]}, ${m[3]} is ${b} (expected: ${m[4]})`);
            } else if ((m = /^summon minecraft:zombie (-?\d+) (-?\d+) (-?\d+)( \{NoAI:1\})?$/.exec(cmd))) {
                if (!opt.noSummon) { w?.summon(Number(m[1]), Number(m[2]), Number(m[3]), { ai: !m[4] }); add('Object successfully summoned'); }
                else add('Unable to summon object');
            } else if (cmd === 'kill @e[type=zombie]') { w?.kill(); add('Killed Zombie'); }
            else if ((m = /^tell (\S+) (.*)$/.exec(cmd)) && online) {
                if (opt.kick && m[2].startsWith(opt.kick)) { online = false; add(`${NAME} lost connection: Kicked by an operator`); }
                else w?.whisper(m[2]);
            } else if (/^(gamerule|time) /.test(cmd)) add('ok');
            t += waitS * 1000;
            return log.slice(before);
        },
        log: (n) => log.slice(-n),
    };
    const bot = {
        start(env = {}) {
            startEnv = env;
            alive = true;
            const on = !opt.noEnv && env.ROTN_DRIVER_BC_ATTACK === 'on';
            w = bcWorld({ ...(opt.world ?? {}), bcActive: on });
            attachBcAttack(w.bot, { emit: (type, data) => output.push(`DRIVER ${JSON.stringify({ type, ...data })}`), now: w.clock.now, sleep: w.clock.sleep });
            output.push(`DRIVER ${JSON.stringify({ type: 'bc_status', wrapper: true, attackVanilla: true, active: on, status: w.bot.forge.bcAttack.status() })}`);
            if (opt.trip) output.push('[forge-bridge] bettercombat attack: 5 hits without a hurt, back to vanilla for this connection');
            add(`UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`, 'net.minecraft.server.network.NetHandlerLoginServer');
            online = true;
            add(`${NAME} joined the game`);
            for (const l of opt.log ?? []) log.push(l);
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => output,
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    // Each scenario sleep lets the core (on its own virtual clock) run many steps.
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 400; i++) await tick(); } };
    return { server, bot, clock, blocks, cmds, sent: log, startEnv: () => startEnv, world: () => w };
}

const fast = { settleMs: 1000, tpSettleMs: 1000, summonSettleMs: 1000, consoleWaitS: 0, pollMs: 1000 };
const run = (s, params = {}) => runScenario(probe, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('probe-bc-attack on a simulated server and log', () => {
    let saved;
    before(() => { saved = process.env.TEST_SERVER_NAME; process.env.TEST_SERVER_NAME = SERVER; });
    after(() => { if (saved === undefined) delete process.env.TEST_SERVER_NAME; else process.env.TEST_SERVER_NAME = saved; });

    test('everything as #518 says: every check passes, and it is never a gate pass', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(probe.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(r.verdict, 'SMOKE-PASS (not a gate pass)');
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.includes(BC_NOT_GATE));
        assert.deepEqual(s.startEnv().ROTN_DRIVER_BC_ATTACK, 'on');
        assert.deepEqual(r.notes.series.map((x) => [x.key, x.reply.hits.length, x.reply.end]), [
            ['vanilla_stone_sword', 40, 'maxHits'], ['bc_stone_sword', 8, 'dead'], ['vanilla_stone_axe', 24, 'maxMs'], ['bc_stone_axe', 9, 'dead'],
            ['vanilla_crude_axe', 40, 'maxHits'], ['bc_crude_axe', 9, 'dead'], ['vanilla_hand', 40, 'maxHits'], ['bc_hand', 27, 'dead'], ['bc_ai_zombie', 8, 'dead']]);
        assert.match(c.bc_stone_sword.detail, /^8 hit\(s\), end dead, health 20 -> 0, 8 to kill: as planned$/);
        assert.equal(s.blocks.get('-45,65,-66'), 'minecraft:stone');
        assert.equal(s.blocks.get('-45,68,-66'), 'minecraft:stone', 'the roof against daylight');
        // After each step (a weapon's Better Combat series, the AI zombie) a kill comes before anything is summoned again.
        const steps = s.cmds.map((x, i) => [x, i]).filter(([x]) => / bc-hit [0-9a-f]+ bc /.test(x));
        assert.equal(steps.length, 5);
        for (const [, i] of steps) {
            const next = s.cmds.slice(i + 1).find((x) => /^(kill|summon) /.test(x));
            assert.equal(next, 'kill @e[type=zombie]', `after ${s.cmds[i]}`);
            assert.equal(s.cmds[i + 1], 'kill @e[type=zombie]', 'at once');
        }
    });

    test('a server where vanilla lands every time fails the four vanilla checks only', async () => {
        const r = await run(sim({ world: { vanillaAlways: true } }));
        const c = byName(r);
        for (const w of BC_PLAN.weapons) {
            assert.equal(c[`vanilla_${w.check}`].pass, false, w.check);
            assert.match(c[`vanilla_${w.check}`].detail, /later hit\(s\) changed the health/);
            assert.equal(c[`bc_${w.check}`].pass, true, c[`bc_${w.check}`].detail);
        }
    });

    test('the codec exception in the server log fails server_log; the self-check line fails self_check', async () => {
        const r = await run(sim({ log: [L('FMLIndexedMessageCodec exception caught', 'FML', 'ERROR')], trip: true }));
        const c = byName(r);
        assert.equal(c.server_log.pass, false);
        assert.match(c.server_log.detail, /^1 codec or bettercombat problem line\(s\) \(first: .*FMLIndexedMessageCodec exception caught\); 0 kick/);
        assert.equal(c.self_check.pass, false);
        assert.match(c.self_check.detail, /^tripped: \[forge-bridge\] bettercombat attack: 5 hits/);
        assert.equal(c.bc_stone_sword.pass, true);
    });

    test('Better Combat\'s path not active (the driver did not get the switch): setup fails, no zombie is summoned', async () => {
        const s = sim({ noEnv: true });
        const r = await run(s);
        const c = byName(r);
        assert.equal(c.login_online.pass, true);
        assert.equal(c.setup.pass, false);
        assert.match(c.setup.detail, /Better Combat's path NOT active \(bettercombat attack: off/);
        assert.ok(!s.sent.some((l) => /summoned/.test(l)));
        assert.equal(c.bc_stone_sword.detail, 'not reached');
    });

    test('not a test server: nothing is sent, not even the begin marker', async () => {
        process.env.TEST_SERVER_NAME = 'some-live-box';
        try {
            const s = sim();
            const r = await run(s);
            const c = byName(r);
            assert.equal(c.login_online.pass, false);
            assert.match(c.login_online.detail, /not a disposable test server/);
            assert.deepEqual(s.sent, []);
            assert.equal(s.startEnv(), null, 'the driver was never started');
        } finally { process.env.TEST_SERVER_NAME = SERVER; }
    });

    test('the CX23 service as the bot is refused before anything is sent', async () => {
        const s = sim();
        const r = await run({ ...s, bot: { ...s.bot, kind: 'service' } });
        assert.match(byName(r).login_online.detail, /needs its own driver/);
        assert.deepEqual(s.sent, []);
    });

    test('a kick during a series aborts the run; the checks after it are not reached', async () => {
        const r = await run(sim({ kick: 'bc-hit' }), { replyTimeoutMs: 3000, stepAbortMs: 5000 });
        const c = byName(r);
        assert.equal(c.vanilla_stone_sword.pass, false);
        assert.match(r.notes.aborted, /kicked \(lost\)/);
        assert.equal(c.bc_hand.detail, 'not reached');
    });

    test('a zombie that cannot be summoned fails that weapon\'s two checks with the reason', async () => {
        const r = await run(sim({ noSummon: true }));
        const c = byName(r);
        assert.match(c.vanilla_stone_sword.detail, /zombie A not summoned, zombie B not summoned/);
        assert.equal(c.bc_ai_zombie.pass, false);
    });
});
