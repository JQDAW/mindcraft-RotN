// A fake world for probe BC's offline tests (test/unit/probe-bc.test.js): a mineflayer-shaped bot with a
// fake of net-forge's Better Combat wrapper (#521: bot.attack paced at the cooldown, bot.attackVanilla,
// bot.forge.bcAttack, bot.forge.attackCooldownTicks), and a server that answers the attack packets the way
// rotn-data #518 says the real one does: Better Combat's packet hits in full every time; a vanilla
// use_entity lands only the first time per zombie (Better Combat sets hurtResistantTime to 20).
// Everything runs on its own virtual clock (now, sleep, at), so a 60-s series takes no real time.
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { createRequire } from 'node:module';
import { hitsToKill } from '../../../packages/rotn-data/index.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const tick = () => new Promise((r) => setImmediate(r));

/** A virtual clock: sleep(ms) moves time on, firing every scheduled callback due on the way, in order. */
export function virtualClock(start = 1_000_000) {
    let t = start;
    const due = [];
    const at = (when, fn) => { due.push({ when, fn }); due.sort((a, b) => a.when - b.when); };
    const sleep = async (ms) => {
        const end = t + Math.max(0, ms);
        while (due.length && due[0].when <= end) {
            const d = due.shift();
            t = Math.max(t, d.when);
            d.fn();
            await tick();
        }
        t = end;
        await tick();
    };
    return { now: () => t, sleep, at, pending: () => due.length };
}

// rotn-data's damage on Better Combat's packet against an unarmoured zombie (hitsToKill's perHit and critHit,
// #518, #528): the hand takes 0.5 off, a crit is x1.5.
const k = (weapon) => hitsToKill({ mob: 'minecraft:zombie', weapon, path: 'bettercombat' });
export const BC_DROP = Object.fromEntries(['minecraft:stone_sword', 'minecraft:stone_axe', 'pyrotech:crude_axe', 'hand'].map((w) => [w, { plain: k(w).perHit, crit: k(w).critHit }]));
export const COOLDOWN = { 'minecraft:stone_sword': 13, 'minecraft:stone_axe': 50, 'pyrotech:crude_axe': 22, hand: 13 };
const full = (name) => (name ? (name.includes(':') ? name : `minecraft:${name}`) : 'hand');

/**
 * opt: bcActive (true), noWrapper, vanillaAlways (a vanilla hit lands every time: a server without Better
 * Combat's rule), offPathAt (the Nth Better Combat call falls back to vanilla), earlyAt (the Nth Better
 * Combat swing goes out 100 ms early), missAt (the Nth Better Combat hit does no damage), tripped,
 * burn (the zombie catches fire), handDrop (the bare hand's plain drop), breakAfter (crude-axe hits per axe, 4),
 * critAt (Better Combat hit numbers that crit at random), noSneak (no sneak-attack crit), zombieHealth (20),
 * botY (the bot's feet, 66; the scenario's lane is at 120).
 * Better Combat crits (x1.5) a NoAI zombie's first hit (a sneak attack: it targets nobody, #528); a zombie
 * with its AI already targets the bot.
 * A zombie summoned with {ai: true} walks 1 block a second towards the bot, down to 1.5 blocks.
 */
export function bcWorld(opt = {}) {
    const clock = virtualClock();
    const bot = new EventEmitter();
    const client = new EventEmitter();
    const writes = [];
    let nextId = 100;
    const landedVanilla = new Set();
    const zombies = new Map();
    bot._client = client;
    bot.entity = { position: new Vec3(-44.5, opt.botY ?? 66, -65.5) };
    bot.health = 20;
    bot.entities = {};
    const slots = new Array(46).fill(null);
    let quick = 0;
    const inventory = { slots, hotbarStart: 36, items: () => slots.filter(Boolean) };
    bot.inventory = inventory;
    Object.defineProperty(bot, 'heldItem', { get: () => slots[36 + quick] });
    bot.setQuickBarSlot = (i) => { quick = i; bot.emit('heldItemChanged'); };
    bot.equip = async (item) => {
        const from = slots.indexOf(item);
        const to = 36 + quick;
        [slots[from], slots[to]] = [slots[to], slots[from]];
        bot.emit('heldItemChanged');
        await clock.sleep(50);
    };
    bot.lookAt = async () => {};
    const give = (name, n = 1) => {
        for (let k = 0; k < n; k++) {
            const i = slots.findIndex((s, j) => j >= 9 && !s);
            slots[i] = { name: name.replace(/^minecraft:/, ''), type: 1, count: 1, hits: 0 };
        }
    };
    const clear = () => slots.fill(null);
    const held = () => full(bot.heldItem?.name);

    function summon(x, y, z, { ai = false } = {}) {
        const id = nextId++;
        const hp = opt.zombieHealth ?? 20;
        const e = { id, name: 'zombie', height: 1.95, position: new Vec3(x + 0.5, y, z + 0.5), metadata: { 7: hp }, ai };
        zombies.set(id, { e, health: hp, ai, bcHits: 0 });
        bot.entities[id] = e;
        if (ai) walk(id);
        return e;
    }
    function walk(id) {
        const z = zombies.get(id);
        if (!z || z.health <= 0) return;
        const d = z.e.position.distanceTo(bot.entity.position);
        if (d > 1.5) z.e.position = z.e.position.offset(Math.sign(bot.entity.position.x - z.e.position.x) * Math.min(1, d - 1.5), 0, 0);
        clock.at(clock.now() + 1000, () => walk(id));
    }

    // The server's answer to a hit, 60 ms later: health metadata and status 2 (hurt), or 3 (dead) and the destroy.
    function hit(id, drop) {
        const z = zombies.get(id);
        if (!z || z.health <= 0) return;
        if (drop <= 0) return;   // attackEntityFrom returns false: no metadata, no hurt status
        clock.at(clock.now() + 60, () => {
            z.health = Math.max(0, Math.round((z.health - drop) * 1000) / 1000);
            client.emit('entity_metadata', { entityId: id, metadata: [{ key: 7, type: 2, value: z.health }] });
            if (opt.burn) client.emit('entity_metadata', { entityId: id, metadata: [{ key: 0, type: 0, value: 1 }] });
            if (z.health > 0) client.emit('entity_status', { entityId: id, entityStatus: 2 });
            else {
                client.emit('entity_status', { entityId: id, entityStatus: 3 });
                clock.at(clock.now() + 900, () => { client.emit('entity_destroy', { entityIds: [id] }); delete bot.entities[id]; });
            }
        });
        // A Pyrotech crude axe loses 2 of its 8 durability a landed hit: it breaks after 4 (#518).
        const it = bot.heldItem;
        if (it?.name === 'pyrotech:crude_axe' && ++it.hits >= (opt.breakAfter ?? 4)) {
            slots[36 + quick] = null;
            bot.emit('heldItemChanged');
        }
    }
    const dropFor = (crit = false) => {
        const d = BC_DROP[held()] ?? { plain: 1, crit: 1.5 };
        if (held() === 'hand' && opt.handDrop !== undefined) return crit ? opt.handDrop * 1.5 : opt.handDrop;
        return crit ? d.crit : d.plain;
    };
    client.write = (name, params) => {
        writes.push({ t: clock.now(), name, params });
        if (name === 'custom_payload' && params.channel === 'bettercombat') {
            const id = params.data[2];
            bcN++;
            const z = zombies.get(id);
            const sneak = !!z && !z.ai && z.bcHits === 0 && !opt.noSneak;
            if (z) z.bcHits++;
            hit(id, opt.missAt === bcN ? 0 : dropFor(sneak || (opt.critAt ?? []).includes(bcN)));
        }
        if (name === 'use_entity' && params.mouse === 1) {
            const first = !landedVanilla.has(params.target) || opt.vanillaAlways;
            landedVanilla.add(params.target);
            hit(params.target, first ? dropFor() : 0);
        }
    };
    let bcN = 0;

    if (!opt.noWrapper) {
        // The fake of #521's wrapper: Better Combat's cooldown from the last swing or the last item change.
        let lastSwing = -Infinity;
        let itemAt = -Infinity;
        let lastItem = held();
        bot.on('heldItemChanged', () => { if (held() !== lastItem) { lastItem = held(); itemAt = clock.now(); } });
        const stats = { bettercombat: 0, vanilla: 0, waits: 0, replaced: 0, misses: 0 };
        let calls = 0;
        bot.attackVanilla = (target) => { client.write('arm_animation', { hand: 0 }); client.write('use_entity', { target: target.id, mouse: 1 }); };
        bot.attack = async (target) => {
            calls++;
            if (opt.offPathAt === calls) { stats.vanilla++; bot.attackVanilla(target); return { sent: true, path: 'vanilla', waitedMs: 0 }; }
            const ready = Math.max(lastSwing, itemAt) + COOLDOWN[held()] * 50 - (opt.earlyAt === calls ? 100 : 0);
            const wait = Math.max(0, ready - clock.now());
            if (wait) await clock.sleep(wait);
            client.write('arm_animation', { hand: 0 });
            client.write('custom_payload', { channel: 'bettercombat', data: Buffer.from([5, 1, target.id]) });
            lastSwing = clock.now();
            stats.bettercombat++;
            return { sent: true, path: 'bettercombat', waitedMs: wait };
        };
        bot.forge = {
            attackCooldownTicks: () => COOLDOWN[held()] ?? null,
            bcAttack: {
                get active() { return opt.bcActive !== false; },
                get tripped() { return !!opt.tripped; },
                get stats() { return { ...stats }; },
                status: () => (opt.bcActive !== false ? 'bettercombat attack: on' : 'bettercombat attack: off (bc_attack), vanilla attack'),
            },
        };
    }
    /** The console's whisper as 1.12 sends it to the bot. */
    const whisper = (msg, from = 'Server') => bot.emit('message', { translate: 'commands.message.display.incoming', with: [from, msg] });
    return { bot, client, clock, writes, summon, give, clear, whisper, zombies, kill: () => { for (const id of zombies.keys()) delete bot.entities[id]; zombies.clear(); } };
}
