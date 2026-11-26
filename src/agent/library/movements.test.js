// Soak 17 T (the lead's decisions; the seed of round 17 W): the guarded movements (movements.js) and the static check
// that every pathfinder Movements under src/agent is built or guarded there, or on the allow-list with its reason.
// Offline: fake movements objects and the sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as espree from 'espree';
import { Vec3 } from 'vec3';
import { guardMovements, guardWalkBreaks, setCollectFloor, clearCollectFloor, collectFloorY, COLLECT_FLOOR, WALK_GUARD, UNGUARDED } from './movements.js';

const at = (x, y, z) => new Vec3(x, y, z);
const dirt = (y) => ({ name: 'dirt', metadata: 0, position: at(0, y, 0) });
const fakeMovements = (land = null) => ({ exclusionAreasBreak: [], exclusionAreasStep: [], getLandingBlock: () => land });
const sum = (fns, b) => fns.reduce((n, f) => n + f(b), 0);
const bot = () => ({ entity: { position: at(0.5, 70, 0.5) }, inventory: { items: () => [], slots: [] } });

test('soak 17 T: the collect floor: no break, no step and no landing below it, in any guarded movements', () => {
    const b = bot();
    const m = guardMovements(b, fakeMovements({ position: at(0, 60, 0) }), { floorY: null });
    // No collect: an ordinary walk with no floor of its own may break, step and land anywhere (but the pickaxe keep).
    assert.equal(sum(m.exclusionAreasBreak, dirt(10)), 0);
    assert.equal(sum(m.exclusionAreasStep, dirt(10)), 0);
    assert.ok(m.getLandingBlock({}, {}), 'a drop lands');
    const f = setCollectFloor(b, 68);
    assert.equal(collectFloorY(b), 68);
    assert.equal(sum(m.exclusionAreasBreak, dirt(67)), WALK_GUARD.breakNever, 'a break below the floor: never');
    assert.equal(sum(m.exclusionAreasBreak, dirt(68)), 0, 'at the floor: allowed');
    assert.equal(sum(m.exclusionAreasStep, dirt(67)), WALK_GUARD.breakNever, 'a step below the floor: never (a cave below too)');
    assert.equal(sum(m.exclusionAreasStep, dirt(68)), 0);
    assert.equal(m.getLandingBlock({}, {}), null, 'a drop that lands below the floor (a cave): no move (the pathfinder never checks the landing)');
    clearCollectFloor(b, f);
    assert.equal(collectFloorY(b), null);
    assert.ok(m.getLandingBlock({}, {}), 'after the collect: lands again');
});

test('soak 17 T: within a collect a walk\'s own floor never goes below the collect\'s (goToPosition to a deep target)', () => {
    const b = bot();
    const m = guardWalkBreaks(b, fakeMovements(), 24); // a walk to a target at y 26: its own floor 24
    assert.equal(sum(m.exclusionAreasBreak, dirt(30)), 0, 'outside a collect: the walk may dig down to its goal');
    setCollectFloor(b, 68);
    assert.equal(sum(m.exclusionAreasBreak, dirt(30)), WALK_GUARD.breakNever, 'inside a collect: the higher floor (68)');
    // The walk's own floor and its steps: an ordinary walk may cross a valley (no step floor of its own).
    b.rotnCollectFloor = null;
    assert.equal(sum(m.exclusionAreasStep, dirt(10)), 0);
});

test('soak 17 T: a nested collect keeps the outer floor; a stale one (a killed run) is ignored', () => {
    const b = bot();
    const outer = setCollectFloor(b, 68);
    clearCollectFloor(b, { y: 1 }); // another (inner) record: not the outer one's to clear
    assert.equal(collectFloorY(b), 68);
    clearCollectFloor(b, outer);
    assert.equal(collectFloorY(b), null);
    setCollectFloor(b, 68, Date.now() - COLLECT_FLOOR.maxMs - 1);
    assert.equal(collectFloorY(b), null, 'older than COLLECT_FLOOR.maxMs: ignored');
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
/** The `new X.Movements(...)` / `new Movements(...)` expressions in a source, as "line N". */
function movementsBuilt(src) {
    const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true });
    const out = [];
    const visit = (n) => {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'NewExpression') {
            const c = n.callee;
            const name = c?.type === 'Identifier' ? c.name : c?.type === 'MemberExpression' && !c.computed ? c.property?.name : null;
            if (name === 'Movements') out.push(`line ${n.loc.start.line}`);
        }
        for (const k of Object.keys(n)) {
            if (k === 'loc' || k === 'range') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v);
        }
    };
    visit(ast);
    return out;
}

test('soak 17 T: the static check sees `new pf.Movements(bot)` and `new Movements(bot)`, not a comment or a string', () => {
    assert.equal(movementsBuilt('const m = new pf.Movements(bot);').length, 1);
    assert.equal(movementsBuilt('const m = fallSafe(new Movements(bot));').length, 1);
    assert.equal(movementsBuilt('// new pf.Movements(bot)\nconst s = "new pf.Movements(bot)";').length, 0);
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
