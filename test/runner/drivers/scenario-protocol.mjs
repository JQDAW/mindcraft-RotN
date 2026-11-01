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
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
//   "scenario-blocks TOKEN R N K"        -> the N most common non-air block types in the cube of radius R
//                                           around the bot: "name meta count x,y,z x,y,z ..." with up to K
//                                           candidate positions per type, drawn uniformly from its blocks
//                                           (the first entry is "#unloaded U T": U of the T positions had no
//                                           loaded chunk after waiting for the cube; they are never named)
//   "scenario-blockat TOKEN x,y,z ..."    -> "x y z name meta" for each position ("x y z #unloaded 0" if no chunk)
//   "scenario-entities TOKEN R"           -> "name x y z" for each non-player entity within R
//   "scenario-items TOKEN"                -> "slot oldName oldMeta newName backName backMeta" per slot
// Replies are paged chat lines "KIND TOKEN PAGE/PAGES entry; entry; ...", at most one every
// pageDelayMs: vanilla kicks a non-op player who chats about ten times in quick succession.
//
// `names` is the naming adapter. For G2 evidence it MUST be the agent's own naming path (PR #36
// review finding 3): agentNames(mc) below takes block, entity and item names exactly as the agent reads
// them (src/agent/library/world.js uses block.name, entity.name and inventory slot.name, all from
// bot.registry as forge-bridge extends it) and the 1.12 <-> 1.13+ translation only from
// src/utils/mcdata.js (its toNew/toOld exports; rotn-data's brief item 4 wires them). It imports no
// naming code of its own. The one change it makes is the "minecraft:" namespace that vanilla names lack
// in mineflayer, which the server's testforblock/testfor need. Until mcdata.js exports toNew/toOld the
// translation is null, and the runner marks the run "not a gate run": agentNaming in lib/g2.mjs imports
// mcdata.js in a child process and runs the full table through its toNew/toOld.
// stockNames is the same without translation, only for trying the protocol.
// A name the adapter cannot give is reported as "null" (the runner fails it); the driver never guesses.

const ns = (n) => (typeof n === 'string' && n ? (n.includes(':') ? n : `minecraft:${n}`) : null);
export const stockNames = {
    blockName: (b) => (b ? { name: ns(b.name), meta: b.metadata ?? 0 } : null),
    entityName: (e) => ns(e?.name),
    itemName: (i) => ({ name: ns(i?.name), meta: i?.metadata ?? 0 }),
    toNew: null,
    toOld: null,
};

/**
 * The agent's naming path, from the src/utils/mcdata.js module object `mc`:
 * names as world.js reads them, translation from mc.toNew / mc.toOld when mcdata.js exports them.
 * Returns {names, source, translation: bool}.
 */
export function agentNames(mc) {
    const toNew = typeof mc?.toNew === 'function' ? mc.toNew : null;
    const toOld = typeof mc?.toOld === 'function' ? mc.toOld : null;
    return {
        source: `src/utils/mcdata.js (names via bot.registry as world.js reads them; translation: ${toNew && toOld ? 'mcdata toNew/toOld' : 'none exported yet'})`,
        translation: Boolean(toNew && toOld),
        names: { ...stockNames, toNew, toOld },
    };
}

/** Import the agent's src/utils/mcdata.js from repoRoot and build agentNames from it. null if it cannot be imported. */
export async function loadAgentNames(repoRoot) {
    try {
        return agentNames(await import(pathToFileURL(path.join(repoRoot, 'src', 'utils', 'mcdata.js')).href));
    } catch {
        return null;
    }
}

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

/** A position the bot has no chunk for: counted apart, never named (a "null" name would fail the runner). */
export const UNLOADED = '#unloaded';

export function attachG2(bot, { names = stockNames, pageDelayMs = 1200, emit = event, random = Math.random, chunkWaitMs = 30000, chunkPollMs = 500 } = {}) {
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
    // Chunk columns of the cube without a loaded chunk: blockAt answers null anywhere in such a column.
    const columns = (c, r) => {
        let missing = 0;
        let total = 0;
        for (let cx = (c.x - r) >> 4; cx <= (c.x + r) >> 4; cx++) {
            for (let cz = (c.z - r) >> 4; cz <= (c.z + r) >> 4; cz++) {
                total++;
                if (!bot.blockAt(new Vec3(cx * 16 + 8, Math.min(255, Math.max(0, c.y)), cz * 16 + 8))) missing++;
            }
        }
        return { missing, total };
    };
    // Wait (at most chunkWaitMs) for every chunk column of the cube: mineflayer's waitForChunksToLoad
    // first, then poll the columns. Whatever is still missing is counted as unloaded, never as a block.
    const waitForCube = async (c, r) => {
        const end = Date.now() + chunkWaitMs;
        if (typeof bot.waitForChunksToLoad === 'function' && chunkWaitMs > 0) {
            try {
                await Promise.race([bot.waitForChunksToLoad(), sleep(chunkWaitMs)]);
            } catch { /* counted below */ }
        }
        let st = columns(c, r);
        while (st.missing && Date.now() < end) {
            await sleep(chunkPollMs);
            st = columns(c, r);
        }
        emit('g2_chunks', st);
        return st;
    };

    bot.on('messagestr', (msg) => {
        let m;
        if ((m = /scenario-blocks ([0-9a-f]{6,32}) (\d{1,2}) (\d{1,3}) (\d{1,2})\b/.exec(msg))) {
            const [token, r, n, k] = [m[1], Number(m[2]), Number(m[3]), Number(m[4])];
            serial(async () => {
                const c = here();
                await waitForCube(c, r);
                // Census without air; per type, k candidate positions drawn uniformly (reservoir sampling)
                // from all of its blocks, so the runner's pick among them is a fair sample of the type.
                // Positions without a loaded chunk are counted apart and reported as "#unloaded U T".
                const hist = new Map();
                let unloaded = 0;
                let total = 0;
                for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
                    const p = c.offset(dx, dy, dz);
                    total++;
                    const blk = bot.blockAt(p);
                    if (!blk) { unloaded++; continue; }
                    const nm = names.blockName(blk);
                    if (nm?.name === 'minecraft:air') continue;
                    const key = `${show(nm?.name)} ${nm?.meta ?? 0}`;
                    const h = hist.get(key) ?? { count: 0, picks: [] };
                    h.count++;
                    if (h.picks.length < k) h.picks.push(p);
                    else { const j = Math.floor(random() * h.count); if (j < k) h.picks[j] = p; }
                    hist.set(key, h);
                }
                const top = [...hist.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, n);
                emit('g2_blocks', { types: hist.size, reported: top.length, unloaded, total });
                await sayPages(pages('blocks', token, [`${UNLOADED} ${unloaded} ${total}`,
                    ...top.map(([key, h]) => `${key} ${h.count} ${h.picks.map((p) => `${p.x},${p.y},${p.z}`).join(' ')}`)]));
            });
        } else if ((m = /scenario-blockat ([0-9a-f]{6,32}) ((?:-?\d+,-?\d+,-?\d+ ?){1,16})/.exec(msg))) {
            const [token, list] = [m[1], m[2].trim().split(/\s+/).map((s) => s.split(',').map(Number))];
            serial(async () => {
                const out = list.map(([x, y, z]) => {
                    const blk = bot.blockAt(new Vec3(x, y, z));
                    if (!blk) return `${x} ${y} ${z} ${UNLOADED} 0`;
                    const nm = names.blockName(blk);
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
