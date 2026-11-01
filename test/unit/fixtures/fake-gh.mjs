// Fake of the parts of the gh CLI that deploy/test-server.sh and test/scenarios/g0-watchdog.sh use.
// State: $FAKE_GH_STATE (JSON {runs: [{databaseId, event, status, conclusion, createdAt, headBranch, log,
// repo, workflow}]}). repo defaults to JQDAW/mindcraft-RotN and workflow to test-server-sweeper.yml, so
// a run of the helper repo (JQDAW/rotn-sweeper-cron, dispatch-sweeper.yml) must say so.
// Every call is appended to $FAKE_GH_LOG (JSONL).
//
//   run list [--workflow W] [--branch B] [--event E] [--limit N] --json FIELDS --repo R
//   api -X GET repos/OWNER/REPO --jq .pushed_at   from $FAKE_GH_STATE repos[OWNER/REPO].pushed_at
//                                                 (a listed repo with no pushed_at prints an empty line)
//   api -X GET -i rate_limit                      headers; "Date:" from $FAKE_GH_DATE (epoch), if set
//   run view ID --log | --json FIELDS
//   workflow run W --ref B     runs $FAKE_GH_DISPATCH_CMD (bash -c) as the "sweeper" and records
//                              its output, GitHub-style ("sweep\tStep\t<ts> <line>"), as the run log.
//
// Env: FAKE_GH_FAIL=1 (every call fails, like a logged-out gh); FAKE_GH_FAIL_REPO=OWNER/REPO (only calls
//      with --repo OWNER/REPO fail).
import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { writeAtomic, readJsonRetry } from './atomic-write.mjs';

const argv = process.argv.slice(2);
const statePath = process.env.FAKE_GH_STATE;
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(argv) + '\n');
const repoArg = argv[argv.indexOf('--repo') + 1];
if (process.env.FAKE_GH_FAIL === '1' || (process.env.FAKE_GH_FAIL_REPO && argv.includes('--repo') && repoArg === process.env.FAKE_GH_FAIL_REPO)) {
    process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\n');
    process.exit(4);
}

const load = () => (statePath ? readJsonRetry(statePath, { runs: [] }) : { runs: [] });
const save = (st) => writeAtomic(statePath, JSON.stringify(st));
const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const pick = (run, fields) => Object.fromEntries(fields.split(',').map((f) => [f, run[f]]));

const [group, verb] = argv;
const st = load();
const DEFAULT_REPO = 'JQDAW/mindcraft-RotN';
const repoOf = (r) => r.repo ?? DEFAULT_REPO;
const workflowOf = (r) => r.workflow ?? 'test-server-sweeper.yml';

if (group === 'run' && verb === 'list') {
    let runs = [...st.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    runs = runs.filter((r) => repoOf(r) === (flag('--repo') ?? DEFAULT_REPO));
    if (flag('--workflow')) runs = runs.filter((r) => workflowOf(r) === flag('--workflow'));
    if (flag('--event')) runs = runs.filter((r) => r.event === flag('--event'));
    if (flag('--branch')) runs = runs.filter((r) => r.headBranch === flag('--branch'));
    runs = runs.slice(0, Number(flag('--limit') ?? 20));
    process.stdout.write(JSON.stringify(runs.map((r) => pick(r, flag('--json') ?? 'databaseId'))) + '\n');
} else if (group === 'run' && verb === 'view') {
    const run = st.runs.find((r) => String(r.databaseId) === argv[2]);
    if (!run) {
        process.stderr.write(`could not find any workflow run with ID ${argv[2]}\n`);
        process.exit(1);
    }
    if (argv.includes('--log')) process.stdout.write(run.log ?? '');
    else process.stdout.write(JSON.stringify(pick(run, flag('--json') ?? 'status')) + '\n');
} else if (group === 'api' && argv.includes('GET') && argv.includes('-i') && argv.includes('rate_limit')) {
    const date = process.env.FAKE_GH_DATE ? `Date: ${new Date(Number(process.env.FAKE_GH_DATE) * 1000).toUTCString()}\r\n` : '';
    process.stdout.write(`HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n${date}\r\n{"resources":{}}\n`);
} else if (group === 'api' && argv.includes('GET') && flag('--jq') === '.pushed_at') {
    const repo = argv.find((a) => a.startsWith('repos/'))?.slice('repos/'.length);
    if (!st.repos || !(repo in st.repos)) {
        process.stderr.write('gh: Not Found (HTTP 404)\n');
        process.exit(1);
    }
    process.stdout.write(`${st.repos[repo].pushed_at ?? ''}\n`);
} else if (group === 'workflow' && verb === 'run') {
    const id = 90000000 + st.runs.length + 1;
    const cmd = process.env.FAKE_GH_DISPATCH_CMD ?? 'true';
    const r = spawnSync(process.env.FAKE_GH_BASH ?? 'bash', ['-c', cmd], { encoding: 'utf8', env: process.env });
    const ts = new Date().toISOString();
    const log = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter(Boolean)
        .map((l) => `sweep\tSweep expired labelled test resources\t${ts} ${l}\n`).join('');
    st.runs.push({ databaseId: id, event: 'workflow_dispatch', status: 'completed',
        conclusion: r.status === 0 ? 'success' : 'failure', createdAt: ts.replace(/\.\d+Z$/, 'Z'),
        headBranch: flag('--ref') ?? 'develop', log, repo: flag('--repo') ?? DEFAULT_REPO, workflow: argv[2] });
    save(st);
    process.stdout.write(`https://github.com/example/repo/actions/runs/${id}\n`);
} else {
    process.stderr.write(`fake gh: unsupported command ${argv.join(' ')}\n`);
    process.exit(2);
}
