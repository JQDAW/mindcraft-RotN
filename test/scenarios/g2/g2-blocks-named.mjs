// G2 (docs/PLAN.md): "none of the 50 most common blocks near spawn shows as unknown", and the names
// are the right ones. The bot names blocks; the server's testforblock decides whether each name is
// the block really there. The bot driver must follow test/runner/DRIVER.md (G2 section).
//
// Steps
//   1. login_online, as in G1 (marker, driver start, a version-4 UUID).
//   2. After settleMs, `tp NAME ~ ~ ~` gives the bot's position.
//   3. The console whispers "scenario-blocks TOKEN R N". The bot reports the N most common block types
//      within R blocks (a cube around its position), each as "name meta count x y z" with one sample
//      position. blocks_named: at least minTypes (and at most N) entries, every name a full registry
//      name (nothing unknown), every sample position inside the cube.
//   4. blocks_confirmed: `testforblock x y z name meta` succeeds for every entry.
//   5. blocks_spotcheck: the runner picks spotChecks random positions in the cube (seeded, recorded),
//      whispers them in batches as "scenario-blockat TOKEN x,y,z ...", and the bot names each; every
//      answer must be a registry name that testforblock confirms. This is what stops a bot from
//      reporting only the blocks it knows: any block type covering more than about 7% of the cube is
//      hit with high probability by 40 random positions.
import crypto from 'node:crypto';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { awaitReply, isRegistryName, ints, prng, sample, testforblockVerdict } from '../../runner/lib/g2.mjs';

const MS = 1000;
const BATCH = 8;

export default {
    id: 'g2-blocks-named',
    gate: 'G2',
    title: 'The 50 most common blocks near spawn have registry names the server confirms',
    checks: {
        login_online: 'Starting the service makes the bot log in with its own account',
        blocks_named: 'Blocks show RotN names; none of the 50 most common blocks near spawn shows as unknown',
        blocks_confirmed: 'Blocks show RotN names (each name is the block the server has there)',
        blocks_spotcheck: 'Blocks show RotN names (at positions the runner picks)',
    },
    defaults: {
        bot: 'FRCFLD',
        radius: 16,
        topN: 50,
        minTypes: 10,
        spotChecks: 40,
        seed: 0,                   // 0 = random; the seed used is recorded in notes
        loginTimeoutMs: 240 * MS,
        settleMs: 20 * MS,         // chunks around spawn arrive after the join
        replyTimeoutMs: 180 * MS,
        pollMs: 3 * MS,
        logTail: 40000,
        consoleWaitS: 1,
    },
    gateParams: { bot: 'equal', radius: 'min', topN: 'min', minTypes: 'min', spotChecks: 'min' },

    async run(ctx) {
        const { server, clock, params: p } = ctx;
        const name = p.bot;
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);

        const at = lastTeleport(server.console(`tp ${name} ~ ~ ~`, p.consoleWaitS), name);
        if (!at) throw new Error(`no position for ${name} from "tp ${name} ~ ~ ~"`);
        const c = at.map(Math.floor);
        ctx.note('center', c);
        const inCube = ([x, y, z]) => Math.abs(x - c[0]) <= p.radius && Math.abs(y - c[1]) <= p.radius && Math.abs(z - c[2]) <= p.radius;

        // 3. the bot's top N
        const token = crypto.randomBytes(6).toString('hex');
        server.console(`tell ${name} scenario-blocks ${token} ${p.radius} ${p.topN}`, 1);
        const rep = await awaitReply(ctx, s.sinceMarker, name, 'blocks', token, p.replyTimeoutMs);
        const entries = (rep?.entries ?? []).map((f) => {
            const n = ints(f.slice(1, 6));
            return { name: f[0], meta: n?.[0], count: n?.[1], pos: n ? n.slice(2, 5) : null, raw: f.join(' ') };
        });
        const malformed = entries.filter((e) => e.pos === null || e.meta < 0 || e.meta > 15);
        const unknown = entries.filter((e) => !isRegistryName(e.name));
        const outside = entries.filter((e) => e.pos && !inCube(e.pos));
        ctx.note('blocks', entries.map(({ raw }) => raw));
        const namedOk = rep?.complete && entries.length >= p.minTypes && entries.length <= p.topN
            && !malformed.length && !unknown.length && !outside.length;
        ctx.check('blocks_named', namedOk, !rep ? `no "blocks ${token}" reply within ${p.replyTimeoutMs / MS}s`
            : !rep.complete ? `reply incomplete: ${rep.entries.length} entries, pages missing of ${rep.total}`
                : `${entries.length} block types (need ${p.minTypes}..${p.topN}); unknown: ${JSON.stringify(unknown.map((e) => e.name))}`
                + `; malformed: ${malformed.length}; outside the ${p.radius}-block cube: ${outside.length}`);

        // 4. the server confirms each name at its sample position
        const wrong = [];
        for (const e of entries.filter((x) => x.pos && isRegistryName(x.name))) {
            const v = testforblockVerdict(server.console(`testforblock ${e.pos.join(' ')} ${e.name} ${e.meta}`, p.consoleWaitS), e.pos);
            if (!v.ok) wrong.push(`${e.raw}: ${v.detail}`);
        }
        ctx.note('blocksWrong', sample(wrong));
        const checked = entries.filter((x) => x.pos && isRegistryName(x.name)).length;
        ctx.check('blocks_confirmed', namedOk && wrong.length === 0,
            `${checked - wrong.length}/${checked} confirmed by testforblock${wrong.length ? `; first: ${wrong[0]}` : ''}${namedOk ? '' : ' (blocks_named failed)'}`);

        // 5. spot checks at positions the runner picks
        const seed = p.seed || crypto.randomBytes(4).readUInt32LE(0);
        ctx.note('spotSeed', seed);
        const rnd = prng(seed);
        const r = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
        const spots = Array.from({ length: p.spotChecks }, () => [r(c[0] - p.radius, c[0] + p.radius),
            Math.min(254, Math.max(1, r(c[1] - p.radius, c[1] + p.radius))), r(c[2] - p.radius, c[2] + p.radius)]);
        const spotFail = [];
        for (let i = 0; i < spots.length; i += BATCH) {
            const batch = spots.slice(i, i + BATCH);
            const t = crypto.randomBytes(6).toString('hex');
            server.console(`tell ${name} scenario-blockat ${t} ${batch.map((q) => q.join(',')).join(' ')}`, 1);
            const ans = await awaitReply(ctx, s.sinceMarker, name, 'blockat', t, p.replyTimeoutMs);
            const byPos = new Map((ans?.entries ?? []).map((f) => [f.slice(0, 3).join(','), f]));
            for (const q of batch) {
                const f = byPos.get(q.join(','));
                const meta = f ? ints([f[4]])?.[0] : undefined;
                if (!f) spotFail.push(`${q.join(',')}: no answer`);
                else if (!isRegistryName(f[3]) || meta === undefined) spotFail.push(`${q.join(',')}: "${f.slice(3).join(' ')}" is not a registry name and meta`);
                else {
                    const v = testforblockVerdict(server.console(`testforblock ${q.join(' ')} ${f[3]} ${meta}`, p.consoleWaitS), q);
                    if (!v.ok) spotFail.push(`${q.join(',')} ${f[3]} ${meta}: ${v.detail}`);
                }
            }
        }
        ctx.note('spotFailures', sample(spotFail));
        ctx.check('blocks_spotcheck', spotFail.length === 0,
            `${spots.length - spotFail.length}/${spots.length} random positions named and confirmed (seed ${seed})${spotFail.length ? `; first: ${spotFail[0]}` : ''}`);
    },
};
