import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageLine } from './openrouter.js';

const RE = /^\[openrouter\] usage prompt_tokens (\d+|unknown), completion_tokens (\d+|unknown), cost_usd ([0-9.e-]+|unknown)$/;

test('usageLine: numbers from OpenRouter usage accounting', () => {
    const l = usageLine({ prompt_tokens: 1200, completion_tokens: 85, cost: 0.000412 });
    assert.equal(l, '[openrouter] usage prompt_tokens 1200, completion_tokens 85, cost_usd 0.000412');
    assert.match(l, RE);
});

test('usageLine: missing or odd values print unknown, never text from the response', () => {
    assert.equal(usageLine(undefined), '[openrouter] usage prompt_tokens unknown, completion_tokens unknown, cost_usd unknown');
    const l = usageLine({ prompt_tokens: '12', completion_tokens: -1, cost: 'sk-or-x' });
    assert.equal(l, '[openrouter] usage prompt_tokens unknown, completion_tokens unknown, cost_usd unknown');
    assert.equal(usageLine({ prompt_tokens: 3, completion_tokens: NaN, cost: Infinity }), '[openrouter] usage prompt_tokens 3, completion_tokens unknown, cost_usd unknown');
});

test('usageLine never matches the provider line the G3 spend parser counts', () => {
    assert.doesNotMatch(usageLine({}), /^\[openrouter\] provider /);
});
