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
import { Reader, Writer, WireError } from './wire.js';

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
const WEAPON_NAME = /(?:^|[_:])(?:sword|axe|pickaxe|shovel|spade|hoe)$/;

export function isBcWeaponName(name) {
    return typeof name === 'string' && WEAPON_NAME.test(name);
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

/**
 * Replaces bot.attack with Better Combat's attack when it is on and the server has the
 * channel; keeps the original as bot.attackVanilla.
 *
 * bot.attack(target, swing = true) returns a promise of
 * { sent, path: 'bettercombat'|'vanilla'|null, waitedMs, reason? }. Callers may ignore it.
 * - Better Combat path: wait out the cooldown, then send arm_animation (main hand), then
 *   PacketMainhandAttack(target.id). It never sends use_entity as well. A newer call
 *   replaces a waiting one; the replaced call resolves { sent: false, reason: 'replaced' }.
 * - Vanilla path: any of these sends the vanilla attack instead:
 *   - the setting is off;
 *   - the server lacks the mod or the channel;
 *   - the self-check has tripped;
 *   - the target is out of Better Combat's reach or out of sight;
 *   - the held weapon's attack speed is unknown.
 * - Self-check: each Better Combat hit should give an entityHurt or entityDead for the
 *   target within checkMs. After maxMisses hits in a row without one, the bot is back on
 *   vanilla for this connection.
 *
 * @param {object} bot mineflayer bot
 * @param {object} opts
 * @param {() => object|null} opts.bridge the forge bridge (serverMods, serverChannels), or null
 * @param {boolean} opts.enabled
 */
export function installBetterCombatAttack(bot, {
    bridge, enabled, log = (m) => console.log(`[forge-bridge] ${m}`),
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
    lineOfSight = defaultLineOfSight, checkMs = 500, maxMisses = 5,
} = {}) {
    const st = {
        enabled: !!enabled, tripped: false, misses: 0,
        lastSwingAt: -Infinity, itemKey: undefined, itemChangedAt: -Infinity,
        pending: null,
        stats: { bettercombat: 0, vanilla: 0, waits: 0, replaced: 0, misses: 0 },
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

    function cooldownTicks() {
        noteItem();
        return bcCooldownTicks({ itemName: st.itemKey, attackSpeed: botAttackSpeed(bot) });
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
    function onHurt(entity) {
        const list = entity && checks.get(entity.id);
        if (!list) return;
        checks.delete(entity.id);
        for (const c of list) settle(c, true);
    }
    bot.on?.('entityHurt', onHurt);
    bot.on?.('entityDead', onHurt);

    function watch(id) {
        const c = { done: false, timer: null };
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

    // Better Combat path, or vanilla if this target or item does not qualify (checked when the swing goes out).
    function fire(target, swing, waitedMs) {
        const eye = eyeOf(bot);
        const ticks = cooldownTicks();
        if (!eye || !target?.position || ticks === null) return vanilla(target, swing, waitedMs);
        if (reachDistance(eye, target) > bcReach(st.itemKey) || !lineOfSight(bot, eye, target)) return vanilla(target, swing, waitedMs);
        const t = now();
        if (t < readyAt(ticks)) return null; // the held item changed while waiting: wait again
        if (swing) bot._client.write('arm_animation', { hand: 0 });
        bot._client.write('custom_payload', { channel: BC_CHANNEL, data: encodeMainhandAttack(target.id) });
        st.lastSwingAt = t;
        st.stats.bettercombat++;
        watch(target.id);
        return { sent: true, path: 'bettercombat', waitedMs };
    }

    function schedule() {
        const p = st.pending;
        const ticks = cooldownTicks();
        const delay = ticks === null ? 0 : Math.max(0, readyAt(ticks) - now());
        p.timer = setTimer(() => {
            if (st.pending !== p) return;
            if (!active()) { st.pending = null; p.resolve(vanilla(p.target, p.swing, now() - p.since)); return; }
            const r = fire(p.target, p.swing, now() - p.since);
            if (r === null) { schedule(); return; }
            st.pending = null;
            p.resolve(r);
        }, delay);
    }

    function attack(target, swing = true) {
        if (!active()) return Promise.resolve(vanilla(target, swing));
        if (st.pending) {
            const old = st.pending;
            clearTimer(old.timer);
            st.pending = null;
            st.stats.replaced++;
            old.resolve({ sent: false, path: null, waitedMs: now() - old.since, reason: 'replaced' });
        }
        const r = fire(target, swing, 0);
        if (r) return Promise.resolve(r);
        st.stats.waits++;
        return new Promise((resolve) => {
            st.pending = { target, swing, resolve, since: now(), timer: null };
            schedule();
        });
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
        serverHasIt,
        /** The held item's Better Combat cooldown in ticks (null if unknown), for skills' pacing. */
        cooldownTicks,
        /** One line for the login log. */
        status() {
            if (!st.enabled) return 'bettercombat attack: off (bc_attack), vanilla attack';
            return serverHasIt() ? 'bettercombat attack: on' : 'bettercombat attack: on, but the server lacks the bettercombat channel: vanilla attack';
        },
    };
}
