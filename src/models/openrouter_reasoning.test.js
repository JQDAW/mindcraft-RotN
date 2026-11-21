// reasoningLine: the hidden reasoning share of a completion (soak 7 spend). Offline: no network, no key.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let reasoningLine;
before(async () => {
    ({ reasoningLine } = await import('./openrouter.js'));
});

// test/runner/lib/survival.mjs llmUsage's pattern: the new line must never be counted as a usage line.
const USAGE_RE = /^\[openrouter\] usage prompt_tokens \S+, completion_tokens \S+, cost_usd (\S+)$/;

test('reasoningLine: the reasoning token count from completion_tokens_details', () => {
    const l = reasoningLine({ completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 750 } });
    assert.equal(l, '[openrouter] reasoning_tokens 750');
    assert.doesNotMatch(l, USAGE_RE);
    assert.equal(reasoningLine({ completion_tokens_details: { reasoning_tokens: 0 } }), '[openrouter] reasoning_tokens 0');
});

test('reasoningLine: no details means no line; odd values print unknown, never response text', () => {
    assert.equal(reasoningLine(undefined), null);
    assert.equal(reasoningLine({ prompt_tokens: 3 }), null);
    assert.equal(reasoningLine({ completion_tokens_details: null }), null);
    assert.equal(reasoningLine({ completion_tokens_details: {} }), '[openrouter] reasoning_tokens unknown');
    assert.equal(reasoningLine({ completion_tokens_details: { reasoning_tokens: 'sk-or-x' } }), '[openrouter] reasoning_tokens unknown');
    assert.equal(reasoningLine({ completion_tokens_details: { reasoning_tokens: -1 } }), '[openrouter] reasoning_tokens unknown');
    assert.equal(reasoningLine({ completion_tokens_details: { reasoning_tokens: Infinity } }), '[openrouter] reasoning_tokens unknown');
});
