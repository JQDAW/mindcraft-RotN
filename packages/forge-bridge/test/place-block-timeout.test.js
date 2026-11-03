// The placeBlock wait for the server's block update is configurable (skills-rotn
// Request 2, item 3; seam-map C): patches/mineflayer+4.33.0.patch (place_block.js)
// and initBot (MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS or settings.place_block_timeout_ms).
// Offline: mineflayer's real place_block plugin on a stub bot, and initBot against
// a loopback server that hangs up at once.

import process from 'node:process';
import net from 'node:net';
import { setImmediate } from 'node:timers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3');
const injectPlaceBlock = require('mineflayer/lib/plugins/place_block.js');

// A stub bot: _genericPlace "sends" the packet, and the server's block update
// arrives after `lagMs`, as on a lagging server.
function stubBot(lagMs, injectOptions) {
    const bot = new EventEmitter();
    const air = { type: 0, name: 'air' };
    const cobble = { type: 4, name: 'cobblestone' };
    let placed = false;
    bot.blockAt = (pos) => (pos.y === 65 && placed ? cobble : pos.y === 64 ? cobble : air);
    bot._genericPlace = (ref, face) => {
        const dest = ref.position.plus(face);
        setTimeout(() => { placed = true; bot.emit(`blockUpdate:${dest}`, air, cobble); }, lagMs);
        return Promise.resolve(dest);
    };
    injectPlaceBlock(bot, injectOptions);
    return bot;
}
const floor = { position: new Vec3(6, 64, 6) };
const up = new Vec3(0, 1, 0);

test('default: 500 ms, so an 800 ms server makes placeBlock fail (Mindcraft behaviour kept)', async () => {
    const bot = stubBot(800);
    assert.equal(bot.placeBlockTimeout, 500);
    const t0 = Date.now();
    await assert.rejects(bot.placeBlock(floor, up), /blockUpdate:\(6, 65, 6\) did not fire within timeout of 500ms/);
    const took = Date.now() - t0;
    assert.ok(took >= 450 && took < 790, `failed after ${took} ms`);
});

test('createBot option placeBlockTimeout: the same 800 ms server now succeeds', async () => {
    const bot = stubBot(800, { placeBlockTimeout: 2000 });
    const placed = once(bot, 'blockPlaced');
    await bot.placeBlock(floor, up);
    const [, newBlock] = await placed;
    assert.equal(newBlock.name, 'cobblestone');
});

test('bot.placeBlockTimeout at runtime, and { timeout } per call, override it', async () => {
    const bot = stubBot(300);
    bot.placeBlockTimeout = 100;
    await assert.rejects(bot.placeBlock(floor, up), /did not fire within timeout of 100ms/);
    const bot2 = stubBot(300);
    bot2.placeBlockTimeout = 1000;
    await bot2.placeBlock(floor, up);
    const bot3 = stubBot(300, { placeBlockTimeout: 100 });
    await bot3._placeBlockWithOptions(floor, up, { swingArm: 'right', timeout: 1000 });
});

test('a fast server still returns at once, whatever the timeout', async () => {
    const bot = stubBot(20, { placeBlockTimeout: 10000 });
    const t0 = Date.now();
    await bot.placeBlock(floor, up);
    assert.ok(Date.now() - t0 < 1000);
});

// initBot: start it offline against a loopback server that hangs up, and read the
// value the place_block plugin got (plugins inject right after createBot when the
// version is pinned and forge-bridge is off).
async function initBotTimeout({ env, setting }) {
    const hangup = net.createServer((s) => s.destroy());
    hangup.listen(0, '127.0.0.1');
    await once(hangup, 'listening');
    const { setSettings } = await import('../../../src/agent/settings.js');
    const { initBot } = await import('../../../src/utils/mcdata.js');
    process.env.FORGE_BRIDGE = 'off';
    delete process.env.MINDCRAFT_PROFILES_FOLDER;
    if (env === undefined) delete process.env.MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS; else process.env.MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS = env;
    setSettings({ host: '127.0.0.1', port: hangup.address().port, auth: 'offline', minecraft_version: '1.12.2', ...(setting === undefined ? {} : { place_block_timeout_ms: setting }) });
    const warnings = [];
    const warn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    let bot;
    try {
        bot = initBot('FRCFLD');
        bot.on('error', () => {}); // the hang-up
        if (bot.placeBlockTimeout === undefined) await once(bot, 'inject_allowed');
        await new Promise((r) => setImmediate(r));
        return { value: bot.placeBlockTimeout, warnings };
    } finally {
        console.warn = warn;
        try { bot?.end(); bot?._client.socket?.destroy(); clearTimeout(bot?._client.closeTimer); } catch { /* ended */ }
        hangup.close();
    }
}

test('initBot passes settings.place_block_timeout_ms and MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS (env wins)', async () => {
    assert.equal((await initBotTimeout({})).value, 500, 'nothing configured: 500');
    assert.equal((await initBotTimeout({ setting: 2000 })).value, 2000, 'settings key');
    assert.equal((await initBotTimeout({ env: '1500', setting: 2000 })).value, 1500, 'env var overrides the setting');
    const bad = await initBotTimeout({ env: 'soon' });
    assert.equal(bad.value, 500);
    assert.ok(bad.warnings.some(w => w.includes('place_block_timeout_ms "soon" ignored')), bad.warnings.join('\n'));
    assert.equal((await initBotTimeout({ setting: 10 })).value, 500, 'below 50 ms is refused');
});
