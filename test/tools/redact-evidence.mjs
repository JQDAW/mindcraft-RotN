// Redaction for committed test evidence (test/evidence/**), and the leak check CI runs over it.
//
//   node test/tools/redact-evidence.mjs IN OUT [--bot NAME]   redact one file (text or JSON) into OUT
//   node test/tools/redact-evidence.mjs --check DIR...         list leftovers; exit 1 if any
//
// Rules (G2 batch plan in coord/STATUS-harness-ops.md; the lead's notes and the PR #66 review):
// - IPv6 first: a run of hex digits, colons and dots with at least two colons is an address if
//   net.isIPv6 says so, also with a trailing ":port" (Java 8 prints "/2001:db8:0:0:0:0:0:1:51234" in the
//   1.12 login line) and in the IPv4-mapped form (::ffff:203.0.113.7). The whole address becomes <ip>.
// - IPv4 is REDACTED where a log shows an address: after "/", inside "[ ]", as host:port, or as a whole
//   JSON string.
// - The CHECK is stricter than the redaction and fails closed. It flags EVERY dotted quad with octets
//   0..255 except these three exact version forms:
//     {1.2.3.4}                 a brace pair around the quad (FML's mod table)
//     -1.2.3.4.jar, -1.2.3.4-build.0673.jar   a jar file name
//     modid@1.2.3.4             on FML's "Client attempting to join with N mods : ..." line only, inside
//                               an entry that is exactly "modid@version" (also 1.12.2-1.2.3.4, 1.2.3.4-mixins8)
//   It also flags any IPv6 address, any UUID, this PC's user paths, and partial leftovers next to
//   <ip> (e.g. "<ip>.0.113.7"). A flagged address is fixed by a manual redaction, never a wider allowlist.
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

// IPv4 address contexts for the redaction.
const ADDRESS_CONTEXTS = [
    new RegExp(String.raw`(?<=/)${QUAD}(?!\d|\.\d)`, 'g'), // FRCFLD[/1.2.3.4:5678], /1.2.3.4
    new RegExp(String.raw`(?<=\[)${QUAD}(?=[\]:])`, 'g'), // [1.2.3.4] or [1.2.3.4:5678]
    new RegExp(String.raw`(?<![\d.])${QUAD}(?=:\d{1,5}(?!\d))`, 'g'), // 1.2.3.4:25565
    new RegExp(String.raw`(?<=")${QUAD}(?=")`, 'g'), // "host": "1.2.3.4"
];

// IPv6 candidates: maximal runs of hex digits, colons and dots with at least two colons.
const V6_RUN = /(?<![\w:.])[0-9A-Fa-f.]*:[0-9A-Fa-f.:]*:[0-9A-Fa-f.:]*/g;
const UUID = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-([0-9A-Fa-f])[0-9A-Fa-f]{3}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g;
// This PC's user folder in any spelling (C:\Users\x, C:/Users/x, /c/Users/x, JSON-escaped).
const LOCAL_PATH = /(?:[A-Za-z]:|\/[a-z])(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/"'\s]+/g;
// What is left of an address next to a redaction: "<ip>.0.113.7", "203.0.<ip>", "2001:db8:<ip>".
const PARTIAL = /<ip>\.\d|\d\.<ip>|[0-9A-Fa-f]{1,4}:<ip>|<ip>:[0-9A-Fa-f]{1,4}:/g;

const FML_JOIN = /Client attempting to join with \d+ mods : /;

/**
 * The IPv6 address in a candidate run, as [start, end] offsets within it, or null. A trailing ":port"
 * (1-5 digits) is not part of the address. "::" alone is never an address (Java's method references).
 */
function v6Span(run) {
    const r = run.replace(/\.+$/, '');   // a sentence's full stop
    if (r === '::') return null;
    if (net.isIPv6(r)) return [0, r.length];
    const m = /^(.*):(\d{1,5})$/.exec(r);
    if (m && m[1] !== '::' && net.isIPv6(m[1])) return [0, m[1].length];
    return null;
}

function lineAround(text, index) {
    const start = text.lastIndexOf('\n', index - 1) + 1;
    const nl = text.indexOf('\n', index);
    const end = nl < 0 ? text.length : nl;
    return { line: text.slice(start, end).replace(/\r$/, ''), col: index - start };
}

/** Is the quad at `index` one of the three exact version forms (see the header)? Everything else is flagged. */
function isVersionContext(text, index, match) {
    const before = text.slice(Math.max(0, index - 1), index);
    const after = text.slice(index + match.length, index + match.length + 40);
    if (before === '{' && after.startsWith('}')) return true;
    if (before === '-' && /[A-Za-z0-9.]/.test(text[index - 2] ?? '') && /^(?:-[A-Za-z0-9.]+)?\.jar(?![A-Za-z0-9_])/.test(after)) return true;
    // FML's join list: the comma-separated entry holding the quad must be exactly "modid@version"
    // (no spaces), with the quad inside the version: "a@1.2.3.4", "a@1.12.2-1.2.3.4", "a@1.2.3.4-mixins8".
    const { line, col } = lineAround(text, index);
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
        const span = v6Span(run);
        return span ? `${run.slice(0, span[0])}<ip>${run.slice(span[1])}` : run;
    });
}

/** Redact one evidence text. `bot` is the bot's player name (replaced by <bot>). */
export function redact(text, { bot } = {}) {
    let out = redactV6(text);   // first, so an IPv4-mapped address goes whole
    for (const re of ADDRESS_CONTEXTS) {
        out = out.replace(re, (m, offset, whole) => (isVersionContext(whole, offset, m) ? m : '<ip>'));
    }
    out = out.replace(UUID, (_m, v) => `<uuid-v${v.toLowerCase()}>`);
    out = out.replace(LOCAL_PATH, '<local>');
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
    for (const m of text.matchAll(V6_RUN)) if (v6Span(m[0])) leaks.push({ kind: 'ipv6', line: lineOf(m.index) });
    for (const m of text.matchAll(QUAD_ANY)) {
        if (!isVersionContext(text, m.index, m[0])) leaks.push({ kind: 'ipv4', line: lineOf(m.index) });
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
