// G3 rules the runner enforces for every G3 scenario (coord/STATUS-harness-ops.md, "G3 batches";
// lead, #101 and #116 review):
//   - the batch spend stop: maxBatchUsd (USD 2) is a gate parameter compared 'equal';
//   - the console sender `Server` is the test-only task giver: never in the production settings;
//   - the console is limited to G3's approved commands; give, summon, kill and every op command
//     (gamemode, effect, op, ...) are refused before they reach the server.
export const G3_DEFAULTS = Object.freeze({ maxBatchUsd: 2 });
export const G3_GATE_PARAMS = Object.freeze({ maxBatchUsd: 'equal' });
export const TEST_TASK_GIVER = 'Server';

const NAME = '[A-Za-z0-9_]{3,16}';
const N = '-?\\d+';
/** G3's approved console commands (lead, #101), anchored. Nothing else reaches the test server. */
export const G3_CONSOLE_ALLOW = [
    /^say scenario-[0-9a-z-]+-begin$/,                                     // the runner's begin marker
    /^seed$/,
    new RegExp(`^tp ${NAME} ~ ~ ~$`),                                      // read the bot's position
    new RegExp(`^tp ${NAME} ${N} ${N} ${N}$`),                             // the fixed G2 cube centre
    new RegExp(`^tell ${NAME} .+$`),                                       // the test-only task giver `Server`
    new RegExp(`^testforblock ${N} ${N} ${N} \\S+ \\d+$`),
    /^testfor @[aep]\[[^\]]*\]$/,
    new RegExp(`^clear ${NAME} \\S+ ${N} 0$`),                             // count only: maxCount 0, never a real clear
    /^scoreboard objectives add [A-Za-z0-9_]{1,16} stat\.[A-Za-z0-9_.]+$/,
    /^scoreboard objectives remove [A-Za-z0-9_]{1,16}$/,
    new RegExp(`^scoreboard players list ${NAME}$`),
    /^time query daytime$/,
    /^time set day$/,                                                      // G2's list; never in the first-night scenario
    /^gamerule doDaylightCycle$/,                                          // the query form only, no value
    new RegExp(`^setblock ${N} ${N} ${N} minecraft:gold_block$`),          // the task marker only
];

/**
 * What run.mjs applies to a scenario (#122 review findings 3 and 4):
 *   guard:   the console allowlist, for every G3 scenario and every scenario that runs the real agent;
 *   notGate: a reason when a G3 run did not come from batch.mjs (no ROTN_G3_BATCH marker "<id>:<limit>"),
 *            or the marker's limit is not the run's maxBatchUsd: such a run had no spend stop over it.
 */
export function g3Policy(scenario, env, maxBatchUsd) {
    const guard = scenario.gate === 'G3' || scenario.llm === true;
    const marker = env.ROTN_G3_BATCH ?? null;
    let notGate = null;
    if (scenario.gate === 'G3') {
        const m = /^[0-9A-Za-z-]+:(\d+(?:\.\d+)?)$/.exec(marker ?? '');
        if (!m) notGate = 'a G3 run outside batch.mjs has no spend stop (no ROTN_G3_BATCH marker)';
        else if (Number(m[1]) !== Number(maxBatchUsd)) notGate = `the batch's spend limit ${m[1]} is not this run's maxBatchUsd ${maxBatchUsd}`;
    }
    return { guard, notGate, batch: marker };
}

/** The verb of a console command, for error messages (never the arguments). */
const verb = (cmd) => String(cmd).trim().split(/\s+/)[0] || '(empty)';

/** A server whose console refuses anything not on the allowlist (it throws; nothing is sent). */
export function guardConsole(server, allow = G3_CONSOLE_ALLOW) {
    return {
        ...server,
        console(cmd, waitS) {
            if (!allow.some((re) => re.test(cmd))) {
                throw new Error(`console command refused in G3: '${verb(cmd)}' is not on the approved list (give, summon and op commands never reach the server)`);
            }
            return server.console(cmd, waitS);
        },
    };
}

/**
 * The test-only task giver must never be in the production settings (lead, #116 review): every settings
 * key that names task givers (any key matching /giver/i) is checked for TEST_TASK_GIVER. Problems as text.
 */
export function giverProblems(settings) {
    const p = [];
    for (const [k, v] of Object.entries(settings ?? {})) {
        if (!/giver/i.test(k)) continue;
        const list = Array.isArray(v) ? v : [v];
        if (list.some((x) => String(x).toLowerCase() === TEST_TASK_GIVER.toLowerCase())) {
            p.push(`settings.${k} contains '${TEST_TASK_GIVER}': the console sender is a test-only task giver, never in production`);
        }
    }
    return p;
}
