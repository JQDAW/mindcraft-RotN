// "How do I get X" (rotn-data Phase 3 PR 2, for skills-rotn and the G3 scenarios): every way the
// pack offers to obtain an item, from three sources, in this order:
//   1. world rules (3.3.4/world-sources.json): breaking blocks, using a tool on a block and the
//      start kit, hand-written with cited evidence and a confidence each;
//   2. crafting recipes (the dump, after CraftTweaker) and furnace smelting (the dump);
//   3. the dump's plain block drops (getItemDropped with a fixed seed). These miss event-handler
//      drops (Pyrotech's stone-to-rocks, Dropt rules) and random drops, so they come last and say so.
// Pure functions over a RotnData catalog; no network, no game state.
import { WILDCARD_META } from './names.js';

const sameMeta = (want, have) => want == null || have == null || have === WILDCARD_META || want === WILDCARD_META || want === have;
/** Does an item meta match what was asked: one meta, a set of metas (a bare rock name), or any. */
const metaOk = (want, have) => (want.meta != null ? sameMeta(want.meta, have) : !want.metas || have == null || have === WILDCARD_META || want.metas.includes(have));
const rank = (name) => (name.startsWith('pyrotech:') ? 0 : name.startsWith('minecraft:') ? 1 : 2);
const MAX_CHOICES = 6;
const MAX_DROP_BLOCKS = 10;

/** Compare names without case, spaces or underscores ("blueschist" is "Blue Schist"). */
const squash = (v) => String(v).toLowerCase().replace(/[\s_]+/g, '');
/** "red_granite" -> "redgraniterock", matching the display name "Red Granite Rock". */
const rockLabel = (v) => squash(`${v} rock`);

/**
 * The stone -> rocks pairs of a world rule with `stoneFamilies`, from the dump's display names.
 * @returns {Array<{block: {name, meta}, item: {name, meta}, documented: boolean}>}
 */
export function stonePairs(catalog, rule) {
    const out = [];
    for (const fam of rule.stoneFamilies ?? []) {
        const b = catalog.dump.blocks?.blocks?.[fam.block];
        if (!b) continue;
        const rocks = [];
        for (const rn of fam.rocks) for (const v of catalog.dump.items?.items?.[rn]?.variants ?? []) {
            if (v.displayName) rocks.push({ name: rn, meta: v.meta, label: squash(v.displayName) });
        }
        for (const s of b.states ?? []) {
            const prop = s.props?.variant ?? s.props?.type;
            if (!prop) continue;
            const rock = rocks.find((r) => r.label === rockLabel(prop));
            if (!rock) continue;
            out.push({ block: { name: fam.block, meta: s.meta }, item: { name: rock.name, meta: rock.meta }, documented: (fam.documentedMetas ?? []).includes(s.meta) });
        }
    }
    return out;
}

/** Every (block, item) pair a world rule produces. */
function rulePairs(catalog, rule) {
    if (rule.stoneFamilies) return stonePairs(catalog, rule);
    if (rule.pairs) return rule.pairs.map((p) => ({ block: p.block, item: p.item, documented: p.documented === true }));
    const g = rule.gives;
    if (!g) return [];
    if (rule.action === 'start-kit') return [{ block: null, item: { name: g.name, meta: g.meta } }];
    // A block may name its own item ("item"; the Underground Biomes rock piles drop their own rocks)
    // and carry its own documented flag (per-pair confidence, like `pairs`).
    return (rule.blocks ?? []).map((b) => ({
        block: { name: b.name, ...(b.meta != null ? { meta: b.meta } : {}) },
        item: { name: b.item ?? g.name, meta: g.meta === 'block' ? (b.meta ?? null) : g.meta },
        documented: b.documented === true,
    }));
}

/**
 * For a rule with `ore` (rock piles, stone for rocks): which of its blocks, at which metas, give an
 * item in that ore dictionary (the dump's oredict.json; wildcard members mean every meta). skills-rotn
 * needs this: a bare pyrotech:rock pile also covers metas 4, 5, 7 and 9 (dirt clump, sand pile, wood
 * chips, red sand), which are not rocks, so the crude axe craft would fail with them (lead, #142).
 * @returns {{name: string, members: Array<{name, meta}>, blocks: Array<{name: string, metas: number[]}>}|null}
 */
export function oreInfo(catalog, rule) {
    if (!rule?.ore) return null;
    const members = (catalog.oreDict(rule.ore) ?? []).map((s) => ({ name: s.name, meta: s.meta === WILDCARD_META ? null : s.meta }));
    const inOre = (name, meta) => members.some((m) => m.name === name && (m.meta === null || m.meta === meta));
    const byBlock = new Map();
    for (const p of rulePairs(catalog, rule)) {
        if (!p.block) continue;
        const states = catalog.dump.blocks?.blocks?.[p.block.name]?.states ?? [];
        const blockMetas = p.block.meta != null ? [p.block.meta] : states.map((s) => s.meta);
        for (const bm of blockMetas) {
            const im = rule.gives?.meta === 'block' && p.item.meta == null ? bm : p.item.meta;
            if (!inOre(p.item.name, im)) continue;
            if (!byBlock.has(p.block.name)) byBlock.set(p.block.name, new Set());
            byBlock.get(p.block.name).add(bm);
        }
    }
    return { name: rule.ore, members, blocks: [...byBlock].map(([name, ms]) => ({ name, metas: [...ms].sort((a, b) => a - b) })) };
}

function worldWays(catalog, want) {
    const ways = [];
    for (const rule of catalog.worldSources ?? []) {
        const pairs = rulePairs(catalog, rule).filter((p) => {
            if (p.item.name !== want.name) return false;
            // gives.meta 'block' with an unspecified block meta: each block meta gives its own item meta.
            if (rule.gives?.meta === 'block' && p.item.meta == null) return true;
            return metaOk(want, p.item.meta);
        });
        if (!pairs.length) continue;
        const blocks = [];
        for (const p of pairs.filter((x) => x.block)) {
            // gives.meta 'block' on a block without a meta: the asked meta(s), else any.
            const metas = rule.gives?.meta === 'block' && p.block.meta == null ? (want.meta != null ? [want.meta] : want.metas ?? [null]) : [p.block.meta];
            const states = catalog.dump.blocks?.blocks?.[p.block.name]?.states;
            for (const meta of metas) {
                // A block meta the block does not have (pyrotech:rock:15) is no way at all.
                if (meta != null && states && !states.some((s) => s.meta === meta)) continue;
                blocks.push(meta == null ? { name: p.block.name } : { name: p.block.name, meta });
            }
        }
        if (rule.action !== 'start-kit' && !blocks.length) continue;
        // Rules with pairs (stone families, trees, debarking, planks): documented only if a matching
        // pair is (#107 review); otherwise the rule's own value.
        const perPair = !!(rule.stoneFamilies || rule.pairs || (rule.blocks ?? []).some((b) => 'documented' in b));
        const confidence = perPair ? (pairs.some((p) => p.documented) ? 'documented' : 'inferred') : (rule.confidence ?? 'inferred');
        const way = {
            kind: 'world',
            id: rule.id,
            action: rule.action,
            summary: rule.summary,
            blocks,
            count: rule.count ?? rule.gives?.count ?? null,
            tool: rule.tool ?? null,
            // A tool that helps but is not required (fell-tree: an axe); only on rules that name one.
            ...(rule.preferredTool ? { preferredTool: rule.preferredTool } : {}),
            // A tool that stops this way (dirt-piles: a shovel of level 1 or higher gives the plain
            // drop instead); by hand or with any other tool the way applies. Only on rules that name one.
            ...(rule.unlessTool ? { unlessTool: rule.unlessTool } : {}),
            confidence,
            evidence: rule.evidence ?? [],
            unverified: rule.unverified ?? [],
        };
        if (rule.ore) {
            way.ore = oreInfo(catalog, rule);
            // Per listed block: does this block at this meta give an item in the ore?
            for (const b of way.blocks) if (b.meta != null) b.inOre = way.ore.blocks.some((x) => x.name === b.name && x.metas.includes(b.meta));
        }
        if (rule.inferred) way.inferred = rule.inferred;
        if (rule.note) way.note = rule.note;
        ways.push(way);
    }
    return ways;
}

/** A dump ingredient as a short list of choices, likeliest first. */
function choices(ing) {
    const stacks = [...(ing?.stacks ?? [])].map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.name) - rank(b.s.name) || a.i - b.i).map((x) => x.s);
    const out = { choices: stacks.slice(0, MAX_CHOICES).map((s) => ({ name: s.name, meta: s.meta === WILDCARD_META ? null : s.meta })) };
    if (stacks.length > MAX_CHOICES) out.more = stacks.length - MAX_CHOICES;
    if (ing?.ore) out.ore = ing.ore;
    else if (ing?.ores?.length === 1) out.ore = ing.ores[0];
    return out;
}

function craftWays(catalog, want) {
    const ways = [];
    for (const r of catalog.recipesFor(want.name, { meta: want.meta ?? undefined })) {
        if (!metaOk(want, r.result.meta)) continue;
        const cells = (r.inShape ? r.inShape.flat() : r.ingredients ?? []).filter(Boolean);
        const groups = new Map();
        for (const c of cells) {
            const k = JSON.stringify(c.stacks ?? []);
            if (!groups.has(k)) groups.set(k, { ...choices(c), count: 0 });
            groups.get(k).count++;
        }
        const inputs = [...groups.values()];
        const score = inputs.reduce((a, g) => a + (g.choices[0] ? rank(g.choices[0].name) : 2), 0) * 2 + (r.requiresTable ? 1 : 0);
        ways.push({ kind: 'craft', recipeId: r.id, requiresTable: r.requiresTable, gives: { ...r.result }, inputs, score, ...(r.remaining?.some(Boolean) ? { keeps: r.remaining.filter(Boolean) } : {}) });
    }
    ways.sort((a, b) => a.score - b.score || (a.gives.meta ? 1 : 0) - (b.gives.meta ? 1 : 0));
    // Recipes that differ only in their id (a vanilla and a CraftTweaker copy) are one way.
    const seen = new Set();
    return ways.filter((w) => {
        const k = JSON.stringify([w.requiresTable, w.gives, w.inputs]);
        if (seen.has(k)) return false;
        seen.add(k);
        delete w.score;
        return true;
    });
}

function smeltWays(catalog, want) {
    return catalog.smeltingFor(want.meta == null ? want.name : `${want.name}:${want.meta}`).filter((s) => metaOk(want, s.output.meta)).map((s) => ({
        kind: 'smelt', station: 'furnace', input: { name: s.input.name, meta: s.input.meta === WILDCARD_META ? null : s.input.meta }, gives: { ...s.output }, xp: s.xp,
    }));
}

function dropIndex(catalog) {
    if (catalog._dropIndex) return catalog._dropIndex;
    const idx = new Map(); // item name -> [{block, meta, itemMeta, count}]
    for (const [bn, b] of Object.entries(catalog.dump.blocks?.blocks ?? {})) {
        for (const s of b.states ?? []) for (const d of s.drops ?? []) {
            if (!idx.has(d.name)) idx.set(d.name, []);
            idx.get(d.name).push({ block: bn, meta: s.meta, itemMeta: d.meta, count: d.count });
        }
    }
    catalog._dropIndex = idx;
    return idx;
}

function dropWays(catalog, want, worldBlocks) {
    const hits = (dropIndex(catalog).get(want.name) ?? []).filter((d) => metaOk(want, d.itemMeta) && !worldBlocks.has(d.block));
    const byBlock = new Map();
    for (const h of hits) {
        if (!byBlock.has(h.block)) byBlock.set(h.block, []);
        byBlock.get(h.block).push(h.meta);
    }
    const blocks = [...byBlock.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
    if (!blocks.length) return [];
    const way = {
        kind: 'block-drop',
        summary: 'The block\'s plain drop in the dump (getItemDropped with a fixed seed). Event handlers (Pyrotech, Dropt) and random drops are not included, and the world rules above win where they disagree.',
        blocks: blocks.slice(0, MAX_DROP_BLOCKS).map(([name, metas]) => ({ name, metas: [...new Set(metas)].sort((a, b) => a - b) })),
        confidence: 'dump-sample',
    };
    if (blocks.length > MAX_DROP_BLOCKS) way.more = blocks.length - MAX_DROP_BLOCKS;
    return [way];
}

/**
 * Every way to get an item: world rules, crafting, smelting, then plain block drops.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {string|{name: string, meta?: number}} input any accepted spelling ("stone_pickaxe",
 *        "pyrotech:rock:6", "oak_planks", "log:1")
 * @param {{meta?: number}} [opts] metadata, if the input has none
 * @returns {{item: {name: string, meta: number|null, metas?: number[]}, ways: object[]}|null} null for an
 *          unknown item; `metas` when a bare rock name was narrowed to its rock variants
 */
export function howToGet(catalog, input, { meta } = {}) {
    const r = catalog.resolve(input, 'items');
    if (!r || !catalog.names.items.has(r.name)) return null;
    const want = { name: r.name, meta: meta ?? r.meta ?? null };
    // A bare rock name ("pyrotech:rock") means the variants that are rocks (#107 review): the
    // metas the 'rock' ore dictionary lists for it, not the dirt clump, sand pile or wood chips.
    if (want.meta == null) {
        const rockMetas = (catalog.oreDict('rock') ?? []).filter((s) => s.name === want.name).map((s) => s.meta);
        if (rockMetas.length && !rockMetas.includes(WILDCARD_META)) want.metas = [...new Set(rockMetas)].sort((a, b) => a - b);
    }
    const world = worldWays(catalog, want);
    const worldBlocks = new Set(world.flatMap((w) => w.blocks.map((b) => b.name)));
    return {
        item: want,
        ways: [...world, ...craftWays(catalog, want), ...smeltWays(catalog, want), ...dropWays(catalog, want, worldBlocks)],
    };
}

/**
 * The "4 identical rocks -> block" recipes (shapeless, four equal single-stack ingredients from the
 * 'rock' ore dictionary): which block each rock type makes. RotN's rocks make different blocks
 * (stone rock -> cobblestone, limestone rock -> limestone cobble, Underground Biomes rocks -> their
 * cobble), so the G3 "rocks to cobblestone" check accepts every output listed here.
 * @returns {Array<{rock: {name, meta}, gives: {name, meta, count}, recipeId: string}>}
 */
export function rockRecipes(catalog) {
    const rockNames = new Set((catalog.oreDict('rock') ?? []).map((s) => s.name));
    const out = [];
    for (const r of catalog.dump.recipes?.recipes ?? []) {
        if (r.type !== 'shapeless' || r.ingredients?.length !== 4) continue;
        const first = JSON.stringify(r.ingredients[0]?.stacks ?? []);
        if (!r.ingredients.every((i) => JSON.stringify(i.stacks ?? []) === first)) continue;
        const stacks = r.ingredients[0].stacks ?? [];
        if (stacks.length !== 1 || !rockNames.has(stacks[0].name)) continue;
        out.push({ rock: { name: stacks[0].name, meta: stacks[0].meta }, gives: { ...r.result }, recipeId: r.id });
    }
    return out.sort((a, b) => a.rock.name.localeCompare(b.rock.name) || a.rock.meta - b.rock.meta);
}

/**
 * A short plain-text answer for chat or a prompt (at most `maxWays` ways).
 * @returns {string}
 */
export function formatHowToGet(result, { maxWays = 4 } = {}) {
    if (!result) return 'Unknown item.';
    const label = (x) => (x.meta == null ? x.name : `${x.name}:${x.meta}`);
    const article = (w) => (/^[aeiou]/.test(w) ? 'an' : 'a');
    const tool = (w) => {
        const t = w.tool;
        if (w.action === 'start-kit') return '';
        const level = (x) => (x.maxLevel != null ? ` of mining level ${x.maxLevel} or lower` : x.minLevel ? ` of mining level ${x.minLevel} or higher` : '');
        if (!t && w.unlessTool) return ` By hand or with any tool except ${article(w.unlessTool.type)} ${w.unlessTool.type}${level(w.unlessTool)}.`;
        if (!t) return ' By hand.';
        if (t.item) return ` With ${t.item}.`;
        return ` With ${article(t.type)} ${t.type}${level(t)}.`;
    };
    const lines = [];
    for (const w of result.ways.slice(0, maxWays)) {
        if (w.kind === 'world') {
            const where = w.blocks.length ? ` (${w.blocks.slice(0, 4).map(label).join(', ')}${w.blocks.length > 4 ? ', ...' : ''})` : '';
            lines.push(`- ${w.summary}${where}${tool(w)}${w.confidence === 'inferred' ? ' [inferred]' : ''}`);
        } else if (w.kind === 'craft') {
            const ins = w.inputs.map((i) => `${i.count} ${i.ore ? `any ${i.ore} (e.g. ${label(i.choices[0])})` : label(i.choices[0])}`).join(' + ');
            lines.push(`- Craft ${ins} -> ${w.gives.count} ${label(w.gives)}${w.requiresTable ? ' (crafting table)' : ' (2x2 grid)'}.`);
        } else if (w.kind === 'smelt') {
            lines.push(`- Smelt ${label(w.input)} in a furnace.`);
        } else if (w.kind === 'block-drop') {
            lines.push(`- Break ${w.blocks.slice(0, 3).map((b) => b.name).join(', ')} (plain drop; may differ in game).`);
        }
    }
    const rest = result.ways.length - lines.length;
    return `${label(result.item)}:\n${lines.join('\n')}${rest > 0 ? `\n(${rest} more)` : ''}`;
}

