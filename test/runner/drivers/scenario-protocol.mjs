// The bot side of test/runner/DRIVER.md, for any mineflayer bot. A driver calls
// attachScenario(bot) after createBot; net-forge's spike can import this and keep its own bot factory.
//
//   on spawn:                  say $ROTN_SCENARIO_HELLO (once)
//   chat "scenario-echo TOKEN": say "echo TOKEN" (once per token)
//   chat "scenario-walk N":     walk at least N blocks horizontally, then say "walked X Y Z"
// G2 (see attachG2 below): scenario-blocks, scenario-blockat, scenario-entities, scenario-items.
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Vec3 } from 'vec3';

/** One JSON line per driver event on stdout, prefixed "DRIVER ". Never pass secrets in here. */
export const event = (type, data = {}) => process.stdout.write(`DRIVER ${JSON.stringify({ t: new Date().toISOString(), type, ...data })}\n`);

export function attachScenario(bot, { hello = process.env.ROTN_SCENARIO_HELLO, helloDelayMs = 2000, walkTimeoutMs = 30000, emit = event } = {}) {
    const echoed = new Set();
    let walking = false;
    // Every async handler catches its own errors: an event handler's rejection would otherwise be
    // unhandled (PR #9 review finding 8).
    const say = (text) => {
        try {
            bot.chat(text);
            return true;
        } catch (err) {
            emit('chat_error', { message: String(err?.message ?? err) });
            return false;
        }
    };
    bot.once('spawn', async () => {
        emit('spawn', { pos: pos(bot) });
        if (hello) {
            await sleep(helloDelayMs);
            if (say(hello)) emit('said', { text: hello });
        }
    });
    bot.on('messagestr', async (msg) => {
        const e = /scenario-echo (\S+)/.exec(msg);
        if (e && !echoed.has(e[1])) {
            echoed.add(e[1]);
            emit('heard', { text: msg });
            say(`echo ${e[1]}`);
        }
        const w = /scenario-walk (\d+)/.exec(msg);
        if (w && !walking) {
            walking = true;
            try {
                if (pos(bot) === null) throw new Error('no position yet (not spawned)');
                const r = await walk(bot, Number(w[1]), walkTimeoutMs);
                emit('walked', r);
                say(`walked ${r.to.map((v) => v.toFixed(1)).join(' ')}`);
            } catch (err) {
                emit('walk_error', { message: String(err?.message ?? err) });
            } finally {
                walking = false;
            }
        }
    });
}

const pos = (bot) => (bot.entity ? [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z] : null);

/**
 * Walk forward at least n blocks (horizontal), turning 90 degrees and jumping when stuck.
 * No pathfinder: G1 proves movement packets are accepted, not navigation.
 */
export async function walk(bot, n, timeoutMs, stepMs = 250) {
    const from = pos(bot);
    const dist = () => Math.hypot(bot.entity.position.x - from[0], bot.entity.position.z - from[2]);
    const end = Date.now() + timeoutMs;
    let last = dist();
    let still = 0;
    try {
        bot.setControlState('sprint', false);
        bot.setControlState('forward', true);
        while (dist() < n && Date.now() < end) {
            await sleep(stepMs);
            const d = dist();
            if (d - last < 0.05) {
                still += stepMs;
                bot.setControlState('jump', true);
                if (still >= 1500) {
                    await bot.look(bot.entity.yaw + Math.PI / 2, 0, true);
                    still = 0;
                }
            } else {
                bot.setControlState('jump', false);
                still = 0;
            }
            last = d;
        }
    } finally {
        bot.clearControlStates();
    }
    return { from, to: pos(bot), distance: dist() };
}

// ---------------------------------------------------------------------------------------------
// G2: the bot names what it sees; the runner has the server check every name (DRIVER.md, G2).
//
//   "scenario-blocks TOKEN R N"          -> the N most common block types in the cube of radius R
//                                           around the bot: "name meta count x y z" (one sample each)
//   "scenario-blockat TOKEN x,y,z ..."    -> "x y z name meta" for each position
//   "scenario-entities TOKEN R"           -> "name x y z" for each non-player entity within R
//   "scenario-items TOKEN"                -> "slot oldName oldMeta newName backName backMeta" per slot
// Replies are paged chat lines "KIND TOKEN PAGE/PAGES entry; entry; ...", at most one every
// pageDelayMs: vanilla kicks a non-op player who chats about ten times in quick succession.
//
// `names` is the naming adapter. The default reads stock mineflayer data and has no 1.13+ translation;
// a RotN driver passes rotn-data's (packages/rotn-data/index.js):
//   { blockName: (b) => ({ name: registryName(b), meta: b.metadata }), entityName: (e) => registryName(e),
//     itemName: (i) => ({ name: registryName(i), meta: i.metadata }), toNew, toOld }
// A name the adapter cannot give is reported as "null" (the runner fails it); the driver never guesses.

const ns = (n) => (typeof n === 'string' && n ? (n.includes(':') ? n : `minecraft:${n}`) : null);
export const stockNames = {
    blockName: (b) => (b ? { name: ns(b.name), meta: b.metadata ?? 0 } : null),
    entityName: (e) => ns(e?.name),
    itemName: (i) => ({ name: ns(i?.name), meta: i?.metadata ?? 0 }),
    toNew: null,
    toOld: null,
};

const PAGE_CHARS = 200;

/** Split entries into "KIND TOKEN i/n ..." lines of at most about PAGE_CHARS. Always at least one page. */
export function pages(kind, token, entries) {
    const chunks = [];
    let cur = [];
    let len = 0;
    for (const e of entries) {
        if (cur.length && len + e.length + 2 > PAGE_CHARS) { chunks.push(cur); cur = []; len = 0; }
        cur.push(e);
        len += e.length + 2;
    }
    if (cur.length || !chunks.length) chunks.push(cur);
    return chunks.map((c, i) => `${kind} ${token} ${i + 1}/${chunks.length}${c.length ? ` ${c.join('; ')}` : ''}`);
}

export function attachG2(bot, { names = stockNames, pageDelayMs = 1200, emit = event } = {}) {
    let queue = Promise.resolve();
    // One request at a time, so two replies never interleave and the chat rate stays under the spam limit.
    const serial = (fn) => { queue = queue.then(fn).catch((err) => emit('g2_error', { message: String(err?.message ?? err) })); return queue; };
    const sayPages = async (lines) => {
        for (const [i, line] of lines.entries()) {
            if (i && pageDelayMs) await sleep(pageDelayMs);
            bot.chat(line);
        }
        if (pageDelayMs) await sleep(pageDelayMs);
    };
    const show = (n) => (typeof n === 'string' && n ? n : 'null');
    const here = () => {
        if (!bot.entity) throw new Error('no position yet (not spawned)');
        return bot.entity.position.floored();
    };

    bot.on('messagestr', (msg) => {
        let m;
        if ((m = /scenario-blocks ([0-9a-f]{6,32}) (\d{1,2}) (\d{1,3})\b/.exec(msg))) {
            const [token, r, n] = [m[1], Number(m[2]), Number(m[3])];
            serial(async () => {
                const c = here();
                const hist = new Map();
                for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
                    const p = c.offset(dx, dy, dz);
                    const nm = names.blockName(bot.blockAt(p));
                    const key = `${show(nm?.name)} ${nm?.meta ?? 0}`;
                    const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
                    const h = hist.get(key);
                    if (!h) hist.set(key, { count: 1, d, p });
                    else { h.count++; if (d < h.d) { h.d = d; h.p = p; } }
                }
                const top = [...hist.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, n);
                emit('g2_blocks', { types: hist.size, reported: top.length });
                await sayPages(pages('blocks', token, top.map(([k, h]) => `${k} ${h.count} ${h.p.x} ${h.p.y} ${h.p.z}`)));
            });
        } else if ((m = /scenario-blockat ([0-9a-f]{6,32}) ((?:-?\d+,-?\d+,-?\d+ ?){1,16})/.exec(msg))) {
            const [token, list] = [m[1], m[2].trim().split(/\s+/).map((s) => s.split(',').map(Number))];
            serial(async () => {
                const out = list.map(([x, y, z]) => {
                    const nm = names.blockName(bot.blockAt(new Vec3(x, y, z)));
                    return `${x} ${y} ${z} ${show(nm?.name)} ${nm?.meta ?? 0}`;
                });
                await sayPages(pages('blockat', token, out));
            });
        } else if ((m = /scenario-entities ([0-9a-f]{6,32}) (\d{1,3})\b/.exec(msg))) {
            const [token, r] = [m[1], Number(m[2])];
            serial(async () => {
                const me = bot.entity;
                if (!me) throw new Error('no position yet (not spawned)');
                const out = Object.values(bot.entities)
                    .filter((e) => e !== me && e.type !== 'player' && e.position && e.position.distanceTo(me.position) <= r)
                    .map((e) => `${show(names.entityName(e))} ${e.position.x.toFixed(1)} ${e.position.y.toFixed(1)} ${e.position.z.toFixed(1)}`);
                emit('g2_entities', { reported: out.length });
                await sayPages(pages('entities', token, out));
            });
        } else if ((m = /scenario-items ([0-9a-f]{6,32})\b/.exec(msg))) {
            const token = m[1];
            serial(async () => {
                const out = bot.inventory.items().map((it) => {
                    const old = names.itemName(it);
                    let next = null;
                    let back = null;
                    try { next = names.toNew ? names.toNew(old.name, old.meta) : null; } catch { next = null; }
                    try { back = next && names.toOld ? names.toOld(next) : null; } catch { back = null; }
                    return `${it.slot} ${show(old.name)} ${old.meta} ${show(next)} ${show(back?.name)} ${back?.meta ?? -1}`;
                });
                await sayPages(pages('items', token, out));
            });
        }
    });
}
