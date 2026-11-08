// G4 #12, ready-to-try: "A second bot profile starts and logs in through the template unit with no code change (smoke)."
// test/scenarios/g4/PLAN.md item 12. Set-up S only: the CX23 service through the adapter (run.mjs --service <unit>,
// lib/service.mjs) with a SECOND unit name, mindcraft-rotn@<unit>. `bootstrap.sh add-bot <unit>`, its env file (key,
// host, profile) and the account's first device-code login are the human's (NEEDS-HUMAN); a second Minecraft account is
// needed, because the profile name must equal the account name and one account cannot be online twice. The scenario only
// starts that unit, checks the join, and stops it.
//
// Its own GO marker (lead, queued after #394): besides the adapter's ROTN_SERVICE_GO, the run's environment must have
// ROTN_SECOND_BOT_GO=<GO id>:<unit>, naming exactly this run's second unit. Without it, or naming another unit, or when
// the service is the first bot (firstBot, frcfld), nothing is started. On a spawned driver (set-up T) there is no
// template unit: every check is "not reached" and nothing starts.
//
// Checks (S):
//   second_bot_go  the marker names this unit, which is not the first bot
//   login_online   the unit was inactive; started through the ctl, the account `bot` (the parameter; case aside equal to
//                  the unit name's account, the human's) joins with an online (version-4) UUID within loginTimeoutMs
//   own_profile    the running agent is this bot: its "[state] <bot> at start: ..." line (#386) names `bot`, so the
//                  template unit and the env file chose its own profile (no code change). The values are noted.
//   stays_up       online and the unit active for stayS after the join (no kick, no exit)
//   stopped        the ctl's stop: the adapter sees the unit inactive, and the server log shows the bot left
// Notes: the GO id, the [settings] line's production check (#385), the metrics before and after.
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED } from '../../runner/lib/g2.mjs';
import { exitedText } from '../../runner/lib/service.mjs';
import { STATE_LOOSE_RE, missingLine, productionGiversAtStart } from '../../runner/lib/start-lines.mjs';

const MS = 1000;
const MIN = 60 * MS;
export const SECOND_BOT_GO_ENV = 'ROTN_SECOND_BOT_GO';
/** <GO id>:<unit>, the unit as the ctl names it (lowercase letters, digits, '-'). */
export const SECOND_BOT_GO_RE = /^([A-Za-z0-9][A-Za-z0-9._-]{2,63}):([a-z0-9][a-z0-9-]{0,31})$/;

/** The second bot's GO marker for this unit: {ok, goId} or {ok: false, why}. */
export function secondBotGo(env, unit) {
    const raw = env?.[SECOND_BOT_GO_ENV];
    if (!raw) return { ok: false, why: `no ${SECOND_BOT_GO_ENV} in the run's environment (set only under the lead's written GO for this bot: <GO id>:<unit>)` };
    const m = SECOND_BOT_GO_RE.exec(String(raw));
    if (!m) return { ok: false, why: `${SECOND_BOT_GO_ENV} is not <GO id>:<unit>` };
    if (m[2] !== String(unit)) return { ok: false, why: `${SECOND_BOT_GO_ENV} names ${m[2]}, not this run's unit ${unit}` };
    return { ok: true, goId: m[1] };
}

/** The "[state] <name> at start: ..." lines (#386): the names, and whether one is `bot` (case aside). */
export function stateNames(lines, bot) {
    const found = lines.map((l) => STATE_LOOSE_RE.exec(l)).filter(Boolean).map((m) => ({ name: m[1], rest: m[2] }));
    return { found, own: found.find((x) => x.name.toLowerCase() === String(bot).toLowerCase()) ?? null };
}

export default {
    id: 'g4-second-bot',
    gate: 'G4',
    // On S the bot's calls go to the CX23's own key (lead, #389): no runner accounting.
    llm: false,
    title: 'A second bot profile starts through the template unit (the ctl), logs in with its own account and stops, with no code change (smoke)',
    checks: {
        second_bot_go: 'The run has its own GO marker naming this second bot\'s unit, which is not the first bot',
        login_online: 'Started through the template unit, the second bot logs in with its own account (online mode)',
        own_profile: 'The running agent is the second bot\'s own profile (its [state] line names it): no code change',
        stays_up: 'It stays online for a while after the join',
        stopped: 'The ctl\'s stop ends it: the unit is inactive and the bot left the game',
    },
    defaults: {
        bot: '',
        firstBot: 'frcfld',
        worldSeed: G2_WORLD_SEED,
        stayS: 60,
        leaveWaitS: 30,
        loginTimeoutMs: 240 * MS,
        pollMs: 5 * MS,
        logTail: 20000,
        consoleWaitS: 1,
    },
    gateParams: { stayS: 'equal' },
    // The login, the stay, the stop (the adapter waits for inactive) and the leave line.
    runMinutes: (p) => p.loginTimeoutMs / MIN + p.stayS / 60 + 2 + p.leaveWaitS / 60,

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const after = ['login_online', 'own_profile', 'stays_up', 'stopped'];
        const notReached = (keys, why) => { for (const k of keys) ctx.check(k, false, `not reached: ${why}`); };
        if (bot.kind !== 'service') {
            ctx.notGate('not the CX23 service (set-up T): the second bot needs the template unit');
            notReached(['second_bot_go', ...after], 'S only: the template unit through the ctl (PLAN #12); nothing started');
            return;
        }
        const unit = String(bot.bot);
        const name = String(p.bot ?? '');

        // second_bot_go: the parameter, not the first bot, and the marker naming this unit. Nothing starts without it.
        const why = !/^[A-Za-z0-9_]{3,16}$/.test(name) ? `no valid bot parameter (the second account's name, e.g. --param bot=<name>): '${name}'`
            : unit.toLowerCase() === String(p.firstBot).toLowerCase() ? `the service is the first bot (${unit}), not a second one`
                : null;
        const go = why ? { ok: false, why } : secondBotGo(ctx.env, unit);
        ctx.check('second_bot_go', go.ok, go.ok ? `GO ${go.goId} names ${unit}` : go.why);
        if (!go.ok) { notReached(after, 'no GO marker for this second bot; nothing started'); return; }
        ctx.note('secondBotGo', { goId: go.goId, unit, bot: name });

        // login_online: from an inactive unit
        const m0 = await bot.metrics();
        ctx.note('metricsBefore', m0);
        if (m0?.ActiveState !== 'inactive' && m0?.ActiveState !== 'failed') {
            ctx.check('login_online', false, `the unit ${unit} is ${m0?.ActiveState ?? 'unknown'} before the start: stop it first`);
            notReached(after.slice(1), 'the unit was not inactive at the start');
            return;
        }
        const s = await startSession(ctx, { name, checkNaming: false });
        ctx.check('login_online', s.ok, s.ok ? `${s.why ?? 'joined'} (unit ${unit})` : s.why);
        if (!s.ok) { notReached(after.slice(1), 'the bot did not log in'); return; }
        const gone = () => s.events().find(s.gone)?.type ?? (!bot.alive() && bot.unitState?.() !== 'unknown' ? exitedText(bot) : null);

        // own_profile: the agent's [state] line names this bot
        if (typeof bot.refresh === 'function') await bot.refresh().catch(() => {});
        const out = bot.output();
        ctx.note('settings', productionGiversAtStart(out).detail);
        const st = stateNames(out, name);
        ctx.note('stateLines', st.found.slice(0, 3));
        ctx.check('own_profile', Boolean(st.own), st.own ? `[state] ${st.own.name} at start: ${st.own.rest}`
            : st.found.length ? `the [state] line names ${st.found[0].name}, not ${name}` : missingLine(`[state] ${name} at start: ...`));

        // stays_up
        const t0 = clock.now();
        const left = await ctx.waitFor(() => gone(), p.stayS * MS, p.pollMs);
        ctx.check('stays_up', !left, left ? `gone ${Math.round((clock.now() - t0) / MS)} s after the join: ${left}` : `online for ${p.stayS} s after the join`);

        // stopped: the ctl's stop (the adapter waits for inactive), then the leave line
        if (left) { notReached(['stopped'], 'the bot was already gone'); return; }
        let stopError = null;
        try { await bot.stop(); } catch (e) { stopError = String(e?.message ?? e); }
        const m1 = await bot.metrics().catch((e) => ({ error: String(e?.message ?? e) }));
        ctx.note('metricsAfter', m1);
        const leftLine = await ctx.waitFor(() => s.events().find((e) => e.type === 'left') ?? null, p.leaveWaitS * MS, p.pollMs);
        const bits = [stopError && `the ctl's stop failed: ${stopError}`, m1?.ActiveState !== 'inactive' && `the unit is ${m1?.ActiveState ?? m1?.error ?? 'unknown'} after the stop`,
            !leftLine && `no "${name} left the game" within ${p.leaveWaitS} s of the stop`].filter(Boolean);
        ctx.check('stopped', bits.length === 0, bits.length ? bits.join('; ') : `the unit is inactive and ${name} left the game`);
    },
};
