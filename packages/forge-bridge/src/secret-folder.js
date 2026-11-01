// Checks for folders that will hold secrets (the Microsoft token cache).
// Used by tools/msa-login.mjs. Offline, no secrets read.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * The nearest folder at or above `dir` that holds a `.git` entry (a folder for a
 * normal checkout, a file for a worktree or submodule), or null. `dir` need not
 * exist yet; its ancestors are checked anyway.
 */
export function findGitWorkTree(dir) {
    let cur = path.resolve(dir);
    for (;;) {
        if (fs.existsSync(path.join(cur, '.git'))) return cur;
        const up = path.dirname(cur);
        if (up === cur) return null;
        cur = up;
    }
}

/**
 * The real path of `dir`: its deepest existing ancestor resolved with
 * fs.realpathSync (junctions and symlinks followed), plus the parts that do
 * not exist yet.
 */
export function realLocation(dir) {
    let cur = path.resolve(dir);
    const rest = [];
    for (;;) {
        try {
            return path.join(fs.realpathSync.native(cur), ...rest);
        } catch {
            const up = path.dirname(cur);
            if (up === cur) return path.resolve(dir);
            rest.unshift(path.basename(cur));
            cur = up;
        }
    }
}

/**
 * Creates `dir` for a token cache: refuses any folder inside a git work tree,
 * creates it (and missing parents) with mode 0700, and on POSIX chmods it to
 * 0700 in case it already existed. Windows ignores the mode; there the folder
 * inherits the user profile's ACL. Returns the absolute path.
 */
export function prepareSecretFolder(dir, { platform = process.platform } = {}) {
    const abs = path.resolve(dir);
    // Check both the path as given and its real location: a junction or symlink
    // outside a repo can point into one.
    for (const p of new Set([abs, realLocation(abs)])) {
        const tree = findGitWorkTree(p);
        if (tree) throw new Error(`${abs} is inside the git work tree ${tree}; choose a folder outside every repository`);
    }
    fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
    if (platform !== 'win32') fs.chmodSync(abs, 0o700);
    return abs;
}
