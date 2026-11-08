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

/**
 * Each "!nearbyBlocks" result (src/agent/commands/queries.js): "NEARBY_BLOCKS", then "- <name>" lines, a liquid with
 * " (source)" or " (flowing)", then "- Block Below: <name>", "- Block at Legs: <name>", "- Block at Head: <name>" and
 * "- First Solid Block Above Head: <name> (N blocks up)" or "none"; or "NEARBY_BLOCKS: none". agent.js logs it as
 * console.log('Agent executed:', name, 'and got:', result), and the result starts with a newline (pad), so the header
 * is on the next line (G3 evidence, e.g. g3a-20261105 driver.log 149-150); the same line is accepted too.
 * -> [{at, names, none}]: names with every suffix stripped and the "Block ...: " labels dropped; "none" skipped.
 */
export function nearbyBlocksResults(lines) {
    const out = [];
    const LABEL = /^(Block Below|Block at Legs|Block at Head|First Solid Block Above Head): (.*)$/;
    const name = (x) => {
        const m = LABEL.exec(x);
        const v = (m ? m[2] : x).replace(/ \((source|flowing)\)$/, '').replace(/ \(\d+ blocks? up\)$/, '').trim();
        return v === 'none' && m ? null : v;
    };
    for (let i = 0; i < lines.length; i++) {
        const m = /^Agent executed: !nearbyBlocks and got:\s*(.*)$/.exec(lines[i]);
        if (!m) continue;
        let j = i + 1;
        let header = m[1].trim();
        if (!header) { while (j < lines.length && !lines[j].trim()) j++; header = (lines[j++] ?? '').trim(); }
        if (header === 'NEARBY_BLOCKS: none') { out.push({ at: i, names: [], none: true }); continue; }
        if (header !== 'NEARBY_BLOCKS') continue;
        const names = [];
        for (; j < lines.length && /^- /.test(lines[j]); j++) { const n = name(lines[j].slice(2)); if (n !== null) names.push(n); }
        out.push({ at: i, names, none: false });
    }
    return out;
}

/**
 * What is wrong with a block name the agent reported (G2/G4 #2: no unknown or numeric ids), or null. The agent lists
 * vanilla blocks without their namespace ("dirt"), mods' with it ("dynamictrees:trunkshell").
 */
export function blockNameProblem(n) {
    if (!n) return 'empty';
    if (/^(undefined|null)$/.test(n)) return n;
    if (/^\d+(:\d+)?$/.test(n)) return 'a numeric id';
    if (/(^|[:_/])unknown([_/]|$)/.test(n)) return 'unknown';
    if (/(^|:)(block|entity|item)_\d+$/.test(n)) return 'a placeholder';
    if (!/^([a-z][a-z0-9_.-]*:)?[a-z0-9_./-]*[a-z][a-z0-9_./-]*$/.test(n)) return 'not a registry name';
    return null;
}

/**
 * The cost of each LLM completion, from openrouter.js's (#395) "[openrouter] usage prompt_tokens <n|unknown>,
 * completion_tokens <n|unknown>, cost_usd <number|unknown>". -> {lines, known, unknown, usd}
 */
export function llmUsage(lines) {
    let n = 0, unknown = 0, usd = 0;
    for (const l of lines) {
        const m = /^\[openrouter\] usage prompt_tokens \S+, completion_tokens \S+, cost_usd (\S+)$/.exec(l);
        if (!m) continue;
        n++;
        const v = Number(m[1]);
        if (m[1] === 'unknown' || !Number.isFinite(v)) unknown++; else usd += v;
    }
    return { lines: n, known: n - unknown, unknown, usd: Math.round(usd * 1e6) / 1e6 };
}

/** agent_process restarts and agent exits in the log (an in-process restart, or the process ending). */
export function agentExits(lines, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const restart = new RegExp(`^\\[agent_process\\] ${esc}: (.+); restarting in \\d+ s\\.$`);
    const fatal = new RegExp(`^\\[agent_process\\] ${esc}: FATAL `);
    return lines.flatMap((l, at) => (restart.test(l) || fatal.test(l) || /^Agent process exited with code /.test(l) ? [{ at, line: l }] : []));
}
