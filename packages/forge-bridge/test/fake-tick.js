// The 1.12.2 server tick for the offline end-to-end tests (soak 17: a click on the stone pickaxe rejected, its
// damage one behind on the client). On a real server the play packets a client sends are queued for the main
// thread (PacketThreadUtil.checkThreadAndEnqueue, `hv.a` at the top of each NetHandlerPlayServer handler) and run
// at the start of the next tick, in the order they came; then the world ticks (block updates are sent) and the
// players update (EntityPlayerMP.onUpdate: the delayed destroy, then the open container's detectAndSendChanges).
// Here:
// - the packets named in QUEUED are held from the moment they arrive and handed to their handlers (fake-dig,
//   fake-containers) at the next tick, in order;
// - then the dig model's delayed destroy (fake-dig update(), with its tick 'external');
// - then window 0's detectAndSendChanges (fake-containers with tickModel).
// So a dig's STOP and a click that arrive in the same tick run back to back, as on the server, and the click's own
// quantity-only detectAndSendChanges hides the tool damage the STOP made. Packets the fakes answer at once in
// their own handlers (block_change, transaction) still go out during the tick, as the server's would.
// Not modelled: a slow tick (every tick is tickMs), the entity tracker, keep-alives.

/** The serverbound play packets the tick holds. */
export const QUEUED = Object.freeze(['block_dig', 'window_click', 'transaction', 'held_item_slot', 'block_place', 'use_item', 'close_window', 'arm_animation']);

/**
 * Hold the client's play packets for the server tick and run it every tickMs.
 * @param {object} client the server's client (node-minecraft-protocol)
 * @param {object} o
 * @param {object} o.containers attachFakeContainers' result, with tickModel
 * @param {object} [o.dig] attachFakeDig's result, with tick 'external'
 * @param {number} [o.tickMs] one tick (50)
 * @returns {{ state: { ticks: number, log: Array<{ tick: number, packets: string[] }> }, stop: () => void }}
 *   log: per tick that ran packets, what they were ("block_dig 2", "window_click 31 mode 2", ...)
 */
export function attachServerTick(client, { containers, dig = null, tickMs = 50 }) {
    const queue = [];
    const emit = client.emit;
    client.emit = function (name, ...args) {
        if (QUEUED.includes(name)) { queue.push([name, args]); return true; }
        return emit.call(this, name, ...args);
    };
    const state = { ticks: 0, log: [] };
    const describe = (name, p) => (name === 'window_click' ? `window_click ${p.slot} mode ${p.mode}` : name === 'block_dig' ? `block_dig ${p.status}` : name);
    const timer = setInterval(() => {
        state.ticks++;
        const batch = queue.splice(0);
        for (const [name, args] of batch) emit.call(client, name, ...args);
        if (batch.length) state.log.push({ tick: state.ticks, packets: batch.map(([name, [p]]) => describe(name, p)) });
        dig?.update();
        containers.detectAndSendChanges();
    }, tickMs);
    timer.unref?.();
    client.once('end', () => clearInterval(timer));
    return { state, stop() { clearInterval(timer); client.emit = emit; } };
}
