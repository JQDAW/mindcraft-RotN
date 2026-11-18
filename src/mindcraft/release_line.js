// RotN (G4 step 7, condition (c)): name the release this process runs from, read from the
// filesystem, so the acceptance runner reads it from the journal instead of trusting a marker.
// deploy/cx23/deploy.sh extracts each release to /opt/mindcraft-rotn/releases/<tag>-<sha12>/ and the
// unit runs /opt/mindcraft-rotn/current/main.js; Node resolves the `current` symlink for the main
// module, so main.js's real directory is the release directory.
import { basename, dirname } from 'path';
import { fileURLToPath } from 'url';

// The same tag rule as deploy.sh's TAG_RE, then '-' and the commit's first 12 hex digits.
export const RELEASE_RE = /^rotn-v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?-[0-9a-f]{12}$/;

/** The startup line for a release directory name; anything else (a dev checkout) prints "none". */
export function releaseLine(dirName) {
    const name = typeof dirName === 'string' ? dirName : '';
    return `[release] ${RELEASE_RE.test(name) ? name : 'none'}`;
}

/** The release line for the module at moduleUrl (main.js passes import.meta.url). */
export function releaseLineFor(moduleUrl) {
    try {
        return releaseLine(basename(dirname(fileURLToPath(moduleUrl))));
    } catch {
        return releaseLine('');
    }
}
