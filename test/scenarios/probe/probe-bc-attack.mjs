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
// Console: every command goes through guardBcConsole (lib/probe.mjs): BC_CONSOLE_ALLOW only, and nothing
// at all unless TEST_SERVER_NAME names a disposable test server (mcr-test-...). summon (a plain zombie,
// with or without {NoAI:1}) and kill (@e[type=zombie]) are on that list for this probe only (the lead,
// 2026-11-21: on the disposable CPX42 only). The bot never gets op.
//
// Steps (BC_PLAN):
//   1. login_online; refused before anything is sent if TEST_SERVER_NAME is not a test server's, or if the
//      bot is the CX23 service (it has no bc-hit command).
//   2. setup: the driver says Better Combat's path is active (bc_status); `gamerule doDaylightCycle false`,
//      `time set day`, `kill @e[type=zombie]`; the lane (stone floor, two air cells, a stone roof against
//      daylight burning), checked with testforblock; `tp <bot>` onto it.
//   3. For the stone sword, the stone axe, the Pyrotech crude axe (6 given: it breaks after 4 hits) and an
//      empty hand: `clear`, the give, two zombies {NoAI:1} 2 blocks west (A) and east (B) of the bot.
//      bc-hit vanilla on A (bot.attackVanilla at Better Combat's cooldown), then bc-hit bc on B (bot.attack);
//      each until the zombie dies, 40 hits or 60 s. vanilla_<weapon> and bc_<weapon> judge them
//      (judgeSeries). Then `kill @e[type=zombie]`.
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
    BC_DRIVER_ENV, BC_NOT_GATE, BC_PLAN, BC_TRIP_RE, TEST_SERVER_NAME_RE, bcHit, bcLaneBlocks, bcLogProblems, bcReply, guardBcConsole, judgeSeries,
} from '../../runner/lib/probe.mjs';

const MS = 1000;
const newToken = () => crypto.randomBytes(6).toString('hex');
const SUMMONED = /Object successfully summoned/;

const checks = {
    login_online: 'The bot logs in with its own account (online mode)',
    setup: 'The driver\'s Better Combat path is active, and the lane stands (stone floor, air, roof)',
};
for (const w of BC_PLAN.weapons) {
    checks[`vanilla_${w.check}`] = `${w.item}, vanilla path (bot.attackVanilla at Better Combat's cooldown): only the first hit lowers the NoAI zombie's health`;
    checks[`bc_${w.check}`] = `${w.item}, Better Combat's path (bot.attack): every hit lowers the health, the hits to kill are near #518's ${w.hits.join(' or ')}, no gap under ${w.cooldownTicks} ticks`;
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
        const server = guardBcConsole(ctx.server, serverName);
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
        const judged = (key, r, opts) => {
            const v = judgeSeries(r, opts);
            series.push({ key, reply: r, verdict: v });
            ctx.note('series', series);
            const n = r?.hits?.length ?? 0;
            ctx.check(key, v.ok, `${r ? `${n} hit(s), end ${r.end ?? '?'}, health ${r.target?.startHealth ?? '?'} -> ${r.healthEnd ?? '?'}`
                + `${v.projected !== null ? `, ${v.projected} to kill${r.end === 'dead' ? '' : ' (projected)'}` : ''}` : aborted ?? `no reply within ${p.replyTimeoutMs / MS}s`}: ${v.why}`);
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
        for (const [x, y, z, block] of bcLaneBlocks(plan.lane)) con(`setblock ${x} ${y} ${z} ${block}`);
        const lane = [];
        for (const cell of [plan.landing, plan.zombieA, plan.zombieB, plan.zombieAi]) {
            lane.push(await testfor([cell[0], cell[1] - 1, cell[2]], 'minecraft:stone'), await testfor(cell, 'minecraft:air'), await testfor([cell[0], cell[1] + 2, cell[2]], 'minecraft:stone'));
        }
        const teleported = await tp(`tp ${name} ${plan.landing.join(' ')}`);
        await clock.sleep(p.tpSettleMs);
        ctx.note('landing', { planned: plan.landing, teleportedTo: teleported, botPosition: await tp(`tp ${name} ~ ~ ~`) });
        const laneOk = lane.every((v) => v.ok);
        const active = status?.active === true;
        const setupStop = stopReason();
        ctx.check('setup', laneOk && active && !setupStop, setupStop ? `aborted: ${setupStop}`
            : `Better Combat's path ${active ? 'active' : `NOT active (${status ? status.status ?? 'no status' : 'no bc_status from the driver'})`}; lane ${lane.filter((v) => v.ok).length}/${lane.length} cells as planned`);
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
            judged(`bc_${w.check}`, rb, { path: 'bc', hits: w.hits, cooldownTicks: w.cooldownTicks, maxHits: plan.maxHits });
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
            judged('bc_ai_zombie', r, { path: 'bc', cooldownTicks: plan.ai.cooldownTicks, ai: true });
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
