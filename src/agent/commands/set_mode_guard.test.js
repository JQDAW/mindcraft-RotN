// CX23 soak (rotn-v0.1.3, first-night death spiral): cowardice was off (base profile "assistant"),
// the model turned self_defense off ("since I'm unarmed"), and player zombies killed the unarmed bot
// again and again. The RotN profile turns the survival modes on, and only a task giver who types
// !setMode may turn self_preservation, cowardice or self_defense off; the model is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../agent.js'; // the real import order (commands/index.js first)
import { executeCommand } from './index.js';
import { SURVIVAL_MODES } from './actions.js';

const profile = JSON.parse(readFileSync(new URL('../../../profiles/rotn-bot.json', import.meta.url), 'utf8'));
const assistant = JSON.parse(readFileSync(new URL('../../../profiles/defaults/assistant.json', import.meta.url), 'utf8'));

test('CX23 soak: the RotN profile turns cowardice, self_defense and self_preservation on; its modes replace the base profile\'s whole, so it lists every one', () => {
    for (const m of ['cowardice', 'self_defense', 'self_preservation']) assert.equal(profile.modes?.[m], true, m);
    // prompter.js merges profiles per top-level key: a "modes" object here replaces assistant.json's.
    assert.deepEqual(Object.keys(profile.modes).sort(), Object.keys(assistant.modes).sort(), 'no mode silently dropped');
    for (const [m, on] of Object.entries(assistant.modes)) if (m !== 'cowardice') assert.equal(profile.modes[m], on, `${m} as the base profile has it`);
    assert.equal(profile.modes.cheat, false);
});

function modesAgent() {
    const on = { self_preservation: true, cowardice: true, self_defense: true, hunting: false, item_collecting: true };
    return {
        on,
        bot: { modes: {
            exists: (m) => m in on, isDisabled: () => false, isOn: (m) => on[m], setOn: (m, v) => { on[m] = v; },
            getDocs: () => '',
        } },
    };
}

test('CX23 soak: the model cannot turn a survival mode off (refused, with a journal line); a task giver who types it can', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    assert.deepEqual(SURVIVAL_MODES, ['self_preservation', 'cowardice', 'self_defense']);
    const agent = modesAgent();
    for (const m of SURVIVAL_MODES) {
        // The model's command: no sender in the context (agent.js passes { sender } only for a giver's typed command).
        assert.equal(await executeCommand(agent, `!setMode("${m}", false)`), `Mode ${m} stays on: it keeps you alive, and only a task giver may turn it off.`);
        assert.equal(agent.on[m], true, `${m} still on`);
        assert.ok(logs.includes(`[modes] refused: the model asked to turn ${m} off; only a task giver may`), logs.join('\n'));
    }
    // A task giver's typed command.
    assert.equal(await executeCommand(agent, '!setMode("cowardice", false)', { sender: 'JQDAW' }), 'Mode cowardice is now off.');
    assert.equal(agent.on.cowardice, false);
    // The model may turn it on again, and may switch the other modes either way.
    assert.equal(await executeCommand(agent, '!setMode("cowardice", true)'), 'Mode cowardice is now on.');
    assert.equal(await executeCommand(agent, '!setMode("item_collecting", false)'), 'Mode item_collecting is now off.');
    assert.equal(await executeCommand(agent, '!setMode("hunting", true)'), 'Mode hunting is now on.');
    // A survival mode a giver turned off: the model turning it off again is just "already off".
    await executeCommand(agent, '!setMode("self_defense", false)', { sender: 'JQDAW' });
    assert.equal(await executeCommand(agent, '!setMode("self_defense", false)'), 'Mode self_defense is already off.');
});
