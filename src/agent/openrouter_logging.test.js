// Offline test (lead-approved exception to skills-rotn's ownership, log hygiene
// before the first CX23 run): the OpenRouter provider never logs a whole error
// object or response body. The OpenAI client is a stub; no network, and the
// key is a made-up placeholder.
//
// This file must NOT live in src/models/: src/models/_model_map.js imports
// every .js file there at agent startup, so a test file there ran inside the
// bot and its before() hook replaced OPENROUTER_API_KEY with the fake key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

const FAKE_KEY = 'sk-or-v1-0123456789abcdefABCDEF0123456789abcdef';
const KEY_BEFORE = process.env.OPENROUTER_API_KEY;
let OpenRouter;

before(async () => {
    // Set before the constructor's getKey() runs; no real key is ever used.
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    ({ OpenRouter } = await import('../models/openrouter.js'));
});

after(() => {
    if (KEY_BEFORE === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = KEY_BEFORE;
});

function modelWith(create) {
    const model = new OpenRouter('vendor/some-model');
    model.openai = { chat: { completions: { create } } };
    return model;
}

function captureErrors(t) {
    const lines = [];
    t.mock.method(console, 'error', (...args) => lines.push(args));
    t.mock.method(console, 'log', () => {});
    return lines;
}

const flat = (lines) => lines.map(args => args.map(a => (typeof a === 'string' ? a : `<${typeof a}>`)).join(' ')).join('\n');

test('a thrown SDK error is logged as one safe line', async (t) => {
    const lines = captureErrors(t);
    const err = new Error('401 No auth credentials found');
    err.status = 401;
    err.headers = { authorization: `Bearer ${FAKE_KEY}`, 'set-cookie': 'session=abc' };
    err.error = { message: 'No auth credentials found', body: 'secret response body' };
    err.request = { headers: { Authorization: `Bearer ${FAKE_KEY}` }, body: '{"messages":"prompt text"}' };

    const res = await modelWith(() => Promise.reject(err)).sendRequest([], 'system');

    assert.equal(res, 'My brain disconnected, try again.');
    assert.equal(lines.length, 1);
    // Every logged argument is a string, never the error object itself.
    assert.ok(lines[0].every(a => typeof a === 'string'));
    const out = flat(lines);
    assert.match(out, /Error while awaiting response: Error \(status 401\): 401 No auth credentials found/);
    for (const leak of [FAKE_KEY, 'Bearer', 'session=abc', 'secret response body', 'prompt text']) {
        assert.ok(!out.includes(leak), `leaked ${leak}`);
    }
});

test('a response without choices logs its error summary, not the body', async (t) => {
    const lines = captureErrors(t);
    const completion = {
        id: 'gen-1',
        error: { code: 429, message: 'Rate limit exceeded', metadata: { raw: 'upstream body text', headers: { 'x-api-key': FAKE_KEY } } },
    };

    const res = await modelWith(() => Promise.resolve(completion)).sendRequest([], 'system');

    assert.equal(res, 'No response received.');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].every(a => typeof a === 'string'));
    const out = flat(lines);
    assert.match(out, /No completion or choices returned \(model vendor\/some-model\): Object \[429\]: Rate limit exceeded/);
    for (const leak of [FAKE_KEY, 'upstream body text', 'gen-1']) {
        assert.ok(!out.includes(leak), `leaked ${leak}`);
    }
});

test('an empty response says so without printing it', async (t) => {
    const lines = captureErrors(t);
    const res = await modelWith(() => Promise.resolve({ choices: [], usage: { prompt_tokens: 5 } })).sendRequest([], 'system');
    assert.equal(res, 'No response received.');
    assert.equal(flat(lines), 'No completion or choices returned (model vendor/some-model): no choices in the response');
});

test('an error whose message embeds a JSON body is cut before the body', async (t) => {
    const lines = captureErrors(t);
    const err = new Error(`400 {"error":{"message":"Provider returned error","metadata":{"raw":"upstream body text","key":"${FAKE_KEY}"}}}`);
    err.status = 400;

    const res = await modelWith(() => Promise.reject(err)).sendRequest([], 'system');

    assert.equal(res, 'My brain disconnected, try again.');
    assert.equal(flat(lines), 'Error while awaiting response: Error (status 400): 400 {...}');
});

test('null, missing or blank content is no reply, never null (G3 round 5 A)', async (t) => {
    // Mock once: re-mocking an already mocked console.error leaks past the test.
    const lines = captureErrors(t);
    for (const message of [{ content: null }, {}, { content: '   ' }, undefined]) {
        lines.length = 0;
        const res = await modelWith(() => Promise.resolve({ choices: [{ message, finish_reason: 'stop' }] })).sendRequest([], 'system');
        assert.equal(res, 'No response received.');
        assert.equal(flat(lines), 'Empty content returned (model vendor/some-model, finish_reason stop)');
    }
});

test('each completion logs one provider line: name, finish reason and length only', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
    t.mock.method(console, 'error', () => {});
    const m = modelWith(() => Promise.resolve({ provider: 'Wafer', choices: [{ message: { content: 'secret reply text' }, finish_reason: 'stop' }] }));
    assert.equal(await m.sendRequest([], 'system'), 'secret reply text');
    const line = logs.find(l => l.startsWith('[openrouter]'));
    assert.equal(line, '[openrouter] provider Wafer, finish_reason stop, content 17 chars');
    assert.ok(!logs.join('\n').includes('secret reply text'));

    logs.length = 0;
    await modelWith(() => Promise.resolve({ provider: 'Bad<script>\nname'.repeat(5), choices: [{ message: { content: null }, finish_reason: 'stop' }] })).sendRequest([], 'system');
    const l2 = logs.find(l => l.startsWith('[openrouter]'));
    assert.match(l2, /^\[openrouter\] provider [\w .?-]{1,40}, finish_reason stop, content null chars$/);

    logs.length = 0;
    await modelWith(() => Promise.resolve({ provider: 'P', choices: [{ message: { content: 'x' }, finish_reason: 'stop\n[openrouter] forged' }] })).sendRequest([], 'system');
    const l3 = logs.filter(l => l.startsWith('[openrouter]'));
    assert.equal(l3.length, 1);
    assert.match(l3[0], /^\[openrouter\] provider P, finish_reason [\w .?-]{1,40}, content 1 chars$/);

    logs.length = 0;
    await modelWith(() => Promise.resolve({ choices: [] })).sendRequest([], 'system');
    assert.equal(logs.find(l => l.startsWith('[openrouter]')), '[openrouter] provider unknown, finish_reason none, content null chars');
});

test('a null stop_seq sends no stop field; the default still sends "*"', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const packs = [];
    const create = (pack) => { packs.push(pack); return Promise.resolve({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }); };
    await modelWith(create).sendRequest([], 'system', null);
    await modelWith(create).sendRequest([], 'system');
    assert.ok(!('stop' in packs[0]));
    assert.equal(packs[1].stop, '*');
});

test('promptMemSaving asks with a user turn and no stop sequence (skills-rotn Request 16)', async () => {
    const { Prompter } = await import('../models/prompter.js');
    const calls = [];
    const fake = {
        profile: { saving_memory: 'Summarize: $TO_SUMMARIZE' },
        checkCooldown: async () => {},
        replaceStrings: async (p) => p,
        _saveLog: async () => {},
        chat_model: { sendRequest: async (...args) => { calls.push(args); return '**Memory** kept'; } },
    };
    const resp = await Prompter.prototype.promptMemSaving.call(fake, []);
    assert.equal(resp, '**Memory** kept');
    const [turns, system, stop] = calls[0];
    assert.equal(stop, null);
    assert.equal(system, 'Summarize: $TO_SUMMARIZE');
    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, 'user');
});

test('a normal response is unchanged', async (t) => {
    const lines = captureErrors(t);
    const res = await modelWith(() => Promise.resolve({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })).sendRequest([], 'system');
    assert.equal(res, 'hi');
    assert.equal(lines.length, 0);
});
