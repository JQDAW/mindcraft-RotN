// Environment switches read by initBot (src/utils/mcdata.js). Kept here so
// the Mindcraft file stays small and testable.
//
//   FORGE_BRIDGE               auto (default: attach when the ping reports FML) | on | off
//   FORGE_CAPTURE              1 = captures/raw/<bot>-<time>.jsonl, or a file path
//   FORGE_MODLIST_FILE         ping JSON used if the live status ping has no mod list
//   FORGE_PING_TIMEOUT_MS      total status-ping budget, retry included (default 15000)
//   MINDCRAFT_PROFILES_FOLDER  per-bot Microsoft token cache folder (outside the repo)
//   PROTODEF_LOG_PARTIAL=1     protodef's own "partial packet" log (patches/protodef)

import process from 'node:process';

export function forgeOptionsFromEnv(username, env = process.env, now = new Date()) {
    const mode = ['auto', 'on', 'off'].includes(env.FORGE_BRIDGE) ? env.FORGE_BRIDGE : 'auto';
    let captureFile = null;
    if (env.FORGE_CAPTURE && env.FORGE_CAPTURE !== '0') {
        captureFile = env.FORGE_CAPTURE === '1'
            ? `captures/raw/${username}-${now.toISOString().replace(/[:.]/g, '-')}.jsonl`
            : env.FORGE_CAPTURE;
    }
    return {
        mode,
        captureFile,
        modListFile: env.FORGE_MODLIST_FILE || null,
        profilesFolder: env.MINDCRAFT_PROFILES_FOLDER || null,
        pingTimeoutMs: Number(env.FORGE_PING_TIMEOUT_MS) > 0 ? Number(env.FORGE_PING_TIMEOUT_MS) : null,
    };
}
