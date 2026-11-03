// Probe P1 commands for g1-driver (skills-rotn Request 2 live proof; plan in coord/STATUS-net-forge.md).
// Enabled only with ROTN_DRIVER_PROBE=1, so G1/G2 gate runs are unchanged. Not a gate.
//
// The scenario (harness-ops, test/scenarios/probe/) sends one command per chat line; the
// bot runs them one at a time and answers each with
//   - one `DRIVER {"type":"probe",...}` JSON line on stdout (the full result), and
//   - one chat line "probe TOKEN CMD ok|fail k=v ..." (at most 200 characters, for the server log).
// Pass or fail is decided by the scenario from the server's own commands (clear ... 0 counts,
// testforblock), never from these answers.
//
//   probe-craft TOKEN RECIPE_ID [X,Y,Z]   craft once with rotn-data's dump recipe RECIPE_ID
//                                          (e.g. crafttweaker:pyro_crude_axe); X,Y,Z = the crafting
//                                          table to use (RotN's is FastWorkbench), else the 2x2 grid
//   probe-place TOKEN ITEM X,Y,Z FACE     hold ITEM (registry name) and place it against the block
//                                          at X,Y,Z on FACE (up|down|north|south|east|west)
//   probe-eat TOKEN ITEM                  hold ITEM and eat it (bot.consume)
//
// mineflayer-auto-eat (loaded by initBot) is turned off while the probe runs, so no other code
// clicks the inventory or eats (it broke a craft in the offline test; STATUS, PR 2 notes).

import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');

const TOKEN = '([0-9a-f]{6,32})';
const NAME = '([a-z0-9_.-]+:[a-z0-9_./-]+)';
const POS = '(-?\\d{1,8}),(-?\\d{1,3}),(-?\\d{1,8})';
const COMMANDS = {
    // The whole rest of the line must match: a bad position or extra text is a malformed
    // command (answered as such below), never a silent fallback to the 2x2 grid.
    craft: new RegExp(`probe-craft ${TOKEN} ${NAME}(?: ${POS})?\\s*$`),
    place: new RegExp(`probe-place ${TOKEN} ${NAME} ${POS} (up|down|north|south|east|west)\\s*$`),
    eat: new RegExp(`probe-eat ${TOKEN} ${NAME}\\s*$`),
};
// Any probe command at all, to answer a malformed one instead of leaving the scenario waiting.
const ANY_COMMAND = new RegExp(`probe-(craft|place|eat) ${TOKEN}(?!\\S)`);
export const FACES = Object.freeze({
    up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
});
const CHAT_MAX = 200;

/** The bot.registry item for a registry name ("minecraft:stick" is "stick" in minecraft-data). */
export function itemByName(registry, name) {
    return registry.itemsByName[name] ?? (name.startsWith('minecraft:') ? registry.itemsByName[name.slice(10)] : undefined) ?? null;
}

/** How many of item id (and meta, null = any) the bot holds in its main inventory and hotbar. */
function held(bot, id, meta) {
    return bot.inventory.items().filter((i) => i.type === id && (meta === null || meta === undefined || i.metadata === meta))
        .reduce((n, i) => n + i.count, 0);
}

/**
 * The first converted variant whose ingredients the bot holds. Per item id: each fixed meta needs
 * that many of its own, and the id's total (fixed metas plus any-meta cells) needs that many of
 * any meta, so one stack is never counted for two cells.
 */
export function pickVariant(bot, variants) {
    for (const [index, v] of variants.entries()) {
        const byId = new Map(); // id -> { total, fixed: Map(meta -> n) }
        const cells = v.inShape ? v.inShape.flat() : v.ingredients;
        for (const c of cells) {
            if (!c || c.id === -1) continue;
            const e = byId.get(c.id) ?? { total: 0, fixed: new Map() };
            e.total++;
            if (c.metadata !== null && c.metadata !== undefined) e.fixed.set(c.metadata, (e.fixed.get(c.metadata) ?? 0) + 1);
            byId.set(c.id, e);
        }
        const ok = [...byId.entries()].every(([id, e]) => held(bot, id, null) >= e.total && [...e.fixed.entries()].every(([meta, n]) => held(bot, id, meta) >= n));
        if (ok) return { index, variant: v };
    }
    return null;
}

/** "k=v k=v" for the chat answer, cut at CHAT_MAX characters. */
export function chatLine(token, cmd, ok, fields) {
    const kv = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/\s+/g, '_')}`).join(' ');
    return `probe ${token} ${cmd} ${ok ? 'ok' : 'fail'}${kv ? ` ${kv}` : ''}`.slice(0, CHAT_MAX);
}

/**
 * @param {import('mineflayer').Bot} bot  a bot from initBot (bot.registry extended by forge-bridge)
 * @param {{ emit: (type: string, data?: object) => void, dumpRecipes: () => object[],
 *           convertRecipe: (registry: object, r: object) => {variants: object[], skipped: string|null},
 *           placeTimeoutMs?: number, answerDelayMs?: number }} opts
 */
export function attachProbe(bot, { emit, dumpRecipes, convertRecipe, placeTimeoutMs = 10000, answerDelayMs = 1200 }) {
    let queue = Promise.resolve();
    const serial = (fn) => { queue = queue.then(fn).catch((err) => emit('probe_error', { message: String(err?.message ?? err) })); return queue; };
    const answer = async (token, cmd, ok, data) => {
        emit('probe', { token, cmd, ok, ...data });
        try { bot.chat(chatLine(token, cmd, ok, data.chat ?? {})); } catch (err) { emit('chat_error', { message: String(err?.message ?? err) }); }
        if (answerDelayMs) await sleep(answerDelayMs); // under the server's chat spam limit
    };
    const fail = (token, cmd, data, err) => answer(token, cmd, false, { ...data, error: String(err?.message ?? err).slice(0, 300), chat: { error: String(err?.message ?? err).slice(0, 120) } });

    function ready() {
        try {
            if (typeof bot.autoEat?.disable === 'function') { bot.autoEat.disable(); emit('probe_ready', { autoEat: 'off' }); } else emit('probe_ready', { autoEat: 'absent' });
        } catch (err) {
            emit('probe_attach_error', { message: `auto-eat could not be turned off: ${String(err?.message ?? err)}` });
        }
    }
    if (bot.entity) ready();
    else bot.once('spawn', ready);

    async function equip(name) {
        const def = itemByName(bot.registry, name);
        if (!def) throw new Error(`${name} is not in bot.registry`);
        const item = bot.inventory.items().find((i) => i.type === def.id);
        if (!item) throw new Error(`no ${name} in the inventory`);
        await bot.equip(item, 'hand');
        return def;
    }

    async function craft(token, recipeId, tablePos) {
        const base = { recipe: recipeId, table: tablePos ? tablePos.toArray() : null };
        try {
            const r = dumpRecipes().find((x) => x.id === recipeId);
            if (!r) throw new Error(`recipe ${recipeId} is not in rotn-data's dump`);
            const conv = convertRecipe(bot.registry, r);
            if (!conv.variants.length) throw new Error(`recipe ${recipeId} has no usable variant (${conv.skipped ?? 'none'})`);
            const picked = pickVariant(bot, conv.variants);
            if (!picked) throw new Error(`missing ingredients for ${recipeId}`);
            const { Recipe } = require('prismarine-recipe')(bot.registry);
            const recipe = new Recipe(picked.variant);
            let table = null;
            if (tablePos) {
                table = bot.blockAt(tablePos);
                if (!table) throw new Error(`no loaded block at ${tablePos}`);
            } else if (recipe.requiresTable) throw new Error(`${recipeId} needs a crafting table`);
            const resultName = bot.registry.items[recipe.result.id]?.name ?? String(recipe.result.id);
            const before = held(bot, recipe.result.id, recipe.result.metadata);
            const t0 = Date.now();
            await bot.craft(recipe, 1, table);
            const ms = Date.now() - t0;
            const after = held(bot, recipe.result.id, recipe.result.metadata);
            const data = { ...base, variant: picked.index, variants: conv.variants.length, result: resultName, resultMeta: recipe.result.metadata, before, after, ms, tableBlock: table?.name ?? null };
            await answer(token, 'craft', after > before, { ...data, chat: { recipe: recipeId, result: resultName, before, after, ms } });
        } catch (err) {
            await fail(token, 'craft', base, err);
        }
    }

    async function place(token, name, refPos, faceName) {
        const face = new Vec3(...FACES[faceName]);
        const target = refPos.plus(face);
        const base = { item: name, ref: refPos.toArray(), face: faceName, target: target.toArray() };
        try {
            await equip(name);
            const ref = bot.blockAt(refPos);
            if (!ref) throw new Error(`no loaded block at ${refPos}`);
            const before = bot.blockAt(target)?.name ?? null;
            let updateAt = null;
            const onUpdate = () => { updateAt ??= Date.now(); };
            bot.once(`blockUpdate:${target}`, onUpdate);
            const t0 = Date.now();
            try {
                // A generous per-call wait, so a slow server is measured instead of failing at 500 ms.
                await bot._placeBlockWithOptions(ref, face, { swingArm: 'right', timeout: placeTimeoutMs });
            } finally {
                bot.removeListener(`blockUpdate:${target}`, onUpdate);
            }
            const after = bot.blockAt(target)?.name ?? null;
            // updateMs runs from the call to the server's block update; it includes the look (up to one tick).
            const data = { ...base, before, after, totalMs: Date.now() - t0, updateMs: updateAt === null ? null : updateAt - t0, timeoutMs: placeTimeoutMs };
            await answer(token, 'place', after !== before, { ...data, chat: { at: target.toArray().join(','), block: after, updateMs: data.updateMs } });
        } catch (err) {
            await fail(token, 'place', base, err);
        }
    }

    async function eat(token, name) {
        const base = { item: name };
        try {
            const def = await equip(name);
            const foodBefore = bot.food;
            const countBefore = held(bot, def.id, null);
            const t0 = Date.now();
            await bot.consume();
            // The server's update_health and the item slot's set_slot can come just after the eating
            // status; wait (at most 2 s) for both before reading them.
            for (let waited = 0; (bot.food === foodBefore || held(bot, def.id, null) === countBefore) && waited < 2000; waited += 100) await sleep(100);
            const data = { ...base, foodBefore, foodAfter: bot.food, countBefore, countAfter: held(bot, def.id, null), ms: Date.now() - t0 };
            await answer(token, 'eat', data.foodAfter > foodBefore && data.countAfter === countBefore - 1, { ...data, chat: { food: `${foodBefore}->${bot.food}`, left: data.countAfter } });
        } catch (err) {
            await fail(token, 'eat', base, err);
        }
    }

    // A command can arrive twice (whisper and broadcast); each token runs once.
    const seen = new Set();
    const fresh = (token) => !seen.has(token) && seen.add(token);
    bot.on('messagestr', (msg) => {
        let m;
        if ((m = COMMANDS.craft.exec(msg)) && fresh(m[1])) {
            const pos = m[3] === undefined ? null : new Vec3(Number(m[3]), Number(m[4]), Number(m[5]));
            emit('probe_heard', { cmd: 'craft', token: m[1] });
            serial(() => craft(m[1], m[2], pos));
        } else if ((m = COMMANDS.place.exec(msg)) && fresh(m[1])) {
            emit('probe_heard', { cmd: 'place', token: m[1] });
            serial(() => place(m[1], m[2], new Vec3(Number(m[3]), Number(m[4]), Number(m[5])), m[6]));
        } else if ((m = COMMANDS.eat.exec(msg)) && fresh(m[1])) {
            emit('probe_heard', { cmd: 'eat', token: m[1] });
            serial(() => eat(m[1], m[2]));
        } else if ((m = ANY_COMMAND.exec(msg)) && fresh(m[2])) {
            emit('probe_heard', { cmd: m[1], token: m[2], malformed: true });
            const at = msg.indexOf('probe-');
            serial(() => fail(m[2], m[1], { line: msg.slice(at, at + 200) }, new Error('malformed command (see probe-commands.mjs for the formats)')));
        }
    });
    return { idle: () => queue };
}
