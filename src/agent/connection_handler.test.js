// Offline test (skills-rotn A1, #103 review finding 1): an Error that reaches
// the disconnect path is summarised safely, never JSON.stringify'd whole.
// No server; mindserver_proxy is imported but never connected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKickReason } from './connection_handler.js';
import { safeError } from './safe_error.js';

const FAKE_KEY = 'sk-or-v1-0123456789abcdefABCDEF0123456789abcdef';

function errorWithSecrets(message) {
    const err = new Error(message);
    err.code = 'ECONNREFUSED';
    err.config = { headers: { Authorization: `Bearer ${FAKE_KEY}` } };
    err.body = 'secret response body';
    return err;
}

test('an Error reason is classified from its safe summary, with no secrets', (t) => {
    const logged = [];
    t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
    const result = parseKickReason(errorWithSecrets('connect ECONNREFUSED: connection refused'));
    assert.equal(result.type, 'network_error');
    assert.equal(result.isFatal, false);
    const all = JSON.stringify(result) + logged.join('\n');
    for (const leak of [FAKE_KEY, 'secret response body', 'Authorization']) {
        assert.ok(!all.includes(leak), `leaked ${leak}`);
    }
});

test('the agent passes safeError(err) strings, which carry no secrets either', (t) => {
    t.mock.method(console, 'error', () => {});
    const result = parseKickReason(safeError(errorWithSecrets('Something unusual happened')));
    // The summary keeps the code ("Error [ECONNREFUSED]: ..."), so it classifies.
    assert.equal(result.type, 'network_error');
    assert.ok(!result.msg.includes(FAKE_KEY));
    assert.ok(!result.msg.includes('secret response body'));
});

test('kick reasons from the server (chat JSON) are unchanged', (t) => {
    t.mock.method(console, 'error', () => {});
    assert.equal(parseKickReason({ translate: 'multiplayer.disconnect.not_whitelisted' }).type, 'access_denied');
    assert.equal(parseKickReason('{"text":"Server closed"}').type, 'maintenance');
});
