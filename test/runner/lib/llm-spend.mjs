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
/** Mindcraft's line before a memory summary's request (src/agent/history.js, summarizeMemories). */
export const LLM_MEMORY_START = 'Storing memories...';
/** The agent process's line when it ends (src/process/agent_process.js); a summary still open then never answered. */
export const AGENT_EXIT_LINE = 'Agent process exited with code';
/** history.js (since round 5 A) when a summary's reply was not a memory: a failure stand-in, empty or null. */
export const MEMORY_RETURNED_LINE = '[memory] summary returned ';
/** history.js when the summary request threw. */
export const MEMORY_THROW_LINE = '[memory] summary failed';
/** openrouter.js when a request failed (no completion, so no provider line). */
export const LLM_REQUEST_ERROR = 'Error while awaiting response';
/**
 * openrouter.js's line per completion (lead, #271): "[openrouter] provider <name>, finish_reason <reason>,
 * content <n|null> chars". Both fields are sanitised to [\w .-] (others become ?), at most 40 characters.
 * Content null or 0 is an empty answer.
 */
export const PROVIDER_LINE = /^\[openrouter\] provider ([\w .?-]{1,40}), finish_reason ([\w .?-]{1,40}), content (\d+|null) chars$/;
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
 *   "Error: Generated response is not a string"; round 3 continuation A had 3) + memoryEmpty;
 * - memoryEmpty (part of empty): memory summaries that got no text back (lead, round 5 A, where a null
 *   summary reply crashed the agent five times and none of it was counted). A summary is open from
 *   "Storing memories..." until its outcome:
 *   - "Memory updated to:" stores it (memory), or is empty when nothing (or "null") follows; the stand-ins
 *     after it are disconnected (logs before #266);
 *   - "[memory] summary returned ..." (history.js since round 5 A) is disconnected for "My brain disconnected",
 *     else empty ("No response received.", which openrouter.js returns for empty content since #266, an empty
 *     or a null reply); "[memory] summary failed (...)" (a throw) is disconnected;
 *   - the next summary's start, or the agent process exiting with a non-zero code (#267 review), while it is
 *     open makes it empty. A summary still open when the log ends, or at an exit with code 0 or a signal (the
 *     bot was stopped while its request waited), is not counted, like any request still waiting.
 * - httpErrors: {status: n} from "Error [429] (status 429)" lines (one per failed attempt).
 * - providers / summariesUnattributed: see the provider line below (lead, after round 5 B).
 * In the round 3 logs, requests = ok + memory + empty (+ a request still waiting when the bot left);
 * a reply Mindcraft discards for a newer message ("discarding old response") is a request with no reply line.
 */
export function countLlmReplies(lines) {
    let ok = 0;
    let memory = 0;
    let disconnected = 0;
    let empty = 0;
    let memoryEmpty = 0;
    const httpErrors = {};
    const providers = {};
    const summariesUnattributed = { ok: 0, empty: 0, failed: 0 };
    let summary = null;   // the open summary: {providers: [names seen since it started], requestError}
    const prov = (name) => (providers[name] ??= { requests: 0, empty: 0, summaries: { ok: 0, empty: 0, failed: 0 } });
    const closeSummary = (outcome) => {
        if (!summary) return;
        if (outcome === 'ok') memory++;
        else if (outcome === 'empty') memoryEmpty++;
        else disconnected++;
        // Attributed only when exactly one completion came back while it was open and no request failed then:
        // that completion was the summary's own. Anything else is never guessed.
        const key = outcome === 'ok' ? 'ok' : outcome === 'empty' ? 'empty' : 'failed';
        if (summary.providers.length === 1 && !summary.requestError) prov(summary.providers[0]).summaries[key]++;
        else summariesUnattributed[key]++;
        summary = null;
    };
    for (const l of lines ?? []) {
        if (l.includes(LLM_REPLY_LINE)) {
            if (l.includes(LLM_FAILED_REPLY) || l.includes(LLM_NO_RESPONSE)) disconnected++;
            else ok++;
        }
        if (l.startsWith(LLM_EMPTY_REPLY)) empty++;
        const p = PROVIDER_LINE.exec(l);
        if (p) {
            const s = prov(p[1]);
            s.requests++;
            if (p[3] === 'null' || p[3] === '0') s.empty++;
            summary?.providers.push(p[1]);
        }
        if (l.startsWith(LLM_REQUEST_ERROR) && summary) summary.requestError = true;
        if (l.startsWith(LLM_MEMORY_START)) {
            closeSummary('empty');
            summary = { providers: [], requestError: false };
        }
        const exit = /^Agent process exited with code (-?\d+)/.exec(l);
        if (exit && exit[1] !== '0') closeSummary('empty');
        else if (l.startsWith(AGENT_EXIT_LINE)) summary = null;   // code 0, or a signal: still waiting, not counted
        if (l.startsWith(LLM_MEMORY_LINE)) {
            const stored = l.slice(LLM_MEMORY_LINE.length).trim();
            summary ??= { providers: [], requestError: true };   // no start line seen: never attributed
            if (l.includes(LLM_FAILED_REPLY) || l.includes(LLM_NO_RESPONSE)) closeSummary('failed');
            else if (stored === '' || stored === 'null' || stored === 'undefined') closeSummary('empty');
            else closeSummary('ok');
        }
        if (l.startsWith(MEMORY_RETURNED_LINE) || l.startsWith(MEMORY_THROW_LINE)) {
            summary ??= { providers: [], requestError: true };
            closeSummary(l.startsWith(MEMORY_THROW_LINE) || l.includes(LLM_FAILED_REPLY) ? 'failed' : 'empty');
        }
        const m = /\bError \[(\d{3})\]/.exec(l);
        if (m) httpErrors[m[1]] = (httpErrors[m[1]] ?? 0) + 1;
    }
    empty += memoryEmpty;
    return { ok, memory, failed: disconnected + empty, disconnected, empty, memoryEmpty, httpErrors, providers, summariesUnattributed };
}

/** "provider X: 12 requests (3 empty), summaries 2 ok, 1 empty" per provider, for the run log and the READMEs. */
export function providerSummary(providers, unattributed) {
    const parts = Object.entries(providers ?? {}).map(([name, s]) =>
        `${name}: ${s.requests} requests (${s.empty} empty), summaries ${s.summaries.ok} ok, ${s.summaries.empty} empty${s.summaries.failed ? `, ${s.summaries.failed} failed` : ''}`);
    const u = unattributed ?? {};
    if ((u.ok ?? 0) + (u.empty ?? 0) + (u.failed ?? 0)) parts.push(`summaries not attributed: ${u.ok} ok, ${u.empty} empty${u.failed ? `, ${u.failed} failed` : ''}`);
    return parts.length ? parts.join('; ') : 'no provider lines';
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
        // providers: {name: {requests, empty, summaries: {ok, empty, failed}}} from openrouter.js's provider line (#271).
        ...(({ httpErrors, providers, summariesUnattributed, ...replies }) => ({ replies, httpErrors, providers, summariesUnattributed }))(countLlmReplies(outputLines)),
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
