// Round 17 K (Fable S3, S6): structured skill results. A skill keeps its boolean return and its log lines; a failure
// site that knows its reason calls fail(), which logs the same line and keeps {code, why, where} on the bot. The
// command layer calls a skill's ...Result sibling (resultOf), which returns {ok, code, why, where}: the code for the
// evidence tool's [result] line, the why for the model and the memory's Recent failures. No imports: skills.js and
// escape.js both use it.

/** A cell as "x,y,z" (floored), or null. */
export function cellText(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
    return `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
}

/**
 * A failure with its code: logs why (as log() does) and keeps {code, why, where, owner} for resultOf. owner: the skill
 * the failure is that skill's own (craftRecipe, placeBlock, placeHere). Returns false, so a site reads
 * `return fail(bot, 'no-table', text, null, 'craftRecipe')` where it read `log(bot, text); return false`.
 */
export function fail(bot, code, why, where = null, owner = null) {
    if (why) bot.output = (bot.output ?? '') + why + '\n';
    bot.rotnFails = (bot.rotnFails ?? 0) + 1;
    bot.rotnFail = { code, why: why ?? null, where: cellText(where), owner };
    const log = (bot.rotnFailLog ??= []);
    log.push({ n: bot.rotnFails, ...bot.rotnFail });
    if (log.length > 32) log.splice(0, log.length - 32);
    return false;
}

/**
 * Run a boolean skill and give its result: {ok, code, why, where}. code and why are the last fail() during the call
 * that one of `owners` tagged (the skill's own sites): K1 review 5, a nested skill's failure (placeBlock's place-error
 * inside the craft's table walk) or a reflex's during the call is never reported as this skill's code. A failure no
 * owned site tagged gets code 'failed' and the last line the call logged. A throw is not caught here.
 */
export async function resultOf(bot, run, owners = null) {
    const n0 = bot.rotnFails ?? 0;
    const mark = String(bot.output ?? '').length;
    const ok = await run();
    if (ok) return { ok: true, code: 'ok', why: null, where: null };
    const own = (f) => !owners || owners.includes(f.owner);
    const f = (bot.rotnFailLog ?? []).filter(e => e.n > n0 && own(e)).at(-1) ?? null;
    const said = String(bot.output ?? '').slice(mark).split('\n').map(l => l.trim()).filter(Boolean);
    return { ok: false, code: f?.code ?? 'failed', why: f?.why ?? said.at(-1) ?? null, where: f?.where ?? null };
}

/**
 * The evidence tool's line for one command result (K1 PR body, "For harness-ops"). Fixed field order, why last and
 * quoted (JSON): [result] cmd=!craftRecipe args=["stone_axe",1] ok=false code=no-table where=-8,70,-3 why="..."
 */
export function resultLine(cmd, args, r) {
    let a = '[]';
    try { a = JSON.stringify(args ?? []); } catch { a = '[]'; }
    const why = JSON.stringify(String(r?.why ?? ''));
    return `[result] cmd=${cmd} args=${a} ok=${r?.ok === true} code=${r?.code ?? (r?.ok ? 'ok' : 'failed')} where=${r?.where ?? '-'} why=${why}`;
}
