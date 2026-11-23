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
import { REPAIR_LABEL, resetNight } from './night_routine.js';
import { maxHitOf } from './library/threats.js';

/** rotn-data #518: what a zombie may hit for is data (12.5, then 10.5); UNDER/OVER: the whole healths just below and above it. */
const ZOMBIE_HIT = maxHitOf({ name: 'zombie', type: 'mob' });
const UNDER = Number.isInteger(ZOMBIE_HIT) ? ZOMBIE_HIT - 1 : Math.floor(ZOMBIE_HIT);
const OVER = Math.floor(ZOMBIE_HIT) + 1;

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(resolve => setImmediate(resolve));

/** The bot in its shelter at 0 64 0, a wall open to the east, a zombie in the opening (x 1) or farther. */
// Soak 3, the lead's (b): the bot fights from the shelter only with a weapon (these tests give it a stone axe).
const AXE = { name: 'stone_axe', metadata: 0, count: 1, type: 275 };
function shelter({ zombieAt = 1, label = '', others = [], killAfter = 2, weapon = true } = {}) {
    __resetThreatLease();
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0.5, 64, 0.5), height: 1.8 };
    const zombie = { id: 1, name: 'zombie', type: 'mob', position: new Vec3(zombieAt + 0.5, 64, 0.5), height: 1.8 };
    const calls = { gotos: [], pvp: [], attacks: [], looks: 0 };
    const bot = {
        username: 'FRCFLD', entity: self, entities: Object.fromEntries([[0, self], [1, zombie], ...others.map(o => [o.id, o])]),
        registry: reg, version: '1.12.2', health: 20, food: 20, isAlive: true, lastDamageTime: -1e9, lastDamageTaken: 0,
        rotnSheltered: 'open', interrupt_code: false, output: '',
        blockAt: () => null, clearControlStates() {}, setControlState() {},
        inventory: { items: () => (weapon ? [AXE] : []), slots: [] }, heldItem: null,
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
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { agent, bot, calls, ran, self } = shelter();
    const before = self.position.clone();
    await selfDefense(agent);
    assert.deepEqual(ran, ['mode:self_defense']);
    assert.deepEqual(calls.gotos, [], 'no pathfinder walk (defendSelf walked out after the zombie)');
    assert.deepEqual(calls.pvp, [], 'no mineflayer-pvp attack (it follows its target)');
    assert.deepEqual(calls.attacks, [1, 1], 'hit in place until it died');
    assert.ok(self.position.equals(before), 'still in the shelter');
    assert.equal(bot.rotnSheltered, 'open');
    // G4 #5: the journal's fight lines; soak 7: one line per swing (the held item, the time since the
    // swing before, the mob's health before it and at the next look).
    assert.deepEqual(logs.filter(l => l.startsWith('[survival] ')).map(l => l.replace(/after \d+ s$/, 'after N s').replace(/\+\d+ ms/, '+N ms')),
        ['[survival] fight start zombie (shelter)', '[survival] weapon hand (shelter)', '[survival] swing zombie with hand first: health unknown -> unknown',
            '[survival] swing zombie with hand +N ms: health unknown -> gone', '[survival] fight end zombie killed after N s']);
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

test('decision (1): hurt in the open shelter and cornered, the bot hits the mob in reach in place instead of fleeing out', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran, self } = shelter();
    hurt(bot);
    // Soak 5 (death 4): at a health a zombie's hit may take (ZOMBIE_HIT, PR 5) only a cornered bot hits back (the night routine found
    // no way to back away and set handFight).
    agent._night = { handFight: true };
    const before = self.position.clone();
    await selfPreservation(agent);
    assert.deepEqual(ran, ['mode:self_preservation']);
    assert.deepEqual(calls.gotos, [], 'no walk (moveAway walked 20 blocks out)');
    assert.deepEqual(calls.attacks, [1, 1], 'hit in place');
    assert.ok(self.position.equals(before));
});

test('soak 5 (death 4) / PR 5: armed but at a health the zombie may take in one hit (its maxDamage) and not cornered, the bot does not fight from the shelter (the night routine backs away)', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    for (const health of [UNDER, 3]) {
        const { agent, bot, calls } = shelter();
        bot.health = health;
        await selfDefense(agent);
        assert.deepEqual(calls.attacks, [], `health ${health}: no swing`);
    }
    assert.ok(logs.includes(`[shelter] health ${UNDER}, a zombie hits up to ${ZOMBIE_HIT}: not fighting from the shelter unless cornered`), logs.join('\n'));
    const fit = shelter();
    fit.bot.health = OVER;
    await selfDefense(fit.agent);
    assert.deepEqual(fit.calls.attacks, [1, 1], `health ${OVER}, armed: fought as before`);
});

test('decision (1): hurt in the shelter with nothing in reach, the bot eats instead of fleeing; it never interrupts the repair', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran } = shelter({ zombieAt: 6 });
    hurt(bot);
    bot.food = 10;
    const bread = { name: 'bread', metadata: 0, count: 2, type: 297 };
    const eaten = [];
    bot.inventory = { items: () => [AXE, ...(bread.count > 0 ? [bread] : [])], slots: [] };
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
    bot.inventory = { items: () => [AXE, ...(bread.count > 0 ? [bread] : [])], slots: [] };
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

// #355 re-review (REQUEST CHANGES on 6d910bcb): the in-shelter fight stood aside whenever leaveFrom
// was set, also between build tries (RETRY_MS, no job), when cowardice and the flee are quiet too,
// so the bot stood defenceless in the deadly cell with a zombie in reach.
test('#355 re-review: leaving a deadly shelter, between build tries (no job) the zombie in reach is hit in place', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { nightTick, nightState, hostileNear } = await import('./night_routine.js');
    const { agent, bot, calls, ran } = shelter({ zombieAt: 1, killAfter: 100 });
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
        buildShelter: (b, opts = {}) => {
            o.builds.push(opts.site ?? null);
            return Promise.resolve(o.builds.length === 1
                ? { closed: true, feet: site, line: 'Shelter closed' }
                : { closed: false, feet: null, line: 'Not building a shelter: too few blocks.' });
        },
        siteNeeds: () => (deadly ? null : { todo: [] }),
        siteProblem: () => ({ kind: 'drown', pos: site.offset(0, 1, 0), block: 'water', text: 'water at 0, 65, 0 (a liquid at head height: the bot would drown)' }),
        hostileNear,
        clearSpace: () => Promise.resolve(false),
    };
    const settle = async () => { while (nightState(agent).job) await nightState(agent).job; };
    nightTick(agent, { now: 0, ops: o });
    await settle();
    nightTick(agent, { now: 1, ops: o });
    deadly = true;
    assert.equal(nightTick(agent, { now: 20_000, ops: o }), 'night:building');
    assert.ok(nightState(agent).leaveFrom, 'leaving');
    assert.equal(nightState(agent).job, null, 'no job yet');

    await selfDefense(agent);
    assert.ok(calls.attacks.length > 0, 'the zombie in reach is hit before the build starts');
    assert.deepEqual([calls.gotos.length, calls.pvp.length], [0, 0], 'in place');

    nightTick(agent, { now: 20_001, ops: o }); // the build try runs and fails
    await settle();
    assert.equal(o.builds.length, 2);
    assert.equal(nightState(agent).job, null, 'between tries (RETRY_MS)');
    assert.ok(nightState(agent).leaveFrom, 'still in the deadly cell');
    const before = calls.attacks.length;
    await new Promise(resolve => setTimeout(resolve, SHELTER_FIGHT.restMs + 50)); // past the rest after a fight
    await selfDefense(agent);
    assert.ok(calls.attacks.length > before, 'hit again between tries');
    assert.ok(ran.includes('mode:self_defense'));
});

test('CX23 soak: after a fight in place, hurt and too hungry to heal (food below 18), the bot eats; fed enough, it does not', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { agent, bot } = shelter();
    const bread = { name: 'bread', metadata: 0, count: 2, type: reg.itemsByName.bread.id };
    bot.inventory = { items: () => [AXE, bread].filter(i => i.count > 0), slots: [] };
    Object.assign(bot, { health: 14, food: 10 });
    bot.consume = () => { bread.count--; bot.food += 5; return Promise.resolve(); };
    await selfDefense(agent);
    for (let i = 0; i < 40 && bread.count === 2; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(bread.count, 1, 'one bread eaten after the fight');
    assert.ok(logs.some(l => /^\[reflex\] ate between fights in the shelter \(health 14, food 10 -> 15\)$/.test(l)), logs.join('\n'));

    const fed = shelter();
    const b2 = { name: 'bread', metadata: 0, count: 2, type: reg.itemsByName.bread.id };
    fed.bot.inventory = { items: () => [AXE, b2], slots: [] };
    Object.assign(fed.bot, { health: 14, food: 18 });
    let eaten = 0;
    fed.bot.consume = () => { eaten++; return Promise.resolve(); };
    await selfDefense(fed.agent);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(eaten, 0);
});


test('soak 5 (00:46, the troll): from the shelter a troll, a creeper or a skeleton in reach is never hit; a zombie still is', async (t) => {
    t.mock.method(console, 'log', () => {});
    for (const name of ['iceandfire:if_troll', 'creeper', 'skeleton']) {
        const s = shelter({ zombieAt: 6, others: [mob(2, name, 1)] });
        await selfDefense(s.agent);
        assert.deepEqual(s.calls.attacks, [], `${name}: no swing`);
        s.agent._night = { handFight: true }; // nor when cornered
        await selfDefense(s.agent);
        assert.deepEqual(s.calls.attacks, [], `${name}: no swing when cornered`);
    }
    const both = shelter({ zombieAt: 2, others: [mob(3, 'iceandfire:if_troll', 1)] });
    await selfDefense(both.agent);
    assert.ok(both.calls.attacks.length > 0 && both.calls.attacks.every(id => id === 1), 'the zombie behind the troll is hit, the troll never');
});

test('#497 review 4: a fight from the shelter stops once health falls to 8; cornered (handFight) it goes on', async (t) => {
    t.mock.method(console, 'log', () => {});
    // The mode is shared by the tests in this file: wait (bounded) for an earlier fight to end, and
    // for this fight's own end line, so a fight still running elsewhere cannot cut the wait short.
    const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
    const run = async (cornered) => {
        await until(() => !__modeForTest('self_defense').active);
        const s = shelter({ killAfter: 3 }); // the zombie dies at the third hit
        if (cornered) s.agent._night = { handFight: true };
        const attack = s.bot.attack;
        s.bot.attack = (e) => { attack(e); s.bot.health = 8; }; // the zombie hits back
        await selfDefense(s.agent);
        await until(() => /Fought from inside the shelter/.test(s.bot.output));
        return { hits: s.calls.attacks.length, output: s.bot.output };
    };
    const free = await run(false);
    assert.equal(free.hits, 1, 'one swing, then health 8: it stops');
    assert.match(free.output, /stopped: the situation changed/);
    const cornered = await run(true);
    assert.equal(cornered.hits, 3, `cornered: it fights on until the zombie dies (hits ${cornered.hits}: ${cornered.output})`);
});

test('soak 3 (b): with no weapon the bot does not fight from the shelter (bare hands did not hurt the zombies); it says so at most every SHELTER_SAY_MS', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { agent, bot, calls } = shelter({ weapon: false });
    await selfDefense(agent);
    await selfDefense(agent);
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(calls.attacks, [], 'no swing');
    assert.equal(logs.filter(l => l === '[shelter] no weapon: not fighting from the shelter unless cornered').length, 1);
    assert.ok(bot.entities[1], 'the zombie is still there');
});

test('#470 review 2: unarmed, held, low health and no way to back away (agent._night.handFight): it hits back by hand', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, calls } = shelter({ weapon: false });
    agent._night = { handFight: true };
    await selfDefense(agent);
    for (let i = 0; i < 40 && calls.attacks.length === 0; i++) await new Promise(r => setTimeout(r, 25));
    assert.ok(calls.attacks.length > 0, 'bare hands beat standing still');
});

test('#477 review 2: from the first leave decision until the hand-back (between failed tries too), no melee of a creeper in the opening', async (t) => {
    t.mock.method(console, 'log', () => {});
    const creeper = { id: 5, name: 'creeper', type: 'mob', position: new Vec3(1.5, 64, 0.5), height: 1.7 };
    const { agent, calls } = shelter({ others: [creeper] });
    agent._night = { morningAct: 'leave', morningLeaving: true }; // between two failed leave tries (#477 review 2)
    await selfDefense(agent);
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(calls.attacks, []);
});

test('#477 review 1: resetNight (a death, a new night) during a morning leave clears it: the next night\'s shelter fight swings', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, calls } = shelter();
    agent._night = { state: 'inside', gen: 0, morningAct: 'leaving', morningLeaving: true, morningWhy: 'no weapon', mobFirst: {}, mobStateSaid: true, mobGoneAt: 5 };
    resetNight(agent, 'death');
    assert.deepEqual([agent._night.morningAct, agent._night.morningLeaving, agent._night.morningWhy, agent._night.mobFirst, agent._night.mobStateSaid, agent._night.mobGoneAt], [null, false, null, null, false, null]);
    agent.bot.rotnSheltered = 'open'; // the next night: a wall open, the zombie in reach
    await selfDefense(agent);
    for (let i = 0; i < 40 && calls.attacks.length === 0; i++) await new Promise(r => setTimeout(r, 25));
    assert.ok(calls.attacks.length > 0, 'the shelter fight is back');
});

// Soak 5 (death 5): the bot chased a rabbit into water and drowned; with a walk going (a goal set)
// self_preservation never let it swim up. Out of air it now stops the walk and swims up.
test('soak 5 (death 5): under water with a walk going and 15 of 20 air or less, the walk stops and the bot swims up; with air left, nothing', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { DROWNING } = await import('./modes.js');
    assert.deepEqual(DROWNING, { surfaceAt: 15, swimMs: 6000 });
    const under = (air) => {
        const s = shelter({ zombieAt: 30 });
        Object.assign(s.bot, { rotnSheltered: false, oxygenLevel: air });
        s.self.position = new Vec3(0.5, 64, 0.5);
        s.bot.blockAt = (p) => ({ name: Math.floor(p.y) >= 64 && Math.floor(p.y) <= 65 ? 'water' : 'air', position: p });
        s.bot.pathfinder.goal = { chase: 'rabbit' };
        const controls = [];
        let stops = 0;
        s.bot.pathfinder.stop = () => { stops++; };
        s.bot.setControlState = (c, on) => { controls.push(`${c}:${on}`); if (c === 'jump' && on) s.self.position = new Vec3(0.5, 65, 0.5); };
        return { ...s, controls, stops: () => stops };
    };
    const low = under(8);
    await selfPreservation(low.agent);
    assert.deepEqual(low.ran, ['mode:self_preservation']);
    assert.ok(low.stops() >= 1, 'the walk stops');
    assert.deepEqual(low.controls, ['jump:true', 'jump:false']);
    assert.ok(logs.includes('[reflex] under water with 8 of 20 air: stopping and swimming up'));
    assert.match(low.bot.output, /Swam up: head out of the water\./);
    const fine = under(16);
    await selfPreservation(fine.agent);
    assert.deepEqual(fine.ran, [], 'air left: the walk goes on');
});

// Soak 5 (00:46:52): the fight's eat-between-fights ate the bread first; then "could not eat bread
// (food 20)". The hold checks again when its action runs.
test('soak 5: the hold in the shelter checks the food again when it runs: fed or the food gone meanwhile, it does not try', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { agent, bot } = shelter({ zombieAt: 6 });
    hurt(bot);
    bot.food = 10;
    const bread = { name: 'bread', metadata: 0, count: 1, type: 297 };
    bot.inventory = { items: () => [AXE, ...(bread.count > 0 ? [bread] : [])], slots: [] };
    let tried = 0;
    bot.consume = () => { tried++; return Promise.resolve(); };
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    const run = agent.actions.runAction.bind(agent.actions);
    agent.actions.runAction = (label, fn, o) => { bread.count = 0; bot.food = 20; return run(label, fn, o); }; // eaten elsewhere first
    await selfPreservation(agent);
    assert.equal(tried, 0, 'no second try');
    assert.ok(logs.includes('[reflex] hurt in the shelter: no need to eat minecraft:bread:0 now (food 20)'), logs.join('\n'));
});

// PR 5 (rotn-data #496: the troll hits by distance alone, through a 1-block wall when the bot stands
// against it), the lead's decision: in the shelter, with such a mob within its reach + 1.5, the bot
// stands on the side of its cell away from it (0.3-0.7), in the middle of an axis with such mobs on
// both sides of it; never while the night routine's own work runs.
test('PR 5: a troll near the shelter: the bot steps to the far side of its cell (closed shelter too); the middle with trolls on both sides; not during the repair', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { __resetWallHitters } = await import('./modes.js');
    const { WALL_HITTERS, farSpot, wallHitters } = await import('./library/shelter.js');
    const troll = (id, x, z) => ({ id, name: 'iceandfire:if_troll', type: 'mob', position: new Vec3(x, 64, z), height: 3.5, width: 1.2 });
    const walking = (bot) => {
        let looking = null;
        bot.lookAt = (p) => { looking = p; return Promise.resolve(); };
        bot.setControlState = (k, on) => {
            if (k !== 'forward' || !on || !looking) return;
            const p = bot.entity.position, dx = looking.x - p.x, dz = looking.z - p.z, d = Math.hypot(dx, dz);
            if (d > 0) bot.entity.position = p.offset(dx / d * Math.min(0.05, d), 0, dz / d * Math.min(0.05, d));
        };
    };
    // A troll east, against the wall outside (1.6 from the middle): to x 0.3.
    __resetWallHitters();
    const east = shelter({ zombieAt: 9, others: [troll(5, 2.1, 0.5)] });
    east.bot.rotnSheltered = true;
    walking(east.bot);
    assert.deepEqual(wallHitters(east.bot).map(e => e.id), [5]);
    await selfPreservation(east.agent);
    assert.deepEqual(east.ran, ['mode:self_preservation']);
    assert.ok(Math.abs(east.bot.entity.position.x - WALL_HITTERS.near) <= WALL_HITTERS.tolerance + 1e-9, String(east.bot.entity.position));
    assert.ok(Math.abs(east.bot.entity.position.z - 0.5) <= WALL_HITTERS.tolerance + 1e-9);
    assert.ok(east.bot.entity.position.distanceTo(east.bot.entities[5].position) > 1.7, 'farther than against the wall');
    assert.ok(logs.some(l => /^\[shelter\] iceandfire:if_troll \(hits through walls\) at 2\.1, 64\.0, 0\.5: standing at 0\.30, 0\.50 in the cell, away from it$/.test(l)), logs.join('\n'));
    // Trolls east and west: the middle on x; one also north: away from it on z.
    const both = shelter({ zombieAt: 9, others: [troll(5, 2.1, 0.5), troll(6, -1.1, 0.5), troll(7, 0.5, -1.1)] });
    assert.deepEqual([farSpot(both.bot, Object.values(both.bot.entities).filter(e => e.id >= 5)).x, farSpot(both.bot, Object.values(both.bot.entities).filter(e => e.id >= 5)).z], [0.5, WALL_HITTERS.far]);
    // Too far (reach 2 + 1.5): nothing.
    __resetWallHitters();
    const far = shelter({ zombieAt: 9, others: [troll(5, 4.6, 0.5)] });
    far.bot.rotnSheltered = true;
    await selfPreservation(far.agent);
    assert.deepEqual(far.ran, []);
    // Not while the repair runs; a zombie (no through-wall hit) moves nothing.
    __resetWallHitters();
    const busy = shelter({ zombieAt: 9, label: REPAIR_LABEL, others: [troll(5, 2.1, 0.5)] });
    await selfPreservation(busy.agent);
    assert.deepEqual(busy.interrupts, []);
    // #507 review 5: nor during the morning's opening or dig-out.
    for (const label of ['action:openShelter', 'action:leaveShelter']) {
        __resetWallHitters();
        const morning = shelter({ zombieAt: 9, label, others: [troll(5, 2.1, 0.5)] });
        morning.bot.rotnSheltered = true;
        await selfPreservation(morning.agent);
        assert.deepEqual(morning.interrupts, [], label);
    }
    assert.deepEqual(wallHitters(shelter({ zombieAt: 1 }).bot), [], 'a zombie in the opening: no step');
});

// ---- Soak 7 (rotn-v0.1.13, death 1, 23:24:24-33) ----
// The zombie walked into the bot's cell; the shelter fight was capped ("4 hits did not hurt the
// zombie") while it stood 0.8 m away hitting the bot; then the bot ate okra while being hit.

test('soak 7 (B): a zombie in reach that is hitting the bot is not capped (4 hits that did not hurt it, maxSwings); one that is not hitting still is', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    Object.assign(SHELTER_FIGHT, { swingMs: 10 });
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const pressed = shelter({ zombieAt: 0.8, killAfter: 12 });
    pressed.bot.entities[1].health = 20; // known, and it never goes down
    const attack = pressed.bot.attack;
    pressed.bot.attack = (e) => { attack(e); Object.assign(pressed.bot, { lastDamageTime: Date.now(), lastDamageTaken: 1 }); }; // it hits back each time
    await selfDefense(pressed.agent);
    assert.equal(pressed.calls.attacks.length, 12, 'past sameTargetSwings (4) and maxSwings (8) until it died');
    assert.ok(logs.some(l => /^\[survival\] fight end zombie killed/.test(l)), logs.join('\n'));
    const calm = shelter({ zombieAt: 0.8, killAfter: 12 });
    calm.bot.entities[1].health = 20;
    await selfDefense(calm.agent);
    assert.equal(calm.calls.attacks.length, SHELTER_FIGHT.sameTargetSwings, 'not hitting the bot: capped as before');
});

test('soak 7 (B): each swing waits for the held weapon\'s cooldown (an axe 1.25 s, a sword 0.625 s) and is journaled', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const gaps = async (weapon) => {
        const { agent, bot } = shelter({ killAfter: 2 });
        bot.inventory = { items: () => [weapon], slots: [] };
        bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
        const times = [];
        const attack = bot.attack;
        bot.attack = (e) => { times.push(Date.now()); attack(e); };
        await selfDefense(agent);
        return times.slice(1).map((ms, i) => ms - times[i]);
    };
    const axe = await gaps(AXE);
    assert.equal(axe.length, 1);
    assert.ok(axe[0] >= 1250 - 20, `axe: ${axe[0]} ms`);
    const sword = await gaps({ name: 'stone_sword', metadata: 0, count: 1, type: 272 });
    assert.ok(sword[0] >= 625 - 20 && sword[0] < 1250, `sword: ${sword[0]} ms`);
    assert.ok(logs.some(l => /^\[survival\] swing zombie with stone_axe first: health unknown -> unknown$/.test(l)), logs.join('\n'));
    assert.ok(logs.some(l => /^\[survival\] swing zombie with stone_axe \+1\d\d\d ms: health unknown -> gone$/.test(l)), logs.join('\n'));
});

test('soak 7 (D): after a shelter fight the bot does not eat while hurt within EAT_SAFE.hurtMs or with a hostile mob within 4 blocks', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    Object.assign(SHELTER_FIGHT, { swingMs: 10 });
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const eatsAfter = async ({ others = [], hurt = false } = {}) => {
        const { agent, bot } = shelter({ others });
        const bread = { name: 'bread', metadata: 0, count: 2, type: reg.itemsByName.bread.id };
        bot.inventory = { items: () => [AXE, bread].filter(i => i.count > 0), slots: [] };
        Object.assign(bot, { health: 14, food: 10 });
        if (hurt) Object.assign(bot, { lastDamageTime: Date.now(), lastDamageTaken: 3 });
        bot.consume = () => { bread.count--; bot.food += 5; return Promise.resolve(); };
        await selfDefense(agent);
        await new Promise(r => setTimeout(r, 100));
        return 2 - bread.count;
    };
    assert.equal(await eatsAfter({ hurt: true }), 0, 'hurt just now');
    assert.ok(logs.some(l => /^\[reflex\] not eating between fights in the shelter: hurt 0(\.\d)? s ago$/.test(l)), logs.join('\n'));
    assert.equal(await eatsAfter({ others: [mob(2, 'zombie', 3.5)] }), 0, 'a zombie 3.5 blocks away (out of the fight\'s reach)');
    assert.ok(logs.includes('[reflex] not eating between fights in the shelter: zombie 3.5 blocks away'), logs.join('\n'));
    assert.equal(await eatsAfter(), 1, 'nothing near, not hurt: it eats as before');
});

test('soak 7 (D): hurt in the shelter, the bot does not eat with a hostile mob within 4 blocks (out of reach); at 6 it does', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const run = async (zombieAt) => {
        const { agent, bot } = shelter({ zombieAt });
        hurt(bot);
        bot.food = 10;
        const bread = { name: 'bread', metadata: 0, count: 2, type: 297 };
        const eaten = [];
        bot.inventory = { items: () => [AXE, ...(bread.count > 0 ? [bread] : [])], slots: [] };
        bot.consume = () => { eaten.push(bot.heldItem?.name); bread.count--; bot.food += 5; return Promise.resolve(); };
        bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
        await selfPreservation(agent);
        return eaten;
    };
    assert.deepEqual(await run(3.5), []);
    assert.ok(logs.includes('[reflex] hurt in the shelter: not eating (zombie 3.5 blocks away)'), logs.join('\n'));
    assert.deepEqual(await run(6), ['bread']);
});

test('soak 7 replay (the fight in the cell): the zombie at 0.8 m hitting the bot: no cap, the fight stops only at the health it may take in one hit (its maxDamage); no eat while it is there', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    Object.assign(SHELTER_FIGHT, { swingMs: 10 });
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const { agent, bot, calls } = shelter({ zombieAt: 0.8, killAfter: 1e9 });
    bot.entities[1].health = 20; // "4 hits did not hurt the zombie"
    const okra = { name: 'harvestcraft:okraitem', metadata: 0, count: 1 };
    bot.inventory = { items: () => [AXE, okra].filter(i => i.count > 0), slots: [] };
    Object.assign(bot, { health: 20, food: 13 });
    bot.consume = () => { okra.count--; return Promise.resolve(); };
    const attack = bot.attack;
    bot.attack = (e) => { attack(e); Object.assign(bot, { health: bot.health - 1.5, lastDamageTime: Date.now(), lastDamageTaken: 1.5 }); };
    await selfDefense(agent);
    await new Promise(r => setTimeout(r, 100));
    const swings = Math.ceil((20 - ZOMBIE_HIT) / 1.5); // 1.5 a swing from 20 down to ZOMBIE_HIT or below
    assert.ok(swings > 4, 'more than the 4-hit cap of soak 7');
    assert.equal(calls.attacks.length, swings, `20 -> ${ZOMBIE_HIT} or below in ${swings} swings`);
    assert.ok(logs.some(l => /^\[survival\] fight end zombie stopped/.test(l)), logs.join('\n'));
    assert.ok(!logs.some(l => / capped /.test(l)));
    assert.equal(okra.count, 1, 'no okra while it hits');
    assert.ok(logs.includes('[reflex] not eating between fights in the shelter: zombie 0.8 blocks away'), logs.join('\n'));
});

test('soak 7 (c): the shelter fight (fightInShelter -> defendInPlace; also the morning fight-on and hand-fight) holds its best weapon (the stone sword over a crude axe and a stone axe, on either attack path: soak 7 (e)) at its first swing, and logs it', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    Object.assign(SHELTER_FIGHT, { swingMs: 10 });
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const { agent, bot } = shelter({ killAfter: 1 });
    bot.inventory = { items: () => [{ name: 'pyrotech:crude_axe', metadata: 0, count: 1 }, AXE, { name: 'stone_sword', metadata: 0, count: 1 }], slots: [] };
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    const held = [];
    const attack = bot.attack;
    bot.attack = (e) => { held.push(bot.heldItem?.name ?? 'hand'); attack(e); };
    await selfDefense(agent);
    assert.deepEqual(held, ['stone_sword']);
    assert.deepEqual(logs.filter(l => l.startsWith('[survival] ')).slice(0, 2), ['[survival] fight start zombie (shelter)', '[survival] weapon stone_sword (shelter)']);
});

// Better Combat plan step 2 (#521): defendInPlace awaited nothing; with Better Combat's attack a
// swing can be replaced (sent false) and was still counted in sameTargetSwings and journaled.
test('#521: the shelter fight awaits bot.attack: only a swing that went out is counted and journaled; SHELTER_FIGHT.unsentMax unsent in a row stop it; the pace is bot.forge.attackCooldownTicks()', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    assert.equal(SHELTER_FIGHT.unsentMax, 3);
    const replaced = { sent: false, path: null, waitedMs: 0, reason: 'replaced' };
    const fight = async (results, opts = { swingMs: 10 }) => {
        Object.assign(SHELTER_FIGHT, saved, opts);
        logs.length = 0;
        const { agent, bot, calls } = shelter({ killAfter: 1e9 });
        bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
        bot.forge = { bcAttack: { enabled: true }, attackCooldownTicks: () => 2 }; // bc_attack on (g): 100 ms; a stone axe's vanilla class cooldown is 1250
        let sent = 0;
        bot.attack = (e) => {
            const r = results[calls.attacks.length] ?? { sent: true, path: 'bettercombat', waitedMs: 0 };
            calls.attacks.push(e.id);
            if (r?.sent !== false && ++sent >= 2) delete bot.entities[1]; // dies at the second hit that went out
            return Promise.resolve(r);
        };
        await selfDefense(agent);
        await new Promise(r => setTimeout(r, 50));
        return { tries: calls.attacks.length, swings: logs.filter(l => l.startsWith('[survival] swing ')), output: bot.output };
    };
    // One replaced, then two that went out: 3 tries, 2 swings journaled and counted.
    const one = await fight([replaced]);
    assert.equal(one.tries, 3);
    assert.equal(one.swings.length, 2, one.swings.join('\n'));
    assert.match(one.output, /Fought from inside the shelter: 2 swings, stopped: nothing left in reach\./);
    // Never sent: it stops after unsentMax tries, with no swing journaled.
    const none = await fight([replaced, replaced, replaced, replaced, replaced]);
    assert.equal(none.tries, 3);
    assert.deepEqual(none.swings, []);
    assert.ok(logs.includes('[survival] fight end zombie stopped after 0 s'), logs.join('\n'));
    // swingMs null: the second swing waits Better Combat's cooldown for the held item (100 ms), not 1250.
    const paced = await fight([], { swingMs: null });
    const since = Number(/\+(\d+) ms/.exec(paced.swings[1] ?? '')?.[1]);
    assert.ok(since >= 90 && since < 600, `paced by attackCooldownTicks: ${paced.swings.join(' | ')}`);
});

// #532 review: nit 4, a connection that ended stops the fight at once; nit 3, Better Combat's wait can
// outlast an interrupt or maxMs by one cooldown: a swing that resolves after either is not counted.
test('#532 review: reason "ended" stops the shelter fight at once; a swing that resolves after an interrupt or past maxMs is not counted or journaled', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const fight = async (attack, opts = {}) => {
        Object.assign(SHELTER_FIGHT, saved, { swingMs: 10 }, opts);
        logs.length = 0;
        const { agent, bot } = shelter({ killAfter: 1e9 });
        let tries = 0;
        bot.attack = (e) => { tries++; return attack(bot, e); };
        await selfDefense(agent);
        await new Promise(r => setTimeout(r, 30));
        return { tries, swings: logs.filter(l => l.startsWith('[survival] swing ')), ends: logs.filter(l => l.startsWith('[survival] fight end ')), output: bot.output };
    };
    const ended = await fight(() => Promise.resolve({ sent: false, path: null, waitedMs: 0, reason: 'ended' }));
    assert.equal(ended.tries, 1, 'not retried');
    assert.deepEqual(ended.swings, []);
    assert.match(ended.output, /stopped: the attack was not sent \(ended\)/);
    assert.deepEqual(ended.ends, ['[survival] fight end zombie stopped after 0 s']);
    // The interrupt comes while the call waits for Better Combat's cooldown; the swing then goes out.
    const interrupted = await fight((bot) => new Promise(r => setTimeout(() => { bot.interrupt_code = true; r({ sent: true, path: 'bettercombat', waitedMs: 80 }); }, 80)));
    assert.equal(interrupted.tries, 1);
    assert.deepEqual(interrupted.swings, [], 'not journaled');
    assert.deepEqual(interrupted.ends, ['[survival] fight end zombie interrupted after 0 s']);
    // maxMs passes while it waits (the mob is not hurting the bot, so the cap applies).
    const late = await fight(() => new Promise(r => setTimeout(() => r({ sent: true, path: 'bettercombat', waitedMs: 120 }), 120)), { maxMs: 60 });
    assert.equal(late.tries, 1);
    assert.deepEqual(late.swings, []);
    assert.match(late.output, /stopped: time limit of/);
    assert.deepEqual(late.ends, ['[survival] fight end zombie capped after 0 s']);
});

// #532 re-review nit 3 (net-forge #536): a hit waiting for Better Combat's cooldown is cancelled
// (bot.forge.cancelAttack) when the bot is interrupted or maxMs passes, so it never goes out late.
/** A bot.attack that waits waitMs like Better Combat's path, and a cancelAttack like #536's. */
function waitingAttack(bot, waitMs, onSent = () => {}) {
    const got = { sent: [], cancelled: [] };
    let pending = null;
    bot.attack = (e) => new Promise(resolve => {
        const timer = setTimeout(() => { pending = null; got.sent.push(Date.now()); onSent(e); resolve({ sent: true, path: 'bettercombat', waitedMs: waitMs }); }, waitMs);
        pending = { resolve, timer, since: Date.now() };
    });
    bot.forge = {
        cancelAttack: (reason) => {
            if (!pending) return false;
            clearTimeout(pending.timer);
            const p = pending;
            pending = null;
            got.cancelled.push(reason);
            p.resolve({ sent: false, path: null, waitedMs: Date.now() - p.since, reason });
            return true;
        },
    };
    return got;
}

test('#532 re-review nit 3: the shelter fight cancels a hit still waiting for its cooldown on an interrupt or at maxMs (bot.forge.cancelAttack): it never goes out; a pressed fight is not cancelled at maxMs', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const run = async ({ waitMs = 2500, interruptAt = null, opts = {}, zombieAt = 1, pressed = false } = {}) => {
        Object.assign(SHELTER_FIGHT, saved, { swingMs: 10 }, opts);
        logs.length = 0;
        const { agent, bot } = shelter({ zombieAt, killAfter: 1e9 });
        if (pressed) Object.assign(bot, { lastDamageTime: Date.now(), lastDamageTaken: 1.5 });
        const got = waitingAttack(bot, waitMs, () => delete bot.entities[1]); // a hit that goes out kills it
        if (interruptAt !== null) setTimeout(() => { bot.interrupt_code = true; }, interruptAt);
        const start = Date.now();
        await selfDefense(agent);
        const tookMs = Date.now() - start;
        await new Promise(r => setTimeout(r, waitMs + 100)); // past when the waiting hit would have gone out
        return { ...got, tookMs, swings: logs.filter(l => l.startsWith('[survival] swing ')), ends: logs.filter(l => l.startsWith('[survival] fight end ')) };
    };
    const interrupted = await run({ interruptAt: 150 });
    assert.deepEqual(interrupted.cancelled, ['interrupted']);
    assert.deepEqual(interrupted.sent, [], 'the waiting hit never went out');
    assert.ok(interrupted.tookMs < 1000, `ended within a poll of the interrupt, not a cooldown later: ${interrupted.tookMs} ms`);
    assert.deepEqual(interrupted.swings, []);
    assert.deepEqual(interrupted.ends, ['[survival] fight end zombie interrupted after 0 s']);

    const capped = await run({ opts: { maxMs: 200 } });
    assert.deepEqual(capped.cancelled, ['maxMs']);
    assert.deepEqual(capped.sent, []);
    assert.ok(capped.tookMs < 1000, `${capped.tookMs} ms`);
    assert.deepEqual(capped.ends, ['[survival] fight end zombie capped after 0 s']);

    // The mob in reach and hurting the bot: no cap (soak 7), so maxMs does not cancel the hit.
    const pressed = await run({ waitMs: 400, opts: { maxMs: 100 }, zombieAt: 0.8, pressed: true });
    assert.deepEqual(pressed.cancelled, []);
    assert.equal(pressed.sent.length, 1);
    assert.equal(pressed.swings.length, 1, pressed.swings.join('\n'));
});

// (g) 3, net-forge #541: Better Combat sends nothing to a mob past its reach or out of sight
// ({ sent: false, reason: 'reach' | 'sight' }). In the shelter that is a mob in the bot's melee reach
// behind a block's corner: wait and look again, never three "unsent" swings and the fight over.
test('(g) 3: the shelter fight waits on "sight" or "reach" (not an unsent swing): it hits once the mob comes into sight, and after SHELTER_FIGHT.blockedMs of only those it ends, saying why', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...SHELTER_FIGHT };
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const fight = async (results) => {
        Object.assign(SHELTER_FIGHT, saved, { swingMs: 10, blockedWaitMs: 50, blockedMs: 600, maxMs: 60_000 });
        logs.length = 0;
        const { agent, bot } = shelter({ killAfter: 1e9 });
        let tries = 0;
        bot.attack = () => {
            const r = results(tries++);
            if (r.sent) delete bot.entities[1];
            return Promise.resolve(r);
        };
        await selfDefense(agent);
        await new Promise(r => setTimeout(r, 30));
        return { tries, swings: logs.filter(l => l.startsWith('[survival] swing ')), ends: logs.filter(l => l.startsWith('[survival] fight end ')), output: bot.output };
    };
    const sight = { sent: false, path: null, waitedMs: 0, reason: 'sight' };
    // Out of sight for 5 looks, then in sight: the hit goes out.
    const later = await fight((n) => (n < 5 ? sight : { sent: true, path: 'bettercombat', waitedMs: 0 }));
    assert.equal(later.tries, 6, 'more than unsentMax (3) looks');
    assert.equal(later.swings.length, 1);
    assert.match(later.output, /Fought from inside the shelter: 1 swing/);
    // Never in sight: it ends after blockedMs, not after 3.
    const never = await fight(() => sight);
    assert.ok(never.tries > SHELTER_FIGHT.unsentMax + 3, `${never.tries} looks in 600 ms at 50 ms`);
    assert.match(never.output, /No swing went out from inside the shelter, stopped: the zombie is in reach but out of sight for 0\.6 s\./);
    assert.deepEqual(never.ends, ['[survival] fight end zombie stopped after 1 s']);
    const reach = await fight(() => ({ sent: false, reason: 'reach' }));
    assert.match(reach.output, /the zombie is in reach but beyond the attack reach for 0\.6 s/);
});

// (g) 5, the #539 nit: whether the mob is hurting the bot is looked at live during the wait.
test('(g) 5: a mob that starts hurting the bot while a hit waits for its cooldown is not capped at maxMs: the hit is not cancelled', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = { ...SHELTER_FIGHT };
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    Object.assign(SHELTER_FIGHT, { swingMs: 10, maxMs: 200 });
    const { agent, bot } = shelter({ zombieAt: 0.8, killAfter: 1e9 });
    const got = waitingAttack(bot, 600, () => delete bot.entities[1]);
    setTimeout(() => Object.assign(bot, { lastDamageTime: Date.now(), lastDamageTaken: 1.5 }), 100); // it starts hitting
    await selfDefense(agent);
    await new Promise(r => setTimeout(r, 700));
    assert.deepEqual(got.cancelled, [], 'hurting in reach: no cap');
    assert.equal(got.sent.length, 1);
});

// #592 review nit 4 (soak 12, death 1 at 15:11): the whole chain through the real mode loop. A closed
// shelter, armed, a zombie in the bot's cell: the night routine (closeQuarters) opens the shelter to the
// fight in place, and modes.update runs self_defense -> fightInShelter -> defendInPlace, which swings.
// Before: rotnSheltered stayed true, shelterQuiet kept self_defense quiet, and no swing came.
test('#592 review nit 4: death 1 through modes.update: a closed shelter, armed, a zombie in the bot\'s cell: the night routine opens it and the fight in place swings', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const saved = { ...SHELTER_FIGHT };
    Object.assign(SHELTER_FIGHT, { swingMs: 10 });
    t.after(() => Object.assign(SHELTER_FIGHT, saved));
    const { initModes } = await import('./modes.js');
    const { nightTick, nightState } = await import('./night_routine.js');
    const { agent, bot, calls } = shelter({ zombieAt: 0.1, killAfter: 3 }); // the zombie at 0.6, 64, 0.5: in the bot's cell
    Object.assign(bot, { rotnSheltered: true, time: { timeOfDay: 15000 } });
    Object.assign(agent, { prompter: { getInitModes: () => ({}) }, self_prompter: { isActive: () => false, stop() {} }, control: { blocking: () => null } });
    initModes(agent);
    const n = nightState(agent);
    Object.assign(n, { state: 'inside', site: new Vec3(0, 64, 0), checkedAt: 0 });
    const ops = { siteNeeds: () => ({ todo: [] }), hasWeapon: () => true, buildShelter: () => Promise.resolve({ closed: true }) };
    await bot.modes.update();
    assert.deepEqual(calls.attacks, [], 'closed: self_defense is quiet');
    assert.equal(nightTick(agent, { now: 1000, ops }), 'night:inside');
    assert.equal(bot.rotnSheltered, 'open');
    await bot.modes.update();
    for (let i = 0; i < 60 && calls.attacks.length < 3; i++) await new Promise(r => setTimeout(r, 20));
    assert.ok(calls.attacks.length >= 1, logs.join('\n'));
    assert.ok(logs.includes('[survival] fight start zombie (shelter)'), logs.join('\n'));
});

// Soak 12 (B(ii) step 3): 8 respawn escapes at the scroll's respawn point were interrupted by the
// low-health move away ("the escape was interrupted by self_preservation"), each followed by a death in
// the same pit. The escape is itself the flee: that move away waits; the hazards still act.
test('soak 12 (B(ii) step 3): during the respawn escape, low health does not start self_preservation\'s move away (said once); with no escape it does', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const run = async (escaping) => {
        const { agent, bot, ran } = shelter({ zombieAt: 2 });
        hurt(bot);
        Object.assign(bot, { rotnSheltered: false, rotnEscaping: escaping, blockAt: () => ({ name: 'air', boundingBox: 'empty' }) });
        await selfPreservation(agent);
        return ran;
    };
    assert.deepEqual(await run(true), [], 'no move away over the escape');
    assert.equal(logs.filter(l => /the respawn escape is the flee; not moving away over it$/.test(l)).length, 1);
    assert.deepEqual(await run(false), ['mode:self_preservation'], 'no escape: the move away as before');
});
