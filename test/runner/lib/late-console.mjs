// Console replies that arrive after the console call's own wait (P1 attempt 1, 2026-11-03: a `clear`
// made two mods save, and the server answered the next `give` about 3 s later, after the 1 s window, so
// a give the server had done was read as unconfirmed).
//
// `rotn-test console --wait S CMD` returns the server log lines written from the moment it sent CMD
// until S seconds later. A reply written after that is still in the log. confirm(cmd, accept) sends cmd;
// if accept(lines) fails on the console's own lines, it reads the server log (`server.log(n)`) for up to
// lateMs and tries accept again on the lines written AFTER the newest lines any console call has
// returned so far (the anchor). Those later lines can only belong to this command or to the server
// itself, never to an earlier command, whose own lines are at or before the anchor. If the anchor is
// not in the log tail any more, nothing is rescued: the check fails as before.
//
// Every rescue is recorded (late()), so the evidence shows which reply came late and by how much.

/** The index just after the last occurrence of the anchor block in lines, or -1 if it is not there. */
export function afterAnchor(lines, anchor) {
    if (!anchor.length) return -1;
    for (let i = lines.length - anchor.length; i >= 0; i--) {
        if (anchor.every((a, k) => lines[i + k] === a)) return i + anchor.length;
    }
    return -1;
}

/**
 * server: {console(cmd, waitS), log(n)}; clock: {now(), sleep(ms)}.
 * Returns {con(cmd), confirm(cmd, accept), late()}: con sends without a check; confirm returns the
 * lines accept matched (the console's own, or the later log lines), or the console's own lines if
 * neither matched.
 */
export function lateConsole(server, clock, { waitS = 1, lateMs = 5000, pollMs = 1000, anchorLines = 3, tail = 400 } = {}) {
    let anchor = [];   // the newest lines a console call returned
    const rescued = [];
    const send = (cmd) => {
        const lines = server.console(cmd, waitS) ?? [];
        if (lines.length) anchor = lines.slice(-anchorLines);
        return lines;
    };
    async function confirm(cmd, accept) {
        const before = anchor;
        const lines = send(cmd);
        if (accept(lines)) return lines;
        // The anchor for "after this command was sent": the newest lines seen before it, plus its own.
        const from = lines.length ? lines.slice(-anchorLines) : before;
        const t0 = clock.now();
        for (;;) {
            const log = server.log(tail) ?? [];
            const at = afterAnchor(log, from);
            if (at >= 0) {
                const later = log.slice(at);
                if (accept(later)) {
                    rescued.push({ cmd: verb(cmd), afterMs: clock.now() - t0, line: later.find((l) => accept([l])) ?? null });
                    if (later.length) anchor = later.slice(-anchorLines);
                    return later;
                }
            }
            if (clock.now() - t0 >= lateMs) return lines;
            await clock.sleep(pollMs);
        }
    }
    return { con: send, confirm, late: () => rescued };
}

/** The verb and first argument of a console command, for the record (never more). */
const verb = (cmd) => String(cmd).trim().split(/\s+/).slice(0, 3).join(' ');
