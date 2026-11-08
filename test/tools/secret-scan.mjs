// The repo secret scan (G4 #8, ready-to-try: "no secrets in the repo"; test/scenarios/g4/PLAN.md). Offline and fast: it
// reads only the files git tracks (`git ls-files`), as text, and reports:
//   private-key      a PEM/OpenSSH/PuTTY private key header ("-----BEGIN ... PRIVATE KEY-----")
//   openrouter-key   an OpenRouter key: "sk-or-" followed by at least 20 key characters
//   hetzner-token    a Hetzner API token: a standalone run of exactly 64 letters and digits that is not plain hex (a
//                    SHA-256) and not inside a sha512-/sha1-/sha256- (package-lock integrity) value
//   ipv4             an IPv4 address outside the documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24),
//                    loopback (127.0.0.0/8) and 0.0.0.0, also after "-" or "." and before "-"; and the reversed form in
//                    a Hetzner reverse-DNS name (static.<d.c.b.a>.clients.your-server.de). Version contexts only are
//                    exempt: a "v" prefix, ".jar" after it, a longer dotted run, an octet with a leading zero, and a
//                    quad inside the JSON string under a "version" key (the pack manifest and FML's mod list hold ~50).
//   secret-file      a tracked path that must never be committed: .env, .env.*, *.env (not *.env.example), .envrc,
//                    keys.json, *.token, an nmp-cache folder (any case), prismarine-auth caches (*_live-cache.json,
//                    *_mca-cache.json, *_xbl-cache.json), SSH private keys (id_*, *_ed25519, *_rsa, *_ecdsa, without
//                    .pub), *.pem, *.key, *.p12, *.pfx, *.ppk
// test/evidence/** gets every rule but ipv4 (CI's evidence leak check, redact-evidence.mjs --check, covers addresses).
// Known false positives go into test/tools/secret-scan-allow.txt, one per line, "<path><TAB><hash><TAB><why>": the hash
// is the one this tool prints (the first 16 hex digits of the match's SHA-256; "secret-file" for a file name), so the
// allowlist never holds a secret's plaintext.
// The output never shows a match: each finding is "path:line: kind (length N, starts "<at most 6 characters>", hash H)".
// Symlinks are skipped (lstat); files over 2 MB are skipped and named in the summary.
// Exit 0 clean, 1 findings, 2 a usage or git error.
//
//   node test/tools/secret-scan.mjs                 the tracked files of this checkout
//   node test/tools/secret-scan.mjs --root DIR      another checkout
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ALLOW = path.join(here, 'secret-scan-allow.txt');
export const MAX_BYTES = 2 * 1024 * 1024;
// Built from parts, so this file itself never matches its own patterns.
const BEGIN = '-----' + 'BEGIN';
const SK_OR = 'sk-' + 'or-';

/** The hash an allowlist entry and a finding use: the first 16 hex digits of the match's SHA-256. */
export const matchHash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** A real, non-documentation IPv4: four octets 0-255 without leading zeros, outside the safe ranges. */
export function isRealIPv4(m) {
    const o = m.split('.');
    if (o.some((x) => x.length > 1 && x.startsWith('0'))) return false;   // 1.12.2.024: a version
    const n = o.map(Number);
    if (n.some((x) => x > 255)) return false;
    if (n[0] === 127 || n.every((x) => x === 0)) return false;
    if ((n[0] === 192 && n[1] === 0 && n[2] === 2) || (n[0] === 198 && n[1] === 51 && n[2] === 100) || (n[0] === 203 && n[1] === 0 && n[2] === 113)) return false;
    return true;
}
/** The reversed address in a Hetzner reverse-DNS name, as a.b.c.d. */
const unreversed = (m) => m.split('.').reverse().join('.');

/** The spans of JSON string values under a "version" key in a line. */
const versionSpans = (line) => [...line.matchAll(/"version"\s*:\s*"([^"]*)"/g)].map((m) => { const a = m.index + m[0].length - m[1].length - 1; return [a, a + m[1].length]; });
/** The spans of integrity-style base64 values in a line (sha512-..., sha1-..., sha256-...). */
const hashValueSpans = (line) => [...line.matchAll(/\bsha(?:1|256|384|512)-[A-Za-z0-9+/]+=*/g)].map((m) => [m.index, m.index + m[0].length]);

export const RULES = [
    { kind: 'private-key', re: new RegExp(`${BEGIN} (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----`, 'g'), evidence: true },
    { kind: 'private-key', re: /^PuTTY-User-Key-File-\d+: /g, evidence: true },
    { kind: 'openrouter-key', re: new RegExp(`${SK_OR}[A-Za-z0-9_-]{20,}`, 'g'), evidence: true },
    {
        kind: 'hetzner-token', re: /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g, evidence: true,
        keep: (s) => !/^[0-9a-fA-F]{64}$/.test(s),
        // Only a sha512-/sha1-/sha256- (integrity) value is base64 to leave alone (#390 review): a token after "/" or
        // before "=" still counts.
        exempt: (s, line, at) => hashValueSpans(line).some(([a, b]) => at >= a && at + s.length <= b),
    },
    {
        // After "-" or "." and before "-" count (#390 review); a digit or "." before, or ".digit", a digit or ".jar"
        // after, is a longer dotted run or a version.
        kind: 'ipv4', re: /(?<!\d)(?<!\d\.)(?:\d{1,3}\.){3}\d{1,3}(?!\.\d|\d|\.jar)/g, evidence: false, keep: isRealIPv4,
        // A version: a "v" right before it (a lone v, not the end of a word), or inside the JSON string under a "version"
        // key (the manifest's "1.12.2-<quad>" mod versions too).
        exempt: (s, line, at) => (at > 0 && line[at - 1] === 'v' && !/[A-Za-z]/.test(line[at - 2] ?? ''))
            || versionSpans(line).some(([a, b]) => at >= a && at + s.length <= b)
            // A Hetzner reverse-DNS name holds the address reversed: the rule below reads it that way.
            || /^\.[A-Za-z0-9.-]*\.your-server\.de\b/.test(line.slice(at + s.length)),
    },
    {
        kind: 'ipv4', re: /(?<!\d)(?<!\d\.)(?:\d{1,3}\.){3}\d{1,3}(?=\.[A-Za-z0-9.-]*\.your-server\.de\b)/g, evidence: false,
        keep: (s) => isRealIPv4(unreversed(s)),
    },
];

/** A tracked path that must never be committed (secret-file), or null. */
export function secretFile(p) {
    const base = path.posix.basename(p);
    const lower = base.toLowerCase();
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') return 'an env file';
    if (/\.env$/.test(base) && base !== '.env') return 'an env file';
    if (base === '.envrc') return 'an env file (direnv)';
    if (base === 'keys.json') return 'keys.json (API keys)';
    if (/\.token$/.test(base)) return 'a token file';
    if (p.split('/').some((d) => d.toLowerCase() === 'nmp-cache')) return 'a token cache (nmp-cache)';
    if (/_(live|mca|xbl)-cache\.json$/.test(lower)) return 'a Microsoft/Xbox token cache (prismarine-auth)';
    if (!lower.endsWith('.pub') && (/^id_[\w-]+$/.test(base) || /_(ed25519|rsa|ecdsa|dsa)$/.test(base))) return 'an SSH private key';
    if (/\.(pem|key|p12|pfx|ppk)$/.test(lower)) return 'a key or certificate file';
    return null;
}

/** The allowlist: Set of "path\thash" (and "path\tsecret-file"). Lines starting with # and blank lines are skipped. */
export function loadAllow(file) {
    const set = new Set();
    if (!fs.existsSync(file)) return set;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const l = raw.replace(/\r$/, '');
        if (!l.trim() || l.startsWith('#')) continue;
        const [p, h] = l.split('\t');
        if (p && h && (/^[0-9a-f]{16}$/.test(h) || h === 'secret-file')) set.add(`${p}\t${h}`);
    }
    return set;
}

/** Findings in one file's text: [{path, line, kind, hash, length, prefix}], the allowlisted ones left out. */
export function scanText(p, text, allow = new Set(), { evidence = false } = {}) {
    const out = [];
    text.split('\n').forEach((l, i) => {
        const seen = new Set();   // one finding per place (a reverse-DNS quad matches both ipv4 rules)
        for (const r of RULES) {
            if (evidence && !r.evidence) continue;
            r.re.lastIndex = 0;
            for (const m of l.matchAll(r.re)) {
                const s = m[0];
                if (r.keep && !r.keep(s)) continue;
                if (r.exempt?.(s, l, m.index)) continue;
                if (seen.has(m.index)) continue;
                seen.add(m.index);
                const hash = matchHash(s);
                if (allow.has(`${p}\t${hash}`)) continue;
                out.push({ path: p, line: i + 1, kind: r.kind, hash, length: s.length, prefix: s.slice(0, Math.min(6, Math.max(0, s.length - 4))) });
            }
        }
    });
    return out;
}

/** Scan a checkout's tracked files. -> {findings, files, skippedLarge, skippedLinks, ms} */
export function scanRepo(root, { allowFile = DEFAULT_ALLOW, lsFiles = null, maxBytes = MAX_BYTES } = {}) {
    const t0 = Date.now();
    const allow = loadAllow(allowFile);
    const files = lsFiles ?? execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
    const findings = [];
    const skippedLarge = [];
    let skippedLinks = 0;
    for (const p of files) {
        const why = secretFile(p);
        if (why && !allow.has(`${p}\tsecret-file`)) findings.push({ path: p, line: 0, kind: 'secret-file', hash: 'secret-file', length: 0, prefix: why });
        const abs = path.join(root, p);
        let st;
        try { st = fs.lstatSync(abs); } catch { continue; }   // deleted in the working tree
        if (st.isSymbolicLink()) { skippedLinks++; continue; }
        if (!st.isFile()) continue;
        if (st.size > maxBytes) { skippedLarge.push(p); continue; }
        const buf = fs.readFileSync(abs);
        if (buf.includes(0)) continue;                         // binary
        findings.push(...scanText(p, buf.toString('utf8'), allow, { evidence: p.startsWith('test/evidence/') }));
    }
    return { findings, files: files.length, skippedLarge, skippedLinks, ms: Date.now() - t0 };
}

/** One finding as printed: never the match itself. */
export function formatFinding(f) {
    if (f.kind === 'secret-file') return `${f.path}: secret-file: ${f.prefix} (allowlist key: secret-file)`;
    return `${f.path}:${f.line}: ${f.kind} (length ${f.length}, starts "${f.prefix}", hash ${f.hash})`;
}

function main(argv) {
    let root = process.cwd();
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--root') root = argv[++i];
        else { console.error(`secret-scan: unknown argument '${argv[i]}'`); return 2; }
    }
    let r;
    try { r = scanRepo(root); } catch (e) { console.error(`secret-scan: ${e.message}`); return 2; }
    for (const f of r.findings) console.log(formatFinding(f));
    const skipped = [r.skippedLarge.length ? `${r.skippedLarge.length} file(s) over ${MAX_BYTES / 1048576} MB not read: ${r.skippedLarge.join(', ')}` : '',
        r.skippedLinks ? `${r.skippedLinks} symlink(s) skipped` : ''].filter(Boolean).join('; ');
    console.log(`secret-scan: ${r.findings.length} finding(s) in ${r.files} tracked files (${r.ms} ms)${skipped ? `; ${skipped}` : ''}`
        + `${r.findings.length ? '; a false positive goes into test/tools/secret-scan-allow.txt as "<path><TAB><hash><TAB><why>"' : ''}`);
    return r.findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
