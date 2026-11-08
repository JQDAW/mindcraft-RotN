// G4 #5: the "[survival]" journal lines the soak counts (survival_log.js). The formats are a contract
// with harness-ops' parser: these tests pin each one exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import {
    ateLine, fightStartLine, fightEndLine, fleeLine, foodLine, mobName, foodCheck, logAte, fightJournal, bindSurvivalLog,
    FOOD_LOG_MS, FOOD_UPDATE_MS, FIGHT_OUTCOMES,
} from './survival_log.js';
import * as skills from './skills.js';

__setRegistryForTest(minecraftData('1.12.2'));

// The parser harness-ops can use: one regex per line kind.
const SURVIVAL_RE = {
    ate: /^\[survival\] ate (\S+) food (\d+(?:\.\d+)?|unknown)->(\d+(?:\.\d+)?|unknown)$/,
    fightStart: /^\[survival\] fight start (\S+) \((open|shelter)\)$/,
    fightEnd: /^\[survival\] fight end (\S+) (killed|gone|stopped|capped|interrupted|died) after (\d+) s$/,
    flee: /^\[survival\] flee (\S+) \(([^()]+)\)$/,
    food: /^\[survival\] food (\d+(?:\.\d+)?) health (\d+(?:\.\d+)?|unknown) \((check|low)\)$/,
};

const capture = (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    return logs;
};
const survival = (logs) => logs.filter(l => l.startsWith('[survival] '));

test('G4 #5: the exact line formats', () => {
    assert.equal(ateLine('rustic:wildberries:0', 12, 13), '[survival] ate rustic:wildberries:0 food 12->13');
    assert.equal(fightStartLine('zombie', 'open'), '[survival] fight start zombie (open)');
    assert.equal(fightStartLine('zombie_players:zombie_player', 'shelter'), '[survival] fight start zombie_players:zombie_player (shelter)');
    assert.equal(fightEndLine('zombie', 'killed', 4400), '[survival] fight end zombie killed after 4 s');
    assert.throws(() => fightEndLine('zombie', 'won', 1), /unknown fight outcome/);
    assert.equal(fleeLine('creeper', 'explodes'), '[survival] flee creeper (explodes)');
    assert.equal(fleeLine('zombie', 'two or more (melee) at once'), '[survival] flee zombie (two or more  melee  at once)');
    assert.equal(foodLine(14, 17.5, 'check'), '[survival] food 14 health 17.5 (check)');
    assert.equal(foodLine(12, 20, 'low'), '[survival] food 12 health 20 (low)');
    // Every line matches its parser regex; tokens never hold spaces.
    assert.match(ateLine('bread:0', 3, 6), SURVIVAL_RE.ate);
    assert.match(fightStartLine('skeleton', 'shelter'), SURVIVAL_RE.fightStart);
    for (const o of FIGHT_OUTCOMES) assert.match(fightEndLine('spider', o, 12_345), SURVIVAL_RE.fightEnd);
    assert.match(fleeLine('creeper', 'explodes'), SURVIVAL_RE.flee);
    assert.match(foodLine(5, 9.25, 'low'), SURVIVAL_RE.food);
});

test('G4 #5: no secrets or custom text: a mob is its entity type, a player is "player", odd characters become _', () => {
    assert.equal(mobName({ name: 'zombie', type: 'mob', displayName: 'Bob the Zombie' }), 'zombie');
    assert.equal(mobName({ name: 'JQDAW', username: 'JQDAW', type: 'player' }), 'player');
    assert.equal(mobName({ name: 'weird name (x)', type: 'mob' }), 'weird_name__x_');
    assert.equal(mobName(null), 'unknown');
    assert.equal(ateLine('a b', 1, 2), '[survival] ate a_b food 1->2');
    assert.equal(fleeLine('zombie', 'a (b)\nc'), '[survival] flee zombie (a  b  c)');
});

test('G4 #5: the food line: at most once a minute ("check"), and "low" when it falls to the eat threshold (also at most once a minute)', (t) => {
    const logs = capture(t);
    const state = {}, bot = { food: 20, health: 20, isAlive: true };
    assert.equal(foodCheck(state, bot, 0, 12), '[survival] food 20 health 20 (check)');
    for (let now = 1000; now < FOOD_LOG_MS; now += 1000) assert.equal(foodCheck(state, bot, now, 12), null, `nothing at ${now}`);
    bot.food = 13;
    assert.equal(foodCheck(state, bot, FOOD_LOG_MS, 12), '[survival] food 13 health 20 (check)');
    bot.food = 12; // falls to the threshold: said at once
    assert.equal(foodCheck(state, bot, FOOD_LOG_MS + 5000, 12), '[survival] food 12 health 20 (low)');
    bot.food = 15; foodCheck(state, bot, FOOD_LOG_MS + 6000, 12);
    bot.food = 11; // falls again within the minute: not said again
    assert.equal(foodCheck(state, bot, FOOD_LOG_MS + 7000, 12), null);
    assert.equal(foodCheck(state, bot, 2 * FOOD_LOG_MS + 5000, 12), '[survival] food 11 health 20 (check)', 'the next minute\'s check');
    // Dead: nothing (the respawn's food is not a fall).
    Object.assign(bot, { health: 0, isAlive: false });
    assert.equal(foodCheck(state, bot, 10 * FOOD_LOG_MS, 12), null);
    assert.ok(survival(logs).every(l => SURVIVAL_RE.food.test(l)), logs.join('\n'));
    assert.equal(survival(logs).length, 4);
});

test('G4 #5: bindSurvivalLog checks the food on health updates and physics ticks', (t) => {
    const logs = capture(t);
    const handlers = {};
    const bot = { food: 18, health: 20, isAlive: true, on: (ev, fn) => { handlers[ev] = fn; } };
    bindSurvivalLog(bot, { eatAt: 12 });
    handlers.physicsTick();
    handlers.physicsTick();
    bot.food = 12;
    handlers.health();
    assert.deepEqual(survival(logs), ['[survival] food 18 health 20 (check)', '[survival] food 12 health 20 (low)']);
});

test('G4 #5: the eat line waits for the food level to change (at most FOOD_UPDATE_MS), then gives before->after', async (t) => {
    const logs = capture(t);
    const bot = { food: 12 };
    setTimeout(() => { bot.food = 15; }, 100);
    await logAte(bot, 'bread:0', 12);
    assert.deepEqual(survival(logs), ['[survival] ate bread:0 food 12->15']);
    const stuck = { food: 20 };
    const start = Date.now();
    await logAte(stuck, 'apple:0', 20);
    assert.ok(Date.now() - start <= FOOD_UPDATE_MS + 200);
    assert.equal(survival(logs).at(-1), '[survival] ate apple:0 food 20->20');
});

test('G4 #5: the consume skill (a command\'s eat) logs the same line, with food.foodKey\'s item form', async (t) => {
    const logs = capture(t);
    const bread = { name: 'bread', metadata: 0, count: 2, type: 297 };
    const bot = {
        food: 10, output: '', inventory: { items: () => [bread], slots: [] },
        equip: () => Promise.resolve(),
        consume: () => { bread.count--; setTimeout(() => { bot.food = 13; }, 50); return Promise.resolve(); },
    };
    assert.equal(await skills.consume(bot, 'bread'), true);
    assert.deepEqual(survival(logs), ['[survival] ate minecraft:bread:0 food 10->13']);
    assert.match(survival(logs)[0], SURVIVAL_RE.ate);
});

test('G4 #5: a fight\'s outcome: killed when the first mob is dead or gone from the world, died when the bot is, else the caller\'s', (t) => {
    const logs = capture(t);
    const zombie = { id: 7, name: 'zombie', type: 'mob' };
    const bot = { entities: { 7: zombie }, health: 20, isAlive: true };
    const j = fightJournal(bot, 'open');
    j.end('gone');
    assert.deepEqual(survival(logs), [], 'no start, no end');
    j.start(zombie);
    j.start({ id: 8, name: 'skeleton' }); // a later enemy: still one fight, named by its first
    j.end('gone'); // the zombie is still there: it walked off
    j.end('stopped'); // once only
    delete bot.entities[7];
    const k = fightJournal(bot, 'shelter');
    k.start(zombie);
    k.end('gone');
    const d = fightJournal(bot, 'open');
    d.start({ id: 9, name: 'spider' });
    Object.assign(bot, { health: 0, isAlive: false });
    d.end('stopped');
    assert.deepEqual(survival(logs), [
        '[survival] fight start zombie (open)', '[survival] fight end zombie gone after 0 s',
        '[survival] fight start zombie (shelter)', '[survival] fight end zombie killed after 0 s',
        '[survival] fight start spider (open)', '[survival] fight end spider died after 0 s',
    ]);
});

test('G4 #5: defendSelf (a fight in the open) logs its start and end: killed', async (t) => {
    const logs = capture(t);
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0.5, 64, 0.5), height: 1.8 };
    const zombie = { id: 1, name: 'zombie', type: 'mob', position: new Vec3(2.5, 64, 0.5), height: 1.8 };
    let hits = 0;
    const bot = {
        entity: self, entities: { 0: self, 1: zombie }, health: 20, isAlive: true, interrupt_code: false, output: '',
        inventory: { items: () => [], slots: [] }, heldItem: null, equip: () => Promise.resolve(),
        pvp: { attack: () => { if (++hits >= 2) delete bot.entities[1]; }, stop() {} },
        pathfinder: { setMovements() {}, setGoal() {}, stop() {}, goto: () => Promise.resolve(), isMoving: () => false },
        modes: { pause() {}, unpause() {}, isOn: () => false },
        nearestEntity: (match) => Object.values(bot.entities).filter(e => e !== self && match(e))[0] ?? null,
    };
    assert.equal(await skills.defendSelf(bot, 8, (e) => e.name === 'zombie'), true);
    assert.deepEqual(survival(logs).map(l => l.replace(/after \d+ s/, 'after N s')), ['[survival] fight start zombie (open)', '[survival] fight end zombie killed after N s']);
});
