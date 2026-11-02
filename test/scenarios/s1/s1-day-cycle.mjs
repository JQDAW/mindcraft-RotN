// S1 (c), a measurement before G3 (coord/STATUS-harness-ops.md, "G3 batches"): how fast does the day
// run on RotN 3.3.4 with Extended Days installed, while a player is online? G3's first-night scenario
// pins its dawn bound from this (lead, #101). The runner does not touch the time or the daylight cycle
// here: Time Shall Not Pass turns the cycle on when a player connects, and that is the real condition.
//
// Steps
//   1. login_online, as in G2.
//   2. Every sampleMs for durationMs: `time query daytime`, recorded with the seconds since the start.
//   3. samples_ok: at least minParsedShare of the queries answered with a number.
//      time_advances: the median rate is above 0 ticks per minute (the cycle runs with the bot online).
//      stayed_online: the bot did not leave or get kicked during the measurement.
//   notes.cycle: ticks per real minute, the cycle length that implies, and every wrap (daytime going
//   down, the start of a new day).
import { startSession } from '../../runner/lib/session.mjs';
import { dayCycleSummary, timeQuery } from '../../runner/lib/s1.mjs';

const MS = 1000;

export default {
    id: 's1-day-cycle',
    gate: 'S1',
    title: 'The day length on RotN (Extended Days) with the bot online, for G3\'s dawn bound (a measurement, not a gate)',
    checks: {
        login_online: 'The bot logs in with its own account (online mode)',
        samples_ok: '`time query daytime` answered throughout the measurement',
        time_advances: 'The day time advances while the bot is online',
        stayed_online: 'The bot stayed connected for the whole measurement',
    },
    defaults: {
        bot: 'FRCFLD',
        dataRoot: '',
        durationMs: 45 * 60 * MS,  // about one RotN day-night cycle (rotn-progression.md: about 40 min)
        sampleMs: 60 * MS,
        minParsedShare: 0.9,
        loginTimeoutMs: 240 * MS,
        settleMs: 10 * MS,
        pollMs: 5 * MS,
        logTail: 40000,
        consoleWaitS: 1,
    },
    gateParams: {},

    async run(ctx) {
        const { server, clock, params: p } = ctx;
        const name = p.bot;
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);
        ctx.note('gamerule', server.console('gamerule doDaylightCycle', p.consoleWaitS).slice(-1));

        const start = clock.now();
        const samples = [];
        let dropped = null;
        while (clock.now() - start < p.durationMs) {
            const daytime = timeQuery(server.console('time query daytime', p.consoleWaitS));
            samples.push({ s: Math.round((clock.now() - start) / MS), daytime });
            const gone = s.events().find(s.gone);
            if (gone) { dropped = gone; break; }
            await clock.sleep(p.sampleMs);
        }
        const summary = dayCycleSummary(samples);
        ctx.note('cycle', summary);
        ctx.note('samples', samples);
        const parsedShare = samples.length ? summary.parsed / samples.length : 0;
        ctx.check('samples_ok', parsedShare >= p.minParsedShare, `${summary.parsed}/${samples.length} queries answered`);
        ctx.check('time_advances', summary.ticksPerMinute > 0,
            summary.ticksPerMinute === null ? 'no rate (fewer than 2 answers)'
                : `${summary.ticksPerMinute} ticks per minute (vanilla 1200), a day of about ${summary.cycleMinutes} min; ${summary.wraps.length} wrap(s)`);
        ctx.check('stayed_online', !dropped, dropped ? `${dropped.type} at ${dropped.time}: ${dropped.reason ?? ''}` : 'connected throughout');
    },
};
