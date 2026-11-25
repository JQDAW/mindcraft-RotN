// A server-side model of digging on RotN 3.3.4 (Forge 14.23.5.2860) for the offline end-to-end tests
// (fake-server task, item 4). It follows the 1.12.2 server code read with javap (memory note
// forge-dig-server-rules; packages/forge-bridge/README.md "Dig time by the Forge rule"):
//
// - NetHandlerPlayServer.processPlayerDigging START (status 0) -> PlayerInteractionManager
//   .onBlockClicked: the block's relative hardness with the server's own held item; 1.0 or more
//   breaks it at once, else the dig starts (destroyPos, its start tick).
// - ABORT (status 1): the dig stops; no block change.
// - STOP (status 2) -> blockRemoving: progress f = relHardness * (ticks since START + 1). f >= 0.7
//   breaks the block. Else, when no delayed destroy is pending, one is armed and finishes when f
//   reaches 1.0 (receivedFinishDiggingPacket); a second early STOP while one is pending is ignored.
//   Then processPlayerDigging sends the block back (SPacketBlockChange) when it is not air.
// - Tool Progression (prevent_block_destruction=true) cancels BreakSpeed when the held item has no
//   level in the block's harvest tool class: relative hardness 0, so the block never breaks.
//
// The relative hardness comes from the same dump-based Forge rule the client uses (forgeDigTime: the
// dump state, the held item's tool classes and speeds, effects), at 50 ms ticks, so a wrong rule is not
// found here. What this finds is a difference of state between client and server: the held item (the
// server's copy of window 0, so an off-hand or cursor pickaxe is not "held"), timing, a block sent back.
// Not modelled: the reach check, spawn protection, Forge's LeftClickBlock event, drops and their
// pickup, neighbour updates, block break progress packets, and the held item changing during a
// delayed destroy (its hardness is taken at the STOP).

import { forgeDigTime, pickState } from '../src/dig-time.js';

const posKey = (p) => `${p.x},${p.y},${p.z}`;

/**
 * @param {object} client the server's client (node-minecraft-protocol)
 * @param {object} opts
 * @param {object} opts.containers attachFakeContainers' result (the server's window 0 and held slot)
 * @param {object} opts.rd rotn-data (getBlock, getItem)
 * @param {object} opts.registry a 1.12.2 prismarine-registry (effect names for forgeDigTime)
 * @param {object} opts.itemNames { itemId: registryName } for the items a test uses
 * @param {object[]} opts.blocks [{ x, y, z, name, meta, id }] the blocks the server knows (id: the block id)
 * @param {number} [opts.tickMs] one server tick (50)
 * @param {object} [opts.effects] the server player's effects, { id: { amplifier } }
 */
export function attachFakeDig(client, { containers, rd, registry, itemNames, blocks, tickMs = 50, effects = {} }) {
    const world = new Map(blocks.map((b) => [posKey(b), { ...b }]));
    const state = { world, digs: [], destroy: null, delayed: null, effects };

    const heldTool = () => {
        const it = containers.state.inv[36 + containers.state.held];
        const name = it && itemNames[it.id];
        const dumped = name ? rd.getItem(name) : null;
        const classes = dumped?.toolClasses;
        return { item: it, tool: classes && Object.keys(classes).length ? { classes, speed: dumped.speed ?? {} } : null };
    };
    // Relative hardness per tick (approximately 1 / the rule's ticks); 0 when the rule says never.
    function relHardness(block) {
        const st = pickState(rd.getBlock(block.name), block.meta ?? 0);
        const ms = forgeDigTime(st, heldTool().tool, { registry, effects: state.effects });
        if (ms === null || ms === undefined) return 0;
        if (ms === 0) return Infinity;
        return Number.isFinite(ms) ? tickMs / ms : 0;
    }
    function breakBlock(pos) {
        const b = world.get(posKey(pos));
        world.set(posKey(pos), { ...b, name: 'minecraft:air', meta: 0, id: 0 });
        client.write('block_change', { location: pos, type: 0 });
    }
    const sendBack = (pos) => {
        const b = world.get(posKey(pos));
        if (b && b.id !== 0) client.write('block_change', { location: pos, type: (b.id << 4) | (b.meta ?? 0) });
    };
    const ticksSince = (t) => Math.floor((Date.now() - t) / tickMs);

    client.on('block_dig', (p) => {
        const pos = p.location;
        const block = world.get(posKey(pos));
        const rec = { status: p.status, pos: { ...pos }, held: heldTool().item?.id ?? null };
        state.digs.push(rec);
        if (!block || block.id === 0) { rec.outcome = 'no block'; return; }
        if (p.status === 0) {
            const rel = relHardness(block);
            rec.rel = rel;
            if (rel >= 1) { breakBlock(pos); rec.outcome = 'broken at once'; state.destroy = null; return; }
            state.destroy = { pos: { ...pos }, at: Date.now() };
            rec.outcome = rel === 0 ? 'started (never breaks: Tool Progression)' : 'started';
            return;
        }
        if (p.status === 1) { state.destroy = null; rec.outcome = 'aborted'; return; }
        if (p.status !== 2) { rec.outcome = 'not modelled'; return; }
        const d = state.destroy;
        if (d && posKey(d.pos) === posKey(pos)) {
            state.destroy = null;
            const ticks = ticksSince(d.at);
            const rel = relHardness(block);
            const f = rel * (ticks + 1);
            Object.assign(rec, { ticks, rel, f });
            if (f >= 0.7) { breakBlock(pos); rec.outcome = 'broken'; return; }
            if (!state.delayed) {
                const need = rel > 0 ? Math.max(0, Math.ceil(1 / rel) - 1 - ticks) : null;
                state.delayed = { pos: { ...pos }, timer: null };
                rec.outcome = need === null ? 'sent back (never breaks)' : 'sent back, delayed destroy armed';
                if (need !== null) {
                    state.delayed.timer = setTimeout(() => {
                        state.delayed = null;
                        if (world.get(posKey(pos))?.id !== 0) breakBlock(pos);
                        state.digs.push({ status: 'delayed', pos: { ...pos }, outcome: 'broken by the delayed destroy' });
                    }, need * tickMs);
                    state.delayed.timer.unref?.();
                } else state.delayed = null;
            } else rec.outcome = 'sent back (a delayed destroy is pending)';
        } else rec.outcome = 'sent back (no dig started there)';
        sendBack(pos); // processPlayerDigging: the block when it is not air
    });

    return {
        state,
        /** The server's block at a position: { name, meta, id }, or undefined. */
        blockAt: (pos) => world.get(posKey(pos)),
        stop() { if (state.delayed?.timer) clearTimeout(state.delayed.timer); state.delayed = null; },
    };
}
