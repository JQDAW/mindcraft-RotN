// The start of a scenario that needs a logged-in bot: write a marker to the server log, confirm it,
// start the driver and wait for the join. G2 scenarios use it; G1 keeps its own copy of the same
// steps (it was gate evidence as it is).
import { linesAfter, loginUuid, uuidVersion, playerEvents, classifyKick } from './server-log.mjs';

const MS = 1000;
const MARKER_TRIES = 3;

/**
 * startSession(ctx, {name, env}) -> {ok, why, sinceMarker, events, joinedAt, uuidVersion}
 * Throws if the marker never lands (before the driver is started). ok=false with a reason when the
 * bot did not join with an online-mode (version-4) UUID; the caller records that as its login check.
 */
export async function startSession(ctx, { name, env = {} }) {
    const { server, bot, clock, params: p, runId } = ctx;
    const marker = `scenario-${runId}-begin`;
    const markerSeen = (lines) => lines.some((l) => l.includes(marker));
    let markerOk = false;
    for (let i = 0; i < MARKER_TRIES && !markerOk; i++) {
        if (i) await clock.sleep(p.consoleWaitS * MS);
        markerOk = markerSeen(server.console(`say ${marker}`, 1)) || markerSeen(server.log(p.logTail));
    }
    if (!markerOk) throw new Error(`the scenario marker never appeared in the server log after ${MARKER_TRIES} 'say' attempts`);
    const sinceMarker = () => {
        const lines = linesAfter(server.log(p.logTail), marker);
        if (lines === null) throw new Error(`scenario marker not in the last ${p.logTail} log lines; raise logTail`);
        return lines;
    };
    const events = () => playerEvents(sinceMarker(), name);
    const gone = (e) => ['lost', 'left', 'kicked'].includes(e.type);
    // The world the evidence is about (PR #36 review finding 5). 1.12 prints "Seed: N" (later versions "Seed: [N]").
    const seedLine = server.console('seed', p.consoleWaitS).map((l) => /Seed: \[?(-?\d+)\]?\s*$/.exec(l)).find(Boolean);
    ctx.note('worldSeed', seedLine ? seedLine[1] : null);

    bot.start({ ROTN_SCENARIO_BOT: name, ROTN_SCENARIO_RUN: runId, ...env });
    const first = await ctx.waitFor(() => events().find((e) => e.type === 'joined' || gone(e))
        || (!bot.alive() && { type: 'exited' }), p.loginTimeoutMs);
    const joinedAt = clock.now();
    const uuid = loginUuid(sinceMarker(), name);
    ctx.note('kicks', events().filter(gone).map((e) => ({ ...e, class: classifyKick(e.reason) })));
    ctx.note('uuidVersion', uuidVersion(uuid));
    const base = { sinceMarker, events, gone, joinedAt, uuidVersion: uuidVersion(uuid) };
    if (first?.type !== 'joined') {
        const why = first?.type === 'exited' ? `driver exited with code ${bot.exitCode()} before joining`
            : first ? `${first.type}: ${first.reason ?? ''} (${classifyKick(first.reason)})` : `no join within ${p.loginTimeoutMs / MS}s`;
        return { ...base, ok: false, why };
    }
    const online = uuidVersion(uuid) === 4;
    return { ...base, ok: online, why: `${name} joined; UUID ${uuid ?? 'not logged'} (version ${uuidVersion(uuid) ?? '?'}${online ? ', Mojang account' : ', NOT an online-mode login'})` };
}
