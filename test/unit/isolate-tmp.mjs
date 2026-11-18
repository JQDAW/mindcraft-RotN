// A side-effect import, FIRST in every test/unit file that makes temp dirs: `import './isolate-tmp.mjs';`
// The whole test file (and the shells and processes it spawns, through TMPDIR) then works in one private directory,
// which is removed when the process exits, also after a failed test, an uncaught exception or process.exit. On the
// CX33 /tmp is RAM-backed, and leftovers from these tests took its memory (2026-11-09). A process 'exit' handler
// rather than node:test's after(): after() does not run on an uncaught exception or process.exit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-unit-'));
for (const name of ['TMPDIR', 'TEMP', 'TMP']) process.env[name] = dir;
process.on('exit', () => {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
        process.stderr.write(`isolate-tmp: could not remove ${dir}: ${e.message}\n`);   // never changes the exit code
    }
});
