// Offline test (rotn-lead, soak 13 cost): a memory summary asks OpenRouter for no reasoning
// (reasoning.effort none); a model that refuses the setting is asked again without it, once, and
// later calls send none. The OpenAI client is a stub; no network, and the key is a made-up placeholder.
//
// Not in src/models/ (src/models/_model_map.js imports every .js file there at agent startup;
// see openrouter_logging.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

// Not key-shaped (secret-scan); this file does not test key redaction.
const FAKE_KEY = 'test-placeholder-key';
const KEY_BEFORE = process.env.OPENROUTER_API_KEY;
let OpenRouter, reasoningSetting, Prompter;

before(async () => {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    ({ OpenRouter, reasoningSetting } = await import('../models/openrouter.js'));
});

after(() => {
    if (KEY_BEFORE === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = KEY_BEFORE;
});

const reply = (content = 'memory text') => ({
    provider: 'Stub',
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001, completion_tokens_details: { reasoning_tokens: 0 } },
});

function modelWith(create) {
    const model = new OpenRouter('vendor/some-model');
    const packs = [];
    model.openai = { chat: { completions: { create: (pack) => { packs.push(structuredClone(pack)); return create(pack, packs.length); } } } };
    return { model, packs };
}

function quiet(t) {
    const logs = [];
    const errors = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));
    return { logs, errors };
}

test('a call with { reasoning } sends it and logs one line; a call without sends no reasoning field', async (t) => {
    const { logs } = quiet(t);
    const { model, packs } = modelWith(() => Promise.resolve(reply()));
    assert.equal(await model.sendRequest([{ role: 'user', content: 'hi' }], 'system', null, { reasoning: { effort: 'none' } }), 'memory text');
    assert.deepEqual(packs[0].reasoning, { effort: 'none' });
    assert.equal(packs[0].stop, undefined, 'memory summaries still send no stop sequence');
    assert.ok(logs.includes('[openrouter] reasoning effort=none for this call'), logs.join('\n'));
    await model.sendRequest([{ role: 'user', content: 'hi' }], 'system');
    assert.ok(!('reasoning' in packs[1]), 'a normal call is unchanged');
    assert.equal(packs[1].stop, '*');
});

test('a 400 on a call that carried reasoning is retried once without it; later calls send none', async (t) => {
    const { errors } = quiet(t);
    const { model, packs } = modelWith((pack) => {
        if (pack.reasoning) { const e = new Error('400 Reasoning is mandatory for this endpoint and cannot be disabled.'); e.status = 400; return Promise.reject(e); }
        return Promise.resolve(reply('summary'));
    });
    assert.equal(await model.sendRequest([], 'system', null, { reasoning: { effort: 'none' } }), 'summary');
    assert.equal(packs.length, 2);
    assert.deepEqual(packs[0].reasoning, { effort: 'none' });
    assert.ok(!('reasoning' in packs[1]));
    assert.equal(errors.filter(l => /the reasoning setting may have been refused \(status 400\)/.test(l)).length, 1, errors.join('\n'));
    assert.equal(errors.filter(l => /the retry without the reasoning setting worked; sending none from now on/.test(l)).length, 1, errors.join('\n'));
    assert.equal(model.reasoningRefused, true);
    // From now on, no reasoning field and no retry.
    assert.equal(await model.sendRequest([], 'system', null, { reasoning: { effort: 'none' } }), 'summary');
    assert.equal(packs.length, 3);
    assert.ok(!('reasoning' in packs[2]));
});

test('404 and 422 are retried like 400; auth, payment, moderation, timeout, rate-limit and 5xx errors are not (one request, the usual failure reply)', async (t) => {
    quiet(t);
    for (const status of [404, 422]) {
        const { model, packs } = modelWith((pack) => { if (pack.reasoning) { const e = new Error(`${status}`); e.status = status; return Promise.reject(e); } return Promise.resolve(reply('ok')); });
        assert.equal(await model.sendRequest([], 'system', null, { reasoning: { effort: 'none' } }), 'ok', `status ${status}`);
        assert.equal(packs.length, 2, `status ${status}: one retry`);
    }
    for (const status of [401, 402, 403, 408, 409, 429, 500, 503]) {
        const { model, packs } = modelWith(() => { const e = new Error(`${status} failed`); e.status = status; return Promise.reject(e); });
        assert.equal(await model.sendRequest([], 'system', null, { reasoning: { effort: 'none' } }), 'My brain disconnected, try again.', `status ${status}`);
        assert.equal(packs.length, 1, `status ${status}: no retry`);
        assert.equal(model.reasoningRefused, undefined, `status ${status}: the setting is kept`);
    }
});

test('a 400 on a call without reasoning is not retried', async (t) => {
    quiet(t);
    const { model, packs } = modelWith(() => { const e = new Error('400 bad'); e.status = 400; return Promise.reject(e); });
    assert.equal(await model.sendRequest([], 'system'), 'My brain disconnected, try again.');
    assert.equal(packs.length, 1);
});

test('a retry that fails too gives the usual failure reply, and the setting is kept for later calls (a 400 not about reasoning, e.g. context too long)', async (t) => {
    quiet(t);
    const { model, packs } = modelWith(() => { const e = new Error('400 bad'); e.status = 400; return Promise.reject(e); });
    assert.equal(await model.sendRequest([], 'system', null, { reasoning: { effort: 'none' } }), 'My brain disconnected, try again.');
    assert.equal(packs.length, 2);
    assert.equal(model.reasoningRefused, undefined, 'no latch: the retry did not show the setting was the cause');
    await model.sendRequest([], 'system', null, { reasoning: { effort: 'none' } });
    assert.deepEqual(packs[2].reasoning, { effort: 'none' }, 'the next call still asks for no reasoning');
});

test('reasoningSetting: field=value pairs, unsafe characters replaced', () => {
    assert.equal(reasoningSetting({ effort: 'none' }), 'effort=none');
    assert.equal(reasoningSetting({ max_tokens: 512, exclude: true }), 'max_tokens=512,exclude=true');
    assert.equal(reasoningSetting({}), 'none');
    assert.equal(reasoningSetting({ effort: 'a b"c' }), 'effort=a?b?c');
});

test('promptMemSaving asks the chat model for no reasoning (fourth argument)', async () => {
    ({ Prompter } = await import('../models/prompter.js'));
    const calls = [];
    const fake = {
        profile: { saving_memory: 'Summarize: $TO_SUMMARIZE' },
        checkCooldown: async () => {},
        replaceStrings: (p) => Promise.resolve(p),
        _saveLog: async () => {},
        chat_model: { sendRequest: (...args) => { calls.push(args); return Promise.resolve('memory'); } },
    };
    assert.equal(await Prompter.prototype.promptMemSaving.call(fake, []), 'memory');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2], null, 'no stop sequence');
    assert.deepEqual(calls[0][3], { reasoning: { effort: 'none' } });
});
