// Offline tests for G4 #3, test/scenarios/g4/g4-control-commands.mjs. A simulated 1.12 test server (chat, whispers,
// testfor, `execute <bot> ~ ~ ~ testfor @a[name=<p>,r=N]`, the movement scoreboards, op admin echoes), a scripted trusted
// player who reacts to the scenario's whispered prompts, and a simulated bot (the CX23 service, or a driver for T) that
// hears what its client would hear, parsed with mineflayer's own 1.12 chat patterns (copied below and checked against
// node_modules), logs it as agent.js does, and answers, comes, follows and stops. Players move along one axis, a second
// at a time. No server, no ssh, no LLM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { consoleAllowFor, guardConsole } from '../runner/lib/g3.mjs';
import control, { HOLD_REPLY, PROMPT_TAG, REQUESTS, answerLine, chatForms, giverOnlyTells, giversAtStart, heardEchoes, isCommandText, journalResponses, promptIndex } from '../scenarios/g4/g4-control-commands.mjs';

const NAME = 'FRCFLD';
const GIVER = 'JQDAW';
const S = 1000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;

// mineflayer 4.33.0 lib/plugins/chat.js, the patterns it adds for 1.12 (a test below checks these lines are in it).
const MINEFLAYER_SRC = [
    "const USERNAME_REGEX = '(?:\\\\(.{1,15}\\\\)|\\\\[.{1,15}\\\\]|.){0,5}?(\\\\w+)'",
    'const LEGACY_VANILLA_CHAT_REGEX = new RegExp(`^${USERNAME_REGEX}\\\\s?[>:\\\\-»\\\\]\\\\)~]+\\\\s(.*)$`)',
    "bot.addChatPattern('whisper', new RegExp(`^${USERNAME_REGEX} whispers(?: to you)?:? (.*)$`), { deprecated: true })",
    "bot.addChatPattern('whisper', new RegExp(`^\\\\[${USERNAME_REGEX} -> \\\\w+\\\\s?\\\\] (.*)$`), { deprecated: true })",
];
const USERNAME_REGEX = '(?:\\(.{1,15}\\)|\\[.{1,15}\\]|.){0,5}?(\\w+)';
const LEGACY_VANILLA_CHAT_REGEX = new RegExp(`^${USERNAME_REGEX}\\s?[>:\\-»\\]\\)~]+\\s(.*)$`);
const WHISPERS = [new RegExp(`^${USERNAME_REGEX} whispers(?: to you)?:? (.*)$`), new RegExp(`^\\[${USERNAME_REGEX} -> \\w+\\s?\\] (.*)$`)];
/** What the bot's client makes of one message it receives: every pattern that matches fires (mineflayer). */
function mineflayerParse(msg) {
    const out = [];
    for (const re of WHISPERS) { const m = re.exec(msg); if (m) out.push({ type: 'whisper', from: m[1], text: m[2] }); }
    const c = LEGACY_VANILLA_CHAT_REGEX.exec(msg);
    if (c) out.push({ type: 'chat', from: c[1], text: c[2] });
    return out;
}

/**
 * opt.driver (set-up T; opt.giverOff: its console giver off); opt.unitActive; opt.unitBot;
 * the release: opt.givers (task_givers, default ["JQDAW"]); opt.allowServerGiver; opt.noSettings; opt.syntax
 *   (show_command_syntax: full, the default, shortened or none);
 * the server: opt.executeSilent; opt.botIsOp (the console's replies and execute feedback reach the bot as admin echoes);
 *   opt.giverJoinsAt (seconds; default online); opt.throwOn (a console command that throws);
 * the player: opt.noQuestion, opt.chattyGiver (an unrelated line before each request), opt.giverStaysNear,
 *   opt.walksBackBeforeCall, opt.comeSaid, opt.giverWalksDuringCome, opt.wrongFollow, opt.giverIdleFollow, opt.stopSaid,
 *   opt.noStop, opt.stopDelayS;
 * the bot: opt.noAnswer, opt.answerOnlyJournal, opt.chatterOnly, opt.multiLine, opt.twoResponses, opt.noCome,
 *   opt.comeTeleport, opt.noFollow, opt.idleAfterFollow, opt.ignoresStop, opt.noHoldReply, opt.agendaIdle.
 */
function sim(opt = {}) {
    let t = 0;
    let simT = 0;
    const log = [];
    const sent = [];
    const output = [];
    const heard = [];
    const pending = [];
    const unit = { state: opt.unitActive ? 'active' : 'inactive' };
    const syntax = opt.syntax ?? 'full';
    const at = (ms, fn) => pending.push([ms, fn]);
    const add = (msg) => log.push(line(t, msg));
    const pos = { [NAME]: 0, [GIVER]: 5 };
    const walkCm = { [NAME]: 0, [GIVER]: 0 };
    const on = { [NAME]: false, [GIVER]: opt.giverJoinsAt === undefined };
    let giverVel = null;          // {v (blocks/s), until}
    let mode = 'agenda';
    const move = (who, d) => { pos[who] += d; walkCm[who] += Math.round(Math.abs(d) * 100); };
    const physics = () => {
        if (giverVel && simT <= giverVel.until && on[GIVER]) move(GIVER, giverVel.v);
        if (!on[NAME]) return;
        const towards = (close) => { const d = pos[GIVER] - pos[NAME]; if (Math.abs(d) > close) move(NAME, Math.sign(d) * Math.min(4, Math.abs(d) - close)); };
        if (mode === 'agenda' && !opt.agendaIdle) move(NAME, -0.5);
        else if (mode === 'come') { if (opt.comeTeleport) pos[NAME] = pos[GIVER] - 2; else towards(2); }
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
    const botSay = (msg) => { add(`<${NAME}> ${msg}`); };
    // What agent.js routes to chat for one response (openChat, by show_command_syntax).
    const route = (res) => {
        const m = /!(\w+)(\([^)]*\))?/.exec(res);
        if (!m) return botSay(res.replace(/\n/g, ' '));
        const pre = res.slice(0, m.index).trim();
        if (syntax === 'full') botSay(res.slice(0, m.index + m[0].length).replace(/\n/g, ' '));
        else if (syntax === 'shortened') botSay(pre ? `${pre}  *used ${m[1]}*` : `*used ${m[1]}*`);
        else if (pre) botSay(pre);
    };
    const respond = (res) => { output.push(...`${NAME} full response to ${GIVER}: ""${res}""`.split('\n')); if (!opt.answerOnlyJournal) route(res); };
    // The bot's client receives a message (only while online), parses it like mineflayer and agent.js handles it.
    const receive = (msg) => {
        if (!on[NAME]) return;
        for (const h of mineflayerParse(msg)) {
            if (h.from === NAME) continue;                       // agent.js: its own messages are ignored
            heard.push(h);
            output.push(`${NAME} received message from ${h.from} : ${h.text}`);
            if (h.from === GIVER) giverTurn(h.text);
            else if (h.from === 'Server' && h.type === 'whisper' && opt.driver && !opt.giverOff) serverTurn(h.text);
        }
    };
    const giverSay = (msg) => { add(`<${GIVER}> ${msg}`); receive(`<${GIVER}> ${msg}`); };
    // A task giver's turn: typed commands run directly and are echoed (agent.js); words go to the "model".
    const giverTurn = (msg) => {
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
        if (/come here/.test(msg)) { if (!opt.noCome) { mode = 'come'; at(t + 2 * S, () => respond(`On my way! !goToPlayer("${GIVER}", 2)`)); } return; }
        if (/\bstop\b/.test(msg)) { mode = opt.ignoresStop ? 'follow' : 'still'; return; }
        if (!/\?$/.test(msg)) return;                            // small talk ("one sec") gets no answer here
        if (opt.chatterOnly) { at(t + 4 * S, () => botSay('agenda step logs started: logs')); return; }
        if (opt.noAnswer) return;
        if (opt.twoResponses) { at(t + 3 * S, () => respond('!stats')); at(t + 8 * S, () => respond('I have 3 logs and a crude axe.')); return; }
        at(t + 4 * S, () => respond(opt.multiLine ? 'I am gathering logs.\nThen I will craft my tools.' : 'I am gathering logs for my tools. !collectBlocks("oak_log", 4)'));
    };
    const serverTurn = (msg) => {
        const m = /^!(\w+)/.exec(msg);
        if (!m) return;
        botSay(`*Server used ${m[1]}*`);
        if (m[1] === 'stop') { botSay(HOLD_REPLY); mode = opt.ignoresStop ? 'agenda' : 'still'; }
        if (m[1] === 'resume') mode = 'agenda';
    };
    // The player reads the whispered prompts and does what they say (or not, per opt).
    const prompted = (text) => {
        const chat = (ms, msg) => at(t + ms, () => { if (opt.chattyGiver) giverSay('one sec'); giverSay(msg); });
        if (/^1\/4 answer/.test(text) && !opt.noQuestion) chat(10 * S, `${NAME}, what are you doing?`);
        if (/^2\/4 come: walk/.test(text) && !opt.giverStaysNear) giverVel = { v: 4, until: t + 10 * S };
        if (/^2\/4 come: now call/.test(text)) {
            if (opt.walksBackBeforeCall) giverVel = { v: -8, until: t + 5 * S };
            at(t + (opt.walksBackBeforeCall ? 12 : 5) * S, () => {
                if (opt.chattyGiver) giverSay('one sec');
                giverSay(opt.comeSaid ? `${NAME}, come here` : `!goToPlayer("${GIVER}", 2)`);
                giverVel = opt.giverWalksDuringCome ? { v: 3, until: t + 60 * S } : null;
            });
        }
        if (/^3\/4 follow/.test(text)) {
            at(t + 5 * S, () => {
                if (opt.chattyGiver) giverSay('one sec');
                giverSay(opt.wrongFollow ? '!followPlayer("Other", 3)' : `!followPlayer("${GIVER}", 3)`);
                giverVel = opt.giverIdleFollow ? null : { v: 0.5, until: t + 400 * S };
                if (opt.idleAfterFollow) at(t + 130 * S, () => { mode = 'still'; });
            });
        }
        if (/^4\/4 stop/.test(text) && !opt.noStop) {
            at(t + (opt.stopDelayS ?? 3) * S, () => {
                if (opt.chattyGiver) giverSay('one sec');
                giverSay(opt.stopSaid ? `${NAME} stop` : '!stop');
                giverVel = { v: 0.5, until: t + 60 * S };
            });
        }
        if (/^done:/.test(text)) at(t + 3 * S, () => giverSay('!resume'));
    };
    if (opt.giverJoinsAt !== undefined) at(opt.giverJoinsAt * S, () => { on[GIVER] = true; add(`${GIVER} joined the game`); });
    const scores = (p) => [`Showing 3 tracked objective(s) for ${p}:`, `- g4cWalk: ${walkCm[p]} (g4cWalk)`, '- g4cSprint: 0 (g4cSprint)', '- g4cSwim: 0 (g4cSwim)'];
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            if (opt.throwOn && opt.throwOn.test(cmd)) throw new Error(`simulated console failure: ${cmd}`);
            const before = log.length;
            let m;
            let echoFrom = 'Server';
            if ((m = /^say (.*)$/.exec(cmd))) { add(`[Server] ${m[1]}`); receive(`[Server] ${m[1]}`); }
            else if ((m = /^testfor @a\[name=(\w+)\]$/.exec(cmd))) add(on[m[1]] ? `Found ${m[1]}` : 'Selector found nothing');
            else if ((m = /^execute (\w+) ~ ~ ~ testfor @a\[name=(\w+),r=(\d+)\]$/.exec(cmd))) {
                echoFrom = m[1];
                if (!opt.executeSilent) add(on[m[1]] && on[m[2]] && Math.abs(pos[m[1]] - pos[m[2]]) <= Number(m[3]) ? `Found ${m[2]}` : `Failed to execute 'testfor @a[name=${m[2]},r=${m[3]}]' as ${m[1]}`);
            } else if ((m = /^scoreboard objectives add (\w+) \S+$/.exec(cmd))) add(`Added new objective '${m[1]}' successfully`);
            else if ((m = /^scoreboard objectives remove (\w+)$/.exec(cmd))) add(`Removed objective '${m[1]}' successfully`);
            else if ((m = /^scoreboard players list (\w+)$/.exec(cmd))) for (const l of scores(m[1])) add(l);
            else if ((m = /^tell (\w+) (.*)$/.exec(cmd))) {
                if (!on[m[1]]) add('That player cannot be found');
                else {
                    add(`You whisper to ${m[1]}: ${m[2]}`);
                    if (m[1] === NAME) receive(`Server whispers to you: ${m[2]}`);
                    if (m[1] === GIVER && m[2].startsWith(`${PROMPT_TAG} `)) prompted(m[2].slice(PROMPT_TAG.length + 1));
                }
            }
            // An op hears the console's and execute's feedback as an admin echo, "[<sender>: <message>]".
            const reply = log.slice(before).map((l) => l.replace(/^.*?\]: /, '')).find((x) => !/^You whisper to /.test(x));
            if (opt.botIsOp && reply) receive(`[${echoFrom}: ${reply}]`);
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
            else if (!opt.noSettings) output.push(`[settings] effective task_givers=${JSON.stringify(opt.givers ?? [GIVER])} allow_server_task_giver=${opt.allowServerGiver ? 'true' : 'false'}`);
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
    return { server, bot, clock, sent, output, heard, serverLog: log };
}
const run = ({ server, bot, clock }, params = {}, extra = {}) => runScenario(control, { server, bot, clock, runId: 'r1', params: { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000, ...params }, ...extra });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));
const prompts = (sent) => sent.filter((c) => c.startsWith(`tell ${GIVER} ${PROMPT_TAG} `)).map((c) => c.slice(`tell ${GIVER} ${PROMPT_TAG} `.length).split(':')[0]);
const ALL = ['login_online', 'chat_answer', 'come', 'follow', 'stop', 'no_command_echo'];

describe('g4-control-commands: the module, the console list and the helpers', () => {
    test('G4; the checks; runMinutes; the defaults name JQDAW as the giver', () => {
        assert.equal(control.gate, 'G4');
        assert.deepEqual(Object.keys(control.checks), ALL);
        assert.equal(control.defaults.giver, 'JQDAW');
        const m = control.runMinutes(control.defaults);
        assert.ok(Number.isFinite(m) && m > 20 && m < 60, String(m));
    });

    test('the mineflayer model is mineflayer\'s own code; with it, a `say` prompt is chat FROM the giver (why prompts are whispers)', () => {
        const src = fs.readFileSync(new URL('../../node_modules/mineflayer/lib/plugins/chat.js', import.meta.url), 'utf8');
        for (const l of MINEFLAYER_SRC) assert.ok(src.includes(l), l);
        assert.deepEqual(mineflayerParse('[Server] [g4] JQDAW: please join'), [{ type: 'chat', from: 'JQDAW', text: 'please join' }]);
        assert.deepEqual(mineflayerParse('[Server] [g4] 1/4 answer: ask FRCFLD'), [{ type: 'chat', from: 'g4', text: '1/4 answer: ask FRCFLD' }]);
        assert.deepEqual(mineflayerParse('[JQDAW: Found FRCFLD]'), [{ type: 'chat', from: 'JQDAW', text: 'Found FRCFLD]' }], 'an execute run AS the giver would echo as the giver');
        assert.deepEqual(mineflayerParse('[FRCFLD: Found JQDAW]'), [{ type: 'chat', from: 'FRCFLD', text: 'Found JQDAW]' }], 'as the bot: its own name, ignored');
        assert.deepEqual(mineflayerParse('Server whispers to you: !stop'), [{ type: 'whisper', from: 'Server', text: '!stop' }]);
        assert.deepEqual(mineflayerParse('Found FRCFLD'), []);
    });

    test('the console: only the bot executes, with exactly a testfor of the bot or the giver; no say; other scenarios get no execute', () => {
        const fake = { console: (cmd) => [cmd] };
        const g = guardConsole(fake, consoleAllowFor(control));
        for (const ok of ['execute FRCFLD ~ ~ ~ testfor @a[name=JQDAW,r=20]', 'execute FRCFLD ~ ~ ~ testfor @a[name=FRCFLD,r=2]',
            'testfor @a[name=JQDAW]', 'scoreboard players list JQDAW', 'tell JQDAW [g4] 1/4 answer: x', 'tell FRCFLD !stop']) assert.doesNotThrow(() => g.console(ok), ok);
        for (const bad of ['say [g4] hello', 'say hello', 'execute JQDAW ~ ~ ~ testfor @a[name=FRCFLD,r=20]', 'execute @a ~ ~ ~ testfor @a[name=FRCFLD,r=2]',
            'execute FRCFLD ~ ~ ~ kill FRCFLD', 'execute FRCFLD ~ ~ ~ testfor @a[name=Other,r=2]', 'execute FRCFLD ~ ~ ~ testfor @a[name=JQDAW,r=2,c=1]', 'tp FRCFLD JQDAW']) {
            assert.throws(() => g.console(bad), /refused/, bad);
        }
        const other = guardConsole(fake, consoleAllowFor({ id: 'g4-restart-persistence' }, control.defaults));
        assert.throws(() => other.console('execute FRCFLD ~ ~ ~ testfor @a[name=JQDAW,r=20]'), /refused/);
    });

    test('S\'s console: a tell other than the prompt to the giver throws (tell FRCFLD !stop above all), before it is sent', () => {
        const sentHere = [];
        const s = giverOnlyTells(guardConsole({ console: (cmd) => { sentHere.push(cmd); return [cmd]; } }, consoleAllowFor(control)), GIVER);
        for (const bad of ['tell FRCFLD !stop', 'tell FRCFLD !resume', 'tell JQDAW !stop', 'tell JQDAW hello', 'tell JQDAW [g4] two\nlines', 'tell Other [g4] x']) {
            assert.throws(() => s.console(bad), /refused on S: only 'tell JQDAW \[g4\] <text>' is a tell here/, bad);
        }
        assert.deepEqual(sentHere, [], 'nothing reached the server');
        assert.doesNotThrow(() => s.console('tell JQDAW [g4] 4/4 stop: type !stop'));
        assert.doesNotThrow(() => s.console('execute FRCFLD ~ ~ ~ testfor @a[name=JQDAW,r=8]'));
        assert.deepEqual(sentHere, ['tell JQDAW [g4] 4/4 stop: type !stop', 'execute FRCFLD ~ ~ ~ testfor @a[name=JQDAW,r=8]']);
    });

    test('helpers: promptIndex, giversAtStart, journalResponses (multi-line, every response), chatForms, answerLine, REQUESTS, heardEchoes', () => {
        const L = [line(0, 'You whisper to JQDAW: [g4] 1/4 answer: ask'), line(1000, `<${GIVER}> hi?`), line(2000, `<${NAME}> Hello there. !stats`), line(3000, 'You whisper to JQDAW: [g4] 1/4 answer: ask')];
        assert.equal(promptIndex(L, GIVER, '1/4 answer: ask'), 3);
        assert.equal(promptIndex(L, 'Other', '1/4 answer: ask'), -1);
        assert.deepEqual(giversAtStart(['x', '[settings] effective task_givers=["JQDAW","Other"] allow_server_task_giver=false']).givers, ['JQDAW', 'Other']);
        assert.match(giversAtStart(['x']).error, /the release prints no \[settings\]/);
        const J = [`${NAME} received message from ${GIVER} : hi?`, `${NAME} full response to ${GIVER}: ""Hello`, 'there. !stats""', 'x', `${NAME} full response to ${GIVER}: ""Second.""`];
        assert.deepEqual(journalResponses(J, 'frcfld', GIVER, 'hi?'), ['Hello\nthere. !stats', 'Second.']);
        assert.equal(journalResponses(J, NAME, GIVER, 'other'), null);
        assert.deepEqual(chatForms('Sure. !goToPlayer("JQDAW", 2) and more'), ['Sure.!goToPlayer("JQDAW",2)', 'Sure.*usedgoToPlayer*', 'Sure.']);
        assert.deepEqual(chatForms('Just words.'), ['Justwords.']);
        assert.equal(answerLine(L, NAME, 1, ['Hello there. !stats']).text, 'Hello there. !stats', 'show_command_syntax full: the command is in the chat');
        assert.equal(answerLine(L, NAME, 2, ['Hello there. !stats']), null, 'only after the question');
        assert.equal(answerLine(L, NAME, 1, ['Something else.']), null);
        assert.equal(REQUESTS.come('!goToPlayer("JQDAW", 2)', GIVER), true);
        assert.equal(REQUESTS.come('!goToPlayer("Other", 2)', GIVER), false);
        assert.equal(REQUESTS.come('FRCFLD, come here', GIVER), true);
        assert.equal(REQUESTS.come('one sec', GIVER), false);
        assert.equal(REQUESTS.follow('!followPlayer("JQDAW", 3)', GIVER), true);
        assert.equal(REQUESTS.follow('!goToPlayer("JQDAW", 2)', GIVER), false);
        assert.deepEqual(['!stop', 'FRCFLD stop', '!stopped', '!resume'].map((x) => REQUESTS.stop(x)), [true, true, false, false]);
        assert.deepEqual(['!stop', ' !goToPlayer("x", 2)', 'stop now'].map(isCommandText), [true, true, false]);
        const out = [`${NAME} received message from ${GIVER} : hi?`, `${NAME} received message from Server : Showing 3 tracked objective(s) for FRCFLD:]`, `${NAME} received message from Server : !stop`];
        assert.deepEqual(heardEchoes(out, L, NAME, { allowed: [{ from: 'Server', text: '!stop' }] }), [{ from: 'Server', text: 'Showing 3 tracked objective(s) for FRCFLD:]' }]);
    });
});

describe('g4-control-commands on S (the CX23 service, a trusted player)', () => {
    test('all well: every check passes; prompts are whispers to the giver only; the bot heard only the giver\'s real chat; scoreboards removed', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of ALL) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(c.chat_answer.detail, `asked "${NAME}, what are you doing?", answered "I am gathering logs for my tools. !collectBlocks("oak_log", 4)"`);
        assert.match(c.come.detail, /^within 4 blocks of JQDAW after "!goToPlayer\("JQDAW", 2\)", moving \d+(\.\d)? m$/);
        assert.match(c.stop.detail, /^"!stop": the bot moved 0 m in 30 s while JQDAW walked \d+(\.\d)? m, with the hold reply$/);
        const tells = s.sent.filter((x) => x.startsWith('tell '));
        assert.ok(tells.length > 0 && tells.every((x) => x.startsWith(`tell ${GIVER} ${PROMPT_TAG} `)), 'every tell is a prompt to the giver');
        assert.equal(s.sent.filter((x) => /^say /.test(x) && !/scenario-r1-begin/.test(x)).length, 0, 'no say but the runner\'s begin marker');
        assert.deepEqual(prompts(s.sent), ['1/4 answer', '2/4 come', '2/4 come', '3/4 follow', '4/4 stop', 'done']);
        assert.ok(s.heard.length > 0 && s.heard.every((h) => h.from === GIVER && s.serverLog.some((l) => l.endsWith(`<${GIVER}> ${h.text}`))), JSON.stringify(s.heard));
        assert.ok(s.sent.every((x) => !/^execute (?!FRCFLD )/.test(x)), 'the executor is always the bot');
        assert.equal(s.sent.filter((x) => x.startsWith('scoreboard objectives remove ')).length, 3);
        assert.equal(r.notes.resume, '!resume');
        assert.equal(r.notes.follow.typed, true);
    });

    test('the bot is op: the console\'s replies reach it as admin echoes from "Server", and no_command_echo fails; execute\'s echo names the bot and is ignored', async () => {
        const s = sim({ botIsOp: true });
        const c = byName(await run(s));
        assert.equal(c.no_command_echo.pass, false);
        assert.match(c.no_command_echo.detail, /message\(s\) heard that no player said, e\.g\. from Server: "/);
        assert.ok(!s.heard.some((h) => h.from === NAME || (h.from === GIVER && /Found/.test(h.text))), 'no execute echo as the giver');
    });

    test('chat_answer: the reply as openChat sends it (full, shortened, none), across lines and a second response; no tie to the question fails', async () => {
        for (const syntax of ['shortened', 'none']) assert.equal(byName(await run(sim({ syntax }))).chat_answer.pass, true, syntax);
        assert.equal(byName(await run(sim({ multiLine: true }))).chat_answer.detail, `asked "${NAME}, what are you doing?", answered "I am gathering logs. Then I will craft my tools."`);
        assert.match(byName(await run(sim({ twoResponses: true }))).chat_answer.detail, /answered "!stats"|answered "I have 3 logs/);
        assert.match(byName(await run(sim({ noAnswer: true }))).chat_answer.detail, /^no answer to JQDAW in the bot's log within 90 s/);
        assert.match(byName(await run(sim({ answerOnlyJournal: true }))).chat_answer.detail, /^the bot's log has 1 response\(s\), but no chat line of one/);
        assert.equal(byName(await run(sim({ chatterOnly: true }))).chat_answer.pass, false, 'an agenda line is no answer');
        const idle = byName(await run(sim({ noQuestion: true })));
        assert.match(idle.chat_answer.detail, /^not reached: the giver gave no question within 3 min \(human timing/);
        assert.equal(idle.come.pass, true, 'the next steps still run');
    });

    test('come: never comes, or arrives without moving, fails; near before the call, never far, or walking meanwhile is not reached; words count', async () => {
        assert.match(byName(await run(sim({ noCome: true }))).come.detail, /^not within 4 blocks of JQDAW 2 min after "!goToPlayer\("JQDAW", 2\)"$/);
        assert.match(byName(await run(sim({ comeTeleport: true }))).come.detail, /^the bot moved \d(\.\d)? m since the call \(need 16\)$/);
        assert.match(byName(await run(sim({ walksBackBeforeCall: true }))).come.detail, /^not reached: the bot was within 20 blocks of JQDAW at the last read before the call/);
        assert.match(byName(await run(sim({ giverStaysNear: true, agendaIdle: true }))).come.detail, /^not reached: JQDAW was still within 20 blocks/);
        const walked = await run(sim({ giverWalksDuringCome: true }));
        assert.match(byName(walked).come.detail, /^not reached: JQDAW moved \d+(\.\d)? m while waiting/, JSON.stringify(walked.notes.come));
        const said = await run(sim({ comeSaid: true }));
        assert.equal(byName(said).come.pass, true, byName(said).come.detail);
        assert.equal(said.notes.come.typed, false);
    });

    test('requests are matched per step: unrelated lines are ignored; a follow naming someone else is not the request', async () => {
        const chatty = byName(await run(sim({ chattyGiver: true })));
        for (const k of ['come', 'follow', 'stop']) assert.equal(chatty[k].pass, true, `${k}: ${chatty[k].detail}`);
        const wrong = byName(await run(sim({ wrongFollow: true })));
        assert.match(wrong.follow.detail, /^not reached: the giver gave no follow request \("follow" or !followPlayer\) within 3 min/);
        assert.equal(wrong.stop.detail, 'not reached: the follow did not start, so a stop has nothing to stop');
    });

    test('follow: a bot that stays fails; a giver who does not walk is not reached', async () => {
        const c = byName(await run(sim({ noFollow: true })));
        assert.equal(c.follow.pass, false);
        assert.match(c.follow.detail, /^within 8 blocks at 0% of \d+ polls/);
        assert.match(c.stop.detail, /^not reached: the bot was not moving just before the stop/);
        assert.match(byName(await run(sim({ giverIdleFollow: true }))).follow.detail, /^not reached: JQDAW walked only 0 m \(need 20\)/);
    });

    test('stop: "moving" is measured right before the stop line: a bot idle for the minute before a late !stop is not reached', async () => {
        const r = await run(sim({ idleAfterFollow: true, stopDelayS: 60 }));
        assert.equal(byName(r).follow.pass, true);
        assert.match(byName(r).stop.detail, /^not reached: the bot was not moving just before the stop \(0 m in the last 30 s; need 3\)/);
        assert.equal(r.notes.stop.movingBeforeM, 0, JSON.stringify(r.notes.stop));
    });

    test('stop: keeps following fails; no hold reply to a typed !stop fails; said in words passes with no hold; no stop is human timing', async () => {
        const keeps = byName(await run(sim({ ignoresStop: true })));
        assert.equal(keeps.stop.pass, false);
        assert.match(keeps.stop.detail, /^the bot moved \d+(\.\d)? m in the 30 s after the stop \(at most 2\)/);
        assert.match(byName(await run(sim({ noHoldReply: true }))).stop.detail, /^no "stopped; on hold until a task giver types !resume" reply to the typed !stop$/);
        const said = byName(await run(sim({ stopSaid: true })));
        assert.equal(said.stop.pass, true, said.stop.detail);
        assert.match(said.stop.detail, /\(said, not typed: no hold\)$/);
        assert.match(byName(await run(sim({ noStop: true }))).stop.detail, /^not reached: the giver gave no !stop within 3 min/);
    });

    test('the release: Server a giver, the console switch on, no [settings] line, or the giver not a giver: every step is not reached', async () => {
        assert.match(byName(await run(sim({ givers: ['JQDAW', 'Server'] }))).come.detail, /^not reached: the release's settings are not production's: .*names Server/);
        assert.match(byName(await run(sim({ allowServerGiver: true }))).stop.detail, /^not reached: the release's settings are not production's: at start: allow_server_task_giver=true/);
        assert.match(byName(await run(sim({ noSettings: true }))).come.detail, /^not reached: the release prints no \[settings\]/);
        const notGiver = byName(await run(sim({ givers: ['Other'] })));
        for (const k of ['chat_answer', 'come', 'follow', 'stop', 'no_command_echo']) assert.equal(notGiver[k].detail, 'not reached: JQDAW is not a task giver in this release (task_givers ["Other"])', k);
    });

    test('the giver offline: the join request goes to the runner\'s terminal (a whisper cannot reach them); a late join is fine; never is not reached', async () => {
        const logged = [];
        const s = sim({ giverJoinsAt: 90 });
        const late = byName(await run(s, {}, { log: (l) => logged.push(l) }));
        for (const k of ALL) assert.equal(late[k].pass, true, `${k}: ${late[k].detail}`);
        assert.ok(logged.some((l) => /\[g4\] JQDAW: please join the test server/.test(l)), logged.join('\n'));
        assert.ok(!s.serverLog.some((l) => /That player cannot be found/.test(l)), 'no whisper to an offline giver');
        assert.match(byName(await run(sim({ giverJoinsAt: 10000 }))).follow.detail, /^not reached: JQDAW was not online within 3 min/);
    });

    test('the server does not answer the execute probe: every step is not reached; a console failure mid-run still removes the scoreboards', async () => {
        const r = await run(sim({ executeSilent: true }));
        assert.match(byName(r).come.detail, /^not reached: the server did not answer "Found" to the execute probe/);
        const s = sim({ throwOn: /^execute FRCFLD ~ ~ ~ testfor @a\[name=JQDAW,r=20\]$/ });
        const t = await run(s);
        assert.match(t.error, /simulated console failure/);
        assert.equal(s.sent.filter((x) => x.startsWith('scoreboard objectives remove ')).length, 3, 'finally');
    });

    test('S guards: another bot\'s unit, or a running unit: login_online fails and nothing starts', async () => {
        const a = sim({ unitBot: 'otherbot' });
        assert.equal(byName(await run(a)).login_online.detail, "the service's bot 'otherbot' is not this run's bot 'FRCFLD'");
        assert.ok(!a.sent.includes('bot start'));
        assert.match(byName(await run(sim({ unitActive: true }))).login_online.detail, /^the unit is active before the start/);
    });
});

describe('g4-control-commands on T (a spawned driver): the console giver\'s !stop only', () => {
    test('the rehearsal: stop passes while the agenda moves the bot; answer, come and follow not reached; tell !stop then !resume; echo-free; not-gate', async () => {
        const s = sim({ driver: true });
        const r = await run(s);
        const c = byName(r);
        assert.equal(c.stop.pass, true, `${c.stop.detail} ${r.error}`);
        assert.match(c.stop.detail, /^"!stop": the bot moved 0 m in 30 s, with the hold reply$/);
        assert.equal(c.no_command_echo.pass, true, c.no_command_echo.detail);
        for (const k of ['chat_answer', 'come', 'follow']) assert.match(c[k].detail, /^not reached: set-up T rehearses !stop only/, k);
        assert.deepEqual(s.sent.filter((x) => x.startsWith('tell ')), [`tell ${NAME} !stop`, `tell ${NAME} !resume`]);
        assert.deepEqual(s.heard.map((h) => `${h.from}:${h.text}`), ['Server:!stop', 'Server:!resume']);
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.some((w) => /set-up T/.test(w)));
    });

    test('T: the echo check (the rehearsal verifies it): with the bot op, the console\'s replies are heard as chat from the console giver: a fail', async () => {
        const s = sim({ driver: true, botIsOp: true });
        const c = byName(await run(s));
        assert.equal(c.no_command_echo.pass, false);
        assert.ok(s.heard.some((h) => h.from === 'Server' && h.type === 'chat'));
    });

    test('T: a bot that does not stop fails; an idle agenda or the console giver off is not reached', async () => {
        assert.match(byName(await run(sim({ driver: true, ignoresStop: true }))).stop.detail, /^the bot moved \d+(\.\d)? m in the 30 s after the stop/);
        assert.match(byName(await run(sim({ driver: true, agendaIdle: true }))).stop.detail, /^not reached: the agenda did not move the bot/);
        const off = sim({ driver: true, giverOff: true });
        assert.equal(byName(await run(off)).stop.detail, 'not reached: the T driver\'s console giver is off');
        assert.equal(off.sent.filter((x) => x.startsWith('tell ')).length, 0);
    });
});
