// G2 (docs/PLAN.md): "none of the 50 most common blocks near spawn shows as unknown", and the names
// are the right ones. The bot names blocks; the server's testforblock decides whether each name is
// the block really there. The bot driver must follow test/runner/DRIVER.md (G2 section).
//
// Steps
//   1. login_online, as in G1. The world seed (`seed`) and the cube centre are recorded in notes; no seed,
//      or an agent naming path not yet wired to rotn-data (mcdata.js), makes the run not a gate run.
//   2. After settleMs, `tp NAME ~ ~ ~` gives the bot's position: the centre of the cube.
//   3. The console whispers "scenario-blocks TOKEN R N K". The bot reports its census of the N most
//      common NON-AIR block types in the cube (radius R): "name meta count x,y,z ..." with up to K
//      candidate positions per type, drawn uniformly from all blocks of that type.
//      blocks_named: minTypes..N non-air entries, every name a full registry name (nothing unknown),
//      min(count, K) distinct candidates per type, all inside the cube.
//   4. blocks_confirmed: for every type the RUNNER picks samplesPerType of the candidates at random and
//      `testforblock x y z name meta` must succeed at each. A type that merges two different blocks
//      under one name fails here (PR #36 review finding 2).
//   5. blocks_spotcheck: the runner picks random positions in the cube (seeded, recorded) and asks the
//      bot to name each, until spotChecks NON-AIR answers are confirmed by testforblock (air answers
//      are checked too but do not count). Every answer must be right. Then the spot checks are weighed
//      against the census: a type hit at least absentHits times but missing from the census, or whose
//      spot share differs from its census share by more than maxShareGap, fails (the census misreports).
//   Unloaded positions (no chunk at the bot after it waited for the cube) are never a block type: the
//   census reports them as "#unloaded U T" and spot answers as "#unloaded"; notes.unloaded records both,
//   and above maxUnloadedShare (1%) the run is not a gate run.
import crypto from 'node:crypto';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { awaitReply, isRegistryName, ints, prng, sample, testforblockVerdict } from '../../runner/lib/g2.mjs';

const MS = 1000;
const BATCH = 8;
const AIR = 'minecraft:air';
const UNLOADED = '#unloaded';   // scenario-protocol.mjs: a position without a loaded chunk

export default {
    id: 'g2-blocks-named',
    gate: 'G2',
    title: 'The 50 most common blocks near spawn have registry names the server confirms',
    checks: {
        login_online: 'Starting the service makes the bot log in with its own account',
        blocks_named: 'Blocks show RotN names; none of the 50 most common blocks near spawn shows as unknown',
        blocks_confirmed: 'Blocks show RotN names (each name is the block the server has there)',
        blocks_spotcheck: 'Blocks show RotN names (at positions the runner picks, consistent with the census)',
    },
    defaults: {
        bot: 'FRCFLD',
        radius: 16,
        topN: 50,
        minTypes: 10,              // non-air types
        candidates: 8,             // K: candidate positions the bot reports per type
        samplesPerType: 3,         // how many of them the runner checks
        spotChecks: 40,            // confirmed non-air answers needed
        spotMaxPositions: 400,     // give up after this many random positions
        absentHits: 4,             // a type hit this often in spot checks must be in the census
        maxShareGap: 0.25,         // |spot share - census share| allowed per type
        maxUnloadedShare: 0.01,    // above this share of unloaded positions (census or spot) the run is not a gate run
        seed: 0,                   // 0 = random; the seed used is recorded in notes
        dataRoot: '',              // '' = this repo (its mcdata.js wiring decides gate validity); tests use fixtures
        loginTimeoutMs: 240 * MS,
        settleMs: 20 * MS,         // chunks around spawn arrive after the join
        replyTimeoutMs: 180 * MS,
        pollMs: 3 * MS,
        logTail: 40000,
        consoleWaitS: 1,
    },
    gateParams: {
        bot: 'equal', radius: 'min', topN: 'min', minTypes: 'min', candidates: 'min', samplesPerType: 'min',
        spotChecks: 'min', absentHits: 'equal', maxShareGap: 'equal', maxUnloadedShare: 'equal', dataRoot: 'equal',
    },

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
        ctx.note('cube', { center: c, radius: p.radius });
        const inCube = ([x, y, z]) => Math.abs(x - c[0]) <= p.radius && Math.abs(y - c[1]) <= p.radius && Math.abs(z - c[2]) <= p.radius;
        const seed = p.seed || crypto.randomBytes(4).readUInt32LE(0);
        ctx.note('spotSeed', seed);
        const rnd = prng(seed);
        const pick = (arr, n) => {
            const a = arr.slice();
            for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
            return a.slice(0, n);
        };

        // 3. the bot's census
        const token = crypto.randomBytes(6).toString('hex');
        server.console(`tell ${name} scenario-blocks ${token} ${p.radius} ${p.topN} ${p.candidates}`, 1);
        const rep = await awaitReply(ctx, s.sinceMarker, name, 'blocks', token, p.replyTimeoutMs);
        // The "#unloaded U T" entry: positions without a loaded chunk, counted apart (never a block type).
        const unl = (rep?.entries ?? []).find((f) => f[0] === UNLOADED);
        const unloaded = unl ? ints(unl.slice(1, 3)) : null;
        const all = (rep?.entries ?? []).filter((f) => f[0] !== UNLOADED).map((f) => {
            const n = ints(f.slice(1, 3));
            const cand = f.slice(3).map((q) => ints(q.split(',')));
            return { name: f[0], meta: n?.[0], count: n?.[1], cand, raw: `${f[0]} ${f[1]} ${f[2]} (${f.length - 3} candidates)` };
        });
        const entries = all.filter((e) => e.name !== AIR);
        const bad = [];
        const cubeSize = (2 * p.radius + 1) ** 3;
        if (rep?.complete && (!unloaded || unloaded[1] !== cubeSize || unloaded[0] < 0 || unloaded[0] > cubeSize)) {
            bad.push(`no valid "${UNLOADED} U ${cubeSize}" entry (unloaded positions out of the cube's ${cubeSize})`);
        }
        const censusUnloaded = unloaded && unloaded[1] === cubeSize ? unloaded[0] : null;
        for (const e of entries) {
            if (!isRegistryName(e.name)) bad.push(`unknown name "${e.name}"`);
            else if (e.meta === undefined || e.meta < 0 || e.meta > 15 || !(e.count >= 1)) bad.push(`${e.raw}: malformed`);
            else if (e.cand.some((q) => !q || q.length !== 3)) bad.push(`${e.raw}: malformed position`);
            else if (e.cand.some((q) => !inCube(q))) bad.push(`${e.raw}: a candidate outside the ${p.radius}-block cube`);
            else if (new Set(e.cand.map((q) => q.join(','))).size !== e.cand.length) bad.push(`${e.raw}: duplicate candidates`);
            else if (e.cand.length !== Math.min(e.count, p.candidates)) bad.push(`${e.raw}: ${e.cand.length} candidates, want ${Math.min(e.count, p.candidates)}`);
        }
        ctx.note('census', entries.map((e) => `${e.name} ${e.meta} ${e.count}`));
        const namedOk = Boolean(rep?.complete) && entries.length >= p.minTypes && entries.length <= p.topN && bad.length === 0;
        ctx.check('blocks_named', namedOk, !rep ? `no "blocks ${token}" reply within ${p.replyTimeoutMs / MS}s`
            : !rep.complete ? `reply incomplete: ${rep.entries.length} entries, pages missing of ${rep.total}`
                : `${entries.length} non-air block types (need ${p.minTypes}..${p.topN})${all.length > entries.length ? '; air left out' : ''}`
                + `${bad.length ? `; ${bad.length} problem(s): ${bad.slice(0, 4).join('; ')}` : ''}`);

        // 4. the runner picks samples per type; the server confirms each
        const wrong = [];
        let checked = 0;
        for (const e of entries.filter((x) => isRegistryName(x.name) && x.cand.every((q) => q && q.length === 3))) {
            for (const q of pick(e.cand, p.samplesPerType)) {
                checked++;
                const v = testforblockVerdict(server.console(`testforblock ${q.join(' ')} ${e.name} ${e.meta}`, p.consoleWaitS), q);
                if (!v.ok) wrong.push(`${e.name} ${e.meta} at ${q.join(',')}: ${v.detail}`);
            }
        }
        ctx.note('blocksWrong', sample(wrong));
        ctx.check('blocks_confirmed', namedOk && checked > 0 && wrong.length === 0,
            `${checked - wrong.length}/${checked} runner-picked samples (${p.samplesPerType} per type) confirmed by testforblock`
            + `${wrong.length ? `; first: ${wrong[0]}` : ''}${namedOk ? '' : ' (blocks_named failed)'}`);

        // 5. spot checks until spotChecks non-air answers are confirmed, weighed against the census
        const r = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
        const spotFail = [];
        const hits = new Map();
        let nonAir = 0;
        let asked = 0;
        let spotUnloaded = 0;
        while (nonAir < p.spotChecks && asked < p.spotMaxPositions && spotFail.length < 10) {
            const batch = Array.from({ length: BATCH }, () => [r(c[0] - p.radius, c[0] + p.radius),
                Math.min(254, Math.max(1, r(c[1] - p.radius, c[1] + p.radius))), r(c[2] - p.radius, c[2] + p.radius)]);
            asked += batch.length;
            const t = crypto.randomBytes(6).toString('hex');
            server.console(`tell ${name} scenario-blockat ${t} ${batch.map((q) => q.join(',')).join(' ')}`, 1);
            const ans = await awaitReply(ctx, s.sinceMarker, name, 'blockat', t, p.replyTimeoutMs);
            const byPos = new Map((ans?.entries ?? []).map((f) => [f.slice(0, 3).join(','), f]));
            for (const q of batch) {
                const f = byPos.get(q.join(','));
                const meta = f ? ints([f[4]])?.[0] : undefined;
                if (!f) { spotFail.push(`${q.join(',')}: no answer`); continue; }
                if (f[3] === UNLOADED) { spotUnloaded++; continue; }   // counted apart; capped by maxUnloadedShare
                if (!isRegistryName(f[3]) || meta === undefined) { spotFail.push(`${q.join(',')}: "${f.slice(3).join(' ')}" is not a registry name and meta`); continue; }
                const v = testforblockVerdict(server.console(`testforblock ${q.join(' ')} ${f[3]} ${meta}`, p.consoleWaitS), q);
                if (!v.ok) { spotFail.push(`${q.join(',')} ${f[3]} ${meta}: ${v.detail}`); continue; }
                if (f[3] !== AIR) { nonAir++; hits.set(`${f[3]} ${meta}`, (hits.get(`${f[3]} ${meta}`) ?? 0) + 1); }
            }
        }
        // Weigh: shares of confirmed non-air spot answers against the census shares.
        const censusTotal = entries.reduce((a, e) => a + (e.count || 0), 0);
        const census = new Map(entries.map((e) => [`${e.name} ${e.meta}`, (e.count || 0) / (censusTotal || 1)]));
        const skew = [];
        for (const [k, n] of hits) {
            const q = n / Math.max(1, nonAir);
            if (!census.has(k) && n >= p.absentHits) skew.push(`${k}: ${n} spot hits but not in the census`);
            else if (census.has(k) && Math.abs(q - census.get(k)) > p.maxShareGap) skew.push(`${k}: spot share ${q.toFixed(2)}, census share ${census.get(k).toFixed(2)}`);
        }
        for (const [k, share] of census) {
            if (!hits.has(k) && share > p.maxShareGap) skew.push(`${k}: census share ${share.toFixed(2)} but no spot hit`);
        }
        ctx.note('spotDistribution', Object.fromEntries([...hits.entries()].sort((a, b) => b[1] - a[1])));
        ctx.note('spotFailures', sample(spotFail));
        ctx.note('spotSkew', skew);
        // Unloaded positions, in the census and in the spot answers. Above maxUnloadedShare the run is not a
        // gate run: the evidence would not cover the cube, and "unloaded" is the one answer the server
        // cannot check, so this share also caps what a bot could hide behind it.
        const unloadedNote = {
            census: censusUnloaded, cube: cubeSize, censusShare: censusUnloaded === null ? null : censusUnloaded / cubeSize,
            spot: spotUnloaded, spotAsked: asked, spotShare: asked ? spotUnloaded / asked : 0, maxShare: p.maxUnloadedShare,
        };
        ctx.note('unloaded', unloadedNote);
        if (unloadedNote.censusShare !== null && unloadedNote.censusShare > p.maxUnloadedShare) {
            ctx.notGate(`${(100 * unloadedNote.censusShare).toFixed(1)}% of the cube was unloaded in the census (max ${100 * p.maxUnloadedShare}%)`);
        }
        if (unloadedNote.spotShare > p.maxUnloadedShare) {
            ctx.notGate(`${spotUnloaded} of ${asked} spot positions were unloaded (max ${100 * p.maxUnloadedShare}%)`);
        }
        const spotOk = spotFail.length === 0 && nonAir >= p.spotChecks && skew.length === 0;
        ctx.check('blocks_spotcheck', spotOk,
            `${nonAir} confirmed non-air answers of ${p.spotChecks} needed (${asked} positions asked, ${spotUnloaded} unloaded, seed ${seed})`
            + `${spotFail.length ? `; wrong: ${spotFail[0]}` : ''}${skew.length ? `; census inconsistent: ${skew.slice(0, 3).join('; ')}` : ''}`);
    },
};
