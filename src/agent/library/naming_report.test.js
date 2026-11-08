// G4 #2: the "[naming] <bot> near spawn: ..." and "[naming] <bot> entities +<secs>s: ..." journal lines
// (naming_report.js), read by harness-ops. A fake world behind mineflayer's findBlocks/blockAt and
// bot.entities; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import {
    namingLine, entityLine, blocksNearSpawn, entitiesNearSpawn, reportNamingNearSpawn, unknownName, unknownEntityName,
    NAMING_RADIUS, NAMING_TOP, NAMING_MIN_KINDS, NAMING_SCAN, ENTITY_SCAN,
} from './naming_report.js';
import { Agent } from '../agent.js';

const LINE_RE = /^\[naming\] (\S+) near spawn: (\d+) kinds; unknown (\d+);((?: \S+:\d+)*)$/;
const ENTITY_RE = /^\[naming\] (\S+) entities \+(\d+)s: (\d+) kinds; unknown (\d+);((?: \S+:\d+)*)$/;
const ENTRY_RE = /^(\S+):(\d+)$/; // the name is everything before the last ':'

/** A world: [name, count, type, meta] runs, one cell each; air elsewhere. findBlocks as mineflayer's (a predicate on Blocks). */
function worldBot(runs = [], entities = []) {
    let cells = [];
    const fill = (rs) => {
        cells = [];
        let i = 0;
        for (const [name, count, type = 1, metadata = 0] of rs)
            for (let k = 0; k < count; k++, i++) cells.push({ name, type, metadata, position: new Vec3(i % 16 - 8, 64 + Math.floor(i / 256), Math.floor(i / 16) % 16 - 8) });
    };
    fill(runs);
    const air = { name: 'air', type: 0, metadata: 0, position: new Vec3(0, 40, 0) };
    const calls = [];
    const self = { id: 0, type: 'player', name: 'player', username: 'FRCFLD', position: new Vec3(0, 64, 0) };
    const bot = {
        entity: self,
        entities: Object.fromEntries([[0, self], ...entities.map((e, i) => [i + 1, { id: i + 1, position: new Vec3(2, 64, 0), ...e }])]),
        findBlocks({ matching, maxDistance, count }) {
            calls.push({ maxDistance, count, fn: typeof matching === 'function' });
            return [...cells, air].filter(b => (typeof matching === 'function' ? matching(b) : matching.includes(b.type))).slice(0, count).map(b => b.position);
        },
        blockAt: (p) => [...cells, air].find(b => b.position.equals(p)) ?? null,
    };
    return { bot, calls, fill };
}
const parse = (line, re = LINE_RE) => {
    const m = re.exec(line);
    assert.ok(m, `matches the regex: ${line}`);
    const list = m[m.length - 1].trim();
    return { m, entries: list ? list.split(' ').map(e => { const x = ENTRY_RE.exec(e); return [x[1], Number(x[2])]; }) : [] };
};

test('G4 #2: normal block names: the kinds, unknown 0, the top kinds by count (ties by name), names only; air never counts', () => {
    const { bot, calls } = worldBot([['stone', 100], ['dirt', 60], ['dynamictrees:leaves0', 20], ['grass', 20], ['water', 5], ['undergroundbiomes:metamorphic_stone', 7]]);
    const line = namingLine('FRCFLD', blocksNearSpawn(bot));
    assert.equal(line, '[naming] FRCFLD near spawn: 6 kinds; unknown 0; stone:100 dirt:60 dynamictrees:leaves0:20 grass:20 undergroundbiomes:metamorphic_stone:7 water:5');
    const { m, entries } = parse(line);
    assert.deepEqual([m[2], m[3], entries.length], ['6', '0', 6]);
    assert.deepEqual(entries[2], ['dynamictrees:leaves0', 20], 'a modded name keeps its namespace; the count is after the last colon');
    assert.deepEqual(calls, [{ maxDistance: NAMING_RADIUS, count: 10000, fn: true }], 'the query !nearbyBlocks makes, by predicate');
    assert.equal(namingLine('FRCFLD', []), '[naming] FRCFLD near spawn: 0 kinds; unknown 0;');
});

test('G4 #2, #396 review 2: a block with no name (a state the registry does not know) is "#<type>:<meta>"; numeric and "unknown" names as they are; all count in unknown', () => {
    const { bot } = worldBot([['stone', 50], [undefined, 12, 4321, 2], [null, 3, 4322], ['1234', 4, 1234], ['4321:2', 2, 4321], ['unknown', 6, 99], ['rustic:unknown_block', 1, 98], ['', 1, 97, 5], ['dirt', 40]]);
    const line = namingLine('FRCFLD', blocksNearSpawn(bot));
    assert.equal(line, '[naming] FRCFLD near spawn: 9 kinds; unknown 7; stone:50 dirt:40 #4321:2:12 unknown:6 1234:4 #4322:0:3 4321:2:2 #97:5:1 rustic:unknown_block:1');
    const { m, entries } = parse(line);
    assert.equal(m[3], '7');
    assert.deepEqual(entries.find(e => e[0] === '#4321:2'), ['#4321:2', 12], 'type 4321, meta 2, 12 of them');
    for (const n of [undefined, null, '', ' ', '7', '7:3', 'unknown', 'mod:unknown', 'mod:unknown_block', 'unknown_thing']) assert.equal(unknownName(n), true, String(n));
    for (const n of ['stone', 'dynamictrees:leaves0', 'pyrotech:rock', 'quark:known_block', 'log:1']) assert.equal(unknownName(n), false, n);
});

test('G4 #2: at most the top NAMING_TOP (50) kinds are listed; kinds counts them all; unknown counts only listed kinds; deterministic', () => {
    const runs = Array.from({ length: 60 }, (_, i) => [`mod:block_${String(i).padStart(2, '0')}`, 100 - i]);
    runs.push([undefined, 1, 4321]);
    const blocks = blocksNearSpawn(worldBot(runs).bot);
    const { m, entries } = parse(namingLine('FRCFLD', blocks));
    assert.deepEqual([m[2], m[3], entries.length], ['61', '0', NAMING_TOP]);
    assert.deepEqual([entries[0], entries.at(-1)], [['mod:block_00', 100], ['mod:block_49', 51]]);
    assert.equal(namingLine('FRCFLD', [...blocks].reverse()), namingLine('FRCFLD', blocks));
});

test('G4 #2, #396 review 3: the entity line: as !entities lists them (16 blocks, no players, no items), names only, unknown counted', () => {
    const ents = [
        { name: 'cow', type: 'mob' }, { name: 'cow', type: 'mob' }, { name: 'zombie', type: 'mob' },
        { name: 'mocreatures:entity_12', type: 'mob' }, { name: null, entityType: 77, type: 'mob' }, { name: undefined, type: 'other' },
        { name: 'unknown', type: 'mob' }, { name: 'quark:crab', type: 'mob' },
        { name: 'player', type: 'player', username: 'JQDAW' }, { name: 'item', type: 'object' },
        { name: 'skeleton', type: 'mob', position: new Vec3(40, 64, 0) }, // 40 blocks away: not listed
    ];
    const { bot } = worldBot([], ents);
    const line = entityLine('FRCFLD', entitiesNearSpawn(bot), 0);
    // #396 nit 1: "unknown" and the nameless one are keyed by their type (#?: none known), like blocks.
    assert.equal(line, '[naming] FRCFLD entities +0s: 6 kinds; unknown 3; #?:2 cow:2 #77:1 mocreatures:entity_12:1 quark:crab:1 zombie:1');
    const { m } = parse(line, ENTITY_RE);
    assert.deepEqual([m[2], m[3], m[4]], ['0', '6', '3']);
    assert.ok(!line.includes('JQDAW') && !line.includes('item') && !line.includes('skeleton'));
    assert.equal(unknownEntityName('mod:entity_3'), true);
    assert.equal(unknownEntityName('zombie_players:zombie_player'), false);
    assert.equal(entityLine('FRCFLD', [], 240.4), '[naming] FRCFLD entities +240s: 0 kinds; unknown 0;');
});

/** A clock and a sleep that advances it; `at(ms, fn)` runs fn once the clock reaches ms. */
function fakeTime() {
    let t = 0;
    const hooks = [];
    return {
        now: () => t,
        sleep: (ms) => { t += ms; for (const h of hooks) if (!h.done && t >= h.ms) { h.done = true; h.fn(); } return Promise.resolve(); },
        at: (ms, fn) => hooks.push({ ms, fn, done: false }),
    };
}

test('#396 review 1: the block scan waits for the chunks (bounded) and scans again while fewer than NAMING_MIN_KINDS kinds; one line', async () => {
    assert.equal(NAMING_MIN_KINDS, 3);
    // The chunks come late: the first scan sees nothing; they are in by the second.
    const late = worldBot([]);
    let waits = 0;
    late.bot.waitForChunksToLoad = () => { waits++; return new Promise(() => {}); }; // never says: bounded
    const clock = fakeTime();
    clock.at(NAMING_SCAN.chunkWaitMs + 1, () => late.fill([['stone', 30], ['dirt', 20], ['grass', 5]]));
    const lines = [];
    await reportNamingNearSpawn(late.bot, 'FRCFLD', { now: clock.now, sleep: clock.sleep, log: (l) => lines.push(l) });
    assert.equal(waits, 2, 'waited for the chunks before each scan');
    assert.deepEqual(lines.filter(l => l.includes('near spawn:')), ['[naming] FRCFLD near spawn: 3 kinds; unknown 0; stone:30 dirt:20 grass:5']);
    // Never loaded: after NAMING_SCAN.tries scans the 0-kinds line (a FAIL for harness-ops), once.
    const never = worldBot([]);
    never.bot.waitForChunksToLoad = () => Promise.resolve();
    const lines2 = [];
    const c2 = fakeTime();
    await reportNamingNearSpawn(never.bot, 'FRCFLD', { now: c2.now, sleep: c2.sleep, log: (l) => lines2.push(l) });
    assert.deepEqual(lines2.filter(l => l.includes('near spawn:')), ['[naming] FRCFLD near spawn: 0 kinds; unknown 0;']);
    assert.equal(never.calls.length, NAMING_SCAN.tries);
    // Enough kinds at once: one scan.
    const ready = worldBot([['stone', 3], ['dirt', 2], ['sand', 1]]);
    const c3 = fakeTime();
    await reportNamingNearSpawn(ready.bot, 'FRCFLD', { now: c3.now, sleep: c3.sleep, log: () => {} });
    assert.equal(ready.calls.length, 1);
});

test('#396 review 3: the entity line comes with the block scan; with nothing near it is taken again every ENTITY_SCAN.retryMs (at most ENTITY_SCAN.tries), once', async () => {
    const w = worldBot([['stone', 3], ['dirt', 2], ['sand', 1]]);
    const clock = fakeTime();
    clock.at(ENTITY_SCAN.retryMs, () => { w.bot.entities[9] = { id: 9, name: 'cow', type: 'mob', position: new Vec3(3, 64, 0) }; });
    const lines = [];
    await reportNamingNearSpawn(w.bot, 'FRCFLD', { now: clock.now, sleep: clock.sleep, log: (l) => lines.push(l) });
    assert.deepEqual(lines, ['[naming] FRCFLD near spawn: 3 kinds; unknown 0; stone:3 dirt:2 sand:1', `[naming] FRCFLD entities +${ENTITY_SCAN.retryMs / 1000}s: 1 kinds; unknown 0; cow:1`]);
    // Nothing ever near: the last scan's empty line, once.
    const lines2 = [];
    const c2 = fakeTime();
    await reportNamingNearSpawn(worldBot([['stone', 3], ['dirt', 2], ['sand', 1]]).bot, 'FRCFLD', { now: c2.now, sleep: c2.sleep, log: (l) => lines2.push(l) });
    assert.equal(lines2.at(-1), `[naming] FRCFLD entities +${(ENTITY_SCAN.tries - 1) * ENTITY_SCAN.retryMs / 1000}s: 0 kinds; unknown 0;`);
    assert.equal(lines2.filter(l => l.includes(' entities ')).length, 1);
    // A bot that is gone stops it; a throwing world never throws out of it.
    const stopped = [];
    const c3 = fakeTime();
    await reportNamingNearSpawn(w.bot, 'FRCFLD', { now: c3.now, sleep: c3.sleep, log: (l) => stopped.push(l), stopped: () => true });
    assert.deepEqual(stopped, []);
    const c4 = fakeTime();
    await reportNamingNearSpawn({ findBlocks() { throw new Error('no world'); }, entity: {} }, 'FRCFLD', { now: c4.now, sleep: c4.sleep, log: () => {} });
});

test('G4 #2, #396 review 1 and 4: Agent.onSpawn starts the report in the background (the start does not wait for the chunks); two lines, once', async (t) => {
    const logs = [], order = [];
    t.mock.method(console, 'log', (...a) => {
        const l = a.join(' ');
        logs.push(l);
        if (l.startsWith('[naming] ')) order.push('naming');
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bot } = worldBot([['stone', 3], ['dirt', 2], ['sand', 1]], [{ name: 'cow', type: 'mob' }]);
    bot.waitForChunksToLoad = () => new Promise(() => {}); // slow chunks: bounded by NAMING_SCAN.chunkWaitMs
    const agent = Object.assign(Object.create(Agent.prototype), {
        name: 'FRCFLD', bot, task: { data: null },
        clearBotLogs() {}, _setupEventHandlers() { order.push('handlers'); }, startEvents() { order.push('events'); },
        checkAllPlayersPresent() {}, autostartAgenda() {},
    });
    const flush = () => new Promise(r => setImmediate(r));
    const done = agent.onSpawn({ spawnTimeout: null, save_data: null, init_message: null, load_mem: false, count_id: 0 });
    t.mock.timers.tick(1000);
    await flush();
    assert.deepEqual(order, ['handlers', 'events'], 'the start goes on while the chunks load');
    t.mock.timers.tick(10000);
    await done;
    t.mock.timers.tick(NAMING_SCAN.chunkWaitMs);
    await flush();
    await agent._namingReport;
    // (Date is not mocked here: the "+<secs>s" timing is checked with the fake clock above.)
    assert.deepEqual(logs.filter(l => l.startsWith('[naming] ')).map(l => l.replace(/ \+\d+s:/, ' +Ns:')), [
        '[naming] FRCFLD near spawn: 3 kinds; unknown 0; stone:3 dirt:2 sand:1',
        '[naming] FRCFLD entities +Ns: 1 kinds; unknown 0; cow:1',
    ]);
    assert.deepEqual(order, ['handlers', 'events', 'naming', 'naming']);
});

test('#396 review 4: the report is wired to the first spawn only: bot.once(\'spawn\') -> onSpawn -> reportNamingNearSpawn, not awaited', () => {
    const src = readFileSync(new URL('../agent.js', import.meta.url), 'utf8');
    assert.equal(src.split("this.bot.once('spawn', () => this.onSpawn(").length - 1, 1, 'onSpawn runs from bot.once(\'spawn\')');
    assert.ok(!/this\.bot\.on\('spawn', \(\) => this\.onSpawn/.test(src), 'never from bot.on (every respawn)');
    const body = src.slice(src.indexOf('async onSpawn('), src.indexOf('async _setupEventHandlers('));
    assert.equal(body.split('reportNamingNearSpawn(').length - 1, 1, 'started once, in onSpawn');
    assert.match(body, /this\._namingReport = reportNamingNearSpawn\(/, 'kept, not awaited');
    assert.equal(src.split('reportNamingNearSpawn(').length - 1, 1, 'nowhere else');
});

test('#396 nit 1: an unknown entity (type "other" with a name forge-bridge does not know, or "unknown") is keyed #<entityType>, else #<modId>:<modEntityTypeId>; a known name is kept', () => {
    const ents = [
        { name: 'mocreatures:entity_12', type: 'other', entityType: null, forge: { modId: 'mocreatures', modEntityTypeId: 12, nameKnown: false } },
        { name: 'mocreatures:entity_12', type: 'other', entityType: null, forge: { modId: 'mocreatures', modEntityTypeId: 12, nameKnown: false } },
        { name: 'iceandfire:entity_3', type: 'other', entityType: 300, forge: { modId: 'iceandfire', modEntityTypeId: 3, nameKnown: false } },
        { name: 'unknown', type: 'mob', entityType: 5 },
        { name: 'quark:crab', type: 'other', entityType: null, forge: { modId: 'quark', modEntityTypeId: 7, nameKnown: true } }, // known: kept
    ];
    const line = entityLine('FRCFLD', entitiesNearSpawn(worldBot([], ents).bot), 0);
    assert.equal(line, '[naming] FRCFLD entities +0s: 4 kinds; unknown 3; #mocreatures:12:2 #300:1 #5:1 quark:crab:1');
    assert.match(line, ENTITY_RE);
});

test('#396 nit 2: a failure is logged with safeError (one line, no stack)', async (t) => {
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const c = fakeTime();
    await reportNamingNearSpawn({ findBlocks() { throw new Error('no world'); }, entity: {} }, 'FRCFLD', { now: c.now, sleep: c.sleep, log: () => {} });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /^\[naming\] near spawn: could not read the world \(.*no world.*\)$/);
    assert.ok(!/\n\s*at /.test(warns[0]), 'no stack frames');
});

