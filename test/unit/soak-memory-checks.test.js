// test/tools/soak-memory-checks.mjs: round 17 M's evidence checks 1-3 (I13-I15 of soak-invariants.mjs), on synthetic
// journals and the committed soak 16 one (offline: no server, no LLM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournal, soakInvariants, render } from '../tools/soak-invariants.mjs';
import { memoryFactsCheck, wrongClaims, repeatedFailures, serverChat, itemMatches, sameItem, countClaims, executedCommands, factsFields } from '../tools/soak-memory-checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const S16 = path.join(ROOT, 'test/evidence/g4/g4soak-16-20261125');
const L = (time, msg, date = '2026-11-25') => `${date}T${time}+00:00 node[1]: ${msg}`;
const REL = L('10:00:00', '[release] rotn-v0.1.23-0123456789ab');
const SV = (time, msg) => `[${time}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <<bot>> ${msg}`;
const J = (lines) => readJournal(lines.join('\n'));
const chatOf = (lines, server) => serverChat(server.join('\n'), J(lines)[0].t);
const facts = (time, ...parts) => L(time, `[memory] facts 999 chars: Facts from the game (computed now, not remembered): / ${parts.join(' / ')}`);

test('serverChat: the bot\'s chat lines with journal times, past midnight on the next day; not the join line', () => {
    const lines = [L('23:59:00', 'x', '2026-11-24')];
    const chat = chatOf(lines, [SV('23:59:30', 'agenda step rocks started: collect 6 rocks'), '[00:00:10] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <FRCFLD> agenda done',
        '[00:00:11] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <bot> joined the game']);
    assert.deepEqual(chat.map(c => [new Date(c.t).toISOString(), c.msg]), [['2026-11-24T23:59:30.000Z', 'agenda step rocks started: collect 6 rocks'], ['2026-11-25T00:00:10.000Z', 'agenda done']]);
    assert.deepEqual(serverChat(null, 1), []);
});

test('itemMatches: a claimed phrase names a state item (namespace, metadata and plurals aside)', () => {
    assert.equal(itemMatches('rocks', 'pyrotech_compat:rock_igneous:0'), true);
    assert.equal(itemMatches('metamorphic cobble', 'undergroundbiomes:metamorphic_cobble'), true);
    assert.equal(itemMatches('logs', 'log'), true);
    assert.equal(itemMatches('dirt piles', 'betterwithmods:dirt_pile'), true);
    assert.equal(itemMatches('sticks', 'stick'), true);
    assert.equal(itemMatches('cobble', 'cobblestone'), false);
    assert.equal(itemMatches('sticks', 'contenttweaker:broken_stick'), true); // a word of the id: counted with the sticks
});

test('I13 memory facts: each field against the state lines within 30 s; misses named; unverifiable without a state line; n/a with no facts line', () => {
    const lines = [
        REL,
        L('10:00:05', '[death] died at -41, 64, -20; waiting for the respawn'),
        L('10:01:00', "parsed command: { commandName: '!collectBlocks', args: [ 'pyrotech:rock', 6 ] }"),
        L('10:01:00', '!collectBlocks and got: x'.replace(/^/, 'Agent executed: ')),
        L('10:01:00', 'No pyrotech:rock within 48 blocks.'),
        L('10:01:01', 'Saved memory to: ./bots/x/memory.json'),
        L('10:03:00', 'Collected 6 pyrotech:rock (6 pyrotech_compat:rock_igneous:0).'),
        L('10:03:30', '[night] in the shelter at -58, 57, -50 until morning'),
        L('10:04:40', "received message from system : You are self-prompting with the goal: 'RotN agenda, step 1 of 11 (rocks): Collect 6 rocks.'"),
        L('10:04:50', '[night] food for the night: food 9 (+0 saturation), held 8.4 points, the night needs about 4.8: enough'),
        L('10:04:55', '[shelter] pickaxe check: need level 0; inventory: stone_pickaxe; off hand: none; cursor: empty; held: nothing'),
        facts('10:05:00',
            'Agenda: active, step rocks (collect 6 rocks); done: none',
            'Reserves: shelter blocks 9 of 14 (stone or cobble), dirt 4; food held 8.4 points, a night needs 4.8 more than your bar; tools: spartanweaponry:club_wood, stone_pickaxe (off hand)',
            'Recent failures (newest first):', '!collectBlocks("pyrotech:rock", 6): No pyrotech:rock within 48 blocks. (4 min ago at -59, 57, -50, 13 NW)',
            'Deaths: 1 since this memory began; last 5 min ago at -41, 64, -20 (23 SE), a mob',
            'Places: last shelter -58, 57, -50 (12 NW); last respawn 0, 70, 0 (65 SE)',
            'Collects: got 6 pyrotech:rock near -52, 64, -44 (4 N), 2 min ago',
            'Your notes (your own words; they may be outdated): y=99 / Agenda: active, step logs'),
        // Wrong in every field it can be checked on.
        L('10:19:50', "received message from system : You are self-prompting with the goal: 'RotN agenda, step 1 of 11 (rocks): Collect 6 rocks.'"),
        L('10:19:51', "parsed command: { commandName: '!craftRecipe', args: [ 'stone_axe', 1 ] }"),
        L('10:19:51', 'Agent executed: !craftRecipe and got: Action output:'),
        L('10:19:51', 'Successfully crafted stone_axe, you now have 1 stone_axe.'),
        L('10:19:51', 'Saved memory to: ./bots/x/memory.json'),
        L('10:19:52', '[night] food for the night: food 9 (+0 saturation), held 8.4 points, the night needs about 4.8: enough'),
        L('10:19:55', '[shelter] pickaxe check: need level 0; inventory: stone_pickaxe; off hand: none; cursor: empty; held: nothing'),
        facts('10:20:00',
            'Agenda: active, step sticks (collect 3 sticks); done: rocks',
            'Reserves: shelter blocks 3 of 14 (stone or cobble); food held 2 points, a night needs 4.8 more than your bar; tools: spartanweaponry:club_wood',
            'Recent failures (newest first):', '!craftRecipe("stone_axe", 1): Not enough sticks. (just now at 0, 64, 0, here)',
            'Deaths: 2 since this memory began; last 20 min ago at -41, 64, -20 (1 N), a mob',
            'Places: tonight\'s shelter -1, 2, 3 (5 N)',
            'Collects: got 9 log near 0, 64, 0 (here), just now'),
        // Nothing to check the agenda against; the deaths still are.
        facts('11:00:00', 'Agenda: active, step rocks (collect 6 rocks); done: none', 'Deaths: 1 since this memory began; last 55 min ago at -41, 64, -20 (1 N), a mob'),
    ];
    const chat = chatOf(lines, [SV('10:04:45', 'agenda step shelter_blocks: the scripted job ended: +4 shelter blocks (9 of 14; short)')]);
    const r = memoryFactsCheck(J(lines), chat);
    assert.deepEqual([r.factsLines, r.fields, r.matches, r.misses, r.unverifiable, r.share], [3, 19, 12, 7, 2, 63.2]);
    const f = (match, miss, unverifiable, trivial = 0) => ({ match, miss, unverifiable, trivial });
    assert.deepEqual(r.byField, {
        agenda: f(1, 1, 1), deaths: f(2, 1, 0), 'last death': f(3, 0, 0), shelter: f(1, 1, 0), pickaxe: f(1, 1, 0), 'food held': f(1, 1, 0),
        'shelter blocks': f(1, 0, 1), failure: f(1, 1, 0), collect: f(1, 1, 0),
    });
    assert.deepEqual(r.missesFirst.map(m => m.field), ['agenda', 'deaths', 'shelter', 'pickaxe', 'food held', 'failure', 'collect']);
    assert.deepEqual(r.missesFirst[0], { t: '10:20:00', line: 20, field: 'agenda', said: 'sticks', state: 'rocks' });
    // #650 review 10: the gate per field (0 misses with at least 5 non-trivial samples) and overall.
    assert.equal(r.gateByField['last death'].verdict, 'too few');
    assert.equal(r.gateByField.agenda.verdict, 'fail');
    assert.equal(r.gate, 'fail');
    // The notes are the model's words: not parsed, even when they look like a field.
    assert.equal(factsFields('Facts from the game (computed now, not remembered): / Your notes (your own words; they may be outdated): x / Agenda: active, step logs (x)').agenda, null);
    assert.equal(memoryFactsCheck(J([REL, L('10:00:01', 'x')]), []), null);
});

test('#650 review 4, 5, 8, 9, 10: the shelter lines and nights, the scripted-job agenda line, a player-typed command, the fresh memory, the gate', () => {
    const shelterAt = (time, cell) => facts(time, 'Agenda: active, step shelter_blocks (keep 14 blocks); done: rocks', `Places: tonight's shelter ${cell} (here)`);
    const lines = [
        REL,
        L('10:00:00', '[night] sunset is near: building a shelter'),
        L('10:00:05', '[night] in the shelter at 1, 60, 1 until morning'),
        L('10:05:00', '[night] moved into the side pocket: in the shelter at 2, 59, 1, the cells behind sealed'),
        shelterAt('10:05:10', '2, 59, 1'),
        L('10:06:00', '[night] a troll (digs through anything) 1.2 blocks from the shelter at 2, 59, 1: burrowing away from it'),
        L('10:06:02', '[night] burrowed 2 steps into 3, 58, 1; holding or repairing there'),
        shelterAt('10:06:10', '3, 58, 1'),
        L('10:07:00', '[night] back in the shelter at 3, 58, 1: closing it again'),
        shelterAt('10:07:10', '1, 60, 1'), // a miss: the old cell
        L('10:20:00', '[night] morning: left the shelter at 3, 58, 1 on the side away from a zombie at 3, 58, 9; back to work'),
        // Night 2: no shelter line; the morning takes the bot's cell (a position line before it).
        L('10:30:00', '[night] sunset is near: building a shelter'),
        shelterAt('10:31:00', '3, 58, 1'), // last night's cell, no line yet tonight: unverifiable
        L('10:40:00', '- Position: x: 7.50, y: 64.00, z: 7.50'),
        L('10:50:00', '[night] morning: the bot is out in the open; back to work'),
        facts('10:50:20', 'Agenda: active, step shelter_blocks (keep 14 blocks); done: rocks', 'Places: last shelter 7, 64, 7 (here)'),
        // A failure of a command typed by a player (no `Agent executed` line): unverifiable, not a miss.
        facts('10:55:00', 'Recent failures (newest first):', '!goToPlayer("JQDAW", 3): Could not find JQDAW. (2 min ago at 0, 64, 0, here)'),
    ];
    const chat = chatOf(lines, [SV('10:05:05', 'agenda step shelter_blocks: the scripted job (run 1 of 2 today)'), SV('10:50:10', 'agenda step shelter_blocks started: keep 14 blocks')]);
    const r = memoryFactsCheck(J(lines), chat);
    const f = (match, miss, unverifiable, trivial = 0) => ({ match, miss, unverifiable, trivial });
    assert.deepEqual(r.byField.shelter, f(3, 1, 1));
    assert.deepEqual(r.byField.agenda, f(2, 0, 3)); // the scripted-job line at 10:05:05 names shelter_blocks; the start line at 10:50:10
    assert.deepEqual(r.byField.failure, f(0, 0, 1));
    // No death so far: "0 = 0" is right but no evidence (trivial), so the deaths field has 0 samples.
    assert.deepEqual(r.byField.deaths, f(6, 0, 0, 6));
    assert.deepEqual(r.gateByField.deaths, { samples: 0, verdict: 'too few' });
    assert.equal(r.gate, 'fail'); // the shelter miss
    // A memory carried over from before the soak: the death count is unverifiable.
    const carried = memoryFactsCheck(J([REL, L('10:00:01', '[state] <bot> at start: tasks=absent agenda=absent memory=present'), facts('10:01:00', 'Deaths: 3 since this memory began')]), []);
    assert.deepEqual(carried.byField.deaths, f(0, 0, 1));
    // Enough samples and no miss: pass.
    const ok = memoryFactsCheck(J([REL, ...[1, 2, 3, 4, 5].map(k => L(`10:0${k}:00`, `received message from system : You are self-prompting with the goal: 'RotN agenda, step 1 of 11 (rocks): x'`)),
        ...[1, 2, 3, 4, 5].map(k => facts(`10:0${k}:05`, 'Agenda: active, step rocks (collect 6 rocks); done: none'))]), []);
    assert.deepEqual([ok.gateByField.agenda, ok.gate], [{ samples: 5, verdict: 'pass' }, 'too few']); // deaths: 0 samples
});

test('I14 wrong-state claims: y against a position line, counts against the inventory, "you now have" or a collect, steps against the agenda', () => {
    const lines = [
        REL,
        L('10:00:09', 'You have reached at 5, 80, 5.'), // the goal's cell, not the bot's (#650 review 2)
        L('10:00:10', '- Position: x: 5.50, y: 64.00, z: 5.50'),
        L('10:00:20', 'Generated response: I\'m at y=64 now. !collectBlocks("pyrotech:rock", 6)'),
        L('10:00:25', 'Generated response: Up to y=70 with 16 piles.'),
        L('10:00:26', 'Generated response: Heading for the surface (y=80). !newAction("dig to y=80 then 1) stop at y=12")'),
        L('10:00:27', 'Generated response: The rocks are at ground level (~y=50).'),
        L('10:02:00', 'Generated response: Up to y 70.'),
        L('10:03:00', 'Collected 4 pyrotech:rock (4 pyrotech_compat:rock_igneous:0).'),
        L('10:03:01', 'INVENTORY'),
        L('10:03:01', '- pyrotech_compat:rock_igneous:0: 3'),
        L('10:03:01', '- pyrotech_compat:rock_sedimentary:0: 2'),
        L('10:03:01', '- stick: 5'),
        L('10:03:05', 'Generated response: Got 4 rocks so far and I have 5 sticks.'),
        L('10:03:06', 'Generated response: I have 7 sticks.'),
        L('10:03:07', 'Generated response: I have 3 cobble.'),
        L('10:03:08', 'Successfully crafted stick, you now have 9 stick.'),
        L('10:03:09', 'Generated response: I have 9 sticks now.'),
        L('10:03:10', 'Generated response: Got 4 rocks!'),
        L('10:04:00', "received message from system : You are self-prompting with the goal: 'RotN agenda, step 9 of 11 (stone_pickaxe): Craft a stone pickaxe.'"),
        L('10:04:10', 'Generated response: Step 9 done!'),
        L('10:05:00', 'Generated response: Steps 1-10 done.'),
        L('10:05:05', 'Generated response: The step stone_axe done too.'),
        L('10:05:06', 'Generated response: The step is done.'),
    ];
    const r = wrongClaims(J(lines), chatOf(lines, [SV('10:04:20', 'agenda step stone_pickaxe done')]));
    // "Got 4 rocks so far": the total held (5), not the collect's 4 (#650 review 7); "Got 4 rocks!": the collect agrees.
    // "Up to y=70 with 16 piles" holds a count claim too (no listing then: unverifiable).
    assert.deepEqual(r.byKind, { y: [1, 1, 1], count: [3, 2, 2], step: [1, 2, 0] });
    assert.deepEqual([r.replies, r.claimReplies, r.claims, r.wrong, r.unverifiable], [14, 11, 13, 5, 3]);
    assert.deepEqual(r.wrongFirst.map(w => [w.t, w.kind, w.said, w.state]), [
        ['10:00:25', 'y', 'y 70', '64'], ['10:03:05', 'count', '4 rocks', 5], ['10:03:06', 'count', '7 sticks', 5], ['10:05:00', 'step', 'steps 1-10 done', 'stone_axe'], ['10:05:05', 'step', 'step stone_axe done', undefined],
    ]);
    assert.equal(r.handSample.length, 11);
    // The sample is every k-th claim reply: the same journal gives the same sample.
    assert.deepEqual(wrongClaims(J(lines), []).handSample.map(h => h.line), r.handSample.map(h => h.line));
});

test('countClaims (#650 review 6): lists, "on hand", "now", "(N total now)"; not "got 6 already" or "3 more"', () => {
    const c = (t) => countClaims(t).map(x => `${x.n} ${x.phrase} ${x.mode}`);
    assert.deepEqual(c('Got 6 already, need ~8 more.'), []);
    assert.deepEqual(c('I have 19 rocks and 9 cobble (+1 chalk cobble).'), ['19 rocks held', '9 cobble held', '1 chalk cobble held']);
    assert.deepEqual(c('That leaves 13 cobble on hand.'), ['13 cobble held']);
    assert.deepEqual(c('Crafted: 25 planks now.'), ['25 planks held']);
    assert.deepEqual(c('Got 8 fresh rocks (27 total now).'), ['8 rocks got', '27 rocks held']);
    assert.deepEqual(c('Got 3 more cobble (siltstone).'), []);
    assert.deepEqual(c('Up to y=60 with 16 piles.'), ['16 piles got']);
    assert.deepEqual(c('Got 4 rocks so far.'), ['4 rocks held']);
    assert.equal(sameItem('sticks', 'stick'), true);
    assert.equal(sameItem('axes', 'pyrotech:crude_axe'), false);
});

test('I14 (#650 review 1, 2, 7): a listing after the reply with no change between; the y bracket; a closer-named item not summed', () => {
    const lines = [
        REL,
        L('10:00:00', '- Position: x: 0.50, y: 56.00, z: 0.50'),
        L('10:05:00', 'Generated response: Up to y=60 with 16 piles. Crafting them: !craftRecipe("dirt", 4)'),
        L('10:05:00', "parsed command: { commandName: '!craftRecipe', args: [ 'dirt', 4 ] }"),
        L('10:05:00', 'Agent executed: !craftRecipe and got: Action output:'),
        L('10:05:00', 'Could not craft dirt: the craft failed (Error: missing ingredient).'),
        L('10:05:01', 'Saved memory to: ./bots/x/memory.json'),
        L('10:05:10', 'INVENTORY'),
        L('10:05:10', '- betterwithmods:dirt_pile: 16'),
        L('10:05:10', '- undergroundbiomes:metamorphic_cobble:6: 9'),
        L('10:05:10', '- contenttweaker:chalk_cobble:0: 1'),
        L('10:05:20', 'Generated response: I have 9 cobble (+1 chalk cobble).'),
        L('10:06:05', '[night] in the shelter at 0, 57, 0 until morning'),
        L('10:10:00', 'Generated response: I have 13 cobble now: !craftRecipe("cobblestone", 1)'),
        L('10:10:01', "parsed command: { commandName: '!craftRecipe', args: [ 'cobblestone', 1 ] }"),
        L('10:10:01', 'Agent executed: !craftRecipe and got: Action output:'),
        L('10:10:01', 'Successfully crafted undergroundbiomes:metamorphic_cobble:6 from your rocks, you now have 10 undergroundbiomes:metamorphic_cobble:6.'),
        L('10:10:02', 'Saved memory to: ./bots/x/memory.json'),
        L('10:10:10', 'INVENTORY'),
        L('10:10:10', '- undergroundbiomes:metamorphic_cobble:6: 10'),
    ];
    const r = wrongClaims(J(lines), []);
    // y 60 against 56 before and 57 after (within 10 min, agreeing within 1): wrong. 16 piles: the listing after the
    // failed craft agrees. 9 cobble: the chalk cobble is the other claim's. 13 cobble: the listing after a craft that
    // worked is no evidence, so unverifiable.
    assert.deepEqual(r.wrongFirst.map(w => [w.t, w.said, w.state]), [['10:05:00', 'y 60', '56,57']]);
    assert.deepEqual(r.byKind, { y: [0, 1, 0], count: [3, 0, 1], step: [0, 0, 0] });
});

test('I15 repeated failures: the same command and args failing again within 10 min; inMemory when a facts line named it between', () => {
    const fail = (time, args = "'pyrotech:rock', 6") => [
        L(time, `parsed command: { commandName: '!collectBlocks', args: [ ${args} ] }`),
        L(time, 'Agent executed: !collectBlocks and got: Action output:'),
        L(time, 'Collected 0 pyrotech:rock.'),
        L(time, 'Saved memory to: ./bots/x/memory.json'),
    ];
    const stone = (time) => [
        L(time, 'parsed command: {'), L(time, "  commandName: '!collectBlocks',"), L(time, "  args: [ 'undergroundbiomes:metamorphic_stone', 1 ]"), L(time, '}'),
        L(time, 'Agent executed: !collectBlocks and got: Action output:'),
        L(time, 'Failed to collect undergroundbiomes:metamorphic_stone: needs a better tool (Tool Progression): the tool you have cannot break it.'),
        L(time, 'selected examples:'),
    ];
    const surface = (time) => [
        L(time, "parsed command: { commandName: '!goToSurface', args: [] }"),
        L(time, 'Agent executed: !goToSurface and got: Action output:'),
        L(time, 'You are trapped at 9, 68, -63: no walkable way to open ground within 8 blocks.'),
        L(time, 'Saved memory to: ./bots/x/memory.json'),
    ];
    const lines = [
        REL, ...fail('10:01:00'), ...fail('10:05:00'),
        facts('10:06:00', 'Recent failures (newest first):', '!collectBlocks("pyrotech:rock", 6): Collected 0 pyrotech:rock. (1 min ago at 0, 64, 0, here)'),
        ...fail('10:08:00'), ...fail('10:30:00'), ...fail('10:31:00', "'pyrotech:rock', 8"),
        ...stone('10:40:00'), ...stone('10:41:00'),
        ...surface('10:45:00'), facts('10:46:00', 'Recent failures (newest first):', '!goToSurface: You are trapped at 9, 68, -63. (1 min ago at 9, 68, -63, here)'), ...surface('10:47:00'),
        L('10:41:01', "parsed command: { commandName: '!stats', args: [] }"), L('10:41:01', 'Agent executed: !stats and got:'), L('10:41:01', 'STATS'),
        L('11:00:00', 'x'),
    ];
    const cmds = executedCommands(J(lines));
    assert.deepEqual(cmds.map(c => [c.key, c.failed]).slice(-3), [['!goToSurface()', true], ['!goToSurface()', true], ['!stats()', false]]);
    const r = repeatedFailures(J(lines));
    // #650 review 3: a command with no args is in the memory as "!goToSurface: why".
    assert.deepEqual([r.count, r.failures, r.inMemory, r.perHour, r.within30, r.within60], [4, 9, 2, 4, 5, 5]);
    assert.deepEqual(r.first.map(x => [x.t, x.inMemory]), [['10:05:00', false], ['10:08:00', true], ['10:41:00', false], ['10:47:00', true]]);
});

test('soak 16: the M baseline (no facts lines: I13 n/a; I14 and I15 counted; check 5 the share and USD per hour)', () => {
    const r = soakInvariants(fs.readFileSync(path.join(S16, 'driver.log'), 'utf8'), { serverText: fs.readFileSync(path.join(S16, 'server.log'), 'utf8') });
    assert.equal(r.I13, null);
    assert.deepEqual([r.I14.replies, r.I14.claims, r.I14.wrong, r.I14.unverifiable], [94, 7, 0, 2]);
    assert.deepEqual([r.I15.count, r.I15.failures, r.I15.within30, r.I15.within60], [0, 12, 0, 3]);
    assert.deepEqual([r.I11.share, r.I11.usd, r.I11.usdPerHour, r.I11.skipped], [33.6, 0.056454, 0.02814, 0]);
    const text = render(r, 'g4soak-16-20261125');
    assert.match(text, /- I13 memory-facts: n\/a/);
    assert.match(text, /- I14 wrong-state claims: 0 of 7 claims wrong \(2 unverifiable\) in 7 of 94 replies/);
    assert.match(text, /- I15 repeated failures: 0 repeats within 10 min of the same failure \(0\/h; 0 after a facts line named it\) of 12 failed commands; within 30 min 0, within 60 min 3/);
    assert.match(text, /M4 check 5: summaries 33\.6% of USD 0\.056454 \(USD 0\.02814\/h of journal\); 0 chunks cut with no summary call/);
});
