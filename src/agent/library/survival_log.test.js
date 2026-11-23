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
import { readFileSync } from 'fs';

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

// Soak 12 (C): an unarmed fight also logs, once, why no weapon is in hand (equipHighestAttack).
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
    assert.deepEqual(survival(logs).map(l => l.replace(/after \d+ s/, 'after N s')), ['[survival] no weapon in hand: none held; holding nothing', '[survival] fight start zombie (open)', '[survival] weapon hand (open)', '[survival] fight end zombie killed after N s']);
});

/** A defendSelf bot: a zombie `at` blocks away; calls (walks, attacks) go into `logs` in order. */
function openFight(logs, { at = 2, attack = () => {} } = {}) {
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0.5, 64, 0.5), height: 1.8 };
    const zombie = { id: 1, name: 'zombie', type: 'mob', position: new Vec3(at + 0.5, 64, 0.5), height: 1.8 };
    const bot = {
        entity: self, entities: { 0: self, 1: zombie }, health: 20, isAlive: true, interrupt_code: false, output: '',
        registry: minecraftData('1.12.2'), version: '1.12.2', world: { getBlock: () => null }, blockAt: () => null,
        inventory: { items: () => [], slots: [] }, heldItem: null, equip: () => Promise.resolve(),
        pvp: { attack: (e) => { logs.push('<attack>'); attack(bot, e); }, stop() {} },
        pathfinder: { setMovements() {}, setGoal() {}, stop() {}, goto: () => { logs.push('<walk>'); return Promise.resolve(); }, isMoving: () => false },
        modes: { pause() {}, unpause() {}, isOn: () => false },
        nearestEntity: (match) => Object.values(bot.entities).filter(e => e !== self && match(e))[0] ?? null,
    };
    return bot;
}

test('#384 nit 1: defendSelf logs the fight start at its first attack, after the equip and the walk to the mob', async (t) => {
    const logs = capture(t);
    let hits = 0;
    const bot = openFight(logs, { at: 5, attack: (b) => { if (++hits >= 1) delete b.entities[1]; } });
    assert.equal(await skills.defendSelf(bot, 8, (e) => e.name === 'zombie'), true);
    const seq = logs.filter(l => l.startsWith('<') || l.startsWith('[survival] ')).map(l => l.replace(/after \d+ s/, 'after N s'));
    assert.deepEqual(seq, ['[survival] no weapon in hand: none held; holding nothing', '<walk>', '[survival] fight start zombie (open)', '[survival] weapon hand (open)', '<attack>', '[survival] fight end zombie killed after N s']);
});

test('#384 nit 2: a defendSelf fight that throws after its start still logs its end (interrupted)', async (t) => {
    const logs = capture(t);
    let hits = 0;
    const bot = openFight(logs, { attack: () => { if (++hits === 2) throw new Error('the server closed the window'); } });
    await assert.rejects(skills.defendSelf(bot, 8, (e) => e.name === 'zombie'), /closed the window/);
    assert.deepEqual(survival(logs).map(l => l.replace(/after \d+ s/, 'after N s')),
        ['[survival] no weapon in hand: none held; holding nothing', '[survival] fight start zombie (open)', '[survival] weapon hand (open)', '[survival] fight end zombie interrupted after N s']);
    // A stop (interrupt_code) after the start: one end, interrupted; nothing logged without an attack.
    const stopped = [];
    t.mock.method(console, 'log', (...a) => stopped.push(a.join(' ')));
    const b2 = openFight(stopped, { attack: (b) => { b.interrupt_code = true; } });
    assert.equal(await skills.defendSelf(b2, 8, (e) => e.name === 'zombie'), false);
    assert.deepEqual(survival(stopped).map(l => l.replace(/after \d+ s/, 'after N s')),
        ['[survival] no weapon in hand: none held; holding nothing', '[survival] fight start zombie (open)', '[survival] weapon hand (open)', '[survival] fight end zombie interrupted after N s']);
    const none = [];
    t.mock.method(console, 'log', (...a) => none.push(a.join(' ')));
    const b3 = openFight(none);
    b3.entities = { 0: b3.entity };
    assert.equal(await skills.defendSelf(b3, 8, (e) => e.name === 'zombie'), false);
    assert.deepEqual(survival(none), [], 'no enemy: no fight lines');
});

test('#384 nit 4: agent.js wires the food line (bindSurvivalLog with the eat threshold) once, after the bot is made', () => {
    const src = readFileSync(new URL('../agent.js', import.meta.url), 'utf8');
    assert.equal(src.split('bindSurvivalLog(this.bot, { eatAt: EAT_AT })').length - 1, 1, 'called once, with food.EAT_AT');
    assert.match(src, /import \{ bindSurvivalLog \} from '\.\/library\/survival_log\.js';/);
    assert.match(src, /import \{ EAT_AT \} from '\.\/library\/food\.js';/);
    assert.ok(src.indexOf('this.bot = initBot(') < src.indexOf('bindSurvivalLog(this.bot'), 'after initBot');
});


// Soak 2 (rotn-v0.1.4): the server sends no death messages; two deaths had no cause in the journal.
test('soak 2: a hurt line when health falls by 4 or more within 2 s, with the likely source (starving, the nearest mob, a fall)', async (t) => {
    const { hurtCheck, hurtLine, HURT } = await import('./survival_log.js');
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    assert.equal(hurtLine(6, 20, 14, 'zombie'), '[survival] hurt 6 health 20->14 (by zombie)');
    assert.deepEqual(HURT, { minDrop: 4, windowMs: 2000, mobRange: 5, swingMs: 1000, fallingRange: 4, detailRange: 16, detailMobs: 3 });
    const here = new Vec3(0, 64, 0);
    const bot = { health: 20, food: 12, entity: { position: here, velocity: { y: 0 } }, entities: {} };
    const state = {};
    hurtCheck(state, bot, 0);
    bot.health = 18; assert.equal(hurtCheck(state, bot, 500), null, '2 is not enough');
    bot.entities = { 3: { id: 3, type: 'mob', name: 'slime', position: here.offset(2, 0, 0) } };
    bot.health = 15; assert.equal(hurtCheck(state, bot, 900), '[survival] hurt 5 health 20->15 (by slime)', 'two hits within the window add up');
    bot.health = 13; assert.equal(hurtCheck(state, bot, 5000), null, 'a quiet window starts again from the last health seen (15): 2 is not enough');
    bot.entities = {};
    // Starving: food 0 (Hunger Overhaul's 200 damage).
    bot.food = 0; bot.health = 0; assert.equal(hurtCheck(state, bot, 5100), '[survival] hurt 15 health 15->0 (by starving)');
    // A fall, with no mob near.
    const fall = { health: 20, food: 10, entity: { position: here, velocity: { y: -1.2 } }, entities: {} };
    const s2 = {};
    hurtCheck(s2, fall, 0);
    fall.health = 12; assert.equal(hurtCheck(s2, fall, 100), '[survival] hurt 8 health 20->12 (by fall)');
    // Soak 5: each hurt line is followed by its detail line.
    assert.equal(lines.length, 6);
    assert.equal(lines[1], '[survival] hurt-detail drops 2@+0.5s,3@+0.9s at 0,64,0 vy 0 unknown cause none near slime@2m');
});

test('#432 review 1: a single hit, a fall or starving after a quiet spell is caught (the window starts from the last health seen)', async (t) => {
    const { hurtCheck } = await import('./survival_log.js');
    t.mock.method(console, 'log', () => {});
    const here = new Vec3(0, 64, 0);
    // One 4-damage hit after 30 s of quiet.
    const bot = { health: 20, food: 12, entity: { position: here, velocity: { y: 0 } }, entities: { 2: { id: 2, type: 'mob', name: 'animania:bull_holstein', position: here.offset(1, 0, 0) } } };
    const state = {};
    hurtCheck(state, bot, 0);
    bot.health = 16;
    assert.equal(hurtCheck(state, bot, 30_000), '[survival] hurt 4 health 20->16 (by animania:bull_holstein)');
    // Food reaches 0 at 60 s (no health change); the starve damage comes 4 s later, all at once.
    bot.entities = {};
    bot.food = 0;
    assert.equal(hurtCheck(state, bot, 60_000), null, 'no damage yet');
    bot.health = 0;
    assert.equal(hurtCheck(state, bot, 64_000), '[survival] hurt 16 health 16->0 (by starving)');
});

// Soak 3 (rotn-v0.1.5): hurt lines named zombieawareness:entityscent (the invisible scent marker on
// the bot's own trail) and randomthings:playersoul (a death spot's soul) while zombies hit.
test('soak 3: the hurt source is an entity that can hurt; scent markers and souls never are', async (t) => {
    const { hurtSource, mayHurt } = await import('./survival_log.js');
    t.mock.method(console, 'log', () => {});
    const here = new Vec3(0, 64, 0);
    const scent = { id: 1, type: 'mob', name: 'zombieawareness:entityscent', position: here.offset(0.2, 0, 0) };
    const soul = { id: 2, type: 'mob', name: 'randomthings:playersoul', position: here.offset(0.5, 0, 0) };
    const zombie = { id: 3, type: 'mob', name: 'zombie', position: here.offset(2, 0, 0) };
    const bot = (...es) => ({ health: 14, food: 12, entity: { position: here, velocity: { y: 0 } }, entities: Object.fromEntries(es.map(e => [e.id, e])) });
    assert.equal(mayHurt(scent), false);
    assert.equal(mayHurt(soul), false);
    assert.equal(mayHurt(zombie), true);
    assert.equal(mayHurt({ id: 9, type: 'player', name: 'player' }), true, 'a player can');
    assert.equal(mayHurt({ id: 9, type: 'mob', name: 'animania:bull_holstein' }), true, 'a bull fights back when provoked (rotn-data #448)');
    assert.equal(mayHurt({ id: 9, type: 'mob', name: 'animania:cow_holstein' }), true, 'and so does a Holstein cow');
    assert.equal(mayHurt({ id: 9, type: 'mob', name: 'sheep' }), false, 'a sheep never hurts');
    assert.equal(mayHurt({ id: 9, type: 'object', name: 'arrow' }), false);
    assert.equal(hurtSource(bot(scent, soul, zombie)), 'zombie', 'the zombie, though the marker and the soul are nearer');
    assert.equal(hurtSource(bot(scent, soul)), 'unknown', 'markers alone: unknown, not a marker');
    const falling = bot(scent, soul);
    falling.entity.velocity.y = -1;
    assert.equal(hurtSource(falling), 'fall');
});

test('soak 3: the entity that swung in the last HURT.swingMs is named first, else the nearest hostile, else the nearest that can hurt', async (t) => {
    const { hurtSource, noteSwing, HURT } = await import('./survival_log.js');
    t.mock.method(console, 'log', () => {});
    const here = new Vec3(0, 64, 0);
    const zombie = { id: 3, type: 'mob', name: 'zombie', position: here.offset(2, 0, 0) };
    const zp = { id: 4, type: 'mob', name: 'zombie_players:zombie_player', position: here.offset(0, 0, 4) };
    const player = { id: 5, type: 'player', name: 'player', username: 'Someone', position: here.offset(1, 0, 0) };
    const bull = { id: 6, type: 'mob', name: 'animania:bull_holstein', position: here.offset(1, 0, 1) };
    const bot = (...es) => ({ health: 14, food: 12, entity: { position: here, velocity: { y: 0 } }, entities: Object.fromEntries(es.map(e => [e.id, e])) });
    const swings = new Map();
    noteSwing(swings, zp, 10_000);
    assert.equal(hurtSource(bot(zombie, zp), { swings, now: 10_300 }), 'zombie_players:zombie_player', 'it swung 0.3 s ago; the nearer zombie did not');
    assert.equal(hurtSource(bot(zombie, zp), { swings, now: 10_000 + HURT.swingMs + 1 }), 'zombie', 'a swing older than swingMs: the nearest hostile');
    assert.equal(hurtSource(bot(player, zombie)), 'zombie', 'a hostile mob before a nearer player that did not swing');
    noteSwing(swings, player, 20_000);
    assert.equal(hurtSource(bot(player, zombie), { swings, now: 20_100 }), 'player', 'a player that swung (never its name)');
    assert.equal(hurtSource(bot(bull)), 'animania:bull_holstein', 'only a provoked-fighter near: it');
    const far = { ...zp, id: 7, position: here.offset(HURT.mobRange + 1, 0, 0) };
    noteSwing(swings, far, 30_000);
    assert.equal(hurtSource(bot(far), { swings, now: 30_100 }), 'unknown', 'a swing beyond mobRange does not count');
    // The swing map stays small: old swings go once it holds more than 64.
    const many = new Map();
    for (let i = 0; i < 70; i++) noteSwing(many, { id: 100 + i }, i);
    noteSwing(many, { id: 1 }, 50_000);
    assert.deepEqual([...many.keys()], [1]);
});

test('soak 3: bindSurvivalLog notes arm swings, and the hurt line names the swinger', async (t) => {
    const { EventEmitter } = await import('node:events');
    const logs = capture(t);
    const here = new Vec3(0, 64, 0);
    const scent = { id: 1, type: 'mob', name: 'zombieawareness:entityscent', position: here.offset(0.1, 0, 0) };
    const zombie = { id: 3, type: 'mob', name: 'zombie', position: here.offset(1, 0, 0) };
    const zp = { id: 4, type: 'mob', name: 'zombie_players:zombie_player', position: here.offset(0, 0, 2) };
    const bot = Object.assign(new EventEmitter(), { health: 20, food: 12, entity: { position: here, velocity: { y: 0 } }, entities: { 1: scent, 3: zombie, 4: zp } });
    bindSurvivalLog(bot, { eatAt: 12 });
    bot.emit('health');
    bot.emit('entitySwingArm', zp);
    bot.health = 14;
    bot.emit('health');
    assert.ok(logs.includes('[survival] hurt 6 health 20->14 (by zombie_players:zombie_player)'), logs.join('\n'));
});

// Soak 5 (rotn-v0.1.11): 01:42:52 "hurt 17 (by unknown)" was the landing after a 24-block drop;
// 00:59:54 "hurt 18.5 (by zombie)" was several zombies within the 2 s window. The damage record's
// fall comes first, a falling block or tree is named, and a detail line lists each drop, where the
// bot is and the nearest entities that can hurt (up to 16 blocks: an attacker out of the 5-block range).
test('soak 5: a landing after a big drop is a fall (damage_record), even with a mob near; a falling tree is named; the detail line', async (t) => {
    const { hurtCheck, hurtSource, hurtDetail } = await import('./survival_log.js');
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const here = new Vec3(8.5, 61, -117.5);
    const zombie = { id: 4, type: 'mob', name: 'zombie', position: here.offset(2, 0, 0) };
    const bot = { health: 20, food: 13, entity: { position: here, velocity: { y: 0 }, onGround: true }, entities: { 4: zombie } };
    const state = {};
    hurtCheck(state, bot, 1000);
    Object.assign(bot, { health: 3, lastDamageCause: 'fall', lastDamageTime: 1100 });
    assert.equal(hurtCheck(state, bot, 1100), '[survival] hurt 17 health 20->3 (by fall)', 'the landing, not the zombie near');
    assert.equal(lines.at(-1), '[survival] hurt-detail drops 17@+0.1s at 8.5,61,-117.5 vy 0 ground cause fall near zombie@2m');
    // An old fall record does not count.
    assert.equal(hurtSource({ ...bot, lastDamageTime: 1100 - 5000 }, { now: 1100 }), 'zombie');
    // A falling tree right over the bot.
    const tree = { id: 9, type: 'object', name: 'dynamictrees:falling_tree', position: here.offset(0, 2, 0) };
    assert.equal(hurtSource({ ...bot, lastDamageCause: null, entities: { 9: tree, 4: zombie } }, { now: 1100 }), 'dynamictrees:falling_tree');
    // Several zombies in one window: each drop and each zombie, with its last swing.
    const z = (id, d) => ({ id, type: 'mob', name: 'zombie', position: here.offset(d, 0, 0) });
    const swings = new Map([[11, 900], [12, 1200]]);
    const crowd = { health: 1.5, food: 12, entity: { position: here, velocity: { y: -0.08 }, onGround: true }, entities: { 11: z(11, 1), 12: z(12, 1.5), 13: z(13, 3), 14: z(14, 20) } };
    assert.equal(hurtDetail(crowd, [{ at: 1000, amount: 6 }, { at: 1500, amount: 6.5 }, { at: 1900, amount: 6 }], { swings, now: 2000, start: 1000 }),
        '[survival] hurt-detail drops 6@+0s,6.5@+0.5s,6@+0.9s at 8.5,61,-117.5 vy -0.1 ground cause none near zombie@1m/swung-1.1s,zombie@1.5m/swung-0.8s,zombie@3m');
    // An attacker beyond the 5-block source range shows up in the detail ("by unknown" explained).
    const far = { health: 3, food: 13, entity: { position: here, velocity: { y: 0 }, onGround: true }, entities: { 7: { id: 7, type: 'mob', name: 'iceandfire:if_troll', position: here.offset(7, 0, 0) } } };
    assert.equal(hurtSource(far, { now: 0 }), 'unknown');
    assert.match(hurtDetail(far, [], { now: 0 }), /near iceandfire:if_troll@7m$/);
});

// #502 nit 1: a falling block or tree counts only when it is above the bot (at or over its feet,
// within 2 blocks sideways), never one below it or beside it.
test('#502 nit 1: the falling-block source is only one above the bot', async () => {
    const { hurtSource } = await import('./survival_log.js');
    const here = new Vec3(0.5, 64, 0.5);
    const at = (dx, dy, dz) => ({ health: 10, food: 12, entity: { position: here, velocity: { y: 0 } },
        entities: { 9: { id: 9, type: 'object', name: 'falling_block', position: here.offset(dx, dy, dz) } } });
    assert.equal(hurtSource(at(0, 2, 0), { now: 0 }), 'falling_block', 'right above');
    assert.equal(hurtSource(at(1, 0.5, 1), { now: 0 }), 'falling_block', 'at head height, beside');
    assert.equal(hurtSource(at(0, -2, 0), { now: 0 }), 'unknown', 'below the bot');
    assert.equal(hurtSource(at(3, 1, 0), { now: 0 }), 'unknown', '3 blocks sideways');
});

// Soak 7 (c): every fight path takes its best weapon in hand before its first hit and says what it holds.
// Soak 7 (e): the stone sword is the best of these on either attack path (threats.weaponOrder).
const AXES = () => [{ name: 'pyrotech:crude_axe', metadata: 0, count: 1, slot: 36 }, { name: 'stone_axe', metadata: 0, count: 1, slot: 37 }, { name: 'stone_sword', metadata: 0, count: 1, slot: 38 }];

test('soak 7 (c): defendSelf (the open field) holds the stone sword (its best weapon) at its first hit, and logs it', async (t) => {
    const logs = capture(t);
    const held = [];
    const bot = openFight(logs, { attack: (b) => { held.push(b.heldItem?.name ?? 'hand'); delete b.entities[1]; } });
    bot.inventory = { items: AXES, slots: [] };
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    assert.equal(await skills.defendSelf(bot, 8, (e) => e.name === 'zombie'), true);
    assert.deepEqual(held, ['stone_sword']);
    assert.ok(logs.includes('[survival] weapon stone_sword (open)'), logs.join('\n'));
});

test('soak 7 (c): attackEntity (the !attack command, a cornered hit) holds the stone sword at its hit, and logs it', async (t) => {
    const logs = capture(t);
    const held = [];
    const bot = openFight(logs);
    bot.inventory = { items: AXES, slots: [] };
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    bot.attack = () => { held.push(bot.heldItem?.name ?? 'hand'); return Promise.resolve(); };
    await skills.attackEntity(bot, bot.entities[1], false);
    assert.deepEqual(held, ['stone_sword']);
    assert.ok(logs.includes('[survival] weapon stone_sword (attack)'), logs.join('\n'));
});

// Soak 7 (e): equipHighestAttack takes the best weapon by threats.weaponOrder on the path bot.attack takes.
test('soak 7 (e): equipHighestAttack: the attack path decides between an iron axe and a diamond sword; soak 10: never the crude axe (a tool), and the wooden club over a stone axe', async (t) => {
    capture(t);
    const held = async (names, bot = openFight([])) => {
        bot.inventory = { items: () => names.map((name, i) => ({ name, metadata: 0, count: 1, slot: 36 + i })), slots: [] };
        bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
        assert.equal(await skills.equipHighestAttack(bot), true);
        return bot.heldItem.name;
    };
    assert.equal(await held(['stone_axe', 'pyrotech:crude_axe']), 'stone_axe', 'soak 10 (W1): the crude axe is a tool, never a weapon');
    assert.equal(await held(['stone_axe', 'spartanweaponry:club_wood']), 'spartanweaponry:club_wood', 'the club (4) over the stone axe (3)');
    assert.equal(await held(['diamond_sword', 'iron_axe']), 'iron_axe', 'vanilla: the first hit is all that lands');
    const bc = openFight([]);
    bc.forge = { bcAttack: { active: true } };
    assert.equal(await held(['iron_axe', 'diamond_sword'], bc), 'diamond_sword', 'Better Combat: every hit lands, the rate wins');
});

// Soak 7 (e): avoidEnemies' cornered hit (attackEntity every 500 ms) logged the weapon line each time.
test('soak 7 (e): the weapon line is logged only when the held item changes', async (t) => {
    const logs = capture(t);
    const bot = openFight(logs);
    let items = AXES();
    bot.inventory = { items: () => items, slots: [] };
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    bot.attack = () => Promise.resolve();
    for (let i = 0; i < 3; i++) await skills.attackEntity(bot, bot.entities[1], false);
    assert.deepEqual(survival(logs), ['[survival] weapon stone_sword (attack)'], 'three cornered hits, one line');
    // The sword broke; soak 10 (W1): the crude axe is no weapon, so the stone axe comes next.
    items = items.filter(i => i.name !== 'stone_sword');
    await skills.attackEntity(bot, bot.entities[1], false);
    // A fight in the open with the same stone axe: no line again (the fight start is still logged).
    bot.pvp.attack = () => { delete bot.entities[1]; };
    assert.equal(await skills.defendSelf(bot, 8, (e) => e.name === 'zombie'), true);
    assert.ok(survival(logs).includes('[survival] fight start zombie (open)'), logs.join('\n'));
    assert.deepEqual(survival(logs).filter(l => l.includes(' weapon ')), ['[survival] weapon stone_sword (attack)', '[survival] weapon stone_axe (attack)'], 'a new line for the new item only');
    assert.equal(skills.weaponRank({ name: 'stone_sword' }), 5, 'still exported from skills.js');
});

// (f): equipHighestAttack on the Better Combat path ranks by Better Combat's numbers (#528).
test('(f): with Better Combat\'s attack on, equipHighestAttack takes the wooden sword over the iron axe; on vanilla the iron axe', async (t) => {
    capture(t);
    const held = async (bc) => {
        const bot = openFight([]);
        if (bc) bot.forge = { bcAttack: { active: true } };
        bot.inventory = { items: () => [{ name: 'iron_axe', metadata: 0, count: 1, slot: 36 }, { name: 'wooden_sword', metadata: 0, count: 1, slot: 37 }], slots: [] };
        bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
        await skills.equipHighestAttack(bot);
        return bot.heldItem?.name;
    };
    assert.equal(await held(false), 'iron_axe');
    assert.equal(await held(true), 'wooden_sword');
});

// (f), #521: attackEntity's one hit (the !attack command without kill, avoidEnemies' cornered hit)
// uses bot.attack's result: false, and a line, when the hit was not sent.
test('(f): attackEntity (one hit) returns whether bot.attack sent it; a replaced hit is said', async (t) => {
    capture(t);
    const bot = openFight([]);
    bot.attack = () => Promise.resolve({ sent: false, path: null, waitedMs: 120, reason: 'replaced' });
    assert.equal(await skills.attackEntity(bot, bot.entities[1], false), false);
    assert.match(bot.output, /The hit on the zombie was not sent \(replaced\)\./);
    bot.output = '';
    bot.attack = () => Promise.resolve({ sent: true, path: 'bettercombat', waitedMs: 0 });
    assert.equal(await skills.attackEntity(bot, bot.entities[1], false), true);
    bot.attack = () => undefined; // mineflayer's own: no result, counts as sent
    assert.equal(await skills.attackEntity(bot, bot.entities[1], false), true);
    assert.equal(bot.output, '');
});

// (g), net-forge #541: with Better Combat's attack, a target past its reach (4.0 blocks eye to hitbox
// with a weapon) or out of sight gets nothing ({ sent: false, reason: 'reach' | 'sight' }).
test('(g): attackEntity\'s one hit walks to within ATTACK_HIT.near of a mob past ATTACK_HIT.approach, and walks closer once more on "reach" or "sight"', async (t) => {
    const logs = capture(t);
    assert.deepEqual(skills.ATTACK_HIT, { approach: 3, near: 2, again: 1 });
    const walkBot = (at, results) => {
        const bot = openFight(logs, { at });
        const goals = [];
        bot.pathfinder.getPathTo = () => ({ status: 'success', path: [] });
        bot.pathfinder.goto = (g) => { goals.push(Math.sqrt(g.rangeSq)); return Promise.resolve(); };
        let n = 0;
        bot.attack = () => Promise.resolve(results[n++] ?? { sent: true, path: 'bettercombat' });
        return { bot, goals, tries: () => n };
    };
    // 4 blocks away (it walked only past 5): walk to within 2, then hit.
    const far = walkBot(4, []);
    assert.equal(await skills.attackEntity(far.bot, far.bot.entities[1], false), true);
    assert.deepEqual(far.goals, [2]);
    // 2 blocks away: no walk.
    const near = walkBot(2, []);
    assert.equal(await skills.attackEntity(near.bot, near.bot.entities[1], false), true);
    assert.deepEqual(near.goals, []);
    // "reach", then sent: one walk closer (to within 1) and one more hit.
    const reach = walkBot(2, [{ sent: false, path: null, reason: 'reach' }]);
    assert.equal(await skills.attackEntity(reach.bot, reach.bot.entities[1], false), true);
    assert.deepEqual([reach.goals, reach.tries()], [[1], 2]);
    // "sight" twice: one re-approach only, then it says so.
    const sight = walkBot(2, [{ sent: false, reason: 'sight' }, { sent: false, reason: 'sight' }]);
    assert.equal(await skills.attackEntity(sight.bot, sight.bot.entities[1], false), false);
    assert.deepEqual([sight.goals, sight.tries()], [[1], 2]);
    assert.match(sight.bot.output, /The hit on the zombie was not sent \(sight\)\./);
    // "replaced" is not a reason to walk.
    const replaced = walkBot(2, [{ sent: false, reason: 'replaced' }]);
    assert.equal(await skills.attackEntity(replaced.bot, replaced.bot.entities[1], false), false);
    assert.deepEqual([replaced.goals, replaced.tries()], [[], 1]);
    // avoidEnemies' cornered hit (approach false): never a walk toward the mob.
    const cornered = walkBot(4, [{ sent: false, reason: 'reach' }]);
    assert.equal(await skills.attackEntity(cornered.bot, cornered.bot.entities[1], false, { approach: false }), false);
    assert.deepEqual([cornered.goals, cornered.tries()], [[], 1]);
});

// (g): mineflayer-pvp ignores bot.attack's result; a mob in reach but out of sight now gets nothing.
test('(g): defendSelf ends a fight in which the mob takes no hurt and the bot gets no closer for DEFEND_PROGRESS.stallMs, and leaves the mob alone; a hurt keeps it going', async (t) => {
    const logs = capture(t);
    const saved = { ...skills.DEFEND_PROGRESS };
    t.after(() => Object.assign(skills.DEFEND_PROGRESS, saved));
    Object.assign(skills.DEFEND_PROGRESS, { stallMs: 1200 });
    const events = () => {
        const on = {};
        return { on: (ev, f) => { (on[ev] ??= []).push(f); }, removeListener: (ev, f) => { on[ev] = (on[ev] ?? []).filter(x => x !== f); }, emit: (ev, e) => (on[ev] ?? []).forEach(f => f(e)), count: (ev) => (on[ev] ?? []).length };
    };
    // Out of sight at 2 blocks: pvp swings, nothing lands; no health drop, no hurt.
    const stuck = openFight(logs);
    const ev = events();
    Object.assign(stuck, { on: ev.on, removeListener: ev.removeListener });
    stuck.entities[1].metadata = { 7: 20 };
    const t0 = Date.now();
    assert.equal(await skills.defendSelf(stuck, 8, (e) => e.name === 'zombie'), true);
    assert.ok(Date.now() - t0 < 4000, 'ended by the stall guard');
    assert.match(stuck.output, /Stopped fighting the zombie: no hit landed and no closer for 1\.2 s/);
    assert.ok(logs.some(l => /^\[survival\] fight end zombie stopped/.test(l)), logs.join('\n'));
    assert.equal(skills.isUnreachable(stuck, stuck.entities[1]), true, 'left alone for a while');
    assert.equal(ev.count('entityHurt'), 0, 'the listener is removed');

    // Hurt every 500 ms (entityHurt; its health unknown): no stall; it ends when the mob dies.
    const hitting = openFight(logs);
    const ev2 = events();
    Object.assign(hitting, { on: ev2.on, removeListener: ev2.removeListener });
    const zombie = hitting.entities[1];
    let hurts = 0;
    hitting.pvp.attack = () => { setTimeout(() => { ev2.emit('entityHurt', zombie); if (++hurts >= 6) delete hitting.entities[1]; }, 50); };
    assert.equal(await skills.defendSelf(hitting, 8, (e) => e.name === 'zombie'), true);
    assert.ok(hurts >= 6, `fought on past stallMs while it was hurt: ${hurts}`);
    assert.doesNotMatch(hitting.output, /Stopped fighting/);
});

// #579 nit 3: soak 10 held hitwithaxe:bark at night ("[survival] weapon hitwithaxe:bark"): bark alone is no weapon.
test('#579 nit 3: equipHighestAttack with only bark and a crude axe takes neither (no weapon)', async (t) => {
    capture(t);
    const bot = openFight([]);
    bot.inventory = { items: () => [{ name: 'hitwithaxe:bark', metadata: 20, count: 1, slot: 36 }, { name: 'pyrotech:crude_axe', metadata: 6, count: 1, slot: 37 }], slots: [] };
    let equipped = null;
    bot.equip = (item) => { equipped = item; return Promise.resolve(); };
    assert.equal(await skills.equipHighestAttack(bot), false);
    assert.equal(equipped, null);
});
