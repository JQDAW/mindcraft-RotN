// LLM spend for G3 (lead, #101 and #116 review): per-scenario LLM calls and cost, and the batch spend
// stop. The cost is the change in the OpenRouter key's `usage` (USD), read from OpenRouter's key endpoint
// before and after. Only numbers come back: the key itself is sent in the Authorization header and never
// printed, recorded or put into an error message; the response body is never echoed.
import fs from 'node:fs';

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
/** The line Mindcraft's OpenRouter model prints once per request (src/models/openrouter.js). */
export const LLM_CALL_LINE = 'Awaiting openrouter api response...';

/** The test-mode overrides of the spend machinery; never honoured in a real batch (#122 review). */
export const TEST_OVERRIDES = ['ROTN_TEST_MODE', 'ROTN_OPENROUTER_USAGE_FILE', 'ROTN_BATCH_RUNNER'];

/**
 * Are the test-mode overrides allowed? Only with ROTN_TEST_MODE=1, and only offline: either outside any
 * test-server run (no TEST_SERVER_CTL), or inside one that runs against the fake cloud
 * (TEST_SERVER_FAKE_CLOUD=1, which deploy/test-server.sh run sets itself, never inherited).
 */
export const testOverridesAllowed = (env) => env.ROTN_TEST_MODE === '1' && (!env.TEST_SERVER_CTL || env.TEST_SERVER_FAKE_CLOUD === '1');

/**
 * fetch for the key endpoint. Test mode only (testOverridesAllowed): ROTN_OPENROUTER_USAGE_FILE holds the
 * JSON response, read at each call, so offline tests (and fake runners that "spend") need no network.
 * Otherwise the real endpoint is always used, so the key can never be sent anywhere else.
 */
export function keyFetch(env, realFetch = globalThis.fetch) {
    if (testOverridesAllowed(env) && env.ROTN_OPENROUTER_USAGE_FILE) {
        const file = env.ROTN_OPENROUTER_USAGE_FILE;
        return () => {
            const body = fs.readFileSync(file, 'utf8');
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(body)) });
        };
    }
    return realFetch;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * GET the key's usage: {ok: true, usage, limit, remaining} (USD; limit/remaining may be null), or
 * {ok: false, error} where error is 'no key' | 'http <status>' | 'timeout' | 'network' | 'bad response'.
 */
export async function readKeyUsage({ key, fetchImpl = globalThis.fetch, url = OPENROUTER_KEY_URL, timeoutMs = 15000 }) {
    if (!key) return { ok: false, error: 'no key' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${key}` }, signal: ctl.signal });
        if (!res.ok) return { ok: false, error: `http ${res.status}` };
        let body;
        try {
            body = await res.json();
        } catch {
            return { ok: false, error: 'bad response' };
        }
        const d = body?.data;
        const usage = num(d?.usage);
        if (usage === null) return { ok: false, error: 'bad response' };
        return { ok: true, usage, limit: num(d?.limit), remaining: num(d?.limit_remaining) };
    } catch (e) {
        return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
        clearTimeout(timer);
    }
}

/** LLM requests in a driver's output (Mindcraft prints LLM_CALL_LINE once per request). */
export const countLlmCalls = (lines) => lines.filter((l) => l.includes(LLM_CALL_LINE)).length;

/** USD spent between two readings, to a millionth of a dollar; null if either is missing. */
export function spent(before, after) {
    if (!before?.ok || !after?.ok) return null;
    return Math.round((after.usage - before.usage) * 1e6) / 1e6;
}

/**
 * The models the Mindcraft driver started the agent with, from its `mindcraft_start` event
 * ({model, code_model, vision_model}), or null when the driver reported none.
 */
export function agentModels(outputLines) {
    for (const l of outputLines ?? []) {
        if (!l.startsWith('DRIVER ')) continue;
        try {
            const e = JSON.parse(l.slice(7));
            if (e?.type === 'mindcraft_start' && e.models && typeof e.models === 'object') return e.models;
        } catch { /* not an event */ }
    }
    return null;
}

/** result.llm for one scenario: the models, calls, the two readings and the cost; error names a reading that failed. */
export function llmRecord(before, after, outputLines) {
    return {
        // The model of the run (the human's decision: openrouter/@preset/glm-5-1-mindcraft for every LLM run).
        models: agentModels(outputLines),
        calls: countLlmCalls(outputLines),
        usageBefore: before?.ok ? before.usage : null,
        usageAfter: after?.ok ? after.usage : null,
        usd: spent(before, after),
        error: before?.ok && after?.ok ? null : (before?.ok ? after?.error : before?.error) ?? 'no reading',
    };
}
