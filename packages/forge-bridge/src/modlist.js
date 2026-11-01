// Mod list helpers. The client must send the server's own ModList before it
// receives the server's, so it comes from a status ping or a pinned ping fixture
// (fml-spec.md section 1.3).

import fs from 'node:fs';

export const REID_MODID = 'jeid'; // RoughlyEnoughIDs' mcmod.info id (fml-spec.md section R)

// Accepts a status-ping response, a { modList } object or a bare array.
export function modListFromPing(ping) {
    if (!ping) return null;
    if (Array.isArray(ping)) return normalize(ping);
    if (Array.isArray(ping.modList)) return normalize(ping.modList);
    const info = ping.modinfo;
    if (info && info.type === 'FML' && Array.isArray(info.modList)) return normalize(info.modList);
    return null;
}

export function loadModListFile(file) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mods = modListFromPing(json);
    if (!mods) throw new Error(`${file}: no FML modList found`);
    return mods;
}

function normalize(list) {
    return list.map(m => ({ modid: String(m.modid), version: String(m.version) }));
}

export function findMod(mods, modid) {
    return mods?.find(m => m.modid === modid) ?? null;
}

export function hasReid(mods) {
    return findMod(mods, REID_MODID) !== null;
}

// Differences between the list we sent and the server's own list.
export function diffModLists(sent, received) {
    const a = new Map(sent.map(m => [m.modid, m.version]));
    const b = new Map(received.map(m => [m.modid, m.version]));
    const missingOnClient = [];
    const extraOnClient = [];
    const versionMismatch = [];
    for (const [id, v] of b) {
        if (!a.has(id)) missingOnClient.push(id);
        else if (a.get(id) !== v) versionMismatch.push({ modid: id, client: a.get(id), server: v });
    }
    for (const id of a.keys()) if (!b.has(id)) extraOnClient.push(id);
    return { missingOnClient, extraOnClient, versionMismatch, equal: !missingOnClient.length && !extraOnClient.length && !versionMismatch.length };
}
