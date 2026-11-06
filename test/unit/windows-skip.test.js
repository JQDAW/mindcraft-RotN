// The rule for skipping shell-heavy test blocks on a local Windows run (fixtures/windows-skip.mjs): never on
// CI, never on another platform, never with ROTN_RUN_SHELL_TESTS=1, and always with a stated reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsShellSkip, RUN_SHELL_ENV } from './fixtures/windows-skip.mjs';

test('windows-skip: only a local Windows run skips, and it says why and how to run the block', () => {
    const reason = windowsShellSkip('bootstrap.sh', '148 s', { env: {}, platform: 'win32' });
    assert.match(reason, /^Windows, not CI: "bootstrap\.sh" runs bash scripts through Git Bash \(148 s on the team PC\); it does not hang/);
    assert.match(reason, /CI on Linux always runs it; set ROTN_RUN_SHELL_TESTS=1 to run it here\.$/);
    assert.equal(RUN_SHELL_ENV, 'ROTN_RUN_SHELL_TESTS');
    // Never skipped on CI (GitHub Actions sets CI=true), on Linux or macOS, or when asked to run.
    assert.equal(windowsShellSkip('x', '1 s', { env: { CI: 'true' }, platform: 'win32' }), false);
    assert.equal(windowsShellSkip('x', '1 s', { env: {}, platform: 'linux' }), false);
    assert.equal(windowsShellSkip('x', '1 s', { env: {}, platform: 'darwin' }), false);
    assert.equal(windowsShellSkip('x', '1 s', { env: { ROTN_RUN_SHELL_TESTS: '1' }, platform: 'win32' }), false);
    // Only the exact values count: CI=1 or the variable set to something else does not change a Windows run.
    assert.equal(typeof windowsShellSkip('x', '1 s', { env: { ROTN_RUN_SHELL_TESTS: 'yes' }, platform: 'win32' }), 'string');
});
