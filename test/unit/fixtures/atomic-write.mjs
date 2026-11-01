// writeAtomic(path, data): write the fakes' state files so that a concurrent reader sees either the old
// or the new content, never a half-written file. A plain writeFileSync truncates first, and a reader in
// another process could parse "" ("Unexpected end of JSON input", CI run 41319007977, PR #21).
// The data goes to a temp file in the same directory, then rename() replaces the target in one step.
// On Windows a rename can fail briefly with EPERM/EBUSY/EACCES while another process has the target
// open; it is retried for up to about 2 s.
import fs from 'node:fs';
import process from 'node:process';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let seq = 0;

export function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.${seq++}.tmp`;
    fs.writeFileSync(tmp, data);
    for (let attempt = 0; ; attempt++) {
        try {
            fs.renameSync(tmp, file);
            return;
        } catch (e) {
            if (!TRANSIENT.has(e.code) || attempt >= 40) {
                fs.rmSync(tmp, { force: true });
                throw e;
            }
            pause(50);
        }
    }
}

/** JSON.parse of a file that another process may be replacing: retried briefly, then the error is thrown. */
export function readJsonRetry(file, fallback) {
    for (let attempt = 0; ; attempt++) {
        try {
            if (!fs.existsSync(file)) return fallback;
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            if (attempt >= 20) throw e;
            pause(25);
        }
    }
}
