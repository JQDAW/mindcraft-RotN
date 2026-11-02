// Behavioural tests (skills-rotn A3, made behavioural in A4 per the #109
// review): a successful !smeltItem no longer restarts the process, and the
// login handler sends no /skin command. Fake agent, bot and furnace on the
// 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../utils/mcdata.js';
// agent.js first: it loads commands/index.js before actions.js, as the real agent
// does (importing actions.js first hits the index.js <-> actions.js cycle).
import { Agent } from './agent.js';
import { actionsList } from './commands/actions.js';

const registry = minecraftData('1.12.2');
__setRegistryForTest(registry);

function smeltingAgent() {
    const calls = { cleanKill: [], chat: [] };
    const furnacePos = new Vec3(1, 64, 0);
    const coal = { type: registry.itemsByName.coal.id, name: 'coal', count: 5 };
    let output = { type: registry.itemsByName.coal.id, name: 'coal', count: 1, metadata: 1 }; // charcoal
    const furnace = {
        inputItem: () => null,
        fuelItem: () => coal,
        outputItem: () => output,
        takeOutput: () => { const o = output; output = null; return Promise.resolve(o); },
        putInput: () => Promise.resolve(),
        takeInput: () => Promise.resolve(),
        takeFuel: () => Promise.resolve(),
    };
    const log = { type: registry.itemsByName.log.id, name: 'log', count: 1 };
    const bot = {
        registry,
        output: '',
        interrupt_code: false,
        entity: { position: new Vec3(0, 64, 0) },
        modes: { pause() {}, unpause() {}, isOn: () => false },
        inventory: { slots: [log], items: () => [log] },
        findBlocks: () => [furnacePos],
        blockAt: (pos) => ({ name: 'furnace', type: registry.blocksByName.furnace.id, position: pos }),
        lookAt: () => Promise.resolve(),
        openFurnace: () => Promise.resolve(furnace),
        closeWindow: () => Promise.resolve(),
        chat: (msg) => { calls.chat.push(msg); },
    };
    const agent = {
        name: 'FRCFLD',
        bot,
        calls,
        cleanKill: (...args) => { calls.cleanKill.push(args); },
        actions: {
            runAction: async (label, fn) => {
                await fn();
                return { success: true, message: bot.output, interrupted: false, timedout: false };
            },
        },
    };
    return agent;
}

test('a successful !smeltItem does not restart the process (no cleanKill, even after upstream\'s 500 ms timer)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const smelt = actionsList.find(c => c.name === '!smeltItem');
    const agent = smeltingAgent();

    const reply = await smelt.perform(agent, 'log', 1);

    assert.match(reply, /Successfully smelted log/, 'the smelt itself succeeded');
    await new Promise(r => setTimeout(r, 700)); // upstream called cleanKill 500 ms after success
    assert.deepEqual(agent.calls.cleanKill, []);
    assert.deepEqual(agent.calls.chat, []);
});

test('the login handler sends no /skin command, even with a skin in the profile', (t) => {
    t.mock.method(console, 'log', () => {});
    const chats = [];
    let logins = 0;
    const agent = {
        name: 'FRCFLD',
        bot: { chat: (msg) => chats.push(msg) },
        prompter: { profile: { skin: { model: 'classic', path: 'https://example.invalid/skin.png' } } },
    };

    Agent.prototype.onLogin.call(agent, { proxy: { login: () => { logins++; } } });

    assert.deepEqual(chats, []);
    assert.equal(logins, 1, 'the MindServer is still told about the login');
});

test('the login wiring: a "login" event on the bot runs onLogin, which sends no /skin', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { EventEmitter } = await import('node:events');
    const chats = [];
    let logins = 0;
    const bot = new EventEmitter();
    bot.chat = (msg) => chats.push(msg);
    const agent = Object.create(Agent.prototype);
    Object.assign(agent, {
        name: 'FRCFLD',
        bot,
        prompter: { profile: { skin: { model: 'classic', path: 'https://example.invalid/skin.png' } } },
    });
    // The real onLogin, with the MindServer proxy replaced (no socket in a test).
    agent.onLogin = function () { return Agent.prototype.onLogin.call(this, { proxy: { login: () => { logins++; } } }); };

    agent.bindLoginHandler();
    assert.equal(bot.listenerCount('login'), 1);
    bot.emit('login');

    assert.equal(logins, 1);
    assert.deepEqual(chats, []);
});
