// Movement packet throttle used by initBot (src/utils/mcdata.js).
//
// Upstream Mindcraft queued the *first* packet that arrived inside the 50 ms
// window and dropped every later one, so the server saw a stale position
// (seam-map section B). This version keeps the newest state: a pending
// position and a pending look are merged into one packet when the timer fires.

export const MOVEMENT_PACKETS = new Set(['position', 'position_look', 'look']);

/** Merge two movement packets; fields from `b` (newer) win. */
export function mergeMovement(a, b) {
    if (!a) return b;
    const hasPos = (p) => p.name === 'position' || p.name === 'position_look';
    const hasLook = (p) => p.name === 'look' || p.name === 'position_look';
    const pos = hasPos(b) ? b : hasPos(a) ? a : null;
    const look = hasLook(b) ? b : hasLook(a) ? a : null;
    const onGround = b.data.onGround;
    if (pos && look) {
        return {
            name: 'position_look',
            data: { x: pos.data.x, y: pos.data.y, z: pos.data.z, yaw: look.data.yaw, pitch: look.data.pitch, onGround },
        };
    }
    if (pos) return { name: 'position', data: { x: pos.data.x, y: pos.data.y, z: pos.data.z, onGround } };
    return { name: 'look', data: { yaw: look.data.yaw, pitch: look.data.pitch, onGround } };
}

/**
 * Wrap a write(name, data) function so movement packets go out at most once
 * per `intervalMs`, always with the newest state.
 */
export function throttleMovement(write, { intervalMs = 50, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let last = 0;
    let pending = null;
    let timer = null;

    const flush = () => {
        timer = null;
        const p = pending;
        pending = null;
        if (!p) return;
        last = now();
        write(p.name, p.data);
    };

    const wrapped = function (name, data) {
        if (!MOVEMENT_PACKETS.has(name)) return write(name, data);
        const t = now();
        if (t - last < intervalMs || timer) {
            pending = mergeMovement(pending, { name, data });
            if (!timer) timer = setTimer(flush, Math.max(0, intervalMs - (t - last)));
            return true;
        }
        last = t;
        return write(name, data);
    };
    wrapped.flush = () => { if (timer) { clearTimer(timer); flush(); } };
    wrapped.cancel = () => { if (timer) clearTimer(timer); timer = null; pending = null; };
    return wrapped;
}
