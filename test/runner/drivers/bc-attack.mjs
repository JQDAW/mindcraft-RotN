// Probe BC's driver side (the lead's Better Combat plan, steps 3 and 4; test/runner/lib/probe.mjs has the
// plan and the scenario's judgments). bc-attack-driver.mjs attaches it to Mindcraft's real initBot, whose
// bot.attack is net-forge's Better Combat wrapper (#521) and whose bot.attackVanilla is mineflayer's own.
//
// It answers one console whisper (`tell <bot> bc-hit TOKEN PATH TARGET ITEM`), and only from the console
// ("Server"), read from the raw 1.12 component as net-forge's probe commands read theirs:
//   PATH    vanilla: bot.attackVanilla, paced at Better Combat's cooldown for the held item
//           (bot.forge.attackCooldownTicks(), from the last hit or the last item change);
//           bc: bot.attack (the wrapper paces itself), each call awaited.
//   TARGET  x,y,z: the zombie standing in that block (a NoAI one), or ai: the nearest zombie within 16
//           blocks; with ai the bot only swings while the zombie is within 3 blocks (inside Better
//           Combat's 4-block weapon reach, so the wrapper has no reason to fall back to vanilla).
//   ITEM    a registry name the bot holds (it takes the next one when one breaks), or hand (an empty slot).
// Each series runs until the zombie dies, maxHits hits or maxMs, then waits settleMs for the server's
// last updates, and answers with ONE line: DRIVER {"type":"bc_hit","v":1,"token":...} (bcReplyFields).
//
// Recorded from the raw packets, not from mineflayer's view:
//   - per hit: its time, the path the call took (the wrapper's answer), whether it was sent, the wait,
//     the cooldown, the zombie's health before it and after it (entity_metadata index 7, EntityLivingBase
//     HEALTH, attributed to the hit until the next one), and whether entity_status 2 (hurt) came;
//   - every attack packet the client wrote: arm_animation, custom_payload on bettercombat, use_entity
//     ATTACK, and the gaps between consecutive ones of each path (gaps.bettercombat, gaps.vanilla);
//   - the zombie burning (entity_metadata index 0, bit 0x01): fire would mix with the hits;
//   - afterDeath on a hit sent after the zombie's death status (it cannot land; the judgments leave it out).
import { setTimeout as sleepMs } from 'node:timers/promises';

export const BC_REPLY_VERSION = 1;
export const BC_SENDER = 'Server';
// leadMs: on Better Combat's path the driver waits until this long before the cooldown is over and checks
// that the zombie still lives, then calls bot.attack, which waits the rest itself: the wrapper's own pacing
// still decides when the packet goes out, but no swing is sent at a zombie that died meanwhile.
export const BC_LIMITS = Object.freeze({ maxHits: 40, maxMs: 60000, settleMs: 1500, aiRange: 3, aiSearch: 16, targetSlack: 1.5, leadMs: 150 });
const HEALTH = 7;            // EntityLivingBase.HEALTH (1.12): a float
const FLAGS = 0;             // Entity.FLAGS: a byte, 0x01 on fire
const STATUS_HURT = 2;
const STATUS_DEAD = 3;
const TICK_MS = 50;

const TOKEN = '([0-9a-f]{6,32})';
const COMMAND = new RegExp(`^bc-hit ${TOKEN} (vanilla|bc) (?:(-?\\d{1,8}),(-?\\d{1,3}),(-?\\d{1,8})|(ai)) ([a-z0-9_.-]+:[a-z0-9_./-]+|hand)\\s*$`);
const ANY = new RegExp(`^bc-hit ${TOKEN}(?!\\S)`);

/** The whole whisper as a command, or null. */
export function parseBcHit(msg) {
    const m = COMMAND.exec(msg);
    if (!m) return null;
    return { token: m[1], path: m[2], target: m[6] ? 'ai' : [Number(m[3]), Number(m[4]), Number(m[5])], item: m[7] };
}

/** The 1.12 console whisper component -> {from, msg}, or null for anything else. */
export function whisperOf(jsonMsg) {
    if (jsonMsg?.translate !== 'commands.message.display.incoming' || !Array.isArray(jsonMsg.with) || jsonMsg.with.length !== 2) return null;
    const part = (x) => String(x?.toString?.() ?? x ?? '');
    return { from: part(jsonMsg.with[0]), msg: part(jsonMsg.with[1]) };
}

const isZombie = (e) => /zombie/i.test(String(e?.name ?? '')) && !/zombie_?pigman|pig_?zombie/i.test(String(e?.name ?? ''));
const sameItem = (it, want) => !!it && (it.name === want || `minecraft:${it.name}` === want);

/** Gaps (ms) between consecutive packets of one kind. */
export const gapsOf = (times) => times.slice(1).map((t, i) => t - times[i]);

/**
 * Attribute the timeline to the hits. events: [{t, kind: 'health'|'hurt'|'dead'|'fire', value}], sorted.
 * Each hit gets the events from its own time to the next hit's (the last one to the end).
 */
export function attribute(hits, events, startHealth, endAt) {
    const healthAt = (t) => {
        let h = startHealth;
        for (const e of events) {
            if (e.t >= t) break;
            if (e.kind === 'health') h = e.value;
            if (e.kind === 'dead') h = 0;
        }
        return h;
    };
    const deathAt = events.find((e) => e.kind === 'dead')?.t ?? null;
    return hits.map((h, k) => {
        const until = k + 1 < hits.length ? hits[k + 1].t : endAt;
        const mine = events.filter((e) => e.t >= h.t && e.t < until);
        const before = healthAt(h.t);
        let after = before;
        for (const e of mine) {
            if (e.kind === 'health') after = e.value;
            if (e.kind === 'dead') after = 0;
        }
        const drop = typeof before === 'number' && typeof after === 'number' ? Math.round((before - after) * 1000) / 1000 : null;
        return { ...h, healthBefore: before, healthAfter: after, drop, hurt: mine.some((e) => e.kind === 'hurt'), died: mine.some((e) => e.kind === 'dead'), afterDeath: deathAt !== null && h.t > deathAt };
    });
}

/**
 * Attach the bc-hit command to a bot (mineflayer with initBot's forge state).
 * opts: emit(type, data), now, sleep(ms), limits (BC_LIMITS).
 */
export function attachBcAttack(bot, { emit, now = Date.now, sleep = (ms) => sleepMs(ms), limits = {} } = {}) {
    const L = { ...BC_LIMITS, ...limits };
    const used = new Set();
    let busy = false;
    let series = null;   // the running series' recorder

    // Every attack packet the client writes (the wrapper and mineflayer both write through _client.write).
    const packets = [];
    const client = bot._client;
    const write = client.write.bind(client);
    client.write = (name, params) => {
        if (name === 'arm_animation') packets.push({ t: now(), name });
        else if (name === 'custom_payload' && params?.channel === 'bettercombat') packets.push({ t: now(), name: 'bettercombat' });
        else if (name === 'use_entity' && (params?.mouse === 1 || params?.mouse === 'attack')) packets.push({ t: now(), name: 'use_entity', target: params.target });
        return write(name, params);
    };
    // The zombie's own updates, from the raw packets.
    const record = (id, kind, value) => {
        if (series && series.id === id) series.events.push({ t: now(), kind, value });
    };
    client.on('entity_metadata', (p) => {
        for (const m of p?.metadata ?? []) {
            if (m.key === HEALTH && typeof m.value === 'number') record(p.entityId, 'health', m.value);
            if (m.key === FLAGS && typeof m.value === 'number' && (m.value & 0x01)) record(p.entityId, 'fire', true);
        }
    });
    client.on('entity_status', (p) => {
        if (p?.entityStatus === STATUS_HURT) record(p.entityId, 'hurt', true);
        if (p?.entityStatus === STATUS_DEAD) record(p.entityId, 'dead', true);
    });
    client.on('entity_destroy', (p) => { for (const id of p?.entityIds ?? []) record(id, 'gone', true); });

    const reply = (data) => emit('bc_hit', { v: BC_REPLY_VERSION, ...data });

    function findTarget(target) {
        const all = Object.values(bot.entities ?? {}).filter((e) => e !== bot.entity && isZombie(e) && e.position);
        if (target === 'ai') {
            const me = bot.entity.position;
            return all.filter((e) => e.position.distanceTo(me) <= L.aiSearch).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0] ?? null;
        }
        const [x, y, z] = target;
        const dist = (e) => Math.hypot(e.position.x - (x + 0.5), e.position.y - y, e.position.z - (z + 0.5));
        return all.filter((e) => dist(e) <= L.targetSlack).sort((a, b) => dist(a) - dist(b))[0] ?? null;
    }

    async function hold(item) {
        if (item === 'hand') {
            for (let i = 0; i < 9; i++) {
                if (!bot.inventory.slots[bot.inventory.hotbarStart + i]) { bot.setQuickBarSlot(i); return true; }
            }
            return false;
        }
        if (sameItem(bot.heldItem, item)) return true;
        const it = bot.inventory.items().find((x) => sameItem(x, item));
        if (!it) return false;
        await bot.equip(it, 'hand');
        return sameItem(bot.heldItem, item);
    }

    async function run(cmd) {
        const t0 = now();
        const fail = (error, extra = {}) => reply({ token: cmd.token, ok: false, path: cmd.path, item: cmd.item, error, ms: now() - t0, ...extra });
        const bc = bot.forge?.bcAttack;
        if (typeof bot.attackVanilla !== 'function' || !bc) return fail('no Better Combat wrapper on this bot (net-forge #521: bot.attackVanilla, bot.forge.bcAttack)');
        if (cmd.path === 'bc' && !bc.active) return fail(`Better Combat's path is not active: ${bc.status?.() ?? 'no status'}`);
        if (!(await hold(cmd.item))) return fail(cmd.item === 'hand' ? 'no empty hotbar slot' : `the bot holds no ${cmd.item}`);
        let equipAt = now();
        const target = findTarget(cmd.target);
        if (!target) return fail(`no zombie ${cmd.target === 'ai' ? `within ${L.aiSearch} blocks` : `at ${cmd.target.join(',')}`}`);
        const startHealth = typeof target.metadata?.[HEALTH] === 'number' ? target.metadata[HEALTH] : null;
        series = { id: target.id, events: [] };
        const fromPacket = packets.length;
        const statsBefore = bc.stats;
        const hits = [];
        const reequips = [];
        let end = null;
        const dead = () => series.events.some((e) => e.kind === 'dead' || e.kind === 'gone')
            || series.events.filter((e) => e.kind === 'health').at(-1)?.value <= 0;
        const left = () => L.maxMs - (now() - t0);
        try {
            while (!end) {
                if (dead()) { end = 'dead'; break; }
                if (hits.length >= L.maxHits) { end = 'maxHits'; break; }
                if (left() <= 0) { end = 'maxMs'; break; }
                if (!bot.entities?.[target.id]) { end = 'lost'; break; }
                if (cmd.item !== 'hand' && !sameItem(bot.heldItem, cmd.item)) {
                    if (!(await hold(cmd.item))) { end = 'item_gone'; break; }
                    equipAt = now();
                    reequips.push({ afterHit: hits.length, t: equipAt });
                }
                if (cmd.target === 'ai' && target.position.distanceTo(bot.entity.position) > L.aiRange) {
                    await sleep(TICK_MS);
                    continue;
                }
                const ticks = bot.forge?.attackCooldownTicks?.() ?? null;
                try { await bot.lookAt(target.position.offset(0, (target.height ?? 1.95) * 0.85, 0), true); } catch { /* look is best effort */ }
                let r;
                if (cmd.path === 'vanilla') {
                    if (ticks === null) { end = 'cooldown_unknown'; break; }
                    const last = hits.length ? hits.at(-1).t : -Infinity;
                    const wait = Math.max(last, equipAt) + ticks * TICK_MS - now();
                    if (wait > 0) await sleep(wait);
                    if (dead()) { end = 'dead'; break; }
                    bot.attackVanilla(target, true);
                    r = { sent: true, path: 'vanilla', waitedMs: Math.max(0, Math.round(wait)) };
                } else {
                    if (ticks !== null) {
                        const last = hits.length ? hits.at(-1).t : -Infinity;
                        const pre = Math.max(last, equipAt) + ticks * TICK_MS - L.leadMs - now();
                        if (pre > 0) await sleep(pre);
                        if (dead()) { end = 'dead'; break; }
                    }
                    r = await bot.attack(target, true);
                }
                hits.push({ i: hits.length + 1, t: now(), path: r?.path ?? null, sent: r?.sent !== false, waitedMs: r?.waitedMs ?? null, reason: r?.reason ?? null, cooldownTicks: ticks });
            }
        } catch (e) {
            end = `error: ${String(e?.message ?? e).slice(0, 300)}`;
        }
        await sleep(L.settleMs);
        const endAt = now();
        const events = series.events.slice();
        series = null;
        const mine = packets.slice(fromPacket).filter((p) => p.name !== 'use_entity' || p.target === target.id);
        const stamped = attribute(hits, events, startHealth, endAt).map((h) => ({ ...h, t: h.t - t0 }));
        reply({
            token: cmd.token, ok: !String(end).startsWith('error') && end !== 'cooldown_unknown', path: cmd.path, item: cmd.item,
            target: { id: target.id, name: target.name ?? null, startHealth }, end,
            hits: stamped, hitCount: hits.length,
            healthEnd: stamped.at(-1)?.healthAfter ?? startHealth,
            gaps: { bettercombat: gapsOf(mine.filter((p) => p.name === 'bettercombat').map((p) => p.t)), vanilla: gapsOf(mine.filter((p) => p.name === 'use_entity').map((p) => p.t)) },
            packets: { arm_animation: mine.filter((p) => p.name === 'arm_animation').length, bettercombat: mine.filter((p) => p.name === 'bettercombat').length, use_entity: mine.filter((p) => p.name === 'use_entity').length },
            burned: events.some((e) => e.kind === 'fire'), reequips: reequips.map((x) => ({ ...x, t: x.t - t0 })),
            tripped: !!bc.tripped, active: !!bc.active, statsBefore, statsAfter: bc.stats,
            botHealth: bot.health ?? null, ms: endAt - t0,
            ...(String(end).startsWith('error') ? { error: end } : end === 'cooldown_unknown' ? { error: 'the held item\'s Better Combat cooldown is unknown' } : {}),
        });
    }

    bot.on('message', (jsonMsg) => {
        const w = whisperOf(jsonMsg);
        if (!w || !ANY.test(w.msg)) return;
        if (w.from !== BC_SENDER) { emit('bc_ignored', { from: w.from.slice(0, 32), reason: `not a console whisper (only ${BC_SENDER} is accepted)` }); return; }
        const cmd = parseBcHit(w.msg);
        const token = ANY.exec(w.msg)[1];
        if (!cmd) { reply({ token, ok: false, error: 'malformed bc-hit command' }); return; }
        if (used.has(cmd.token)) { emit('bc_ignored', { token: cmd.token, reason: 'token already used' }); return; }
        used.add(cmd.token);
        if (busy) { reply({ token: cmd.token, ok: false, path: cmd.path, item: cmd.item, error: 'another bc-hit is running' }); return; }
        busy = true;
        emit('bc_heard', { token: cmd.token, path: cmd.path, target: cmd.target, item: cmd.item });
        run(cmd).catch((e) => reply({ token: cmd.token, ok: false, error: `bc-hit failed: ${String(e?.message ?? e).slice(0, 300)}` }))
            .finally(() => { busy = false; });
    });
    return { packets };
}
