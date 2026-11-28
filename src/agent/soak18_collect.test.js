// Soak 18 S18b (/home/rv/s18-plan-skills.md C): the free misses scale with a world rule's mean yield. rotn-data's
// grass-tinder (#674): grass by hand drops tinder about 1 time in 13 (countRange mean 0.077). With 6 free misses,
// !collectBlocks("pyrotech:tinder", 3) stopped after about 9 grass (0.7 tinder expected; soak 18 dl:1191-1294 got 0).
// Offline: the shared fake world, a grass field, a fixed 1-in-13 drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { fakeWorld } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import * as skills from './library/skills.js';
import { worldSources } from './library/rotn_sources.js';

const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };

/** A field of short grass (tallgrass:1) around the bot; every `every`-th grass broken drops one tinder. */
function grassField({ every = 13, rows = 9, onEach = () => {} } = {}) {
    let n = 0;
    const w = fakeWorld({
        at: new Vec3(0, 64, 0), pathfinder: 'teleport', timeOfDay: 1000,
        // Slot 5 (armour, never in items()) only puts pyrotech:tinder in the fake registry, as live (an item, counted).
        slots: { 5: ['pyrotech:tinder', 1] },
        onDig: (block) => { onEach(); return /tallgrass/.test(block.name) && ++n % every === 0 ? [['pyrotech:tinder', 1, 0]] : []; },
    });
    for (let x = -rows; x <= rows; x++) for (let z = -rows; z <= rows; z++) if (x || z) w.world.set(new Vec3(x, 64, z), 'tallgrass', 1);
    return { ...w, digs: () => n };
}

test('S18b: rotn-data\'s grass-tinder rule is there and its mean is low (the scaling\'s input)', () => {
    const rule = worldSources('pyrotech:tinder').find(s => s.id === 'grass-tinder');
    assert.ok(rule, 'rotn-data #674');
    assert.equal(rule.countRange?.min, 0);
    assert.ok(rule.countRange.mean < skills.COLLECT_LIMITS.lowYieldMean);
    assert.deepEqual([skills.COLLECT_LIMITS.freeMissMax, skills.COLLECT_LIMITS.freeMissMs], [60, 180_000]);
});

test('S18b: 3 tinder asked, 1 grass in 13 gives one: the collect goes on past 6 free misses and gets the 3 (was: about 9 grass, 0 tinder)', async (t) => {
    quiet(t);
    const w = grassField({ every: 13 });
    useRegistry(t, w.bot);
    await skills.collectBlock(w.bot, 'pyrotech:tinder', 3);
    assert.equal(w.digs(), 39, w.bot.output.slice(-600));
    assert.match(w.bot.output, /Collected 3 pyrotech:tinder\. It drops about 1 in 13 breaks of tallgrass: 39 broken\./);
});

test('S18b: the cap: at most 1.5 x num / mean breaks less the attempts (56 for 3 tinder), never more than freeMissMax', async (t) => {
    quiet(t);
    const w = grassField({ every: 1000, rows: 9 }); // no tinder at all
    useRegistry(t, w.bot);
    await skills.collectBlock(w.bot, 'pyrotech:tinder', 3);
    // 3 attempts plus ceil(1.5 * 3 / 0.077) - 3 = 56 free misses.
    assert.equal(w.digs(), 3 + 56, w.bot.output.slice(-400));
    assert.match(w.bot.output, /Collected 0 pyrotech:tinder\. It drops about 1 in 13 breaks of tallgrass: 59 broken\./);
    const many = grassField({ every: 1000, rows: 9 });
    __setRegistryForTest(many.bot.registry);
    await skills.collectBlock(many.bot, 'pyrotech:tinder', 10);
    assert.equal(many.digs(), 10 + 60, 'capped at freeMissMax');
});

test('S18b: free misses stop counting after freeMissMs from the first; then a zero break uses an attempt', async (t) => {
    quiet(t);
    let now = Date.now();
    const w = grassField({ every: 1000, onEach: () => { now += 10_000; } }); // each break takes 10 s
    useRegistry(t, w.bot);
    t.mock.method(Date, 'now', () => now);
    await skills.collectBlock(w.bot, 'pyrotech:tinder', 3, null, 64, { ...skills.COLLECT_LIMITS, totalMs: 1e12, blockMs: 1e12 });
    // 3 min of free misses at 10 s each (about 18), then the zero breaks use the attempts: more than the old 6, fewer than the cap's 56.
    assert.ok(w.digs() > 3 + skills.COLLECT_LIMITS.freeMisses && w.digs() < 3 + 56, `${w.digs()} breaks`);
});

test('S18b: a dead bush (sticks, mean 1) keeps its 6 free misses; no odds line', async (t) => {
    quiet(t);
    const w = fakeWorld({ at: new Vec3(0, 64, 0), pathfinder: 'teleport', timeOfDay: 1000, onDig: () => [] });
    for (let x = 2; x <= 22; x += 2) w.world.set(new Vec3(x, 64, 0), 'deadbush');
    useRegistry(t, w.bot);
    const rule = worldSources('stick').find(s => s.blocks?.some(b => /deadbush/.test(b.name ?? b)));
    assert.ok(rule && rule.countRange.mean >= skills.COLLECT_LIMITS.lowYieldMean, 'the dead bush rule is not low-yield');
    await skills.collectBlock(w.bot, 'stick', 1);
    assert.equal(w.calls.dug.length, 1 + skills.COLLECT_LIMITS.freeMisses, w.bot.output.slice(-400));
    assert.doesNotMatch(w.bot.output, /It drops about 1 in/);
});
