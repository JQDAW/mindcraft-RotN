// Profile-fetch diagnostics (src/auth-diagnostics.js; G2 batch 2's "Failed to
// obtain profile data"). Offline: the real prismarine-auth fetchProfile, with a
// stubbed global fetch. Nothing token-like may reach the log.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { instrumentProfileFetch, describeProfileFetchError, loadJavaTokenManager } from '../src/auth-diagnostics.js';

const TokenManager = loadJavaTokenManager();
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

// Fake secrets: a JWT-shaped access token, and token-like text in the response body.
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLWJvdCJ9.' + 'Zm9vYmFyLXNpZ25hdHVyZS1ub3QtcmVhbA'.repeat(3);
const BODY = JSON.stringify({ error: 'TOO_MANY_REQUESTS', refresh_token: 'M.R3_BAY.fake-refresh-token-0123456789abcdefABCDEF', path: '/minecraft/profile' });
const TOKEN_LIKE = /eyJ[\w-]{8,}|Bearer|refresh_token|M\.R3_|[A-Za-z0-9_\-.]{24,}/;

const logs = [];
const calls = [];
let clock = 0;
assert.equal(instrumentProfileFetch({ log: (l) => logs.push(l), now: () => (clock += 400) }), true);
const fetchProfile = (token = ACCESS_TOKEN) => TokenManager.prototype.fetchProfile.call({}, token);
const stubFetch = (impl) => { globalThis.fetch = (url, opts) => { calls.push({ url: String(url), auth: opts?.headers?.Authorization }); return Promise.resolve(impl()); }; };

test('an HTTP failure logs the status and error class only, and rethrows the same error', async () => {
    logs.length = 0;
    stubFetch(() => new Response(BODY, { status: 429, statusText: 'Too Many Requests', headers: { 'content-type': 'application/json' } }));
    const err = await fetchProfile().then(() => null, (e) => e);
    assert.ok(err instanceof Error, 'prismarine-auth still throws (its caller turns that into "Failed to obtain profile data")');
    assert.match(err.message, /^429 /, 'the original error is rethrown unchanged');
    assert.equal(calls.at(-1).auth, `Bearer ${ACCESS_TOKEN}`, 'the real fetchProfile ran, with the token in its request');
    assert.deepEqual(logs, ['Minecraft profile fetch failed after 400 ms: HTTP 429 Too Many Requests (Error)']);
    assert.doesNotMatch(logs.join('\n'), TOKEN_LIKE);
    assert.ok(!logs.join('\n').includes('TOO_MANY_REQUESTS'), 'nothing from the response body');
});

test('a network failure logs the cause class and code, never its message (addresses, tokens)', async () => {
    logs.length = 0;
    const cause = Object.assign(new Error(`connect ETIMEDOUT 203.0.113.9:443 ${ACCESS_TOKEN}`), { code: 'ETIMEDOUT' });
    globalThis.fetch = () => Promise.reject(new TypeError('fetch failed', { cause }));
    const err = await fetchProfile().then(() => null, (e) => e);
    assert.ok(err instanceof TypeError);
    assert.deepEqual(logs, ['Minecraft profile fetch failed after 400 ms: no HTTP response (TypeError; cause Error ETIMEDOUT)']);
    assert.doesNotMatch(logs.join('\n'), TOKEN_LIKE);
    assert.ok(!logs.join('\n').includes('203.0.113.9'));
});

test('a success logs nothing; a 2xx with an error field is noted without its value', async () => {
    logs.length = 0;
    stubFetch(() => Response.json({ id: '0123456789abcdef0123456789abcdef', name: 'FRCFLD' }));
    assert.equal((await fetchProfile()).name, 'FRCFLD');
    assert.deepEqual(logs, []);
    stubFetch(() => Response.json({ error: 'NOT_FOUND', errorMessage: ACCESS_TOKEN }));
    assert.equal((await fetchProfile()).error, 'NOT_FOUND', 'the result is returned unchanged');
    assert.deepEqual(logs, ['Minecraft profile fetch answered after 400 ms with an error field (value not logged)']);
    assert.doesNotMatch(logs.join('\n'), TOKEN_LIKE);
});

test('instrumenting twice wraps once (one line per failure; the newest log function wins)', async () => {
    const second = [];
    assert.equal(instrumentProfileFetch({ log: (l) => second.push(l) }), true);
    logs.length = 0;
    stubFetch(() => new Response('nope', { status: 503 }));
    await fetchProfile().catch(() => {});
    assert.equal(second.length, 1);
    assert.match(second[0], /HTTP 503 Service Unavailable \(Error\)$/);
    assert.deepEqual(logs, []);
});

test('describeProfileFetchError never passes through odd names or codes', () => {
    const weird = Object.assign(new Error('x'), { name: 'Bearer eyJabc.def ghi', cause: { name: 'a b', code: 'token=abc' } });
    assert.deepEqual(describeProfileFetchError(weird), { status: null, statusName: null, errorClass: 'Error', causeClass: 'Object', causeCode: null });
    assert.deepEqual(describeProfileFetchError('a string'), { status: null, statusName: null, errorClass: 'String', causeClass: null, causeCode: null });
});
