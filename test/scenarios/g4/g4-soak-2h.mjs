// G4 #7 (with #2, #4 and #5), ready-to-try: "a 2-hour soak: no crash, within the ADR's memory and hourly-cost targets",
// "RotN names", "the early game from a fresh spawn", "eats, fights or flees, survives the first night". test/scenarios/
// g4/PLAN.md step 5. Set-up S: the CX23 service (run.mjs --service frcfld, lib/service.mjs) on a fresh test server. On a
// spawned driver (set-up T) it is a rehearsal: the service-only checks (memory, NRestarts) are not reached.
//
// THE TARGETS ARE NOT SET YET (lead, 2026-11-08): peakMemoryMaxMb and usdPerHourMax are "TBD" until the soak ADR sets
// them after the first measuring run. A check whose target is TBD records the measurement and says "not reached: no
// target yet (TBD)": never a pass.
//
// Every sampleMinutes (5) for durationMinutes (120): metrics (MemoryCurrent, MemoryPeak, NRestarts, ActiveState; S only)
// and a fresh journal read. What the bot logs (lib/survival.mjs): the [survival] lines (#384, #387: ate, fight start/end,
// flee, food), the [death] lines (a death and its report), agent_process's restarts and exits, the agent's own
// !nearbyBlocks results, and the agenda's lines.
// Checks:
//   login_online       S: this run's bot (case aside) from an inactive unit; the join with an online UUID
//   naming             (#2) the agent's first !nearbyBlocks result with blocks, first seen at a sample within
//                      namingWindowMinutes, lists at least minNamedBlocks blocks, none with a numeric, unknown, undefined,
//                      null or placeholder name. None, or later: not reached. (skills-rotn's one-time [naming] line after
//                      the spawn is to replace it; this stays the fallback.)
// A sample whose reads fail is an infra note (notes.infraSamples), never a crash.
//   no_crash           (#7) online to the end; NRestarts unchanged (S); no agent_process restart, fatal or exit line;
//                      ActiveState active at every sample (S)
//   peak_memory        (#7, S) the highest MemoryCurrent (and MemoryPeak, if set) within peakMemoryMaxMb (TBD)
//   usd_per_hour       (#7) the LLM spend per hour within usdPerHourMax (TBD): the sum of cost_usd over the run's
//                      "[openrouter] usage prompt_tokens N, completion_tokens N, cost_usd X" lines (#395), per hour. A
//                      cost_usd unknown, or no usage line at all, makes it not reached, with the count.
//   agenda_done        (#4) "agenda done" within the soak
//   food_floor         (#5) the food level in every [survival] food line stays at or above foodFloor
//   ate_when_low       (#5) every "low" food line is followed by an "ate" line within eatWithinMinutes
//   deaths_reported    (#5, as in #6) every death has its report line before the next death (journal messages carry no
//                      time once read, so the order is the bound); no death passes it
// Notes: every sample, the survival counts (eats, fights by outcome, flees), the deaths, the calls per hour.
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED } from '../../runner/lib/g2.mjs';
import { exitedText } from '../../runner/lib/service.mjs';
import { agentExits, blockNameProblem, deathEvents, llmUsage, nearbyBlocksResults, survivalEvents } from '../../runner/lib/survival.mjs';

const MS = 1000;
const MIN = 60 * MS;
export const TBD = 'TBD';
const set = (v) => v !== TBD && v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export default {
    id: 'g4-soak-2h',
    gate: 'G4',
    // On S the bot's calls go to the CX23's own key (lead, #389): no runner accounting; T rehearsals' spend shows in the
    // batch's key reading.
    llm: false,
    title: 'A 2-hour soak of the CX23 service: no crash, memory and hourly cost within the soak ADR\'s targets, the agenda done, eats when low, deaths reported',
    checks: {
        login_online: 'The bot logs in with its own account (online mode); on S from an inactive unit of this run\'s bot',
        naming: 'The agent\'s first !nearbyBlocks result shows RotN names: no numeric, unknown or placeholder ids (#2)',
        no_crash: 'Two hours with no crash: online to the end, no agent exit or restart, NRestarts unchanged (#7)',
        peak_memory: 'Peak memory within the soak ADR\'s target (#7; the target is TBD until the ADR)',
        usd_per_hour: 'The LLM spend per hour within the soak ADR\'s target (#7; the target is TBD until the ADR)',
        agenda_done: 'The early-game agenda finishes from a fresh spawn (#4)',
        food_floor: 'The food level never falls below the floor (#5)',
        ate_when_low: 'When the food level is low, the bot eats (#5)',
        deaths_reported: 'Every death is reported (#5, as in #6)',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        durationMinutes: 120,
        sampleMinutes: 5,
        namingWindowMinutes: 20,
        minNamedBlocks: 5,
        peakMemoryMaxMb: TBD,
        usdPerHourMax: TBD,
        foodFloor: 6,
        eatWithinMinutes: 5,
        loginTimeoutMs: 240 * MS,
        pollMs: 5 * MS,
        logTail: 20000,
        consoleWaitS: 1,
    },
    gateParams: { durationMinutes: 'equal', sampleMinutes: 'equal', peakMemoryMaxMb: 'equal', usdPerHourMax: 'equal', foodFloor: 'equal', eatWithinMinutes: 'equal' },
    // The login wait, the soak and a minute for the last reads.
    runMinutes: (p) => p.loginTimeoutMs / MIN + p.durationMinutes + 1,

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const name = p.bot;
        const service = bot.kind === 'service';
        const rest = Object.keys(this.checks).filter((k) => k !== 'login_online');
        const notReached = (keys, why) => { for (const k of keys) ctx.check(k, false, `not reached: ${why}`); };
        if (!service) ctx.notGate('not the CX23 service (set-up T): a rehearsal');
        if (!set(p.peakMemoryMaxMb) || !set(p.usdPerHourMax)) ctx.notGate('the soak ADR\'s targets are TBD: a measuring run, not an acceptance run');

        // the start: this run's bot, from an inactive unit (S)
        if (service && String(bot.bot).toLowerCase() !== String(name).toLowerCase()) {
            ctx.check('login_online', false, `the service's bot '${bot.bot}' is not this run's bot '${name}'`);
            notReached(rest, 'the service is another bot');
            return;
        }
        const m0 = service ? await bot.metrics() : null;
        if (service && m0?.ActiveState !== 'inactive' && m0?.ActiveState !== 'failed') {
            ctx.check('login_online', false, `the unit is ${m0?.ActiveState ?? 'unknown'} before the start: stop it first`);
            notReached(rest, 'the unit was not inactive at the start');
            return;
        }
        const s = await startSession(ctx, { name, checkNaming: false });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) { notReached(rest, 'the bot did not log in'); return; }
        const fresh = async () => { if (typeof bot.refresh === 'function') await bot.refresh(); };
        const gone = () => s.events().find(s.gone) ?? (!bot.alive() ? { type: 'exited', reason: exitedText(bot) } : null);

        // the soak: a sample every sampleMinutes
        const startedAt = clock.now();
        const end = startedAt + p.durationMinutes * MIN;
        const samples = [];
        // A sample whose reads fail (an ssh or gate error, #394 review) records the error: an infra note, never a crash.
        let namingSeenMin = null;
        const sample = async () => {
            const min = Math.round(((clock.now() - startedAt) / MIN) * 10) / 10;
            let readError = null;
            try { await fresh(); } catch (e) { readError = String(e?.message ?? e); }
            const m = service ? await bot.metrics().catch((e) => ({ error: String(e?.message ?? e) })) : null;
            if (namingSeenMin === null && nearbyBlocksResults(bot.output()).some((r) => r.names.length)) namingSeenMin = min;
            samples.push({ min, ...(m ? { memoryMb: m.MemoryCurrent != null ? Math.round(Number(m.MemoryCurrent) / 1048576) : null,
                peakMb: Number.isFinite(Number(m.MemoryPeak)) ? Math.round(Number(m.MemoryPeak) / 1048576) : null, nRestarts: m.NRestarts ?? null, state: m.ActiveState ?? null } : {}),
                ...(readError || m?.error ? { error: [readError, m?.error].filter(Boolean).join('; ') } : {}) });
            ctx.note('samples', samples);
        };
        await sample();
        let left = null;
        while (clock.now() < end) {
            await clock.sleep(Math.min(p.sampleMinutes * MIN, end - clock.now()));
            await sample();
            if (!left && gone()) { left = gone(); break; }
        }
        try { await fresh(); } catch (e) { ctx.note('lastReadError', String(e?.message ?? e)); }
        const out = bot.output();
        const minutes = (clock.now() - startedAt) / MIN;
        const failed = samples.filter((x) => x.error);
        if (failed.length) ctx.note('infraSamples', { count: failed.length, first: failed[0] });

        // naming (#2): the agent's first !nearbyBlocks result with names (its own command; the console is no giver), seen
        // at a sample within namingWindowMinutes. (The lead's next step: skills-rotn's one-time [naming] line after the
        // spawn; this parser stays as the fallback.)
        const nb = nearbyBlocksResults(out).find((r) => r.names.length) ?? null;
        if (!nb) notReached(['naming'], 'the agent ran no !nearbyBlocks with any block in the soak\'s log');
        else if (namingSeenMin !== null && namingSeenMin > p.namingWindowMinutes) {
            notReached(['naming'], `the first !nearbyBlocks result came at minute ${namingSeenMin}, after the ${p.namingWindowMinutes}-min window`);
        } else {
            const bad = nb.names.map((n) => [n, blockNameProblem(n)]).filter(([, w]) => w);
            ctx.note('nearbyBlocks', nb.names);
            ctx.check('naming', nb.names.length >= p.minNamedBlocks && bad.length === 0,
                bad.length ? `${bad.length} bad name(s): ${bad.slice(0, 5).map(([n, w]) => `"${n}" (${w})`).join(', ')}` : `${nb.names.length} names, all real (need at least ${p.minNamedBlocks})`);
        }

        // no crash (#7)
        const exits = agentExits(out, name);
        const nr = samples.map((x) => x.nRestarts).filter((x) => x !== null && x !== undefined);
        // Only a sample that read the unit counts: a failed read is an infra note (above), not a crash.
        const notActive = samples.filter((x) => service && !x.error && x.state !== undefined && x.state !== 'active');
        const crashBits = [left && `gone at minute ${Math.round(minutes)}: ${left.type}${left.reason ? ` (${left.reason})` : ''}`,
            exits.length && `${exits.length} agent restart or exit line(s): "${exits[0].line}"`,
            service && nr.length && nr.some((x) => x !== nr[0]) && `NRestarts ${nr[0]} -> ${nr.at(-1)}`,
            notActive.length && `not active at ${notActive.length} sample(s) (${notActive[0].state ?? notActive[0].error})`].filter(Boolean);
        ctx.check('no_crash', crashBits.length === 0 && minutes >= p.durationMinutes - 0.01,
            crashBits.length ? crashBits.join('; ') : `${Math.round(minutes)} min up, ${samples.length} samples${service ? `, NRestarts ${nr[0] ?? '?'} throughout` : ''}, no agent exit`);

        // peak memory (#7, S)
        if (!service) notReached(['peak_memory'], 'not the CX23 service (no metrics)');
        else {
            const peak = Math.max(...samples.map((x) => Math.max(x.memoryMb ?? 0, x.peakMb ?? 0)));
            ctx.note('peakMemoryMb', peak);
            if (!set(p.peakMemoryMaxMb)) ctx.check('peak_memory', false, `not reached: no target yet (TBD); measured peak ${peak} MB`);
            else ctx.check('peak_memory', peak <= Number(p.peakMemoryMaxMb), `peak ${peak} MB (target ${p.peakMemoryMaxMb} MB)`);
        }

        // USD per hour (#7): the sum of cost_usd over the run's "[openrouter] usage ..." lines (#395), per hour. A line with
        // cost_usd unknown makes it not reached, with the count.
        const calls = out.filter((l) => /^\[openrouter\] provider /.test(l)).length;
        const u = llmUsage(out);
        const hours = minutes / 60;
        const usdPerHour = hours > 0 ? Math.round((u.usd / hours) * 1e6) / 1e6 : null;
        ctx.note('llmUsage', { calls, usageLines: u.lines, unknown: u.unknown, usd: u.usd, minutes: Math.round(minutes), usdPerHour });
        if (!u.lines) notReached(['usd_per_hour'], `no "[openrouter] usage ..." line in the log (${calls} LLM calls): the release prints no usage line (setup gap?)`);
        else if (u.unknown) notReached(['usd_per_hour'], `${u.unknown} of ${u.lines} usage line(s) have cost_usd unknown; the known ones sum to USD ${u.usd}`);
        else if (!set(p.usdPerHourMax)) ctx.check('usd_per_hour', false, `not reached: no target yet (TBD); measured USD ${usdPerHour}/h (USD ${u.usd} over ${Math.round(minutes)} min, ${u.lines} completions)`);
        else ctx.check('usd_per_hour', usdPerHour <= Number(p.usdPerHourMax), `USD ${usdPerHour}/h (target ${p.usdPerHourMax}; USD ${u.usd} over ${Math.round(minutes)} min, ${u.lines} completions)`);

        // the agenda (#4)
        const done = out.some((l) => l === 'agenda done') || s.events().some((e) => e.type === 'chat' && e.text === 'agenda done');
        ctx.check('agenda_done', done, done ? '"agenda done" within the soak' : 'no "agenda done" within the soak');

        // food, eating, fights and flees (#5)
        const sv = survivalEvents(out);
        const outcomes = {};
        for (const f of sv.fightEnd) outcomes[f.outcome] = (outcomes[f.outcome] ?? 0) + 1;
        ctx.note('survival', { eats: sv.ate.length, fights: sv.fightStart.length, fightOutcomes: outcomes, flees: sv.flee.length, foodLines: sv.food.length });
        const known = sv.food.filter((f) => f.food !== null);
        if (!known.length) notReached(['food_floor'], 'no [survival] food line in the log');
        else {
            const low = known.reduce((a, b) => (b.food < a.food ? b : a));
            ctx.check('food_floor', low.food >= Number(p.foodFloor), `lowest food ${low.food} (floor ${p.foodFloor}; ${known.length} food lines)`);
        }
        // An "ate" line after each "low" one, within eatWithinMinutes: lines carry no time, so the next food line after
        // that window bounds it (one food line a minute at most, FOOD_LOG_MS).
        const lows = sv.food.filter((f) => f.reason === 'low');
        const unfed = lows.filter((l) => {
            const next = sv.food.filter((f) => f.at > l.at).slice(0, Math.max(1, Number(p.eatWithinMinutes)));
            const until = next.length ? next.at(-1).at : Infinity;
            return !sv.ate.some((a) => a.at > l.at && a.at <= until);
        });
        ctx.check('ate_when_low', unfed.length === 0, lows.length === 0 ? 'the food level was never low' : unfed.length ? `${unfed.length} of ${lows.length} low food line(s) with no eat after them` : `ate after each of ${lows.length} low food line(s)`);

        // deaths (#5, as in #6)
        const { deaths, reports } = deathEvents(out);
        const unreported = deaths.filter((d, i) => !reports.some((r) => r.at > d.at && (deaths[i + 1] === undefined || r.at < deaths[i + 1].at)));
        ctx.note('deaths', { deaths: deaths.length, reports: reports.length });
        ctx.check('deaths_reported', unreported.length === 0, deaths.length === 0 ? 'no death' : unreported.length ? `${unreported.length} of ${deaths.length} death(s) with no report` : `each of ${deaths.length} death(s) reported`);
    },
};
