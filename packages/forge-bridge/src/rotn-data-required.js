// initBot fails closed without rotn-data (#555, lead decision after the #553 review).
//
// rotn-data is committed data read from disk, not a service: if it does not load, or names no
// mod entities, the checkout or the deploy is broken and every start fails the same way.
// Running on would make the bot treat every living modded entity as hostile (NPCs such as
// ToroQuest guards and villagers included; vanilla villagers and animals too, through
// skills-rotn's threat fallback) and misread blocks. So initBot refuses to start: exit 3
// (fatal, never restarted: RestartPreventExitStatus=0 3), exit-reason category 'rotn-data'.
// Optional tables (block-state remap, collision shapes, serializers) only warn, as before.

import { EXIT } from './kicks.js';
import { fmlEntityTable } from './fml-entities.js';

export const ROTN_DATA_CATEGORY = 'rotn-data';

/** The refusal: an Error with exitCode 3, fatal, category 'rotn-data', saying why and what it would mean. */
export function rotnDataRefusal(why) {
    const message = `[forge-bridge] refusing to start: rotn-data ${why}. `
        + 'Without it the bot would treat every living modded entity as hostile and may attack it '
        + '(NPCs such as ToroQuest guards and villagers included, and vanilla villagers and animals too when rotn-data does not load), '
        + 'and would misread blocks (no block-state remap or collision shapes). '
        + 'rotn-data is committed data, so this is a broken checkout or deploy: fix packages/rotn-data. Exit 3: not restarted.';
    return Object.assign(new Error(message), { exitCode: EXIT.FATAL, fatal: true, category: ROTN_DATA_CATEGORY });
}

/**
 * Loads rotn-data's catalog and builds the FML mod entity table from it, or throws
 * rotnDataRefusal when the load throws, gives nothing, or the table throws or is empty.
 * @param {() => object} load  the catalog loader (initBot: () => loadRotnData(PACK_VERSION))
 * @returns {{ rd: object, modEntityTable: object }}
 */
export function requireRotnData(load) {
    let rd;
    try {
        rd = load();
    } catch (e) {
        throw rotnDataRefusal(`did not load (${e?.message ?? e})`);
    }
    if (!rd) throw rotnDataRefusal('did not load (no catalog)');
    let modEntityTable;
    try {
        modEntityTable = fmlEntityTable({ modEntityTable: () => rd.modEntityTable(), entityByModId: (modId, id) => rd.entityByModId(modId, id) });
    } catch (e) {
        throw rotnDataRefusal(`has no usable mod entity table (${e?.message ?? e})`);
    }
    if (Object.keys(modEntityTable).length === 0) throw rotnDataRefusal('has an empty mod entity table');
    return { rd, modEntityTable };
}
