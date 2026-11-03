// Console replies that arrive after the console's own wait (test/runner/lib/late-console.mjs), offline.
// The main case replays P1 attempt 1 (2026-11-03) line for line: after `clear`, two mods saved, and the
// server answered `give FRCFLD pyrotech:rock 8 0` at 14:40:23, after that call's 1 s window.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { afterAnchor, lateConsole } from '../runner/lib/late-console.mjs';
import { giveVerdict } from '../runner/lib/g2.mjs';
import { clearTestCount } from '../runner/lib/s1.mjs';

const DS = 'net.minecraft.server.dedicated.DedicatedServer';
const L = (time, msg, logger = DS) => `[${time}] [Server thread/INFO] [${logger}]: ${msg}`;
const giveOk = (l) => giveVerdict(l, 'FRCFLD').ok;

/**
 * A fake test server like rotn-test: console(cmd) returns the log lines written during its wait; script
 * maps a command to the lines it writes NOW and the lines it writes LATER (after the wait, before the
 * next call). The clock advances by the wait and by each sleep.
 */
function fakeServer(script) {
    const log = [L('14:40:18', 'Teleported FRCFLD to -44.5, 66.0, -65.5')];
    let later = [];
    let t = 0;
    const flush = () => { log.push(...later); later = []; };
    const sent = [];
    const server = {
        console(cmd, waitS) {
            flush();
            sent.push(cmd);
            const before = log.length;
            const s = script[cmd] ?? { now: [], later: [] };
            log.push(...(s.now ?? []));
            later = [...(s.later ?? [])];
            t += waitS * 1000;
            return log.slice(before);
        },
        log(n) { flush(); return log.slice(-n); },
    };
    const clock = { now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); } };
    return { server, clock, log, sent };
}

// P1 attempt 1's lines after the clear (captures/raw/p1/server.log:57-62 of that run; no address in them).
const ATTEMPT1 = {
    'clear FRCFLD': {
        now: [L('14:40:20', 'Cleared the inventory of FRCFLD, removing 3 items')],
        later: [L('14:40:22', 'Saved 1 stages for FRCFLD.', 'gamestages'), L('14:40:22', 'Saving local markers data to NBT', 'antiqueatlas')],
    },
    'give FRCFLD pyrotech:rock 8 0': {
        now: [L('14:40:23', 'Mean tick: 29ms increasing chunk view distance to: 7', 'com.dynamic_view.DynView')],
        later: [L('14:40:23', 'Given    [Stone Rock] * 8 to FRCFLD')],
    },
    'give FRCFLD minecraft:stick 6 0': { now: [L('14:40:24', 'Given    [Stick] * 6 to FRCFLD')] },
};

describe('late console replies (P1 attempt 1)', () => {
    test('the exact case: the rock give answered after the 1 s window is confirmed from the later log lines', async () => {
        const f = fakeServer(ATTEMPT1);
        const lc = lateConsole(f.server, f.clock, { waitS: 1 });
        lc.con('clear FRCFLD');
        // Without the lookup (what attempt 1 did): the console's own lines have no Given line.
        const g = fakeServer(ATTEMPT1);
        g.server.console('clear FRCFLD', 1);
        assert.equal(giveOk(g.server.console('give FRCFLD pyrotech:rock 8 0', 1)), false, 'attempt 1: unconfirmed');
        // With it: confirmed, and the rescue is recorded.
        const rock = await lc.confirm('give FRCFLD pyrotech:rock 8 0', giveOk);
        assert.equal(giveOk(rock), true, rock.join('\n'));
        assert.match(giveVerdict(rock, 'FRCFLD').detail, /Given +\[Stone Rock\] \* 8 to FRCFLD/);
        assert.deepEqual(lc.late().map((x) => x.cmd), ['give FRCFLD pyrotech:rock']);
        assert.match(lc.late()[0].line, /Stone Rock/);
        // The next give is confirmed from its own lines, as before, and is not a rescue.
        assert.equal(giveOk(await lc.confirm('give FRCFLD minecraft:stick 6 0', giveOk)), true);
        assert.equal(lc.late().length, 1);
    });

    test('a reply from an EARLIER command is never taken for this one', async () => {
        // The first give is confirmed in its own window; the second (same count) never answers.
        const f = fakeServer({
            'give FRCFLD minecraft:cobblestone 8 0': { now: [L('14:40:30', 'Given    [Cobblestone] * 8 to FRCFLD')] },
            'give FRCFLD pyrotech:rock 8 0': { now: [] },
        });
        const lc = lateConsole(f.server, f.clock, { waitS: 1, lateMs: 3000, pollMs: 1000 });
        assert.equal(giveOk(await lc.confirm('give FRCFLD minecraft:cobblestone 8 0', giveOk)), true);
        const rock = await lc.confirm('give FRCFLD pyrotech:rock 8 0', giveOk);
        assert.equal(giveOk(rock), false, 'the cobblestone line is before the anchor');
        assert.equal(lc.late().length, 0);
        assert.ok(f.clock.now() >= 3000, 'it looked for lateMs, then gave up');
    });

    test('no reply at all: it gives up after lateMs and returns the console\'s own lines', async () => {
        const f = fakeServer({ 'clear FRCFLD pyrotech:rock -1 0': { now: [L('14:41:00', 'unrelated')] } });
        const lc = lateConsole(f.server, f.clock, { waitS: 1, lateMs: 5000, pollMs: 1000 });
        const t0 = f.clock.now();
        const lines = await lc.confirm('clear FRCFLD pyrotech:rock -1 0', (l) => clearTestCount(l, 'FRCFLD') !== null);
        assert.equal(clearTestCount(lines, 'FRCFLD'), null);
        assert.ok(f.clock.now() - t0 >= 5000 && f.clock.now() - t0 <= 7000, String(f.clock.now() - t0));
    });

    test('afterAnchor: the index after the LAST occurrence of the block; -1 if absent or empty', () => {
        assert.equal(afterAnchor(['a', 'b', 'c', 'a', 'b', 'd'], ['a', 'b']), 5);
        assert.equal(afterAnchor(['a', 'b'], ['x']), -1);
        assert.equal(afterAnchor(['a'], []), -1);
    });
});
