// Offline unit tests for src/agent/safe_error.js (skills-rotn A1, log hygiene).
// All secrets below are made-up placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeError, safeStack, redact } from './safe_error.js';

const FAKE_KEY = 'sk-or-v1-0123456789abcdefABCDEF0123456789abcdef';
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJlLWZha2U';
const FAKE_BLOB = 'EwBwA8l6BAAU7p9QDpi/D7xs9pLmT6x4Q2Rk3Yz8Jh0Wq1Vb5Nc7Gd2Fe4Hf6Ig9Kl0Mn';

function axiosLikeError() {
    const err = new Error('Request failed with status code 401');
    err.name = 'AxiosError';
    err.code = 'ERR_BAD_REQUEST';
    err.config = { headers: { Authorization: `Bearer ${FAKE_KEY}` }, data: '{"prompt":"secret body"}' };
    err.response = { status: 401, headers: { 'set-cookie': 'session=abc' }, data: { error: 'body text' } };
    return err;
}

test('an HTTP client error prints name, code, status and message only', () => {
    const line = safeError(axiosLikeError());
    assert.equal(line, 'AxiosError [ERR_BAD_REQUEST] (status 401): Request failed with status code 401');
    for (const leak of [FAKE_KEY, 'Bearer', 'secret body', 'body text', 'session=abc']) {
        assert.ok(!line.includes(leak), `leaked ${leak}`);
    }
});

test('an SDK-style error with a numeric status and headers', () => {
    const err = new Error('401 No auth credentials found');
    err.status = 401;
    err.headers = { authorization: `Bearer ${FAKE_KEY}` };
    err.error = { message: 'No auth credentials found', body: 'raw' };
    assert.equal(safeError(err), 'Error (status 401): 401 No auth credentials found');
});

test('credentials inside the message itself are redacted', () => {
    const err = new Error(`call failed: Authorization: Bearer ${FAKE_KEY} url=https://x.test/?api_key=abc123&token=${FAKE_JWT} raw ${FAKE_BLOB}`);
    const line = safeError(err, { maxLength: 1000 });
    assert.ok(!line.includes(FAKE_KEY));
    assert.ok(!line.includes('abc123'));
    assert.ok(!line.includes('eyJhbGci'));
    assert.ok(!line.includes(FAKE_BLOB.slice(0, 20)));
    assert.ok(line.includes('[redacted'));
});

test('redact covers each pattern on its own', () => {
    assert.equal(redact(`key ${FAKE_KEY}`), 'key [redacted-key]');
    assert.equal(redact(`t ${FAKE_JWT}`), 't [redacted-token]');
    assert.equal(redact('Basic dXNlcjpwYXNz'), 'Basic [redacted]');
    assert.equal(redact('{"access_token": "abc.def"}'), '{"access_token": "[redacted]"}');
    assert.equal(redact('password=hunter2;'), 'password=[redacted];');
    assert.equal(redact(FAKE_BLOB), '[redacted-blob]');
});

test('file paths, hashes and ordinary words are not redacted', () => {
    const path = '/home/deploy/mindcraft-rotn/src/agent/library/skills.js:1234:56';
    assert.equal(redact(path), path);
    const winPath = 'C:/Users/admin/orca/workspaces/mindcraft-RotN/skills-rotn-g3/src/agent/agent.js';
    assert.equal(redact(winPath), winPath);
    const sha = '232c3ad2de73191532f73435196c522eaafb2b7ff5751bbe3a3cf64fbcf04aba';
    assert.equal(redact(sha), sha);
    assert.equal(redact('Duplicate login ECONNREFUSED'), 'Duplicate login ECONNREFUSED');
});

test('multi-line messages become one line and long ones are capped', () => {
    const err = new Error('first line\nsecond line\n' + 'x '.repeat(400));
    const line = safeError(err);
    assert.ok(!line.includes('\n'));
    assert.ok(line.length <= 300);
    assert.ok(line.endsWith('...'));
    assert.ok(line.startsWith('Error: first line second line'));
});

test('non-Error values', () => {
    assert.equal(safeError(undefined), 'unknown error');
    assert.equal(safeError(null), 'unknown error');
    assert.equal(safeError(`plain string ${FAKE_KEY}`), 'plain string [redacted-key]');
    assert.equal(safeError(42), '42');
    // A plain object is never stringified whole.
    assert.equal(safeError({ headers: { Authorization: 'Bearer x' }, body: 'b' }), 'Object');
    assert.equal(safeError({ message: 'boom', body: 'secret' }), 'Object: boom');
});

test('one level of cause is included, and redacted', () => {
    const err = new Error('outer', { cause: new Error(`inner ${FAKE_KEY}`, { cause: new Error('deepest') }) });
    assert.equal(safeError(err), 'Error: outer (cause: Error: inner [redacted-key])');
});

test('a throwing getter cannot make it throw', () => {
    const err = new Error('boom');
    Object.defineProperty(err, 'code', { get() { throw new Error('getter'); } });
    assert.equal(safeError(err), 'Error: boom');
    const evil = new Proxy({}, { get() { throw new Error('trap'); } });
    assert.equal(typeof safeError(evil), 'string');
    assert.equal(typeof safeStack(evil), 'string');
});

test('long codes are dropped, short ones kept', () => {
    const err = new Error('x');
    err.code = 'A'.repeat(41);
    assert.equal(safeError(err), 'Error: x');
    err.code = 'ECONNRESET';
    assert.equal(safeError(err), 'Error [ECONNRESET]: x');
});

test('safeStack keeps the frames and replaces the raw first line', () => {
    const err = new Error(`bad ${FAKE_KEY}`);
    const out = safeStack(err);
    const lines = out.split('\n');
    assert.equal(lines[0], 'Error: bad [redacted-key]');
    assert.ok(lines.length > 1 && lines.length <= 9);
    assert.ok(lines.slice(1).every(l => l.startsWith('    at ')));
    assert.ok(!out.includes(FAKE_KEY));
    assert.match(out, /safe_error\.test\.js/);
});

test('safeStack without a stack is just the summary', () => {
    assert.equal(safeStack('just text'), 'just text');
    const err = new Error('m');
    err.stack = undefined;
    assert.equal(safeStack(err), 'Error: m');
});
