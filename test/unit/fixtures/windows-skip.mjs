// Which shell-heavy test blocks a local Windows run skips, and why (lead, 2026-11-06: net-forge's local
// `npm test` on Windows "timed out" in cx23.test.js and test-server.test.js).
//
// They do not hang. They run the deploy scripts through Git Bash, where every process start costs tens to
// hundreds of milliseconds, and these blocks start thousands: on the team PC (16 cores, 2026-11-06) cx23.test.js
// alone took 189 s (bootstrap.sh 148 s) and test-server.test.js alone 255 s (the sweeper preflight 117 s, up /
// run / down 69 s). That outlasts the time limits of an agent's tool call, which then reports a "timeout".
//
// The rule: on Windows a block that needs minutes of Git Bash is skipped, with this reason printed by node:test
// ("# SKIP ..."), unless ROTN_RUN_SHELL_TESTS=1. It is never skipped on CI (CI=true, which GitHub Actions sets)
// or on any other platform, so CI on Linux always runs every block.
import process from 'node:process';

export const RUN_SHELL_ENV = 'ROTN_RUN_SHELL_TESTS';

/**
 * false (run it), or the skip reason for a block that needs `measured` of Git Bash on Windows.
 * env and platform are parameters for the unit test of this rule.
 */
export function windowsShellSkip(block, measured, { env = process.env, platform = process.platform } = {}) {
    if (platform !== 'win32' || env.CI === 'true' || env[RUN_SHELL_ENV] === '1') return false;
    return `Windows, not CI: "${block}" runs bash scripts through Git Bash (${measured} on the team PC); it does not hang, `
        + `but it outlasts tool time limits. CI on Linux always runs it; set ${RUN_SHELL_ENV}=1 to run it here.`;
}
