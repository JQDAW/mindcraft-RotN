import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestsInsecureCoding, INSECURE_REFUSAL } from './insecure_guard.js';

test('truthy allow_insecure_coding is refused, matching the !newAction truthiness check', () => {
    for (const v of [true, 'yes', 'false', 1, {}, []]) {
        assert.equal(requestsInsecureCoding({ allow_insecure_coding: v }), true, JSON.stringify(v));
    }
});

test('false, missing or falsy allow_insecure_coding is allowed', () => {
    for (const s of [{ allow_insecure_coding: false }, {}, { allow_insecure_coding: 0 }, { allow_insecure_coding: '' },
        { allow_insecure_coding: null }]) {
        assert.equal(requestsInsecureCoding(s), false, JSON.stringify(s));
    }
});

test('non-object settings are not treated as a request', () => {
    for (const s of [null, undefined, 'x', 42]) assert.equal(requestsInsecureCoding(s), false);
});

test('the refusal message names the setting and the rule', () => {
    assert.match(INSECURE_REFUSAL, /allow_insecure_coding/);
    assert.match(INSECURE_REFUSAL, /stays off/);
});
