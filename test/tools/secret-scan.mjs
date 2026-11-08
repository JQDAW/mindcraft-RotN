// The repo secret scan (G4 #8, ready-to-try: "no secrets in the repo"; test/scenarios/g4/PLAN.md). Offline and fast: it
// reads only the files git tracks (`git ls-files`), as text, and reports:
//   private-key      a PEM/OpenSSH private key header ("-----BEGIN ... PRIVATE KEY-----")
//   openrouter-key   an OpenRouter key: "sk-or-" followed by at least 20 key characters
//   hetzner-token    a Hetzner API token: a standalone run of exactly 64 letters and digits that is not plain hex (a
//                    SHA-256) and not part of a base64 run (package-lock's integrity hashes)
//   ipv4             an IPv4 address outside the documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24),
//                    loopback (127.0.0.0/8) and 0.0.0.0, and not version-shaped (an octet with a leading zero, part of a
//                    longer dotted run, right after or before a version context: "-", "v", ".jar", a letter, or
//                    the whole value of a JSON "version" key)
//   secret-file      a tracked path that must never be committed: .env and .env.* (not .env.example), keys.json, *.token,
//                    anything under an nmp-cache folder, SSH private keys (id_rsa, id_ed25519, id_ecdsa, id_dsa without
//                    .pub), *.pem, *.key, *.p12, *.pfx
// test/evidence/** is skipped: CI's evidence leak check (redact-evidence.mjs --check) holds it to stricter rules.
// Known false positives go into test/tools/secret-scan-allow.txt, one per line: "<path><TAB><the exact match><TAB><why>".
// Exit 0 clean, 1 findings (each "path:line: kind: match", the match cut to 40 characters), 2 a usage or git error.
//
//   node test/tools/secret-scan.mjs                 the tracked files of this checkout
//   node test/tools/secret-scan.mjs --root DIR      another checkout
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ALLOW = path.join(here, 'secret-scan-allow.txt');
const MAX_BYTES = 2 * 1024 * 1024;
// Built from parts, so this file itself never matches its own patterns.
const BEGIN = '-----' + 'BEGIN';
const SK_OR = 'sk-' + 'or-';

export const RULES = [
    { kind: 'private-key', re: new RegExp(`${BEGIN} (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----`, 'g') },
    { kind: 'openrouter-key', re: new RegExp(`${SK_OR}[A-Za-z0-9_-]{20,}`, 'g') },
    // Not inside a base64 run: no letter, digit, + or / before it, and none of those or the = padding after it (an
    // assignment's "=" before a token still counts: HCLOUD_TOKEN=<token>).
    { kind: 'hetzner-token', re: /(?<![A-Za-z0-9+/])[A-Za-z0-9]{64}(?![A-Za-z0-9+/=])/g, keep: (m) => !/^[0-9a-fA-F]{64}$/.test(m) },
    // A JSON string under a "version" key ("version": "1.6.0.23", the pack manifest and FML's mod list) is a version.
    // "@" is not a version context here: user@host is an address (FML's "modid@version" lines live in test/evidence).
    { kind: 'ipv4', re: /(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w-]|\.\d|\.jar)/g, keep: isRealIPv4,
        exempt: (s, line) => new RegExp(`"version"\\s*:\\s*"${s.replace(/\./g, '\\.')}"`).test(line) },
];

/** A real, non-documentation IPv4: four octets 0-255 without leading zeros, outside the safe ranges. */
export function isRealIPv4(m) {
    const o = m.split('.');
    if (o.some((x) => x.length > 1 && x.startsWith('0'))) return false;   // 1.12.2.024: a version
    const n = o.map(Number);
    if (n.some((x) => x > 255)) return false;
    if (n[0] === 127 || (n[0] === 0 && n[1] === 0 && n[2] === 0 && n[3] === 0)) return false;
    if ((n[0] === 192 && n[1] === 0 && n[2] === 2) || (n[0] === 198 && n[1] === 51 && n[2] === 100) || (n[0] === 203 && n[1] === 0 && n[2] === 113)) return false;
    return true;
}

/** A tracked path that must never be committed (secret-file), or null. */
export function secretFile(p) {
    const base = path.posix.basename(p);
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') return 'an env file';
    if (base === 'keys.json') return 'keys.json (API keys)';
    if (/\.token$/.test(base)) return 'a token file';
    if (p.split('/').includes('nmp-cache')) return 'a token cache (nmp-cache)';
    if (/^id_(rsa|ed25519|ecdsa|dsa)$/.test(base)) return 'an SSH private key';
    if (/\.(pem|key|p12|pfx)$/.test(base)) return 'a key or certificate file';
    return null;
}

/** The allowlist: Set of "path\tmatch". Lines starting with # and blank lines are skipped. */
export function loadAllow(file) {
    const set = new Set();
    if (!fs.existsSync(file)) return set;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const l = raw.replace(/\r$/, '');
        if (!l.trim() || l.startsWith('#')) continue;
        const [p, m] = l.split('\t');
        if (p && m) set.add(`${p}\t${m}`);
    }
    return set;
}

/** Findings in one file's text: [{path, line, kind, match}], the allowlisted ones left out. */
export function scanText(p, text, allow = new Set()) {
    const out = [];
    const lines = text.split('\n');
    lines.forEach((l, i) => {
        for (const r of RULES) {
            r.re.lastIndex = 0;
            for (const m of l.matchAll(r.re)) {
                const s = m[0];
                if (r.keep && !r.keep(s)) continue;
                if (r.exempt?.(s, l)) continue;
                if (allow.has(`${p}\t${s}`)) continue;
                out.push({ path: p, line: i + 1, kind: r.kind, match: s });
            }
        }
    });
    return out;
}

/** Scan a checkout's tracked files. -> {findings, files, ms} */
export function scanRepo(root, { allowFile = DEFAULT_ALLOW, lsFiles = null } = {}) {
    const t0 = Date.now();
    const allow = loadAllow(allowFile);
    const files = lsFiles ?? execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
    const findings = [];
    for (const p of files) {
        const why = secretFile(p);
        if (why && !allow.has(`${p}\tsecret-file`)) findings.push({ path: p, line: 0, kind: 'secret-file', match: why });
        if (p.startsWith('test/evidence/')) continue;
        const abs = path.join(root, p);
        let st;
        try { st = fs.statSync(abs); } catch { continue; }   // deleted in the working tree
        if (!st.isFile() || st.size > MAX_BYTES) continue;
        const buf = fs.readFileSync(abs);
        if (buf.includes(0)) continue;                         // binary
        findings.push(...scanText(p, buf.toString('utf8'), allow));
    }
    return { findings, files: files.length, ms: Date.now() - t0 };
}

function main(argv) {
    let root = process.cwd();
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--root') root = argv[++i];
        else { console.error(`secret-scan: unknown argument '${argv[i]}'`); return 2; }
    }
    let r;
    try { r = scanRepo(root); } catch (e) { console.error(`secret-scan: ${e.message}`); return 2; }
    for (const f of r.findings) console.log(`${f.path}:${f.line}: ${f.kind}: ${f.match.slice(0, 40)}`);
    console.log(`secret-scan: ${r.findings.length} finding(s) in ${r.files} tracked files (${r.ms} ms)${r.findings.length ? '; a false positive goes into test/tools/secret-scan-allow.txt with its reason' : ''}`);
    return r.findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
