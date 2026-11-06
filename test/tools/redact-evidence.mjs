// Redaction for committed test evidence (test/evidence/**), and the leak check CI runs over it.
//
//   node test/tools/redact-evidence.mjs IN OUT [--bot NAME]   redact one file (text or JSON) into OUT
//   node test/tools/redact-evidence.mjs --check DIR...         list leftovers; exit 1 if any
//
// Rules (G2 batch plan in coord/STATUS-harness-ops.md; the lead's notes and the PR #66 review):
// - IPv6 first: inside every run of hex digits, colons and dots, the longest substring net.isIPv6
//   accepts (two or more groups) is an address, wherever it starts: also glued to a word or key
//   ("addr:2001:db8::1", "_2001:...", "v2001:..."), with a trailing ":port" (Java 8 prints
//   "/2001:db8:0:0:0:0:0:1:51234" in the 1.12 login line) or ":" ("2001:db8::1: timeout"), and in the
//   IPv4-mapped form (::ffff:203.0.113.7). The whole address becomes <ip>.
// - IPv4: the tool and the check use ONE rule (lead, after G2 batch 6, whose run.log had a bare
//   "server ... is at A.B.C.D" that the old context list missed and the check caught). EVERY dotted quad
//   with octets 0..255 (QUAD_ANY) is redacted by the tool and flagged by the check, except these three
//   exact version forms (Forge's 14.23.5.2860 is no quad: 2860 is no octet):
//     {1.2.3.4}                 a brace pair around the quad (FML's mod table)
//     -1.2.3.4.jar, -1.2.3.4-build.0673.jar   a jar file name
//     modid@1.2.3.4             on FML's "Client attempting to join with N mods : ..." line only, inside
//                               an entry that is exactly "modid@version" (also 1.12.2-1.2.3.4, 1.2.3.4-mixins8).
//                               NOTE: so EVERY name@<IPv4> entry on that line is exempt, whatever the name.
//                               Accepted (lead, PR #66 re-review): the line is FML's own list of the
//                               client's mods and versions.
//   and two exact table shapes from the pre-rule G0/G1 evidence (lead, when the check went to all of
//   test/evidence/**):
//     FML's mod state table     a line that is exactly "\t| STATE | modid | version | file.jar | sig |"
//                               (sig: 40 hex digits or None); only the version cell and the .jar cell.
//     the ping's mod list       a line that is exactly `"version": "x"` right after a line that is
//                               exactly `"modid": "y",` (FML's modinfo.modList in the status ping JSON).
//   and two address forms that name no host (lead, #128 review: the cx23 probe's `ss` lines must show
//   which sockets are loopback-only and which listen on all addresses):
//     127.x.x.x                 loopback (127.0.0.0/8), e.g. 127.0.0.1 and systemd-resolved's 127.0.0.53
//     0.0.0.0                   the IPv4 wildcard ("all addresses")
//   IPv6 "::" and "::1" were never addresses to this tool (see isAddress6).
//   It also flags any IPv6 address, any UUID, this PC's user paths, and partial leftovers next to
//   <ip> (e.g. "<ip>.0.113.7"). Committed evidence comes out of this tool, never from hand edits: a form
//   the check flags and the tool misses is fixed in the tool, with a test.
// - UUIDs become <uuid-vN> (N = the version nibble; G1's <uuid-v4> for Mojang player UUIDs). The bot's
//   name becomes <bot>; this PC's user paths become <local>.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const QUAD = String.raw`${OCTET}(?:\.${OCTET}){3}`;
// A dotted quad not glued to more digits or dots (so 1.12.2.4.5 or 14.23.5.2860 are not quads).
const QUAD_ANY = new RegExp(String.raw`(?<![\d.])${QUAD}(?!\d|\.\d)`, 'g');


// IPv6 candidates: maximal runs of hex digits, colons and dots (searched inside, see v6Spans). No
// lookbehind: an address glued to a word or a key ("addr:2001:db8::1", "_2001...", "v2001...") is found.
const V6_RUN = /[0-9A-Fa-f.:]+/g;
const UUID = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-([0-9A-Fa-f])[0-9A-Fa-f]{3}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g;
// This PC's user folder in any spelling (C:\Users\x, C:/Users/x, /c/Users/x, JSON-escaped).
const LOCAL_PATH = /(?:[A-Za-z]:|\/[a-z])(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/"'\s]+/g;
// hcloud's numeric server ids: "(server: N" and "Server N created" (group 1 is kept).
const HCLOUD_SERVER_ID = /(\(server: |\bServer )\d{5,}(?=[,) ]|$)/gm;
// What is left of an address next to a redaction: "<ip>.0.113.7", "203.0.<ip>", "2001:db8:<ip>".
const PARTIAL = /<ip>\.\d|\d\.<ip>|[0-9A-Fa-f]{1,4}:<ip>|<ip>:[0-9A-Fa-f]{1,4}:/g;

const FML_JOIN = /Client attempting to join with \d+ mods : /;
// FML's mod state table row (1.12 log), groups: the version cell, the file cell. The 'd' flag (group
// offsets) goes through the constructor, as the lint parser does not know it in a literal.
const FML_TABLE_ROW = new RegExp(String.raw`^\t\| [A-Z]+ +\| [A-Za-z0-9_.-]+ +\| ([A-Za-z0-9._+-]+) +\| ([A-Za-z0-9._+-]+\.jar) +\| (?:[0-9a-f]{40}|None) +\|$`, 'd');
// The status ping's mod list (pretty JSON): the version line and the modid line right before it.
const PING_VERSION = new RegExp(String.raw`^ *"version": "([A-Za-z0-9._+-]+)"$`, 'd');
const PING_MODID = /^ *"modid": "[A-Za-z0-9_.-]+",$/;

const HEX = /[0-9A-Fa-f]/;
const isAddress6 = (s) => net.isIPv6(s) && s.split(':').filter(Boolean).length >= 2;   // not "::", "::1", "a::b"-short

/**
 * The IPv6 addresses in a candidate run, as [start, end] offsets within it. From the earliest start, the
 * longest substring that net.isIPv6 accepts and that does not end inside a hex group (so a ":port", a
 * trailing ":" or "." stays outside: "/2001:db8:0:0:0:0:0:1:51234", "2001:db8::1: timeout"). At least two
 * non-empty groups, so "::", "::1" and method references ("Foo::bar") are never addresses.
 */
function v6Spans(run) {
    const spans = [];
    if ((run.match(/:/g) ?? []).length < 2) return spans;
    for (let i = 0; i < run.length;) {
        let found = 0;
        for (let j = run.length; j > i + 2; j--) {
            if (HEX.test(run[j] ?? '') || !isAddress6(run.slice(i, j))) continue;
            found = j;
            break;
        }
        if (found) { spans.push([i, found]); i = found; } else i++;
    }
    return spans;
}

function lineAround(text, index) {
    const start = text.lastIndexOf('\n', index - 1) + 1;
    const nl = text.indexOf('\n', index);
    const end = nl < 0 ? text.length : nl;
    return { line: text.slice(start, end).replace(/\r$/, ''), col: index - start };
}

/** A quad that names no host: loopback 127.0.0.0/8 or the wildcard 0.0.0.0 (see the header). */
const isHostless = (quad) => quad === '0.0.0.0' || quad.startsWith('127.');

/** May the quad at `index` stay: a host-less address, or one of the exact version forms (see the header)? */
function isExempt(text, index, match) {
    return isHostless(match) || isVersionContext(text, index, match);
}

/** Is the quad at `index` one of the three exact version forms (see the header)? Everything else is flagged. */
function isVersionContext(text, index, match) {
    const before = text.slice(Math.max(0, index - 1), index);
    const after = text.slice(index + match.length, index + match.length + 40);
    if (before === '{' && after.startsWith('}')) return true;
    if (before === '-' && /[A-Za-z0-9.]/.test(text[index - 2] ?? '') && /^(?:-[A-Za-z0-9.]+)?\.jar(?![A-Za-z0-9_])/.test(after)) return true;
    const { line, col } = lineAround(text, index);
    // The quad lies wholly inside capture group g of an exact line shape (m from a regex with the 'd' flag,
    // so m.indices[g] is the group's [start, end) on the line; a quad that only overlaps the group is not exempt).
    const inGroup = (m, g) => m?.indices[g] && col >= m.indices[g][0] && col + match.length <= m.indices[g][1];
    // FML's mod state table (G1 evidence): the WHOLE line must be one table row (FML_TABLE_ROW is anchored at
    // both ends), and only its version cell (group 1) and its .jar file cell (group 2) are exempt. The state,
    // modid and signature cells, and any text before or after the row, are never exempt.
    const row = FML_TABLE_ROW.exec(line);
    if (inGroup(row, 1) || inGroup(row, 2)) return true;
    // The status ping's mod list (G0 evidence): the whole line is exactly `"version": "x"` and the line
    // RIGHT before it is exactly `"modid": "y",` (a blank line between them breaks the pair).
    const ver = PING_VERSION.exec(line);
    if (inGroup(ver, 1)) {
        const start = text.lastIndexOf('\n', index - 1);
        const prev = start > 0 ? lineAround(text, text.lastIndexOf('\n', start - 1) + 1).line : '';
        if (PING_MODID.test(prev)) return true;
    }
    // FML's join list: the comma-separated entry holding the quad must be exactly "modid@version"
    // (no spaces), with the quad inside the version: "a@1.2.3.4", "a@1.12.2-1.2.3.4", "a@1.2.3.4-mixins8".
    const fml = FML_JOIN.exec(line);
    if (!fml) return false;
    const listStart = fml.index + fml[0].length;
    if (col < listStart) return false;
    const entryStart = Math.max(listStart, line.lastIndexOf(',', col - 1) + 1);
    const comma = line.indexOf(',', col);
    const entry = line.slice(entryStart, comma < 0 ? line.length : comma);
    return /^[A-Za-z0-9_.-]+@[A-Za-z0-9._+-]+$/.test(entry) && col - entryStart > entry.indexOf('@');
}

function redactV6(text) {
    return text.replace(V6_RUN, (run) => {
        let out = run;
        for (const [a, b] of v6Spans(run).reverse()) out = `${out.slice(0, a)}<ip>${out.slice(b)}`;
        return out;
    });
}

/** Redact one evidence text. `bot` is the bot's player name (replaced by <bot>). */
export function redact(text, { bot } = {}) {
    let out = redactV6(text);   // first, so an IPv4-mapped address goes whole
    // The check's own rule (findLeaks): every quad that is not host-less or one of the exact version forms.
    out = out.replace(QUAD_ANY, (m, offset, whole) => (isExempt(whole, offset, m) ? m : '<ip>'));
    out = out.replace(UUID, (_m, v) => `<uuid-v${v.toLowerCase()}>`);
    out = out.replace(LOCAL_PATH, '<local>');
    // Hetzner's numeric server ids in hcloud's output (lead, #237 review nit): "(server: 174725082, ...)",
    // "Waiting for start_server (server: 174725082) ..." and "Server 174725082 created". Masked from now on;
    // not a leak-check rule, because earlier committed evidence keeps them (the servers are deleted).
    out = out.replace(HCLOUD_SERVER_ID, (_m, pre) => `${pre}<server-id>`);
    if (bot) {
        if (!/^[A-Za-z0-9_]{3,16}$/.test(bot)) throw new Error('bad bot name');
        out = out.replace(new RegExp(String.raw`\b${bot}\b`, 'g'), '<bot>');
    }
    return out;
}

/** Leftovers in one text: [{kind, line}] (where, never what: addresses are not printed). */
export function findLeaks(text) {
    const leaks = [];
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    for (const m of text.matchAll(V6_RUN)) for (const [a] of v6Spans(m[0])) leaks.push({ kind: 'ipv6', line: lineOf(m.index + a) });
    for (const m of text.matchAll(QUAD_ANY)) {
        if (!isExempt(text, m.index, m[0])) leaks.push({ kind: 'ipv4', line: lineOf(m.index) });
    }
    for (const m of text.matchAll(PARTIAL)) leaks.push({ kind: 'partial-ip', line: lineOf(m.index) });
    for (const m of text.matchAll(UUID)) leaks.push({ kind: 'uuid', line: lineOf(m.index) });
    for (const m of text.matchAll(LOCAL_PATH)) leaks.push({ kind: 'local-path', line: lineOf(m.index) });
    return leaks.sort((a, b) => a.line - b.line);
}

/** Every file under `dir` (recursive), as paths. */
export function evidenceFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => path.join(d.parentPath ?? d.path, d.name));
}

function main(argv) {
    if (argv[0] === '--check') {
        let n = 0;
        for (const dir of argv.slice(1)) {
            for (const f of evidenceFiles(dir)) {
                for (const l of findLeaks(fs.readFileSync(f, 'utf8'))) {
                    console.error(`${f}:${l.line}: unredacted ${l.kind}`);
                    n++;
                }
            }
        }
        process.exitCode = n ? 1 : 0;
        return;
    }
    const [inFile, outFile] = argv;
    const i = argv.indexOf('--bot');
    if (!inFile || !outFile) {
        console.error('usage: redact-evidence.mjs IN OUT [--bot NAME] | --check DIR...');
        process.exitCode = 2;
        return;
    }
    fs.writeFileSync(outFile, redact(fs.readFileSync(inFile, 'utf8'), { bot: i >= 0 ? argv[i + 1] : undefined }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
