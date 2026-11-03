// Environment switches read by initBot (src/utils/mcdata.js). Kept here so
// the Mindcraft file stays small and testable.
//
//   FORGE_BRIDGE               auto (default: attach when the ping reports FML) | on | off
//   FORGE_CAPTURE              1 = captures/raw/<bot>-<time>.jsonl, or a file path
//   FORGE_MODLIST_FILE         ping JSON used if the live status ping has no mod list
//   FORGE_PING_TIMEOUT_MS      total status-ping budget, retry included (default 15000)
//   MINDCRAFT_PROFILES_FOLDER  per-bot Microsoft token cache folder (outside the repo)
//   MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS  placeBlock's wait for the block update (overrides
//                              settings.place_block_timeout_ms; default 500, patches/mineflayer)
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
        placeBlockTimeoutRaw: env.MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS ?? null,
    };
}

export const PLACE_BLOCK_TIMEOUT_RANGE = Object.freeze({ min: 50, max: 60000 });

/**
 * placeBlock's wait for the server's block update, from the env var (wins) or the setting.
 * @returns {{ ms: number|null, warning: string|null }} ms null = keep mineflayer's patched default (500)
 */
export function placeBlockTimeout(envRaw, settingRaw) {
    const raw = envRaw !== null && envRaw !== undefined && envRaw !== '' ? envRaw : settingRaw;
    if (raw === null || raw === undefined || raw === '') return { ms: null, warning: null };
    const ms = Number(raw);
    const { min, max } = PLACE_BLOCK_TIMEOUT_RANGE;
    if (Number.isInteger(ms) && ms >= min && ms <= max) return { ms, warning: null };
    return { ms: null, warning: `place_block_timeout_ms ${JSON.stringify(raw)} ignored (integer ${min}-${max} expected); using 500 ms` };
}
