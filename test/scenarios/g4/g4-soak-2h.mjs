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
// and a fresh journal read. What the bot logs (lib/survival.mjs): the [naming] line (#396), the [survival] lines (#384,
// #387: ate, fight start/end, flee, food), the [death] lines (a death and its report), the [openrouter] usage lines
// (#395), agent_process's restarts and exits, the agent's own !nearbyBlocks results, and the agenda's lines.
// Infra, never the bot's fault (#394 reviews): a sample whose reads fail is an infra note (notes.infraSamples); a unit
// state 'unknown' (status reads failing, lib/service.mjs) is no departure; and the journal-based checks need a read that
// covers the soak (on S a good final read starting at the unit's start line; notes.journalCoverage). With a gap, a
// result later lines cannot change stands (a seen crash, "agenda done", food below the floor); any other is
// "not reached (infra)", and USD per hour is measured over the covered minutes.
// Checks:
//   login_online       S: this run's bot (case aside) from an inactive unit; the join with an online UUID
//   naming             (#2) the deterministic "[naming] <bot> near spawn" line (naming_report.js, #396) is the only pass
//                      source: unknown 0, at least NAMING_MIN_KINDS (3) kinds, each name real (blockNameProblem). No
//                      line (the release lacks #396, or the bot never spawned), fewer kinds, or its could-not-read
//                      warning: a fail. The entity line, if it lists any kind, needs unknown 0 (its keys are #<id> forms
//                      since #397, so the field is the authority); none near is a note. !nearbyBlocks: a note only.
//   no_crash           (#7) online to the end; NRestarts unchanged (S); no agent_process restart, fatal or exit line;
//                      ActiveState active at every sample whose metrics read worked (S). An unknown state at the end:
//                      not reached (infra).
//   peak_memory        (#7, S) the highest MemoryCurrent (and MemoryPeak, if set) within peakMemoryMaxMb (TBD)
//   usd_per_hour       (#7) the LLM spend per hour within usdPerHourMax (TBD): the sum of cost_usd over the run's
//                      "[openrouter] usage prompt_tokens N, completion_tokens N, cost_usd X" lines (#395), per covered
//                      hour. A cost_usd unknown, or no usage line at all, makes it not reached, with the count.
//   agenda_done        (#4) "agenda done" within the soak
//   food_floor         (#5) the food level in every [survival] food line stays at or above foodFloor
//   ate_when_low       (#5) every "low" food line is followed by an "ate" line within eatWithinMinutes
//   deaths_reported    (#5, as in #6) every death has its report line before the next death (journal messages carry no
//                      time once read, so the order is the bound); no death passes it
// Notes: every sample, the survival counts (eats, fights by outcome, flees), the deaths, the LLM usage, the coverage.
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED } from '../../runner/lib/g2.mjs';
import { exitedText } from '../../runner/lib/service.mjs';
import { agentExits, blockNameProblem, deathEvents, entityNamingAtStart, isAir, llmUsage, namingAtStart, nearbyBlocksResults, survivalEvents } from '../../runner/lib/survival.mjs';

const MS = 1000;
const MIN = 60 * MS;
export const TBD = 'TBD';
/** naming_report.js's NAMING_MIN_KINDS (#396): fewer kinds near spawn is a scan of unloaded chunks (lead: a fail). */
export const NAMING_MIN_KINDS = 3;
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
        naming: 'The bot\'s [naming] line near spawn shows RotN names: no unknown, numeric or placeholder ids (#2)',
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
        // A unit whose state is unknown (STATUS_FAIL_LIMIT status reads failed, lib/service.mjs) is not alive() but has
        // not left: an infra fault, never a departure (#394 re-review).
        const unknownState = () => bot.unitState?.() === 'unknown';
        const gone = () => s.events().find(s.gone) ?? (!bot.alive() && !unknownState() ? { type: 'exited', reason: exitedText(bot) } : null);

        // the soak: a sample every sampleMinutes
        const startedAt = clock.now();
        const end = startedAt + p.durationMinutes * MIN;
        const minuteNow = () => Math.round(((clock.now() - startedAt) / MIN) * 10) / 10;
        const samples = [];
        // A sample whose reads fail (an ssh or gate error, #394 review) records the error: an infra note, never a crash.
        // After a failed refresh, output() is the cached journal of the last good read (#394 re-review): lastReadMin is
        // the minute of the last good read.
        let lastReadMin = null;
        const sample = async () => {
            const min = minuteNow();
            let readError = null;
            try { await fresh(); lastReadMin = min; } catch (e) { readError = String(e?.message ?? e); }
            const m = service ? await bot.metrics().catch((e) => ({ error: String(e?.message ?? e) })) : null;
            samples.push({ min, ...(m ? { memoryMb: m.MemoryCurrent != null ? Math.round(Number(m.MemoryCurrent) / 1048576) : null,
                peakMb: Number.isFinite(Number(m.MemoryPeak)) ? Math.round(Number(m.MemoryPeak) / 1048576) : null, nRestarts: m.NRestarts ?? null, state: m.ActiveState ?? null } : {}),
                ...(readError ? { readError } : {}), ...(m?.error ? { metricsError: m.error } : {}) });
            ctx.note('samples', samples);
        };
        await sample();
        let left = null;
        while (clock.now() < end) {
            await clock.sleep(Math.min(p.sampleMinutes * MIN, end - clock.now()));
            await sample();
            if (!left && gone()) { left = gone(); break; }
        }
        let finalReadOk = true;
        try { await fresh(); lastReadMin = minuteNow(); } catch (e) { finalReadOk = false; ctx.note('lastReadError', String(e?.message ?? e)); }
        const out = bot.output();
        const minutes = (clock.now() - startedAt) / MIN;
        const failed = samples.filter((x) => x.readError || x.metricsError);
        if (failed.length) ctx.note('infraSamples', { count: failed.length, first: failed[0] });
        if (bot.stateUnknown) ctx.note('stateUnknown', bot.stateUnknown);

        // Journal coverage (#394 re-review): the journal-based checks judge the soak only if the log read covers it to the
        // end. On S that is a good final read (every read is --since the start, so it covers the failed ones before it)
        // whose first line is the unit's start (the ctl caps a read's lines; a cut read loses the start). On T the driver's
        // own output is complete.
        const startLine = /^Starting mindcraft-rotn@\S+\.service/.test(out[0] ?? '');
        const gap = !service ? null
            : !finalReadOk ? (lastReadMin === null ? 'no journal read worked (reads failing: infra)' : `the journal was last read at minute ${lastReadMin} of ${Math.round(minutes)} (reads failing: infra)`)
                : !startLine ? 'the journal read does not start at the unit\'s "Starting mindcraft-rotn@" line (cut by the ctl\'s line cap?)' : null;
        const coveredMinutes = gap ? (startLine ? lastReadMin ?? 0 : 0) : minutes;
        ctx.note('journalCoverage', { complete: !gap, coveredMinutes: Math.round(coveredMinutes * 10) / 10, minutes: Math.round(minutes * 10) / 10, ...(gap ? { gap } : {}) });
        // A result that later lines cannot change stands on a partial read (a seen "agenda done", a seen crash, food seen
        // below the floor); any other journal-based result is not reached, with what the partial read showed.
        const infra = (k, detail) => ctx.check(k, false, `not reached (infra): ${gap}; ${detail}`);
        const partial = (k, pass, detail) => (gap && pass ? infra(k, `on what was read: ${detail}`) : ctx.check(k, pass, detail));

        // naming (#2), lead's decisions on #394: the deterministic "[naming] <bot> near spawn" line is the only pass source.
        // It passes with unknown 0, at least NAMING_MIN_KINDS kinds and every name real (blockNameProblem; an unnamed
        // block prints "#<type>:<meta>"). No line, fewer kinds, or the could-not-read warning fails; with a journal gap a
        // missing line is not reached (infra), as the line may lie past the last good read. The entity line, when it lists
        // any kind, needs unknown 0 (the field is the authority: #397 keys unknown entities "#<id>"); nothing near (0 kinds,
        // or no entity line) is a note. The agent's own !nearbyBlocks results are a note, never a pass.
        const nl = namingAtStart(out, name);
        const el = entityNamingAtStart(out, name);
        const nb = nearbyBlocksResults(out).find((r) => r.names.length) ?? null;
        if (nb) ctx.note('nearbyBlocks', { names: nb.names, problems: nb.names.map((n) => [n, blockNameProblem(n)]).filter(([, w]) => w) });
        ctx.note('naming', { block: nl, entity: el });
        if (!nl) {
            if (gap) infra('naming', `no "[naming] ${name} near spawn" line in what was read`);
            else ctx.check('naming', false, `no "[naming] ${name} near spawn" line: the release lacks #396, or the bot never spawned`);
        } else if (nl.error) ctx.check('naming', false, `the bot could not read the world near spawn: "${nl.line}"`);
        else {
            const names = [...new Set(nl.entries.map((e) => e.name))].filter((n) => !isAir(n));
            const bad = names.map((n) => [n, blockNameProblem(n)]).filter(([, w]) => w);
            const entityBad = el && el.kinds > 0 && el.unknown > 0;
            const why = [nl.kinds < NAMING_MIN_KINDS && `${nl.kinds} kind(s) near spawn (need at least ${NAMING_MIN_KINDS})`,
                nl.unknown && `unknown ${nl.unknown} in the block line`,
                bad.length && `${bad.length} bad name(s): ${bad.slice(0, 5).map(([n, w]) => `"${n}" (${w})`).join(', ')}`,
                entityBad && `unknown ${el.unknown} of ${el.kinds} kind(s) in the entity line (${el.entries.filter((e) => e.name.startsWith('#')).slice(0, 5).map((e) => e.name).join(' ') || 'see the line'})`].filter(Boolean);
            const entities = !el ? 'no entity line (nothing near?)' : el.kinds === 0 ? `no entity near (+${el.secs}s)` : `entities: ${el.kinds} kinds, unknown 0`;
            if (!el || el.kinds === 0) ctx.note('namingEntities', entities);
            ctx.check('naming', why.length === 0, why.length ? why.join('; ') : `[naming]: ${nl.kinds} kinds, unknown 0, all real; ${entities}`);
        }

        // no crash (#7). A seen crash fails on any read. With none seen: an unknown unit state at the end (status reads
        // failing) or a journal gap makes it not reached (infra), never a pass and never the bot's fault.
        const exits = agentExits(out, name);
        const nr = samples.map((x) => x.nRestarts).filter((x) => x !== null && x !== undefined);
        // Only a sample whose metrics read worked counts: a failed read is an infra note (above), not a crash.
        const notActive = samples.filter((x) => service && !x.metricsError && x.state !== undefined && x.state !== 'active');
        const crashBits = [left && `gone at minute ${Math.round(minutes)}: ${left.type}${left.reason ? ` (${left.reason})` : ''}`,
            exits.length && `${exits.length} agent restart or exit line(s): "${exits[0].line}"`,
            service && nr.length && nr.some((x) => x !== nr[0]) && `NRestarts ${nr[0]} -> ${nr.at(-1)}`,
            notActive.length && `not active at ${notActive.length} sample(s) (${notActive[0].state})`].filter(Boolean);
        if (crashBits.length) ctx.check('no_crash', false, crashBits.join('; '));
        else if (unknownState()) {
            ctx.check('no_crash', false, `not reached (infra): the unit's state is unknown at the end (status reads failing since ${bot.stateUnknown?.since ?? '?'})`);
        } else {
            partial('no_crash', minutes >= p.durationMinutes - 0.01,
                `${Math.round(minutes)} min up, ${samples.length} samples${service ? `, NRestarts ${nr[0] ?? '?'} throughout` : ''}, no agent exit${bot.stateUnknown ? '; the unit\'s state was unknown for a while (status reads failing, infra)' : ''}`);
        }

        // peak memory (#7, S)
        if (!service) notReached(['peak_memory'], 'not the CX23 service (no metrics)');
        else {
            const peak = Math.max(...samples.map((x) => Math.max(x.memoryMb ?? 0, x.peakMb ?? 0)));
            ctx.note('peakMemoryMb', peak);
            if (!set(p.peakMemoryMaxMb)) ctx.check('peak_memory', false, `not reached: no target yet (TBD); measured peak ${peak} MB`);
            else ctx.check('peak_memory', peak <= Number(p.peakMemoryMaxMb), `peak ${peak} MB (target ${p.peakMemoryMaxMb} MB)`);
        }

        // USD per hour (#7): the sum of cost_usd over the run's "[openrouter] usage ..." lines (#395), over the minutes the
        // journal read covers. A cost_usd unknown, no usage line, or a journal gap makes it not reached.
        const calls = out.filter((l) => /^\[openrouter\] provider /.test(l)).length;
        const u = llmUsage(out);
        const hours = coveredMinutes / 60;
        const usdPerHour = hours > 0 ? Math.round((u.usd / hours) * 1e6) / 1e6 : null;
        const over = `USD ${u.usd} over ${Math.round(coveredMinutes)} min, ${u.lines} completions`;
        ctx.note('llmUsage', { calls, usageLines: u.lines, unknown: u.unknown, usd: u.usd, minutes: Math.round(coveredMinutes), usdPerHour });
        if (gap) infra('usd_per_hour', coveredMinutes > 0 ? `measured USD ${usdPerHour}/h over the covered time (${over})` : `no covered minute to measure over (USD ${u.usd} in what was read, ${u.lines} completions)`);
        else if (!u.lines) notReached(['usd_per_hour'], `no "[openrouter] usage ..." line in the log (${calls} LLM calls): the release prints no usage line (setup gap?)`);
        else if (u.unknown) notReached(['usd_per_hour'], `${u.unknown} of ${u.lines} usage line(s) have cost_usd unknown; the known ones sum to USD ${u.usd}`);
        else if (!set(p.usdPerHourMax)) ctx.check('usd_per_hour', false, `not reached: no target yet (TBD); measured USD ${usdPerHour}/h (${over})`);
        else ctx.check('usd_per_hour', usdPerHour <= Number(p.usdPerHourMax), `USD ${usdPerHour}/h (target ${p.usdPerHourMax}; ${over})`);

        // the agenda (#4): a seen "agenda done" stands on a partial read
        const done = out.some((l) => l === 'agenda done') || s.events().some((e) => e.type === 'chat' && e.text === 'agenda done');
        if (done || !gap) ctx.check('agenda_done', done, done ? '"agenda done" within the soak' : 'no "agenda done" within the soak');
        else infra('agenda_done', `no "agenda done" in what was read`);

        // food, eating, fights and flees (#5)
        const sv = survivalEvents(out);
        const outcomes = {};
        for (const f of sv.fightEnd) outcomes[f.outcome] = (outcomes[f.outcome] ?? 0) + 1;
        ctx.note('survival', { eats: sv.ate.length, fights: sv.fightStart.length, fightOutcomes: outcomes, flees: sv.flee.length, foodLines: sv.food.length });
        const known = sv.food.filter((f) => f.food !== null);
        if (!known.length) notReached(['food_floor'], `no [survival] food line in the log${gap ? ` (${gap})` : ''}`);
        else {
            const low = known.reduce((a, b) => (b.food < a.food ? b : a));
            partial('food_floor', low.food >= Number(p.foodFloor), `lowest food ${low.food} (floor ${p.foodFloor}; ${known.length} food lines)`);
        }
        // An "ate" line after each "low" one, within eatWithinMinutes: lines carry no time, so the next food line after
        // that window bounds it (one food line a minute at most, FOOD_LOG_MS).
        const lows = sv.food.filter((f) => f.reason === 'low');
        const unfed = lows.filter((l) => {
            const next = sv.food.filter((f) => f.at > l.at).slice(0, Math.max(1, Number(p.eatWithinMinutes)));
            const until = next.length ? next.at(-1).at : Infinity;
            return !sv.ate.some((a) => a.at > l.at && a.at <= until);
        });
        const ateDetail = lows.length === 0 ? 'the food level was never low' : unfed.length ? `${unfed.length} of ${lows.length} low food line(s) with no eat after them` : `ate after each of ${lows.length} low food line(s)`;
        if (gap) infra('ate_when_low', `on what was read: ${ateDetail}`);
        else ctx.check('ate_when_low', unfed.length === 0, ateDetail);

        // deaths (#5, as in #6)
        const { deaths, reports } = deathEvents(out);
        const unreported = deaths.filter((d, i) => !reports.some((r) => r.at > d.at && (deaths[i + 1] === undefined || r.at < deaths[i + 1].at)));
        ctx.note('deaths', { deaths: deaths.length, reports: reports.length });
        const deathDetail = deaths.length === 0 ? 'no death' : unreported.length ? `${unreported.length} of ${deaths.length} death(s) with no report` : `each of ${deaths.length} death(s) reported`;
        if (gap) infra('deaths_reported', `on what was read: ${deathDetail}`);
        else ctx.check('deaths_reported', unreported.length === 0, deathDetail);
    },
};
