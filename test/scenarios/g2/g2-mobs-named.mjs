// G2 (docs/PLAN.md): "nearby mobs show RotN names". The console summons common mobs next to the bot
// (NoAI, invulnerable, tagged with the run id, removed at the end); the bot reports the entities it
// sees with their registry names; the server decides whether each name is right.
// The bot driver must follow test/runner/DRIVER.md (G2 section).
//
// Lead decisions after G2 batch 1 (comment on PR #65):
//   - A mob the server refuses to summon (Animania replaces vanilla animals), or one the server no
//     longer has right before the bot is asked (charm:spectre in daylight), is replaced by the next
//     mob in rank from common-mobs.json and recorded in notes.replaced. More than maxReplaced (3)
//     replacements in total, a slot left empty, or no modded mob among the summoned mobs makes the run
//     not a gate run.
//   - mobs_named: every summoned mob the server still has is reported by the bot with exactly its
//     registry name, within 3 blocks of where it was summoned; AND no entity the bot reports (tagged or
//     not) has a placeholder name (`<mod>:entity_N`, `unknown`, null).
//   - mobs_confirmed: for each summoned mob the bot reported, `testfor @e[tag=<run tag>,type=NAME,
//     x=,y=,z=,r=3]` at the bot's reported position finds it. Other (natural) entities go to
//     notes.otherSeen and are not judged by the server.
// The mob list comes from DATA (PR #36 review finding 1): rotn-data's
// packages/rotn-data/3.3.4/common-mobs.json ({mobs: [{name: "ns:path", ...}]}, overworld spawn lists
// ranked by spawn weight, from the dump), the first maxMobs of it; the rest, in rank order, are the
// replacements. It must contain at least one modded (non-minecraft) mob. Until that file exists the
// scenario falls back to a vanilla list and the run is NOT gate-valid; a hand-given `mobs` list is never
// gate-valid either. `extraMobs` adds mobs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { awaitReply, isRegistryName, prng, summonVerdict, testforVerdict } from '../../runner/lib/g2.mjs';

const MS = 1000;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const COMMON_MOBS_FILE = 'packages/rotn-data/3.3.4/common-mobs.json';

/** Names from common-mobs.json: {mobs: [{name}]}, or an array of names or {name} objects. null if unreadable. */
export function readCommonMobs(file) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.mobs) ? data.mobs : null;
    if (!list) return null;
    return list.map((m) => (typeof m === 'string' ? m : m?.name)).filter((n) => typeof n === 'string');
}

/**
 * The mobs to summon, the replacements in rank order, and why the run cannot be a gate run (null if it can).
 * {mobs, spare, source, notGate}
 */
export function chooseMobs(p, repo = REPO) {
    const extra = p.extraMobs.split(',').map((m) => m.trim()).filter(Boolean);
    if (p.mobs) {
        return { mobs: [...p.mobs.split(',').map((m) => m.trim()).filter(Boolean), ...extra], spare: [], source: 'the mobs parameter',
            notGate: 'the mob list was given by hand (--param mobs), not read from rotn-data\'s common-mobs.json' };
    }
    const fromData = readCommonMobs(path.resolve(repo, p.mobsFile));
    if (!fromData || fromData.length === 0) {
        return { mobs: [...VANILLA_COMMON_MOBS.split(','), ...extra], spare: [], source: 'the vanilla fallback',
            notGate: `${p.mobsFile} is not available yet (rotn-data, after the first dump): fell back to the vanilla list` };
    }
    const mobs = [...fromData.slice(0, p.maxMobs), ...extra];
    const spare = fromData.slice(p.maxMobs).filter((m) => !mobs.includes(m));
    const modded = mobs.filter((m) => !m.startsWith('minecraft:'));
    return { mobs, spare, source: p.mobsFile, notGate: modded.length ? null : `${p.mobsFile} lists no modded mob in its first ${p.maxMobs}` };
}

// Hostile vanilla mobs only: on RotN 3.3.4 Animania replaces the vanilla chicken, cow, pig, rabbit and
// sheep (config/animania.cfg replaceVanilla*=true; rotn-data PR #62), so the server refuses to summon them.
export const VANILLA_COMMON_MOBS = 'minecraft:zombie,minecraft:skeleton,minecraft:spider,minecraft:creeper';

/** A name that is not a real registry name: null, "unknown", or forge-bridge's `<mod>:entity_N` placeholder. */
export const isPlaceholderEntity = (n) => !isRegistryName(n) || /(^|:)entity_\d+$/.test(n);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export default {
    id: 'g2-mobs-named',
    gate: 'G2',
    title: 'Common mobs near the bot carry registry names the server confirms',
    checks: {
        login_online: 'Starting the service makes the bot log in with its own account',
        mobs_named: 'Nearby mobs show RotN names (each summoned mob, by its registry name; no placeholder names)',
        mobs_confirmed: 'Nearby mobs show RotN names (the server confirms each summoned mob the bot reported)',
    },
    defaults: {
        bot: 'FRCFLD',
        mobs: '',                  // '' = from mobsFile (gate); a list here is a smoke run
        mobsFile: COMMON_MOBS_FILE,
        dataRoot: '',              // '' = this repo; tests point it at fixture data (never a gate run)
        maxMobs: 12,
        maxReplaced: 3,            // refused + vanished mobs replaced from the list; above this, not a gate run
        verifyRounds: 4,           // rounds of "does the server still have every summoned mob?" before asking the bot
        extraMobs: '',
        radius: 12,
        ring: 4,                   // summon distance from the bot
        loginTimeoutMs: 240 * MS,
        settleMs: 20 * MS,
        seeMs: 10 * MS,            // time for the spawn packets to reach the bot
        replyTimeoutMs: 120 * MS,
        pollMs: 3 * MS,
        logTail: 40000,
        consoleWaitS: 1,
    },
    gateParams: { bot: 'equal', mobs: 'equal', mobsFile: 'equal', dataRoot: 'equal', maxMobs: 'min', maxReplaced: 'equal', radius: 'min' },

    async run(ctx) {
        const { server, clock, params: p, runId } = ctx;
        const name = p.bot;
        const chosen = chooseMobs(p, p.dataRoot || REPO);
        const mobs = [...new Set(chosen.mobs)];
        const spare = chosen.spare.filter((m) => !mobs.includes(m));
        for (const m of [...mobs, ...spare]) if (!isRegistryName(m)) throw new Error(`mob '${m}' is not a registry name`);
        ctx.note('mobSource', chosen.source);
        if (chosen.notGate) ctx.notGate(chosen.notGate);
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);
        const at = lastTeleport(server.console(`tp ${name} ~ ~ ~`, p.consoleWaitS), name);
        if (!at) throw new Error(`no position for ${name} from "tp ${name} ~ ~ ~"`);
        const tag = `rotnscn${runId.replace(/[^a-z0-9]/gi, '').slice(-12)}`;
        const rnd = prng(crypto.randomBytes(4).readUInt32LE(0));
        const turn = rnd() * 2 * Math.PI;
        const slotPos = (i) => {
            const a = turn + (i * 2 * Math.PI) / mobs.length;
            return [Math.floor(at[0] + p.ring * Math.cos(a)) + 0.5, Math.floor(at[1]), Math.floor(at[2] + p.ring * Math.sin(a)) + 0.5];
        };
        const replaced = [];   // {name, reason}: every mob the server refused or lost, in order
        const present = [];    // {slot, name, pos, checked}: summoned mobs the server has
        // Summon `first` into slot i; on a refusal, the next spare mob, until one is summoned or none is left.
        const fill = (i, first) => {
            for (let m = first; m; m = spare.shift()) {
                const pos = slotPos(i);
                const v = summonVerdict(server.console(`summon ${m} ${pos.join(' ')} {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,Tags:["${tag}"]}`, p.consoleWaitS));
                if (v.ok) return { slot: i, name: m, pos, checked: false };
                replaced.push({ name: m, reason: `refused: ${v.detail}` });
            }
            return null;
        };
        const stillThere = (m, pos) => testforVerdict(server.console(
            `testfor @e[tag=${tag},type=${m},x=${Math.floor(pos[0])},y=${Math.floor(pos[1])},z=${Math.floor(pos[2])},r=3]`, p.consoleWaitS)).ok;
        try {
            // 1. summon on a ring around the bot, on block centres at its height
            for (let i = 0; i < mobs.length; i++) {
                const m = fill(i, mobs[i]);
                if (m) present.push(m);
            }
            // 2. Right before asking the bot, the server must still have every summoned mob. One it lost is
            //    replaced, and the next round waits for and checks the new one (and all the others) again.
            let settled = false;
            for (let round = 0; round < p.verifyRounds && !settled; round++) {
                await clock.sleep(p.seeMs);
                settled = true;
                for (const m of present.slice()) {
                    if (stillThere(m.name, m.pos)) { m.checked = true; continue; }
                    present.splice(present.indexOf(m), 1);
                    replaced.push({ name: m.name, reason: 'vanished: the server no longer had it before the bot was asked' });
                    const r = fill(m.slot, spare.shift());
                    if (r) present.push(r);
                    settled = false;
                }
            }
            present.sort((a, b) => a.slot - b.slot);
            ctx.note('summoned', present.map((m) => ({ name: m.name, pos: m.pos })));
            ctx.note('replaced', replaced);
            if (replaced.length > p.maxReplaced) {
                ctx.notGate(`${replaced.length} of ${mobs.length} mobs had to be replaced (refused or vanished; max ${p.maxReplaced})`);
            }
            if (present.length < mobs.length || !settled) {
                ctx.notGate(`only ${present.filter((m) => m.checked).length} of ${mobs.length} summoned mobs were confirmed on the server before the bot was asked`);
            }
            if (!present.some((m) => !m.name.startsWith('minecraft:'))) ctx.notGate('no modded mob among the summoned mobs the server still had');

            // 3. the bot reports what it sees
            const token = crypto.randomBytes(6).toString('hex');
            server.console(`tell ${name} scenario-entities ${token} ${p.radius}`, 1);
            const rep = await awaitReply(ctx, s.sinceMarker, name, 'entities', token, p.replyTimeoutMs);
            const seen = (rep?.entries ?? []).map((f) => {
                const xyz = f.slice(1, 4).map(Number);
                return { name: f[0], pos: xyz.every(Number.isFinite) && xyz.length === 3 ? xyz : null, raw: f.join(' ') };
            });
            ctx.note('seen', seen.map((e) => e.raw));

            // mobs_named: every summoned mob by its exact name near its spot; no placeholder name anywhere
            const hits = new Map();
            const missing = present.map((m) => {
                const hit = seen.find((e) => e.name === m.name && e.pos && dist(e.pos, m.pos) <= 3);
                if (hit) { hits.set(m, hit); return null; }
                const near = seen.find((e) => e.pos && Math.hypot(e.pos[0] - m.pos[0], e.pos[2] - m.pos[2]) <= 1.5);
                return `${m.name} at ${m.pos.join(',')}: ${near ? `reported as "${near.name}"` : 'not reported'}`;
            }).filter(Boolean);
            const placeholders = seen.filter((e) => isPlaceholderEntity(e.name)).map((e) => `"${e.raw}": a placeholder, not a registry name`);
            const namedProblems = [...missing, ...placeholders];
            ctx.check('mobs_named', Boolean(rep?.complete) && present.length > 0 && namedProblems.length === 0,
                !rep ? `no "entities ${token}" reply within ${p.replyTimeoutMs / MS}s`
                    : `${present.length - missing.length}/${present.length} summoned mobs reported by registry name`
                    + `${replaced.length ? ` (${replaced.length} replaced)` : ''}${placeholders.length ? `; ${placeholders.length} placeholder name(s)` : ''}`
                    + `${namedProblems.length ? `; ${namedProblems.slice(0, 5).join('; ')}` : ''}`);

            // mobs_confirmed: the server finds each reported summon (by run tag) where the bot said it is
            const bad = [];
            for (const [m, e] of hits) {
                if (!stillThere(m.name, e.pos)) bad.push(`${e.raw}: the server found no ${m.name} with the run tag within 3 blocks`);
            }
            const matched = new Set(hits.values());
            ctx.note('otherSeen', seen.filter((e) => !matched.has(e)).map((e) => e.raw));
            ctx.note('notConfirmed', bad);
            ctx.check('mobs_confirmed', Boolean(rep?.complete) && hits.size > 0 && bad.length === 0,
                `${hits.size - bad.length}/${hits.size} reported summons confirmed by testfor (run tag)${bad.length ? `; first: ${bad[0]}` : ''}`);
        } finally {
            server.console(`kill @e[tag=${tag}]`, p.consoleWaitS);
        }
    },
};
