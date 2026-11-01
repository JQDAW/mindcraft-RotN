// G2 (docs/PLAN.md): "old/new names round-trip" for vanilla 1.12 items, through the bot's own
// inventory. The console gives the bot items by their 1.12 name and meta (server truth); the bot reads
// each slot and reports its 1.12 name and meta, its 1.13+ name (rotn-data toNew) and that name
// translated back (rotn-data toOld). The bot driver must follow test/runner/DRIVER.md (G2 section).
//
//   items_read:      every item the server gave is reported with exactly its 1.12 name and meta
//                    (proves the bot reads its inventory, REID slot format included)
//   items_named:     each new name equals the expected 1.13+ name (Mindcraft's 1.21-style names, as
//                    rotn-data's toNew gives them); null or "unknown" fails
//   items_roundtrip: toOld(new) gives back exactly the 1.12 name and meta
//   items_table:     the FULL vanilla table gates G2 too (PR #36 review finding 4): the runner imports
//                    Mindcraft's own toNew/toOld (packages/rotn-data/index.js) and checks every entry of
//                    packages/rotn-data/vanilla/flattening-items.json (every vanilla 1.12 item with
//                    a 1.13+ name) both ways, and that the in-game sample is a subset of the table.
//                    Without the table or the module this check fails.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startSession } from '../../runner/lib/session.mjs';
import { awaitReply, giveVerdict, ints, isRegistryName, sample } from '../../runner/lib/g2.mjs';

const MS = 1000;

/** 30 well-known vanilla 1.12 items (old:meta=new), at most one inventory's worth. */
export const VANILLA_SAMPLE = [
    'minecraft:log:0=oak_log', 'minecraft:log:1=spruce_log', 'minecraft:log:2=birch_log', 'minecraft:log:3=jungle_log',
    'minecraft:log2:0=acacia_log', 'minecraft:log2:1=dark_oak_log', 'minecraft:planks:0=oak_planks', 'minecraft:planks:5=dark_oak_planks',
    'minecraft:sapling:0=oak_sapling', 'minecraft:stone:0=stone', 'minecraft:stone:1=granite', 'minecraft:stone:3=diorite',
    'minecraft:cobblestone:0=cobblestone', 'minecraft:wool:0=white_wool', 'minecraft:wool:14=red_wool', 'minecraft:dye:1=red_dye',
    'minecraft:dye:4=lapis_lazuli', 'minecraft:dye:15=bone_meal', 'minecraft:coal:0=coal', 'minecraft:coal:1=charcoal',
    'minecraft:red_flower:0=poppy', 'minecraft:yellow_flower:0=dandelion', 'minecraft:stonebrick:0=stone_bricks',
    'minecraft:crafting_table:0=crafting_table', 'minecraft:stick:0=stick', 'minecraft:wooden_pickaxe:0=wooden_pickaxe',
    'minecraft:torch:0=torch', 'minecraft:bone:0=bone', 'minecraft:rotten_flesh:0=rotten_flesh', 'minecraft:wheat_seeds:0=wheat_seeds',
].join(',');

/** "ns:path:meta=new,..." -> [{name, meta, expected}] */
export function parseItems(spec) {
    return spec.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const m = /^([a-z0-9_.-]+:[a-z0-9_./-]+):(\d{1,2})(?:=([a-z0-9_:./-]+))?$/.exec(s);
        if (!m) throw new Error(`bad item spec '${s}' (want ns:path:meta=new_name)`);
        return { name: m[1], meta: Number(m[2]), expected: m[3] ?? null };
    });
}
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const TABLE_FILE = 'packages/rotn-data/vanilla/flattening-items.json';
export const NAMES_MODULE = 'packages/rotn-data/index.js';

/**
 * The full-table check, run by the runner (no bot): {ok, detail, failures}. Every table entry must give
 * toNew(old, meta) === new and toOld(new) == {name: old, meta}; every sample item must be in the table
 * with the same new name.
 */
export async function checkFullTable(sampleItems, { repo = REPO, tableFile = TABLE_FILE, moduleFile = NAMES_MODULE } = {}) {
    let table;
    let mod;
    try {
        table = JSON.parse(fs.readFileSync(path.join(repo, tableFile), 'utf8'));
    } catch (e) {
        return { ok: false, detail: `${tableFile} not available (${e.code ?? e.message}); rotn-data PR #37`, failures: [] };
    }
    try {
        mod = await import(pathToFileURL(path.join(repo, moduleFile)).href);
    } catch (e) {
        return { ok: false, detail: `${moduleFile} not importable (${e.code ?? e.message}); rotn-data PR #37`, failures: [] };
    }
    const entries = Array.isArray(table?.entries) ? table.entries : null;
    if (!entries || entries.length === 0 || typeof mod.toNew !== 'function' || typeof mod.toOld !== 'function') {
        return { ok: false, detail: 'the table has no entries, or the module has no toNew/toOld', failures: [] };
    }
    const failures = [];
    for (const e of entries) {
        let next;
        let back;
        try { next = mod.toNew(e.old, e.meta); } catch { next = 'threw'; }
        try { back = mod.toOld(e.new); } catch { back = 'threw'; }
        if (next !== e.new) failures.push(`toNew(${e.old}, ${e.meta}) = ${JSON.stringify(next)}, table says ${e.new}`);
        if (!back || back.name !== e.old || back.meta !== e.meta) failures.push(`toOld(${e.new}) = ${JSON.stringify(back)}, table says ${e.old}:${e.meta}`);
    }
    const byOld = new Map(entries.map((e) => [`${e.old}:${e.meta}`, e.new]));
    const notInTable = sampleItems.filter((it) => byOld.get(`${it.name}:${it.meta}`) !== it.expected)
        .map((it) => `sample ${it.name}:${it.meta}=${it.expected} not in the table${byOld.has(`${it.name}:${it.meta}`) ? ` (table: ${byOld.get(`${it.name}:${it.meta}`)})` : ''}`);
    failures.push(...notInTable);
    return {
        ok: failures.length === 0,
        detail: `${entries.length} table entries both ways, ${sampleItems.length} sample items in the table: ${failures.length ? `${failures.length} failure(s), first: ${failures[0]}` : 'all correct'}`,
        failures,
    };
}

const bare = (n) => (n?.startsWith('minecraft:') ? n.slice('minecraft:'.length) : n);

export default {
    id: 'g2-items-roundtrip',
    gate: 'G2',
    title: 'Vanilla 1.12 items in the bot\'s inventory round-trip between old and new names',
    checks: {
        login_online: 'Starting the service makes the bot log in with its own account',
        items_read: 'Items and inventory show RotN names (the bot reads what the server gave it)',
        items_named: 'Items show readable 1.13+ names (old/new names round-trip)',
        items_roundtrip: 'Old/new names round-trip',
        items_table: 'Old/new names round-trip (every vanilla 1.12 item with a 1.13+ name, through Mindcraft\'s own toNew/toOld)',
    },
    defaults: {
        bot: 'FRCFLD',
        items: VANILLA_SAMPLE,
        dataRoot: '',              // '' = this repo; tests point it at fixture data (never a gate run)
        loginTimeoutMs: 240 * MS,
        settleMs: 10 * MS,
        seeMs: 5 * MS,
        replyTimeoutMs: 120 * MS,
        pollMs: 3 * MS,
        logTail: 40000,
        consoleWaitS: 1,
    },
    gateParams: { bot: 'equal', items: 'equal', dataRoot: 'equal' },

    async run(ctx) {
        const { server, clock, params: p } = ctx;
        const name = p.bot;
        const items = parseItems(p.items);
        if (items.length > 36) throw new Error(`${items.length} items do not fit one inventory (36)`);
        // The full table first: it needs no server, and it is recorded even if the login fails.
        const full = await checkFullTable(items, { repo: p.dataRoot || REPO });
        ctx.note('tableFailures', sample(full.failures));
        ctx.check('items_table', full.ok, full.detail);
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);
        try {
            server.console(`clear ${name}`, p.consoleWaitS);
            const given = items.map((it) => ({ ...it, ...giveVerdict(server.console(`give ${name} ${it.name} 1 ${it.meta}`, p.consoleWaitS), name) }));
            ctx.note('notGiven', given.filter((g) => !g.ok).map((g) => `${g.name}:${g.meta}: ${g.detail}`));
            await clock.sleep(p.seeMs);

            const token = crypto.randomBytes(6).toString('hex');
            server.console(`tell ${name} scenario-items ${token}`, 1);
            const rep = await awaitReply(ctx, s.sinceMarker, name, 'items', token, p.replyTimeoutMs);
            // slot oldName oldMeta newName backName backMeta
            const slots = (rep?.entries ?? []).map((f) => ({ slot: f[0], name: f[1], meta: ints([f[2]])?.[0], next: f[3], back: f[4], backMeta: ints([f[5]])?.[0], raw: f.join(' ') }));
            ctx.note('slots', slots.map((x) => x.raw));
            const noReply = !rep ? `no "items ${token}" reply within ${p.replyTimeoutMs / MS}s` : !rep.complete ? `reply incomplete (${rep.total} pages expected)` : null;

            const unread = [], misnamed = [], broken = [];
            for (const g of given) {
                const id = `${g.name}:${g.meta}`;
                if (!g.ok) { unread.push(`${id}: the server could not give it (${g.detail})`); continue; }
                const hit = slots.find((x) => x.name === g.name && x.meta === g.meta);
                if (!hit) { unread.push(`${id}: not reported`); continue; }
                const nextOk = typeof hit.next === 'string' && /^([a-z0-9_.-]+:)?[a-z0-9_./-]+(:\d+)?$/.test(hit.next)
                    && !['null', 'undefined', 'unknown'].includes(hit.next) && (g.expected === null || bare(hit.next) === bare(g.expected));
                if (!nextOk) misnamed.push(`${id}: new name "${hit.next}"${g.expected ? `, expected "${g.expected}"` : ''}`);
                if (!(isRegistryName(hit.back) && hit.back === g.name && hit.backMeta === g.meta)) broken.push(`${id} -> ${hit.next} -> ${hit.back}:${hit.backMeta}`);
            }
            ctx.note('unread', sample(unread));
            ctx.note('misnamed', sample(misnamed));
            ctx.note('roundtripBroken', sample(broken));
            const n = given.length;
            ctx.check('items_read', !noReply && unread.length === 0, noReply ?? `${n - unread.length}/${n} given items reported with their 1.12 name and meta${unread.length ? `; ${unread.slice(0, 3).join('; ')}` : ''}`);
            ctx.check('items_named', !noReply && unread.length === 0 && misnamed.length === 0,
                noReply ?? `${n - unread.length - misnamed.length}/${n} with the expected 1.13+ name${misnamed.length ? `; ${misnamed.slice(0, 3).join('; ')}` : ''}${unread.length ? ' (some items unread)' : ''}`);
            ctx.check('items_roundtrip', !noReply && unread.length === 0 && broken.length === 0,
                noReply ?? `${n - unread.length - broken.length}/${n} round-trip to the same 1.12 name and meta${broken.length ? `; ${broken.slice(0, 3).join('; ')}` : ''}${unread.length ? ' (some items unread)' : ''}`);
        } finally {
            server.console(`clear ${name}`, p.consoleWaitS);
        }
    },
};
