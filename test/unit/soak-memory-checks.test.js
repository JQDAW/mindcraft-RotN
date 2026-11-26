// test/tools/soak-memory-checks.mjs: round 17 M's evidence checks 1-3 (I13-I15 of soak-invariants.mjs), on synthetic
// journals and the committed soak 16 one (offline: no server, no LLM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournal, soakInvariants, render } from '../tools/soak-invariants.mjs';
import { memoryFactsCheck, wrongClaims, repeatedFailures, serverChat, itemMatches, executedCommands, factsFields } from '../tools/soak-memory-checks.mjs';

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
    assert.deepEqual(r.byField, {
        agenda: { match: 1, miss: 1, unverifiable: 1 }, deaths: { match: 2, miss: 1, unverifiable: 0 }, 'last death': { match: 3, miss: 0, unverifiable: 0 },
        shelter: { match: 1, miss: 1, unverifiable: 0 }, pickaxe: { match: 1, miss: 1, unverifiable: 0 }, 'food held': { match: 1, miss: 1, unverifiable: 0 },
        'shelter blocks': { match: 1, miss: 0, unverifiable: 1 }, failure: { match: 1, miss: 1, unverifiable: 0 }, collect: { match: 1, miss: 1, unverifiable: 0 },
    });
    assert.deepEqual(r.missesFirst.map(m => m.field), ['agenda', 'deaths', 'shelter', 'pickaxe', 'food held', 'failure', 'collect']);
    assert.deepEqual(r.missesFirst[0], { t: '10:20:00', line: 16, field: 'agenda', said: 'sticks', state: 'rocks' });
    // The notes are the model's words: not parsed, even when they look like a field.
    assert.equal(factsFields('Facts from the game (computed now, not remembered): / Your notes (your own words; they may be outdated): x / Agenda: active, step logs (x)').agenda, null);
    assert.equal(memoryFactsCheck(J([REL, L('10:00:01', 'x')]), []), null);
});

test('I14 wrong-state claims: y against a position line, counts against the inventory, "you now have" or a collect, steps against the agenda', () => {
    const lines = [
        REL,
        L('10:00:10', 'You have reached at 5, 64, 5.'),
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
        L('10:04:00', "received message from system : You are self-prompting with the goal: 'RotN agenda, step 9 of 11 (stone_pickaxe): Craft a stone pickaxe.'"),
        L('10:04:10', 'Generated response: Step 9 done!'),
        L('10:05:00', 'Generated response: Steps 1-10 done.'),
        L('10:05:05', 'Generated response: The step stone_axe done too.'),
        L('10:05:06', 'Generated response: The step is done.'),
    ];
    const r = wrongClaims(J(lines), chatOf(lines, [SV('10:04:20', 'agenda step stone_pickaxe done')]));
    assert.deepEqual(r.byKind, { y: [1, 1, 1], count: [3, 1, 1], step: [1, 2, 0] });
    assert.deepEqual([r.replies, r.claimReplies, r.claims, r.wrong, r.unverifiable], [13, 10, 11, 4, 2]);
    assert.deepEqual(r.wrongFirst.map(w => [w.t, w.kind, w.said, w.state]), [
        ['10:00:25', 'y', 'y 70', '64'], ['10:03:06', 'count', '7 sticks', 5], ['10:05:00', 'step', 'steps 1-10 done', 'stone_axe'], ['10:05:05', 'step', 'step stone_axe done', undefined],
    ]);
    assert.equal(r.handSample.length, 10);
    // The sample is every k-th claim reply: the same journal gives the same sample.
    assert.deepEqual(wrongClaims(J(lines), []).handSample.map(h => h.line), r.handSample.map(h => h.line));
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
    const lines = [
        REL, ...fail('10:01:00'), ...fail('10:05:00'),
        facts('10:06:00', 'Recent failures (newest first):', '!collectBlocks("pyrotech:rock", 6): Collected 0 pyrotech:rock. (1 min ago at 0, 64, 0, here)'),
        ...fail('10:08:00'), ...fail('10:30:00'), ...fail('10:31:00', "'pyrotech:rock', 8"),
        ...stone('10:40:00'), ...stone('10:41:00'),
        L('10:41:01', "parsed command: { commandName: '!stats', args: [] }"), L('10:41:01', 'Agent executed: !stats and got:'), L('10:41:01', 'STATS'),
        L('11:00:00', 'x'),
    ];
    const cmds = executedCommands(J(lines));
    assert.deepEqual(cmds.map(c => [c.key, c.failed]).slice(-3), [["!collectBlocks('undergroundbiomes:metamorphic_stone', 1)", true], ["!collectBlocks('undergroundbiomes:metamorphic_stone', 1)", true], ['!stats()', false]]);
    const r = repeatedFailures(J(lines));
    assert.deepEqual([r.count, r.failures, r.inMemory, r.perHour, r.within30, r.within60], [3, 7, 1, 3, 4, 4]);
    assert.deepEqual(r.first.map(x => [x.t, x.inMemory]), [['10:05:00', false], ['10:08:00', true], ['10:41:00', false]]);
});

test('soak 16: the M baseline (no facts lines: I13 n/a; I14 and I15 counted; check 5 the share and USD per hour)', () => {
    const r = soakInvariants(fs.readFileSync(path.join(S16, 'driver.log'), 'utf8'), { serverText: fs.readFileSync(path.join(S16, 'server.log'), 'utf8') });
    assert.equal(r.I13, null);
    assert.deepEqual([r.I14.replies, r.I14.claims, r.I14.wrong, r.I14.unverifiable], [94, 6, 0, 2]);
    assert.deepEqual([r.I15.count, r.I15.failures, r.I15.within30, r.I15.within60], [0, 12, 0, 3]);
    assert.deepEqual([r.I11.share, r.I11.usd, r.I11.usdPerHour, r.I11.skipped], [33.6, 0.056454, 0.02814, 0]);
    const text = render(r, 'g4soak-16-20261125');
    assert.match(text, /- I13 memory-facts: n\/a/);
    assert.match(text, /- I14 wrong-state claims: 0 of 6 claims wrong \(2 unverifiable\) in 6 of 94 replies/);
    assert.match(text, /- I15 repeated failures: 0 repeats within 10 min of the same failure \(0\/h; 0 after a facts line named it\) of 12 failed commands; within 30 min 0, within 60 min 3/);
    assert.match(text, /M4 check 5: summaries 33\.6% of USD 0\.056454 \(USD 0\.02814\/h of journal\); 0 chunks cut with no summary call/);
});
