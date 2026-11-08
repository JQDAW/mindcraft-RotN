// The start of a scenario that needs a logged-in bot: write a marker to the server log, confirm it,
// start the driver and wait for the join. G2 scenarios use it; G1 keeps its own copy of the same
// steps (it was gate evidence as it is).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linesAfter, loginUuid, uuidVersion, playerEvents, classifyKick } from './server-log.mjs';
import { agentNaming } from './g2.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MS = 1000;
const MARKER_TRIES = 3;
const RETRY_DELAY_MS = 10 * MS;

/**
 * The one transient login failure the runner retries (lead decision on #71, after G2 batch 2):
 * minecraft-protocol's "Failed to obtain profile data for NAME, does the account own minecraft?",
 * thrown when prismarine-auth's profile fetch failed for any reason (it swallows the cause). Matched
 * exactly, as the driver prints it (the thrown Error, or its DRIVER error event).
 */
export function isProfileFetchFailure(lines, name) {
    const msg = `Failed to obtain profile data for ${name}, does the account own minecraft?`;
    return lines.some((l) => {
        if (l === `Error: ${msg}`) return true;
        if (!l.startsWith('DRIVER ')) return false;
        try {
            const e = JSON.parse(l.slice(7));
            return e?.type === 'error' && e.message === msg;
        } catch {
            return false;
        }
    });
}

/**
 * startSession(ctx, {name, env, naming, checkNaming}) -> {ok, why, sinceMarker, events, gone, joinedAt, uuidVersion, naming}
 * naming: a precomputed agentNaming() result (the items scenario needs it before the login), else computed here.
 * checkNaming false (P1, which names nothing): no naming check and no child process; notes.naming says so.
 * Throws if the marker never lands (before the driver is started). ok=false with a reason when the
 * bot did not join with an online-mode (version-4) UUID; the caller records that as its login check.
 */
export async function startSession(ctx, { name, env = {}, naming = null, checkNaming = true }) {
    const { server, bot, clock, params: p, runId } = ctx;
    const marker = `scenario-${runId}-begin`;
    const markerSeen = (lines) => lines.some((l) => l.includes(marker));
    let markerOk = false;
    for (let i = 0; i < MARKER_TRIES && !markerOk; i++) {
        if (i) await clock.sleep(p.consoleWaitS * MS);
        markerOk = markerSeen(server.console(`say ${marker}`, 1)) || markerSeen(server.log(p.logTail));
    }
    if (!markerOk) throw new Error(`the scenario marker never appeared in the server log after ${MARKER_TRIES} 'say' attempts`);
    // The server rolls logs/latest.log over at 00:00 UTC (log4j; round 3 batch B lost its marker that way). Once
    // the marker is no longer in latest.log, read the newest rolled-over file plus latest.log (server.logRotated),
    // and record which files each such window read (notes.logWindow: one entry per distinct set of files).
    const windows = [];
    const t0 = clock.now();
    const sinceMarker = () => {
        let lines = linesAfter(server.log(p.logTail), marker);
        if (lines === null && typeof server.logRotated === 'function') {
            const r = server.logRotated(p.logTail);
            lines = linesAfter(r.lines, marker);
            const files = r.files.join(',');
            if (!windows.some((w) => w.files === files)) {
                windows.push({ files, markerFound: lines !== null, sessionMin: Math.round(((clock.now() - t0) / 60000) * 10) / 10 });
                ctx.note('logWindow', windows);
            }
            if (lines === null) throw new Error(`scenario marker not in the last ${p.logTail} log lines of ${files || 'the server logs'} (latest.log was rolled over); raise logTail`);
        }
        if (lines === null) throw new Error(`scenario marker not in the last ${p.logTail} log lines; raise logTail`);
        return lines;
    };
    const events = () => playerEvents(sinceMarker(), name);
    const gone = (e) => ['lost', 'left', 'kicked'].includes(e.type);
    // The world the evidence is about (PR #36 review finding 5). 1.12 prints "Seed: N" (later versions "Seed: [N]").
    const seedLine = server.console('seed', p.consoleWaitS).map((l) => /Seed: \[?(-?\d+)\]?\s*$/.exec(l)).find(Boolean);
    ctx.note('worldSeed', seedLine ? seedLine[1] : null);
    // G1 is deliberately exempt from the seed check: g1-login-chat-walk does not use startSession and
    // has no worldSeed parameter, because logging in, chatting and walking do not depend on the world.
    // Only scenarios that declare worldSeed (the G2 ones) are held to the planned world.
    if (!seedLine) ctx.notGate('no world seed from the console "seed" command: the seed is part of the G2 evidence');
    else if (p.worldSeed !== undefined && seedLine[1] !== String(p.worldSeed)) {
        // World coverage is fixed (lead, after G2 batch 5): a G2 gate run uses the planned world.
        ctx.notGate(`the world seed is ${seedLine[1]}, not the planned ${p.worldSeed} (create the server with deploy/test-server.sh run --seed ${p.worldSeed})`);
    }
    // G2 is about the agent's own naming API (mcdata.js toNew/toOld): no run counts until a child
    // process finds it and the full table round-trips through it.
    // A scenario that names nothing (P1) skips the check and its child process (checkNaming: false).
    const agent = checkNaming ? naming ?? agentNaming(p.dataRoot || REPO) : null;
    if (agent) {
        ctx.note('naming', { wired: agent.wired, why: agent.why, entries: agent.entries, failureCount: agent.failureCount });
        if (!agent.wired) ctx.notGate(`mcdata.js not wired to rotn-data: ${agent.why}`);
    } else ctx.note('naming', { checked: false, why: 'this scenario names nothing' });

    const output = () => (typeof bot.output === 'function' ? bot.output() : []);
    const attempt = async () => {
        const from = output().length;
        bot.start({ ROTN_SCENARIO_BOT: name, ROTN_SCENARIO_RUN: runId, ...env });
        const ev = await ctx.waitFor(() => events().find((e) => e.type === 'joined' || gone(e))
            || (!bot.alive() && { type: 'exited' }), p.loginTimeoutMs);
        let last = ev;
        if (ev?.type === 'exited') {
            await clock.sleep(MS);   // a child's last stderr can arrive after its 'exit'
            // ... and so can the server's join or kick line: if one is there now, that is what happened
            // (PR #73 review 3), and it is not a "before joining" failure.
            last = events().find((e) => e.type === 'joined' || gone(e)) ?? ev;
        }
        return { ev: last, lines: output().slice(from) };
    };
    // One retry, only for the profile-fetch failure, only if the driver exited before any join or kick
    // (lead, #71). login_online still needs a real join; any other failure, or a second one, is a FAIL.
    // Never for the CX23 service (#371 review): systemd's Restart= covers it, and a start is never sent twice.
    const service = bot.kind === 'service';
    let { ev: first, lines } = await attempt();
    const retry = { retried: false };
    if (!service && first?.type === 'exited' && isProfileFetchFailure(lines, name)) {
        Object.assign(retry, { retried: true, at: new Date().toISOString(), reason: 'profile fetch failed before joining (minecraft-protocol: "Failed to obtain profile data")',
            firstExitCode: bot.exitCode(), delayMs: RETRY_DELAY_MS });
        await clock.sleep(RETRY_DELAY_MS);
        ({ ev: first, lines } = await attempt());
        retry.secondAttempt = first?.type === 'joined' ? 'joined' : first?.type === 'exited' && isProfileFetchFailure(lines, name)
            ? 'the same profile-fetch failure' : (first?.type ?? 'no join');
    }
    ctx.note('loginRetry', retry);
    const joinedAt = clock.now();
    const uuid = loginUuid(sinceMarker(), name);
    ctx.note('kicks', events().filter(gone).map((e) => ({ ...e, class: classifyKick(e.reason) })));
    ctx.note('uuidVersion', uuidVersion(uuid));
    const base = { sinceMarker, events, gone, joinedAt, uuidVersion: uuidVersion(uuid), naming: agent };
    if (first?.type !== 'joined') {
        const stopped = service
            ? `the service was not up before joining (unit ${bot.unitState?.() ?? 'state unknown'}${bot.startError ? `; ${bot.startError}` : ''})`
            : `driver exited with code ${bot.exitCode()} before joining`;
        const why = first?.type === 'exited' ? stopped
            : first ? `${first.type}: ${first.reason ?? ''} (${classifyKick(first.reason)})` : `no join within ${p.loginTimeoutMs / MS}s`;
        return { ...base, ok: false, why: retry.retried ? `${why} (after one login retry for a profile-fetch failure)` : why };
    }
    const online = uuidVersion(uuid) === 4;
    return { ...base, ok: online, why: `${name} joined; UUID ${uuid ?? 'not logged'} (version ${uuidVersion(uuid) ?? '?'}${online ? ', Mojang account' : ', NOT an online-mode login'})`
        + `${retry.retried ? ' after one login retry (profile-fetch failure)' : ''}` };
}
