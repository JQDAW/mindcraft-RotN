// initBot refuses Microsoft auth without a per-bot token-cache folder, so a plain
// `node main.js` never falls back to nmp's shared default cache. Offline: it
// throws before any bot, socket or login is created.

import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('initBot with auth "microsoft" and no MINDCRAFT_PROFILES_FOLDER throws a clear error', async () => {
    delete process.env.MINDCRAFT_PROFILES_FOLDER;
    process.env.FORGE_BRIDGE = 'off';
    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host: '127.0.0.1', port: 1, auth: 'microsoft', minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');
    assert.throws(() => initBot('FRCFLD'), /auth is "microsoft" but MINDCRAFT_PROFILES_FOLDER is not set/);
});
