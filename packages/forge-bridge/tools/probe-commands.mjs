// Probe P1 commands for g1-driver (skills-rotn Request 2 live proof; plan in coord/STATUS-net-forge.md).
// Enabled only with ROTN_DRIVER_PROBE=1, so G1/G2 gate runs are unchanged. Not a gate.
//
// The scenario (harness-ops, test/scenarios/probe/) sends one command per console whisper
// (`tell <bot> probe-...`). Only a whisper from the console ("Server") whose whole text is the
// command is accepted; public chat and players' whispers are ignored (logged as probe_ignored).
// The bot runs them one at a time, each with a 60 s time limit (answered ok:false when reached),
// and answers each exactly once with
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
// Anchored on the whole whisper text: the command must be the message, from start to end.
// A bad position or extra text is a malformed command (answered as such below), never a
// silent fallback to the 2x2 grid.
const COMMANDS = {
    craft: new RegExp(`^probe-craft ${TOKEN} ${NAME}(?: ${POS})?\\s*$`),
    place: new RegExp(`^probe-place ${TOKEN} ${NAME} ${POS} (up|down|north|south|east|west)\\s*$`),
    eat: new RegExp(`^probe-eat ${TOKEN} ${NAME}\\s*$`),
};
// Any probe command at all, to answer a malformed one instead of leaving the scenario waiting.
const ANY_COMMAND = new RegExp(`^probe-(craft|place|eat) ${TOKEN}(?!\\S)`);
// The only accepted sender: the test server's console (`tell <bot> ...`), which mineflayer reports
// as a 'whisper' from "Server" (S1 check d, coord/STATUS-harness-ops.md). Public chat and whispers
// from players are ignored. The P1 test server's whitelist holds only the bot and the human.
export const PROBE_SENDER = 'Server';
export const COMMAND_TIME_LIMIT_MS = 60000;

/**
 * The reply contract (README, "Probe P1"): the fields of a DRIVER {"type":"probe",...} line.
 * `base` fields are in every reply that got as far as parsing the command (failures included,
 * except a time-limit or malformed-command reply, which carry only the common and failure fields);
 * `done` fields are in every ok:true reply. A field not listed here is never sent.
 * Types: 'name' = a full registry name ("minecraft:cobblestone", "pyrotech:crude_axe");
 * 'pos' = [x, y, z] integers; '|null' = may be null.
 */
export const PROBE_CONTRACT_VERSION = 1;
export const PROBE_REPLY = Object.freeze({
    common: Object.freeze({ type: 'string', t: 'string', v: 'number', token: 'string', cmd: 'string', ok: 'boolean' }),
    failure: Object.freeze({ error: 'string', timedOut: 'true', limitMs: 'number', line: 'string' }),
    craft: Object.freeze({
        base: Object.freeze({ recipe: 'string', table: 'pos|null' }),
        done: Object.freeze({ variant: 'number', variants: 'number', result: 'name', resultMeta: 'number|null', before: 'number', after: 'number', ms: 'number', tableBlock: 'name|null' }),
    }),
    place: Object.freeze({
        base: Object.freeze({ item: 'name', ref: 'pos', face: 'string', target: 'pos' }),
        done: Object.freeze({ before: 'name|null', after: 'name|null', expected: 'name|null', otherUpdates: 'number', totalMs: 'number', updateMs: 'number|null', timeoutMs: 'number' }),
    }),
    eat: Object.freeze({
        base: Object.freeze({ item: 'name' }),
        done: Object.freeze({ foodBefore: 'number', foodAfter: 'number', countBefore: 'number', countAfter: 'number', ms: 'number' }),
    }),
});

const isType = (v, type) => type.split('|').some((t) => {
    if (t === 'null') return v === null;
    if (t === 'true') return v === true;
    if (t === 'name') return typeof v === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(v);
    if (t === 'pos') return Array.isArray(v) && v.length === 3 && v.every(Number.isInteger);
    if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
    return typeof v === t;
});

/**
 * Problems with a probe reply under the contract ([] = valid). For the scenario's own tests: a fake
 * driver's replies should pass this, so the scenario reads only fields the real driver sends.
 * `t` and `type` come from the driver's event() wrapper and may be absent in a bare reply object.
 */
export function checkProbeReply(reply) {
    const problems = [];
    if (!reply || typeof reply !== 'object') return ['not an object'];
    const spec = PROBE_REPLY[reply.cmd];
    if (!spec || reply.cmd === 'common' || reply.cmd === 'failure') return [`unknown cmd ${JSON.stringify(reply.cmd)}`];
    if (reply.type !== undefined && reply.type !== 'probe') problems.push(`type is ${JSON.stringify(reply.type)}, not "probe"`);
    if (reply.v !== PROBE_CONTRACT_VERSION) problems.push(`v is ${JSON.stringify(reply.v)}, not ${PROBE_CONTRACT_VERSION}`);
    const known = { ...PROBE_REPLY.common, ...PROBE_REPLY.failure, ...spec.base, ...spec.done };
    for (const [k, v] of Object.entries(reply)) {
        if (!(k in known)) problems.push(`unknown field ${k}`);
        else if (!isType(v, known[k])) problems.push(`${k}: ${JSON.stringify(v)} is not ${known[k]}`);
    }
    for (const k of ['v', 'token', 'cmd', 'ok']) if (!(k in reply)) problems.push(`missing ${k}`);
    if (reply.ok === true) {
        for (const k of [...Object.keys(spec.base), ...Object.keys(spec.done)]) if (!(k in reply)) problems.push(`ok reply without ${k}`);
        for (const k of Object.keys(PROBE_REPLY.failure)) if (k in reply) problems.push(`ok reply with ${k}`);
    } else if (reply.ok === false && typeof reply.error !== 'string') problems.push('failure without error');
    return problems;
}
export const FACES = Object.freeze({
    up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
});
const CHAT_MAX = 200;

/**
 * The full registry name of a bot.registry entry: forge-bridge's `registryName` when it set one,
 * else "modid:name" as it is, else "minecraft:" + minecraft-data's name. Every name in a reply is
 * in this form (contract v1), so vanilla and modded names compare the same way.
 */
export function registryName(entry) {
    if (!entry) return null;
    if (entry.registryName) return entry.registryName;
    return entry.name.includes(':') ? entry.name : `minecraft:${entry.name}`;
}

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
export function attachProbe(bot, {
    emit, dumpRecipes, convertRecipe, placeTimeoutMs = 10000, answerDelayMs = 1200,
    commandTimeoutMs = COMMAND_TIME_LIMIT_MS, stuckGraceMs = 10000,
}) {
    let queue = Promise.resolve();
    const serial = (fn) => { queue = queue.then(fn).catch((err) => emit('probe_error', { message: String(err?.message ?? err) })); return queue; };
    // Each token gets exactly one answer. A command that finishes after its time limit was answered
    // is only logged ('probe_late'), never answered twice.
    const answered = new Set();
    // A mineflayer Block's full registry name, through bot.registry (forge-bridge's names and aliases).
    const blockName = (block) => (block ? registryName(bot.registry.blocks[block.type] ?? { name: block.name }) : null);
    const answer = async (token, cmd, ok, { chat = {}, ...data }) => {
        if (answered.has(token)) { emit('probe_late', { v: PROBE_CONTRACT_VERSION, token, cmd, ok, ...data }); return; }
        answered.add(token);
        emit('probe', { v: PROBE_CONTRACT_VERSION, token, cmd, ok, ...data });
        try { bot.chat(chatLine(token, cmd, ok, chat)); } catch (err) { emit('chat_error', { message: String(err?.message ?? err) }); }
        if (answerDelayMs) await sleep(answerDelayMs); // under the server's chat spam limit
    };
    const fail = (token, cmd, data, err) => answer(token, cmd, false, { ...data, error: String(err?.message ?? err).slice(0, 300), chat: { error: String(err?.message ?? err).slice(0, 120) } });

    // The per-command time limit (lead, #162 review): a hung craft, equip, place or consume is
    // answered ok:false at commandTimeoutMs. The next command still waits until the hung one
    // settles, so two never click at once, but at most stuckGraceMs more; then any open window is
    // closed and the queue goes on ('probe_stuck').
    const limited = (token, cmd, run) => async () => {
        let settled = false;
        const op = Promise.resolve().then(run).catch((err) => emit('probe_error', { token, cmd, message: String(err?.message ?? err) }))
            .finally(() => { settled = true; });
        let timer;
        const limit = new Promise((resolve) => { timer = setTimeout(() => resolve('limit'), commandTimeoutMs); });
        const first = await Promise.race([op.then(() => 'done'), limit]);
        clearTimeout(timer);
        if (first === 'done') return;
        await fail(token, cmd, { timedOut: true, limitMs: commandTimeoutMs }, new Error(`time limit of ${commandTimeoutMs} ms reached`));
        let graceTimer;
        await Promise.race([op, new Promise((resolve) => { graceTimer = setTimeout(resolve, stuckGraceMs); })]);
        clearTimeout(graceTimer);
        if (!settled) {
            emit('probe_stuck', { token, cmd, graceMs: stuckGraceMs });
            try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch { /* no window */ }
        }
    };

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
            const resultName = registryName(bot.registry.items[recipe.result.id]) ?? String(recipe.result.id);
            const before = held(bot, recipe.result.id, recipe.result.metadata);
            const t0 = Date.now();
            await bot.craft(recipe, 1, table);
            const ms = Date.now() - t0;
            const after = held(bot, recipe.result.id, recipe.result.metadata);
            const data = { ...base, variant: picked.index, variants: conv.variants.length, result: resultName, resultMeta: recipe.result.metadata, before, after, ms, tableBlock: table ? blockName(table) : null };
            const ok = after > before;
            await answer(token, 'craft', ok, { ...data, ...(ok ? {} : { error: `the ${resultName} count did not rise (${before} -> ${after})` }), chat: { recipe: recipeId, result: resultName, before, after, ms } });
        } catch (err) {
            await fail(token, 'craft', base, err);
        }
    }

    async function place(token, name, refPos, faceName) {
        const face = new Vec3(...FACES[faceName]);
        const target = refPos.plus(face);
        const base = { item: name, ref: refPos.toArray(), face: faceName, target: target.toArray() };
        try {
            const def = await equip(name);
            const ref = bot.blockAt(refPos);
            if (!ref) throw new Error(`no loaded block at ${refPos}`);
            const before = blockName(bot.blockAt(target));
            // Only an update to the placed block counts (#162 review nit 3): the block of the same
            // name as the item if bot.registry has one, else any change away from `before`.
            const expected = bot.registry.blocksByName[def.name] ? registryName(bot.registry.blocksByName[def.name]) : null;
            let updateAt = null;
            let otherUpdates = 0;
            const onUpdate = (oldBlock, newBlock) => {
                const now = blockName(newBlock);
                const isPlaced = expected ? now === expected : now !== before;
                if (isPlaced) updateAt ??= Date.now(); else otherUpdates++;
            };
            bot.on(`blockUpdate:${target}`, onUpdate);
            const t0 = Date.now();
            try {
                // A generous per-call wait, so a slow server is measured instead of failing at 500 ms.
                await bot._placeBlockWithOptions(ref, face, { swingArm: 'right', timeout: placeTimeoutMs });
                // mineflayer returns on the first update that changes the block type, which may be an
                // unrelated one; wait (within the same timeout) for the placed block's own update.
                while (expected && updateAt === null && Date.now() - t0 < placeTimeoutMs) await sleep(25);
            } finally {
                bot.removeListener(`blockUpdate:${target}`, onUpdate);
            }
            const after = blockName(bot.blockAt(target));
            // updateMs runs from the call to the server's block update; it includes the look (up to one tick).
            const data = { ...base, before, after, expected, otherUpdates, totalMs: Date.now() - t0, updateMs: updateAt === null ? null : updateAt - t0, timeoutMs: placeTimeoutMs };
            const ok = after !== before && (expected === null || after === expected);
            await answer(token, 'place', ok, { ...data, ...(ok ? {} : { error: `the block at ${target} is ${after}, not ${expected ?? 'a new block'}` }), chat: { at: target.toArray().join(','), block: after, updateMs: data.updateMs } });
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
            const ms = Date.now() - t0; // bot.consume only, not the wait below
            // The server's update_health and the item slot's set_slot can come just after the eating
            // status; wait (at most 2 s) for both before reading them.
            for (let waited = 0; (bot.food === foodBefore || held(bot, def.id, null) === countBefore) && waited < 2000; waited += 100) await sleep(100);
            const data = { ...base, foodBefore, foodAfter: bot.food, countBefore, countAfter: held(bot, def.id, null), ms };
            const ok = data.foodAfter > foodBefore && data.countAfter === countBefore - 1;
            await answer(token, 'eat', ok, { ...data, ...(ok ? {} : { error: `food ${foodBefore} -> ${data.foodAfter}, ${name} ${countBefore} -> ${data.countAfter}` }), chat: { food: `${foodBefore}->${bot.food}`, left: data.countAfter } });
        } catch (err) {
            await fail(token, 'eat', base, err);
        }
    }

    // Each token runs once.
    const seen = new Set();
    const fresh = (token) => !seen.has(token) && seen.add(token);
    // The raw chat component, not mineflayer's 'whisper' text pattern: 1.12 sends a console `tell` as
    // {translate: "commands.message.display.incoming", with: [sender, message]}. The text pattern
    // would also take an op's `/say Server whispers to you: ...` ("[JQDAW] Server whispers ...",
    // translate chat.type.announcement), so it is not used (#162 re-review nit 1).
    bot.on('message', (jsonMsg) => {
        if (jsonMsg?.translate !== 'commands.message.display.incoming' || !Array.isArray(jsonMsg.with) || jsonMsg.with.length !== 2) return;
        const username = String(jsonMsg.with[0]?.toString?.() ?? jsonMsg.with[0] ?? '');
        const msg = String(jsonMsg.with[1]?.toString?.() ?? jsonMsg.with[1] ?? '');
        if (!ANY_COMMAND.test(msg)) return;
        if (username !== PROBE_SENDER) {
            emit('probe_ignored', { from: username.slice(0, 32), reason: `not a console whisper (only ${PROBE_SENDER} is accepted)` });
            return;
        }
        let m;
        if ((m = COMMANDS.craft.exec(msg)) && fresh(m[1])) {
            const pos = m[3] === undefined ? null : new Vec3(Number(m[3]), Number(m[4]), Number(m[5]));
            emit('probe_heard', { cmd: 'craft', token: m[1] });
            serial(limited(m[1], 'craft', () => craft(m[1], m[2], pos)));
        } else if ((m = COMMANDS.place.exec(msg)) && fresh(m[1])) {
            emit('probe_heard', { cmd: 'place', token: m[1] });
            serial(limited(m[1], 'place', () => place(m[1], m[2], new Vec3(Number(m[3]), Number(m[4]), Number(m[5])), m[6])));
        } else if ((m = COMMANDS.eat.exec(msg)) && fresh(m[1])) {
            emit('probe_heard', { cmd: 'eat', token: m[1] });
            serial(limited(m[1], 'eat', () => eat(m[1], m[2])));
        } else if ((m = ANY_COMMAND.exec(msg)) && fresh(m[2])) {
            emit('probe_heard', { cmd: m[1], token: m[2], malformed: true });
            serial(() => fail(m[2], m[1], { line: msg.slice(0, 200) }, new Error('malformed command (see probe-commands.mjs for the formats)')));
        }
    });
    return { idle: () => queue };
}
