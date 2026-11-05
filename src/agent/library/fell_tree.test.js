// Offline tests for the G3 smoke finding C+D: breaking a Dynamic Trees branch gave no log three
// times in each scenario ("Broke dynamictrees:sprucebranch but got no log"). On this pack a branch
// break fells the tree (rotn-data's "fell-tree" rule); its logs drop where it lands, a moment later
// and away from the bot. collectBlock now waits for them (bounded) and picks them up around the
// branch. A fake bot on the 1.12.2 registry plus the branch block; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { worldSources } from './rotn_sources.js';
import * as skills from './skills.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName } };
const BRANCH = { id: 4300, name: 'dynamictrees:sprucebranch' };
reg.blocks[BRANCH.id] = BRANCH; reg.blocksByName[BRANCH.name] = BRANCH;
__setRegistryForTest(reg);

const T = { timeout: 10_000 };
const LIMITS = { settleMs: 1500, quietMs: 300, walkMs: 500, totalMs: 4000 };
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);

/**
 * fallMs: the drops appear this long after the break; drops: where they land (log:1 each);
 * reach: a drop is picked up when the bot ends a walk within this distance of it.
 */
function fakeBot({ fallMs = 400, drops = [at(9), at(10), at(11, 64, 2)], unreachable = [] } = {}) {
    const items = [{ name: 'stone_axe', metadata: 0, count: 1, type: reg.itemsByName.stone_axe.id }];
    const branch = {
        name: BRANCH.name, metadata: 0, type: BRANCH.id, position: at(3),
        canHarvest: () => true, boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]],
    };
    const remaining = [branch];
    let nextId = 1;
    const calls = { dug: 0, goto: 0 };
    const bot = {
        calls, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: at(0), height: 1.8 },
        entities: {}, heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            return remaining.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance)
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => remaining.find(b => b.position.equals(pos)) ?? null,
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        tool: { equipForBlock: () => Promise.resolve() },
        dig: (b) => {
            calls.dug++;
            remaining.splice(remaining.indexOf(b), 1);
            // The tree falls; its logs drop where it lands, fallMs later.
            setTimeout(() => {
                for (const pos of drops) { const id = nextId++; bot.entities[id] = { id, name: 'item', position: pos }; }
            }, fallMs);
            return Promise.resolve();
        },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
        pathfinder: {
            setMovements() {}, setGoal() {}, isMoving: () => false, stop() {},
            getPathTo: () => ({ status: 'success', path: [] }),
            goto(goal) {
                calls.goto++;
                const target = at(goal.x, goal.y, goal.z);
                if (unreachable.some(p => p.equals(target))) return new Promise(() => {}); // never arrives
                bot.entity.position = at(goal.x + 1, goal.y, goal.z);
                for (const [id, e] of Object.entries(bot.entities)) {
                    if (e.name === 'item' && e.position.distanceTo(bot.entity.position) <= 1.5) {
                        delete bot.entities[id];
                        const log = items.find(i => i.name === 'log' && i.metadata === 1);
                        if (log) log.count++; else items.push({ name: 'log', metadata: 1, count: 1, type: reg.itemsByName.log.id });
                    }
                }
                return Promise.resolve();
            },
        },
    };
    return bot;
}

test('rotn-data: a log comes from felling a tree (a Dynamic Trees branch), with an axe', () => {
    const fell = worldSources('log').find(s => s.id === 'fell-tree');
    assert.ok(fell, 'the fell-tree rule is a log source');
    assert.ok(fell.blocks.includes('dynamictrees:sprucebranch'));
    assert.equal(fell.tool?.type, 'axe');
});

test('a branch break: the logs that drop away from the bot after the fall are picked up and counted', T, async (t) => {
    Object.assign(skills.FELL_LIMITS, LIMITS);
    t.after(() => Object.assign(skills.FELL_LIMITS, { settleMs: 6000, quietMs: 1000, walkMs: 8000, totalMs: 30_000 }));
    const bot = fakeBot();
    assert.equal(await skills.collectBlock(bot, 'log', 1), true);
    assert.equal(bot.calls.dug, 1);
    assert.doesNotMatch(bot.output, /got no log/);
    assert.match(bot.output, /Felled the tree at 3, 64, 0: 3 drops within 12 blocks, 0 left behind\./);
    assert.match(bot.output, /Collected 3 log/);
});

test('the wait for the drops and each walk are bounded: no drops, and a drop that cannot be reached', T, async (t) => {
    Object.assign(skills.FELL_LIMITS, LIMITS);
    t.after(() => Object.assign(skills.FELL_LIMITS, { settleMs: 6000, quietMs: 1000, walkMs: 8000, totalMs: 30_000 }));
    // Nothing drops: it waits settleMs, then reports the real (zero) gain.
    const none = fakeBot({ drops: [] });
    let t0 = Date.now();
    assert.equal(await skills.collectBlock(none, 'log', 1), false);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
    assert.match(none.output, /0 drops within 12 blocks, 0 left behind/);
    assert.match(none.output, /Broke dynamictrees:sprucebranch but got no log\./);

    // One drop never reached: its walk ends at walkMs; the others are still picked up.
    const stuck = fakeBot({ unreachable: [at(9)] });
    t0 = Date.now();
    assert.equal(await skills.collectBlock(stuck, 'log', 1), true);
    assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
    assert.match(stuck.output, /3 drops within 12 blocks, 1 left behind/);
    assert.match(stuck.output, /Collected 2 log/);
});
