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
    BC_DRIVER_ENV, BC_NOT_GATE, BC_PLAN, P1_CONSOLE_ALLOW, bcConsoleAllow, bcHit, bcLaneCells, bcLaneClear, bcLaneFills, bcLogProblems, bcReply, guardBcConsole,
    bcExpected, judgeSeries, markCrits, noAiIntrusion, notMeasured, projectedHits, zombieCatalogueHealth,
} from '../runner/lib/probe.mjs';
import { attachBcAttack, attribute, gapsOf, parseBcHit, whisperOf } from '../runner/drivers/bc-attack.mjs';
import probe from '../scenarios/probe/probe-bc-attack.mjs';
import { bcWorld } from './fixtures/bc-world.mjs';

const NAME = 'FRCFLD';
const SERVER = 'mcr-test-20261121-101500';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const L = (msg, logger = DS, level = 'INFO') => `[12:00:00] [Server thread/${level}] [${logger}]: ${msg}`;
const tick = () => new Promise((r) => setImmediate(r));
const BC_ALLOW = bcConsoleAllow(NAME);
// rotn-data's hitsToKill as ranges (#518, #528): every hit a crit to none.
const SWORD = bcExpected('minecraft:stone_sword');
const AXE = bcExpected('minecraft:stone_axe');
const CRUDE = bcExpected('pyrotech:crude_axe');
const HAND = bcExpected('hand');
const allowed = (cmd) => BC_ALLOW.some((re) => re.test(cmd));

describe('probe BC\'s console: summon and kill for this probe only, on a disposable test server only', () => {
    test('every command the scenario sends is on the list', () => {
        const p = BC_PLAN;
        const sent = [
            'say scenario-probe-bc-attack-r1-begin', 'seed', 'gamerule doDaylightCycle false', 'time set day', 'kill @e[type=zombie]',
            'fill -49 119 -67 -40 122 -65 minecraft:stone', 'fill -48 120 -66 -41 121 -66 minecraft:air', 'kill @e[type=!player,x=-45,y=120,z=-66,r=8]',
            ...bcLaneCells().map(([x, y, z, b]) => `testforblock ${x} ${y} ${z} ${b}`),
            `tp ${NAME} ${p.landing.join(' ')}`, `tp ${NAME} ~ ~ ~`, `clear ${NAME}`,
            ...p.weapons.filter((w) => w.give).map((w) => `give ${NAME} ${w.item} 1 0`), `give ${NAME} ${p.ai.item} 1 0`,
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

    test('#527 review: exactly the plan\'s commands: its three summons at their cells, this bot, the BC items and counts, the landing, the lane', () => {
        for (const c of [
            'summon minecraft:zombie -46 120 -66 {NoAI:1}', 'summon minecraft:zombie 0 64 0 {NoAI:1}', 'summon minecraft:zombie -47 120 -66',
            'summon minecraft:zombie -43 120 -66', 'summon minecraft:zombie -42 120 -66 {NoAI:1}', 'summon minecraft:zombie -42 121 -66',
            'summon minecraft:zombie -47 66 -66 {NoAI:1}', 'summon minecraft:zombie -43 66 -66 {NoAI:1}', 'summon minecraft:zombie -42 66 -66',
            'give JQDAW minecraft:stone_sword 1 0', `give ${NAME} minecraft:iron_sword 1 0`, `give ${NAME} minecraft:stone_sword 64 0`, `give ${NAME} minecraft:stone_sword 1 1`,
            `give ${NAME} pyrotech:crude_axe 7 0`, `give ${NAME} pyrotech:crude_axe 6 0`, `give ${NAME} minecraft:stone_axe 2 0`, `give ${NAME} minecraft:bread 1 0`, 'tp JQDAW -45 66 -66', `tp ${NAME} 0 200 0`, 'tp JQDAW ~ ~ ~', 'clear JQDAW',
            'setblock -49 65 -66 minecraft:stone', 'setblock -45 66 -65 minecraft:air', 'setblock 0 64 0 minecraft:stone', 'testforblock 0 64 0 minecraft:stone',
            'setblock -45 119 -66 minecraft:stone', 'setblock -45 120 -66 minecraft:air', 'testforblock -45 66 -66 minecraft:air', 'testforblock -49 119 -67 minecraft:stone',
            'fill -49 119 -67 -40 122 -65 minecraft:air', 'fill -49 119 -67 -40 122 -65 minecraft:tnt', 'fill -50 119 -67 -40 122 -65 minecraft:stone',
            'fill -49 119 -67 -40 122 -65 minecraft:stone 0 replace', 'fill -48 120 -66 -41 121 -66 minecraft:air 0 destroy', 'fill 0 0 0 100 100 100 minecraft:stone',
            'fill -48 66 -66 -41 67 -66 minecraft:air', `tp ${NAME} -45 66 -66`,
            'kill @e[type=!player]', 'kill @e[x=-45,y=120,z=-66,r=8]', 'kill @e[type=!player,x=-45,y=120,z=-66,r=9]', 'kill @e[type=!player,x=-45,y=120,z=-66,r=80]',
            'kill @e[type=!player,x=-45,y=66,z=-66,r=8]', 'kill @e[type=!zombie,x=-45,y=120,z=-66,r=8]', 'kill @e[type=!player,r=8]',
            'kill @e[type=!player,x=-45,y=120,z=-66,r=8,c=1]', 'kill @e[type=!player,x=-45,y=120,z=-66,r=8] ', 'kill @e[type=player,x=-45,y=120,z=-66,r=8]',
            `tell ${NAME} bc-hit abc123 bc -47,120,-66 minecraft:stone_sword`, `tell ${NAME} bc-hit abc123 vanilla -43,120,-66 minecraft:stone_sword`,
            `tell ${NAME} bc-hit abc123 vanilla ai minecraft:stone_sword`, `tell ${NAME} bc-hit abc123 bc ai hand`, `tell ${NAME} bc-hit abc123 bc -43,120,-66 minecraft:iron_sword`,
            'tell JQDAW bc-hit abc123 bc -43,120,-66 minecraft:stone_sword', `tell ${NAME} bc-hit abc123 bc 0,64,0 hand`, `tell ${NAME} bc-hit abc123 bc -43,66,-66 hand`,
        ]) assert.ok(!allowed(c), c);
        // Another bot name gets its own list; nothing of FRCFLD's.
        const other = bcConsoleAllow('OtherBot');
        assert.ok(other.some((re) => re.test('clear OtherBot')));
        assert.ok(!other.some((re) => re.test(`clear ${NAME}`)));
        for (const bad of ['', 'a b', 'x;op', '@a', 'ab', 'a'.repeat(17), undefined]) assert.throws(() => bcConsoleAllow(bad), /bad bot name/, String(bad));
    });

    test('attempt 1 (#535): the lane is an enclosed stone box in the air; its 68 cells; two fills and nothing else', () => {
        assert.deepEqual(bcLaneFills(), ['fill -49 119 -67 -40 122 -65 minecraft:stone', 'fill -48 120 -66 -41 121 -66 minecraft:air']);
        const cells = bcLaneCells();
        assert.equal(cells.length, 68);
        assert.equal(new Set(cells.map((c) => c.slice(0, 3).join(','))).size, 68, 'no cell twice');
        const at = (x, y, z) => cells.find((c) => c[0] === x && c[1] === y && c[2] === z)?.[3];
        for (const [x, y, z] of [BC_PLAN.landing, BC_PLAN.zombieA, BC_PLAN.zombieB, BC_PLAN.zombieAi]) {
            assert.equal(at(x, y, z), 'minecraft:air');
            assert.equal(at(x, y + 1, z), 'minecraft:air');
            assert.equal(at(x, y - 1, z), 'minecraft:stone', 'floor');
            assert.equal(at(x, y + 2, z), 'minecraft:stone', 'roof');
            for (const dz of [-1, 1]) for (const dy of [0, 1]) assert.equal(at(x, y + dy, z + dz), 'minecraft:stone', 'walls');
        }
        for (const x of [-49, -40]) for (const dy of [0, 1]) assert.equal(at(x, 120 + dy, -66), 'minecraft:stone', 'end walls');
        // Every cell lies inside the first fill's box; the air ones inside the second's.
        for (const [x, y, z, b] of cells) {
            assert.ok(x >= -49 && x <= -40 && y >= 119 && y <= 122 && z >= -67 && z <= -65, `${x} ${y} ${z}`);
            if (b === 'minecraft:air') assert.ok(x >= -48 && x <= -41 && y >= 120 && y <= 121 && z === -66);
        }
        assert.ok(BC_ALLOW.every((re) => !re.test('setblock -45 119 -66 minecraft:stone')), 'no setblock at all');
        // The lane clear (after #540): every lane cell is well inside its radius, and only non-players are matched.
        assert.equal(bcLaneClear(), 'kill @e[type=!player,x=-45,y=120,z=-66,r=8]');
        const far = Math.max(...cells.map(([x, y, z]) => Math.hypot(x + 0.5 - -45, y + 0.5 - 120, z + 0.5 - -66)));
        assert.ok(far < 6, `the farthest lane cell is ${far.toFixed(2)} blocks from the centre`);
        assert.match(bcLaneClear(), /\[type=!player,/, 'never a player: not the bot, not anyone else');
    });

    test('P1\'s list stays without summon and kill', () => {
        for (const c of ['summon minecraft:zombie -47 120 -66 {NoAI:1}', 'summon minecraft:zombie -42 120 -66', 'kill @e[type=zombie]', 'fill -48 120 -66 -41 121 -66 minecraft:air']) {
            assert.ok(!P1_CONSOLE_ALLOW.some((re) => re.test(c)), c);
        }
    });

    test('guardBcConsole refuses everything unless the server is a disposable test server, and anything off the list', () => {
        const seen = [];
        const srv = { console: (c) => { seen.push(c); return ['ok']; }, log: () => [] };
        for (const name of [undefined, null, '', 'live', 'rotn-live', 'mcr-test-2026', 'mcr-test-20261121-101500x', 'xmcr-test-20261121-101500']) {
            const g = guardBcConsole(srv, name, NAME);
            assert.throws(() => g.console('kill @e[type=zombie]', 1), /not a disposable test server/, String(name));
            assert.throws(() => g.console('time set day', 1), /not a disposable test server/, String(name));
        }
        assert.deepEqual(seen, [], 'nothing reached the server');
        const g = guardBcConsole(srv, SERVER, NAME);
        assert.deepEqual(g.console('summon minecraft:zombie -47 120 -66 {NoAI:1}', 1), ['ok']);
        assert.throws(() => g.console('kill @e', 1), /console command refused/);
        assert.throws(() => g.console('op FRCFLD', 1), /console command refused/);
        assert.deepEqual(seen, ['summon minecraft:zombie -47 120 -66 {NoAI:1}']);
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

    test('bcExpected: rotn-data\'s hitsToKill as a range (#528): every hit a crit (x1.5) to none; the hand takes 0.5 off', () => {
        assert.deepEqual([SWORD, AXE, CRUDE, HAND].map((e) => [e.min, e.max]), [[5, 8], [6, 9], [6, 9], [36, 54]]);
        for (const e of [SWORD, AXE, CRUDE, HAND]) assert.ok(e.critHit / e.perHit > 1.4 && e.critHit / e.perHit < 1.6, 'x1.5 before armour');
        assert.throws(() => bcExpected('minecraft:no_such_sword'), /no hitsToKill/);
    });

    test('#533 review: bcExpected takes the measured start health (else the catalogue\'s 20); judgeSeries says whether hit 1 was a crit', () => {
        assert.deepEqual([SWORD.health, SWORD.healthFrom], [20, 'catalogue']);
        const at24 = bcExpected('minecraft:stone_sword', { health: 24 });
        assert.deepEqual([at24.min, at24.max, at24.health, at24.healthFrom], [6, 9, 24, 'measured']);
        assert.equal(bcExpected('minecraft:stone_sword', { health: null }).healthFrom, 'catalogue');
        assert.equal(bcExpected('minecraft:stone_sword', { health: 0 }).healthFrom, 'catalogue');
        const series = (drops) => ({ ok: true, target: { id: 1, startHealth: 20 }, end: 'dead', hits: drops.map((d, k) => ({ i: k + 1, t: k * 650, path: 'bettercombat', sent: true, drop: d, died: k === drops.length - 1, healthAfter: k === drops.length - 1 ? 0 : 1 })), gaps: { bettercombat: [] } });
        assert.equal(judgeSeries(series([4.133, 2.733, 2.733, 2.733, 2.733, 2.733, 2.202]), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).firstHitCrit, true);
        assert.equal(judgeSeries(series([2.733, 2.733, 2.733, 2.733, 2.733, 2.733, 2.733, 0.869]), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).firstHitCrit, false);
        assert.equal(judgeSeries(series([20]), { path: 'bc', expected: { ...SWORD, min: 1 }, cooldownTicks: 13 }).firstHitCrit, true, 'a one-hit kill above a crit\'s drop');
        assert.equal(judgeSeries(series([2]), { path: 'bc', expected: { ...SWORD, min: 1 }, cooldownTicks: 13 }).firstHitCrit, null, 'a killing first hit below the midpoint: unknown');
    });

    test('after #540: notMeasured flags a start health other than the catalogue\'s; judgeSeries is then inconclusive, not judged', () => {
        assert.equal(zombieCatalogueHealth(), 20, 'rotn-data combat.json');
        const r = (h) => ({ ok: true, target: { id: 1, startHealth: h }, end: 'dead', hits: [{ i: 1, t: 0, path: 'vanilla', sent: true, drop: 4, died: true, healthAfter: 0 }], gaps: {} });
        assert.equal(notMeasured(r(20)), null);
        assert.equal(notMeasured(r(null)), null, 'not read: not flagged');
        assert.equal(notMeasured(r(8)), 'not measured: the zombie started at 8 health, not the catalogue\'s 20');
        const v = judgeSeries(r(8), { path: 'vanilla' });
        assert.deepEqual([v.ok, v.inconclusive, v.why], [false, true, 'not measured: the zombie started at 8 health, not the catalogue\'s 20']);
        const judged = judgeSeries(r(20), { path: 'vanilla' });
        assert.deepEqual([judged.ok, judged.inconclusive, judged.why], [false, false, 'only 1 hit(s)'], 'a fresh zombie is judged as before');
    });

    test('after #543: noAiIntrusion: anything else alive in the lane box, or a hurt to the bot; the step\'s own zombies, the dead and the outside do not count', () => {
        const cells = [BC_PLAN.zombieA, BC_PLAN.zombieB];
        const r = (entities, botHurts = []) => ({ census: [{ t: 0, entities }, { t: 1000, entities }], botHurts });
        const z = (id, pos, health = 20, name = 'zombie') => ({ id, name, health, pos, d: 1 });
        assert.equal(noAiIntrusion(r([z(1, [-46.5, 120, -65.5]), z(2, [-42.5, 120, -65.5])]), { cells }), null, 'A and B themselves');
        assert.equal(noAiIntrusion(r([z(3, [-46.5, 120, -65.5], 0, 'parasite')]), { cells }), null, 'a dead one');
        assert.equal(noAiIntrusion(r([{ id: 4, name: 'item', health: null, pos: [-45, 120, -66], d: 0.5 }]), { cells }), null, 'an item has no health');
        assert.equal(noAiIntrusion(r([z(5, [-45, 124, -66], 10, 'bat')]), { cells }), null, 'above the box');
        assert.equal(noAiIntrusion(r([z(6, [-45, 120, -68.1], 10, 'spider')]), { cells }), null, 'beside the box');
        assert.equal(noAiIntrusion(r([z(7, [-44.5, 120, -65.5], 8, 'parasite')]), { cells }), 'not clean: the census saw parasite #7 at -44.5 120 -65.5 (t 0 ms) in the lane', 'once, at its first sighting');
        assert.equal(noAiIntrusion(r([z(8, [-45.5, 120, -65.5], 20, 'zombie')]), { cells }), 'not clean: the census saw zombie #8 at -45.5 120 -65.5 (t 0 ms) in the lane', 'a third zombie, not at A or B');
        assert.equal(noAiIntrusion(r([], [{ t: 500, amount: 3.333, cause: 'melee by parasite #7' }]), { cells }), 'not clean: the bot was hurt 1x (3.333 at t 500 ms, melee by parasite #7)');
        // After #549: only mobs are alive. The scent marker (type other) is not, whatever its metadata 7 says; a mob whose
        // health was not read is; a parasite first seen at or after the target's death does not intrude.
        const typed = (id, name, type, health, pos) => ({ id, name, type, health, pos, d: 1 });
        assert.equal(noAiIntrusion(r([typed(9, 'zombieawareness:entityscent', 'other', 104, [-42.5, 121.74, -65.5])]), { cells }), null, 'the scent marker');
        assert.equal(noAiIntrusion(r([typed(10, 'item', 'object', null, [-45, 120, -66])]), { cells }), null, 'an item');
        assert.equal(noAiIntrusion(r([typed(13, 'xp_orb', 'orb', null, [-45, 120, -66]), typed(14, 'arrow', 'projectile', null, [-45, 120, -66])]), { cells }), null, 'an orb, an arrow');
        // #549 review: the real parasite is type hostile; any living type counts, not only mob.
        assert.equal(noAiIntrusion(r([typed(15, 'mod_lavacow:parasite', 'hostile', 3, [-44.5, 120, -65.5])]), { cells }),
            'not clean: the census saw mod_lavacow:parasite #15 at -44.5 120 -65.5 (t 0 ms) in the lane', 'a hostile parasite');
        assert.equal(noAiIntrusion(r([typed(11, 'mod_lavacow:parasite', 'mob', null, [-44.5, 120, -65.5])]), { cells }),
            'not clean: the census saw mod_lavacow:parasite #11 at -44.5 120 -65.5 (t 0 ms) in the lane', 'a mob with unread health');
        const afterDeath = { census: [{ t: 9000, entities: [] }, { t: 10614, entities: [typed(12, 'mod_lavacow:parasite', 'mob', 3, [-43.37, 121, -66.37])] }], botHurts: [], target: { diedAt: 9700 } };
        assert.equal(noAiIntrusion(afterDeath, { cells }), null, 'spawned by the target\'s own death (attempt 3)');
        const before = { ...afterDeath, census: [{ t: 9000, entities: [typed(12, 'mod_lavacow:parasite', 'mob', 3, [-43.37, 121, -66.37])] }, ...afterDeath.census.slice(1)] };
        assert.match(noAiIntrusion(before, { cells }), /mod_lavacow:parasite #12 at .* \(t 9000 ms\)/, 'there before the death: it counts');
        // judgeSeries applies it only with noAiCells (the AI step has none).
        const s = { ok: true, target: { id: 1, startHealth: 20 }, end: 'dead', hits: [], gaps: {}, census: [{ t: 0, entities: [z(7, [-44.5, 120, -65.5], 8, 'parasite')] }] };
        assert.equal(judgeSeries(s, { path: 'bc', noAiCells: cells }).inconclusive, true);
        assert.equal(judgeSeries(s, { path: 'bc', ai: true }).inconclusive, false);
    });

    test('#541: a call the wrapper refuses (out of reach or sight) is named as the wrapper refusing', () => {
        const s = { ok: true, target: { id: 1, startHealth: 20 }, end: 'dead', gaps: { bettercombat: [] },
            hits: [{ i: 1, sent: true, path: 'bettercombat', drop: 20, died: true, healthAfter: 0 }, { i: 2, sent: false, path: null, reason: 'reach' }, { i: 3, sent: false, path: null, reason: 'sight' }] };
        assert.match(judgeSeries(s, { path: 'bc', ai: true }).why, /2 call\(s\) sent nothing \(reach, sight\)/);
    });

    test('markCrits: a drop at least halfway to a crit\'s is a crit; a killing hit below that says nothing', () => {
        const hs = [{ i: 1, drop: 4.133 }, { i: 2, drop: 2.733 }, { i: 3, drop: 2.733 }, { i: 4, drop: 4.133 }, { i: 5, drop: 0 }, { i: 6, drop: 1.2, died: true, healthAfter: 0 }];
        assert.deepEqual(markCrits(hs, SWORD), { crits: [1, 4], plain: [2, 3], unknown: [6] });
        assert.deepEqual(markCrits([{ i: 7, drop: 4.2, died: true, healthAfter: 0 }], SWORD).crits, [7], 'a killing crit still shows');
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
        const ok = judgeSeries(bc(Array(8).fill(2.6)), { path: 'bc', expected: SWORD, cooldownTicks: 13 });
        assert.deepEqual([ok.ok, ok.projected, ok.inRange], [true, 8, true]);
        assert.match(judgeSeries(bc(Array(4).fill(5)), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /4 hits to kill, not in rotn-data's 5-8/, 'fewer than every hit a crit');
        assert.match(judgeSeries(bc([2.6, 0, 2.6, 2.6, 2.6, 2.6, 2.6, 2.6, 2.6]), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /1 hit\(s\) did not lower the health \(#2\)/);
        assert.match(judgeSeries(bc(Array(12).fill(1.7)), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /12 hits to kill, not in rotn-data's 5-8/);
        assert.match(judgeSeries(bc(Array(8).fill(2.6), { gaps: { bettercombat: [650, 549, 650] } }), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /1 gap\(s\) between Better Combat packets under 13 ticks \(549 ms\)/);
        assert.equal(judgeSeries(bc(Array(8).fill(2.6), { gaps: { bettercombat: [649, 648] } }), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).ok, true, 'a timer may fire up to 2 ms early');
        assert.match(judgeSeries(bc(Array(8).fill(2.6), { tripped: true }), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /self-check tripped/);
        assert.match(judgeSeries(bc(Array(8).fill(2.6), { end: 'maxMs' }), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /did not die \(maxMs\)/);
        const off = bc(Array(8).fill(2.6));
        off.hits[3].path = 'vanilla';
        assert.match(judgeSeries(off, { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /1 hit\(s\) not on the bettercombat path \(#4\)/);
        const replaced = bc(Array(8).fill(2.6));
        replaced.hits[2].sent = false;
        assert.match(judgeSeries(replaced, { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /1 call\(s\) sent nothing/);
    });

    test('the bare hand: 40 hits without a kill is judged by the projection (rotn-data: 36 to 54, with 0.5 taken off)', () => {
        const plain = bc(Array(40).fill(0.3712), { end: 'maxHits' });
        assert.equal(projectedHits(plain), 54);
        const v = judgeSeries(plain, { path: 'bc', expected: HAND, cooldownTicks: 13 });
        assert.deepEqual([v.ok, v.inRange], [true, true], v.why);
        assert.match(judgeSeries(bc(Array(40).fill(0.2), { end: 'maxHits' }), { path: 'bc', expected: HAND, cooldownTicks: 13 }).why, /100 hits to kill \(projected\), not in rotn-data's 36-54/);
        assert.match(judgeSeries(bc(Array(40).fill(0.75), { end: 'maxHits' }), { path: 'bc', expected: HAND, cooldownTicks: 13 }).why, /27 hits to kill \(projected\), not in rotn-data's 36-54/, '#518\'s 27 (no 0.5 off) fails now');
        assert.match(judgeSeries(bc(Array(40).fill(0.37), { end: 'maxHits' }), { path: 'bc', expected: SWORD, cooldownTicks: 13 }).why, /did not die \(maxHits\)/, 'a weapon must kill');
        assert.equal(judgeSeries(bc(Array(36).fill(0.5592)), { path: 'bc', expected: HAND, cooldownTicks: 13 }).ok, true, 'every hit a crit: dead in 36');
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

    test('stone sword: vanilla lands once in 40 hits paced at 13 ticks; Better Combat kills in 7 (the first a sneak crit, #528) with 650-ms gaps', async () => {
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
        assert.deepEqual(rv.hits.slice(0, 3).map((h) => [h.path, h.healthBefore, h.healthAfter, h.drop, h.hurt]), [['vanilla', 20, 17.267, 2.733, true], ['vanilla', 17.267, 17.267, 0, false], ['vanilla', 17.267, 17.267, 0, false]]);
        assert.ok(rv.gaps.vanilla.every((g) => g >= 650), rv.gaps.vanilla.join(','));
        assert.equal(rv.packets.use_entity, 40);
        assert.equal(rv.packets.bettercombat, 0);
        assert.equal(judgeSeries(rv, { path: 'vanilla' }).ok, true);
        w.whisper('bc-hit bbb222 bc -43,66,-66 minecraft:stone_sword');
        const rb = await reply('bbb222');
        assert.equal(rb.target.id, b.id);
        assert.equal(rb.end, 'dead');
        assert.equal(rb.hits.length, 7);
        assert.ok(rb.hits.every((h) => h.path === 'bettercombat' && h.drop > 0 && h.hurt === (h.healthAfter > 0)), JSON.stringify(rb.hits));
        assert.equal(rb.hits.at(-1).healthAfter, 0);
        assert.ok(rb.gaps.bettercombat.length === 6 && rb.gaps.bettercombat.every((g) => g >= 650), rb.gaps.bettercombat.join(','));
        assert.equal(rb.packets.use_entity, 0, 'never use_entity on Better Combat\'s path');
        assert.deepEqual([rb.statsAfter.bettercombat - rb.statsBefore.bettercombat, rb.tripped, rb.burned], [7, false, false]);
        const v = judgeSeries(rb, { path: 'bc', expected: SWORD, cooldownTicks: 13 });
        assert.deepEqual([v.ok, v.projected, v.crits], [true, 7, { crits: [1], plain: [2, 3, 4, 5, 6], unknown: [7] }], v.why);
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
        assert.equal(judgeSeries(rb, { path: 'bc', expected: AXE, cooldownTicks: 50 }).ok, true);
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
        assert.equal(judgeSeries(rb, { path: 'bc', expected: CRUDE, cooldownTicks: 22 }).ok, true);
        // Out of axes: the series ends item_gone.
        const w2 = bcWorld();
        const t2 = attach(w2);
        w2.give('pyrotech:crude_axe', 1);
        w2.summon(-43, 66, -66);
        w2.whisper('bc-hit ccc333 bc -43,66,-66 pyrotech:crude_axe');
        const r2 = await t2.reply('ccc333');
        assert.deepEqual([r2.end, r2.hits.length], ['item_gone', 4]);
        assert.match(judgeSeries(r2, { path: 'bc', expected: CRUDE, cooldownTicks: 22 }).why, /did not die \(item_gone\)/);
    });

    test('empty hand: an empty hotbar slot; with 0.5 off, 40 hits and a projection of 54; every hit a crit kills in 36', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.summon(-43, 66, -66);
        w.whisper('bc-hit bbb222 bc -43,66,-66 hand');
        const rb = await reply('bbb222');
        assert.deepEqual([rb.end, rb.hits.length], ['maxHits', 40]);
        const v = judgeSeries(rb, { path: 'bc', expected: HAND, cooldownTicks: 13 });
        assert.deepEqual([v.ok, v.projected, v.crits.crits], [true, 54, [1]], v.why);
        const w2 = bcWorld({ critAt: Array.from({ length: 40 }, (_, i) => i + 1) });
        const t2 = attach(w2);
        w2.summon(-43, 66, -66);
        w2.whisper('bc-hit ccc333 bc -43,66,-66 hand');
        const r2 = await t2.reply('ccc333');
        assert.deepEqual([r2.end, r2.hits.length], ['dead', 36]);
        assert.equal(judgeSeries(r2, { path: 'bc', expected: HAND, cooldownTicks: 13 }).ok, true);
    });

    test('random crits shorten a series, inside the range; the crits are marked', async () => {
        const w = bcWorld({ critAt: [3, 5] });
        const { reply } = attach(w);
        w.give('minecraft:stone_sword');
        w.summon(-43, 66, -66);
        w.whisper('bc-hit ddd444 bc -43,66,-66 minecraft:stone_sword');
        const r = await reply('ddd444');
        const v = judgeSeries(r, { path: 'bc', expected: SWORD, cooldownTicks: 13 });
        assert.deepEqual([r.hits.length, v.ok, v.crits.crits], [6, true, [1, 3, 5]], v.why);
        const w2 = bcWorld({ noSneak: true });
        const t2 = attach(w2);
        w2.give('minecraft:stone_sword');
        w2.summon(-43, 66, -66);
        w2.whisper('bc-hit eee555 bc -43,66,-66 minecraft:stone_sword');
        const r2 = await t2.reply('eee555');
        assert.deepEqual([r2.hits.length, judgeSeries(r2, { path: 'bc', expected: SWORD, cooldownTicks: 13 }).crits.crits], [8, []], 'no crit at all: the plain 8');
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
        const series = async (opt, judge = { path: 'bc', expected: SWORD, cooldownTicks: 13 }) => {
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

    test('after #540: the target\'s identity at the start, and the bot\'s own hurts with who swung', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_axe');
        const a = w.summon(-47, 66, -66);
        const other = w.summon(-46, 66, -65, { ai: true });
        w.clock.at(w.clock.now() + 1000, () => w.hurtBot(3.333, other.id));
        w.clock.at(w.clock.now() + 2500, () => w.hurtBot(1));   // more than 1 s after that swing: cause unknown
        w.whisper('bc-hit aaa111 vanilla -47,66,-66 minecraft:stone_axe');
        const r = await reply('aaa111');
        assert.equal(r.target.id, a.id);
        assert.deepEqual([r.target.name, r.target.startHealth, r.target.noAI, r.target.baby, r.target.startPos, r.target.moved], ['zombie', 20, true, false, [-46.5, 66, -65.5], 0]);
        assert.deepEqual(r.target.metadata, { 0: 0, 7: 20, 11: 1, 12: false }, 'the raw metadata is kept');
        assert.deepEqual(r.botHurts.map((h) => [h.before, h.after, h.amount, h.cause]), [[20, 16.667, 3.333, `melee by zombie #${other.id}`], [16.667, 15.667, 1, 'unknown']]);
        assert.ok(r.botHurts[0].t >= 900 && r.botHurts[0].t <= 1100, String(r.botHurts[0].t));
        assert.deepEqual(r.botHurts[0].near.map((x) => x.id).sort(), [a.id, other.id].sort(), 'the entities within 6 blocks');
        // Spawns near the lane: both summons came before the command; something else during the series; one far away is not kept.
        assert.deepEqual(r.spawns.filter((x) => x.t <= 0).map((x) => x.id), [a.id, other.id]);
        // A zombie with its AI reads as such.
        const w2 = bcWorld();
        const t2 = attach(w2);
        w2.give('minecraft:stone_sword');
        w2.summon(-41, 66, -66, { ai: true });
        w2.whisper('bc-hit bbb222 bc ai minecraft:stone_sword');
        const r2 = await t2.reply('bbb222');
        assert.equal(r2.target.noAI, false);
        assert.ok(r2.target.moved > 0, 'it walked');
        // Outside a series nothing is recorded.
        w2.hurtBot(2);
        w2.whisper('bc-hit ccc333 bc 0,0,0 minecraft:stone_sword');
        assert.equal((await t2.reply('ccc333')).botHurts, undefined, 'a refused series has no hurts list');
    });

    test('rotn-data after #540: a census of every entity within 8 blocks (name, id, health) at the start and about once a second', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_axe');
        const a = w.summon(-47, 66, -66);
        const p = w.spawnOther('parasite', -45.5, 66, -65.5);   // 1 block from the bot; zombie A is 2
        w.spawnOther('cow', 0, 66, -66);   // 44 blocks away: not counted
        const pid = w.spawnOther('player', -44, 66, -65.5);   // a player beside the bot: never in the census (after #543)
        w.bot.entities[pid].type = 'player';
        w.whisper('bc-hit aaa111 vanilla -47,66,-66 minecraft:stone_axe');
        const r = await reply('aaa111');
        assert.ok(r.census[0].t < 500 && r.census[0].t < r.hits[0].t, `at the start, after the equip and before hit 1 (${r.census[0].t} ms)`);
        assert.deepEqual(r.census[0].entities.map((e) => [e.id, e.name, e.health]), [[p, 'parasite', null], [a.id, 'zombie', 20]], 'nearest first; no player');
        assert.deepEqual(r.census[0].entities.map((e) => e.pos), [[-45.5, 66, -65.5], [-46.5, 66, -65.5]], 'each with its position');
        const gaps = r.census.slice(1).map((c, k) => c.t - r.census[k].t);
        assert.ok(r.census.length >= 59 && gaps.every((g) => g >= 1000 && g <= 1100), `${r.census.length} censuses, gaps ${Math.min(...gaps)}-${Math.max(...gaps)} ms`);
    });

    test('#540 review: spawns within ~8 blocks of the lane (12.5 of the bot) go into the next reply, with name and position; farther ones do not', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_sword');
        w.summon(-43, 66, -66);
        const near = w.spawnOther('item', -40, 66, -66);
        w.spawnOther('cow', 20, 66, -66);   // 64 blocks away
        w.clock.at(w.clock.now() + 1200, () => w.spawnOther('lightning_bolt', -44, 67, -64));
        w.whisper('bc-hit aaa111 bc -43,66,-66 minecraft:stone_sword');
        const r = await reply('aaa111');
        assert.deepEqual(r.spawns.map((x) => [x.name, x.type, x.via, x.pos, x.t <= 0]), [['zombie', 'mob', 'vanilla', [-42.5, 66, -65.5], true], ['item', 'object', 'vanilla', [-40, 66, -66], true], ['lightning_bolt', 'object', 'vanilla', [-44, 67, -64], false]]);
        assert.ok(r.spawns.find((x) => x.id === near).d < 12.5);
        w.whisper('bc-hit bbb222 bc 0,0,0 minecraft:stone_sword');
        assert.deepEqual((await reply('bbb222')).spawns, [], 'each spawn is reported once');
    });

    test('after #549: the AI target is exactly a zombie: the scent marker, nearer, is not taken', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_sword');
        const z = w.summon(-43, 66, -66, { ai: true });
        w.spawnOther('zombieawareness:entityscent', -44.9, 66.2, -65.5, 538, { entityType: 'other' });
        w.whisper('bc-hit aaa111 bc ai minecraft:stone_sword');
        const r = await reply('aaa111');
        assert.equal(r.target.id, z.id);
        assert.equal(r.end, 'dead');
        assert.ok(typeof r.target.diedAt === 'number' && r.target.diedAt <= r.ms, 'the death time is in the reply');
        const scent = r.census[0].entities.find((e) => e.name === 'zombieawareness:entityscent');
        assert.deepEqual([scent.type, scent.health], ['other', null], 'no health is read for a non-mob');
    });

    test('after #549: a tool that breaks during the pre-wait is replaced before the next attack, never a bare-handed hit', async () => {
        const w = bcWorld({ breakDelayMs: 100 });
        const { reply } = attach(w);
        w.give('pyrotech:crude_axe', 6);
        w.summon(-43, 66, -66);
        w.whisper('bc-hit aaa111 bc -43,66,-66 pyrotech:crude_axe');
        const r = await reply('aaa111');
        assert.equal(r.end, 'dead');
        assert.deepEqual(r.reequips.map((x) => x.afterHit), [4, 8]);
        assert.ok(r.hits.every((h) => h.drop >= 2.3 || h.died), JSON.stringify(r.hits.map((h) => h.drop)));
        assert.ok(r.gaps.bettercombat.every((g) => g >= 1100), r.gaps.bettercombat.join(','));
        assert.equal(r.target.diedAt > 0, true);
        // The bare hand stays empty: an item in the slot is put away first.
        const w2 = bcWorld();
        const t2 = attach(w2);
        w2.summon(-43, 66, -66);
        w2.whisper('bc-hit bbb222 bc -43,66,-66 hand');
        w2.clock.at(w2.clock.now() + 3000, () => w2.putInHand('minecraft:rotten_flesh'));   // picked up into the empty slot
        const r2 = await t2.reply('bbb222');
        assert.ok(r2.hits.every((h) => h.drop < 0.6), 'every hit bare-handed');
        assert.equal(r2.reequips.length, 1, 'the hand was emptied again (another empty slot) after the pickup');
        assert.equal(r2.target.diedAt, null, 'not dead within 40 hits');
    });

    test('#549 review: FML (modded) spawns are recorded too, and a hostile parasite is alive: the census reads its health', async () => {
        const w = bcWorld();
        const { reply } = attach(w);
        w.give('minecraft:stone_sword');
        w.summon(-43, 66, -66);
        w.spawnOther('mod_lavacow:parasite', -44, 66, -65, 3, { entityType: 'hostile', kind: 'Modded' });
        w.spawnOther('zombieawareness:entityscent', -44, 67.7, -65.5, 104, { entityType: 'other', kind: 'Modded' });
        w.whisper('bc-hit aaa111 bc -43,66,-66 minecraft:stone_sword');
        const r = await reply('aaa111');
        assert.deepEqual(r.spawns.map((x) => [x.name, x.type, x.via]), [['zombie', 'mob', 'vanilla'], ['mod_lavacow:parasite', 'hostile', 'fml'], ['zombieawareness:entityscent', 'other', 'fml']]);
        const seen = Object.fromEntries(r.census[0].entities.map((e) => [e.name, [e.type, e.health]]));
        assert.deepEqual(seen['mod_lavacow:parasite'], ['hostile', 3], 'alive: its health is read');
        assert.deepEqual(seen['zombieawareness:entityscent'], ['other', null], 'not alive: no health read');
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
    let parasiteDone = false;
    const cmds = [];
    const cmdsAt = [];
    const server = {
        console(cmd, waitS = 1) {
            cmds.push(cmd);
            cmdsAt.push([t, cmd]);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if ((m = /^tp (\S+) (-?\d+) (-?\d+) (-?\d+)$/.exec(cmd))) add(`Teleported ${m[1]} to ${Number(m[2]) + 0.5}, ${m[3]}.0, ${Number(m[4]) + 0.5}`);
            else if (cmd === `tp ${NAME} ~ ~ ~`) add(`Teleported ${NAME} to -44.5, 120.0, -65.5`);
            else if (cmd === `clear ${NAME}`) { w?.clear(); add(`Cleared the inventory of ${NAME}, removing 1 items`); }
            else if ((m = /^give (\S+) (\S+) (\d+) \d+$/.exec(cmd))) { w?.give(m[2], Number(m[3])); add(`Given [${m[2]}] * ${m[3]} to ${m[1]}`); }
            else if ((m = /^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
                const [x1, y1, z1, x2, y2, z2] = m.slice(1, 7).map(Number);
                let n = 0;
                for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
                    const k = `${x},${y},${z}`;
                    if (opt.obstacle?.[k] || blocks.get(k) === m[7]) continue;   // a trunk shell stays (attempt 1)
                    blocks.set(k, m[7]);
                    n++;
                }
                add(n ? `${n} blocks filled` : 'No blocks filled');
            } else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
                const k = `${m[1]},${m[2]},${m[3]}`;
                const b = opt.obstacle?.[k] ?? blocks.get(k) ?? 'minecraft:air';   // y 120: open sky
                add(b === m[4] ? `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}` : `The block at ${m[1]}, ${m[2]}, ${m[3]} is ${b} (expected: ${m[4]})`);
            } else if ((m = /^summon minecraft:zombie (-?\d+) (-?\d+) (-?\d+)( \{NoAI:1\})?$/.exec(cmd))) {
                if (!opt.noSummon) { w?.summon(Number(m[1]), Number(m[2]), Number(m[3]), { ai: !m[4] }); add('Object successfully summoned'); }
                else add('Unable to summon object');
            } else if ((m = /^kill @e\[type=!player,x=(-?\d+),y=(-?\d+),z=(-?\d+),r=(\d+)\]$/.exec(cmd))) {
                const names = w?.killNear(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])) ?? [];
                for (const n of names) add(`Killed ${n}`);
                if (!names.length) add('That entity cannot be found');
            } else if (cmd === 'kill @e[type=zombie]') {
                const n = (w?.kill() ?? 0) + (opt.worldZombies ?? 0);   // kill @e reaches every loaded zombie, not only the lane's
                for (let k = 0; k < n; k++) add('Killed Zombie');
                if (!n) add('That entity cannot be found');
            }
            else if ((m = /^tell (\S+) (.*)$/.exec(cmd)) && online) {
                // opt.parasite: before the given bc-hit command, a mob that is not minecraft:zombie stands in the lane
                // (a Fish's Undead Rising parasite from a dead zombie): kill @e[type=zombie] does not reach it.
                if (opt.parasite && m[2].includes(opt.parasite.before) && !parasiteDone) { parasiteDone = true; w?.spawnOther('parasite', -46.5, 120, -65.5, 8); }
                // opt.hurtDuring: the bot is hurt 1 s into the given bc-hit command's series.
                if (opt.hurtDuring && m[2].includes(opt.hurtDuring) && w) { const ww = w; ww.clock.at(ww.clock.now() + 1000, () => ww.hurtBot(4)); }
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
            w = bcWorld({ botY: BC_PLAN.landing[1], ...(opt.world ?? {}), bcActive: on });
            attachBcAttack(w.bot, { emit: (type, data) => output.push(`DRIVER ${JSON.stringify({ type, ...data })}`), now: w.clock.now, sleep: w.clock.sleep });
            output.push(`DRIVER ${JSON.stringify({ type: 'bc_status', wrapper: true, attackVanilla: true, active: on, status: w.bot.forge.bcAttack.status() })}`);
            if (opt.trip) output.push('[forge-bridge] bettercombat attack: 5 hits without a hurt, back to vanilla for this connection');
            add(`UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`, 'net.minecraft.server.network.NetHandlerLoginServer');
            online = true;
            add(`${NAME} joined the game`);
            add('Mean tick: 31ms increasing chunk view distance to: 6', 'com.dynamic_view.DynView');
            for (const l of opt.log ?? []) log.push(l);
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => output,
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    // Each scenario sleep lets the core (on its own virtual clock) run many steps.
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 400; i++) await tick(); } };
    return { server, bot, clock, blocks, cmds, cmdsAt, sent: log, startEnv: () => startEnv, world: () => w };
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
            ['vanilla_stone_sword', 40, 'maxHits'], ['bc_stone_sword', 7, 'dead'], ['vanilla_stone_axe', 24, 'maxMs'], ['bc_stone_axe', 9, 'dead'],
            ['vanilla_crude_axe', 40, 'maxHits'], ['bc_crude_axe', 9, 'dead'], ['vanilla_hand', 40, 'maxHits'], ['bc_hand', 40, 'maxHits'], ['bc_ai_zombie', 8, 'dead']]);
        assert.match(c.bc_stone_sword.detail, /^7 hit\(s\), end dead, health 20 -> 0, target zombie #\d+ NoAI, 7 to kill \(range 5-8 at measured health 20\), crits #1, hit 1 crit: yes: as planned$/);
        assert.match(c.bc_hand.detail, /^40 hit\(s\), end maxHits, health 20 -> 4\.97\d, target zombie #\d+ NoAI, 54 to kill \(projected\) \(range 36-54 at measured health 20\), crits #1, hit 1 crit: yes: as planned$/);
        assert.deepEqual(r.notes.series.filter((x) => x.expected).map((x) => [x.key, x.expected.health, x.expected.healthFrom, x.verdict.firstHitCrit]), [
            ['bc_stone_sword', 20, 'measured', true], ['bc_stone_axe', 20, 'measured', true], ['bc_crude_axe', 20, 'measured', true], ['bc_hand', 20, 'measured', true],
            ['bc_ai_zombie', 20, 'measured', false]]);
        assert.deepEqual(r.notes.lane.wrong, []);
        // #540 review: each kill's count next to DynView's view distance.
        assert.deepEqual(r.notes.kills.map((k) => [k.step, k.killed, k.viewDistance]), [
            ['setup', 0, 6], ['stone_sword: before', 0, 6], ['stone_sword: after', 1, 6], ['stone_axe: before', 0, 6], ['stone_axe: after', 1, 6],
            ['crude_axe: before', 0, 6], ['crude_axe: after', 1, 6], ['hand: before', 0, 6], ['hand: after', 2, 6], ['ai: before', 0, 6], ['ai: after', 0, 6]]);
        // Each reply carries the spawns near the lane since the previous one: the vanilla series' reply has both summons.
        const sw = r.notes.series.find((x) => x.key === 'vanilla_stone_sword').reply;
        assert.deepEqual(sw.spawns.map((x) => [x.via, x.name, x.pos]), [['vanilla', 'zombie', [-46.5, 120, -65.5]], ['vanilla', 'zombie', [-42.5, 120, -65.5]]]);
        assert.ok(sw.spawns.every((x) => x.t <= 0), 'before the command');
        assert.deepEqual(r.notes.series.find((x) => x.key === 'bc_stone_sword').reply.spawns, [], 'nothing new before the second series');
        assert.deepEqual(r.notes.landing.botPosition, [-44.5, 120, -65.5]);
        assert.match(c.bc_ai_zombie.detail, /, crits none: as planned$/, 'a zombie with its AI targets the bot: no sneak crit');
        assert.equal(s.blocks.get('-45,119,-66'), 'minecraft:stone', 'the floor');
        assert.equal(s.blocks.get('-45,122,-66'), 'minecraft:stone', 'the roof against daylight');
        assert.equal(s.blocks.get('-45,120,-65'), 'minecraft:stone', 'a side wall');
        assert.equal(s.blocks.get('-45,120,-66'), 'minecraft:air');
        assert.ok(!s.cmds.some((x) => x.startsWith('setblock')), 'no setblock');
        assert.equal(s.cmds.filter((x) => x.startsWith('testforblock')).length, 68, 'every lane cell checked');
        const firstSummon = s.cmds.findIndex((x) => x.startsWith('summon'));
        assert.ok(s.cmds.slice(0, firstSummon).filter((x) => x.startsWith('testforblock')).length === 68, 'all checked before the first summon');
        // After each step (a weapon's Better Combat series, the AI zombie) a kill comes before anything is summoned again.
        const steps = s.cmds.map((x, i) => [x, i]).filter(([x]) => / bc-hit [0-9a-f]+ bc /.test(x));
        assert.equal(steps.length, 5);
        for (const [, i] of steps) {
            const next = s.cmds.slice(i + 1).find((x) => /^(kill|summon) /.test(x));
            assert.equal(next, 'kill @e[type=zombie]', `after ${s.cmds[i]}`);
            assert.equal(s.cmds[i + 1], 'kill @e[type=zombie]', 'at once');
        }
    });

    test('attempt 1 (#535): a lane cell that the fill cannot change fails setup cleanly: no tp, no summon, the cell named', async () => {
        const s = sim({ obstacle: { '-43,120,-66': 'tile.trunkshell.name' } });
        const r = await run(s);
        const c = byName(r);
        assert.equal(c.login_online.pass, true);
        assert.equal(c.setup.pass, false);
        assert.match(c.setup.detail, /lane 67\/68 cells as planned \(wrong: -43 120 -66: The block at -43, 120, -66 is tile\.trunkshell\.name \(expected: minecraft:air\)\)$/);
        assert.deepEqual(r.notes.lane.wrong.map((x) => [x.cell, x.want]), [[[-43, 120, -66], 'minecraft:air']]);
        assert.ok(!s.cmds.some((x) => /^(summon|tp |tell )/.test(x)), 'nothing summoned, the bot not moved, no bc-hit');
        assert.equal(r.notes.landing, undefined);
        assert.equal(c.bc_stone_sword.detail, 'not reached');
    });

    test('after #540: a zombie that does not start at the catalogue\'s 20 is not measured: INCONCLUSIVE, no pass rule applied', async () => {
        // Attempt 2: zombie A of the stone-axe step (the 3rd zombie summoned) started at 8 health.
        const r = await run(sim({ world: { healthOf: (n) => (n === 2 ? 8 : 20) } }));
        const c = byName(r);
        assert.equal(c.vanilla_stone_axe.pass, false);
        assert.match(c.vanilla_stone_axe.detail, /^INCONCLUSIVE: \d+ hit\(s\), end \w+, health 8 -> [\d.]+, target zombie #\d+ NoAI: not measured: the zombie started at 8 health, not the catalogue's 20$/);
        assert.deepEqual(r.notes.inconclusive, [{ key: 'vanilla_stone_axe', why: 'not measured: the zombie started at 8 health, not the catalogue\'s 20' }]);
        for (const k of Object.keys(probe.checks).filter((x) => x !== 'vanilla_stone_axe')) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        // Every zombie at 24: every series inconclusive, none judged by its range.
        const all = await run(sim({ world: { zombieHealth: 24 } }));
        assert.equal(all.notes.inconclusive.length, 9);
        assert.match(byName(all).bc_stone_sword.detail, /^INCONCLUSIVE: .*: not measured: the zombie started at 24 health, not the catalogue's 20$/);
    });

    test('rotn-data after #540: the lane clear before each step kills what kill @e[type=zombie] leaves (a parasite), and says what it killed', async () => {
        const s = sim({ parasite: { before: ' bc -43,120,-66 minecraft:stone_sword' } });
        const r = await run(s);
        assert.deepEqual(r.notes.laneClears.map((c) => [c.step, c.killed]), [
            ['stone_sword', []], ['stone_axe', ['parasite']], ['crude_axe', []], ['hand', []], ['ai', []]]);
        // It comes before the step's summons, so it never kills the step's own zombies.
        for (const step of ['stone_sword', 'stone_axe']) {
            const i = s.cmds.indexOf('kill @e[type=!player,x=-45,y=120,z=-66,r=8]', step === 'stone_sword' ? 0 : s.cmds.indexOf('kill @e[type=!player,x=-45,y=120,z=-66,r=8]') + 1);
            assert.ok(i >= 0 && s.cmds[i + 1] === `clear ${NAME}` && s.cmds.slice(i + 1).find((x) => x.startsWith('summon')), step);
        }
        assert.equal(byName(r).bc_stone_axe.pass, true);
        // The parasite stood in A's cell during the stone sword's Better Combat series: that series is INCONCLUSIVE (after #543).
        assert.match(byName(r).bc_stone_sword.detail, /^INCONCLUSIVE: .*: not clean: the census saw parasite #\d+ at -46\.5 120 -65\.5 \(t \d+ ms\) in the lane$/);
        assert.equal(byName(r).vanilla_stone_sword.pass, true, 'it came after the vanilla series');
        // #543 review: 1.5 s between each zombie kill and the lane clear after it (a parasite comes after the death animation).
        const at = s.cmdsAt;
        for (let i = 0; i < at.length; i++) {
            if (!at[i][1].startsWith('kill @e[type=!player')) continue;
            const kill = at.slice(0, i).reverse().find(([, c]) => c === 'kill @e[type=zombie]');
            assert.ok(kill && at[i][0] - kill[0] >= 1500, `${at[i][0] - (kill?.[0] ?? 0)} ms`);
        }
    });

    test('after #543: a hurt to the bot during a NoAI series makes it INCONCLUSIVE', async () => {
        const r = await run(sim({ hurtDuring: ' bc -43,120,-66 minecraft:stone_axe' }));
        const c = byName(r);
        assert.match(c.bc_stone_axe.detail, /^INCONCLUSIVE: .*bot hurt 1x \(4\): not clean: the bot was hurt 1x \(4 at t \d+ ms, unknown\)$/);
        assert.equal(c.vanilla_stone_axe.pass, true);
        assert.deepEqual(r.notes.inconclusive.map((x) => x.key), ['bc_stone_axe']);
    });

    test('#540 review: the kill counts include the loaded world\'s other zombies', async () => {
        const r = await run(sim({ worldZombies: 3 }));
        assert.deepEqual(r.notes.kills.slice(0, 3).map((k) => k.killed), [3, 3, 4]);
    });

    test('after #540: the crude axe is given one at a time, six times; its two series run', async () => {
        const s = sim();
        const r = await run(s);
        assert.equal(s.cmds.filter((x) => x === `give ${NAME} pyrotech:crude_axe 1 0`).length, 6);
        assert.ok(!s.cmds.some((x) => /^give \S+ \S+ (?!1 )\d+ /.test(x)), 'every give is of one item');
        assert.equal(byName(r).bc_crude_axe.pass, true, byName(r).bc_crude_axe.detail);
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
