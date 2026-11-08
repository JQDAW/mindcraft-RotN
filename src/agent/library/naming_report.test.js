// G4 #2: the "[naming] <bot> near spawn: ..." journal line (naming_report.js), read by harness-ops.
// A fake world (a map of positions to blocks) behind mineflayer's findBlocks/blockAt; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { namingLine, blocksNearSpawn, unknownName, NAMING_RADIUS, NAMING_TOP } from './naming_report.js';
import { Agent } from '../agent.js';

const LINE_RE = /^\[naming\] (\S+) near spawn: (\d+) kinds; unknown (\d+);((?: \S+:\d+)*)$/;
const ENTRY_RE = /^(\S+):(\d+)$/; // the name is everything before the last ':'

/** A world: [name, count, type] runs laid out from the bot outwards; air fills the rest. findBlocks as mineflayer's (a predicate on Blocks). */
function worldBot(runs) {
    const cells = [];
    let i = 0;
    for (const [name, count, type = 1] of runs)
        for (let k = 0; k < count; k++, i++) cells.push({ name, type, position: new Vec3(i % 16 - 8, 64 + Math.floor(i / 256), Math.floor(i / 16) % 16 - 8) }); // one cell each
    const calls = [];
    const bot = {
        entity: { position: new Vec3(0, 64, 0) },
        findBlocks({ matching, maxDistance, count }) {
            calls.push({ maxDistance, count, fn: typeof matching === 'function' });
            const all = [...cells, { name: 'air', type: 0, position: new Vec3(0, 40, 0) }];
            return all.filter(b => (typeof matching === 'function' ? matching(b) : matching.includes(b.type))).slice(0, count).map(b => b.position);
        },
        blockAt: (p) => [...cells, { name: 'air', type: 0, position: new Vec3(0, 40, 0) }].find(b => b.position.equals(p)) ?? null,
    };
    return { bot, calls };
}
const parse = (line) => {
    const m = LINE_RE.exec(line);
    assert.ok(m, `matches the regex: ${line}`);
    return { bot: m[1], kinds: Number(m[2]), unknown: Number(m[3]), entries: m[4].trim() ? m[4].trim().split(' ').map(e => { const x = ENTRY_RE.exec(e); return [x[1], Number(x[2])]; }) : [] };
};

test('G4 #2: normal names: the kinds, unknown 0, the top kinds by count (ties by name), names only; air never counts', () => {
    const { bot, calls } = worldBot([['stone', 100], ['dirt', 60], ['dynamictrees:leaves0', 20], ['grass', 20], ['water', 5], ['undergroundbiomes:metamorphic_stone', 7]]);
    const line = namingLine('FRCFLD', blocksNearSpawn(bot));
    assert.equal(line, '[naming] FRCFLD near spawn: 6 kinds; unknown 0; stone:100 dirt:60 dynamictrees:leaves0:20 grass:20 undergroundbiomes:metamorphic_stone:7 water:5');
    const p = parse(line);
    assert.deepEqual([p.kinds, p.unknown, p.entries.length], [6, 0, 6]);
    assert.deepEqual(p.entries[2], ['dynamictrees:leaves0', 20], 'a modded name keeps its namespace; the count is after the last colon');
    // The query !nearbyBlocks makes: radius 8, up to 10000 blocks, here with a predicate.
    assert.deepEqual(calls, [{ maxDistance: NAMING_RADIUS, count: 10000, fn: true }]);
    assert.equal(namingLine('FRCFLD', blocksNearSpawn(worldBot([]).bot)), '[naming] FRCFLD near spawn: 0 kinds; unknown 0;');
});

test('G4 #2: unknown names (undefined, null, empty, numeric ids, an "unknown" part) count in unknown and are printed as they are', () => {
    // A block whose state the registry does not know (type 4321, no name) is found too: the query
    // matches every non-air state, not the registry's ids.
    const { bot } = worldBot([['stone', 50], [undefined, 12, 4321], [null, 3, 4322], ['1234', 4, 1234], ['4321:2', 2, 4321], ['unknown', 6, 99], ['rustic:unknown_block', 1, 98], ['', 1, 97], ['dirt', 40]]);
    const line = namingLine('FRCFLD', blocksNearSpawn(bot));
    assert.equal(line, '[naming] FRCFLD near spawn: 9 kinds; unknown 7; stone:50 dirt:40 undefined:12 unknown:6 1234:4 null:3 4321:2:2 "":1 rustic:unknown_block:1');
    const p = parse(line);
    assert.equal(p.unknown, 7);
    assert.deepEqual(p.entries.find(e => e[0] === '4321:2'), ['4321:2', 2], 'a numeric id with its meta, as it is');
    for (const n of [undefined, null, '', ' ', '7', '7:3', 'unknown', 'mod:unknown', 'mod:unknown_block', 'unknown_thing']) assert.equal(unknownName(n), true, String(n));
    for (const n of ['stone', 'dynamictrees:leaves0', 'pyrotech:rock', 'quark:known_block', 'log:1']) assert.equal(unknownName(n), false, n);
});

test('G4 #2: at most the top NAMING_TOP (50) kinds are listed; kinds counts them all; unknown counts only listed kinds', () => {
    const runs = Array.from({ length: 60 }, (_, i) => [`mod:block_${String(i).padStart(2, '0')}`, 100 - i]);
    runs.push([undefined, 1, 4321]); // 61st kind, rank 61: not listed, so not in unknown
    const p = parse(namingLine('FRCFLD', blocksNearSpawn(worldBot(runs).bot)));
    assert.equal(p.kinds, 61);
    assert.equal(p.entries.length, NAMING_TOP);
    assert.equal(p.unknown, 0);
    assert.deepEqual(p.entries[0], ['mod:block_00', 100]);
    assert.deepEqual(p.entries.at(-1), ['mod:block_49', 51]);
    // Deterministic: the same blocks in another order give the same line.
    const blocks = blocksNearSpawn(worldBot(runs).bot);
    assert.equal(namingLine('FRCFLD', [...blocks].reverse()), namingLine('FRCFLD', blocks));
});

test('G4 #2: Agent.onSpawn prints the line once, after the first spawn, before the event handlers and anything that can call an LLM', async (t) => {
    const logs = [], order = [];
    t.mock.method(console, 'log', (...a) => {
        const l = a.join(' ');
        logs.push(l);
        if (l.startsWith('[naming] ')) order.push('naming');
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bot } = worldBot([['stone', 3], ['dirt', 2]]);
    const agent = Object.assign(Object.create(Agent.prototype), {
        name: 'FRCFLD', bot, task: { data: null }, agenda: { existed: true },
        clearBotLogs() {}, _setupEventHandlers() { order.push('handlers'); }, startEvents() { order.push('events'); },
        checkAllPlayersPresent() {}, autostartAgenda() {},
    });
    const done = agent.onSpawn({ spawnTimeout: null, save_data: null, init_message: null, load_mem: false, count_id: 0 });
    t.mock.timers.tick(1000);
    await new Promise(r => setImmediate(r));
    t.mock.timers.tick(10000);
    await done;
    const naming = logs.filter(l => l.startsWith('[naming] '));
    assert.deepEqual(naming, ['[naming] FRCFLD near spawn: 2 kinds; unknown 0; stone:3 dirt:2']);
    assert.deepEqual(order, ['naming', 'handlers', 'events']);
});
