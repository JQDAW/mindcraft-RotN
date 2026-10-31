// Stateful fake of the hcloud CLI for offline tests of deploy/test-server.sh.
// State lives in $FAKE_HCLOUD_STATE (JSON); every call is appended to $FAKE_HCLOUD_LOG (JSONL).
// Models the API rules the script depends on: label selectors, Primary IP auto-delete with its
// server, and "a Primary IP that is still assigned cannot be deleted".
//
// Env: FAKE_HCLOUD_NOAUTH=1 (every call fails), FAKE_HCLOUD_FAIL="server create" (that call fails),
//      FAKE_HCLOUD_STICKY="server" (deletes of that kind report success but do nothing),
//      ROTN_TEST_NOW (epoch used for created timestamps).
import fs from 'node:fs';
import process from 'node:process';

const statePath = process.env.FAKE_HCLOUD_STATE;
const logPath = process.env.FAKE_HCLOUD_LOG;
const argv = process.argv.slice(2);
if (logPath) fs.appendFileSync(logPath, JSON.stringify(argv) + '\n');

const VALUE_FLAGS = new Set(['context', 'name', 'type', 'image', 'location', 'ssh-key', 'primary-ipv4',
    'primary-ipv6', 'user-data-from-file', 'label', 'public-key-from-file', 'o', 'output', 'l', 'selector',
    'assignee-id']);

function parse(args) {
    const pos = [];
    const flags = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        let m;
        if ((m = /^--?([a-z0-9-]+)=(.*)$/.exec(a))) {
            (flags[m[1]] ??= []).push(m[2]);
        } else if ((m = /^--?([a-z0-9-]+)$/.exec(a))) {
            if (VALUE_FLAGS.has(m[1])) (flags[m[1]] ??= []).push(args[++i]);
            else (flags[m[1]] ??= []).push('true');
        } else {
            pos.push(a);
        }
    }
    return { pos, flags };
}

function fail(msg, code = 1) {
    process.stderr.write(`hcloud: ${msg}\n`);
    process.exit(code);
}

const { pos, flags } = parse(argv);
if (process.env.FAKE_HCLOUD_NOAUTH === '1') fail('no active context or token (see `hcloud context --help`)');
const [kind, verb, target] = pos;
if (process.env.FAKE_HCLOUD_FAIL && process.env.FAKE_HCLOUD_FAIL === `${kind} ${verb}`) fail(`injected failure for ${kind} ${verb}`);

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
state.next_id ??= 1000;
state.servers ??= [];
state.primary_ips ??= [];
state.ssh_keys ??= [];
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

const nowEpoch = Number(process.env.ROTN_TEST_NOW || Math.floor(Date.now() / 1000));
const created = new Date(nowEpoch * 1000).toISOString().replace('.000Z', '+00:00');

const labelsFrom = () => Object.fromEntries((flags.label ?? []).map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i), kv.slice(i + 1)];
}));

const matches = (obj) => {
    const sel = (flags.l ?? flags.selector ?? [])[0];
    if (!sel) return true;
    return sel.split(',').every((term) => {
        const [k, v] = term.split('=');
        return (obj.labels ?? {})[k] === v;
    });
};

const out = (obj) => {
    const o = (flags.o ?? flags.output ?? [])[0];
    if (o === 'json') process.stdout.write(JSON.stringify(obj) + '\n');
    else if (o === 'noheader') for (const r of [].concat(obj)) process.stdout.write(`${r.id}  ${r.name}\n`);
    else process.stdout.write(JSON.stringify(obj) + '\n');
};

const collections = { server: 'servers', 'primary-ip': 'primary_ips', 'ssh-key': 'ssh_keys' };
const coll = collections[kind];
const findIn = (list, ref) => list.find((r) => String(r.id) === String(ref) || r.name === ref);

if (kind === 'server-type' && verb === 'describe') {
    const prices = ['fsn1', 'nbg1', 'hel1'].map((location) => ({
        location,
        price_hourly: { net: '0.1160000000', gross: target === 'cx23' ? '0.0109000000' : '0.1381000000' },
        price_monthly: { net: '72.4100', gross: '86.1700' },
    }));
    out({ id: 99, name: target, prices });
    process.exit(0);
}

if (!coll) fail(`unknown command ${kind}`);
const list = state[coll];

if (verb === 'list') {
    out(list.filter(matches));
    process.exit(0);
}

if (verb === 'describe') {
    const r = findIn(list, target);
    if (!r) fail(`${kind} not found: ${target}`);
    out(r);
    process.exit(0);
}

if (verb === 'create') {
    const name = flags.name?.[0];
    if (!name) fail('--name is required');
    if (findIn(list, name)) fail(`name is already used (uniqueness_error)`);
    const base = { id: state.next_id++, name, labels: labelsFrom(), created };
    if (kind === 'ssh-key') {
        list.push({ ...base, fingerprint: 'fake', public_key: 'ssh-ed25519 AAAA fake' });
    } else if (kind === 'primary-ip') {
        list.push({ ...base, ip: `203.0.113.${base.id % 250}`, type: flags.type?.[0], assignee_id: null,
            assignee_type: 'server', auto_delete: flags['auto-delete']?.[0] === 'true',
            location: { name: flags.location?.[0] } });
    } else if (kind === 'server') {
        if (flags['enable-ipv4']) fail('unknown flag: --enable-ipv4');
        const ipRef = flags['primary-ipv4']?.[0];
        const ip = ipRef ? findIn(state.primary_ips, ipRef) : null;
        if (ipRef && !ip) fail(`Primary IP not found: ${ipRef}`);
        const server = { ...base, status: 'running', server_type: { name: flags.type?.[0] },
            location: { name: flags.location?.[0] }, public_net: { ipv4: ip ? { id: ip.id, ip: ip.ip } : null } };
        if (ip) ip.assignee_id = server.id;
        list.push(server);
        save();
        out({ server, root_password: null });
        process.exit(0);
    }
    save();
    out({ [coll.replace(/s$/, '')]: list[list.length - 1] });
    process.exit(0);
}

if (verb === 'delete') {
    const r = findIn(list, target);
    if (!r) fail(`${kind} not found: ${target}`);
    if (process.env.FAKE_HCLOUD_STICKY === kind) process.exit(0);
    if (kind === 'primary-ip' && r.assignee_id) fail('primary IP is assigned to a resource (primary_ip_assigned)');
    state[coll] = list.filter((x) => x !== r);
    if (kind === 'server') {
        for (const ip of state.primary_ips) {
            if (ip.assignee_id === r.id) ip.assignee_id = null;
        }
        state.primary_ips = state.primary_ips.filter((ip) => !(ip.auto_delete && ip.id === r.public_net?.ipv4?.id));
    }
    save();
    process.exit(0);
}

fail(`unsupported: ${argv.join(' ')}`);
