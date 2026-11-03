// Offline tests for probe P1 (test/scenarios/probe/probe-craft-place.mjs, test/runner/lib/probe.mjs):
// the protocol helpers, P1's console allowlist, and the scenario on a small simulated server whose fake
// driver answers the probe protocol the way net-forge's g1-driver is to answer it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import {
    P1_CONSOLE_ALLOW, P1_NOT_GATE, P1_PLAN, below, guardP1Console, probeCraft, probeEat, probePlace, probeReply,
} from '../runner/lib/probe.mjs';
import probe from '../scenarios/probe/probe-craft-place.mjs';

const NAME = 'FRCFLD';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const L = (msg, logger = DS) => `[12:00:00] [Server thread/INFO] [${logger}]: ${msg}`;
const tick = () => new Promise((r) => setImmediate(r));
const allowed = (cmd) => P1_CONSOLE_ALLOW.some((re) => re.test(cmd));

describe('the P1 driver protocol and console allowlist', () => {
    test('commands are built in the protocol\'s exact form; bad tokens and faces are refused', () => {
        assert.equal(probeCraft(NAME, 'abc123', 'pyrotech:crude_axe'), 'tell FRCFLD probe-craft abc123 pyrotech:crude_axe');
        assert.equal(probeCraft(NAME, 'abc123', 'minecraft:stone_pickaxe', [-43, 66, -66]), 'tell FRCFLD probe-craft abc123 minecraft:stone_pickaxe -43,66,-66');
        assert.equal(probePlace(NAME, 'abc123', 'minecraft:cobblestone', [-47, 65, -66], 'up'), 'tell FRCFLD probe-place abc123 minecraft:cobblestone -47,65,-66 up');
        assert.equal(probeEat(NAME, 'abc123', 'minecraft:bread'), 'tell FRCFLD probe-eat abc123 minecraft:bread');
        assert.throws(() => probeCraft(NAME, 'ABC', 'x:y'), /bad probe token/);
        assert.throws(() => probePlace(NAME, 'abc123', 'x:y', [0, 0, 0], 'sideways'), /bad face/);
    });

    test('the reply is the DRIVER probe event with this command and token; other lines are ignored', () => {
        const out = ['noise', 'DRIVER {not json', 'DRIVER {"type":"probe","cmd":"place","token":"abc123","ok":true}',
            'DRIVER {"type":"probe","cmd":"craft","token":"other1","ok":true}', 'DRIVER {"type":"probe","cmd":"craft","token":"abc123","ok":false,"error":"x"}'];
        assert.deepEqual(probeReply(out, 'craft', 'abc123'), { type: 'probe', cmd: 'craft', token: 'abc123', ok: false, error: 'x' });
        assert.equal(probeReply(out, 'eat', 'abc123'), null);
    });

    test('every command the scenario sends is on the allowlist; op commands and real clears of items are not', () => {
        const p = P1_PLAN;
        const sent = [
            'gamerule doDaylightCycle false', 'time set day', `tp ${NAME} ${p.landing.join(' ')}`, `tp ${NAME} ~ ~ ~`, `clear ${NAME}`,
            ...p.gives.map(([i, n, m]) => `give ${NAME} ${i} ${n} ${m}`), `effect ${NAME} minecraft:hunger 10 10`,
            `setblock ${p.table.join(' ')} minecraft:crafting_table`, `testforblock ${p.table.join(' ')} minecraft:crafting_table`,
            ...p.place.targets.flatMap((c) => [`setblock ${c.join(' ')} minecraft:air`, `setblock ${below(c).join(' ')} minecraft:stone`, `testforblock ${c.join(' ')} minecraft:cobblestone`]),
            `clear ${NAME} pyrotech:rock -1 0`, probeCraft(NAME, 'abc123', 'minecraft:stone_pickaxe', p.table),
            probePlace(NAME, 'abc123', 'minecraft:cobblestone', [-47, 65, -66], 'up'), probeEat(NAME, 'abc123', 'minecraft:bread'),
            'say scenario-probe-craft-place-r1-begin',
        ];
        for (const c of sent) assert.ok(allowed(c), c);
        for (const c of ['op FRCFLD', 'gamemode 1 FRCFLD', 'summon minecraft:zombie', 'kill FRCFLD', `clear ${NAME} pyrotech:rock -1 5`,
            'effect FRCFLD minecraft:regeneration 10 10', 'setblock 0 0 0 minecraft:tnt', 'time set night', 'gamerule keepInventory true',
            'give FRCFLD minecraft:diamond 640 0', 'tell FRCFLD hello', 'tell FRCFLD probe-craft abc123 x:y; op FRCFLD x y']) {
            assert.ok(!allowed(c), c);
        }
        const g = guardP1Console({ console: () => ['ok'] });
        assert.throws(() => g.console('op FRCFLD', 1), /console command refused/);
        assert.deepEqual(g.console('time set day', 1), ['ok']);
    });
});

/**
 * A simulated test server and a fake driver for P1. The fake driver answers the probe protocol: it crafts
 * with the plan's recipes (moving items in the server's inventory), places blocks and eats.
 *   opt.reject: a recipe whose craft reports a rejected transaction; opt.failCraft: a recipe the driver
 *   fails; opt.noFastbench: the table craft uses the inventory window; opt.silent: a command it never
 *   answers ('craft'|'place'|'eat'); opt.misplace: a placement index the server does not get
 */
function sim(opt = {}) {
    const log = [];
    let t = 0;
    let online = false;
    const inv = new Map();
    const blocks = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    const add = (msg, logger = DS) => log.push(L(msg, logger));
    const output = [];
    const reply = (cmd, token, data) => output.push(`DRIVER ${JSON.stringify({ type: 'probe', cmd, token, ...data })}`);
    const take = (item, n) => inv.set(item, (inv.get(item) ?? 0) - n);
    const put = (item, n) => inv.set(item, (inv.get(item) ?? 0) + n);
    const RECIPES = {
        'pyrotech:crude_axe': () => { take('pyrotech:rock', 1); take('minecraft:stick', 1); put('pyrotech:crude_axe', 1); },
        'contenttweaker:crafting_tools': () => { take('pyrotech:crude_axe', 1); put('contenttweaker:crafting_tools', 1); },
        'minecraft:crafting_table': () => { take('minecraft:planks', 1); put('minecraft:crafting_table', 1); },
        'minecraft:stone_pickaxe': () => { take('pyrotech:rock', 4); take('minecraft:stick', 2); put('minecraft:stone_pickaxe', 1); },
    };
    let food = 14;
    let placeN = 0;
    const driver = (msg) => {
        let m;
        if ((m = /^probe-craft (\S+) (\S+)( \S+)?$/.exec(msg))) {
            if (opt.silent === 'craft') return;
            const [, token, recipe, table] = m;
            if (opt.failCraft === recipe) return reply('craft', token, { ok: false, error: 'no matching recipe', recipe });
            RECIPES[recipe]();
            const fast = Boolean(table) && !opt.noFastbench;
            reply('craft', token, { ok: true, error: null, recipe, window: fast ? 'fastbench' : 'inventory',
                modWindow: fast ? { modId: 'fastbench', modGuiId: 0 } : null, transactions: { accepted: 4, rejected: opt.reject === recipe ? 1 : 0 } });
        } else if ((m = /^probe-place (\S+) (\S+) (-?\d+),(-?\d+),(-?\d+) up$/.exec(msg))) {
            if (opt.silent === 'place') return;
            const [, token, item, x, y, z] = m;
            const at = [Number(x), Number(y) + 1, Number(z)];
            if (placeN++ !== opt.misplace) blocks.set(key(...at), item);
            take(item, 1);
            reply('place', token, { ok: true, error: null, placed: at, ms: 40 + placeN, name: item });
        } else if ((m = /^probe-eat (\S+) (\S+)$/.exec(msg))) {
            if (opt.silent === 'eat') return;
            take(m[2], 1);
            reply('eat', m[1], { ok: true, error: null, foodBefore: food, foodAfter: (food += 5), ms: 1700 });
        }
    };
    const server = {
        console(cmd, waitS = 1) {
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if ((m = /^tp (\S+) (-?\d+) (-?\d+) (-?\d+)$/.exec(cmd))) add(`Teleported ${m[1]} to ${Number(m[2]) + 0.5}, ${m[3]}.0, ${Number(m[4]) + 0.5}`);
            else if (cmd === `tp ${NAME} ~ ~ ~`) add(`Teleported ${NAME} to -44.5, 66.0, -65.5`);
            else if (cmd === `clear ${NAME}`) { inv.clear(); add(`Cleared the inventory of ${NAME}, removing 0 items`); }
            else if ((m = /^give (\S+) (\S+) (\d+) \d+$/.exec(cmd))) { put(m[2], Number(m[3])); add(`Given [${m[2]}] * ${m[3]} to ${m[1]}`); }
            else if ((m = /^clear (\S+) (\S+) -?\d+ 0$/.exec(cmd))) {
                const n = inv.get(m[2]) ?? 0;
                add(n ? `${m[1]} has ${n} items that match the criteria` : `Could not clear the inventory of ${m[1]}, no items to remove`);
            } else if ((m = /^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) { blocks.set(key(m[1], m[2], m[3]), m[4]); add('Block placed'); }
            else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
                const b = blocks.get(key(m[1], m[2], m[3])) ?? 'minecraft:air';
                add(b === m[4] ? `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}` : `The block at ${m[1]}, ${m[2]}, ${m[3]} is ${b} (expected: ${m[4]})`);
            } else if ((m = /^tell (\S+) (.*)$/.exec(cmd)) && online) driver(m[2]);
            t += waitS * 1000;
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
            add(`${NAME} joined the game`);
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => output,
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 5; i++) await tick(); } };
    return { server, bot, clock, inv, blocks, sent: log };
}

const fast = { settleMs: 1000, tpSettleMs: 1000, consoleWaitS: 0, replyTimeoutMs: 3000, pollMs: 1000 };
const run = (s, params = {}) => runScenario(probe, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));
const neverGate = (r) => {
    assert.equal(r.gateValid, false);
    assert.equal(r.pass, false);
    assert.ok(r.weakenedParams.includes(P1_NOT_GATE), JSON.stringify(r.weakenedParams));
    assert.notEqual(r.verdict, 'PASS');
};

describe('probe-craft-place on a simulated server', () => {
    test('everything works: every check passes, and it is still never a gate pass', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(probe.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(r.verdict, 'SMOKE-PASS (not a gate pass)');
        neverGate(r);
        assert.deepEqual(r.notes.placeLatencyMs, [41, 42, 43, 44, 45]);
        assert.equal(r.notes.crafts.length, 4);
        assert.equal(s.inv.size, 0, 'the inventory is cleared at the end');
        assert.equal(s.blocks.get('-43,66,-66'), 'minecraft:crafting_table');
        assert.equal(s.blocks.get('-47,65,-66'), 'minecraft:stone', 'the floor under each placement is stone');
    });

    test('a rejected transaction (the REID question) fails transactions_accepted, not the craft counts', async () => {
        const r = await run(sim({ reject: 'pyrotech:crude_axe' }));
        const c = byName(r);
        assert.equal(c.transactions_accepted.pass, false);
        assert.match(c.transactions_accepted.detail, /rejected per craft: 1, 0, 0, 0/);
        assert.equal(c.craft_crude_axe.pass, true);
        neverGate(r);
    });

    test('a craft the driver fails also fails its server counts, and the later crafts are still tried', async () => {
        const r = await run(sim({ failCraft: 'contenttweaker:crafting_tools' }));
        const c = byName(r);
        assert.equal(c.craft_crafting_tools.pass, false);
        assert.match(c.craft_crafting_tools.detail, /driver ok=false \(no matching recipe\); contenttweaker:crafting_tools 0 \(want 1\), pyrotech:crude_axe 1 \(want 0\)/);
        assert.equal(c.craft_crafting_table.pass, true);
    });

    test('a table craft outside the fastbench window fails fastbench_window', async () => {
        const c = byName(await run(sim({ noFastbench: true })));
        assert.equal(c.fastbench_window.pass, false);
        assert.match(c.fastbench_window.detail, /table craft window: inventory, mod window: null/);
        assert.equal(c.craft_stone_pickaxe.pass, true);
    });

    test('a placement the server does not see fails place_5, with the count and the latencies', async () => {
        const c = byName(await run(sim({ misplace: 2 })));
        assert.equal(c.place_5.pass, false);
        assert.match(c.place_5.detail, /^4\/5 placed and confirmed; latencies ms: 41, 42, 43, 44, 45$/);
    });

    test('a driver that never answers (no probe commands yet) fails those checks after the timeout, never passes', async () => {
        for (const silent of ['craft', 'place', 'eat']) {
            const r = await run(sim({ silent }));
            const c = byName(r);
            const k = { craft: 'craft_crude_axe', place: 'place_5', eat: 'eat' }[silent];
            assert.equal(c[k].pass, false, silent);
            assert.match(c[k].detail, /no reply|0\/5/, silent);
            neverGate(r);
        }
    });

    test('the scenario sends nothing outside P1\'s allowlist', async () => {
        const s = sim();
        const seen = [];
        const server = { ...s.server, console: (cmd, w) => { seen.push(cmd); return s.server.console(cmd, w); } };
        await run({ ...s, server });
        assert.ok(seen.length > 30);
        for (const c of seen) assert.ok(allowed(c), c);
    });
});
