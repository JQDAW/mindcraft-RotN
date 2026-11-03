// The lead's G3 pick (2), 2026-11-03: the two mobs the research's hazard table names that rotn-data had
// not cited (STATUS G3 note, Mobs item 3): Fish's Undead Rising's parasite and weta, read from the
// pinned pack's jar (javap) and config. Offline: the catalog reads packages/rotn-data/3.3.4 only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRotnData } from '../src/catalog.js';

const pack = loadRotnData('3.3.4');
const ev = (n) => pack.threatOf(n).evidence.join(' ');

test('parasite: hostile, fight; it latches on when it touches a player, and dies on its own unattached', () => {
    const t = pack.threatOf('mod_lavacow:parasite');
    assert.deepEqual([t.level, t.reaction, t.ranged, t.source], ['hostile', 'fight', false, 'verified']);
    assert.match(t.summary, /latches on/);
    assert.match(t.summary, /16 s/);
    // The attach rule, its config switch, and where parasites come from on this pack.
    assert.match(ev('mod_lavacow:parasite'), /collideWithEntity \(func_82167_n\).*startRiding/);
    assert.match(ev('mod_lavacow:parasite'), /'parasite attacks by attaching onto target'=true/);
    assert.match(ev('mod_lavacow:parasite'), /host list lines 606-610 \(minecraft:zombie, mod_lavacow:zombiefrozen, mod_lavacow:zombiemushroom/);
    assert.match(ev('mod_lavacow:parasite'), /'vespa spawn rate'=0/);
    assert.match(ev('mod_lavacow:parasite'), /Not settled: /);
});

test('weta: not hostile, only retaliates, and does not spawn naturally on this pack', () => {
    const t = pack.threatOf('mod_lavacow:weta');
    // Its level stays 'none' (not IMob, no override); the entry gives the reaction a defensive mob needs.
    assert.deepEqual([t.level, t.reaction, t.ranged, t.source], ['none', 'ignore-unless-provoked', false, 'verified']);
    assert.match(t.summary, /does not spawn naturally/);
    assert.match(ev('mod_lavacow:weta'), /EntityAIOwnerHurtByTarget.*EntityAIOwnerHurtTarget.*EntityAIHurtByTarget/);
    assert.match(ev('mod_lavacow:weta'), /'weta spawn rate'=0/);
    assert.ok(!pack.nightThreats({ limit: 1000 }).some((x) => x.name === 'mod_lavacow:weta'), 'in no night spawn list');
});
