// test/tools/soak-invariants.mjs: the soak journal invariants (offline: the committed soak journals and
// synthetic ones; no server, no LLM).
import './isolate-tmp.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { soakInvariants, table, evidenceDirs, serverDeaths, renderTable, render } from '../tools/soak-invariants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'test/tools/soak-invariants.mjs');
const EVIDENCE = path.join(ROOT, 'test/evidence/g4');
const BASELINE = path.join(EVIDENCE, 'invariants-baseline.json');

// One journal line at hh:mm:ss on 2026-11-25.
const L = (time, msg, date = '2026-11-25') => `${date}T${time}+00:00 node[1]: ${msg}`;
const REL = (n) => L('10:00:00', `[release] rotn-v0.1.${n}-0123456789ab`);
const run = (lines, opts) => soakInvariants(lines.join('\n'), opts);

test('the committed soak journals give the committed baseline (each evidence PR adds its row)', () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const rows = table(EVIDENCE);
    assert.deepEqual(Object.keys(rows), evidenceDirs(EVIDENCE));
    assert.deepEqual(Object.keys(baseline).sort(), Object.keys(rows).sort(), 'a soak evidence dir with no baseline row, or a row with no dir');
    for (const [name, row] of Object.entries(rows)) assert.deepEqual(row, baseline[name], name);
});

test('the known incidents are found (calibration)', () => {
    const rows = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const s15 = rows['g4soak-15-20261124'];
    assert.equal(s15.I3_rejectedClicks, 9); // 18 lines, 9 clicks (#616 review 3)
    assert.equal(s15.I2_couldNotLeave, 2); // mornings 1 and 2 in the pocket at -58, 57, -50
    assert.equal(s15.I7_gateThenAct, 1); // the cow: the hunt started 35 s after the bull refusal (#623 review 1)
    assert.equal(s15.I9_falseCollects, 2); // 22:41:56 and 00:01:20 (#616 review 2)
    assert.equal(s15.I4_digRefusedWithTool, 2);
    assert.equal(s15.I1_trapped, 1);
    // Soaks 10 and 12's death loops are not traps: a death ends an episode (#623 review 2).
    assert.equal(rows['g4soak-10-20261122'].I1_trapped, 0);
    assert.equal(rows['g4soak-12-20261123'].I1_trapped, 0);
    const s14 = rows['g4soak-14-20261124'];
    assert.equal(s14.I6_lowestFood, 1);
    assert.equal(s14.I12_deathsUnnamed, 1); // the grove sprite
    assert.equal(s14.I12_unknownHurt, 3);
    assert.equal(rows['g4soak-12-20261123'].I10_deathLoops, 1);
    assert.equal(rows['g4soak-12-20261123'].I10_loopDeaths, 15); // deaths 2-16 at the scroll's respawn point
    assert.ok(rows['g4soak-10-20261122'].I10_loopDeaths >= 80); // the spawn loop, split where the bot lived over 5 min
    assert.equal(rows['g4soak-13-20261124'].I11_bigSummaries, 6);
    // Lines a release did not print are n/a, never 0.
    for (const n of ['g4soak-m1-20261108', 'g4soak-2-20261108']) {
        assert.equal(rows[n].I4_digRefusedWithTool, null);
        assert.equal(rows[n].I7_gateThenAct, null);
        assert.equal(rows[n].I12_unknownHurt, null);
    }
    assert.equal(rows['g4soak-m1-20261108'].I5_nightFoodShort, null);
});

test('I1 trapped: failed path attempts close together; lines within 2 s are one attempt; an arrival or a 10-min gap ends it', () => {
    const fail = (t) => [L(t, 'Path not found, but attempting to navigate anyway using destructive movements.'), L(t, 'Unable to reach 1, 2, 3, you are 8 blocks away.')];
    let r = run([...fail('10:00:00'), ...fail('10:01:00'), ...fail('10:02:00')]);
    assert.deepEqual([r.I1.count, r.I1.attempts, r.I1.longestMin], [1, 3, 2]);
    assert.deepEqual(r.I1.first[0], { t: '10:00:00', line: 1, until: '10:02:00', untilLine: 5, attempts: 3, minutes: 2 });
    r = run([...fail('10:00:00'), ...fail('10:01:00'), L('10:01:30', 'You have reached at 1, 2, 3.'), ...fail('10:02:00')]);
    assert.equal(r.I1.count, 0);
    r = run([...fail('10:00:00'), ...fail('10:01:00'), ...fail('10:12:00'), ...fail('10:13:00')]);
    assert.equal(r.I1.count, 0); // 2 + 2 attempts, split by the 11-min gap
});

test('I2 enclosed-morning: "could not leave" lines and a night in the same shelter as the night before', () => {
    const r = run([
        L('10:00:00', '[night] in the shelter at -58, 57, -50 until morning'),
        L('10:25:00', '[night] morning: could not leave the shelter at -58, 57, -50 after 3 tries (no safe side); back to work, still enclosed: dig a way out'),
        L('10:40:00', '[night] in the shelter at -58, 57, -50 until morning'),
        L('11:20:00', '[night] in the shelter at 1, 70, 1 until morning'),
    ]);
    assert.deepEqual([r.I2.count, r.I2.sameShelterNights], [1, 1]);
});

test('I3 rejected-click: one per [inventory] line (first try and second try), not per copy; #618 lines win', () => {
    const rej = (t, op, slot, second = false) => L(t, `[inventory] ${op}: ${second ? 'the second try failed too: ' : ''}Error: Server rejected transaction for clicking on slot ${slot}, on window with id 0.${second ? '' : ' Resyncing and trying once more.'}`);
    let r = run([
        rej('10:00:00', 'craft', 11), rej('10:00:00', 'craft', 4, true),
        L('10:00:00', '[craft] bot.craft returned after 1256 ms (it threw: Error: Error: Server rejected transaction for clicking on slot 4, on window with id 0.)'),
        L('10:00:00', 'Code execution triggered catch: Error: Error: Server rejected transaction for clicking on slot 4, on window with id 0.'),
        rej('10:01:00', 'equip', 39),
    ]);
    assert.deepEqual([r.I3.count, r.I3.secondTries, r.I3.source], [3, 1, '[inventory]']);
    r = run([rej('10:00:00', 'craft', 11), L('10:00:00', '[forge-bridge] click rejected: window 0 slot 11 (mode 0, button 0, action 812); client before …; server after …')]);
    assert.deepEqual([r.I3.count, r.I3.source], [1, 'click rejected']);
});

test('I4 dig-refused-with-tool: n/a before rotn-v0.1.19; #618 lines with a finite carried tool; else a refusal with a pickaxe listed', () => {
    const refusal = L('10:05:00', 'Cannot break the block at x:1, y:2, z:3: undergroundbiomes:metamorphic_stone needs a better tool (Tool Progression): the tool you have cannot break it; get a higher-tier one first.');
    assert.equal(run([REL(18), refusal]).I4, null);
    let r = run([REL(21), L('10:00:00', 'INVENTORY'), L('10:00:00', '- stone_pickaxe: 1'), L('10:00:00', 'WEARING: Nothing'), refusal]);
    assert.deepEqual([r.I4.count, r.I4.refusals], [1, 1]);
    r = run([REL(21), L('10:00:00', 'INVENTORY'), L('10:00:00', '- planks: 1'), refusal]);
    assert.deepEqual([r.I4.count, r.I4.refusals], [0, 1]);
    r = run([REL(22),
        L('10:00:00', '[forge-bridge] dig refused: undergroundbiomes:metamorphic_stone:6 at -58, 55, -50 (pickaxe level 0, hardness 0.9); held planks:1 (no pickaxe level); pickaxe tools: stone_pickaxe (level 0) off hand; rule: held Infinity, stone_pickaxe 350 ms'),
        L('10:01:00', '[forge-bridge] dig refused: obsidian at 1, 2, 3 (pickaxe level 3, hardness 50); held stone_pickaxe (level 0); pickaxe tools: none; rule: held Infinity'),
    ]);
    assert.deepEqual([r.I4.count, r.I4.refusals, r.I4.source], [1, 2, 'dig refused']);
});

test('#625: the dig-refused cap line is not a refusal; with it I4 is a lower bound (capped, "at least", "≥")', () => {
    const refused = (t) => L(t, '[forge-bridge] dig refused: undergroundbiomes:metamorphic_stone:6 at -58, 55, -50 (pickaxe level 0, hardness 0.9); held planks:1 (no pickaxe level); pickaxe tools: stone_pickaxe (level 0) off hand; rule: held Infinity, stone_pickaxe 350 ms');
    const cap = L('10:09:00', '[forge-bridge] dig refused: 100 lines logged; further refusals on this connection are not');
    let r = run([REL(22), refused('10:00:00'), refused('10:01:00'), cap]);
    assert.deepEqual([r.I4.count, r.I4.refusals, r.I4.capped, r.I4.source], [2, 2, true, 'dig refused (capped)']);
    assert.match(render(r, 'x'), /I4 dig-refused-with-tool: at least 2 of at least 2 tool refusals/);
    assert.match(renderTable({ 'g4soak-16-x': { release: 'rotn-v0.1.22', I4_digRefusedWithTool: 2, I4_capped: true } }), /\| ≥2 \|/);
    r = run([REL(22), cap]); // only the cap line kept (a partial journal): still a lower bound, not "no refusal"
    assert.deepEqual([r.I4.count, r.I4.refusals, r.I4.capped], [0, 0, true]);
    r = run([REL(22), refused('10:00:00')]);
    assert.deepEqual([r.I4.count, r.I4.capped], [1, false]);
});

test('#623 re-review: a hunt start looks for its mob only within the window and not past the next hunt start', () => {
    const refusal = L('10:00:00', '[reflex] hunting: left alone, it may belong to a player: animania:cow_holstein: a animania:bull_holstein within 16 blocks');
    const start = (t) => L(t, '[survival] weapon spartanweaponry:club_wood (hunt)');
    let r = run([REL(21), refusal, start('10:00:30'), start('10:00:40'), L('10:00:50', '[reflex] hunting animania:sow_old_spot: stuck (left alone for 5 min)')]);
    assert.equal(r.I7.count, 0);
    // The hunting line after the window: the hunt start's mob is unknown within it, so no act.
    r = run([REL(21), refusal, start('10:00:50'), L('10:02:00', '[reflex] hunting animania:cow_holstein: stuck (left alone for 5 min)')]);
    assert.equal(r.I7.count, 0);
});

test('I5 sunset-food-short: both line formats; null with no food-for-the-night line; food runs and their points', () => {
    assert.equal(run([L('10:00:00', 'x')]).I5, null);
    let r = run([
        L('10:00:00', '[night] food for the night: food 20 (+5 saturation), held 4.2 points, the night needs about 0: enough'),
        L('10:30:00', '[night] food for the night: food 9 (+0 saturation), held 5.1 points, the night needs about 5.8: short by 0.7: a food run first (at most 3 min)'),
        L('10:30:00', '[night] the food run ended: +0 points (no ripe wild food and no animal to hunt within 32 blocks); building the shelter here'),
    ]);
    assert.deepEqual([r.I5.count, r.I5.nightFoodLines, r.I5.foodRuns, r.I5.foodRunPoints], [1, 2, 1, 0]);
    r = run([
        L('10:00:00', '[night] food for the night: food worth 0 hunger held, food 10; less than 6: staying sealed anyway (never out for food at night)'),
        L('10:30:00', '[night] food for the night: food worth 9 hunger held, food 18; enough'),
    ]);
    assert.deepEqual([r.I5.count, r.I5.nightFoodLines], [1, 2]);
});

test('I6 starving: low food lines, the lowest food, "no safe food" runs over 5 min (an eat ends one), starving hurt', () => {
    const nsf = (t) => L(t, '[reflex] eating: food 3, but no safe food in the inventory, and no other food either');
    const r = run([
        L('10:00:00', '[survival] food 5 health 20 (check)'), L('10:01:00', '[survival] food 4 health 20 (check)'), L('10:02:00', '[survival] food 1 health 20 (check)'),
        nsf('10:00:00'), nsf('10:03:00'), nsf('10:06:30'), L('10:07:00', '[survival] ate bread food 1->6'),
        nsf('10:10:00'), nsf('10:12:00'),
        L('10:20:00', '[survival] hurt 20 health 20->0 (by starving)'),
    ]);
    assert.deepEqual([r.I6.count, r.I6.lowestFood, r.I6.noSafeFoodRuns, r.I6.longestNoSafeFoodMin, r.I6.starvingHurt], [2, 1, 1, 6.5, 1]);
});

test('I7 gate-then-act: a hunt of, or a hit from, the refused mob within 60 s; n/a before rotn-v0.1.19', () => {
    const refusal = L('10:00:00', '[reflex] hunting: left alone, it may belong to a player: animania:cow_holstein: a animania:bull_holstein within 16 blocks (it charges whoever hurts it or its herd; never hunt near one)');
    assert.equal(run([REL(18), refusal]).I7, null);
    let r = run([REL(21), refusal, L('10:00:58', '[reflex] hunting animania:cow_holstein: stuck (left alone for 5 min)')]);
    assert.deepEqual([r.I7.count, r.I7.refusals, r.I7.first[0].afterS], [1, 1, 58]);
    r = run([REL(21), refusal, L('10:01:09', '[survival] hurt 4 health 20->16 (by animania:cow_holstein)')]);
    assert.equal(r.I7.count, 0); // 69 s: outside
    r = run([REL(21), L('10:00:00', 'Not attacking animania:hog_old_spot: a animania:bull_holstein within 16 blocks'), L('10:00:20', '[survival] hurt 2 health 20->18 (by animania:hog_old_spot)')]);
    assert.equal(r.I7.count, 1);
});

test('I8 refused-command: refused by design; a reply with a command that never ran (parsed or executed counts as ran)', () => {
    const r = run([
        L('10:00:00', 'Generated response: digging up. !newAction("dig up")'), L('10:00:00', 'parsed command: { commandName: \'!newAction\', args: [ \'dig up\' ] }'),
        L('10:00:00', 'Agent executed: !newAction and got: newAction not allowed! Code writing is disabled in settings. Notify the user.'),
        L('10:00:10', 'Generated response: going. !goToCoordinates(1, 2, 3, 1)'), L('10:00:10', 'Agent executed: !goToCoordinates and got: Command !goToCoordinates was given 0 args'),
        L('10:00:20', 'Generated response: !attack("animania:cow_holstein")'), L('10:00:21', 'Mode item_collecting finished executing, code_return: Action output:'),
        L('10:00:30', 'Generated response: Thinking it over, no command.'),
        L('10:00:40', 'Agent executed: !craftRecipe and got: Invalid item type: metamorphic_cobble. Did you mean undergroundbiomes:metamorphic_cobble?'),
    ]);
    assert.deepEqual([r.I8.count, r.I8.neverRan], [2, 1]);
    assert.equal(r.I8.neverRanFirst[0].t, '10:00:20');
});

test('I9 false-collect: "it gave" then Collected 0; Broke in the same second as a refusal of that block; n/a before rotn-v0.1.19', () => {
    const lines = [
        L('10:00:00', 'Broke undergroundbiomes:metamorphic_cobble: no undergroundbiomes:metamorphic_cobble yet (it gave 16 pyrotech_compat:rock_metamorphic:6).'),
        L('10:00:01', 'Collected 0 undergroundbiomes:metamorphic_cobble.'),
        L('10:01:00', 'Failed to collect pyrotech:rock: undergroundbiomes:metamorphic_stone needs a better tool (Tool Progression): the tool you have cannot break it'),
        L('10:01:00', 'Broke undergroundbiomes:metamorphic_stone: no pyrotech:rock yet (it gave 4 betterwithmods:dirt_pile).'),
        L('10:02:00', 'Broke dirt: no betterwithmods:dirt_pile yet.'),
    ];
    assert.equal(run([REL(18), ...lines]).I9, null);
    const r = run([REL(21), ...lines]);
    assert.deepEqual(r.I9.first.map(f => f.kind), ['gave, then Collected 0', 'broke and refused in the same second']);
});

test('I10 death-loop: 3 deaths, each within 5 min and 24 blocks of the one before (chained)', () => {
    const d = (t, p) => L(t, `[death] died at ${p}; waiting for the respawn`);
    let r = run([d('10:00:00', '0, 64, 0'), d('10:02:00', '3, 64, 2'), d('10:06:30', '1, 65, 0'), d('10:30:00', '100, 64, 0')]);
    assert.deepEqual([r.I10.count, r.I10.deaths, r.I10.loopDeaths], [1, 4, 3]);
    r = run([d('10:00:00', '0, 64, 0'), d('10:02:00', '30, 64, 0'), d('10:03:00', '0, 64, 1')]);
    assert.equal(r.I10.count, 0);
});

test('I11 summary-cost: summaries paired by soak-spend.mjs, those over 10,000 reasoning tokens, and their share', () => {
    const call = (t, prompt, completion, usd, reasoning, after) => [
        L(t, `[openrouter] provider Wafer, finish_reason stop, content 100 chars`),
        L(t, `[openrouter] usage prompt_tokens ${prompt}, completion_tokens ${completion}, cost_usd ${usd}`),
        L(t, `[openrouter] reasoning_tokens ${reasoning}`), L(t, 'Received.'), L(t, after),
    ];
    const r = run([...call('10:00:00', 900, 18000, 0.003, 17900, 'Memory updated to:  m'), ...call('10:00:10', 4000, 100, 0.001, 50, 'Generated response: !stats')]);
    assert.deepEqual([r.I11.count, r.I11.summaries, r.I11.maxReasoning, r.I11.share], [1, 1, 17900, 75]);
});

test('I12 unattributed-hurt: unknown hurt lines; mob deaths with no mob named in the 15 s before; paired with server.log in order', () => {
    const journal = [REL(20),
        L('10:00:00', '[survival] hurt 5.5 health 15.7->10.2 (by unknown)'),
        L('10:00:08', '[death] died at -70, 62, -71; waiting for the respawn'),
        L('10:20:00', '[survival] hurt 4 health 6->2 (by zombie)'),
        L('10:20:05', '[death] died at 1, 64, 1; waiting for the respawn'),
        L('10:40:00', '[death] died at 2, 64, 2; waiting for the respawn'),
    ];
    const server = [
        '[10:00:08] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <bot> was slain by Grove Sprite',
        '[10:05:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <<bot>> chat, not a death',
        '[10:06:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <bot> has made the advancement [Herblore]',
        '[10:20:05] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <bot> was slain by Zombie',
        '[10:40:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <bot> starved to death',
    ].join('\n');
    assert.deepEqual(serverDeaths(server).map(d => d.cause), ['was slain by Grove Sprite', 'was slain by Zombie', 'starved to death']);
    let r = run(journal, { serverText: server });
    assert.deepEqual([r.I12.count, r.I12.deathsUnnamed, r.I12.deathsFirst[0].server], [1, 1, 'was slain by Grove Sprite']);
    r = run(journal);
    assert.equal(r.I12.deathsUnnamed, null); // no server.log: not known
    assert.equal(run([REL(4), L('10:00:00', 'x')]).I12, null);
});

test('soak 15 in detail: the cow act and the trap episode (#623 review 1, 2)', () => {
    const r = soakInvariants(fs.readFileSync(path.join(EVIDENCE, 'g4soak-15-20261124/driver.log'), 'utf8'));
    assert.deepEqual(r.I7.first[0], { t: '00:02:41', line: 2473, mob: 'animania:cow_holstein', act: '00:03:16', actLine: 2564, afterS: 35 });
    assert.equal(r.I1.first[0].t, '22:43:52');
    assert.equal(r.I1.first[0].line, 890);
});

test('#623 review 2: a death ends a trap episode; an arrival resets the attempt gap; an episode across midnight', () => {
    const fail = (t, d) => [L(t, 'Path not found, but attempting to navigate anyway using destructive movements.', d)];
    let r = run([...fail('10:00:00'), ...fail('10:01:00'), L('10:01:30', '[death] died at 1, 2, 3; waiting for the respawn'), ...fail('10:02:00')]);
    assert.equal(r.I1.count, 0);
    // An arrival 1 s after a failure, then a failure 1 s later: a new attempt, not the old one.
    r = run([...fail('10:00:00'), L('10:00:01', 'You have reached at 1, 2, 3.'), ...fail('10:00:02'), ...fail('10:01:00'), ...fail('10:02:00')]);
    assert.deepEqual([r.I1.count, r.I1.attempts], [1, 3]);
    r = run([...fail('23:58:00'), ...fail('23:59:30'), ...fail('00:01:00', '2026-11-26')]);
    assert.deepEqual([r.I1.count, r.I1.longestMin], [1, 3]);
});

test('#623 review 1: I7 acts are a hunt start whose next hunting line names the mob, or a !attack on it that ran', () => {
    const refusal = L('10:00:00', '[reflex] hunting: left alone, it may belong to a player: animania:cow_holstein: a animania:bull_holstein within 16 blocks');
    let r = run([REL(21), refusal, L('10:00:35', '[survival] weapon spartanweaponry:club_wood (hunt)'), L('10:00:58', '[reflex] hunting animania:cow_holstein: stuck (left alone for 5 min)')]);
    assert.equal(r.I7.first[0].afterS, 35);
    r = run([REL(21), refusal, L('10:00:35', '[survival] weapon spartanweaponry:club_wood (hunt)'), L('10:00:58', '[reflex] hunting animania:sow_old_spot: stuck (left alone for 5 min)')]);
    assert.equal(r.I7.count, 0); // a hunt of another mob
    r = run([REL(21), refusal, L('10:00:10', "parsed command: { commandName: '!attack', args: [ 'animania:cow_holstein' ] }")]);
    assert.equal(r.I7.first[0].afterS, 10);
});

test('#623 review 3: the #618 limit line is not a click; past the cap the [inventory] count is used when larger', () => {
    const fb = (t) => L(t, '[forge-bridge] click rejected: window 0 slot 4 (mode 0, button 0, action 1); client …; server …');
    const inv = (t) => L(t, '[inventory] craft: Error: Server rejected transaction for clicking on slot 4, on window with id 0. Resyncing and trying once more.');
    const limit = L('10:09:00', '[forge-bridge] click rejected: 2 lines logged; further rejections on this connection are not');
    let r = run([fb('10:00:00'), inv('10:00:00'), fb('10:01:00'), inv('10:01:00'), limit, inv('10:10:00'), inv('10:11:00')]);
    assert.deepEqual([r.I3.count, r.I3.source], [4, '[inventory] (click rejected capped)']);
    r = run([fb('10:00:00'), fb('10:01:00'), limit]);
    assert.deepEqual([r.I3.count, r.I3.source], [2, 'click rejected (capped)']);
});

test('#623 review 4: I12 is null with a note when the journal and server.log death counts differ', () => {
    const r = run([REL(20), L('10:00:08', '[death] died at 1, 2, 3; waiting for the respawn')], { serverText: '' });
    assert.equal(r.I12.deathsUnnamed, null);
    assert.equal(r.I12.note, 'death counts differ: journal 1, server.log 0');
    assert.match(render(r, 'x'), /death counts differ: journal 1, server\.log 0/);
});

test('#623 review 7: render prints I8 never-ran replies; an old-format I5 row has no need', () => {
    const r = run([L('10:00:00', 'Generated response: !attack("x")'), L('10:00:05', '[night] food for the night: food worth 0 hunger held, food 10; less than 6: staying sealed anyway')]);
    assert.match(render(r, 'x'), /never ran: 10:00:00 \(driver\.log:1\)/);
    assert.equal('need' in r.I5.first[0], false);
});

test('render and renderTable print n/a for lines a release did not print', () => {
    const r = run([L('10:00:00', 'x')]);
    assert.match(render(r, 'x'), /I4 dig-refused-with-tool: n\/a/);
    assert.match(renderTable({ 'g4soak-1-x': { release: null, I4_digRefusedWithTool: null } }), /\| 1-x \| – \|/);
});

test('the CLI: a dir reads its server.log; --table; --json; usage errors exit 2; no journal line exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-inv-'));
    try {
        const cli = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
        assert.equal(cli().status, 2);
        assert.equal(cli('a', 'b').status, 2);
        assert.equal(cli(path.join(dir, 'missing.log')).status, 2);
        const soak = path.join(dir, 'g4soak-9-x');
        fs.mkdirSync(soak);
        fs.writeFileSync(path.join(soak, 'driver.log'), [REL(20), L('10:00:08', '[death] died at 1, 2, 3; waiting for the respawn')].join('\n'));
        fs.writeFileSync(path.join(soak, 'server.log'), '[10:00:08] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <bot> was slain by Zombie');
        const one = cli(soak, '--json');
        assert.equal(one.status, 0, one.stderr);
        assert.equal(JSON.parse(one.stdout).I12.deathsUnnamed, 1);
        const t = cli('--table', dir, '--json');
        assert.equal(t.status, 0, t.stderr);
        assert.deepEqual(Object.keys(JSON.parse(t.stdout)), ['g4soak-9-x']);
        assert.match(cli('--table', dir).stdout, /^\| Soak \| Release \|/);
        const empty = path.join(dir, 'empty.log');
        fs.writeFileSync(empty, 'not a journal line');
        assert.equal(cli(empty).status, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
