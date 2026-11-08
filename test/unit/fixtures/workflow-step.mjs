// The `run: |` block of one workflow step, for tests that run a workflow's own bash offline (the sweeper's hcloud
// install, ci-ubuntu-2604's package and native checks). Found by the step's name prefix and cut by indentation, so
// no YAML library is needed (js-yaml and yaml are only transitive dependencies here).
/**
 * The shell GitHub runs a step with: its own `shell:` if it declares one (bash runs as `bash -e -o pipefail`),
 * else the job's default, `sh -e` in a container job (ci-ubuntu-2604: dash, #409's first CI run) and bash on a
 * runner. -> [program, ...args] to spawn with the script as the next argument (`-c`).
 */
export function stepShell(text, stepName, { container }) {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.trim().startsWith(`- name: ${stepName}`));
    if (at < 0) throw new Error(`no step named ${stepName}`);
    const run = lines.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
    const shell = lines.slice(at + 1, run).map((l) => /^\s+shell: (\S+)$/.exec(l)?.[1]).find(Boolean);
    if (shell === 'bash' || (!shell && !container)) return ['bash', '-e', '-o', 'pipefail', '-c'];
    if (shell === 'sh' || !shell) return ['sh', '-e', '-c'];
    throw new Error(`step ${stepName}: shell ${shell} is not modelled`);
}

export function stepScript(text, stepName) {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.trim().startsWith(`- name: ${stepName}`));
    if (at < 0) throw new Error(`no step named ${stepName}`);
    const run = lines.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
    if (run < 0) throw new Error(`step ${stepName} has no run: | block`);
    const indent = lines[run + 1].match(/^ */)[0].length;
    const body = [];
    for (const l of lines.slice(run + 1)) {
        if (l.trim() && l.match(/^ */)[0].length < indent) break;
        body.push(l.slice(indent));
    }
    return body.join('\n');
}
