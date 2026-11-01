// Parsers for a Forge 1.12.2 dedicated-server log (logs/latest.log). Pure functions, no I/O.
//
// The formats are vanilla 1.12.2 server messages as Forge logs them, e.g.
//   [12:00:01] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player FRCFLD is 0a1b...
//   [12:00:02] [Server thread/INFO] [net.minecraft.server.management.PlayerList]: FRCFLD[/203.0.113.7:51234] logged in with entity id 312 at (1.5, 64.0, -3.5)
//   [12:00:02] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: FRCFLD joined the game
//   [12:00:09] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <FRCFLD> hello
//   [12:00:30] [Server thread/INFO] [net.minecraft.network.NetHandlerPlayServer]: FRCFLD lost connection: Timed out
//   [12:00:30] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: FRCFLD left the game
//   [12:00:40] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Teleported FRCFLD to 1.5, 64.0, -3.5
//   [12:00:41] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: There are 1/10 players online:
// They are matched on the message text after "]: ", so the logger names may differ. The first real
// G1 run confirms them on RotN 3.3.4 (some chat mods reformat chat lines; see chatLines).

/** Split a log line into {time, thread, level, logger, msg}; null for continuation lines. */
export function parseLine(line) {
    const m = /^\[(\d\d:\d\d:\d\d)\] \[([^\]]*)\/([A-Z]+)\](?: \[([^\]]*)\])?: (.*)$/.exec(line.replace(/\r$/, ''));
    return m ? { time: m[1], thread: m[2], level: m[3], logger: m[4] ?? '', msg: m[5] } : null;
}

/**
 * Log lines after the first line that contains marker, or null when the marker is not in `lines`
 * (e.g. it scrolled out of the fetched tail). Callers must treat null as an error: an empty result
 * would hide every disconnect (PR #9 review finding 3).
 */
export function linesAfter(lines, marker) {
    const i = lines.findIndex((l) => l.includes(marker));
    return i < 0 ? null : lines.slice(i + 1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const msgs = (lines) => lines.map(parseLine).filter(Boolean);

/**
 * "UUID of player NAME is UUID". Vanilla 1.12.2 logs this only in online mode, after Mojang's session
 * server confirmed the player; the version-4 check in uuidVersion is a second, independent proof.
 */
export function loginUuid(lines, name) {
    const re = new RegExp(`^UUID of player ${esc(name)} is ([0-9a-fA-F-]{32,36})$`);
    for (const p of msgs(lines)) {
        const m = re.exec(p.msg);
        if (m) return m[1].toLowerCase();
    }
    return null;
}

/**
 * Version nibble of a UUID. Mojang accounts are version 4; an offline-mode server derives version 3
 * UUIDs from the name (it would also not log the line above).
 */
export function uuidVersion(uuid) {
    const hex = (uuid ?? '').replace(/-/g, '');
    return /^[0-9a-f]{32}$/i.test(hex) ? parseInt(hex[12], 16) : null;
}

/** Events for one player, in log order: {type: joined|left|lost|kicked|chat|teleported, time, ...}. */
export function playerEvents(lines, name) {
    const n = esc(name);
    const rules = [
        [new RegExp(`^${n}\\[/[^\\]]*\\] logged in with entity id (\\d+) at \\((-?[\\d.]+), (-?[\\d.]+), (-?[\\d.]+)\\)$`),
            (m) => ({ type: 'logged_in', entityId: Number(m[1]), pos: [Number(m[2]), Number(m[3]), Number(m[4])] })],
        [new RegExp(`^${n} joined the game$`), () => ({ type: 'joined' })],
        [new RegExp(`^${n} left the game$`), () => ({ type: 'left' })],
        [new RegExp(`^${n} lost connection: (.*)$`), (m) => ({ type: 'lost', reason: m[1] })],
        // Login-stage kicks: "Disconnecting NAME (/ip:port): reason" or, before the profile is
        // complete, "Disconnecting com.mojang.authlib.GameProfile@..[id=..,name=NAME,..] (/ip:port): reason".
        [new RegExp(`^Disconnecting (?:${n} |com\\.mojang\\.authlib\\.GameProfile@\\w+\\[[^\\]]*\\bname=${n},[^\\]]*\\] )\\([^)]*\\): (.*)$`),
            (m) => ({ type: 'kicked', reason: m[1] })],
        [new RegExp(`^Teleported ${n} to (-?[\\d.]+), (-?[\\d.]+), (-?[\\d.]+)$`),
            (m) => ({ type: 'teleported', pos: [Number(m[1]), Number(m[2]), Number(m[3])] })],
    ];
    const out = [];
    lines.forEach((line, at) => {
        const p = parseLine(line);
        if (!p) return;
        for (const [re, make] of rules) {
            const m = re.exec(p.msg);
            if (m) {
                out.push({ at, time: p.time, ...make(m) });
                return;
            }
        }
    });
    for (const c of chatLines(lines, name)) out.push({ at: c.at, time: c.time, type: 'chat', text: c.text });
    return out.sort((a, b) => a.at - b.at);
}

/**
 * Chat lines said by NAME: vanilla "<NAME> text", anchored at the start of the message. One bracketed
 * chat-mod prefix is tolerated ("[G] <NAME> text"), but never "[Server] <NAME> ..." (the console can
 * `say` anything) and never another player's line that quotes "<NAME>" (PR #9 review finding 2).
 */
export function chatLines(lines, name) {
    const re = new RegExp(`^(?:\\[([^\\]<>]*)\\] )?<${esc(name)}> (.*)$`);
    const out = [];
    lines.forEach((line, at) => {
        const p = parseLine(line);
        if (!p) return;
        const m = re.exec(p.msg);
        if (m && m[1] !== 'Server') out.push({ time: p.time, text: m[2], at });
    });
    return out;
}

/** Names from the console "list" reply ("There are 1/10 players online:" then "NAME, NAME2"). */
export function onlinePlayers(lines) {
    const ps = msgs(lines);
    const i = ps.findIndex((p) => /^There are \d+\/\d+ players online:/.test(p.msg));
    if (i < 0) return null;
    const count = Number(/^There are (\d+)/.exec(ps[i].msg)[1]);
    if (count === 0) return [];
    const inline = ps[i].msg.replace(/^There are \d+\/\d+ players online:\s*/, '');
    const names = inline || (ps[i + 1]?.msg ?? '');
    return names.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Last "Teleported NAME to x, y, z" position, or null. */
export function lastTeleport(lines, name) {
    const t = playerEvents(lines, name).filter((e) => e.type === 'teleported');
    return t.length ? t[t.length - 1].pos : null;
}

/** Horizontal (x/z) distance between two positions. */
export const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * Classify a disconnect reason as in docs/research/fml-spec.md section 4:
 * handshake | timeout | whitelist | banned | server-exception | client-quit | other.
 */
export function classifyKick(reason) {
    const r = reason ?? '';
    if (/Server Mod rejections|No modded response|Mod rejections|missing mods|FML/i.test(r)) return 'handshake';
    if (/Timed out|timeout/i.test(r)) return 'timeout';
    if (/not white-listed/i.test(r)) return 'whitelist';
    if (/banned/i.test(r)) return 'banned';
    if (/Internal Exception|Exception/i.test(r)) return 'server-exception';
    if (/^Disconnected$|quitting/i.test(r)) return 'client-quit';
    return 'other';
}

/** Kick classes that a restart cannot fix: the driver exits 3 (ADR 0003 decision 5). */
export const FATAL_KICKS = new Set(['handshake', 'whitelist', 'banned']);
