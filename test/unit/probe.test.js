// Offline tests for probe P1 (test/scenarios/probe/probe-craft-place.mjs, test/runner/lib/probe.mjs):
// the protocol helpers, P1's console allowlist, and the scenario on a small simulated server whose fake
// driver answers the probe protocol in net-forge's reply contract v1 (#162, #167: packages/forge-bridge/tools/probe-commands.mjs;
// every fake reply passes checkProbeReply).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import {
    P1_CONSOLE_ALLOW, P1_NOT_GATE, P1_PLAN, PROBE_DRIVER_ENV, below, foodScore, guardP1Console, hungerFood, probeCraft, probeEat, probePlace, probeReply,
} from '../runner/lib/probe.mjs';
import { checkProbeReply } from '../../packages/forge-bridge/tools/probe-commands.mjs';
import probe, { captureOf } from '../scenarios/probe/probe-craft-place.mjs';

const NAME = 'FRCFLD';
const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const L = (msg, logger = DS) => `[12:00:00] [Server thread/INFO] [${logger}]: ${msg}`;
const tick = () => new Promise((r) => setImmediate(r));
const allowed = (cmd) => P1_CONSOLE_ALLOW.some((re) => re.test(cmd));

describe('the P1 driver protocol and console allowlist', () => {
    test('commands are built in the protocol\'s exact form; bad tokens and faces are refused', () => {
        assert.equal(probeCraft(NAME, 'abc123', 'crafttweaker:pyro_crude_axe'), 'tell FRCFLD probe-craft abc123 crafttweaker:pyro_crude_axe');
        assert.equal(probeCraft(NAME, 'abc123', 'crafttweaker:stone_pickaxe', [-43, 66, -66]), 'tell FRCFLD probe-craft abc123 crafttweaker:stone_pickaxe -43,66,-66');
        assert.deepEqual(PROBE_DRIVER_ENV, { ROTN_DRIVER_PROBE: '1' }, 'net-forge\'s opt-in (#162)');
        assert.deepEqual(P1_PLAN.crafts.map((c) => c.recipeId), ['crafttweaker:pyro_crude_axe', 'crafttweaker:crafting_tools', 'crafttweaker:crafting_table', 'crafttweaker:stone_pickaxe'], 'rotn-data\'s recipe ids, as #162\'s e2e test uses them');
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
            ...p.gives.map(([i, n, m]) => `give ${NAME} ${i} ${n} ${m}`), `effect ${NAME} minecraft:hunger ${p.hunger.join(' ')}`,
            `scoreboard objectives add ${p.foodObjective} food`, `scoreboard players list ${NAME}`, `scoreboard objectives remove ${p.foodObjective}`,
            `setblock ${p.table.join(' ')} minecraft:crafting_table`, `testforblock ${p.table.join(' ')} minecraft:crafting_table`,
            ...p.place.targets.flatMap((c) => [`setblock ${c.join(' ')} minecraft:air`, `setblock ${below(c).join(' ')} minecraft:stone`, `testforblock ${c.join(' ')} minecraft:cobblestone`]),
            `clear ${NAME} pyrotech:rock -1 0`, probeCraft(NAME, 'abc123', 'crafttweaker:stone_pickaxe', p.table),
            probePlace(NAME, 'abc123', 'minecraft:cobblestone', [-47, 65, -66], 'up'), probeEat(NAME, 'abc123', 'minecraft:bread'),
            'say scenario-probe-craft-place-r1-begin',
        ];
        for (const c of sent) assert.ok(allowed(c), c);
        for (const c of ['op FRCFLD', 'gamemode 1 FRCFLD', 'summon minecraft:zombie', 'kill FRCFLD', `clear ${NAME} pyrotech:rock -1 5`,
            'effect FRCFLD minecraft:regeneration 10 10', 'setblock 0 0 0 minecraft:tnt', 'time set night', 'gamerule keepInventory true',
            'give FRCFLD minecraft:diamond 640 0', 'tell FRCFLD hello', 'scoreboard objectives add other food',
            'scoreboard objectives add p1food deathCount', 'scoreboard players set FRCFLD p1food 3', 'scoreboard players list @a', 'tell FRCFLD probe-craft abc123 x:y; op FRCFLD x y']) {
            assert.ok(!allowed(c), c);
        }
        const g = guardP1Console({ console: () => ['ok'] });
        assert.throws(() => g.console('op FRCFLD', 1), /console command refused/);
        assert.deepEqual(g.console('time set day', 1), ['ok']);
    });
});

/**
 * A simulated test server and a fake driver for P1, answering in #162's format: it crafts with the plan's
 * recipe ids (moving items in the server's inventory), places blocks and eats, and only with
 * ROTN_DRIVER_PROBE=1 in its start environment (as the real driver).
 *   opt.failCraft: a recipe id the driver fails; opt.silent: a command it never answers
 *   ('craft'|'place'|'eat'); opt.misplace: a placement index the server does not get; opt.exitAt: the
 *   command ('craft'|'place'|'eat') at which the driver exits instead of answering; opt.kickAt: the command
 *   at which the server kicks the bot ("FRCFLD lost connection: ..." in the log; the driver still runs);
 *   opt.noHunger: the hunger effect changes nothing (food stays 20); opt.breakContract: a command whose
 *   reply breaks contract v1 (no "v"); opt.late: a command prefix answered only after the console's wait.
 *   Food starts at 20; the hunger effect sets it to hungerFood(...), and
 *   the p1food score, as 1.12 keeps it, exists only once the food changed after the objective was added.
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
    // Contract v1 (#167): every reply of this fake passes net-forge's checkProbeReply, so the stub suite cannot
    // drift from the real driver; only opt.breakContract (a command) sends one without "v" on purpose.
    const reply = (cmd, token, data) => {
        const r = { type: 'probe', v: opt.breakContract === cmd ? undefined : 1, cmd, token, ...data };
        if (opt.breakContract !== cmd) assert.deepEqual(checkProbeReply(r), [], JSON.stringify(r));
        output.push(`DRIVER ${JSON.stringify(r)}`);
    };
    const take = (item, n) => inv.set(item, (inv.get(item) ?? 0) - n);
    const put = (item, n) => inv.set(item, (inv.get(item) ?? 0) + n);
    const RECIPES = {
        'crafttweaker:pyro_crude_axe': ['pyrotech:crude_axe', () => { take('pyrotech:rock', 1); take('minecraft:stick', 1); }],
        'crafttweaker:crafting_tools': ['contenttweaker:crafting_tools', () => { take('pyrotech:crude_axe', 1); }],
        'crafttweaker:crafting_table': ['minecraft:crafting_table', () => { take('minecraft:planks', 1); }],
        'crafttweaker:stone_pickaxe': ['minecraft:stone_pickaxe', () => { take('pyrotech:rock', 4); take('minecraft:stick', 2); }],
    };
    let startEnv = null;
    let alive = false;
    let food = 20;
    let objective = false;
    let foodAtAdd = null;
    let placeN = 0;
    const driver = (msg) => {
        if (startEnv?.ROTN_DRIVER_PROBE !== '1') return;   // the real driver ignores probe commands without it
        let m;
        const cmd = /^probe-(craft|place|eat) /.exec(msg)?.[1];
        if (cmd && opt.exitAt === cmd) { alive = false; return; }
        if (cmd && opt.kickAt === cmd) { online = false; add(`${NAME} lost connection: Kicked by an operator`); return; }
        if ((m = /^probe-craft ([0-9a-f]{6,32}) (\S+)( (-?\d+),(-?\d+),(-?\d+))?$/.exec(msg))) {
            if (opt.silent === 'craft') return;
            const [, token, recipeId, table] = m;
            const [result, use] = RECIPES[recipeId];
            const before = inv.get(result) ?? 0;
            if (opt.failCraft === recipeId) return reply('craft', token, { ok: false, recipe: recipeId, table: null, error: `missing ingredients for ${recipeId}` });
            use();
            put(result, 1);
            reply('craft', token, { ok: true, recipe: recipeId, table: table ? [m[4], m[5], m[6]].map(Number) : null, variant: 0, variants: 1,
                result, resultMeta: 0, before, after: before + 1, ms: 300, tableBlock: table ? 'minecraft:crafting_table' : null });
        } else if ((m = /^probe-place ([0-9a-f]{6,32}) (\S+) (-?\d+),(-?\d+),(-?\d+) up$/.exec(msg))) {
            if (opt.silent === 'place') return;
            const [, token, item, x, y, z] = m;
            const at = [Number(x), Number(y) + 1, Number(z)];
            if (placeN++ !== opt.misplace) blocks.set(key(...at), item);
            take(item, 1);
            reply('place', token, { ok: true, item, ref: [x, y, z].map(Number), face: 'up', target: at, before: 'minecraft:air', after: 'minecraft:cobblestone', expected: 'minecraft:cobblestone', otherUpdates: 0, totalMs: 60 + placeN, updateMs: 40 + placeN, timeoutMs: 10000 });
        } else if ((m = /^probe-eat ([0-9a-f]{6,32}) (\S+)$/.exec(msg))) {
            if (opt.silent === 'eat') return;
            const countBefore = inv.get(m[2]) ?? 0;
            take(m[2], 1);
            reply('eat', m[1], { ok: true, item: m[2], foodBefore: food, foodAfter: (food += 5), countBefore, countAfter: countBefore - 1, ms: 1700 });
        }
    };
    // opt.late: a command prefix whose reply is written AFTER the console's wait (P1 attempt 1): the
    // call returns nothing, and the reply reaches the log before the next console or log call.
    let pending = [];
    const flush = () => { log.push(...pending); pending = []; };
    const server = {
        console(cmd, waitS = 1) {
            flush();
            const out = this.console0(cmd, waitS);
            if (opt.late && cmd.startsWith(opt.late)) {
                pending = log.splice(log.length - out.length, out.length);
                if (opt.dropLate) pending = [];
                return [];
            }
            return out;
        },
        console0(cmd, waitS = 1) {
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
            } else if ((m = /^effect \S+ minecraft:hunger (\d+) (\d+)$/.exec(cmd))) {
                if (!opt.noHunger) food = hungerFood(Number(m[1]), Number(m[2]), { food });
                add(`Given Hunger (ID 17) * ${m[2]} to ${NAME} for ${m[1]} seconds`);
            } else if (cmd === `scoreboard objectives add ${P1_PLAN.foodObjective} food`) {
                objective = true;
                foodAtAdd = food;
                add(`Added new objective '${P1_PLAN.foodObjective}' successfully`);
            } else if (cmd === `scoreboard players list ${NAME}`) {
                if (objective && food !== foodAtAdd) {
                    add(`Showing 1 tracked objective(s) for ${NAME}:`);
                    add(`- ${P1_PLAN.foodObjective}: ${food} (${P1_PLAN.foodObjective})`);
                } else add(`Player ${NAME} has no scores recorded`);
            } else if (cmd === `scoreboard objectives remove ${P1_PLAN.foodObjective}`) {
                objective = false;
                add(`Removed objective '${P1_PLAN.foodObjective}' successfully`);
            } else if ((m = /^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) { blocks.set(key(m[1], m[2], m[3]), m[4]); add('Block placed'); }
            else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(cmd))) {
                const b = blocks.get(key(m[1], m[2], m[3])) ?? 'minecraft:air';
                add(b === m[4] ? `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}` : `The block at ${m[1]}, ${m[2]}, ${m[3]} is ${b} (expected: ${m[4]})`);
            } else if ((m = /^tell (\S+) (.*)$/.exec(cmd)) && online) driver(m[2]);
            t += waitS * 1000;
            return log.slice(before);
        },
        log: (n) => { flush(); return log.slice(-n); },
    };
    const bot = {
        start(env = {}) {
            startEnv = env;
            alive = true;
            output.push(`DRIVER ${JSON.stringify({ type: 'forge', capture: 'captures/raw/FRCFLD-20261103.jsonl' })}`);
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
    return { server, bot, clock, inv, blocks, sent: log, startEnv: () => startEnv };
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

test('captureOf reads the capture path from the driver\'s forge event', () => {
    assert.equal(captureOf(['x', 'DRIVER {"type":"forge","capture":"captures/raw/a.jsonl"}']), 'captures/raw/a.jsonl');
    assert.equal(captureOf(['DRIVER {"type":"forge","capture":null}']), null);
});

describe('the hunger step (lead, #165: food must be below 20 before the eat, but well above 6)', () => {
    test('hungerFood follows 1.12: 0.005 * (amplifier + 1) exhaustion per tick, 4 exhaustion per point, saturation first', () => {
        assert.equal(hungerFood(10, 10), 20, 'the old 10 s at amplifier 10: 11 exhaustion, 2 points, all from saturation 5');
        assert.equal(hungerFood(22, 19), 14, 'P1: 44 exhaustion, 11 points, 5 from saturation');
        assert.deepEqual(P1_PLAN.hunger, [22, 19]);
        // Whatever the saturation of a fresh player turns out to be (0 to 5), the food lands below 20 and well above 6.
        for (let sat = 0; sat <= 5; sat++) {
            const f = hungerFood(...P1_PLAN.hunger, { saturation: sat });
            assert.ok(f < 20 && f >= 9, `saturation ${sat}: food ${f}`);
        }
        // With one point fewer (float rounding at the 4.0 threshold), still below 20.
        assert.ok(hungerFood(20, 19) < 20);
    });

    test('foodScore reads p1food from `scoreboard players list`; no score is null, never 0', () => {
        const L2 = (m) => L(m);
        assert.equal(foodScore([L2(`Showing 2 tracked objective(s) for ${NAME}:`), L2('- deaths: 0 (deaths)'), L2('- p1food: 14 (p1food)')], NAME), 14);
        assert.equal(foodScore([L2(`Player ${NAME} has no scores recorded`)], NAME), null);
        assert.equal(foodScore([L2(`Showing 1 tracked objective(s) for ${NAME}:`), L2('- deaths: 0 (deaths)')], NAME), null);
        assert.equal(foodScore(['nothing'], NAME), null);
    });
});

describe('probe-craft-place on a simulated server', () => {
    test('everything works: every check passes, and it is still never a gate pass', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(probe.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(r.verdict, 'SMOKE-PASS (not a gate pass)');
        neverGate(r);
        assert.deepEqual(r.notes.placeLatencyMs, [41, 42, 43, 44, 45], "#162's updateMs");
        assert.equal(r.notes.crafts.length, 4);
        assert.equal(s.startEnv().ROTN_DRIVER_PROBE, '1', 'the driver was started with its probe opt-in');
        assert.equal(r.notes.capture, 'captures/raw/FRCFLD-20261103.jsonl', 'the capture path for the evidence step');
        assert.deepEqual(r.notes.crafts.map((c) => [c.result, c.before, c.after]), [['pyrotech:crude_axe', 0, 1], ['contenttweaker:crafting_tools', 0, 1],
            ['minecraft:crafting_table', 0, 1], ['minecraft:stone_pickaxe', 0, 1]]);
        assert.equal(r.notes.crafts[3].tableBlock, 'minecraft:crafting_table');
        assert.deepEqual(r.notes.eat, { ok: true, foodBefore: 14, foodAfter: 19, countBefore: 2, countAfter: 1, ms: 1700, error: null, breadLeft: 1, serverFoodBefore: 14 });
        assert.equal(r.notes.foodBeforeEat.server, 14);
        assert.equal(r.notes.contractProblems, undefined);
        assert.equal(s.inv.size, 0, 'the inventory is cleared at the end');
        assert.equal(s.blocks.get('-43,66,-66'), 'minecraft:crafting_table');
        assert.equal(s.blocks.get('-47,65,-66'), 'minecraft:stone', 'the floor under each placement is stone');
    });

    test('food still at 20 before the eat step: the eat is not sent (it would only time out), and the check fails', async () => {
        const s = sim({ noHunger: true });
        const seen = [];
        const r = await run({ ...s, server: { ...s.server, console: (cmd, w) => { seen.push(cmd); return s.server.console(cmd, w); } } });
        const c = byName(r);
        assert.equal(c.place_5.pass, true);
        assert.equal(c.eat.pass, false);
        assert.match(c.eat.detail, /^not sent: the food is not below 20 after \d+s of hunger \(no food score: the food never changed from 20\)/);
        assert.ok(!seen.some((x) => x.includes('probe-eat')), 'no eat command sent');
        assert.ok(seen.filter((x) => x === `scoreboard players list ${NAME}`).length > 1, 'it polled until foodWaitMs');
        assert.ok(r.notes.foodBeforeEat.waitedMs >= probe.defaults.foodWaitMs);
        assert.ok(seen.includes(`scoreboard objectives remove ${P1_PLAN.foodObjective}`), 'the objective is removed at the end');
        neverGate(r);
    });

    test('P1 attempt 1: a give answered after the console wait is confirmed from the later log lines, and recorded', async () => {
        const r = await run(sim({ late: `give ${NAME} pyrotech:rock` }));
        const c = byName(r);
        assert.equal(c.setup.pass, true, c.setup.detail);
        for (const k of Object.keys(probe.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        assert.deepEqual(r.notes.lateReplies.map((x) => x.cmd), [`give ${NAME} pyrotech:rock`]);
        assert.match(r.notes.lateReplies[0].line, /Given \[pyrotech:rock\] \* 8 to FRCFLD/);
        // A reply that never comes at all still fails setup, as before.
        const never = await run(sim({ late: `give ${NAME} pyrotech:rock`, dropLate: true }));
        assert.equal(byName(never).setup.pass, false);
        assert.match(byName(never).setup.detail, /^4\/5 gives confirmed/);
        neverGate(r);
    });

    test('a reply that breaks contract v1 fails its step, whatever its ok says, and is listed in notes.contractProblems', async () => {
        const r = await run(sim({ breakContract: 'craft' }));
        const c = byName(r);
        assert.equal(c.craft_crude_axe.pass, false);
        assert.match(c.craft_crude_axe.detail, /driver ok=false \(the reply breaks contract v1: [^)]*\bv\b/);
        assert.equal(r.notes.contractProblems.length, 4, 'all four craft replies');
        assert.equal(r.notes.crafts[0].ok, false);
        assert.equal(c.place_5.pass, true, 'places and eats still keep to the contract');
        neverGate(r);
    });

    test('a craft the driver fails also fails its server counts, and the later crafts are still tried', async () => {
        const r = await run(sim({ failCraft: 'crafttweaker:crafting_tools' }));
        const c = byName(r);
        assert.equal(c.craft_crafting_tools.pass, false);
        assert.match(c.craft_crafting_tools.detail, /driver ok=false \(missing ingredients for crafttweaker:crafting_tools\); contenttweaker:crafting_tools 0 \(want 1\), pyrotech:crude_axe 1 \(want 0\)/);
        assert.equal(c.craft_crafting_table.pass, true);
    });

    test('without ROTN_DRIVER_PROBE=1 the driver would ignore every probe: the scenario always sets it', async () => {
        const s = sim();
        const start = s.bot.start;
        const r = await run({ ...s, bot: { ...s.bot, start: () => start({}) } });
        const c = byName(r);
        assert.equal(c.craft_crude_axe.pass, false);
        assert.match(c.craft_crude_axe.detail, /the driver printed nothing for 120s after probe-craft/);
        neverGate(r);
    });

    test('a driver that exits mid-probe stops the scenario: the rest fails or is not reached, never passes', async () => {
        const r = await run(sim({ exitAt: 'place' }));
        const c = byName(r);
        assert.equal(c.craft_stone_pickaxe.pass, true);
        assert.equal(c.place_5.pass, false);
        assert.match(c.place_5.detail, /^0\/5 placed/);
        assert.match(r.notes.aborted, /^the driver exited \(code 0\)$/);
        assert.equal(c.eat.pass, false);
        assert.equal(c.eat.detail, 'not reached');
        assert.match(r.notes.places[0].error, /^the driver exited/);
        neverGate(r);
    });

    test('a placement the server does not see fails place_5, with the count and the latencies', async () => {
        const c = byName(await run(sim({ misplace: 2 })));
        assert.equal(c.place_5.pass, false);
        assert.match(c.place_5.detail, /^4\/5 placed and confirmed; update latencies ms: 41, 42, 43, 44, 45$/);
    });

    test('a driver silent for 120 s after a command aborts the run (net-forge\'s step abort); nothing later passes', async () => {
        for (const silent of ['craft', 'place', 'eat']) {
            const s = sim({ silent });
            const r = await run(s);
            const c = byName(r);
            const k = { craft: 'craft_crude_axe', place: 'place_5', eat: 'eat' }[silent];
            assert.equal(c[k].pass, false, silent);
            assert.match(c[k].detail, new RegExp(`the driver printed nothing for 120s after probe-${silent}`), silent);
            assert.match(r.notes.aborted, /printed nothing for 120s/);
            if (silent === 'craft') assert.equal(c.place_5.detail, 'not reached');
            neverGate(r);
        }
    });

    test('a kick aborts at once with the kick reason; the later steps are not reached', async () => {
        const r = await run(sim({ kickAt: 'place' }));
        const c = byName(r);
        assert.equal(c.craft_stone_pickaxe.pass, true);
        assert.equal(c.place_5.pass, false);
        assert.match(c.place_5.detail, /aborted: kicked \(lost\): Kicked by an operator/);
        assert.equal(r.notes.aborted, 'kicked (lost): Kicked by an operator');
        assert.equal(c.eat.detail, 'not reached');
        neverGate(r);
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
