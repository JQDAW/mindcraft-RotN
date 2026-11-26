// Better Combat's own main-hand attack (G4 survival, soak 7 death; rotn-data #518).
//
// On RotN 3.3.4, a vanilla use_entity ATTACK (mineflayer bot.attack, mineflayer-pvp)
// lands in full only on the first hit per mob. Better Combat's AttackEntityEvent
// handler sets the target's hurtResistantTime to 20 on every vanilla player attack,
// so attackEntityFrom then deals only the amount above lastDamage. Better Combat's
// own PacketMainhandAttack hits in full every time.
//
// This module sends that packet instead, paced as Better Combat's client paces it.
// It is off unless the bc_attack setting or FORGE_BC_ATTACK turns it on, and any
// doubt falls back to the vanilla attack.
//
// Everything below was read with javap from the pinned pack zip; no mod code was run.
// ImmersiveCombat-12-13-25.jar (modid bettercombat):
// - CommonProxy: PacketHandler.registerChannel("bettercombat"), a SimpleNetworkWrapper.
// - PacketHandler: PacketMainhandAttack, discriminator 5, Side.SERVER.
// - PacketMainhandAttack.toBytes: writeBoolean(entityId != null), then, when not null,
//   ByteBufUtils.writeVarInt(buf, entityId, 4). fromBytes mirrors it.
// - EventHandlersClient.calculateAttackSpeedTicks: (int)(20 / clamp(speed, 0.1, 20) + 0.5).
//   BetterCombatHand.setAttackCooldown raises that to at least 8.
// - The cooldown restarts on every swing (overwriteLeftClick) and when the main-hand item
//   changes (checkItemstacksChanged -> resetMainhandCooldown).
// Forge 14.23.5.2860:
// - FMLIndexedMessageToMessageCodec: payload = discriminator byte + toBytes, with no
//   length prefix.
// - NetworkDispatcher.handleServerSideCustomPacket accepts any channel that is in the
//   server's own NetworkRegistry. The client's REGISTER is not consulted.
// config/bettercombat.cfg (the numbers are in BC_CONFIG).

import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { Reader, Writer, WireError } from './wire.js';
import { callerOf, targetName } from './attack-caller.js';

export const BC_MODID = 'bettercombat';
export const BC_CHANNEL = 'bettercombat';
export const BC_DISC = Object.freeze({ MAINHAND_ATTACK: 5 });

// config/bettercombat.cfg in the pinned zip.
export const BC_CONFIG = Object.freeze({
    minimumTicks: 8,         // "Minimum Attack Speed Tick Cooldown"=8
    addedTicks: 0.5,         // "Added Attack Speed Tick Cooldown"=0.5
    nonWeaponSpeed: 1.5,     // "Unarmed & Non-Weapon Attack Speed"=1.5
    baseReach: 4.0,          // "Attribute Base Reach Distance"=4.0
    nonWeaponReachReduction: 0.5, // "Unarmed & Non-Weapon Reach Reduction"=0.5
    // "Sword Tweaker": the first substring that matches wins.
    swordTweaks: Object.freeze([['golden_sword', 0.2], ['stone_sword', -0.1], ['wooden_sword', 0.2]]),
});

// ByteBufUtils.writeVarInt(buf, id, 4): at most 4 bytes, so ids below 2^28.
const VARINT4_LIMIT = 2 ** 28;
const TICK_MS = 50;

/** PacketMainhandAttack's payload on the bettercombat channel; null = a swing at nothing. */
export function encodeMainhandAttack(entityId = null) {
    const w = new Writer().u8(BC_DISC.MAINHAND_ATTACK);
    if (entityId === null || entityId === undefined) return w.bool(false).toBuffer();
    if (!Number.isInteger(entityId) || entityId < 0 || entityId >= VARINT4_LIMIT) {
        throw new RangeError(`bettercombat: entity id ${entityId} does not fit Forge's 4-byte VarInt`);
    }
    return w.bool(true).varint(entityId).toBuffer();
}

/** The server side's reading of that payload (FMLIndexedMessageToMessageCodec + fromBytes). */
export function decodeMainhandAttack(buf) {
    const r = new Reader(Buffer.from(buf));
    const disc = r.u8();
    if (disc !== BC_DISC.MAINHAND_ATTACK) throw new WireError(`bettercombat: discriminator ${disc}, expected ${BC_DISC.MAINHAND_ATTACK}`, 0);
    if (!r.bool()) return { disc, entityId: null };
    return { disc, entityId: r.varint(4) };
}

/**
 * Vanilla ModifiableAttributeInstance.computeValue on an entity_update_attributes entry:
 * base + op 0 amounts, times (1 + the sum of the op 1 amounts), times each (1 + op 2 amount).
 * @param {{value:number, modifiers?:{amount:number, operation:number}[]}|undefined} attr
 * @returns {number|null} null when the server has not sent the attribute
 */
export function attributeValue(attr) {
    if (!attr || !Number.isFinite(attr.value)) return null;
    const mods = attr.modifiers ?? [];
    let v = attr.value;
    for (const m of mods) if (m.operation === 0) v += m.amount;
    let sum1 = 0;
    for (const m of mods) if (m.operation === 1) sum1 += m.amount;
    v += v * sum1;
    for (const m of mods) if (m.operation === 2) v *= 1 + m.amount;
    return v;
}

// Better Combat counts ItemSword, ItemTool and ItemHoe as weapons (its "(Class) Item
// Whitelist"). The client cannot see classes, so this goes by name. An item this does not
// recognise gets the slower of the two possible cooldowns (see bcCooldownTicks).
// Pyrotech's crude tools are weapons by class too (javap on pyrotech-1.12.2-1.5.25.jar from the
// pinned zip, and the vanilla 1.12.2 server jar mapped with Forge's deobfuscation_data):
// ItemCrudeAxe (registry name crude_axe) extends ItemAxeBase extends ItemAxe (agy) extends
// ItemTool (ahq); the crude pickaxe, shovel and hoe extend ItemPickaxe, ItemSpade and ItemHoe.
// Better Combat matches its class list with Class.isInstance (ConfigurationHandler), so
// subclasses count: pyrotech:crude_axe has the weapon reach, 4.0.
const WEAPON_NAME = /(?:^|[_:])(?:sword|axe|pickaxe|shovel|spade|hoe)$/;

// Better Combat non-weapons whose names look like a weapon's (rotn-data 3.3.4/weapons.json,
// bcWeapon false: a plain Item, not on the class list). The other six of its seven non-weapons
// (mason picks, mattock, crowbar, staff, pickarang) do not match WEAPON_NAME anyway.
const NON_WEAPON_NAMES = new Set(['earthworks:tool_hand_axe']);

export function isBcWeaponName(name) {
    return typeof name === 'string' && WEAPON_NAME.test(name) && !NON_WEAPON_NAMES.has(name);
}

function swordTweak(name) {
    for (const [sub, add] of BC_CONFIG.swordTweaks) if (name.includes(sub)) return add;
    return 0;
}

export function ticksForSpeed(speed) {
    const clamped = Math.min(20, Math.max(0.1, speed));
    return Math.max(BC_CONFIG.minimumTicks, Math.trunc(20 / clamped + BC_CONFIG.addedTicks));
}

/**
 * Better Combat's main-hand cooldown in ticks.
 * - An empty hand: the non-weapon speed (1.5): 13 ticks.
 * - A weapon by name: the player's attack speed attribute plus the sword tweak.
 *   Stone sword 1.6 - 0.1 = 1.5: 13 ticks. Stone axe 0.4: 50 ticks. Crude axe 0.9: 22 ticks.
 * - Anything else: the slower of the weapon and non-weapon cooldowns, so the bot is never
 *   faster than a real client.
 * @returns {number|null} null when the weapon's speed is unknown
 */
export function bcCooldownTicks({ itemName = null, attackSpeed = null } = {}) {
    const nonWeapon = ticksForSpeed(BC_CONFIG.nonWeaponSpeed);
    if (!itemName) return nonWeapon;
    if (attackSpeed === null || !Number.isFinite(attackSpeed)) return null;
    const own = ticksForSpeed(attackSpeed + swordTweak(itemName));
    return isBcWeaponName(itemName) ? own : Math.max(own, nonWeapon);
}

/**
 * The cooldown when the held weapon's attack speed is unknown (no attribute from the server):
 * the slowest main-hand speed on the pack, 0.4 (rotn-data 3.3.4/weapons.json, e.g. the stone
 * and steel axes; its largest bcCooldownTicks is 50), so the bot is never faster than a client.
 */
export const UNKNOWN_SPEED_TICKS = ticksForSpeed(0.4);

/** Reach for the held item: 4.0 for a weapon, 3.5 for an empty hand or a non-weapon. */
export function bcReach(itemName) {
    return isBcWeaponName(itemName) ? BC_CONFIG.baseReach : BC_CONFIG.baseReach - BC_CONFIG.nonWeaponReachReduction;
}

/**
 * bc_attack: FORGE_BC_ATTACK (on|off) wins over settings.bc_attack; the default is off.
 * @returns {{ on: boolean, source: string, warning: string|null }}
 */
export function bcAttackSetting(envRaw, settingRaw) {
    let warning = null;
    if (envRaw !== undefined && envRaw !== null && envRaw !== '') {
        const v = String(envRaw).toLowerCase();
        if (['on', '1', 'true'].includes(v)) return { on: true, source: 'FORGE_BC_ATTACK', warning };
        if (['off', '0', 'false'].includes(v)) return { on: false, source: 'FORGE_BC_ATTACK', warning };
        warning = `FORGE_BC_ATTACK ${JSON.stringify(envRaw)} ignored (on or off expected)`;
    }
    if (settingRaw === true || settingRaw === false) return { on: settingRaw, source: 'bc_attack', warning };
    if (settingRaw !== undefined && settingRaw !== null) {
        warning = [warning, `bc_attack ${JSON.stringify(settingRaw)} ignored (true or false expected)`].filter(Boolean).join('; ');
    }
    return { on: false, source: 'default', warning };
}

const ATTACK_SPEED_KEYS = ['generic.attackSpeed', 'minecraft:generic.attack_speed', 'generic.attack_speed'];

function heldName(bot) {
    const it = bot.heldItem;
    return it ? (it.name ?? String(it.type)) : null;
}

function botAttackSpeed(bot) {
    const attrs = bot.entity?.attributes;
    if (!attrs) return null;
    for (const k of ATTACK_SPEED_KEYS) if (attrs[k]) return attributeValue(attrs[k]);
    return null;
}

// A living entity's health: mineflayer's entity.health, else 1.12's EntityLivingBase metadata 7.
function healthOf(entity) {
    if (Number.isFinite(entity?.health)) return entity.health;
    const m = entity?.metadata?.[7];
    return Number.isFinite(m) ? m : null;
}

function eyeOf(bot) {
    const p = bot.entity?.position;
    if (!p) return null;
    return { x: p.x, y: p.y + (bot.entity.eyeHeight ?? 1.62), z: p.z };
}

function boxOf(target) {
    const p = target.position;
    const hw = (target.width ?? 0.6) / 2;
    const h = target.height ?? 1.8;
    return { minX: p.x - hw, maxX: p.x + hw, minY: p.y, maxY: p.y + h, minZ: p.z - hw, maxZ: p.z + hw };
}

/** Distance from the bot's eye to the nearest point of the target's hitbox. */
export function reachDistance(eye, target) {
    const b = boxOf(target);
    const dx = Math.max(b.minX - eye.x, 0, eye.x - b.maxX);
    const dy = Math.max(b.minY - eye.y, 0, eye.y - b.maxY);
    const dz = Math.max(b.minZ - eye.z, 0, eye.z - b.maxZ);
    return Math.hypot(dx, dy, dz);
}

// A clear line from the eye to the hitbox's centre or its upper part. Better Combat's
// client aims with a mouse-over ray that stops at blocks.
function defaultLineOfSight(bot, eye, target) {
    const world = bot.world;
    if (!world || typeof world.raycast !== 'function') return false;
    const Vec3 = bot.entity.position.constructor;
    const from = new Vec3(eye.x, eye.y, eye.z);
    const b = boxOf(target);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    for (const y of [(b.minY + b.maxY) / 2, b.minY + (b.maxY - b.minY) * 0.85]) {
        const to = new Vec3(cx, y, cz);
        const d = to.minus(from);
        const len = d.norm();
        if (len < 1e-6) return true;
        let hit;
        try { hit = world.raycast(from, d.scaled(1 / len), len); } catch { hit = null; }
        if (!hit) return true;
    }
    return false;
}

/** At most this many replacements are kept between two attack-counts lines (the oldest are dropped). */
const MAX_REPLACEMENTS = 20;

/**
 * Replaces bot.attack with Better Combat's attack when it is on and the server has the
 * channel; keeps the original as bot.attackVanilla.
 *
 * bot.attack(target, swing = true) returns a promise of
 * { sent, path: 'bettercombat'|'vanilla'|null, waitedMs, reason? }. Callers may ignore it.
 * - Better Combat path: wait out the cooldown, then send arm_animation (main hand), then
 *   PacketMainhandAttack(target.id). It never sends use_entity as well. A newer call
 *   replaces a waiting one; the replaced call resolves { sent: false, reason: 'replaced' }.
 *   A waiting call whose target is gone (isValid false, or no longer in bot.entities) when
 *   its cooldown is up sends nothing and resolves { sent: false, reason: 'gone' }; it does
 *   not count toward the self-check.
 * - cancel(reason) ends a waiting call at once: it sends nothing (no swing, no payload) and
 *   resolves { sent: false, path: null, waitedMs, reason }. A no-op when nothing waits; not a
 *   miss. Skills call it on an interrupt, so no hit goes out up to one cooldown later.
 * - The clock is performance.now() (monotonic), so a wall-clock step cannot send early.
 * - While Better Combat's path is active, a target out of its reach (or without a position)
 *   or out of sight gets nothing: the call resolves { sent: false, reason: 'reach' } or
 *   { sent: false, reason: 'sight' }, checked at the call and again when a wait ends. No
 *   use_entity goes out instead. An unknown attack speed is paced at UNKNOWN_SPEED_TICKS.
 * - Vanilla fallback, only when bc_attack is on but the server lacks the mod or the channel,
 *   or the self-check has tripped: the vanilla attack, paced, waiting, replaced, gone and
 *   cancelled exactly like the Better Combat path; its swing restarts the cooldown.
 * - Setting off: the vanilla attack at once, unpaced, as mineflayer sends it.
 * - Self-check: each Better Combat hit should give an entityHurt or entityDead for the
 *   target, or a drop in its health metadata, within checkMs (#540: a hit lowered the health
 *   but its entity_status 2 never came). After maxMisses hits in a row without one, the bot is back on
 *   vanilla for this connection.
 *
 * @param {object} bot mineflayer bot
 * @param {object} opts
 * @param {() => object|null} opts.bridge the forge bridge (serverMods, serverChannels), or null
 * @param {boolean} opts.enabled
 */
export function installBetterCombatAttack(bot, {
    bridge, enabled, log = (m) => console.log(`[forge-bridge] ${m}`),
    now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
    lineOfSight = defaultLineOfSight, checkMs = 500, maxMisses = 5,
} = {}) {
    const st = {
        enabled: !!enabled, tripped: false, misses: 0,
        lastSwingAt: -Infinity, itemKey: undefined, itemChangedAt: -Infinity,
        pending: null,
        // Soak 16 death 2: who sends the hit. firing is the bot.attack caller while its packet is written
        // (attack-counts.js reads it, also for a call that waited out its cooldown); replacements are the
        // waiting calls a newer call replaced, with both callers and targets, until attack-counts takes them.
        firing: null, replacements: [],
        stats: { bettercombat: 0, vanilla: 0, waits: 0, replaced: 0, gone: 0, cancelled: 0, reach: 0, sight: 0, misses: 0 },
    };
    const checks = new Map(); // target id -> [{ timer, done }]

    function serverHasIt() {
        const b = bridge?.();
        if (!b) return false;
        const mods = b.serverMods ?? b.modList ?? [];
        return mods.some((m) => m.modid === BC_MODID) && (b.serverChannels ?? []).includes(BC_CHANNEL);
    }

    function active() { return st.enabled && !st.tripped && serverHasIt(); }

    function noteItem() {
        const key = heldName(bot);
        if (key !== st.itemKey) {
            if (st.itemKey !== undefined) st.itemChangedAt = now();
            st.itemKey = key;
        }
    }
    // Durability changes also fire heldItemChanged; only a different item restarts the cooldown.
    bot.on?.('heldItemChanged', noteItem);

    // The ticks the wrapper paces the held item at: Better Combat's, or UNKNOWN_SPEED_TICKS.
    function cooldownTicks() {
        noteItem();
        return bcCooldownTicks({ itemName: st.itemKey, attackSpeed: botAttackSpeed(bot) }) ?? UNKNOWN_SPEED_TICKS;
    }

    function readyAt(ticks) { return Math.max(st.lastSwingAt, st.itemChangedAt) + ticks * TICK_MS; }

    function settle(c, hurt) {
        if (c.done) return;
        c.done = true;
        clearTimer(c.timer);
        if (hurt) { st.misses = 0; return; }
        st.misses++;
        st.stats.misses++;
        if (st.misses >= maxMisses && !st.tripped) {
            st.tripped = true;
            log(`bettercombat attack: ${st.misses} hits without a hurt, back to vanilla for this connection`);
        }
    }
    // A drop in the target's health metadata is a hurt too: the status packet can be missing.
    bot.on?.('entityUpdate', (entity) => {
        const list = entity && checks.get(entity.id);
        if (!list) return;
        const h = healthOf(entity);
        if (h === null) return;
        for (const c of [...list]) {
            if (c.health !== null && h < c.health) { list.splice(list.indexOf(c), 1); settle(c, true); }
        }
        if (!list.length) checks.delete(entity.id);
    });

    function onHurt(entity) {
        const list = entity && checks.get(entity.id);
        if (!list) return;
        checks.delete(entity.id);
        for (const c of list) settle(c, true);
    }
    bot.on?.('entityHurt', onHurt);
    bot.on?.('entityDead', onHurt);
    // A target that leaves the bot's view proves nothing either way: its checks are dropped, not missed.
    bot.on?.('entityGone', (entity) => {
        const list = entity && checks.get(entity.id);
        if (!list) return;
        checks.delete(entity.id);
        for (const c of list) { c.done = true; clearTimer(c.timer); }
    });

    function watch(id, target) {
        const c = { done: false, timer: null, health: healthOf(bot.entities?.[id] ?? target) };
        c.timer = setTimer(() => {
            const list = checks.get(id);
            if (list) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); if (!list.length) checks.delete(id); }
            settle(c, false);
        }, checkMs);
        if (!checks.has(id)) checks.set(id, []);
        checks.get(id).push(c);
    }

    function vanilla(target, swing, waitedMs = 0) {
        st.stats.vanilla++;
        st.vanillaAttack(target, swing);
        return { sent: true, path: 'vanilla', waitedMs };
    }

    function unsent(reason, waitedMs) {
        st.stats[reason]++;
        return { sent: false, path: null, waitedMs, reason };
    }

    // One paced hit, with bc_attack on: Better Combat's packet while its path is active (nothing
    // for a target out of its reach or sight), else the vanilla fallback. null: not ready, wait.
    function fire(target, swing, waitedMs) {
        const ticks = cooldownTicks();
        const bc = active();
        if (bc) {
            const eye = eyeOf(bot);
            if (!eye || !target?.position || reachDistance(eye, target) > bcReach(st.itemKey)) return unsent('reach', waitedMs);
            if (!lineOfSight(bot, eye, target)) return unsent('sight', waitedMs);
        }
        const t = now();
        if (t < readyAt(ticks)) return null; // the cooldown, or the held item changed while waiting: wait again
        if (!bc) {
            st.lastSwingAt = t;
            return vanilla(target, swing, waitedMs);
        }
        if (swing) bot._client.write('arm_animation', { hand: 0 });
        bot._client.write('custom_payload', { channel: BC_CHANNEL, data: encodeMainhandAttack(target.id) });
        st.lastSwingAt = t;
        st.stats.bettercombat++;
        watch(target.id, target);
        return { sent: true, path: 'bettercombat', waitedMs };
    }

    // The target of a waiting call died, despawned or left the bot's view while it waited.
    function gone(target) {
        if (target?.isValid === false) return true;
        const id = target?.id;
        return id !== undefined && id !== null && !!bot.entities && !bot.entities[id];
    }

    function schedule() {
        const p = st.pending;
        const delay = Math.max(0, readyAt(cooldownTicks()) - now());
        p.timer = setTimer(() => {
            if (st.pending !== p) return;
            if (gone(p.target)) {
                st.pending = null;
                st.stats.gone++;
                p.resolve({ sent: false, path: null, waitedMs: now() - p.since, reason: 'gone' });
                return;
            }
            const r = withCaller(p.caller, () => fire(p.target, p.swing, now() - p.since));
            if (r === null) { schedule(); return; }
            st.pending = null;
            p.resolve(r);
        }, delay);
    }

    // fn() with st.firing = caller, so a packet it writes is attributed to that caller.
    function withCaller(caller, fn) {
        st.firing = caller;
        try { return fn(); } finally { st.firing = null; }
    }

    function attack(target, swing = true) {
        const caller = callerOf(new Error().stack);
        if (!st.enabled) return Promise.resolve(withCaller(caller, () => vanilla(target, swing)));
        if (st.pending) {
            const old = st.pending;
            clearTimer(old.timer);
            st.pending = null;
            st.stats.replaced++;
            st.replacements.push({
                replaced: { caller: old.caller, target: targetName(bot, old.target?.id) },
                by: { caller, target: targetName(bot, target?.id) },
            });
            if (st.replacements.length > MAX_REPLACEMENTS) st.replacements.shift();
            old.resolve({ sent: false, path: null, waitedMs: now() - old.since, reason: 'replaced' });
        }
        const r = withCaller(caller, () => fire(target, swing, 0));
        if (r) return Promise.resolve(r);
        st.stats.waits++;
        return new Promise((resolve) => {
            st.pending = { target, swing, resolve, since: now(), timer: null, caller };
            schedule();
        });
    }

    function cancel(reason = 'cancelled') {
        const p = st.pending;
        if (!p) return false;
        clearTimer(p.timer);
        st.pending = null;
        st.stats.cancelled++;
        p.resolve({ sent: false, path: null, waitedMs: now() - p.since, reason });
        return true;
    }

    function install() {
        if (typeof bot.attack !== 'function' || bot.attack === attack) return;
        st.vanillaAttack = bot.attack;
        bot.attackVanilla = st.vanillaAttack;
        bot.attack = attack;
    }
    if (typeof bot.attack === 'function') install();
    // mineflayer injects its plugins (bot.attack) on the first 'inject_allowed'; this listener runs after it.
    else bot.once?.('inject_allowed', install);

    bot.once?.('end', () => {
        if (st.pending) { clearTimer(st.pending.timer); st.pending.resolve({ sent: false, path: null, waitedMs: 0, reason: 'ended' }); st.pending = null; }
        for (const list of checks.values()) for (const c of list) { c.done = true; clearTimer(c.timer); }
        checks.clear();
    });

    return {
        get active() { return active(); },
        get enabled() { return st.enabled; },
        get tripped() { return st.tripped; },
        get stats() { return { ...st.stats }; },
        /** The bot.attack caller whose packet is being written now (callerOf), or null. */
        get firingCaller() { return st.firing; },
        /** The replacements since the last call ({ replaced, by }: { caller, target: "name#id" }), oldest first. */
        takeReplacements() { const r = st.replacements; st.replacements = []; return r; },
        serverHasIt,
        /** The ticks the held item is paced at (Better Combat's, or UNKNOWN_SPEED_TICKS), for skills' pacing. */
        cooldownTicks,
        /** Ends a call waiting for its cooldown without sending; true if one was waiting. */
        cancel,
        /** One line for the login log. */
        status() {
            if (!st.enabled) return 'bettercombat attack: off (bc_attack), vanilla attack';
            return serverHasIt() ? 'bettercombat attack: on' : 'bettercombat attack: on, but the server lacks the bettercombat channel: vanilla attack';
        },
    };
}
