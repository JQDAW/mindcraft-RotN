// Offline tests for skills-rotn A2 (no cheat mode on RotN): the bot has no
// operator rights, so cheat mode can be enabled neither by !setMode nor by a
// profile, and the /tp and /setblock branches in skills.js cannot run.
// Fake agent and fake bot; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initModes } from './modes.js';
import { actionsList } from './commands/actions.js';
import * as skills from './library/skills.js';

const GOD_MODE = JSON.parse(readFileSync(new URL('../../profiles/defaults/god_mode.json', import.meta.url), 'utf8'));

// The real ModeController, loaded from a profile's modes the way the agent does.
function realModes(t, profileModes) {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
    const agent = { bot: {}, task: null, prompter: { getInitModes: () => profileModes } };
    initModes(agent);
    return { modes: agent.bot.modes, warnings };
}

const setMode = actionsList.find(c => c.name === '!setMode');

test('a profile with cheat: true (god_mode.json) is ignored with a log line', (t) => {
    assert.equal(GOD_MODE.modes.cheat, true, 'fixture: god_mode.json still asks for cheat');
    const { modes, warnings } = realModes(t, GOD_MODE.modes);
    assert.equal(modes.isOn('cheat'), false);
    assert.equal(modes.getJson().cheat, false);
    // The rest of the profile still applies.
    assert.equal(modes.isOn('idle_staring'), true);
    assert.equal(modes.isOn('self_preservation'), false);
    assert.deepEqual(warnings.filter(w => w.startsWith('[no-cheat]')), [
        '[no-cheat] Profile sets cheat: true; ignored (the bot has no operator rights on this server, so /tp and /setblock cannot work).',
    ]);
});

test('!setMode cheat true is refused and changes nothing', async (t) => {
    const { modes } = realModes(t, { cheat: false });
    const agent = { bot: { modes } };
    const reply = await setMode.perform(agent, 'cheat', true);
    assert.equal(reply, 'Mode cheat is disabled: the bot has no operator rights on this server, so /tp and /setblock cannot work.');
    assert.equal(modes.isOn('cheat'), false);
    assert.equal(await setMode.perform(agent, 'cheat', false), 'Mode cheat is already off.');
});

test('setOn and loadJson cannot turn cheat on; other modes still toggle', (t) => {
    const { modes, warnings } = realModes(t, {});
    assert.equal(modes.setOn('cheat', true), false);
    assert.equal(modes.isOn('cheat'), false);
    assert.ok(warnings.some(w => w.startsWith('[no-cheat] Refused to turn on mode cheat')));
    // A later loadJson (a profile or saved state) cannot do it either.
    modes.loadJson({ cheat: true });
    assert.equal(modes.isOn('cheat'), false);
    assert.equal(modes.setOn('hunting', true), true);
    assert.equal(modes.isOn('hunting'), true);
    modes.setOn('hunting', false);
});

test('cheat mode is not offered to the LLM in the mode docs', (t) => {
    const { modes } = realModes(t, {});
    assert.ok(!modes.getDocs().includes('cheat'));
    assert.ok(!modes.getMiniDocs().includes('cheat'));
    assert.ok(modes.getDocs().includes('self_preservation'));
});

// A fake bot: records chat and fails fast (Sentinel) on anything the skill
// would need beyond the cheat check.
class Sentinel extends Error {}
function fakeBot(modes) {
    const target = {
        modes,
        chats: [],
        output: '',
        username: 'FRCFLD',
        restrict_to_inventory: false,
        interrupt_code: false,
        players: { JQDAW: { entity: null } },
        chat(msg) { target.chats.push(msg); },
        blockAt: (pos) => ({ name: 'stone', position: pos }),
    };
    return new Proxy(target, {
        get(obj, key) {
            if (key in obj) return obj[key];
            if (key === 'then' || typeof key === 'symbol') return undefined;
            throw new Sentinel(`fake bot has no ${String(key)}`);
        },
    });
}

const SKILL_CALLS = {
    breakBlockAt: (bot) => skills.breakBlockAt(bot, 1, 64, 1),
    placeBlock: (bot) => skills.placeBlock(bot, 'stone', 1, 64, 1),
    goToPosition: (bot) => skills.goToPosition(bot, 100, 64, 100),
    goToPlayer: (bot) => skills.goToPlayer(bot, 'JQDAW'),
    tillAndSow: (bot) => skills.tillAndSow(bot, 1, 63, 1, 'wheat_seeds'),
    moveAway: (bot) => skills.moveAway(bot, 10),
};

async function run(call, bot) {
    try {
        await call(bot);
    } catch {
        // Expected: the fake bot ends the skill once it gets past the cheat check.
    }
    await new Promise(r => setTimeout(r, 0)); // tillAndSow's un-awaited placeBlock calls
    return bot.chats;
}

for (const [name, call] of Object.entries(SKILL_CALLS)) {
    test(`${name} sends no /command with the real modes, even after a cheat request`, async (t) => {
        const { modes } = realModes(t, GOD_MODE.modes);
        modes.setOn('cheat', true);
        const chats = await run(call, fakeBot(modes));
        assert.deepEqual(chats.filter(c => c.startsWith('/')), []);
    });
}

// Control: with a stub that says cheat is on, the same calls do reach the
// /tp or /setblock branch, so the tests above exercise the real check.
// (moveAway needs the pathfinder before its /tp, so it has no control.)
for (const name of ['breakBlockAt', 'placeBlock', 'goToPosition', 'goToPlayer', 'tillAndSow']) {
    test(`control: ${name} would send a /command if isOn('cheat') were true`, async (t) => {
        t.mock.method(console, 'warn', () => {});
        const stub = { isOn: (m) => m === 'cheat', pause() {}, unpause() {} };
        const chats = await run(SKILL_CALLS[name], fakeBot(stub));
        assert.ok(chats.some(c => c.startsWith('/tp ') || c.startsWith('/setblock ')), `${name}: ${JSON.stringify(chats)}`);
    });
}
