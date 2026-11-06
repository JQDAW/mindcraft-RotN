// LLM spend for G3 (lead, #101 and #116 review): per-scenario LLM calls and cost, and the batch spend
// stop. The cost is the change in the OpenRouter key's `usage` (USD), read from OpenRouter's key endpoint
// before and after. Only numbers come back: the key itself is sent in the Authorization header and never
// printed, recorded or put into an error message; the response body is never echoed.
import fs from 'node:fs';

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
/** The line Mindcraft's OpenRouter model prints once per request (src/models/openrouter.js). */
export const LLM_CALL_LINE = 'Awaiting openrouter api response...';
/** The line Mindcraft prints for every reply it hands on (src/agent: "Generated response: ..."). */
export const LLM_REPLY_LINE = 'Generated response:';
/** Mindcraft's stand-in reply when the request failed (src/models: "My brain disconnected, try again."). */
export const LLM_FAILED_REPLY = 'My brain disconnected';
/** Mindcraft's other stand-in: a completion with no choices (src/models/openrouter.js returns it; #246 review 2). */
export const LLM_NO_RESPONSE = 'No response received.';
/** Mindcraft's line when the model answered with no text (null content; once per empty answer, at a line start). */
export const LLM_EMPTY_REPLY = 'Error: Generated response is not a string';
/** Mindcraft's line after a memory summary, which is an LLM request of its own (src/agent/history.js). */
export const LLM_MEMORY_LINE = 'Memory updated to:';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** The test-mode overrides of the spend machinery; never honoured in a real batch (#122 review). */
export const TEST_OVERRIDES = ['ROTN_TEST_MODE', 'ROTN_OPENROUTER_USAGE_FILE', 'ROTN_OPENROUTER_PROBE_FILE', 'ROTN_BATCH_RUNNER', 'ROTN_LLM_STOP_POLL_MS', 'ROTN_LLM_STOP_WINDOW_MS', 'ROTN_LLM_STOP_CAP_MS'];

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

/** LLM requests in a driver's output (Mindcraft prints LLM_CALL_LINE once per request), successful or not. */
export const countLlmCalls = (lines) => lines.filter((l) => l.includes(LLM_CALL_LINE)).length;

/**
 * The replies behind those requests (lead, after round 3: evidence must never count failed calls as calls).
 * - ok: the agent's replies, "Generated response:" lines that are not Mindcraft's failure stand-in;
 * - memory: memory summaries ("Memory updated to:"), LLM requests of their own;
 * - failed = disconnected (Mindcraft's stand-in replies "My brain disconnected, try again." and "No response
 *   received.") + empty (the model answered no text:
 *   "Error: Generated response is not a string"; round 3 continuation A had 3);
 * - httpErrors: {status: n} from "Error [429] (status 429)" lines (one per failed attempt).
 * In the round 3 logs, requests = ok + memory + empty (+ a request still waiting when the bot left).
 */
export function countLlmReplies(lines) {
    let ok = 0;
    let memory = 0;
    let disconnected = 0;
    let empty = 0;
    const httpErrors = {};
    for (const l of lines ?? []) {
        if (l.includes(LLM_REPLY_LINE)) {
            if (l.includes(LLM_FAILED_REPLY) || l.includes(LLM_NO_RESPONSE)) disconnected++;
            else ok++;
        }
        if (l.startsWith(LLM_EMPTY_REPLY)) empty++;
        // A memory summary whose request failed stores the stand-in itself ("Memory updated to:  My brain disconnected").
        if (l.startsWith(LLM_MEMORY_LINE)) {
            if (l.includes(LLM_FAILED_REPLY)) disconnected++;
            else memory++;
        }
        const m = /\bError \[(\d{3})\]/.exec(l);
        if (m) httpErrors[m[1]] = (httpErrors[m[1]] ?? 0) + 1;
    }
    return { ok, memory, failed: disconnected + empty, disconnected, empty, httpErrors };
}

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

/**
 * result.llm for one scenario: the models, calls (requests sent, successful or not), replies {ok, failed} and
 * httpErrors (countLlmReplies), the two readings and the cost; error names a reading that failed.
 */
export function llmRecord(before, after, outputLines) {
    return {
        // The model of the run (the human's decision: openrouter/@preset/glm-5-3-flash-cheap-reliable for every LLM run).
        models: agentModels(outputLines),
        calls: countLlmCalls(outputLines),
        ...(({ httpErrors, ...replies }) => ({ replies, httpErrors }))(countLlmReplies(outputLines)),
        usageBefore: before?.ok ? before.usage : null,
        usageAfter: after?.ok ? after.usage : null,
        usd: spent(before, after),
        error: before?.ok && after?.ok ? null : (before?.ok ? after?.error : before?.error) ?? 'no reading',
    };
}

/**
 * fetch for the LLM probe. Test mode only (testOverridesAllowed): ROTN_OPENROUTER_PROBE_FILE holds
 * {status, body} for the fake response; with no file in test mode the probe is skipped (returns null), so an
 * offline test never reaches the network. Otherwise the real endpoint.
 */
export function probeFetch(env, realFetch = globalThis.fetch) {
    if (testOverridesAllowed(env)) {
        const file = env.ROTN_OPENROUTER_PROBE_FILE;
        if (!file) return null;
        return () => {
            const { status = 200, body = {} } = JSON.parse(fs.readFileSync(file, 'utf8'));
            return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
        };
    }
    return realFetch;
}

/**
 * One tiny chat request to the run's model (lead, after round 3: the old preset's provider answered 429 for
 * hours). Returns {ok, status, provider, model, error}: error is a short reason (the provider's error code, or
 * 'no key' | 'timeout' | 'network' | 'bad response'). Only those fields come back: the key goes only into the
 * Authorization header, and the response body is never echoed whole.
 */
export async function probeModel({ key, model, fetchImpl = globalThis.fetch, url = OPENROUTER_CHAT_URL, timeoutMs = 30000 }) {
    if (!key) return { ok: false, status: null, provider: null, model: null, error: 'no key' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: 'POST', signal: ctl.signal,
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }),
        });
        let body = null;
        try { body = await res.json(); } catch { /* not JSON */ }
        const meta = body?.error?.metadata ?? {};
        const cap = (v) => (v === null || v === undefined ? null : String(v).slice(0, 80));   // #246 review 4
        const out = { status: res.status, provider: cap(body?.provider ?? meta.provider_name), model: cap(body?.model) };
        // A 200 can still be a failure (#246 review 1): OpenRouter sometimes reports a provider failure as a 200
        // with `error` in the body and no `choices`. Empty `content` in a real choice still passes.
        if (res.ok && !body?.error && Array.isArray(body?.choices) && body.choices.length > 0) return { ok: true, ...out, error: null };
        const code = meta.provider_error_code ?? body?.error?.code ?? null;
        const why = code !== null ? cap(code) : res.ok ? (body?.error ? 'error in a 200 response' : 'no choices in the response') : 'bad response';
        return { ok: false, ...out, error: why };
    } catch (e) {
        return { ok: false, status: null, provider: null, model: null, error: e?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
        clearTimeout(timer);
    }
}
