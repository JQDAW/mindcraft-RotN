// S1 (a) and (e), a survey before G3 (coord/STATUS-harness-ops.md, "G3 batches"): what lies within
// `radius` blocks of a fresh spawn in the world under test. Rock piles (G3's first material), trees,
// exposed stone, and containers a bot could loot tools from (lead, #101: there must be none near the
// cube). This is a survey, not a gate: its findings pick G3's world. The server still decides: sampled
// positions of every group are confirmed with testforblock.
//
// Steps
//   1. login_online, as in G2. The world seed is recorded.
//   2. After settleMs, the bot's position (tp NAME ~ ~ ~) is the spawn. No teleport: the survey is
//      about where a fresh player starts.
//   3. The census around the bot ("scenario-blocks TOKEN R N K", the G2 protocol), with N large enough
//      to list every non-air type. census_complete: the reply is complete, lists fewer than N types (so
//      it claims the whole cube), and at most maxUnloadedShare of the cube was unloaded.
//   4. findings_confirmed: up to confirmPerGroup candidates of each group (rocks, trees, containers)
//      are checked with testforblock; all must be found.
import crypto from 'node:crypto';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { awaitReply, ints, testforblockVerdict } from '../../runner/lib/g2.mjs';
import { classifyCensus } from '../../runner/lib/s1.mjs';

const MS = 1000;
const UNLOADED = '#unloaded';
const AIR = 'minecraft:air';

export default {
    id: 's1-site-survey',
    gate: 'S1',
    title: 'Rock piles, trees, stone and loot containers within the survey radius of a fresh spawn (a survey, not a gate)',
    checks: {
        login_online: 'The bot logs in with its own account (online mode)',
        census_complete: 'The census covers the whole cube around spawn (every non-air type listed, at most 1% unloaded)',
        findings_confirmed: 'Sampled rock, tree and container positions are confirmed by testforblock',
    },
    defaults: {
        bot: 'FRCFLD',
        radius: 48,
        topN: 400,                 // more than the cube's non-air types, so the census lists them all
        candidates: 2,
        confirmPerGroup: 5,
        maxUnloadedShare: 0.01,
        dataRoot: '',
        loginTimeoutMs: 240 * MS,
        settleMs: 20 * MS,
        replyTimeoutMs: 600 * MS,  // a radius-48 census is about 0.9 million positions and many chat pages
        pollMs: 3 * MS,
        logTail: 60000,
        consoleWaitS: 1,
    },
    gateParams: {},                // a survey: its findings are data for the lead, never a gate pass

    async run(ctx) {
        const { server, clock, params: p } = ctx;
        const name = p.bot;
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);
        const spawn = lastTeleport(server.console(`tp ${name} ~ ~ ~`, p.consoleWaitS), name);
        ctx.note('spawn', spawn);

        const token = crypto.randomBytes(6).toString('hex');
        server.console(`tell ${name} scenario-blocks ${token} ${p.radius} ${p.topN} ${p.candidates}`, 1);
        const rep = await awaitReply(ctx, s.sinceMarker, name, 'blocks', token, p.replyTimeoutMs);
        const entriesRaw = rep?.entries ?? [];
        const unl = entriesRaw.find((f) => f[0] === UNLOADED);
        const counts = unl ? ints(unl.slice(1, 4)) : null;   // [unloaded, total, air]
        const entries = entriesRaw.filter((f) => f[0] !== UNLOADED && f[0] !== AIR).map((f) => {
            const n = ints(f.slice(1, 3));
            return { name: f[0], meta: n?.[0], count: n?.[1], cand: f.slice(3).map((q) => ints(q.split(','))).filter((q) => q && q.length === 3) };
        });
        const cube = (2 * p.radius + 1) ** 3;
        const unloadedShare = counts && counts[1] === cube ? counts[0] / cube : null;
        ctx.note('census', { types: entries.length, topN: p.topN, cube, unloaded: counts?.[0] ?? null, air: counts?.[2] ?? null, unloadedShare });
        const complete = Boolean(rep?.complete) && unloadedShare !== null && unloadedShare <= p.maxUnloadedShare && entries.length < p.topN;
        ctx.check('census_complete', complete, !rep ? `no "blocks ${token}" reply within ${p.replyTimeoutMs / MS}s`
            : !rep.complete ? `reply incomplete: ${rep.entries.length} entries`
                : `${entries.length} non-air types (limit ${p.topN}), unloaded ${counts?.[0] ?? '?'} of ${cube}`);

        const groups = classifyCensus(entries);
        ctx.note('findings', Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { types: g.types, blocks: g.blocks }])));
        ctx.note('allTypes', entries.map((e) => `${e.name} ${e.meta} ${e.count}`));

        // The server confirms a sample of every group's positions.
        const checked = [];
        for (const [k, g] of Object.entries(groups)) {
            if (k === 'stone') continue;   // stone is the bulk of the cube; G2 already confirmed UB stone names
            for (const c of g.cand.slice(0, p.confirmPerGroup)) {
                const v = testforblockVerdict(server.console(`testforblock ${c.pos.join(' ')} ${c.name} ${c.meta}`, p.consoleWaitS), c.pos);
                checked.push({ group: k, pos: c.pos, name: c.name, meta: c.meta, ok: v.ok, detail: v.detail });
            }
        }
        ctx.note('confirmed', checked);
        const bad = checked.filter((c) => !c.ok);
        ctx.check('findings_confirmed', complete && bad.length === 0,
            `${checked.length - bad.length}/${checked.length} sampled positions confirmed`
            + ` (rocks ${groups.rocks.blocks}, trees ${groups.trees.blocks}, containers ${groups.containers.blocks} blocks)`
            + (bad.length ? `; not confirmed: ${bad.slice(0, 3).map((b) => `${b.pos.join(',')} ${b.name} ${b.meta}: ${b.detail}`).join('; ')}` : ''));
    },
};
