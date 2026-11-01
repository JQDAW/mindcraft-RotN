// G2 (docs/PLAN.md): "nearby mobs show RotN names". The console summons common mobs next to the bot
// (NoAI, invulnerable, tagged with the run id, removed at the end); the bot reports the entities it
// sees with their registry names; the server's testfor decides whether each name is right.
// The bot driver must follow test/runner/DRIVER.md (G2 section).
//
//   mobs_named:     every mob the server summoned is reported by the bot with exactly its registry
//                   name, within 3 blocks of where it was summoned.
//   mobs_confirmed: every entity the bot reports has a registry name (nothing unknown), and
//                   `testfor @e[type=NAME,x=,y=,z=,r=3]` finds it. Naturally spawned mobs count too.
// Default mobs: the vanilla eight common near spawn; all exist as minecraft:* in RotN 3.3.4's entity
// registry (rotn-data). packages/rotn-data/3.3.4/common-mobs.json replaces the list once the dump
// has spawn lists; `--param extraMobs=specialmobs:firecreeper,...` adds modded ones meanwhile.
import crypto from 'node:crypto';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { awaitReply, isRegistryName, prng, sample, summonVerdict, testforVerdict } from '../../runner/lib/g2.mjs';

const MS = 1000;
export const VANILLA_COMMON_MOBS = 'minecraft:zombie,minecraft:skeleton,minecraft:spider,minecraft:creeper,minecraft:cow,minecraft:pig,minecraft:sheep,minecraft:chicken';

export default {
    id: 'g2-mobs-named',
    gate: 'G2',
    title: 'Common mobs near the bot carry registry names the server confirms',
    checks: {
        login_online: 'Starting the service makes the bot log in with its own account',
        mobs_named: 'Nearby mobs show RotN names (each summoned mob, by its registry name)',
        mobs_confirmed: 'Nearby mobs show RotN names (no unknown names; the server confirms each)',
    },
    defaults: {
        bot: 'FRCFLD',
        mobs: VANILLA_COMMON_MOBS,
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
    gateParams: { bot: 'equal', mobs: 'equal', radius: 'min' },

    async run(ctx) {
        const { server, clock, params: p, runId } = ctx;
        const name = p.bot;
        const mobs = `${p.mobs},${p.extraMobs}`.split(',').map((m) => m.trim()).filter(Boolean);
        for (const m of mobs) if (!isRegistryName(m)) throw new Error(`mob '${m}' is not a registry name`);
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);
        const at = lastTeleport(server.console(`tp ${name} ~ ~ ~`, p.consoleWaitS), name);
        if (!at) throw new Error(`no position for ${name} from "tp ${name} ~ ~ ~"`);
        const tag = `rotnscn${runId.replace(/[^a-z0-9]/gi, '').slice(-12)}`;
        const rnd = prng(crypto.randomBytes(4).readUInt32LE(0));
        const turn = rnd() * 2 * Math.PI;
        try {
            // 1. summon on a ring around the bot, on block centres at its height
            const summoned = mobs.map((m, i) => {
                const a = turn + (i * 2 * Math.PI) / mobs.length;
                const pos = [Math.floor(at[0] + p.ring * Math.cos(a)) + 0.5, Math.floor(at[1]), Math.floor(at[2] + p.ring * Math.sin(a)) + 0.5];
                const v = summonVerdict(server.console(`summon ${m} ${pos.join(' ')} {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,Tags:["${tag}"]}`, p.consoleWaitS));
                return { name: m, pos, ok: v.ok, detail: v.detail };
            });
            ctx.note('summoned', summoned);
            await clock.sleep(p.seeMs);

            // 2. the bot reports what it sees
            const token = crypto.randomBytes(6).toString('hex');
            server.console(`tell ${name} scenario-entities ${token} ${p.radius}`, 1);
            const rep = await awaitReply(ctx, s.sinceMarker, name, 'entities', token, p.replyTimeoutMs);
            const seen = (rep?.entries ?? []).map((f) => {
                const xyz = f.slice(1, 4).map(Number);
                return { name: f[0], pos: xyz.every(Number.isFinite) && xyz.length === 3 ? xyz : null, raw: f.join(' ') };
            });
            ctx.note('seen', seen.map((e) => e.raw));

            // mobs_named
            const missing = summoned.map((m) => {
                if (!m.ok) return `${m.name}: the server could not summon it (${m.detail})`;
                const hit = seen.find((e) => e.name === m.name && e.pos && Math.hypot(e.pos[0] - m.pos[0], e.pos[1] - m.pos[1], e.pos[2] - m.pos[2]) <= 3);
                if (hit) return null;
                const near = seen.find((e) => e.pos && Math.hypot(e.pos[0] - m.pos[0], e.pos[2] - m.pos[2]) <= 1.5);
                return `${m.name} at ${m.pos.join(',')}: ${near ? `reported as "${near.name}"` : 'not reported'}`;
            }).filter(Boolean);
            ctx.check('mobs_named', rep?.complete && missing.length === 0, !rep ? `no "entities ${token}" reply within ${p.replyTimeoutMs / MS}s`
                : `${summoned.length - missing.length}/${summoned.length} summoned mobs reported by registry name${missing.length ? `; ${missing.slice(0, 5).join('; ')}` : ''}`);

            // mobs_confirmed
            const bad = [];
            for (const e of seen) {
                if (!isRegistryName(e.name) || !e.pos) { bad.push(`"${e.raw}": not a registry name and position`); continue; }
                const [x, y, z] = e.pos.map(Math.floor);
                const v = testforVerdict(server.console(`testfor @e[type=${e.name},x=${x},y=${y},z=${z},r=3]`, p.consoleWaitS));
                if (!v.ok) bad.push(`${e.raw}: ${v.detail}`);
            }
            ctx.note('notConfirmed', sample(bad));
            ctx.check('mobs_confirmed', rep?.complete && seen.length > 0 && bad.length === 0,
                `${seen.length - bad.length}/${seen.length} reported entities confirmed by testfor${bad.length ? `; first: ${bad[0]}` : ''}`);
        } finally {
            server.console(`kill @e[tag=${tag}]`, p.consoleWaitS);
        }
    },
};
