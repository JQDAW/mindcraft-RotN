// Offline test for the RotN profile (skills-rotn F1 start; human decision, 2026-11-03):
// the bot's LLM is the OpenRouter preset @preset/glm-5-1-mindcraft. The model map
// strips the "openrouter/" prefix; no network, no key needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profile = JSON.parse(readFileSync(new URL('../../profiles/rotn-bot.json', import.meta.url), 'utf8'));

test('the RotN profile resolves to api openrouter and model @preset/glm-5-1-mindcraft', async (t) => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    const { selectAPI } = await import('../models/_model_map.js');
    const chat = selectAPI(profile.model);
    assert.equal(chat.api, 'openrouter');
    assert.equal(chat.model, '@preset/glm-5-1-mindcraft');
});

test('the RotN profile: a valid bot name, no cheats, no embedding API that needs another key', async () => {
    const { validateNameFormat } = await import('./connection_handler.js');
    assert.equal(validateNameFormat(profile.name).success, true, profile.name);
    assert.notEqual(profile.cheat, true);
    assert.equal(profile.embedding, undefined, 'OpenRouter has no embeddings; Mindcraft falls back to word overlap');
    for (const key of ['code_model', 'vision_model'])
        assert.equal(profile[key], undefined, `${key} would call another model`);
});
