// G3 round 9 batch B, fix (c): self_defense never takes the bot out of its night shelter.
// At 13:35:22 a digging zombie (Epic Siege Mod: minecraft:zombie has "Digging": true) opened one side
// of the dirt shelter; the night routine started the repair, self_defense interrupted it
// (driver.log 471: "mode:self_defense" trying to interrupt current action "action:buildShelter"),
// defendSelf walked out after the zombie (pvp.attack follows its target), and the bot died outside
// at -78 58 -60 (driver.log 487). Now, with a wall open: the night's repair is not interrupted, and
// the fight is from where the bot stands (no walk), only at mobs within reach.
// Fake bot and agent; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { __modeForTest, __resetThreatLease } from './modes.js';
import { SHELTER_FIGHT } from './library/skills.js';
import { HEAD_DIG } from './modes.js';
import { REPAIR_LABEL } from './night_routine.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(resolve => setImmediate(resolve));

/** The bot in its shelter at 0 64 0, a wall open to the east, a zombie in the opening (x 1) or farther. */
function shelter({ zombieAt = 1, label = '', others = [], killAfter = 2 } = {}) {
    __resetThreatLease();
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0.5, 64, 0.5), height: 1.8 };
    const zombie = { id: 1, name: 'zombie', type: 'mob', position: new Vec3(zombieAt + 0.5, 64, 0.5), height: 1.8 };
    const calls = { gotos: [], pvp: [], attacks: [], looks: 0 };
    const bot = {
        username: 'FRCFLD', entity: self, entities: Object.fromEntries([[0, self], [1, zombie], ...others.map(o => [o.id, o])]),
        registry: reg, version: '1.12.2', health: 20, food: 20, isAlive: true, lastDamageTime: -1e9, lastDamageTaken: 0,
        rotnSheltered: 'open', interrupt_code: false, output: '',
        blockAt: () => null, clearControlStates() {}, setControlState() {},
        inventory: { items: () => [], slots: [] }, heldItem: null,
        equip: () => Promise.resolve(),
        lookAt: () => { calls.looks++; return Promise.resolve(); },
        attack: (e) => { calls.attacks.push(e.id); if (calls.attacks.length >= killAfter) delete bot.entities[1]; }, // dies after killAfter hits
        pvp: { attack: (e) => calls.pvp.push(e.id), stop() {} },
        pathfinder: {
            goal: null, setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false,
            goto: (g) => { calls.gotos.push(g); return Promise.resolve(); },
            getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; },
        },
        modes: { behavior_log: '', pause() {}, unpause() {} },
        nearestEntity: (match) => Object.values(bot.entities).filter(e => e !== self && match(e))
            .sort((a, b) => a.position.distanceTo(self.position) - b.position.distanceTo(self.position))[0] ?? null,
    };
    const ran = [], interrupts = [];
    let current = label ? { label } : null;
    const agent = {
        bot, shut_up: true, openChat() {}, isIdle: () => !current,
        actions: {
            resume_func: null,
            get currentActionLabel() { return current?.label ?? ''; },
            async runAction(l, fn) {
                if (current) interrupts.push({ of: current.label, by: l });
                current = { label: l };
                ran.push(l);
                await fn();
                current = null;
                return { message: '', interrupted: false };
            },
        },
    };
    return { agent, bot, calls, ran, interrupts, self };
}

async function selfDefense(agent) {
    const mode = __modeForTest('self_defense');
    await mode.update(agent);
    for (let i = 0; i < 50 && mode.active; i++) await new Promise(resolve => setTimeout(resolve, 50));
    await flush();
    return mode;
}

test('round 9 B (c): with a wall open, self_defense does not interrupt the night\'s repair', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, interrupts, calls } = shelter({ label: REPAIR_LABEL });
    await selfDefense(agent);
    assert.deepEqual(interrupts, [], 'the repair runs on');
    assert.deepEqual([calls.gotos.length, calls.pvp.length, calls.attacks.length], [0, 0, 0]);
});

test('round 9 B (c): with a wall open, the bot fights the mob in the opening from where it stands: no walk, no pvp follow', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran, self } = shelter();
    const before = self.position.clone();
    await selfDefense(agent);
    assert.deepEqual(ran, ['mode:self_defense']);
    assert.deepEqual(calls.gotos, [], 'no pathfinder walk (defendSelf walked out after the zombie)');
    assert.deepEqual(calls.pvp, [], 'no mineflayer-pvp attack (it follows its target)');
    assert.deepEqual(calls.attacks, [1, 1], 'hit in place until it died');
    assert.ok(self.position.equals(before), 'still in the shelter');
    assert.equal(bot.rotnSheltered, 'open');
});

test('round 9 B (c): with a wall open, a mob out of reach is not chased', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, calls, ran } = shelter({ zombieAt: 5 });
    await selfDefense(agent);
    assert.deepEqual(ran, [], 'no fight started');
    assert.deepEqual([calls.gotos.length, calls.pvp.length, calls.attacks.length], [0, 0, 0]);
});

// ---- The lead's decision (1) after round 9 B: low health in the shelter at night ----
// self_preservation's low-health flee walked the bot 20 blocks away (moveAway), out of the shelter,
// into the night. In the shelter it now stays: the night's repair goes on (it closes the opening);
// otherwise it hits what is in reach, in place, or eats; it leaves only for fire, lava or drowning.

async function selfPreservation(agent) {
    const mode = __modeForTest('self_preservation');
    await mode.update(agent);
    for (let i = 0; i < 50 && mode.active; i++) await new Promise(resolve => setTimeout(resolve, 50));
    await flush();
    return mode;
}
const hurt = (bot) => Object.assign(bot, { health: 3, lastDamageTime: Date.now(), lastDamageTaken: 2, setControlState() {}, clearControlStates() {} });

test('decision (1): hurt in the open shelter, the bot hits the mob in reach in place instead of fleeing out', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran, self } = shelter();
    hurt(bot);
    const before = self.position.clone();
    await selfPreservation(agent);
    assert.deepEqual(ran, ['mode:self_preservation']);
    assert.deepEqual(calls.gotos, [], 'no walk (moveAway walked 20 blocks out)');
    assert.deepEqual(calls.attacks, [1, 1], 'hit in place');
    assert.ok(self.position.equals(before));
});

test('decision (1): hurt in the shelter with nothing in reach, the bot eats instead of fleeing; it never interrupts the repair', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran } = shelter({ zombieAt: 6 });
    hurt(bot);
    bot.food = 10;
    const bread = { name: 'bread', metadata: 0, count: 2, type: 297 };
    const eaten = [];
    bot.inventory = { items: () => (bread.count > 0 ? [bread] : []), slots: [] };
    bot.consume = () => { eaten.push(bot.heldItem?.name); bread.count--; bot.food += 5; return Promise.resolve(); };
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    await selfPreservation(agent);
    assert.deepEqual(ran, ['mode:self_preservation']);
    assert.deepEqual(eaten, ['bread']);
    assert.deepEqual([calls.gotos.length, calls.attacks.length], [0, 0], 'no walk, no fight out of reach');

    const busy = shelter({ label: REPAIR_LABEL });
    hurt(busy.bot);
    await selfPreservation(busy.agent);
    assert.deepEqual(busy.interrupts, [], 'the repair goes on');
    assert.deepEqual(busy.calls.gotos, []);
});

// ---- #331 review (lead, REQUEST CHANGES on f54db6c) ----

const mob = (id, name, x) => ({ id, name, type: 'mob', position: new Vec3(x + 0.5, 64, 0.5), height: 1.8 });

test('#331 review 1 and 2: in the shelter the zombie in reach is hit, also when the plan says flee (two zombies; a skeleton near)', async (t) => {
    t.mock.method(console, 'log', () => {});
    // Two melee within 8: OUTNUMBERED, the plan is 'flee' (cowardice is quiet in the shelter).
    const two = shelter({ others: [mob(2, 'zombie', 5)] });
    await selfDefense(two.agent);
    assert.deepEqual(two.calls.attacks, [1, 1], 'the zombie at 1 is hit until it dies; the one at 5 is out of reach');
    assert.deepEqual([two.calls.gotos.length, two.calls.pvp.length], [0, 0]);
    // A skeleton within 12: take-cover, the plan is 'flee'.
    const ranged = shelter({ others: [mob(3, 'skeleton', 10)] });
    await selfDefense(ranged.agent);
    assert.deepEqual(ranged.calls.attacks, [1, 1]);
    // Never an enderman (do not look at it), even in reach.
    const ender = shelter({ zombieAt: 9, others: [mob(4, 'enderman', 1)] });
    await selfDefense(ender.agent);
    assert.deepEqual(ender.calls.attacks, []);
});

test('#331 review 3: a fight in place is capped: hits that do not hurt one mob, then the swing and time limits', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = { ...SHELTER_FIGHT };
    Object.assign(SHELTER_FIGHT, { swingMs: 10 });
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    // A zombie whose health is known and never goes down (it does not die): sameTargetSwings hits.
    const tough = shelter({ killAfter: 1e9 });
    tough.bot.entities[1].health = 20;
    await selfDefense(tough.agent);
    assert.equal(tough.calls.attacks.length, SHELTER_FIGHT.sameTargetSwings);
    assert.match(tough.bot.output, /stopped: 4 hits did not hurt the zombie/);
    assert.ok(Number.isFinite(tough.bot.rotnFightEndedAt));
    // Health unknown: the swing cap.
    const unknown = shelter({ killAfter: 1e9 });
    await selfDefense(unknown.agent);
    assert.equal(unknown.calls.attacks.length, SHELTER_FIGHT.maxSwings);
    assert.equal(unknown.bot.rotnFightingInPlace, false);
});

test('#331 review 4: right after a fight in place self_defense waits restMs, so the night routine repairs first', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran } = shelter({ killAfter: 1e9 });
    bot.rotnFightEndedAt = Date.now();
    await selfDefense(agent);
    assert.deepEqual([ran.length, calls.attacks.length], [0, 0], 'resting: the repair goes first');
    bot.rotnFightEndedAt = Date.now() - SHELTER_FIGHT.restMs;
    const saved = { ...SHELTER_FIGHT };
    Object.assign(SHELTER_FIGHT, { swingMs: 10 });
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    await selfDefense(agent);
    assert.deepEqual(ran, ['mode:self_defense'], 'after the rest it fights again');
});

// ---- The lead's decision after #331: a falling block in the shelter's head space ----
// self_preservation moved the bot 2 blocks away (moveAway) when sand or gravel was at its head,
// out of the shelter into the night. In the shelter it now digs the block out by hand (sand and
// gravel need no tool) and stays; it leaves only when that dig fails (it would suffocate).

function sandAtHead(fake, { digWorks = true, column = 1, landsMs = 100 } = {}) {
    const { bot, calls } = fake;
    const head = new Vec3(0, 65, 0);
    let sand = true, left = column; // a column of `column` blocks: after a dig the next lands landsMs later
    calls.digs = [];
    Object.assign(bot, {
        rotnSheltered: true, health: 20, lastDamageTime: -1e9, setControlState() {}, clearControlStates() {},
        game: { gameMode: 'survival' }, tool: { equipForBlock: () => Promise.resolve() },
        blockAt: (p) => {
            const q = p.floored ? p.floored() : p;
            const isSand = sand && q.x === head.x && q.y === head.y && q.z === head.z;
            return { name: isSand ? 'sand' : 'air', position: q, boundingBox: isSand ? 'block' : 'empty', canHarvest: () => true };
        },
        dig: (b) => {
            calls.digs.push(`${b.position.x},${b.position.y},${b.position.z}`);
            if (!digWorks) return Promise.reject(new Error('Digging aborted'));
            sand = false;
            if (--left > 0) setTimeout(() => { sand = true; }, landsMs);
            return Promise.resolve();
        },
    });
    bot.modes.isOn = () => false;
    bot.pathfinder.getPathTo = () => ({ status: 'success', path: [] }); // goToGoal plans first
    return head;
}

test('falling block (lead): sand in the shelter\'s head space is dug out by hand, and the bot stays', async (t) => {
    t.mock.method(console, 'log', () => {});
    const fake = shelter({ zombieAt: 9 });
    sandAtHead(fake);
    const before = fake.self.position.clone();
    await selfPreservation(fake.agent);
    assert.deepEqual(fake.calls.digs, ['0,65,0'], 'dug at its head');
    assert.deepEqual(fake.calls.gotos, [], 'no walk out of the shelter');
    assert.ok(fake.self.position.equals(before));
});

test('falling block (lead): when the dig fails the bot still gets out (it would suffocate)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const fake = shelter({ zombieAt: 9 });
    sandAtHead(fake, { digWorks: false });
    await selfPreservation(fake.agent);
    assert.equal(fake.calls.digs.length, 1);
    assert.ok(fake.calls.gotos.length >= 1, 'moveAway walked');
});

// ---- #346 review 1: a falling column must not keep the bot digging until it suffocates ----

test('#346 review 1: a falling column (each dig, the next block lands): the bot digs at most HEAD_DIG.maxDigs times, then gets out', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const saved = { ...HEAD_DIG };
    Object.assign(HEAD_DIG, { settleMs: 150 });
    t.after(() => Object.assign(HEAD_DIG, saved));
    const fake = shelter({ zombieAt: 9 });
    sandAtHead(fake, { column: 6, landsMs: 50 }); // lands before the 150 ms look again
    await selfPreservation(fake.agent);
    assert.equal(fake.calls.digs.length, HEAD_DIG.maxDigs, 'bounded');
    assert.ok(fake.calls.gotos.length >= 1, 'then moveAway');

    // A short column (2 blocks) is dug out and the bot stays.
    const short = shelter({ zombieAt: 9 });
    sandAtHead(short, { column: 2, landsMs: 50 });
    await selfPreservation(short.agent);
    assert.equal(short.calls.digs.length, 2);
    assert.deepEqual(short.calls.gotos, [], 'stays');
});

test('#346 review 1: below HEAD_DIG.minHealth the bot gets out at once instead of digging', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const fake = shelter({ zombieAt: 9 });
    sandAtHead(fake);
    fake.bot.health = HEAD_DIG.minHealth - 1;
    await selfPreservation(fake.agent);
    assert.deepEqual(fake.calls.digs, []);
    assert.ok(fake.calls.gotos.length >= 1);
});

// G3 gate B (0daeef2d): the night routine called the shelter "no longer usable" and set
// rotnSheltered false at once; self_defense then ran defendSelf ("Fighting zombie!", server.log 534),
// chased the zombie out of the shelter and the bot died. Leaving a deadly shelter with a hostile mob
// near now keeps the in-shelter rules ('open': fight only in reach, in place) until out of the cell.
test('G3 gate B (e): a deadly shelter left with a zombie 4 blocks away: self_defense fights in place only, never chases; out of the cell the normal rules are back', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { nightTick, nightState, hostileNear } = await import('./night_routine.js');
    const { agent, bot, calls, ran, self } = shelter({ zombieAt: 4 });
    const site = new Vec3(0, 64, 0);
    bot.rotnSheltered = false;
    bot.time = { timeOfDay: 15000 };
    bot.modes.anyActive = () => false;
    agent.self_prompter = { active: false, loop_active: false, isActive() { return this.active; }, stop() {}, isPaused: () => false };
    agent.actions.executing = false;
    agent.actions.stop = () => Promise.resolve();
    let deadly = false;
    const o = {
        builds: [],
        buildShelter: (b, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed: true, feet: site, line: 'Shelter closed' }); },
        siteNeeds: () => (deadly ? null : { todo: [] }),
        siteProblem: () => ({ kind: 'hazard', pos: site, block: 'lava', text: 'lava at 0, 64, 0 (lava in the 1x2 space)' }),
        hostileNear,
        clearSpace: () => Promise.resolve(false),
    };
    const settle = async () => { while (nightState(agent).job) await nightState(agent).job; };
    nightTick(agent, { now: 0, ops: o });
    await settle();
    assert.equal(bot.rotnSheltered, true);
    nightTick(agent, { now: 1, ops: o });
    deadly = true;
    assert.equal(nightTick(agent, { now: 20_000, ops: o }), 'night:building');
    assert.equal(bot.rotnSheltered, 'open', 'the in-shelter fight rules hold while still in the cell');

    await selfDefense(agent);
    assert.deepEqual(calls.gotos, [], 'no pathfinder walk after the zombie');
    assert.deepEqual(calls.pvp, [], 'no mineflayer-pvp chase');
    assert.ok(!ran.includes('mode:self_defense') || calls.attacks.length === 0, 'nothing out of reach is hit');

    self.position = new Vec3(2.5, 64, 3.5); // out of the old cell (the build walked it out)
    nightTick(agent, { now: 20_001, ops: o });
    assert.equal(bot.rotnSheltered, false, 'out of the cell: the normal rules');
    await settle();
});

// #355 review 1 (REQUEST CHANGES on 7d1c5c7c): leaving a deadly shelter with a mob near, the
// in-shelter fight and eating interrupted the leaving build (fightInShelter stood aside only for the
// repair), and the cycle kept the bot in a cell that drowned, suffocated or burned it.
test('#355 review 1: leaving a deadly shelter with a zombie in reach, neither self_defense nor eating interrupts the leaving build', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { nightTick, nightState, hostileNear } = await import('./night_routine.js');
    const { agent, bot, calls, interrupts } = shelter({ zombieAt: 1 });
    const site = new Vec3(0, 64, 0);
    bot.rotnSheltered = false;
    bot.time = { timeOfDay: 15000 };
    bot.modes.anyActive = () => false;
    agent.self_prompter = { active: false, loop_active: false, isActive() { return this.active; }, stop() {}, isPaused: () => false };
    agent.actions.executing = false;
    agent.actions.stop = () => Promise.resolve();
    let deadly = false, finishBuild = null;
    const o = {
        builds: [],
        buildShelter: (b, opts = {}) => {
            o.builds.push(opts.site ?? null);
            if (o.builds.length === 1) return Promise.resolve({ closed: true, feet: site, line: 'Shelter closed' });
            return new Promise(resolve => { finishBuild = () => resolve({ closed: true, feet: new Vec3(5, 64, 5), line: 'Shelter closed' }); });
        },
        siteNeeds: () => (deadly ? null : { todo: [] }),
        siteProblem: () => ({ kind: 'drown', pos: site.offset(0, 1, 0), block: 'water', text: 'water at 0, 65, 0 (a liquid at head height: the bot would drown)' }),
        hostileNear,
        clearSpace: () => Promise.resolve(false),
    };
    nightTick(agent, { now: 0, ops: o });
    while (nightState(agent).job) await nightState(agent).job;
    nightTick(agent, { now: 1, ops: o });
    deadly = true;
    assert.equal(nightTick(agent, { now: 20_000, ops: o }), 'night:building');
    assert.equal(bot.rotnSheltered, 'open');
    nightTick(agent, { now: 20_001, ops: o }); // the leaving build starts and runs
    await flush();
    assert.equal(agent.actions.currentActionLabel, 'action:buildShelter', 'the leaving build is running');

    await selfDefense(agent);
    hurt(bot);
    bot.food = 10;
    const bread = { name: 'bread', metadata: 0, count: 2, type: 297 };
    const eaten = [];
    bot.inventory = { items: () => (bread.count > 0 ? [bread] : []), slots: [] };
    bot.consume = () => { eaten.push('bread'); bread.count--; return Promise.resolve(); };
    await selfPreservation(agent);
    assert.deepEqual(interrupts, [], 'the leaving build goes on');
    assert.deepEqual(calls.attacks, [], 'no fight in the deadly cell');
    assert.deepEqual(eaten, [], 'no eating in the deadly cell');
    assert.deepEqual([calls.gotos.length, calls.pvp.length], [0, 0], 'no chase');

    finishBuild();
    while (nightState(agent).job) await nightState(agent).job;
    assert.equal(nightState(agent).leaveFrom, null, 'in the new shelter the routine is not leaving any more');
});
