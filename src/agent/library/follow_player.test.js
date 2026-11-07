// G4 item 3 prep (test/scenarios/g4/PLAN.md, g4-control-commands): "follows a player, comes when
// called" on 1.12.2 with RotN's pathfinder settings. Offline: a flat fake world on the 1.12.2
// registry, a fake pathfinder and players; no server, no LLM.
// Gaps found: an unknown player (or the wrong case, "jqdaw") threw a TypeError in both skills; the
// follow walked with plain movements, not the fall-safe ones every other walk uses (G3 round 4 B: no
// drop over 3 blocks, never a broken Dynamic Trees branch, which fells the tree); a follow went on
// after the player left; goToPlayer said "You have reached" after a walk that was stopped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import * as skills from './skills.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const T = { timeout: 10_000 };

/** players: { name: position or null (online, out of sight) }. arrive: whether a walk gets there. */
function fakeBot({ players = { JQDAW: at(6) }, arrive = true } = {}) {
    const calls = { moves: [], goals: [], stops: 0, paused: [] };
    const bot = {
        calls, registry: reg, version: '1.12.2', output: '', interrupt_code: false, username: 'FRCFLD',
        game: { gameMode: 'survival', minY: 0 },
        entity: { position: at(0).offset(0.5, 0, 0.5), eyeHeight: 1.62, height: 1.8 },
        entities: {}, heldItem: null,
        players: {},
        modes: { isOn: () => false, pause(m) { calls.paused.push(m); }, unpause() {} },
        inventory: { items: () => [], slots: [] },
        blockAt: (p) => {
            const q = p.floored ? p.floored() : p;
            const name = q.y < 64 ? 'dirt' : 'air';
            return { name, metadata: 0, type: reg.blocksByName[name].id, position: q, boundingBox: name === 'air' ? 'empty' : 'block', shapes: [] };
        },
        findBlocks: () => [],
        pathfinder: {
            setMovements(m) { bot._moves = m; calls.moves.push(m); },
            setGoal(goal) { calls.goals.push(goal); },
            stop() { calls.stops++; },
            isMoving: () => false,
            getPathTo: () => ({ status: 'success', path: [] }),
            goto() {
                if (!arrive) { const e = new Error('Path was stopped before it could be completed!'); e.name = 'PathStopped'; return Promise.reject(e); }
                return Promise.resolve();
            },
        },
    };
    for (const [name, pos] of Object.entries(players))
        bot.players[name] = { username: name, entity: pos ? { position: pos, username: name, type: 'player' } : null };
    return bot;
}

test('findPlayer: the exact name, else one that differs only in case; else null', () => {
    const bot = fakeBot({ players: { JQDAW: at(6), Alex: at(9) } });
    assert.equal(skills.findPlayer(bot, 'JQDAW')?.username, 'JQDAW');
    assert.equal(skills.findPlayer(bot, 'jqdaw')?.username, 'JQDAW', 'the model may write the name in lower case');
    assert.equal(skills.findPlayer(bot, 'Steve'), null);
    assert.equal(skills.findPlayer(bot, ''), null);
});

test('G4 #3: goToPlayer: an unknown player or one out of sight is a clear message, not a TypeError; a name in the wrong case works', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ players: { JQDAW: at(6), Far: null } });
    assert.equal(await skills.goToPlayer(bot, 'Steve'), false);
    assert.match(bot.output, /Could not find Steve: not online, or too far away to see\./);
    assert.equal(await skills.goToPlayer(bot, 'Far'), false);
    assert.match(bot.output, /Could not find Far: not online, or too far away to see\./);
    assert.equal(await skills.goToPlayer(bot, 'jqdaw', 2), true);
    assert.match(bot.output, /You have reached JQDAW\./);
});

test('G4 #3: goToPlayer walks fall-safe, and a stopped walk does not say "reached"', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ arrive: false });
    assert.equal(await skills.goToPlayer(bot, 'JQDAW', 2), false);
    assert.doesNotMatch(bot.output, /You have reached/);
    assert.match(bot.output, /Did not reach JQDAW\./);
    assert.ok(bot.calls.moves.length > 0 && bot.calls.moves.every(m => m.rotnFallSafe), 'every walk is fall-safe');
});

test('G4 #3: followPlayer: an unknown player is a clear message, not a TypeError', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot();
    assert.equal(await skills.followPlayer(bot, 'Steve'), false);
    assert.match(bot.output, /Could not find Steve: not online, or too far away to see\./);
    assert.equal(bot.calls.goals.length, 0, 'no walk');
});

test('G4 #3: followPlayer walks with the fall-safe movements (no drop over 3, no broken branch) and follows a name in the wrong case', T, async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot();
    setTimeout(() => { bot.interrupt_code = true; }, 700); // a !stop
    assert.equal(await skills.followPlayer(bot, 'jqdaw', 3), true);
    assert.match(bot.output, /You are now actively following player JQDAW\./);
    assert.ok(bot.calls.moves.length > 0);
    for (const m of bot.calls.moves) {
        assert.equal(m.rotnFallSafe, true, 'fall-safe');
        assert.equal(m.maxDropDown, 4, 'no drop over 3 blocks');
        assert.equal(m.digCost, 10, 'digging stays costly, as upstream set it');
    }
    assert.equal(bot.calls.goals[0].entity, bot.players.JQDAW.entity);
});

test('G4 #3: followPlayer ends when the player leaves (or goes out of sight), and stops the walk', T, async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot();
    setTimeout(() => { delete bot.players.JQDAW; }, 700);
    setTimeout(() => { bot.interrupt_code = true; }, 4000); // a safety net: the test must not hang
    assert.equal(await skills.followPlayer(bot, 'JQDAW', 3), false);
    assert.equal(bot.interrupt_code, false, 'it ended by itself, before the safety net');
    assert.match(bot.output, /Stopped following JQDAW: they left, or are too far away to see\./);
    assert.ok(bot.calls.stops >= 1, 'the follow goal is cleared');
});

test('G4 #3: followPlayer keeps following when the player\'s entity is replaced (a respawn, or back in sight)', T, async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot();
    const first = bot.players.JQDAW.entity;
    setTimeout(() => { bot.players.JQDAW.entity = { position: at(20), username: 'JQDAW', type: 'player' }; }, 600);
    setTimeout(() => { bot.interrupt_code = true; }, 1600);
    assert.equal(await skills.followPlayer(bot, 'JQDAW', 3), true);
    assert.equal(bot.calls.goals[0].entity, first);
    assert.equal(bot.calls.goals.at(-1).entity, bot.players.JQDAW.entity, 'the goal follows the new entity');
});
