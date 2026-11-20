// Soak 6 (c): at 18:03:40 the model answered !craftRecipe("pyrotech:tinder", 3); the standing goal's
// daily budget stopped the self-prompter at 18:03:42 and the command was never parsed or run.
// SelfPrompter.stopAfterTurn lets the reply in flight run its command, then ends the loop.
// A fake agent whose handleMessage waits for the model's reply, then runs the command unless the
// self-prompter says to drop it (shouldInterrupt), as agent.js does. No server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SelfPrompter } from './self_prompter.js';

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

function fakeAgent() {
    const agent = {
        prompts: 0, ran: [], dropped: 0, pending: null, saves: 0,
        history: { save() { agent.saves++; } },
        bot: { modes: { anyActive: () => false } },
        isIdle: () => true,
        openChat() {},
        actions: { stop: () => Promise.resolve() },
        // The model's reply comes when the test calls agent.reply().
        handleMessage(source, msg) {
            agent.prompts++;
            return new Promise(resolve => {
                agent.pending = (command) => {
                    agent.pending = null;
                    if (agent.sp.shouldInterrupt(true)) { agent.dropped++; resolve(false); return; }
                    agent.ran.push(command);
                    resolve(true);
                };
            });
        },
        reply(command) { agent.pending?.(command); },
    };
    agent.sp = new SelfPrompter(agent);
    agent.sp.cooldown = 1;
    return agent;
}

test('soak 6 (c): a plain stop while the model\'s reply is in flight drops its command (what the budget stop did)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const a = fakeAgent();
    a.sp.start('a goal');
    await tick();
    assert.equal(a.prompts, 1);
    a.sp.stop(false);
    a.reply('!craftRecipe("pyrotech:tinder", 3)');
    await tick(600);
    assert.deepEqual([a.ran, a.dropped, a.sp.isActive(), a.sp.loop_active], [[], 1, false, false]);
});

test('soak 6 (c): stopAfterTurn lets the reply in flight run its command, then the loop ends (no next prompt)', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...x) => logs.push(x.join(' ')));
    const a = fakeAgent();
    a.sp.start('a goal');
    await tick();
    assert.equal(a.sp.stopAfterTurn('standing goal budget spent'), true, 'a turn is in flight');
    // #508 review 6: STOPPED at once, and saved, so a restart now does not resume it.
    assert.deepEqual([a.sp.isActive(), a.sp.loop_active, a.saves], [false, true, 1]);
    a.reply('!craftRecipe("pyrotech:tinder", 3)');
    await tick(20);
    assert.deepEqual(a.ran, ['!craftRecipe("pyrotech:tinder", 3)'], 'the command ran');
    assert.equal(a.dropped, 0);
    assert.deepEqual([a.prompts, a.sp.isActive(), a.sp.loop_active], [1, false, false], 'no next prompt; stopped');
    assert.ok(logs.includes('[self-prompt] stopping after the turn (standing goal budget spent)'), logs.join('\n'));
    // Started again later: a fresh loop, no stale stop.
    a.sp.start('the next day');
    await tick();
    a.reply('!collectBlocks("dirt", 4)');
    await tick(20);
    assert.equal(a.prompts >= 3, true, 'it prompts on');
    a.sp.stop(false);
    a.reply('!stop');
    await tick(600);
});

// #508 review 4: the turn in flight runs its first command only; a chained second one is not run.
test('#508 review 4: after a stop after the turn, the turn ends after its first command (a chained second command is not run)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const agent = { ran: [], bot: { modes: { anyActive: () => false } }, isIdle: () => true, openChat() {}, actions: { stop: () => Promise.resolve() } };
    let release;
    const gate = new Promise(r => { release = r; });
    // As agent.js: a reply's command runs, then the model is asked again in the same turn while
    // checkInterrupt allows it (two commands chained here).
    agent.handleMessage = async () => {
        let used = false;
        for (const command of ['!craftRecipe("pyrotech:tinder", 3)', '!collectBlocks("dirt", 8)']) {
            if (agent.sp.shouldInterrupt(true)) break;
            if (!used) await gate; // the first reply is in flight when the stop comes
            agent.ran.push(command);
            used = true;
            agent.sp.noteCommandRan(true);
        }
        return used;
    };
    agent.sp = new SelfPrompter(agent);
    agent.sp.start('a goal');
    await tick();
    agent.sp.stopAfterTurn('budget');
    release();
    await tick(20);
    assert.deepEqual(agent.ran, ['!craftRecipe("pyrotech:tinder", 3)']);
    assert.equal(agent.sp.loop_active, false);
});

test('soak 6 (c): stopAfterTurn with no loop running stops at once', () => {
    const a = fakeAgent();
    a.sp.state = 1; // active, loop not started yet
    assert.equal(a.sp.stopAfterTurn('x'), false);
    assert.equal(a.sp.isActive(), false);
});
