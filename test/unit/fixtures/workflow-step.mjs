// The `run: |` block of one workflow step, for tests that run a workflow's own bash offline (the sweeper's hcloud
// install, ci-ubuntu-2604's package and native checks). Found by the step's name prefix and cut by indentation, so
// no YAML library is needed (js-yaml and yaml are only transitive dependencies here).
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
