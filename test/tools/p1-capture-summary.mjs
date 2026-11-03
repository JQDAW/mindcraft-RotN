#!/usr/bin/env node
// The P1 evidence summary of a forge-bridge capture (JSONL; packages/forge-bridge/src/capture.js): what
// probe P1 must show that the driver's replies do not (net-forge's "Probe plan P1"):
//   - every serverbound window_click with its item id, and the server's transaction answer for it
//     (accepted or rejected): REID's item ids above 4095 must be accepted;
//   - FastWorkbench: the FML mod window ("fastbench") the crafting table opens, its fastbench payloads,
//     and the clicks and set_slot packets while it is open (the 3x3 table craft);
//   - the block_place packets (the latencies come from the driver's replies: the capture keeps at most
//     300 block_change records, which the login's chunks can use up first; `limits` lists every cap hit).
//
//   node test/tools/p1-capture-summary.mjs CAPTURE.jsonl [--names] > summary.json
//
// --names adds registry names to item ids from rotn-data's Run A id table (the handshake fixture in
// packages/forge-bridge/test/fixtures/rotn-3.3.4). The server's own ids are what the capture shows; a name
// is only a label, and it is null when the id is not in that table.
// Prints JSON; it holds no payload bytes, no addresses and no player names.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REID_MIN_ID = 4096;   // vanilla 1.12 item ids fit in 12 bits; REID's do not

/** The capture's records, skipping lines that are not JSON. */
export function readCapture(text) {
    return String(text).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const itemOf = (it) => (it && Number.isInteger(it.blockId) && it.blockId >= 0 ? { id: it.blockId, count: it.itemCount ?? null, damage: it.itemDamage ?? null } : null);

/** The summary (see the header). names: Map id -> registry name, or null. */
export function summarize(records, { names = null } = {}) {
    const name = (id) => (names && id !== null ? names.get(id) ?? null : undefined);
    const label = (it) => (it ? { ...it, ...(names ? { name: name(it.id) } : {}) } : null);
    const pk = (dir, n) => records.filter((e) => e.kind === 'packet' && e.dir === dir && e.name === n);

    // Each click is answered by a transaction with the same window id and action number.
    const answers = pk('S2C', 'transaction');
    const used = new Set();
    const clicks = pk('C2S', 'window_click').map((e) => {
        const p = e.params ?? {};
        const i = answers.findIndex((a, k) => !used.has(k) && a.t >= e.t && a.params?.windowId === p.windowId && a.params?.action === p.action);
        if (i >= 0) used.add(i);
        const a = i >= 0 ? answers[i] : null;
        return { t: e.t, windowId: p.windowId, slot: p.slot, button: p.mouseButton, mode: p.mode, action: p.action,
            item: label(itemOf(p.item)), accepted: a ? a.params.accepted === true : null, answerMs: a ? a.t - e.t : null };
    });
    const ids = new Map();
    for (const c of clicks) if (c.item) ids.set(c.item.id, (ids.get(c.item.id) ?? 0) + 1);
    const items = [...ids].sort((a, b) => a[0] - b[0]).map(([id, n]) => ({ id, ...(names ? { name: name(id) } : {}), clicks: n, reid: id >= REID_MIN_ID }));

    const modWindows = records.filter((e) => e.kind === 'event' && e.name === 'mod_window')
        .map((e) => ({ t: e.t, modId: e.modId, windowId: e.windowId, inventoryType: e.inventoryType, windowTitle: e.windowTitle }));
    const fastbenchPayloads = records.filter((e) => e.kind === 'payload' && e.channel === 'fastbench').map((e) => ({ t: e.t, dir: e.dir, disc: e.disc, len: e.len }));

    // The table craft: from the fastbench window's opening to its close_window (or the next 10 s).
    const fb = modWindows.find((w) => w.modId === 'fastbench') ?? null;
    let tableCraft = null;
    if (fb) {
        const close = pk('C2S', 'close_window').find((e) => e.t >= fb.t && e.params?.windowId === fb.windowId);
        const until = close ? close.t + 1000 : fb.t + 10000;
        const inWindow = (t) => t >= fb.t && t <= until;
        tableCraft = {
            windowId: fb.windowId, openedT: fb.t, closedT: close?.t ?? null,
            clicks: clicks.filter((c) => c.windowId === fb.windowId),
            setSlots: pk('S2C', 'set_slot').filter((e) => inWindow(e.t))
                .map((e) => ({ t: e.t, windowId: e.params?.windowId, slot: e.params?.slot, item: label(itemOf(e.params?.item)) })),
            fastbenchPayloads: fastbenchPayloads.filter((x) => inWindow(x.t)).length,
        };
    }

    const counts = {};
    for (const e of records) if (e.kind === 'packet') counts[`${e.dir} ${e.name}`] = (counts[`${e.dir} ${e.name}`] ?? 0) + 1;
    return {
        windowClicks: {
            total: clicks.length,
            accepted: clicks.filter((c) => c.accepted === true).length,
            rejected: clicks.filter((c) => c.accepted === false).length,
            unanswered: clicks.filter((c) => c.accepted === null).length,
            reidClicks: clicks.filter((c) => c.item && c.item.id >= REID_MIN_ID).length,
            reidRejected: clicks.filter((c) => c.item && c.item.id >= REID_MIN_ID && c.accepted !== true).length,
            maxItemId: items.length ? items[items.length - 1].id : null,
            items,
        },
        clicks,
        fastbench: { modWindows, payloads: fastbenchPayloads.length },
        tableCraft,
        blockPlaces: pk('C2S', 'block_place').map((e) => ({ t: e.t, location: e.params?.location, direction: e.params?.direction })),
        limits: records.filter((e) => e.kind === 'event' && /limit|full/.test(e.name ?? '')).map(({ t, name: n, ...rest }) => ({ t, name: n, ...rest })),
        packetCounts: counts,
    };
}

/** rotn-data's Run A item ids (net-forge's handshake fixture): Map id -> registry name. */
export async function runANames() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const { runARegistries } = await import(pathToFileURL(path.join(here, '..', '..', 'packages', 'forge-bridge', 'test', 'helpers.js')).href);
    return new Map([...runARegistries().get('minecraft:items').ids].map(([n, id]) => [id, n]));
}

async function main([file, ...rest]) {
    if (!file) {
        console.error('usage: node test/tools/p1-capture-summary.mjs CAPTURE.jsonl [--names]');
        return 2;
    }
    const names = rest.includes('--names') ? await runANames() : null;
    console.log(JSON.stringify(summarize(readCapture(fs.readFileSync(file, 'utf8')), { names }), null, 2));
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => {
        console.error(`p1-capture-summary: ${e?.message ?? e}`);
        process.exitCode = 1;
    });
}
