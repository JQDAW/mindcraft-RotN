// Offline tests for the outgoing chat limit (G3 round 4 C+D: the bot announced 12 agenda lines in
// one second and was kicked for spamming, as in round 3 D). A fake client and a model of vanilla
// 1.12's counter (+20 per chat packet, -1 per tick, kicked above 200); fake time; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import settings from './settings.js';
import { installChatLimit, withChatPriority, CHAT_LIMIT } from './chat_limit.js';
import { Agent } from './agent.js';

/** A bot whose client counts like a vanilla 1.12 server at `tps` ticks per second. */
function fakeBot({ tps = 20, logs = [] } = {}) {
    const clock = { t: 0, timers: [] };
    const sent = [];
    let counter = 0, at = 0, peak = 0;
    const client = {
        chat(text) {
            counter = Math.max(0, counter - ((clock.t - at) / 1000) * tps); at = clock.t;
            counter += 20; peak = Math.max(peak, counter);
            sent.push({ text, t: clock.t, kicked: counter > 200 });
        },
        once() {},
    };
    const bot = { _client: client };
    bot.chat = (m) => client.chat(m); // mineflayer: one packet per line (a long line: one per piece)
    const limiter = installChatLimit(bot, {
        now: () => clock.t,
        setTimer: (fn, ms) => { const h = { at: clock.t + ms, fn }; clock.timers.push(h); return h; },
        clearTimer: (h) => { clock.timers = clock.timers.filter(x => x !== h); },
        log: (m) => logs.push(m),
    });
    const advance = (ms) => {
        const end = clock.t + ms;
        for (;;) {
            clock.timers.sort((a, b) => a.at - b.at);
            const h = clock.timers[0];
            if (!h || h.at > end) break;
            clock.timers.shift();
            clock.t = h.at;
            h.fn();
        }
        clock.t = end;
    };
    return { bot, sent, limiter, advance, clock, peak: () => peak };
}

test('a burst of 12 lines never gets near the kick: 5 at once, the rest queued and all sent later', () => {
    for (const tps of [20, 10]) { // a lagging server (10 TPS) is covered too
        const f = fakeBot({ tps });
        for (let i = 0; i < 12; i++) f.bot.chat(`line ${i}`);
        assert.equal(f.sent.length, CHAT_LIMIT.budget / CHAT_LIMIT.perPacket, 'only the budget goes at once');
        f.advance(60_000);
        assert.deepEqual(f.sent.map(s => s.text), Array.from({ length: 12 }, (_, i) => `line ${i}`), 'normal lines are never dropped, in order');
        assert.ok(f.sent.every(s => !s.kicked), `never above 200 at ${tps} TPS`);
        assert.ok(f.peak() <= 100 + 20, `well under: peak ${f.peak()}`);
    }
});

test('a reply to a player (a refusal) goes before the waiting lines and is never dropped; low lines are', () => {
    const f = fakeBot();
    for (let i = 0; i < 10; i++) f.bot.chat(`agenda ${i}`); // 5 sent, 5 waiting
    for (let i = 0; i < 6; i++) withChatPriority(f.bot, 'low', () => f.bot.chat(`I'm stuck! ${i}`));
    assert.equal(f.limiter.pending().filter(p => p.priority === 'low').length, CHAT_LIMIT.lowQueueMax, 'low lines beyond 3 are dropped');
    withChatPriority(f.bot, 'high', () => f.bot.chat('Sorry Server, I only run commands from task givers.'));
    f.advance(2_000); // the next packet the budget allows
    assert.equal(f.sent[5].text, 'Sorry Server, I only run commands from task givers.', 'first after the burst');
    assert.ok(f.sent[5].t <= 2_000, `prompt: ${f.sent[5].t} ms`);
    f.advance(60_000);
    const texts = f.sent.map(s => s.text);
    for (let i = 0; i < 10; i++) assert.ok(texts.includes(`agenda ${i}`));
    assert.ok(f.sent.every(s => !s.kicked));
    // 3 dropped at once (the queue already held 3 low lines); the 3 queued ones wait behind the
    // normal lines, so each is sent within lowMaxWaitMs or dropped too.
    const stuck = f.sent.filter(x => /stuck/.test(x.text));
    assert.equal(f.limiter.dropped, 6 - stuck.length);
    assert.ok(f.limiter.dropped >= 3);
    assert.ok(stuck.every(x => x.t <= CHAT_LIMIT.lowMaxWaitMs));
});

test('a low line that waited longer than lowMaxWaitMs is dropped; the normal lines around it are all sent', () => {
    const f = fakeBot();
    for (let i = 0; i < 5; i++) f.bot.chat(`n${i}`); // the budget
    withChatPriority(f.bot, 'low', () => f.bot.chat('old narration'));
    for (let i = 0; i < 10; i++) f.bot.chat(`m${i}`); // they go first: 20 s of chat
    f.advance(60_000);
    assert.ok(!f.sent.some(s => s.text === 'old narration'), 'dropped after 15 s');
    assert.equal(f.limiter.dropped, 1);
    assert.equal(f.sent.length, 15);
    assert.ok(f.sent.every(s => !s.kicked));
});

test('withChatPriority sets the priority only for the call, and installing twice wraps once', () => {
    const f = fakeBot();
    withChatPriority(f.bot, 'high', () => assert.equal(f.bot.rotnChatPriority, 'high'));
    assert.equal(f.bot.rotnChatPriority, undefined);
    assert.equal(installChatLimit(f.bot), f.limiter);
    assert.equal(installChatLimit({}, { warn: () => {} }), null, 'no client: nothing to wrap');
});

test('the agent: a refusal is high with a per-sender key; a reply to a giver high; to others and self-prompted normal', async (t) => {
    const before = { ...settings };
    Object.assign(settings, { language: 'en', only_chat_with: ['JQDAW'], task_givers: ['JQDAW'] });
    t.after(() => { for (const k of Object.keys(settings)) delete settings[k]; Object.assign(settings, before); });
    t.mock.method(console, 'log', () => {});
    const seen = [];
    const agent = Object.create(Agent.prototype);
    Object.assign(agent, { name: 'FRCFLD', shut_up: false, last_sender: null,
        checkTaskDone: () => Promise.resolve(),
        bot: { players: { FRCFLD: {}, JQDAW: {}, Mallory: {} },
            whisper(to, m) { seen.push([m.trim(), this.rotnChatPriority, this.rotnChatKey ?? null]); } } });
    await agent.handleMessage('Mallory', '!taskAdd("dig here", "normal")'); // the real refusal path
    await agent.routeResponse('JQDAW', 'on it');
    await agent.routeResponse('Mallory', 'hello');
    await agent.routeResponse('system', 'thinking aloud');
    await agent.openChat('I\'m stuck!', { priority: 'low' });
    assert.deepEqual(seen, [
        ['Sorry Mallory, I only run commands from task givers.', 'high', 'refusal:Mallory'],
        ['on it', 'high', null],
        ['hello', 'normal', null],
        ['thinking aloud', 'normal', null],
        ['I\'m stuck!', 'low', null],
    ]);
    assert.equal(agent.bot.rotnChatPriority, undefined, 'reset after each send');
});

test('#256 review 1: a player who keeps typing commands: one waiting refusal, a bounded queue, and the agenda lines still go out', () => {
    const f = fakeBot();
    const refuse = () => withChatPriority(f.bot, 'high', () => f.bot.chat('Sorry Mallory, I only run commands from task givers.'), 'refusal:Mallory');
    for (let i = 0; i < 5; i++) f.bot.chat(`agenda ${i}`); // the budget is used up
    let maxQueue = 0, maxRefusalsWaiting = 0;
    for (let s = 0; s < 120; s++) { // 2 minutes: a command every second, an agenda line every 4 s
        refuse();
        if (s % 4 === 0) f.bot.chat(`agenda line ${s}`);
        const p = f.limiter.pending();
        maxQueue = Math.max(maxQueue, p.length);
        maxRefusalsWaiting = Math.max(maxRefusalsWaiting, p.filter(x => x.key === 'refusal:Mallory').length);
        f.advance(1_000);
    }
    f.advance(120_000);
    assert.equal(maxRefusalsWaiting, 1, 'repeats collapse into the one waiting refusal');
    assert.ok(maxQueue <= CHAT_LIMIT.queueMax, `bounded: ${maxQueue}`);
    const texts = f.sent.map(x => x.text);
    for (let s = 0; s < 120; s += 4) assert.ok(texts.includes(`agenda line ${s}`), `agenda line ${s} was sent`);
    const refusals = f.sent.filter(x => /^Sorry Mallory/.test(x.text));
    assert.ok(refusals[0].t <= 2_000, `the first refusal is prompt: ${refusals[0].t} ms`);
    assert.ok(refusals.every((x, i) => i === 0 || x.t - refusals[i - 1].t >= CHAT_LIMIT.keyGapMs), 'then at most one per 10 s');
    assert.ok(refusals.length >= 1 && refusals.length <= 120 / (CHAT_LIMIT.keyGapMs / 1000) + 2, `at most one per ${CHAT_LIMIT.keyGapMs / 1000} s ahead of the rest: ${refusals.length}`);
    assert.ok(f.sent.every(x => !x.kicked));
});

test('#256 review 1: the queue holds at most queueMax lines: low lines go first, then the oldest normal; high lines are kept', () => {
    const f = fakeBot();
    for (let i = 0; i < 5; i++) f.bot.chat(`burst ${i}`);
    withChatPriority(f.bot, 'low', () => f.bot.chat('narration'));
    for (let i = 0; i < CHAT_LIMIT.queueMax + 5; i++) f.bot.chat(`n${i}`);
    for (let i = 0; i < 3; i++) withChatPriority(f.bot, 'high', () => f.bot.chat(`giver reply ${i}`));
    const p = f.limiter.pending();
    assert.equal(p.filter(x => x.priority === 'normal').length, CHAT_LIMIT.queueMax - 3, 'room for the high lines');
    assert.equal(p.filter(x => x.priority === 'high').length, 3);
    assert.ok(!p.some(x => x.text === 'narration'), 'the low line went first');
    assert.ok(!p.some(x => x.text === 'n0'), 'then the oldest normal');
    f.advance(120_000);
    for (let i = 0; i < 3; i++) assert.ok(f.sent.some(x => x.text === `giver reply ${i}`));
});

test('#256 review 2: no client chat to wrap: a warning that the limit is off', () => {
    const warned = [];
    assert.equal(installChatLimit({}, { warn: (m) => warned.push(m) }), null);
    assert.match(warned[0], /chat limit is OFF/);
});

// #256 follow-up: a refusal waiting in its 10 s gap held up a normal line that the budget allowed.
const refuseTo = (f, who) => withChatPriority(f.bot, 'high', () => f.bot.chat(`Sorry ${who}, I only run commands from task givers.`), `refusal:${who}`);

test('#256 follow-up: a refusal in its gap does not hold up a normal line the budget allows: it goes at once', () => {
    const f = fakeBot();
    refuseTo(f, 'Mallory');               // t 0: sent
    f.advance(500);
    refuseTo(f, 'Mallory');               // in its gap: waits until t 10 s
    f.advance(500);
    f.bot.chat('agenda step rocks done'); // t 1 s: the budget allows it
    const line = f.sent.find(x => x.text === 'agenda step rocks done');
    assert.ok(line, 'sent');
    assert.equal(line.t, 1_000, 'at once, not after the refusal\'s gap');
    f.advance(20_000);
    const refusals = f.sent.filter(x => /^Sorry Mallory/.test(x.text));
    assert.deepEqual(refusals.map(x => x.t), [0, 10_000], 'the waiting refusal still goes when its gap ends');
});

test('#256 follow-up: a line over the budget waits for the budget (about 2 s), not for a refusal\'s gap timer (10 s)', () => {
    const f = fakeBot();
    refuseTo(f, 'Mallory');                       // t 0: sent (20)
    refuseTo(f, 'Mallory');                       // waits for its gap: the timer is set for t 10 s
    for (let i = 0; i < 4; i++) f.bot.chat(`n${i}`); // t 0: sent (100: the budget is used up)
    f.bot.chat('late');                           // over the budget: waits
    f.advance(30_000);
    const late = f.sent.find(x => x.text === 'late');
    assert.ok(late.t <= 2_100, `sent when the budget allowed: ${late.t} ms`);
    assert.ok(f.sent.every(x => !x.kicked));
});

test('#256 follow-up: a collapsed repeat is logged', () => {
    const logs = [];
    const f = fakeBot({ logs });
    refuseTo(f, 'Mallory');
    refuseTo(f, 'Mallory'); // waits
    refuseTo(f, 'Mallory'); // collapses into it
    assert.equal(f.limiter.collapsed, 1);
    assert.ok(logs.some(m => /^\[chat\] collapsed a repeat into the waiting line \(refusal:Mallory\): Sorry Mallory/.test(m)), JSON.stringify(logs));
});
