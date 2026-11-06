// Offline tests for the outgoing chat limit (G3 round 4 C+D: the bot announced 12 agenda lines in
// one second and was kicked for spamming, as in round 3 D). A fake client and a model of vanilla
// 1.12's counter (+20 per chat packet, -1 per tick, kicked above 200); fake time; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import settings from './settings.js';
import { installChatLimit, withChatPriority, CHAT_LIMIT } from './chat_limit.js';
import { Agent } from './agent.js';

/** A bot whose client counts like a vanilla 1.12 server at `tps` ticks per second. */
function fakeBot({ tps = 20 } = {}) {
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
        log: () => {},
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
    assert.equal(installChatLimit({}), null, 'no client: nothing to wrap');
});

test('the agent: a reply to a player is high priority, a self-prompted one normal; openChat applies it to its packets', async (t) => {
    const before = { ...settings };
    Object.assign(settings, { language: 'en', only_chat_with: ['JQDAW'] });
    t.after(() => { for (const k of Object.keys(settings)) delete settings[k]; Object.assign(settings, before); });
    const seen = [];
    const agent = Object.create(Agent.prototype);
    Object.assign(agent, { name: 'FRCFLD', shut_up: false, last_sender: null,
        bot: { whisper(to, m) { seen.push([m, this.rotnChatPriority]); } } });
    await agent.routeResponse('Server', 'Sorry Server, I only run commands from task givers.');
    await agent.routeResponse('system', 'thinking aloud');
    await agent.openChat('I\'m stuck!', { priority: 'low' });
    assert.deepEqual(seen, [
        ['Sorry Server, I only run commands from task givers. ', 'high'],
        ['thinking aloud ', 'normal'],
        ['I\'m stuck! ', 'low'],
    ]);
    assert.equal(agent.bot.rotnChatPriority, undefined, 'reset after each send');
});
