// skills-rotn D3: the death report, offline (a fake bot, fake timers; no server, no LLM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import {
    inventoryCounts, lossDiff, formatLoss, DeathReporter, bindDeathReport,
    SETTLE_MS, RESPAWN_RETRY_MS, RESPAWN_RETRY_EVERY_MS, CHAT_GAP_MS, STREAK_MS,
    deathCauseText, treeDeath, TREE_DEATH_MS,
} from './death_report.js';
import { takeReplanNote, replanPromptDue, clearReplan, QUIET_MS } from '../replan.js';

const item = (name, count, metadata = 0) => ({ name, count, metadata });
// Corpse Complex keeps the main hand (slot 36 = hotbar 0 held), off hand (45) and armor (5-8).
function invBot(slots, { xp = 10 } = {}) {
    const s = new Array(46).fill(null);
    for (const [i, it] of Object.entries(slots)) s[i] = it;
    return { inventory: { slots: s }, experience: { level: xp } };
}
const full = () => ({ 5: item('leather_helmet', 1), 36: item('stone_pickaxe', 1), 45: item('torch', 4),
    9: item('cobblestone', 12), 10: item('log', 3, 1), 11: item('log', 2), 12: item('bread', 5) });
const kept = () => ({ 5: item('leather_helmet', 1), 36: item('stone_pickaxe', 1), 45: item('torch', 4) });

test('D3: counts keep 1.12 variants apart; the diff lists only what went down, largest first', () => {
    assert.deepEqual(inventoryCounts(invBot(full())),
        { leather_helmet: 1, stone_pickaxe: 1, torch: 4, cobblestone: 12, 'log:1': 3, log: 2, bread: 5 });
    const lost = lossDiff(inventoryCounts(invBot(full())), inventoryCounts(invBot(kept())));
    assert.deepEqual(lost, [{ key: 'cobblestone', count: 12 }, { key: 'bread', count: 5 }, { key: 'log:1', count: 3 }, { key: 'log', count: 2 }]);
    assert.equal(formatLoss(lost), '12 cobblestone, 5 bread, 3 log:1, 2 log');
    assert.equal(formatLoss(lost, 2), '12 cobblestone, 5 bread and 2 more kinds');
    assert.equal(formatLoss([]), 'nothing');
    assert.deepEqual(lossDiff({ a: 1 }, { a: 3, b: 2 }), [], 'gains are no loss');
});

test('D3: the "before" is the fullest recent sample (slots clear a tick before health 0); one report per death', () => {
    const d = new DeathReporter();
    d.sample(invBot(full()));
    d.sample(invBot(kept(), { xp: 10 })); // the clearing tick, health still above 0
    d.cause('FRCFLD was slain by Zombie', { now: 1000 }); // vanilla: before the health packet
    const rec = d.died({ pos: { x: 10.7, y: 64, z: -3.2 }, now: 1050 });
    assert.equal(rec.cause, 'FRCFLD was slain by Zombie');
    assert.equal(d.died({ now: 1100 }), null, 'a second death event for the same death');
    const r = d.report(invBot(kept(), { xp: 5 }), { now: 10_000 });
    assert.equal(r.line, 'died at 10, 64, -4 (FRCFLD was slain by Zombie); lost 12 cobblestone, 5 bread, 3 log:1, 2 log; XP level 10 -> 5');
    assert.equal(r.chat, `I ${r.line}.`);
    assert.equal(d.report(invBot(kept()), { now: 11_000 }), null, 'reported once');

    // A stale death message does not name a later death.
    d.cause('FRCFLD fell from a high place', { now: 20_000 });
    assert.equal(d.died({ now: 30_000 }).cause, null);
});

test('D3: death chat is rate-limited and goes quiet in a death streak', () => {
    const d = new DeathReporter();
    const die = (t) => { d.died({ now: t }); return d.report(invBot({}), { now: t + 10_000 }); };
    assert.ok(die(0).chat, 'first death: a chat line');
    assert.equal(die(20_000).chat, null, 'within a minute of the last chat: log only');
    const third = die(100_000);
    assert.match(third.chat, /^I died 3 times in 10 min; I stop reporting deaths in chat for now\.$/);
    assert.equal(die(200_000).chat, null, 'streak: quiet');
    assert.equal(die(300_000).chat, null, 'streak: quiet');
    assert.ok(die(300_000 + STREAK_MS + CHAT_GAP_MS).chat, 'the streak is over: chat again');
});

function fakeTimers() {
    let t = 0, id = 0;
    const q = new Map();
    return {
        now: () => t,
        setTimer: (fn, ms) => { q.set(++id, { fn, at: t + ms }); return id; },
        clearTimer: (i) => q.delete(i),
        advance(ms) {
            const end = t + ms;
            for (;;) {
                const next = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                q.delete(next[0]);
                t = next[1].at;
                next[1].fn();
            }
            t = end;
        },
        pending: () => q.size,
    };
}

function fakeAgent() {
    const bot = Object.assign(new EventEmitter(), invBot(full()), {
        health: 20, isAlive: true, entity: { position: { x: 100.5, y: 70, z: 200.5 } }, game: { dimension: 'overworld' },
    });
    const calls = { respawn: 0, chat: [], places: [] };
    bot.respawn = () => { calls.respawn++; };
    const agent = {
        bot, shut_up: false, actions: { currentActionLabel: 'action:collectBlocks' },
        openChat: (m) => { calls.chat.push(m); },
        memory_bank: { rememberPlace: (...a) => calls.places.push(a) },
    };
    return { agent, bot, calls };
}

test('D3: the agent samples while alive, retries a refused respawn, reports once after it, and re-plans', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const timers = fakeTimers();
    const { agent, bot, calls } = fakeAgent();
    bindDeathReport(agent, timers);
    bot.emit('physicsTick');

    // Death; the respawn timer refuses mineflayer's immediate request.
    agent._death.cause('FRCFLD was blown up by Creeper', { now: timers.now() });
    bot.health = 0; bot.isAlive = false;
    bot.emit('death');
    agent.actions.currentActionLabel = ''; // the agent's own death listener stops the action
    bot.inventory.slots = invBot(kept()).inventory.slots;
    assert.deepEqual(calls.places, [['last_death_position', 100.5, 70, 200.5]]);
    timers.advance(RESPAWN_RETRY_MS - 1);
    assert.equal(calls.respawn, 0, 'no retry before 9 s');
    timers.advance(1 + 2 * RESPAWN_RETRY_EVERY_MS);
    assert.equal(calls.respawn, 3, 'asks again every 3 s');
    assert.ok(logs.includes('[death] no respawn after 9 s; asking again every 3 s'), logs.join('\n'));

    // Respawn: retries stop; the report comes after the settle time, once.
    bot.health = 20; bot.isAlive = true;
    bot.emit('spawn');
    timers.advance(SETTLE_MS - 1);
    assert.equal(calls.chat.length, 0, 'not before the inventory settles');
    timers.advance(10 * RESPAWN_RETRY_EVERY_MS);
    assert.equal(calls.respawn, 3, 'no retry after the respawn');
    await new Promise(r => setImmediate(r));
    assert.deepEqual(calls.chat, ['I died at 100, 70, 200 (FRCFLD was blown up by Creeper); lost 12 cobblestone, 5 bread, 3 log:1, 2 log.']);
    assert.ok(logs.includes('[death] died at 100, 70, 200 (FRCFLD was blown up by Creeper); lost 12 cobblestone, 5 bread, 3 log:1, 2 log'), logs.join('\n'));
    assert.equal(agent.replan.modes.death, 1);
    assert.equal(agent.replan.interrupted, 'action:collectBlocks', 'the label captured at death');
    // Not self-prompting, idle: the coalesced prompt is due (#215 review 1).
    const quiet = { now: timers.now() + QUIET_MS, idle: true, reflexActive: false, selfPrompting: false, lastPromptAt: -Infinity };
    assert.equal(replanPromptDue(agent, quiet), true);
    const note = takeReplanNote(agent);
    assert.match(note, /^Reflexes \(death\) interrupted 'action:collectBlocks'\. You died at 100, 70, 200 and respawned\. You no longer have 12 cobblestone, 5 bread, 3 log:1, 2 log; they may lie at the death spot \(unconfirmed\)\. The spot is saved as 'last_death_position'\. Do not go back there for 5 min, nor at dusk or night: what killed you may still be there, and a zombie rises where a player dies. Check your state/);
    assert.ok(!/do not despawn/.test(note), 'no unconfirmed Corpse Complex claim');
    assert.ok(!note.includes('Creeper'), 'the server text never reaches the LLM');

    // A later spawn with no death (e.g. a dimension change): no report.
    bot.emit('spawn');
    timers.advance(SETTLE_MS * 2);
    await new Promise(r => setImmediate(r));
    assert.equal(calls.chat.length, 1);
    assert.equal(timers.pending(), 0);
});

test('D3: a quiet hold (!stfu) keeps the death report out of chat, not out of the log', async (t) => {
    t.mock.method(console, 'log', () => {});
    const timers = fakeTimers();
    const { agent, bot, calls } = fakeAgent();
    agent.shut_up = true;
    bindDeathReport(agent, timers);
    bot.emit('physicsTick');
    bot.health = 0; bot.isAlive = false;
    bot.emit('death');
    bot.health = 20; bot.isAlive = true;
    bot.emit('spawn');
    timers.advance(SETTLE_MS);
    await new Promise(r => setImmediate(r));
    assert.equal(calls.chat.length, 0);
    assert.equal(agent.replan.modes.death, 1);
    assert.equal(calls.respawn, 0, 'respawned in time: no retry');
});

test('D3: an idle death is still due; a streak death is a note only; a new action keeps the note', (t) => {
    t.mock.method(console, 'log', () => {});
    const timers = fakeTimers();
    const { agent, bot } = fakeAgent();
    agent.actions.currentActionLabel = '';
    bindDeathReport(agent, timers);
    const die = () => {
        bot.emit('physicsTick');
        bot.health = 0; bot.isAlive = false; bot.emit('death');
        bot.health = 20; bot.isAlive = true; bot.emit('spawn');
        timers.advance(SETTLE_MS + 1000);
    };
    const quiet = () => ({ now: timers.now() + QUIET_MS, idle: true, reflexActive: false, selfPrompting: false, lastPromptAt: -Infinity });

    die();
    assert.equal(agent.replan.interrupted, null, 'nothing was running');
    assert.equal(replanPromptDue(agent, quiet()), true, 'a death is due anyway');

    // An action starts right after the respawn (A4b): the request goes, the note stays.
    clearReplan(agent, 'a new action started (action:collectBlocks)', { log: () => {} });
    assert.equal(replanPromptDue(agent, quiet()), false, 'no longer due');
    assert.match(takeReplanNote(agent), /^You died at 100, 70, 200 and respawned\. Your inventory looks unchanged\./);

    die();
    assert.equal(replanPromptDue(agent, quiet()), true, 'the second death: due');
    takeReplanNote(agent);
    die();
    assert.equal(replanPromptDue(agent, quiet()), false, 'the third death in 10 min: no prompt of its own');
    assert.match(takeReplanNote(agent), /You died at/);
});

// G3 round 3 B: "FRCFLD was crushed by a falling tree" (Dynamic Trees) never reached the report:
// a modded death message arrives untranslated, as its key, with the bot's name an argument.
test('round 3 B: a modded death message (its key, the name an argument) is the bot\'s cause; others are not', () => {
    const key = { translate: 'death.attack.fallingtree', with: [{ text: 'FRCFLD' }] };
    assert.equal(deathCauseText('FRCFLD', 'death.attack.fallingtree', key), 'FRCFLD died (death.attack.fallingtree)');
    assert.equal(deathCauseText('FRCFLD', 'FRCFLD was crushed by a falling tree', key), 'FRCFLD was crushed by a falling tree');
    assert.equal(deathCauseText('FRCFLD', 'death.attack.fallingtree', { translate: 'death.attack.fallingtree', with: [{ text: 'JQDAW' }] }), null, 'another player');
    assert.equal(deathCauseText('FRCFLD', 'FRCFLD joined the game', { translate: 'multiplayer.player.joined' }), null);
});

test('round 3 B: a falling-tree death is recognised by its cause, or by a death right after the bot\'s own cut', () => {
    const at = 1_000_000;
    assert.equal(treeDeath({ cause: 'FRCFLD was crushed by a falling tree', at }), true);
    assert.equal(treeDeath({ cause: 'FRCFLD died (death.attack.fallingtree)', at }), true);
    assert.equal(treeDeath({ cause: 'FRCFLD was slain by Zombie', at }, { at: at - 1000 }), false, 'a named other cause wins');
    assert.equal(treeDeath({ cause: null, at }, { at: at - 3000 }), true, 'no cause, 3 s after its cut');
    assert.equal(treeDeath({ cause: null, at }, { at: at - TREE_DEATH_MS - 1 }), false);
    assert.equal(treeDeath({ cause: null, at }, null), false);
});

test('round 3 B: the re-plan note says a falling tree crushed the bot and how to get logs without it', (t) => {
    t.mock.method(console, 'log', () => {});
    const timers = fakeTimers();
    const { agent, bot } = fakeAgent();
    bindDeathReport(agent, timers);
    bot.rotnLastFell = { at: timers.now(), pos: { x: -70, y: 64, z: -83 } }; // fellTree's cut, just now
    bot.emit('physicsTick');
    bot.health = 0; bot.isAlive = false; bot.emit('death');
    bot.health = 20; bot.isAlive = true; bot.emit('spawn');
    timers.advance(SETTLE_MS + 1000);
    const note = takeReplanNote(agent);
    assert.match(note, /A falling tree crushed you \(the one you cut at -70, 64, -83\): in RotN a cut tree falls as one piece\./);
    assert.match(note, /Get logs only with !collectBlocks\("log", n\), which cuts the lowest trunk block from the side away from the canopy and steps back/);
});
