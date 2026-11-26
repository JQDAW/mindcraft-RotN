// Soak 17 T (the lead's decisions; the seed of round 17 W): the guarded movements (movements.js) and the static check
// that every pathfinder Movements under src/agent is built or guarded there, or on the allow-list with its reason.
// Offline: fake movements objects and the sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as espree from 'espree';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import pf from 'mineflayer-pathfinder';
import { guardMovements, guardWalkBreaks, setCollectFloor, clearCollectFloor, collectFloorY, surfaceTargetBelowFloor, noteCollectDig, walksBackToFloor, WALK_GUARD, UNGUARDED } from './movements.js';

const at = (x, y, z) => new Vec3(x, y, z);
const reg = minecraftData('1.12.2');
const Block = prismarineBlock(reg);
const blockOf = (name, p) => { const b = new Block(reg.blocksByName[name].id, 0, 0); b.position = p; return b; };
/**
 * A world (prismarine blocks): stone up to y 67 west of x 1; east of it (x >= 1) a step down, stone up to y 66, and with
 * `roof`, a stone roof at y 69-70 over x >= 1 (a cave mouth); `valley`: column 5, 0 open down to its ground at y 55.
 */
function world({ roof = false } = {}) {
    return (p) => {
        const q = p.floored();
        if (q.x === 5 && q.z === 0) return blockOf(q.y <= 55 ? 'stone' : 'air', q);
        const top = q.x >= 1 ? 66 : 67;
        if (roof && q.x >= 1 && q.y >= 69 && q.y <= 70) return blockOf('stone', q);
        return blockOf(q.y <= top ? 'stone' : 'air', q);
    };
}
const dirt = (y, x = 0) => ({ name: 'dirt', metadata: 0, position: at(x, y, 0) });
const fakeMovements = (land = null) => ({ exclusionAreasBreak: [], exclusionAreasStep: [], getLandingBlock: () => land });
const sum = (fns, b) => fns.reduce((n, f) => n + f(b), 0);
const bot = (opts = {}) => ({ registry: reg, version: '1.12.2', blockAt: world(opts), entity: { position: at(0.5, 68, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [], slots: [] }, game: { minY: 0 }, pathfinder: { bestHarvestTool: () => null } });

test('soak 17 T: the collect floor: no break, no step and no landing below it under rock; under open sky at the start a step may go below it', () => {
    const b = bot({ roof: true });
    const m = guardMovements(b, fakeMovements({ position: at(1, 60, 0) }), { floorY: null });
    // No collect: an ordinary walk with no floor of its own may break, step and land anywhere (but the pickaxe keep).
    assert.equal(sum(m.exclusionAreasBreak, dirt(10)), 0);
    assert.equal(sum(m.exclusionAreasStep, dirt(10)), 0);
    assert.ok(m.getLandingBlock({}, {}), 'a drop lands');
    const f = setCollectFloor(b, 68, { startY: 70 });
    assert.equal(collectFloorY(b), 68);
    assert.equal(sum(m.exclusionAreasBreak, dirt(67)), WALK_GUARD.breakNever, 'a break below the floor: never');
    assert.equal(sum(m.exclusionAreasBreak, dirt(56, 5)), WALK_GUARD.breakNever, 'never a break below it, under the sky too');
    assert.equal(sum(m.exclusionAreasBreak, dirt(68)), 0, 'at the floor: allowed');
    assert.equal(sum(m.exclusionAreasStep, dirt(67, 1)), WALK_GUARD.breakNever, 'a step below the floor under the roof: never (a cave)');
    assert.equal(sum(m.exclusionAreasStep, dirt(56, 5)), 0, 'a step below the floor in the valley, under open sky at the start: allowed');
    assert.equal(sum(m.exclusionAreasStep, dirt(68)), 0);
    assert.equal(m.getLandingBlock({}, {}), null, 'a drop that lands below the floor under rock: no move (the pathfinder never checks the landing)');
    clearCollectFloor(b, f);
    assert.equal(collectFloorY(b), null);
    assert.ok(m.getLandingBlock({}, {}), 'after the collect: lands again');
});

test('#665 review 5: a real Movements: the diagonal drop below the floor (no landing check in mineflayer-pathfinder) is no move under rock; in the open it is', () => {
    const ends = (b) => new pf.Movements(b).getNeighbors({ x: 0, y: 68, z: 0, remainingBlocks: 0 }).map(n => `${n.x},${n.y},${n.z}`);
    assert.ok(ends(bot({ roof: true })).includes('1,67,1'), 'the pathfinder offers the diagonal drop to y 67');
    const cave = bot({ roof: true });
    setCollectFloor(cave, 68, { startY: 70 });
    const guarded = guardMovements(cave, new pf.Movements(cave), { floorY: null }).getNeighbors({ x: 0, y: 68, z: 0, remainingBlocks: 0 }).map(n => `${n.x},${n.y},${n.z}`);
    assert.ok(!guarded.some(e => Number(e.split(',')[1]) < 68), `no move below the floor under the roof: ${guarded.join(' ')}`);
    const open = bot({ roof: false });
    setCollectFloor(open, 68, { startY: 70 });
    const sky = guardMovements(open, new pf.Movements(open), { floorY: null }).getNeighbors({ x: 0, y: 68, z: 0, remainingBlocks: 0 }).map(n => `${n.x},${n.y},${n.z}`);
    assert.ok(sky.includes('1,67,1'), `under open sky at the start: the step down stays: ${sky.join(' ')}`);
});

test('#665 round 1 (the surface exception): below the floor, a log on the valley floor (under open sky at the start) is a target; a block in a cave mouth is not', () => {
    const b = bot({ roof: true });
    const f = setCollectFloor(b, 68, { startY: 70 });
    const log = blockOf('log', at(5, 56, 0));
    const inner = b.blockAt;
    b.blockAt = (p) => (p.floored().equals(log.position) ? log : inner(p));
    assert.equal(surfaceTargetBelowFloor(b, at(5, 56, 0)), true, 'the log over the valley floor (y 55)');
    assert.equal(surfaceTargetBelowFloor(b, at(5, 55, 0)), true, 'the valley floor itself: the top of its column');
    assert.equal(surfaceTargetBelowFloor(b, at(5, 54, 0)), false, 'under it: no');
    assert.equal(surfaceTargetBelowFloor(b, at(1, 66, 0)), false, 'under the roof: a cave, never');
    clearCollectFloor(b, f);
    // A column the collect dug in before it was read: nothing in it is sky (a shaft is no surface).
    const f2 = setCollectFloor(b, 68, { startY: 70 });
    noteCollectDig(b, at(5, 57, 0));
    assert.equal(surfaceTargetBelowFloor(b, at(5, 55, 0)), false, 'the valley column, dug in by this collect first');
    clearCollectFloor(b, f2);
});

test('#665 round 2 (blocker): a real Movements: no drop into a pit below the floor that has no walk back; a 1-drop and a walkable valley stay', () => {
    // The reviewer's case: floor 68 (start 70), the bot at 0, 68, 0 on stone (y 67); a 1x1 pit at 1, 0 open down to its
    // bottom at y 65 (stone up to 64 there), under open sky; no blocks to tower with.
    const pit = (p) => {
        const q = p.floored();
        if (q.x === 1 && q.z === 0) return blockOf(q.y <= 64 ? 'stone' : 'air', q);
        return blockOf(q.y <= 67 ? 'stone' : 'air', q);
    };
    const b = { ...bot(), blockAt: pit };
    const ends = () => guardMovements(b, new pf.Movements(b), { floorY: null }).getNeighbors({ x: 0, y: 68, z: 0, remainingBlocks: 0 }).map(n => `${n.x},${n.y},${n.z}`);
    const unguarded = new pf.Movements(b).getNeighbors({ x: 0, y: 68, z: 0, remainingBlocks: 0 }).map(n => `${n.x},${n.y},${n.z}`);
    assert.ok(unguarded.includes('1,65,0'), `the pathfinder offers the 3-drop into the pit: ${unguarded.join(' ')}`);
    setCollectFloor(b, 68, { startY: 70 });
    assert.ok(!ends().includes('1,65,0'), 'with the collect floor: no drop into it (no walk back, and every break below the floor is barred)');
    assert.equal(walksBackToFloor(b, at(1, 65, 0)), false);
    assert.equal(surfaceTargetBelowFloor(b, at(1, 64, 0)), true, 'the pit\'s bottom block is under open sky at the start ...');
    // ... so the collect also needs the walk back for it (skills.collectBlock wanted()): none here.
    assert.equal(walksBackToFloor(b, at(1, 64, 0), { free: new Set(['1,64,0']) }), false);
    // A valley reached by steps of one: walkable back.
    const steps = (p) => { const q = p.floored(); const top = q.x <= 0 ? 67 : Math.max(60, 67 - q.x); return blockOf(q.y <= top ? 'stone' : 'air', q); };
    const v = { ...bot(), blockAt: steps };
    setCollectFloor(v, 68, { startY: 70 });
    assert.equal(walksBackToFloor(v, at(5, 63, 0)), true, 'up the steps to the floor');
});

test('soak 17 T: within a collect a walk\'s own floor never goes below the collect\'s (goToPosition to a deep target)', () => {
    const b = bot();
    const m = guardWalkBreaks(b, fakeMovements(), 24); // a walk to a target at y 26: its own floor 24
    assert.equal(sum(m.exclusionAreasBreak, dirt(30)), 0, 'outside a collect: the walk may dig down to its goal');
    setCollectFloor(b, 68, { startY: 70 });
    assert.equal(sum(m.exclusionAreasBreak, dirt(30)), WALK_GUARD.breakNever, 'inside a collect: the higher floor (68)');
});

test('#665 review 1 and 7: a nested collect never clears the outer floor; the floor holds only while its action is the current one', () => {
    const b = bot();
    b.rotnActionSeq = 3;
    const outer = setCollectFloor(b, 68, { startY: 70 });
    clearCollectFloor(b, null); // a nested collect set none
    assert.equal(collectFloorY(b), 68, 'a nested collect (no record of its own) leaves the outer floor');
    clearCollectFloor(b, { y: 1 }); // another record: not this one's to clear
    assert.equal(collectFloorY(b), 68);
    b.rotnActionSeq = 4; // the action manager: that action ended (or another started)
    assert.equal(collectFloorY(b), null, 'an abandoned collect\'s floor binds no later walk');
    b.rotnActionSeq = 3;
    clearCollectFloor(b, outer);
    assert.equal(collectFloorY(b), null);
});

test('soak 17 T: keep false leaves out the pickaxe-keep rule (the collect\'s own target check); a second guard only sets the floor', () => {
    const b = bot();
    const withKeep = guardMovements(b, fakeMovements());
    const noKeep = guardMovements(b, fakeMovements(), { keep: false });
    assert.equal(withKeep.exclusionAreasBreak.length, 2);
    assert.equal(noKeep.exclusionAreasBreak.length, 1);
    const again = guardMovements(b, withKeep, { floorY: 50 });
    assert.equal(again, withKeep);
    assert.equal(again.exclusionAreasBreak.length, 2, 'guarded once');
    assert.equal(again.rotnWalkGuard.floorY, 50);
});

// ---- the static check: every `new Movements(...)` under src/agent is in movements.js or on the allow-list ----
/**
 * The `new X.Movements(...)` / `new Movements(...)` expressions in a source, as "line N". #665 review 9: also through an
 * alias (`const M = pf.Movements; new M()`, `const { Movements: M } = pf`, `import { Movements as M }`) and a computed key
 * (`new pf['Movements']()`).
 */
function movementsBuilt(src) {
    const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true });
    const isMovementsKey = (m) => m?.type === 'MemberExpression' && (m.computed ? m.property?.type === 'Literal' && m.property.value === 'Movements' : m.property?.name === 'Movements');
    const aliases = new Set(['Movements']);
    const walk = (n, f) => {
        if (!n || typeof n.type !== 'string') return;
        f(n);
        for (const k of Object.keys(n)) {
            if (k === 'loc' || k === 'range') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(c => walk(c, f)); else if (v && typeof v.type === 'string') walk(v, f);
        }
    };
    walk(ast, (n) => {
        if (n.type === 'ImportSpecifier' && (n.imported?.name ?? n.imported?.value) === 'Movements') aliases.add(n.local.name);
        if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && isMovementsKey(n.init)) aliases.add(n.id.name);
        if (n.type === 'VariableDeclarator' && n.id?.type === 'ObjectPattern') {
            for (const p of n.id.properties ?? []) if ((p.key?.name ?? p.key?.value) === 'Movements' && p.value?.type === 'Identifier') aliases.add(p.value.name);
        }
    });
    const out = [];
    walk(ast, (n) => {
        if (n.type !== 'NewExpression') return;
        const c = n.callee;
        if ((c?.type === 'Identifier' && aliases.has(c.name)) || isMovementsKey(c)) out.push(`line ${n.loc.start.line}`);
    });
    return out;
}

test('soak 17 T: the static check sees `new pf.Movements(bot)` and `new Movements(bot)`, not a comment or a string', () => {
    assert.equal(movementsBuilt('const m = new pf.Movements(bot);').length, 1);
    assert.equal(movementsBuilt('const m = fallSafe(new Movements(bot));').length, 1);
    assert.equal(movementsBuilt('// new pf.Movements(bot)\nconst s = "new pf.Movements(bot)";').length, 0);
    // #665 review 9: aliases and a computed key.
    assert.equal(movementsBuilt('const M = pf.Movements; const m = new M(bot);').length, 1);
    assert.equal(movementsBuilt("import { Movements as X } from 'mineflayer-pathfinder'; const m = new X(bot);").length, 1);
    assert.equal(movementsBuilt("const { Movements: Y } = pf; const m = new Y(bot);").length, 1);
    assert.equal(movementsBuilt("const m = new pf['Movements'](bot);").length, 1);
    assert.equal(movementsBuilt('const m = new pf.goals.GoalNear(0, 0, 0, 1);').length, 0);
});

test('soak 17 T (round 17 W seed): every pathfinder Movements under src/agent is built in movements.js, or in a file on its allow-list', () => {
    const root = new URL('..', import.meta.url).pathname;
    const files = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !p.endsWith('.test.js')) files.push(p); } };
    walk(root);
    const allowed = new Set(Object.values(UNGUARDED).flatMap(e => e.files));
    const bad = [];
    for (const f of files) {
        const rel = relative(root, f);
        if (rel === 'library/movements.js' || allowed.has(rel)) continue;
        for (const r of movementsBuilt(readFileSync(f, 'utf8'))) bad.push(`${rel}:${r}`);
    }
    assert.deepEqual(bad, [], 'build them with movements.guardedMovements (or guard them with guardMovements)');
    // The allow-list (the lead): !digDown, the pit shelter and the escape, each with its reason; its files exist and do
    // build Movements (no stale entry).
    assert.deepEqual(Object.keys(UNGUARDED).sort(), ['digDown', 'escape', 'pitShelter']);
    for (const [k, e] of Object.entries(UNGUARDED)) {
        assert.ok(typeof e.why === 'string' && e.why.length > 40, `${k} has its reason`);
        for (const rel of e.files) assert.ok(movementsBuilt(readFileSync(join(root, rel), 'utf8')).length > 0, `${rel} builds Movements`);
    }
});
