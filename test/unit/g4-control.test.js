// Offline tests for G4 #3, test/scenarios/g4/g4-control-commands.mjs. A simulated 1.12 test server (chat, `say`, testfor,
// `execute <p> ~ ~ ~ testfor @a[name=<bot>,r=N]`, the movement scoreboards, the console `tell`), a scripted trusted
// player who reacts to the scenario's in-game prompts, and a simulated bot (the CX23 service, or a driver for T) that
// answers, comes, follows and stops. Players move along one axis, a second at a time. No server, no ssh, no LLM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { consoleAllowFor, guardConsole } from '../runner/lib/g3.mjs';
import control, { HOLD_REPLY, PROMPT_TAG, answerLine, giversAtStart, isCommandText, journalResponse, promptIndex } from '../scenarios/g4/g4-control-commands.mjs';

const NAME = 'FRCFLD';
const GIVER = 'JQDAW';
const S = 1000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;

/**
 * opt.driver (set-up T; opt.giverOff: its console giver off); opt.unitActive; opt.unitBot;
 * the release: opt.givers (the [settings] task_givers, default ["JQDAW"]); opt.noSettings;
 * the server: opt.executeSilent (no reply to execute); opt.giverJoinsAt (seconds; default online);
 * the player: opt.noQuestion, opt.giverStaysNear, opt.comeSaid, opt.giverWalksDuringCome, opt.giverIdleFollow,
 *   opt.stopSaid, opt.noStop;
 * the bot: opt.noAnswer, opt.answerOnlyJournal, opt.chatterOnly, opt.noCome, opt.noFollow, opt.ignoresStop,
 *   opt.noHoldReply, opt.agendaIdle.
 */
function sim(opt = {}) {
    let t = 0;
    let simT = 0;
    const log = [];
    const sent = [];
    const output = [];
    const pending = [];
    const unit = { state: opt.unitActive ? 'active' : 'inactive' };
    const at = (ms, fn) => pending.push([ms, fn]);
    const add = (msg) => log.push(line(t, msg));
    const botSay = (msg) => add(`<${NAME}> ${msg}`);
    const giverSay = (msg) => {
        add(`<${GIVER}> ${msg}`);
        hear(msg);
    };
    const pos = { [NAME]: 0, [GIVER]: 5 };
    const walkCm = { [NAME]: 0, [GIVER]: 0 };
    const on = { [NAME]: false, [GIVER]: opt.giverJoinsAt === undefined };
    let giverVel = null;          // {v (blocks/s, + is away from the start), until}
    let mode = 'agenda';
    const move = (who, d) => { pos[who] += d; walkCm[who] += Math.round(Math.abs(d) * 100); };
    const physics = () => {
        if (giverVel && simT <= giverVel.until && on[GIVER]) move(GIVER, giverVel.v);
        if (!on[NAME]) return;
        const towards = (close) => { const d = pos[GIVER] - pos[NAME]; if (Math.abs(d) > close) move(NAME, Math.sign(d) * Math.min(4, Math.abs(d) - close)); };
        if (mode === 'agenda' && !opt.agendaIdle) move(NAME, -0.5);
        else if (mode === 'come') towards(2);
        else if (mode === 'follow') towards(3);
    };
    const advance = () => {
        for (;;) {
            pending.sort((a, b) => a[0] - b[0]);
            if (pending.length && pending[0][0] <= simT) { pending.shift()[1](); continue; }
            if (simT + S > t) break;
            simT += S;
            physics();
        }
    };
    // The bot hears the giver (S: a task giver; typed commands run directly and are echoed, as agent.js does).
    const hear = (msg) => {
        if (!on[NAME]) return;
        let m;
        if ((m = /^!(\w+)/.exec(msg))) {
            const cmd = m[1];
            if (!(cmd === 'stop' && opt.noHoldReply)) botSay(`*${GIVER} used ${cmd}*`);
            if (cmd === 'goToPlayer' && !opt.noCome) mode = 'come';
            if (cmd === 'followPlayer') mode = opt.noFollow ? 'still' : 'follow';
            if (cmd === 'stop') { if (!opt.noHoldReply) botSay(HOLD_REPLY); mode = opt.ignoresStop ? 'follow' : 'still'; }
            if (cmd === 'resume') mode = 'agenda';
            return;
        }
        if (/come here/.test(msg)) { if (!opt.noCome) mode = 'come'; return; }
        if (/\bstop\b/.test(msg)) { mode = opt.ignoresStop ? 'follow' : 'still'; return; }
        if (opt.chatterOnly) { at(t + 4 * S, () => botSay('agenda step logs started: logs')); return; }
        if (opt.noAnswer) return;
        output.push(`${NAME} received message from ${GIVER} : ${msg}`);
        at(t + 4 * S, () => {
            output.push(`${NAME} full response to ${GIVER}: ""I am gathering logs for my tools. !collectBlocks("oak_log", 4)""`);
            if (!opt.answerOnlyJournal) botSay('I am gathering logs for my tools.');
        });
    };
    // The player reads the prompts in chat and does what they say (or not, per opt).
    const prompted = (text) => {
        if (/please join/.test(text) && opt.giverJoinsAt !== undefined) return;
        if (/^1\/4 answer/.test(text) && !opt.noQuestion) at(t + 10 * S, () => giverSay(`${NAME}, what are you doing?`));
        if (/^2\/4 come: walk/.test(text) && !opt.giverStaysNear) giverVel = { v: 4, until: t + 10 * S };
        if (/^2\/4 come: now call/.test(text)) {
            at(t + 5 * S, () => {
                giverSay(opt.comeSaid ? `${NAME}, come here` : `!goToPlayer("${GIVER}", 2)`);
                giverVel = opt.giverWalksDuringCome ? { v: 3, until: t + 60 * S } : null;
            });
        }
        if (/^3\/4 follow/.test(text)) {
            at(t + 5 * S, () => { giverSay(`!followPlayer("${GIVER}", 3)`); giverVel = opt.giverIdleFollow ? null : { v: 0.5, until: t + 400 * S }; });
        }
        if (/^4\/4 stop/.test(text) && !opt.noStop) {
            at(t + 3 * S, () => { giverSay(opt.stopSaid ? `${NAME} stop` : '!stop'); giverVel = { v: 0.5, until: t + 60 * S }; });
        }
        if (/^done:/.test(text)) at(t + 3 * S, () => giverSay('!resume'));
    };
    if (opt.giverJoinsAt !== undefined) at(opt.giverJoinsAt * S, () => { on[GIVER] = true; add(`${GIVER} joined the game`); });
    const scores = (p) => [`Showing 3 tracked objective(s) for ${p}:`, `- g4cWalk: ${walkCm[p]} (g4cWalk)`, '- g4cSprint: 0 (g4cSprint)', '- g4cSwim: 0 (g4cSwim)'];
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) { add(`[Server] ${m[1]}`); if (m[1].startsWith(`${PROMPT_TAG} `)) prompted(m[1].slice(PROMPT_TAG.length + 1)); }
            else if ((m = /^testfor @a\[name=(\w+)\]$/.exec(cmd))) add(on[m[1]] ? `Found ${m[1]}` : 'Selector found nothing');
            else if ((m = /^execute (\w+) ~ ~ ~ testfor @a\[name=(\w+),r=(\d+)\]$/.exec(cmd))) {
                if (!opt.executeSilent) add(on[m[1]] && on[m[2]] && Math.abs(pos[m[1]] - pos[m[2]]) <= Number(m[3]) ? `Found ${m[2]}` : `Failed to execute 'testfor @a[name=${m[2]},r=${m[3]}]' as ${m[1]}`);
            } else if ((m = /^scoreboard objectives add (\w+) \S+$/.exec(cmd))) add(`Added new objective '${m[1]}' successfully`);
            else if ((m = /^scoreboard objectives remove (\w+)$/.exec(cmd))) add(`Removed objective '${m[1]}' successfully`);
            else if ((m = /^scoreboard players list (\w+)$/.exec(cmd))) for (const l of scores(m[1])) add(l);
            else if ((m = /^tell (\w+) !(\w+)$/.exec(cmd)) && on[NAME]) {
                if (!(opt.driver && !opt.giverOff)) botSay('Sorry Server, I only run commands from task givers.');
                else {
                    botSay(`*Server used ${m[2]}*`);
                    if (m[2] === 'stop') { botSay(HOLD_REPLY); mode = opt.ignoresStop ? 'agenda' : 'still'; }
                    if (m[2] === 'resume') mode = 'agenda';
                }
            }
            t += waitS * 1000;
            advance();
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(-n); },
    };
    const bot = {
        ...(opt.driver ? {} : { kind: 'service', bot: opt.unitBot ?? 'frcfld', refresh: () => { advance(); return Promise.resolve(); } }),
        start() {
            sent.push('bot start');
            unit.state = 'active';
            if (opt.driver) output.push(`DRIVER ${JSON.stringify({ type: 'mindcraft_start', serverTaskGiver: !opt.giverOff, botState: { fresh: true } })}`);
            else if (!opt.noSettings) output.push(`[settings] effective task_givers=${JSON.stringify(opt.givers ?? [GIVER])} allow_server_task_giver=false`);
            at(t + 20 * S, () => {
                on[NAME] = true;
                log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
                add(`${NAME} joined the game`);
            });
            return Promise.resolve();
        },
        alive: () => unit.state === 'active',
        needsStop: () => unit.state === 'active',
        exitCode: () => null,
        exitSignal: () => null,
        unitState: () => unit.state,
        output: () => { advance(); return output; },
        metrics: () => Promise.resolve({ MemoryCurrent: 1, MemoryPeak: '[not set]', NRestarts: 0, ActiveState: unit.state }),
        stop() { unit.state = 'inactive'; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; advance(); for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent, output, pos };
}
const run = (s, params = {}) => runScenario(control, { ...s, runId: 'r1', params: { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));
const prompts = (sent) => sent.filter((c) => c.startsWith(`say ${PROMPT_TAG} `)).map((c) => c.slice(`say ${PROMPT_TAG} `.length).split(':')[0]);

describe('g4-control-commands: the module, the console list and the helpers', () => {
    test('G4; the checks; runMinutes; the defaults name JQDAW as the giver', () => {
        assert.equal(control.gate, 'G4');
        assert.deepEqual(Object.keys(control.checks), ['login_online', 'chat_answer', 'come', 'follow', 'stop']);
        assert.equal(control.defaults.giver, 'JQDAW');
        const m = control.runMinutes(control.defaults);
        assert.ok(Number.isFinite(m) && m > 20 && m < 60, String(m));
    });

    test('the console: tagged say and the exact-name execute testfor are this scenario\'s alone; anything else is refused', () => {
        const fake = { console: (cmd) => [cmd] };
        const g = guardConsole(fake, consoleAllowFor(control));
        for (const ok of ['say [g4] 1/4 answer: ask FRCFLD a question', 'execute JQDAW ~ ~ ~ testfor @a[name=FRCFLD,r=20]', 'execute FRCFLD ~ ~ ~ testfor @a[name=FRCFLD,r=2]',
            'testfor @a[name=JQDAW]', 'scoreboard players list JQDAW', 'tell FRCFLD !stop']) assert.doesNotThrow(() => g.console(ok), ok);
        for (const bad of ['say hello', 'say [g4] two\nlines', 'execute @a ~ ~ ~ testfor @a[name=FRCFLD,r=2]', 'execute JQDAW ~ ~ ~ kill FRCFLD',
            'execute JQDAW ~ ~ ~ testfor @a[name=JQDAW,r=2]', 'execute Other ~ ~ ~ testfor @a[name=FRCFLD,r=2]', 'execute JQDAW ~ ~ ~ testfor @a[name=FRCFLD,r=2,c=1]', 'tp FRCFLD JQDAW']) {
            assert.throws(() => g.console(bad), /refused/, bad);
        }
        const other = guardConsole(fake, consoleAllowFor({ id: 'g4-restart-persistence' }, control.defaults));
        assert.throws(() => other.console('execute JQDAW ~ ~ ~ testfor @a[name=FRCFLD,r=20]'), /refused/);
        assert.throws(() => other.console('say [g4] x'), /refused/);
    });

    test('helpers: promptIndex, giversAtStart, journalResponse, answerLine, isCommandText', () => {
        const L = [line(0, '[Server] [g4] 1/4 answer: ask'), line(1000, `<${GIVER}> hi`), line(2000, `<${NAME}> Hello there.`), line(3000, '[Server] [g4] 1/4 answer: ask')];
        assert.equal(promptIndex(L, '1/4 answer: ask'), 3);
        assert.equal(promptIndex(L, 'nope'), -1);
        assert.deepEqual(giversAtStart(['x', '[settings] effective task_givers=["JQDAW","Other"] allow_server_task_giver=false']).givers, ['JQDAW', 'Other']);
        assert.match(giversAtStart(['x']).error, /the release prints no \[settings\]/);
        assert.match(giversAtStart(['[settings] effective task_givers=nope allow_server_task_giver=false']).error, /not JSON/);
        const J = [`${NAME} received message from ${GIVER} : hi`, `${NAME} full response to ${GIVER}: ""Hello there. !stats""`];
        assert.equal(journalResponse(J, 'frcfld', GIVER, 'hi'), 'Hello there. !stats');
        assert.equal(journalResponse(J, NAME, GIVER, 'other'), null);
        assert.equal(journalResponse([`${NAME} received message from Other : hi`, J[1]], NAME, GIVER, 'hi'), null);
        assert.equal(answerLine(L, NAME, 1, 'Hello there. !stats').text, 'Hello there.');
        assert.equal(answerLine(L, NAME, 2, 'Hello there.'), null, 'only after the question');
        assert.equal(answerLine(L, NAME, 1, '!stats'), null, 'a command alone is no chat answer');
        assert.deepEqual(['!stop', ' !goToPlayer("x", 2)', 'stop now', 'FRCFLD, come here'].map(isCommandText), [true, true, false, false]);
    });
});

describe('g4-control-commands on S (the CX23 service, a trusted player)', () => {
    test('all well: answer, come, follow and stop pass; the scenario sends no tell, prompts every step, removes its scoreboards', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(control.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(c.chat_answer.detail, `asked "${NAME}, what are you doing?", answered "I am gathering logs for my tools."`);
        assert.match(c.stop.detail, /^"!stop": the bot moved 0 m in 30 s while JQDAW walked \d+(\.\d)? m, with the hold reply$/);
        assert.equal(s.sent.filter((x) => x.startsWith('tell ')).length, 0, 'on S the scenario never gives a command');
        assert.deepEqual(prompts(s.sent), ['1/4 answer', '2/4 come', '2/4 come', '3/4 follow', '4/4 stop', 'done']);
        assert.equal(s.sent.filter((x) => x.startsWith('scoreboard objectives remove ')).length, 3);
        assert.equal(r.notes.resume, '!resume');
        assert.equal(r.notes.executeProbe, true);
        assert.equal(r.notes.follow.typed, true);
    });

    test('chat_answer: no answer, an answer only in the log, or chatter not tied to the question all fail; no question is human timing', async () => {
        assert.match(byName(await run(sim({ noAnswer: true }))).chat_answer.detail, /^no answer to JQDAW in the bot's log within 90 s/);
        assert.match(byName(await run(sim({ answerOnlyJournal: true }))).chat_answer.detail, /^the bot's log has a response, but no chat line of it/);
        const chatter = byName(await run(sim({ chatterOnly: true })));
        assert.equal(chatter.chat_answer.pass, false, 'an agenda line is no answer');
        const idle = byName(await run(sim({ noQuestion: true })));
        assert.match(idle.chat_answer.detail, /^not reached: the giver gave no question within 3 min \(human timing/);
        assert.equal(idle.come.pass, true, 'the next steps still run');
    });

    test('come: the bot never comes fails; the giver never walked away, or walked during the come, is not reached (human timing); said in words also counts', async () => {
        assert.match(byName(await run(sim({ noCome: true }))).come.detail, /^not within 4 blocks of JQDAW 2 min after "!goToPlayer\("JQDAW", 2\)"$/);
        assert.match(byName(await run(sim({ giverStaysNear: true, agendaIdle: true }))).come.detail, /^not reached: JQDAW was still within 20 blocks/);
        const walked = await run(sim({ giverWalksDuringCome: true }));
        assert.match(byName(walked).come.detail, /^not reached: JQDAW moved \d+(\.\d)? m while waiting/, JSON.stringify(walked.notes.come));
        const said = await run(sim({ comeSaid: true }));
        assert.equal(byName(said).come.pass, true);
        assert.equal(said.notes.come.typed, false);
    });

    test('follow: a bot that stays fails; a giver who does not walk is not reached; then stop is not reached either (nothing moving)', async () => {
        const c = byName(await run(sim({ noFollow: true })));
        assert.equal(c.follow.pass, false);
        assert.match(c.follow.detail, /^within 8 blocks at 0% of \d+ polls/);
        assert.match(c.stop.detail, /^not reached: the bot was not moving just before the stop/);
        assert.match(byName(await run(sim({ giverIdleFollow: true }))).follow.detail, /^not reached: JQDAW walked only 0 m \(need 20\)/);
    });

    test('stop: a bot that keeps following fails; a typed !stop with no hold reply fails; "stop" said in words passes with no hold; no stop is human timing', async () => {
        const keeps = byName(await run(sim({ ignoresStop: true })));
        assert.equal(keeps.stop.pass, false);
        assert.match(keeps.stop.detail, /^the bot moved \d+(\.\d)? m in the 30 s after the stop \(at most 2\)/);
        assert.match(byName(await run(sim({ noHoldReply: true }))).stop.detail, /^no "stopped; on hold until a task giver types !resume" reply to the typed !stop$/);
        const said = byName(await run(sim({ stopSaid: true })));
        assert.equal(said.stop.pass, true, said.stop.detail);
        assert.match(said.stop.detail, /\(said, not typed: no hold\)$/);
        assert.match(byName(await run(sim({ noStop: true }))).stop.detail, /^not reached: the giver gave no !stop within 3 min/);
    });

    test('the giver: not a task giver in the release, no [settings] line, never online: every step is not reached; a late join is fine', async () => {
        const notGiver = byName(await run(sim({ givers: ['Other'] })));
        for (const k of ['chat_answer', 'come', 'follow', 'stop']) assert.equal(notGiver[k].detail, 'not reached: JQDAW is not a task giver in this release (task_givers ["Other"])', k);
        assert.match(byName(await run(sim({ noSettings: true }))).come.detail, /^not reached: the release prints no \[settings\] effective task_givers=\.\.\. allow_server_task_giver=\.\.\. line \(setup gap\?\)$/);
        assert.match(byName(await run(sim({ giverJoinsAt: 10000 }))).follow.detail, /^not reached: JQDAW was not online within 3 min/);
        const late = byName(await run(sim({ giverJoinsAt: 90 })));
        for (const k of ['chat_answer', 'come', 'follow', 'stop']) assert.equal(late[k].pass, true, `${k}: ${late[k].detail}`);
    });

    test('the server does not answer the execute probe: distances cannot be read, every step is not reached', async () => {
        const r = await run(sim({ executeSilent: true }));
        assert.match(byName(r).come.detail, /^not reached: the server did not answer "Found" to the execute probe/);
        assert.equal(r.notes.executeProbe, false);
    });

    test('S guards: another bot\'s unit, or a running unit: login_online fails and nothing starts', async () => {
        const a = sim({ unitBot: 'otherbot' });
        assert.equal(byName(await run(a)).login_online.detail, "the service's bot 'otherbot' is not this run's bot 'FRCFLD'");
        assert.ok(!a.sent.includes('bot start'));
        assert.match(byName(await run(sim({ unitActive: true }))).login_online.detail, /^the unit is active before the start/);
    });
});

describe('g4-control-commands on T (a spawned driver): the console giver\'s !stop only', () => {
    test('the rehearsal: stop passes while the agenda moves the bot; answer, come and follow are not reached; tell !stop then !resume; not-gate', async () => {
        const s = sim({ driver: true });
        const r = await run(s);
        const c = byName(r);
        assert.equal(c.stop.pass, true, `${c.stop.detail} ${r.error}`);
        assert.match(c.stop.detail, /^"!stop": the bot moved 0 m in 30 s, with the hold reply$/);
        for (const k of ['chat_answer', 'come', 'follow']) assert.match(c[k].detail, /^not reached: set-up T rehearses !stop only/, k);
        assert.deepEqual(s.sent.filter((x) => x.startsWith('tell ')), [`tell ${NAME} !stop`, `tell ${NAME} !resume`]);
        assert.equal(prompts(s.sent).length, 0, 'no prompts on T');
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.some((w) => /set-up T/.test(w)));
    });

    test('T: a bot that does not stop fails; an idle agenda (nothing moving) or the console giver off is not reached', async () => {
        assert.match(byName(await run(sim({ driver: true, ignoresStop: true }))).stop.detail, /^the bot moved \d+(\.\d)? m in the 30 s after the stop/);
        assert.match(byName(await run(sim({ driver: true, agendaIdle: true }))).stop.detail, /^not reached: the agenda did not move the bot/);
        const off = sim({ driver: true, giverOff: true });
        assert.equal(byName(await run(off)).stop.detail, 'not reached: the T driver\'s console giver is off');
        assert.equal(off.sent.filter((x) => x.startsWith('tell ')).length, 0);
    });
});
