// Redaction for committed test evidence (test/evidence/**), and the leak check CI runs over it.
//
//   node test/tools/redact-evidence.mjs IN OUT [--bot NAME]   redact one file (text or JSON) into OUT
//   node test/tools/redact-evidence.mjs --check DIR...         list leftovers; exit 1 if any
//
// Rules (G2 batch plan in coord/STATUS-harness-ops.md, lead's notes for the evidence PR):
// - IPv4 addresses are REDACTED only where a log shows an address: after "/", inside "[ ]", as
//   host:port, or as a whole JSON string. A four-number version (a mod's 1.2.3.4 in a mod list) is
//   not an address and is kept.
// - The CHECK is stricter than the redaction: it flags EVERY dotted quad with octets 0..255, except
//   the allowlisted version contexts below. So an address in an unexpected context fails CI instead
//   of slipping through; the fix is then a manual redaction, never a wider allowlist.
// - IPv6 addresses become <ip>. UUIDs become <uuid-vN> (N = the version nibble; G1's <uuid-v4> for
//   Mojang player UUIDs). The bot's name becomes <bot>; this PC's user paths become <local>.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const QUAD = String.raw`${OCTET}(?:\.${OCTET}){3}`;
// A dotted quad not glued to more digits or dots (so 1.12.2.4.5 or 14.23.5.2860 are not quads).
const QUAD_ANY = new RegExp(String.raw`(?<![\d.])${QUAD}(?![\d]|\.\d)`, 'g');

// Address contexts for the redaction.
const ADDRESS_CONTEXTS = [
    new RegExp(String.raw`(?<=/)${QUAD}(?![\d]|\.\d)`, 'g'), // FRCFLD[/1.2.3.4:5678], /1.2.3.4
    new RegExp(String.raw`(?<=\[)${QUAD}(?=[\]:])`, 'g'), // [1.2.3.4] or [1.2.3.4:5678]
    new RegExp(String.raw`(?<![\d.])${QUAD}(?=:\d{1,5}(?!\d))`, 'g'), // 1.2.3.4:25565
    new RegExp(String.raw`(?<=")${QUAD}(?=")`, 'g'), // "host": "1.2.3.4"
];

// Version contexts the check allows: a quad that is part of a version, not an address.
//   {1.2.3.4}  (FML mod list)         mod-1.2.3.4.jar / mod_1.2.3.4 / v1.2.3.4 / 1.2.3.4-beta / 1.2.3.4+build
//   "version": "1.2.3.4" / version 1.2.3.4 / Version: 1.2.3.4
const VERSION_BEFORE = /(?:[{\-_vV]|[Vv]ersion["']?\s*[:=]?\s*["']?|ver\.?\s)$/;
const VERSION_AFTER = /^(?:[}\-_+]|\.jar\b|[a-z])/;

// IPv6: two or more colon groups with "::", or eight full groups. Clock times (22:10:20) have no "::"
// and only three groups, so they never match.
const IPV6 = new RegExp(String.raw`(?<![\w:.])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{0,4}::(?:[0-9A-Fa-f]{1,4}:){0,6}(?:[0-9A-Fa-f]{1,4}|${QUAD})?)(?![\w:])`, 'g');
const UUID = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-([0-9A-Fa-f])[0-9A-Fa-f]{3}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g;
// This PC's user folder in any spelling (C:\Users\x, C:/Users/x, /c/Users/x, JSON-escaped).
const LOCAL_PATH = /(?:[A-Za-z]:|\/[a-z])(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/"'\s]+/g;

// FML's "Client attempting to join with N mods : modid@version,modid@version,..." list: a quad right
// after "modid@" and followed by "," or the end of the line. ("user@<address> " stays flagged.)
const MODLIST_BEFORE = /[A-Za-z0-9_]@$/;
const MODLIST_AFTER = /^(?:,|\r?\n|$)/;

function isVersionContext(text, index, match) {
    const before = text.slice(Math.max(0, index - 12), index);
    const after = text.slice(index + match.length, index + match.length + 6);
    return VERSION_BEFORE.test(before) || VERSION_AFTER.test(after) || (MODLIST_BEFORE.test(before) && MODLIST_AFTER.test(after));
}

/** Redact one evidence text. `bot` is the bot's player name (replaced by <bot>). */
export function redact(text, { bot } = {}) {
    let out = text;
    for (const re of ADDRESS_CONTEXTS) {
        out = out.replace(re, (m, offset, whole) => (isVersionContext(whole, offset, m) ? m : '<ip>'));
    }
    out = out.replace(IPV6, (m) => (m === '::' ? m : '<ip>'));
    out = out.replace(UUID, (_m, v) => `<uuid-v${v.toLowerCase()}>`);
    out = out.replace(LOCAL_PATH, '<local>');
    if (bot) {
        if (!/^[A-Za-z0-9_]{3,16}$/.test(bot)) throw new Error('bad bot name');
        out = out.replace(new RegExp(String.raw`\b${bot}\b`, 'g'), '<bot>');
    }
    return out;
}

/** Leftovers in one text: [{kind, line, text}] (text is the offending match, for the report). */
export function findLeaks(text) {
    const leaks = [];
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    for (const m of text.matchAll(QUAD_ANY)) {
        if (!isVersionContext(text, m.index, m[0])) leaks.push({ kind: 'ipv4', line: lineOf(m.index), text: m[0] });
    }
    for (const m of text.matchAll(IPV6)) if (m[0] !== '::') leaks.push({ kind: 'ipv6', line: lineOf(m.index), text: m[0] });
    for (const m of text.matchAll(UUID)) leaks.push({ kind: 'uuid', line: lineOf(m.index), text: m[0] });
    for (const m of text.matchAll(LOCAL_PATH)) leaks.push({ kind: 'local-path', line: lineOf(m.index), text: m[0] });
    return leaks;
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
                    // The match itself is not printed for addresses: say where, not what.
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
