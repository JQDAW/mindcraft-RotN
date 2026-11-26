// A server-side model of digging on RotN 3.3.4 (Forge 14.23.5.2860) for the offline end-to-end tests
// (fake-server task, item 4). It follows the 1.12.2 server code read with javap (net-forge's extracts:
// PlayerInteractionManager `or`, NetHandlerPlayServer `pa`; memory note forge-dig-server-rules):
//
// - processPlayerDigging START (status 0) -> onBlockClicked: the block's relative hardness with the
//   server's own held item; 1.0 or more breaks it at once; else the dig starts: isDestroyingBlock,
//   destroyPos and its start tick (initialDamage).
// - ABORT (status 1) -> cancelDestroyingBlock (or.e): isDestroyingBlock off. Then, as for STOP,
//   processPlayerDigging sends the block back when it is not air (pa, offset 446; #629 review 2).
// - STOP (status 2) -> blockRemoving (or.a(et)), only when the position is destroyPos and not air:
//   progress f = relHardness * (ticks since START + 1); f >= 0.7 breaks the block. Else, when no
//   delayed destroy is held (h), one is armed for this block with that start tick (h, i, j); while one
//   is held a later early STOP arms nothing. blockRemoving clears isDestroyingBlock but not destroyPos,
//   so a later STOP at the same position still counts from that START. Then the block is sent back
//   when it is not air (pa, offset 446).
// - Every tick (or.a(), bytecode 0-160): while a delayed destroy is held, it is released when its block
//   is air; else f = relHardness with the player's CURRENT held item * (ticks since its start + 1), and
//   at 1.0 the block breaks and the slot is released. So a block that cannot break with the held item
//   (Tool Progression: relative hardness 0) keeps the slot, and breaks as soon as a tool that can is
//   held (#629 review 1).
// - Tool Progression (prevent_block_destruction=true) cancels BreakSpeed when the held item has no
//   level in the block's harvest tool class: relative hardness 0, so the block never breaks with it.
//
// The relative hardness comes from the same dump-based Forge rule the client uses (forgeDigTime: the dump
// state, the held item's tool classes and speeds, effects), at 50 ms ticks, so a wrong rule is not found
// here. What this finds is a difference of state between client and server: the held item (the server's
// copy of window 0, so an off-hand or cursor pickaxe is not "held"), timing, a block sent back.
// #629 review 5: forgeDigTime gives the client's tick-rounded time (ceil(1 / delta) ticks), and this model
// takes relHardness = 50 ms / that time, slightly below the server's real value; so a case that sits right
// at f = 0.7 or 1.0 is not trustworthy here, only ones clearly on one side.
// With the server tick (opts.tick 'external', fake-tick.js; soak 17) the delayed destroy runs in that tick
// (update(), as EntityPlayerMP.onUpdate runs or.a() before detectAndSendChanges, `B_` bytecode 4 and 38), and with
// opts.toolDamage a block the player breaks damages the held item by one when it has a tool class (ItemTool.
// onBlockDestroyed); the change is not sent here, the tick's detectAndSendChanges sends it. opts.multiBlockChange:
// a broken block is sent as a multi_block_change of one record, not a block_change (state.multiBlockChange, changeable).
// Not modelled: the reach check, spawn protection, Forge's LeftClickBlock event, drops and their pickup,
// neighbour updates, block break progress packets.

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
 * @param {string} [opts.tick] 'external': no timer of its own; the server tick calls update()
 * @param {boolean} [opts.toolDamage] a broken block damages the held tool by one (not sent here)
 * @param {boolean} [opts.multiBlockChange] send a broken block as a multi_block_change
 */
export function attachFakeDig(client, { containers, rd, registry, itemNames, blocks, tickMs = 50, effects = {}, tick: tickMode = null, toolDamage = false, multiBlockChange = false }) {
    const world = new Map(blocks.map((b) => [posKey(b), { ...b }]));
    // destroy: destroyPos and its START (kept after a STOP or an ABORT); destroying: isDestroyingBlock;
    // delayed: the held delayed destroy (h, i, j), or null.
    const state = { world, digs: [], destroy: null, destroying: false, delayed: null, effects, multiBlockChange };

    const heldTool = () => {
        const it = containers.state.inv[36 + containers.state.held];
        const name = it && itemNames[it.id];
        const dumped = name ? rd.getItem(name) : null;
        const classes = dumped?.toolClasses;
        return { item: it, tool: classes && Object.keys(classes).length ? { classes, speed: dumped.speed ?? {} } : null };
    };
    // Relative hardness per tick with the held item now (about 1 / the rule's ticks); 0 when the rule says never.
    function relHardness(block) {
        const st = pickState(rd.getBlock(block.name), block.meta ?? 0);
        const ms = forgeDigTime(st, heldTool().tool, { registry, effects: state.effects });
        if (ms === null || ms === undefined) return 0;
        if (ms === 0) return Infinity;
        return Number.isFinite(ms) ? tickMs / ms : 0;
    }
    const isAir = (pos) => (world.get(posKey(pos))?.id ?? 0) === 0;
    function breakBlock(pos) {
        const b = world.get(posKey(pos));
        world.set(posKey(pos), { ...b, name: 'minecraft:air', meta: 0, id: 0 });
        const { item, tool } = heldTool();
        if (toolDamage && item && tool) containers.state.inv[36 + containers.state.held] = { ...item, meta: (item.meta ?? 0) + 1 };
        if (state.multiBlockChange) {
            const cx = Math.floor(pos.x / 16), cz = Math.floor(pos.z / 16);
            client.write('multi_block_change', { chunkX: cx, chunkZ: cz, records: [{ horizontalPos: ((pos.x - cx * 16) << 4) | (pos.z - cz * 16), y: pos.y, blockId: 0 }] });
        } else client.write('block_change', { location: pos, type: 0 });
    }
    const sendBack = (pos) => { // processPlayerDigging, offset 446: the block when it is not air
        const b = world.get(posKey(pos));
        if (b && b.id !== 0) client.write('block_change', { location: pos, type: (b.id << 4) | (b.meta ?? 0) });
    };
    const ticksSince = (t) => Math.floor((Date.now() - t) / tickMs);

    // The tick's delayed destroy (or.a(), bytecode 10-160): with the held item now, every tick.
    function update() {
        const d = state.delayed;
        if (!d) return;
        if (isAir(d.pos)) { state.delayed = null; return; }
        const f = relHardness(world.get(posKey(d.pos))) * (ticksSince(d.at) + 1);
        if (f >= 1) {
            state.delayed = null;
            breakBlock(d.pos);
            state.digs.push({ status: 'tick', pos: { ...d.pos }, f, outcome: 'broken by the delayed destroy' });
        }
    }
    const tick = tickMode === 'external' ? null : setInterval(update, tickMs);
    tick?.unref?.();
    client.once('end', () => clearInterval(tick));

    client.on('block_dig', (p) => {
        const pos = p.location;
        const block = world.get(posKey(pos));
        const rec = { status: p.status, pos: { ...pos }, held: heldTool().item?.id ?? null };
        state.digs.push(rec);
        if (p.status === 0) {
            if (!block || block.id === 0) { rec.outcome = 'no block'; return; }
            const rel = relHardness(block);
            rec.rel = rel;
            if (rel >= 1) { breakBlock(pos); rec.outcome = 'broken at once'; return; }
            state.destroy = { pos: { ...pos }, at: Date.now() };
            state.destroying = true;
            rec.outcome = rel === 0 ? 'started (never breaks with this item: Tool Progression)' : 'started';
            return;
        }
        if (p.status === 1) { // cancelDestroyingBlock, then the block back
            state.destroying = false;
            rec.outcome = isAir(pos) ? 'aborted' : 'aborted, sent back';
            sendBack(pos);
            return;
        }
        if (p.status !== 2) { rec.outcome = 'not modelled'; return; }
        const d = state.destroy;
        if (d && posKey(d.pos) === posKey(pos) && !isAir(pos)) { // blockRemoving
            const ticks = ticksSince(d.at);
            const rel = relHardness(block);
            const f = rel * (ticks + 1);
            Object.assign(rec, { ticks, rel, f });
            state.destroying = false;
            if (f >= 0.7) { breakBlock(pos); rec.outcome = 'broken'; return; }
            if (!state.delayed) {
                state.delayed = { pos: { ...pos }, at: d.at };
                rec.outcome = 'sent back, delayed destroy held';
            } else rec.outcome = 'sent back (a delayed destroy is already held: ignored)';
        } else rec.outcome = isAir(pos) ? 'no block' : 'sent back (not the dig started)';
        sendBack(pos);
    });

    return {
        state,
        /** The server's block at a position: { name, meta, id }, or undefined. */
        blockAt: (pos) => world.get(posKey(pos)),
        /** One tick's delayed destroy (with opts.tick 'external', the server tick calls it). */
        update,
        stop() { clearInterval(tick); state.delayed = null; },
    };
}
