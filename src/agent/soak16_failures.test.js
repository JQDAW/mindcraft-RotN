// Soak 16's remaining failures (the lead's go on /home/rv/soak16-plan-skills-2.md): death 2 (a hen pecked the bot to death,
// never fought back), night 3 (the roof that would not stay; the bot left in an open hole), the hog's "no drop seen".
// Offline: rotn-data's threat reactions, fakes and harness-ops' fake world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { threatPlan, threatFor, fightRefusal, isWeakProvoked, WEAK_PROVOKED, attackWatched } from './library/threats.js';
import { hurtDetail, noteSpawn, FIRST_SEEN } from './library/survival_log.js';
import { installAttackGuard, attackRefusal } from './library/hands.js';

import { pocketUnderRock, fakeWorld, openShaft, SLOT } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { fillCell, FACE_RETRY } from './library/shelter.js';
import { escape, isTrapped } from './library/escape.js';
import { pitShelter, deeperRefusal, PIT_DEEPER } from './night_routine.js';
import { pickupKillDrops, killCounts, killDropsText, consume } from './library/skills.js';

let nextId = 100;
const mob = (name, x, extra = {}) => ({ id: nextId++, name, type: 'mob', position: new Vec3(x, 64, 0), height: 1, metadata: { 7: 8 }, ...extra });
const CLUB = { name: 'spartanweaponry:club_wood', count: 1 };
const world = { blockAt: () => null, findBlocks: () => [], findBlock: () => null, players: {} }; // no fence or chest: wild
function bot(entities, { health = 20, items = [CLUB], hitAt = null, hit = 2, ...extra } = {}) {
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0, 64, 0) };
    const all = { 0: self };
    for (const e of entities) all[e.id] = e;
    return { entity: self, entities: all, health, food: 15, lastDamageTime: hitAt ?? 0, lastDamageTaken: hit, inventory: { items: () => items, slots: [] }, ...world, ...extra };
}

test('death 2: rotn-data: a hen is food (ignore) that fights back when hit, 2 a peck: a weak provoked animal', () => {
    const hen = mob('animania:hen_rhode_island_red', 1);
    const t = threatFor(hen);
    assert.equal(t.reaction, 'ignore');
    assert.equal(t.provoked?.fightBack, true);
    assert.equal(isWeakProvoked(hen), true);
    assert.equal(isWeakProvoked(mob('animania:bull_holstein', 1)), false, 'a bull: fightBack false');
    assert.equal(isWeakProvoked(mob('zombie', 1)), false);
});

test('death 2: a hen that pecked the bot is fought at once: with the club; with no weapon while health is above 6; fled from at 6 or less', () => {
    const now = 100_000;
    const plan = (opts) => { const hen = mob('animania:hen_rhode_island_red', 1.1); return { hen, p: threatPlan(bot([hen], { hitAt: now - 400, ...opts }), { now }) }; };
    const armed = plan({});
    assert.deepEqual([armed.p.action, armed.p.why, armed.p.from], ['fight', 'provoked', armed.hen]);
    assert.equal(armed.p.isEnemy(armed.hen), true);
    assert.equal(plan({ items: [] }).p.action, 'fight', 'no weapon at 20: fought (fleeing does not shake a hen)');
    assert.equal(plan({ items: [], health: WEAK_PROVOKED.noWeaponHealth + 1 }).p.action, 'fight');
    const low = plan({ items: [], health: WEAK_PROVOKED.noWeaponHealth });
    assert.deepEqual([low.p.action, low.p.why], ['flee', 'provoked, and no weapon, and health 6, at most 6']);
    assert.deepEqual([plan({ health: 3 }).p.action, plan({ health: 2 }).p.action], ['fight', 'flee'], 'armed: fought above its 2');
    // Not hit: a hen is food, never a threat by itself (the hunting reflex and !attack are unchanged).
    const calm = mob('animania:hen_rhode_island_red', 1.1);
    assert.equal(threatPlan(bot([calm]), { now }), null);
    // The hit was a fall: not the hen's.
    const fell = mob('animania:hen_rhode_island_red', 1.1);
    assert.equal(threatPlan(bot([fell], { hitAt: now - 400, lastDamageCause: 'fall' }), { now }), null);
    // fightRefusal for a stronger animal keeps the old rule: no weapon is no fight.
    assert.equal(fightRefusal(bot([], { items: [] }), mob('zombie', 2)), 'no weapon');
});

test('death 2: a hen that may be a player\'s (no readable data) is backed off from, not hit', () => {
    const now = 100_000;
    const hen = mob('animania:hen_rhode_island_red', 1.1, { metadata: {} });
    const p = threatPlan(bot([hen], { hitAt: now - 400 }), { now });
    assert.deepEqual([p.action, p.why], ['flee', 'provoked, and it may be a player\'s']);
});

test('death 2: the hurt detail leaves out an entity first seen at or after the last drop (the Zombie Player a death spawns at the bot\'s spot)', () => {
    const now = 50_000;
    const hen = mob('animania:hen_rhode_island_red', 1.3);
    const zp = { id: 999, name: 'zombie_players:zombie_player', type: 'mob', position: new Vec3(0, 64, 0), height: 1.8 };
    const b = bot([hen, zp]);
    const state = {};
    noteSpawn(state, hen, now - 30_000);
    noteSpawn(state, zp, now + 20); // its spawn packet, just after the killing hit's health packet
    const drops = [{ at: now, amount: 1, source: 'animania:hen_rhode_island_red' }];
    const swings = new Map([[hen.id, now]]);
    const line = hurtDetail(b, drops, { swings, now: now + 30, start: now, firstSeen: state.firstSeen });
    assert.match(line, /near animania:hen_rhode_island_red@1\.3m\/swung-0s$/);
    assert.doesNotMatch(line, /zombie_player/);
    // Seen long before the hit: still listed.
    noteSpawn(state, zp, now - 10_000);
    assert.match(hurtDetail(b, drops, { swings, now: now + 30, start: now, firstSeen: state.firstSeen }), /zombie_players:zombie_player@0m/);
    assert.ok(FIRST_SEEN.slackMs > 0);
});

/** A fake of the bridge's Better Combat replacement (installBetterCombatAttack): it records each sent target. */
function bcBot() {
    const sent = [];
    const b = { rotnAttackTarget: null };
    b.attack = (target) => { sent.push(target.id); return Promise.resolve({ sent: true, path: 'bettercombat', waitedMs: 0 }); };
    return { b, sent };
}

test('death 2: the guard on bot.attack: a passive animal is hit only when the calling skill named it; hostiles never refused; the Better Combat path still runs', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const { b, sent } = bcBot();
    installAttackGuard(b, { threatFor });
    const hog = mob('animania:hog_old_spot', 2), hen = mob('animania:hen_rhode_island_red', 2.5), zombie = mob('zombie', 3);
    // !attack on the hog names it (attackEntity): the hit goes through the Better Combat path.
    b.rotnAttackTarget = { id: hog.id, by: 'attack (pvp)', at: Date.now() };
    assert.deepEqual(await b.attack(hog), { sent: true, path: 'bettercombat', waitedMs: 0 });
    // A call naming the hen while the hog is the target: refused, said once, nothing sent.
    assert.deepEqual(await b.attack(hen), { sent: false, path: null, waitedMs: 0, reason: 'guard' });
    await b.attack(hen);
    assert.deepEqual(sent, [hog.id]);
    assert.equal(lines.filter(l => l.startsWith('[attack] refused:')).length, 1);
    assert.match(lines.find(l => l.startsWith('[attack] refused:')), new RegExp(`^\\[attack\\] refused: animania:hen_rhode_island_red#${hen.id} is a food animal, not the target the skill named \\(attack \\(pvp\\) named #${hog.id}\\)$`));
    assert.ok(lines.includes(`[attack] attack (pvp) -> animania:hog_old_spot#${hog.id}`), lines.join('\n'));
    // Hostiles are never refused, named or not.
    await b.attack(zombie);
    assert.deepEqual(sent, [hog.id, zombie.id]);
    // The reflex's fight names its target (attackWatched): the provoked hen is hit.
    await attackWatched(b, hen);
    assert.deepEqual(sent, [hog.id, zombie.id, hen.id]);
    // A player is never hit unless named.
    assert.match(attackRefusal({ rotnAttackTarget: null }, { id: 5, type: 'player', name: 'Alex' }, threatFor), /a player/);
    // The wrapper stays on top after a re-install (login/spawn) and is installed once.
    const top = b.attack;
    installAttackGuard(b, { threatFor });
    assert.equal(b.attack, top);
});

// ---- Night 3: the roof that would not stay; the open hole ----
const quietT = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const useReg = (t, b) => { __setRegistryForTest(b.registry); t.after(() => __setRegistryForTest(null)); };

test('night 3: a roof the server refuses on its first face is placed on another (after FACE_RETRY.waitMs); the line names the faces tried', async (t) => {
    quietT(t);
    // The hole: the bot at 0, 61, 0 in a 1x1 hole 3 deep in dirt; the roof cell 0, 63, 0.
    const w = fakeWorld({ ground: [{ below: 64, block: 'dirt' }], set: { '0,61,0': 'air', '0,62,0': 'air', '0,63,0': 'air' }, at: new Vec3(0, 61, 0), slots: { 36: ['cobblestone', 4] } });
    useReg(t, w.bot);
    const roof = new Vec3(0, 63, 0);
    const place = w.bot.placeBlock;
    const refs = [];
    w.bot.placeBlock = (ref, face) => { refs.push(`${ref.position}`); return refs.length <= 2 ? Promise.reject(new Error('refused')) : place.call(w.bot, ref, face); };
    const mode = { accept: (b) => !!b && b.name === 'cobblestone', items: (bot) => bot.inventory.items().filter(i => i.name === 'cobblestone') };
    const interior = new Set(['0,61,0', '0,62,0']);
    const t0 = Date.now();
    assert.equal(await fillCell(w.bot, roof, interior, mode, new Map()), true);
    assert.equal(w.bot.blockAt(roof).name, 'cobblestone');
    assert.equal(refs[0], refs[1], 'the same face twice (as before)');
    assert.notEqual(refs[2], refs[0], 'then another face');
    assert.ok(Date.now() - t0 >= FACE_RETRY.waitMs);
    // Refused on every face: the line says how many other faces were tried.
    const w2 = fakeWorld({ ground: [{ below: 64, block: 'dirt' }], set: { '0,61,0': 'air', '0,62,0': 'air', '0,63,0': 'air' }, at: new Vec3(0, 61, 0), slots: { 36: ['cobblestone', 4] } });
    w2.bot.placeBlock = () => Promise.reject(new Error('refused'));
    const reasons = new Map();
    assert.equal(await fillCell(w2.bot, roof, interior, mode, reasons), false);
    assert.match(reasons.get('0,63,0'), /the block did not stay \(placed twice; now air; against dirt at .*; then 3 other faces tried\)$/);
});

test('night 3: a hole whose roof does not stay goes one deeper once a night (no hostile within 8, a safe cell below), the roof one lower', async (t) => {
    quietT(t);
    const w = fakeWorld({ ground: [{ below: 64, block: 'dirt' }], set: { '0,61,0': 'air', '0,62,0': 'air', '0,63,0': 'air' }, at: new Vec3(0, 61, 0) });
    useReg(t, w.bot);
    const feet = new Vec3(0, 61, 0);
    const builds = [];
    const ops = {
        digPit: () => Promise.resolve(feet),
        buildShelter: (bot, { site }) => { builds.push(`${site}`); return Promise.resolve(builds.length === 1 ? { closed: false, feet: site, stuck: [site.offset(0, 2, 0)], line: 'not closed' } : { closed: true, feet: site, line: 'closed' }); },
        hostileNear: () => null,
        digDeeper: (bot, below) => { w.world.set(below, 'air'); bot.entity.position = new Vec3(0.5, below.y, 0.5); return Promise.resolve(true); },
    };
    const n = {};
    const r = await pitShelter(w.bot, ops, {}, n);
    assert.equal(r.closed, true);
    assert.deepEqual(builds, ['(0, 61, 0)', '(0, 60, 0)'], 'the second build one deeper: the roof at 62, the old head cell');
    assert.equal(n.deeperTried, true);
    // Once a night.
    builds.length = 0;
    w.bot.entity.position = new Vec3(0.5, 61, 0.5);
    const again = await pitShelter(w.bot, ops, {}, n);
    assert.equal(again.closed, false);
    assert.deepEqual(builds, ['(0, 61, 0)']);
    // The refusals: a hostile within 8; water beside the cell below; nothing under it.
    w.world.set(new Vec3(0, 60, 0), 'dirt'); // the cell below as it was
    assert.match(deeperRefusal(w.bot, { hostileNear: () => ({ name: 'zombie' }) }, feet), /a zombie within 8 blocks/);
    w.world.set(new Vec3(1, 60, 0), 'water');
    assert.match(deeperRefusal(w.bot, { hostileNear: () => null }, feet), /has water next to it/);
    w.world.set(new Vec3(1, 60, 0), 'dirt');
    w.world.set(new Vec3(0, 59, 0), 'air');
    assert.match(deeperRefusal(w.bot, { hostileNear: () => null }, feet), /nothing solid under 0, 60, 0/);
    assert.equal(PIT_DEEPER.hostileRange, 8);
});

test('night 3: at the bottom of an open hole the morning-budget escape says "already out"; the strict one (the night\'s, after a walk that found no way) climbs out', async (t) => {
    quietT(t);
    const w = openShaft({ depth: 3 });
    useReg(t, w.bot);
    const loose = await escape(w.bot, {});
    assert.deepEqual([loose.out, loose.how], [true, 'already'], 'the sky over the hole counts as out (night 3\'s "got out at -7, 65, 30")');
    const strict = await escape(w.bot, { strict: true });
    assert.equal(strict.out, true, strict.why);
    assert.notEqual(strict.how, 'already');
    assert.equal(isTrapped(w.bot).trapped, false, `${w.bot.entity.position}`);
    assert.ok(strict.dug > 0, 'it dug its way up');
});

// ---- The hog's "no drop seen" and the pork !consume could not find ----
test('the hog: a drop picked up at once (no item entity ever seen) is named from the inventory gain since the attack began', async (t) => {
    quietT(t);
    const items = [{ name: 'spartanweaponry:club_wood', count: 1 }];
    const b = { entities: {}, inventory: { items: () => items }, interrupt_code: false };
    const since = killCounts(b);
    items.push({ name: 'animania:raw_prime_pork', count: 3 });
    const r = await pickupKillDrops(b, new Vec3(0, 64, 0), { maxMs: 200, step: 50, since });
    assert.equal(killDropsText(r), 'picked up 3 animania:raw_prime_pork');
    // Nothing came in: the old line.
    assert.match(killDropsText(await pickupKillDrops(b, new Vec3(0, 64, 0), { maxMs: 100, step: 50, since: killCounts(b) })), /^no drop seen within 4 blocks/);
});

test('the pork in the 2x2 grid (a craft cut short): !consume puts the grid back and eats it, saying where it was; the off hand counts too', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const pork = { name: 'animania:raw_prime_pork', count: 3, metadata: 0, type: 1 };
    const slots = new Array(46).fill(null);
    slots[1] = { ...pork, slot: 1 };
    const b = {
        output: '', inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), selectedItem: null, firstEmptyInventorySlot: () => 20 },
        _client: { write: (name) => { if (name === 'close_window') { slots[20] = { ...slots[1], slot: 20 }; slots[1] = null; } } },
        modes: { isOn: () => false }, entity: { position: new Vec3(0, 64, 0) }, food: 10,
    };
    b.equip = () => { throw new Error('stop here'); }; // the eat itself is food.js's (tested there)
    try { await consume(b, 'animania:raw_prime_pork'); } catch { /* the stubbed equip */ }
    assert.doesNotMatch(b.output, /You do not have any/);
    assert.match(b.output, /Eating animania:raw_prime_pork \(it was in the 2x2 crafting grid; put back first\)\./);
    assert.equal(slots[1], null);
    // The off hand.
    const slots2 = new Array(46).fill(null);
    slots2[45] = { ...pork, slot: 45 };
    const b2 = { output: '', inventory: { slots: slots2, items: () => [], selectedItem: null }, modes: { isOn: () => false }, entity: { position: new Vec3(0, 64, 0) }, food: 10, equip: () => { throw new Error('stop'); } };
    try { await consume(b2, 'animania:raw_prime_pork'); } catch { /* the stubbed equip */ }
    assert.match(b2.output, /Eating animania:raw_prime_pork \(from the off hand\)\./);
    assert.equal(lines.length, 0);
});
