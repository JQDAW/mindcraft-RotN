// G1 (docs/PLAN.md): the bot logs in online, stays 10 minutes, chats and walks.
// One bot session covers all four checks. Every verdict comes from the server's own log and
// console replies, not from the bot's claims. The bot driver must follow test/runner/DRIVER.md.
//
// Steps
//   1. Write a marker to the server log (`say`), then start the driver.
//   2. login_online: the server logs "NAME joined the game", and "UUID of player NAME is U" with a
//      version-4 UUID (Mojang account; an offline-mode login would get a version-3 UUID).
//      Any kick is recorded and classified (fml-spec.md section 4).
//   3. chat_send: the server logs "<NAME> HELLO", where HELLO is a nonce the runner gave the driver.
//   4. chat_receive: the console whispers "scenario-echo TOKEN"; the server logs "<NAME> echo TOKEN".
//   5. walk: `tp NAME ~ ~ ~` (moves nothing, prints the position) before and after the console
//      whispers "scenario-walk N"; the horizontal distance must be at least minWalkBlocks.
//   6. stay_10min: at join + 10 min, `list` shows NAME, the log shows no disconnect for NAME since
//      the join, and the driver process is still running.
import { linesAfter, loginUuid, uuidVersion, playerEvents, chatLines, onlinePlayers, lastTeleport, horizontal, classifyKick } from '../../runner/lib/server-log.mjs';

const MS = 1000;

export default {
    id: 'g1-login-chat-walk',
    gate: 'G1',
    title: 'Bot logs in online, chats, walks and stays 10 minutes',
    checks: {
        login_online: 'Starting the service makes the bot log in with its own account',
        chat_send: 'It answers in chat',
        chat_receive: 'It answers in chat',
        walk: 'It follows a player, comes when called (movement)',
        stay_10min: 'Starting the service makes the bot log in (stays connected)',
    },
    defaults: {
        bot: 'FRCFLD',
        loginTimeoutMs: 240 * MS,   // a Forge handshake with ~346 mods plus the Microsoft login
        chatTimeoutMs: 60 * MS,
        walkTimeoutMs: 90 * MS,
        walkBlocks: 8,
        minWalkBlocks: 3,
        stayMs: 600 * MS,
        pollMs: 5 * MS,
        logTail: 20000,
        consoleWaitS: 3,
    },

    async run(ctx) {
        const { server, bot, clock, params: p, runId } = ctx;
        const name = p.bot;
        const marker = `scenario-${runId}-begin`;
        const hello = `hello-${runId}`;
        const token = `tok-${runId}`;

        server.console(`say ${marker}`, 1);
        const sinceMarker = () => linesAfter(server.log(p.logTail), marker);
        const events = () => playerEvents(sinceMarker(), name);
        const gone = (e) => ['lost', 'left', 'kicked'].includes(e.type);

        bot.start({ ROTN_SCENARIO_BOT: name, ROTN_SCENARIO_HELLO: hello, ROTN_SCENARIO_RUN: runId });

        // 2. login
        const first = await ctx.waitFor(() => events().find((e) => e.type === 'joined' || gone(e))
            || (!bot.alive() && { type: 'exited' }), p.loginTimeoutMs);
        const joinedAt = clock.now();
        const uuid = loginUuid(sinceMarker(), name);
        const kicks = events().filter(gone).map((e) => ({ ...e, class: classifyKick(e.reason) }));
        ctx.note('kicks', kicks);
        ctx.note('uuidVersion', uuidVersion(uuid));
        if (first?.type !== 'joined') {
            const why = first?.type === 'exited' ? `driver exited with code ${bot.exitCode()} before joining`
                : first ? `${first.type}: ${first.reason ?? ''} (${classifyKick(first.reason)})` : `no join within ${p.loginTimeoutMs / MS}s`;
            ctx.check('login_online', false, why);
            return;
        }
        const online = uuidVersion(uuid) === 4;
        ctx.check('login_online', online, `${name} joined; UUID ${uuid ?? 'not logged'} (version ${uuidVersion(uuid) ?? '?'}${online ? ', Mojang account' : ', NOT an online-mode login'})`);

        // 3. chat out
        const said = await ctx.waitFor(() => chatLines(sinceMarker(), name).find((c) => c.text.trim() === hello), p.chatTimeoutMs);
        ctx.check('chat_send', said, said ? `server logged <${name}> ${hello}` : `no "<${name}> ${hello}" within ${p.chatTimeoutMs / MS}s`);

        // 4. chat in, proven by the echo
        server.console(`tell ${name} scenario-echo ${token}`, 1);
        const echoed = await ctx.waitFor(() => chatLines(sinceMarker(), name).find((c) => c.text.trim() === `echo ${token}`), p.chatTimeoutMs);
        ctx.check('chat_receive', echoed, echoed ? `whispered token echoed: <${name}> echo ${token}` : `no "<${name}> echo ${token}" within ${p.chatTimeoutMs / MS}s`);

        // 5. walk
        const a = lastTeleport(server.console(`tp ${name} ~ ~ ~`, p.consoleWaitS), name);
        server.console(`tell ${name} scenario-walk ${p.walkBlocks}`, 1);
        const walked = await ctx.waitFor(() => chatLines(sinceMarker(), name).find((c) => /^walked\b/.test(c.text.trim())), p.walkTimeoutMs);
        const b = lastTeleport(server.console(`tp ${name} ~ ~ ~`, p.consoleWaitS), name);
        const d = a && b ? horizontal(a, b) : null;
        ctx.note('walk', { before: a, after: b, distance: d, botReport: walked?.text ?? null });
        ctx.check('walk', d !== null && d >= p.minWalkBlocks,
            d === null ? `no position from "tp ${name} ~ ~ ~" (before ${JSON.stringify(a)}, after ${JSON.stringify(b)})`
                : `moved ${d.toFixed(1)} blocks horizontally (min ${p.minWalkBlocks}); bot said "${walked?.text ?? 'nothing'}"`);

        // 6. stay connected until join + stayMs
        const left = joinedAt + p.stayMs - clock.now();
        if (left > 0) {
            // Stop early if the bot drops; the check below then reports why.
            await ctx.waitFor(() => events().some(gone) || !bot.alive(), left, Math.max(p.pollMs, 30 * MS));
            const rest = joinedAt + p.stayMs - clock.now();
            if (rest > 0 && !events().some(gone) && bot.alive()) await clock.sleep(rest);
        }
        const players = onlinePlayers(server.console('list', p.consoleWaitS)) ?? [];
        const drops = events().filter(gone).map((e) => ({ ...e, class: classifyKick(e.reason) }));
        ctx.note('kicks', drops);
        const stayedS = Math.round((clock.now() - joinedAt) / MS);
        const ok = players.includes(name) && drops.length === 0 && bot.alive() && stayedS >= p.stayMs / MS;
        ctx.check('stay_10min', ok, ok ? `still online after ${stayedS}s, no disconnects`
            : `after ${stayedS}s: list=[${players.join(', ')}], disconnects=${JSON.stringify(drops.map((e) => `${e.type}: ${e.reason ?? ''} (${e.class})`))}, driver ${bot.alive() ? 'running' : `exited ${bot.exitCode()}`}`);
    },
};
