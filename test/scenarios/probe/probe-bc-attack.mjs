// Probe BC (the lead's Better Combat plan, steps 3 and 4; /home/rv/net-forge-bc-plan.md on the dev server).
// On RotN 3.3.4 a vanilla use_entity attack lands in full only on the first hit per mob: Better Combat's
// AttackEntityEvent handler sets the target's hurtResistantTime to 20 every time (rotn-data #518). net-forge
// #521 makes bot.attack send Better Combat's own PacketMainhandAttack instead (off by default;
// FORGE_BC_ATTACK=on turns it on), and keeps the old path as bot.attackVanilla. This probe shows, on the
// real server, that the server accepts that packet and that every hit lands.
// NEVER a gate: run() records BC_NOT_GATE first.
//
// Driver: test/runner/drivers/bc-attack-driver.mjs (initBot with the wrapper, plus the bc-hit command of
// test/runner/drivers/bc-attack.mjs), started with ROTN_DRIVER_BC_ATTACK=on. No LLM, no key.
// Console: every command goes through guardBcConsole (lib/probe.mjs): bcConsoleAllow(bot) only, and nothing
// at all unless TEST_SERVER_NAME names a disposable test server (mcr-test-...). The list admits exactly
// the plan's commands (#527 review): the three summons at their cells (A and B with {NoAI:1}, the AI zombie
// bare) and kill @e[type=zombie], for this probe only (the lead, 2026-11-21: on the disposable CPX42 only);
// give, tp and clear only for this bot, the BC items and the landing; fill only the lane's two fills (no
// setblock), testforblock only the lane's cells.
// The bot never gets op.
//
// Steps (BC_PLAN):
//   1. login_online; refused before anything is sent if TEST_SERVER_NAME is not a test server's, or if the
//      bot is the CX23 service (it has no bc-hit command).
//   2. setup: the driver says Better Combat's path is active (bc_status); `gamerule doDaylightCycle false`,
//      `time set day`, `kill @e[type=zombie]`; the enclosed lane in the air (attempt 1, #535: a tree trunk
//      stood in the ground lane): `fill` the box around it with stone, then its two rows with air; every one
//      of its 68 cells checked with testforblock. Any wrong cell (or the path not active) fails setup before
//      anything is summoned, and before the bot is moved. Then `tp <bot>` into it.
//   3. For the stone sword, the stone axe, the Pyrotech crude axe (6 given: it breaks after 4 hits) and an
//      empty hand: `clear`, the give, two zombies {NoAI:1} 2 blocks west (A) and east (B) of the bot.
//      bc-hit vanilla on A (bot.attackVanilla at Better Combat's cooldown), then bc-hit bc on B (bot.attack);
//      each until the zombie dies, 40 hits or 60 s. vanilla_<weapon> and bc_<weapon> judge them
//      (judgeSeries; the Better Combat range from the zombie's measured start health, and whether hit 1 was a
//      crit: #533 review). Then `kill @e[type=zombie]`.
//   4. bc_ai_zombie: one zombie with its AI, 3 blocks east, Better Combat's path, stone sword: every hit
//      lands, it dies, no gap under the cooldown. Then `kill @e[type=zombie]`.
//   5. server_log: from the begin marker, no FMLIndexedMessageCodec exception, no WARN/ERROR or exception
//      naming bettercombat, no kick or lost connection for the bot.
//   6. self_check: the wrapper's self-check never tripped (no reply says so, and the driver never printed
//      its "back to vanilla" line).
// notes: each series' reply as the driver sent it (per hit: time, path, health before and after, hurt),
// the judgments, and the server log problems.
// It stops at once (notes.aborted) on a kick or lost connection, a driver exit, or a driver silent for
// stepAbortMs after a command; the checks not reached fail.
import crypto from 'node:crypto';
import process from 'node:process';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { giveVerdict, testforblockVerdict } from '../../runner/lib/g2.mjs';
import { lateConsole } from '../../runner/lib/late-console.mjs';
import {
    BC_DRIVER_ENV, BC_NOT_GATE, BC_PLAN, BC_TRIP_RE, TEST_SERVER_NAME_RE, bcExpected, bcHit, bcLaneCells, bcLaneFills, bcLogProblems, bcReply, guardBcConsole, judgeSeries,
} from '../../runner/lib/probe.mjs';

const MS = 1000;
const newToken = () => crypto.randomBytes(6).toString('hex');
const SUMMONED = /Object successfully summoned/;

const checks = {
    login_online: 'The bot logs in with its own account (online mode)',
    setup: 'The driver\'s Better Combat path is active, and every cell of the enclosed lane in the air is as planned (testforblock), before anything is summoned',
};
for (const w of BC_PLAN.weapons) {
    checks[`vanilla_${w.check}`] = `${w.item}, vanilla path (bot.attackVanilla at Better Combat's cooldown): only the first hit lowers the NoAI zombie's health`;
    checks[`bc_${w.check}`] = `${w.item}, Better Combat's path (bot.attack): every hit lowers the health, the hits to kill are in rotn-data's range (every hit a crit to none), no gap under ${w.cooldownTicks} ticks`;
}
checks.bc_ai_zombie = 'A zombie with its AI, Better Combat\'s path, stone sword: every hit lowers its health and it dies; no gap under 13 ticks';
checks.server_log = 'No FMLIndexedMessageCodec exception, no WARN/ERROR naming bettercombat, no kick';
checks.self_check = 'The wrapper\'s self-check (5 hits without a hurt -> vanilla) never tripped';

export default {
    id: 'probe-bc-attack',
    gate: 'BC',
    title: 'Probe BC: Better Combat\'s attack packet against the vanilla attack on the real RotN server (a probe, never a gate)',
    checks,
    defaults: {
        bot: 'FRCFLD',
        loginTimeoutMs: 240 * MS,
        settleMs: 10 * MS,
        replyTimeoutMs: 90 * MS,   // the driver's series lasts at most 60 s plus its settle
        stepAbortMs: 120 * MS,
        pollMs: 1 * MS,
        tpSettleMs: 3 * MS,
        summonSettleMs: 3 * MS,    // the zombies' spawn packets reach the bot
        logTail: 20000,
        consoleWaitS: 1,
        lateReplyMs: 5 * MS,
        latePollMs: 1 * MS,
    },
    gateParams: {},

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        ctx.notGate(BC_NOT_GATE);
        const name = p.bot;
        const plan = BC_PLAN;
        const serverName = process.env.TEST_SERVER_NAME ?? null;
        if (!TEST_SERVER_NAME_RE.test(serverName ?? '')) {
            ctx.check('login_online', false, `not started: TEST_SERVER_NAME '${serverName ?? ''}' is not a disposable test server (summon and kill are for the CPX42 only)`);
            return;
        }
        if (bot.kind === 'service') {
            ctx.check('login_online', false, 'not started: probe BC needs its own driver (bc-attack-driver.mjs), not the CX23 service');
            return;
        }
        const server = guardBcConsole(ctx.server, serverName, name);
        const lc = lateConsole(server, clock, { waitS: p.consoleWaitS, lateMs: p.lateReplyMs, pollMs: p.latePollMs });
        const con = lc.con;
        const confirm = async (cmd, accept) => {
            const n = lc.late().length;
            const lines = await lc.confirm(cmd, accept);
            if (lc.late().length > n) ctx.note('lateReplies', lc.late());
            return lines;
        };
        const tp = async (cmd) => lastTeleport(await confirm(cmd, (l) => lastTeleport(l, name) !== null), name);
        const testfor = async (pos, block) => testforblockVerdict(await confirm(`testforblock ${pos.join(' ')} ${block}`,
            (l) => { const v = testforblockVerdict(l, pos); return v.ok || /^The block at /.test(v.detail ?? ''); }), pos);
        const summon = async (pos, noAi) => (await confirm(`summon minecraft:zombie ${pos.join(' ')}${noAi ? ' {NoAI:1}' : ''}`, (l) => l.some((x) => SUMMONED.test(x)))).some((x) => SUMMONED.test(x));
        let aborted = null;
        let session = null;
        const stopReason = () => {
            const k = session?.events().find(session.gone);
            if (k) return `kicked (${k.type}): ${k.reason ?? 'no reason logged'}`;
            return bot.alive() ? null : `the driver exited (code ${bot.exitCode()})`;
        };
        const abort = (why) => {
            aborted ??= why;
            ctx.note('aborted', aborted);
            return null;
        };
        const ask = async (line) => {
            const pre = stopReason();
            if (pre) return abort(pre);
            const t = newToken();
            const sent = clock.now();
            const linesAtSend = bot.output().length;
            con(line(t));
            const r = await ctx.waitFor(() => bcReply(bot.output(), t) ?? (stopReason() ? { stop: true } : null), p.replyTimeoutMs);
            if (r && !r.stop) return r;
            if (r?.stop) return abort(stopReason());
            if (bot.output().length === linesAtSend) {
                const left = p.stepAbortMs - (clock.now() - sent);
                const woke = left > 0 ? await ctx.waitFor(() => bot.output().length > linesAtSend || stopReason(), left) : null;
                if (!woke) return abort(`the driver printed nothing for ${p.stepAbortMs / MS}s after bc-hit`);
                if (stopReason()) return abort(stopReason());
            }
            return null;
        };
        const driverEvent = (type) => {
            for (const l of bot.output()) {
                if (!l.startsWith('DRIVER ')) continue;
                try { const e = JSON.parse(l.slice(7)); if (e?.type === type) return e; } catch { /* not an event */ }
            }
            return null;
        };
        const series = [];
        // item: the Better Combat series' item; its range comes from the zombie's measured start health (#533 review), or the
        // catalogue's 20 when the driver read none. firstHit: say whether hit 1 was a crit (NoAI series: a sneak attack, #528).
        const judged = (key, r, opts, { item = null, firstHit = false } = {}) => {
            const expected = item ? bcExpected(item, { health: r?.target?.startHealth }) : null;
            const v = judgeSeries(r, { ...opts, ...(expected ? { expected } : {}) });
            series.push({ key, reply: r, expected, verdict: v });
            ctx.note('series', series);
            const n = r?.hits?.length ?? 0;
            const yes = (x) => (x === true ? 'yes' : x === false ? 'no' : 'unknown');
            ctx.check(key, v.ok, `${r ? `${n} hit(s), end ${r.end ?? '?'}, health ${r.target?.startHealth ?? '?'} -> ${r.healthEnd ?? '?'}`
                + `${v.projected !== null ? `, ${v.projected} to kill${r.end === 'dead' ? '' : ' (projected)'}` : ''}`
                + `${expected && !opts.ai ? ` (range ${expected.min}-${expected.max} at ${expected.healthFrom} health ${expected.health})` : ''}`
                + `${v.crits ? `, crits ${v.crits.crits.length ? `#${v.crits.crits.join(', #')}` : 'none'}` : ''}`
                + `${firstHit ? `, hit 1 crit: ${yes(v.firstHitCrit)}` : ''}` : aborted ?? `no reply within ${p.replyTimeoutMs / MS}s`}: ${v.why}`);
            return v;
        };

        // 1. login with Better Combat's path on
        const s = await startSession(ctx, { name, env: { ...BC_DRIVER_ENV }, checkNaming: false });
        session = s;
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);

        // 2. setup
        const status = driverEvent('bc_status');
        ctx.note('bcStatus', status);
        con('gamerule doDaylightCycle false');
        con('time set day');
        con('kill @e[type=zombie]');
        // The enclosed lane in the air (attempt 1, #535): two fills, then every one of its cells checked before anything else.
        for (const f of bcLaneFills(plan.lane)) con(f);
        const lane = [];
        for (const [x, y, z, block] of bcLaneCells(plan.lane)) lane.push({ cell: [x, y, z], block, ...(await testfor([x, y, z], block)) });
        const wrong = lane.filter((v) => !v.ok);
        ctx.note('lane', { fills: bcLaneFills(plan.lane), cells: lane.length, wrong: wrong.map((v) => ({ cell: v.cell, want: v.block, got: v.detail ?? null })) });
        const laneOk = wrong.length === 0;
        const active = status?.active === true;
        if (laneOk && active) {
            const teleported = await tp(`tp ${name} ${plan.landing.join(' ')}`);
            await clock.sleep(p.tpSettleMs);
            ctx.note('landing', { planned: plan.landing, teleportedTo: teleported, botPosition: await tp(`tp ${name} ~ ~ ~`) });
        }
        const setupStop = stopReason();
        ctx.check('setup', laneOk && active && !setupStop, setupStop ? `aborted: ${setupStop}`
            : `Better Combat's path ${active ? 'active' : `NOT active (${status ? status.status ?? 'no status' : 'no bc_status from the driver'})`}; lane ${lane.length - wrong.length}/${lane.length} cells as planned`
            + `${wrong.length ? ` (wrong: ${wrong.slice(0, 4).map((v) => `${v.cell.join(' ')}: ${v.detail ?? 'no reply'}`).join('; ')}${wrong.length > 4 ? '; ...' : ''})` : ''}`);
        if (setupStop) return abort(setupStop);
        if (!laneOk || !active) return;

        // 3. each weapon: A on the vanilla path, B on Better Combat's
        for (const w of plan.weapons) {
            con('kill @e[type=zombie]');
            con(`clear ${name}`);
            const given = w.give ? giveVerdict(await confirm(`give ${name} ${w.item} ${w.give} 0`, (l) => giveVerdict(l, name).ok), name) : { ok: true };
            const a = await summon(plan.zombieA, true);
            const b = await summon(plan.zombieB, true);
            await clock.sleep(p.summonSettleMs);
            if (!given.ok || !a || !b) {
                const why = `setup for ${w.item} failed: give ${given.ok ? 'ok' : given.detail ?? 'no reply'}, zombie A ${a ? 'summoned' : 'not summoned'}, zombie B ${b ? 'summoned' : 'not summoned'}`;
                ctx.check(`vanilla_${w.check}`, false, why);
                ctx.check(`bc_${w.check}`, false, why);
                continue;
            }
            const rv = await ask((t) => bcHit(name, t, 'vanilla', plan.zombieA, w.item));
            judged(`vanilla_${w.check}`, rv, { path: 'vanilla', cooldownTicks: w.cooldownTicks });
            if (aborted) return;
            const rb = await ask((t) => bcHit(name, t, 'bc', plan.zombieB, w.item));
            judged(`bc_${w.check}`, rb, { path: 'bc', cooldownTicks: w.cooldownTicks, maxHits: plan.maxHits }, { item: w.item, firstHit: true });
            if (aborted) return;
            con('kill @e[type=zombie]');
        }

        // 4. one zombie with its AI, Better Combat's path, stone sword
        con('kill @e[type=zombie]');
        con(`clear ${name}`);
        const sword = giveVerdict(await confirm(`give ${name} ${plan.ai.item} 1 0`, (l) => giveVerdict(l, name).ok), name);
        const z = await summon(plan.zombieAi, false);
        await clock.sleep(p.summonSettleMs);
        if (!sword.ok || !z) ctx.check('bc_ai_zombie', false, `setup failed: give ${sword.ok ? 'ok' : 'not confirmed'}, zombie ${z ? 'summoned' : 'not summoned'}`);
        else {
            const r = await ask((t) => bcHit(name, t, 'bc', 'ai', plan.ai.item));
            judged('bc_ai_zombie', r, { path: 'bc', cooldownTicks: plan.ai.cooldownTicks, ai: true }, { item: plan.ai.item });
            if (aborted) return;
        }
        con('kill @e[type=zombie]');
        con(`clear ${name}`);

        // 5. the server log since the begin marker
        const lines = s.sinceMarker();
        const problems = bcLogProblems(lines);
        const kicks = s.events().filter(s.gone);
        ctx.note('serverLogProblems', problems.slice(0, 50));
        ctx.check('server_log', problems.length === 0 && kicks.length === 0,
            `${problems.length} codec or bettercombat problem line(s)${problems.length ? ` (first: ${problems[0].slice(0, 200)})` : ''}; ${kicks.length} kick(s) or lost connection(s)`);

        // 6. the self-check
        const tripLines = bot.output().filter((l) => BC_TRIP_RE.test(l));
        const trippedReplies = series.filter((x) => x.reply?.tripped).map((x) => x.key);
        ctx.check('self_check', tripLines.length === 0 && trippedReplies.length === 0,
            tripLines.length || trippedReplies.length ? `tripped: ${tripLines[0] ?? ''}${trippedReplies.length ? ` (replies: ${trippedReplies.join(', ')})` : ''}` : `never tripped over ${series.length} series`);
    },
};
