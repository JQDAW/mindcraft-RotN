// Reading the bot's own survival and death lines from its log (on S the unit's journal; on T the driver's output),
// for g4-soak-2h (test/scenarios/g4/PLAN.md items 2, 5 and 7). The formats are skills-rotn's:
//   src/agent/library/survival_log.js (#384, #387):
//     [survival] ate <item> food <before>-><after>
//     [survival] fight start <mob> (<where>)              where: open | shelter
//     [survival] fight end <mob> <outcome> after <secs> s  outcome: killed | gone | stopped | capped | interrupted | died
//     [survival] flee <mob> (<why>)
//     [survival] food <food> health <health> (<reason>)    reason: check | low
//   src/agent/library/death_report.js:
//     [death] died at <x, y, z>; waiting for the respawn   (the death)
//     [death] died at <x, y, z>[ (<cause>)]; lost ...       (its report)
//   the agent's command output: "Agent executed: !nearbyBlocks and got: " then "NEARBY_BLOCKS" and "- <name>" lines.
//   agent_process.js: "[agent_process] <bot>: <class>; restarting in N s." and "Agent process exited with code ...".

const num = (s) => (s === 'unknown' ? null : Number(s));

/** The [survival] lines, by kind, in order: {ate, fightStart, fightEnd, flee, food}. */
export function survivalEvents(lines) {
    const out = { ate: [], fightStart: [], fightEnd: [], flee: [], food: [] };
    lines.forEach((l, at) => {
        let m;
        if ((m = /^\[survival\] ate (\S+) food (\S+)->(\S+)$/.exec(l))) out.ate.push({ at, item: m[1], before: num(m[2]), after: num(m[3]) });
        else if ((m = /^\[survival\] fight start (\S+) \((open|shelter)\)$/.exec(l))) out.fightStart.push({ at, mob: m[1], where: m[2] });
        else if ((m = /^\[survival\] fight end (\S+) (\w+) after (\d+) s$/.exec(l))) out.fightEnd.push({ at, mob: m[1], outcome: m[2], secs: Number(m[3]) });
        else if ((m = /^\[survival\] flee (\S+) \((.*)\)$/.exec(l))) out.flee.push({ at, mob: m[1], why: m[2] });
        else if ((m = /^\[survival\] food (\S+) health (\S+) \((check|low)\)$/.exec(l))) out.food.push({ at, food: num(m[1]), health: num(m[2]), reason: m[3] });
    });
    return out;
}

/** Deaths ("... waiting for the respawn") and their reports ("...; lost ..."), each with its line index. */
export function deathEvents(lines) {
    const deaths = [];
    const reports = [];
    lines.forEach((l, at) => {
        if (/^\[death\] died at .*; waiting for the respawn$/.test(l)) deaths.push({ at, line: l });
        else if (/^\[death\] died at .*; lost /.test(l)) reports.push({ at, line: l });
    });
    return { deaths, reports };
}

/** Each "!nearbyBlocks" result: the "- <name>" lines after "NEARBY_BLOCKS". -> [{at, names}] */
export function nearbyBlocksResults(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/^Agent executed: !nearbyBlocks and got:/.test(lines[i])) continue;
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (lines[j] !== 'NEARBY_BLOCKS') continue;
        const names = [];
        for (j++; j < lines.length && /^- /.test(lines[j]); j++) names.push(lines[j].slice(2).trim());
        out.push({ at: i, names });
    }
    return out;
}

/**
 * What is wrong with a block name the agent reported (G2/G4 #2: no unknown or numeric ids), or null. The agent lists
 * vanilla blocks without their namespace ("dirt"), mods' with it ("dynamictrees:trunkshell").
 */
export function blockNameProblem(n) {
    if (!n) return 'empty';
    if (/^\d+(:\d+)?$/.test(n)) return 'a numeric id';
    if (/(^|[:_/])unknown([_/]|$)/.test(n)) return 'unknown';
    if (/(^|:)(block|entity|item)_\d+$/.test(n)) return 'a placeholder';
    if (!/^([a-z][a-z0-9_.-]*:)?[a-z0-9_./-]*[a-z][a-z0-9_./-]*$/.test(n)) return 'not a registry name';
    return null;
}

/** agent_process restarts and agent exits in the log (an in-process restart, or the process ending). */
export function agentExits(lines, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const restart = new RegExp(`^\\[agent_process\\] ${esc}: (.+); restarting in \\d+ s\\.$`);
    const fatal = new RegExp(`^\\[agent_process\\] ${esc}: FATAL `);
    return lines.flatMap((l, at) => (restart.test(l) || fatal.test(l) || /^Agent process exited with code /.test(l) ? [{ at, line: l }] : []));
}
