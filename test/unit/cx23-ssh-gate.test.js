// Offline tests for deploy/cx23/mindcraft-rotn-ssh-gate.sh, the forced command of the CX33's restricted SSH key to
// deploy@cx23 (ADR 0009, ADR 0011). A copy runs with its program paths pointed at fakes: `sudo` and `logger` record
// their exact argv (NUL-separated), so the tests see what root (or rotn-build) would run and what syslog would get.
// The fake sudo answers the ctl's `list` ($FAKE_LIST, exit $FAKE_LIST_RC) and `is-enabled BOT` ($FAKE_EN_<bot>,
// default "disabled"); every other call exits $FAKE_RC. Nothing connects to the CX23.
import './isolate-tmp.mjs';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const here = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(here, '..', '..', 'deploy', 'cx23', 'mindcraft-rotn-ssh-gate.sh');
const SRC = fs.readFileSync(GATE, 'utf8');
const BASH = process.env.BASH_BIN || 'bash';
const CTL = '/usr/local/sbin/mindcraft-rotn-ctl';
const DEPLOY_SH = '/usr/local/lib/mindcraft-rotn/deploy.sh';
const AS_BUILD = ['-n', '-u', 'rotn-build', DEPLOY_SH];
const REFUSAL = 'rotn-ssh-gate: refused. Allowed: status|start|stop|metrics BOT; journal BOT [--since YYYY-MM-DDTHH:MM[:SS][Z]|@EPOCH]; '
    + 'reset-state BOT NAME; deploy|deploy-check rotn-vX.Y.Z; release\n';

let tmp, copy, sudoLog, loggerLog, pathSudoLog;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-gate-'));
    sudoLog = path.join(tmp, 'sudo.log');
    loggerLog = path.join(tmp, 'logger.log');
    pathSudoLog = path.join(tmp, 'path-sudo.log');
    const fake = (name, log, rc = 'exit "${FAKE_RC:-0}"') => {
        const f = path.join(tmp, name);
        fs.writeFileSync(f, `#!/bin/bash\nprintf '%s\\0' "$@" >> '${log}'\nprintf '\\n' >> '${log}'\n${rc}\n`, { mode: 0o755 });
        return f;
    };
    const sudo = fake('sudo', sudoLog, [
        'case "$*" in',
        `  "-n ${CTL} list") printf '%b' "\${FAKE_LIST-}"; exit "\${FAKE_LIST_RC:-0}" ;;`,
        `  "-n ${CTL} is-enabled "*) v="FAKE_EN_\${4//-/_}"; s=\${!v-disabled}; [[ -n $s ]] && echo "$s"; [[ $s == enabled ]] && exit 0; exit 1 ;;`,
        'esac',
        'exit "${FAKE_RC:-0}"',
    ].join('\n'));
    const logger = fake('logger', loggerLog, 'exit "${FAKE_LOGGER_RC:-0}"');
    // A "sudo" earlier on any PATH the caller could set: the gate must never run it.
    fs.mkdirSync(path.join(tmp, 'evil'));
    fake(path.join('evil', 'sudo'), pathSudoLog);
    const body = SRC.replace('readonly SUDO=/usr/bin/sudo', `readonly SUDO=${sudo}`)
        .replace('readonly LOGGER=/usr/bin/logger', `readonly LOGGER=${logger}`);
    assert.notEqual(body, SRC);
    copy = path.join(tmp, 'gate.sh');
    fs.writeFileSync(copy, body, { mode: 0o755 });
});

/** Run the gate as sshd would: SSH_ORIGINAL_COMMAND set (or not), with an environment a client could influence. */
function gate(cmd, extraEnv = {}) {
    for (const f of [sudoLog, loggerLog, pathSudoLog]) fs.rmSync(f, { force: true });   // each call's own record
    const env = { PATH: `${path.join(tmp, 'evil')}:/usr/bin:/bin`, HOME: tmp, ...extraEnv };
    if (cmd !== undefined) env.SSH_ORIGINAL_COMMAND = cmd;
    const r = spawnSync(BASH, ['-p', copy], { env, encoding: 'utf8', timeout: 20000 });
    const calls = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\0').slice(0, -1)) : []);
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, sudo: calls(sudoLog), logger: calls(loggerLog), pathSudo: calls(pathSudoLog) };
}
const refusedLine = (r) => r.logger.find((a) => a.includes('auth.warning'))?.at(-1);

describe('mindcraft-rotn-ssh-gate: the allowed requests (ADR 0009)', () => {
    test('status, start, stop and metrics BOT run `sudo -n mindcraft-rotn-ctl VERB BOT`, and are logged at auth.info', () => {
        for (const verb of ['status', 'start', 'stop', 'metrics']) {
            fs.rmSync(sudoLog, { force: true });
            fs.rmSync(loggerLog, { force: true });
            const r = gate(`${verb} frcfld`);
            assert.equal(r.code, 0, `${verb}: ${r.stderr}`);
            assert.deepEqual(r.sudo, [['-n', CTL, verb, 'frcfld']], verb);
            assert.deepEqual(r.logger, [['-t', 'rotn-ssh-gate', '-p', 'auth.info', '--', `allowed: ${verb} frcfld`]], verb);
        }
    });

    test('journal BOT, and journal BOT --since in the no-space forms only (T form, optional seconds and Z; @epoch)', () => {
        const ok = [
            ['journal frcfld', ['journal', 'frcfld']],
            ['journal frcfld --since 2026-11-08T00:00', ['journal', 'frcfld', '--since', '2026-11-08T00:00']],
            ['journal frcfld --since 2026-11-08T00:00:30Z', ['journal', 'frcfld', '--since', '2026-11-08T00:00:30Z']],
            ['journal frcfld --since 2026-11-08T23:59Z', ['journal', 'frcfld', '--since', '2026-11-08T23:59Z']],
            ['journal frcfld --since @1762560000', ['journal', 'frcfld', '--since', '@1762560000']],
            ['journal rotn-bot-2 --since @0', ['journal', 'rotn-bot-2', '--since', '@0']],
        ];
        for (const [cmd, args] of ok) {
            fs.rmSync(sudoLog, { force: true });
            const r = gate(cmd);
            assert.equal(r.code, 0, `${cmd}: ${r.stderr}`);
            assert.deepEqual(r.sudo, [['-n', CTL, ...args]], cmd);
        }
    });

    test('the bot name follows the ctl\'s BOT_RE: 1-32 chars, lowercase letters, digits and \'-\', not starting with \'-\'', () => {
        for (const name of ['a', '0', 'frcfld', 'bot-2', 'a'.repeat(32)]) assert.equal(gate(`status ${name}`).code, 0, name);
        for (const name of ['A', 'FRCFLD', 'Frcfld', '-x', 'a'.repeat(33), 'bot_2', 'bot.2', 'bot/2', '..', 'é']) {
            const r = gate(`status ${name}`);
            assert.equal(r.code, 126, name);
            assert.deepEqual(r.sudo, [], name);
        }
    });

    test('the ctl\'s exit code comes back to the client (exec), e.g. 3 from a stopped unit\'s status', () => {
        assert.equal(gate('status frcfld', { FAKE_RC: '3' }).code, 3);
    });

    test('#365 review: a gate refusal (126) is told apart from the ctl\'s own refusal (2), which comes back unchanged', () => {
        const ctlRefused = gate('status nobot', { FAKE_RC: '2' });   // allowed by the gate; the ctl refuses (no env file)
        assert.equal(ctlRefused.code, 2);
        assert.deepEqual(ctlRefused.sudo, [['-n', CTL, 'status', 'nobot']]);
        const gateRefused = gate('restart frcfld');
        assert.equal(gateRefused.code, 126);
        assert.deepEqual(gateRefused.sudo, []);
        assert.match(SRC, /^readonly REFUSED=126 /m);
    });

    test('a logger that fails or is missing never blocks an allowed request', () => {
        const r = gate('status frcfld', { FAKE_LOGGER_RC: '1' });
        assert.equal(r.code, 0);
        assert.deepEqual(r.sudo, [['-n', CTL, 'status', 'frcfld']]);
    });
});

describe('mindcraft-rotn-ssh-gate: everything else is refused and logged safely', () => {
    const REFUSED = [
        // other ctl verbs: behind the gate the sudoers rule would allow them (ADR 0009: restart deliberately out)
        'restart frcfld', 'enable frcfld', 'disable frcfld', 'is-active frcfld', 'is-enabled frcfld', 'list', 'daemon-reload',
        // the word count is exact
        '', 'status', 'status frcfld extra', 'metrics frcfld --since @1', 'journal', 'journal frcfld --since', 'journal frcfld --since @1 x',
        // single spaces only, no other separators, nothing before or after
        'status  frcfld', ' status frcfld', 'status frcfld ', 'status\tfrcfld', 'status frcfld\n', 'status frcfld\nstop frcfld', 'status frcfld\r',
        // shell syntax is text, never run
        'status frcfld; id', 'status frcfld && id', 'status frcfld | id', 'status $(id)', 'status `id`', 'status frcfld$IFS', 'status *', 'status ?',
        'status frcfld > /tmp/x', 'status "frcfld"', "status 'frcfld'", 'status \\frcfld',
        // --since: no quoted or space form, no relative times, no other options
        'journal frcfld --since "2026-11-08 00:00"', 'journal frcfld --since 2026-11-08 00:00', 'journal frcfld --since=@1', 'journal frcfld --until @1',
        'journal frcfld --since 1d', 'journal frcfld --since yesterday', 'journal frcfld --since -1h', 'journal frcfld --since @', 'journal frcfld --since @1234567890123',
        'journal frcfld --since 2026-11-08', 'journal frcfld --since 2026-11-08T0:00', 'journal frcfld -n 5', 'journal frcfld --since @1 --since @2',
        // case and other spellings of the verbs
        'STATUS frcfld', 'Status frcfld', 'status-frcfld', 'sudo status frcfld', `${CTL} status frcfld`,
        // what scp, sftp and a remote shell would send
        'scp -t /tmp', 'internal-sftp', '/usr/lib/openssh/sftp-server', 'bash', 'sh -c id',
        // ADR 0011: deploy and deploy-check take exactly rotn-vX.Y.Z (digits only, no suffix), nothing else
        'deploy', 'deploy ', 'deploy rotn-v0.1', 'deploy rotn-v0.1.8-rc.1', 'deploy v0.1.0', 'deploy rotn-v0.1.8 --force',
        'deploy --no-restart rotn-v0.1.8', 'deploy  rotn-v0.1.8', 'deploy rotn-v0.1.8 ', 'deploy ROTN-V0.1.8', 'Deploy rotn-v0.1.8',
        'deploy rotn-v0.1.8;id', 'deploy rotn-v0.1.8\nid', 'deploy rotn-v$(id).1.1', 'deploy rotn-v0.1.*', 'deploy rotn-v0.1.8 frcfld',
        'deploy rotn-v0..8', 'deploy rotn-v.1.8', 'deploy rotn-v0.1.8.9', 'deploy "rotn-v0.1.8"', 'deploy rotn-v0.1.8/../x',
        'deploy-check', 'deploy-check rotn-v0.1', 'deploy-check rotn-v0.1.8-rc.1', 'deploy-check rotn-v0.1.8 x', 'deploycheck rotn-v0.1.8',
        // release takes nothing; there is no rollback or other deploy.sh verb
        'release ', ' release', 'release frcfld', 'release status', 'Release', 'rollback', 'deploy.sh status', `${DEPLOY_SH} status`,
        // reset-state BOT NAME: both words, the bot regex, the profile name ^[A-Za-z0-9_]{1,16}$
        'reset-state', 'reset-state frcfld', 'reset-state frcfld FRCFLD x', 'reset-state FRCFLD FRCFLD', 'reset-state frcfld FRC-FLD',
        'reset-state frcfld FRC.FLD', 'reset-state frcfld ../x', 'reset-state frcfld FRCFLD/', `reset-state frcfld ${'A'.repeat(17)}`,
        'reset-state frcfld  FRCFLD', 'reset-state frcfld FRCFLD\n', 'reset-state frcfld *', 'reset-state frcfld $NAME', 'reset-state frcfld FRCFLDé',
        'status frcfld FRCFLD', 'reset-state  frcfld FRCFLD',
    ];

    test('each refused request: exit 126, sudo never runs, one auth.warning line, and the client never gets its input back', () => {
        for (const cmd of REFUSED) {
            fs.rmSync(sudoLog, { force: true });
            fs.rmSync(loggerLog, { force: true });
            const r = gate(cmd);
            assert.equal(r.code, 126, JSON.stringify(cmd));
            assert.deepEqual(r.sudo, [], JSON.stringify(cmd));
            assert.deepEqual(r.pathSudo, [], JSON.stringify(cmd));
            assert.equal(r.logger.length, 1, JSON.stringify(cmd));
            assert.deepEqual(r.logger[0].slice(0, 5), ['-t', 'rotn-ssh-gate', '-p', 'auth.warning', '--'], JSON.stringify(cmd));
            // The client gets exactly the fixed refusal, never its own input back.
            assert.equal(r.stderr, REFUSAL, JSON.stringify(cmd));
            assert.equal(r.stdout, '');
        }
    });

    test('an interactive login (no SSH_ORIGINAL_COMMAND) is refused and logged as such', () => {
        const r = gate(undefined);
        assert.equal(r.code, 126);
        assert.deepEqual(r.sudo, []);
        assert.equal(refusedLine(r), "refused (no command (an interactive login)): '' (0 bytes)");
    });

    test('the log line is made safe: printable ASCII kept, every other byte "?", the full length in bytes', () => {
        const r = gate('status frcfld\x1b[2J\x07; rm -rf / é');
        assert.equal(r.code, 126);
        const line = refusedLine(r);
        assert.equal(line, `refused (not an allowed request): 'status frcfld?[2J?; rm -rf / ??' (${Buffer.byteLength('status frcfld\x1b[2J\x07; rm -rf / é')} bytes)`);
        assert.ok([...line].every((ch) => ch >= ' ' && ch <= '~'), 'no control or non-ASCII byte reaches syslog');
    });

    test('a long request is refused before matching, and its log line is cut at 200 bytes', () => {
        const long = `status ${'a'.repeat(5000)}`;
        const r = gate(long);
        assert.equal(r.code, 126);
        assert.equal(refusedLine(r), `refused (longer than 128 bytes): '${long.slice(0, 200)}' (${long.length} bytes)`);
        // Just at the limit still goes to the patterns (and is refused there for its 120-char name).
        const at = `status ${'a'.repeat(121)}`;
        assert.equal(at.length, 128);
        assert.match(refusedLine(gate(at)), /^refused \(not an allowed request\)/);
    });

    test('a refusal still exits 126 when the logger is missing or fails', () => {
        const r = gate('restart frcfld', { FAKE_LOGGER_RC: '1' });
        assert.equal(r.code, 126);
        assert.deepEqual(r.sudo, []);
    });
});

describe('mindcraft-rotn-ssh-gate: it trusts nothing in its environment', () => {
    test('a client locale (sshd AcceptEnv LANG, LC_*) cannot widen the patterns; PATH cannot swap sudo', () => {
        for (const loc of ['tr_TR.UTF-8', 'en_US.UTF-8', 'de_DE.UTF-8', 'xx']) {
            const env = { LANG: loc, LC_ALL: loc, LC_CTYPE: loc, LC_COLLATE: loc };
            assert.equal(gate('status FRCFLD', env).code, 126, loc);
            assert.equal(gate('status frcfld', env).code, 0, loc);
        }
        const r = gate('status frcfld');
        assert.deepEqual(r.pathSudo, [], 'the "sudo" first on the caller\'s PATH never runs');
        assert.equal(r.sudo.length, 1);
    });

    test('the source: fixed program paths, LC_ALL=C, PATH reset, bash -p; no eval, no unquoted request, no word splitting of it', () => {
        assert.match(SRC, /^#!\/bin\/bash -p$/m);
        assert.match(SRC, /^readonly SUDO=\/usr\/bin\/sudo$/m);
        assert.match(SRC, /^readonly CTL=\/usr\/local\/sbin\/mindcraft-rotn-ctl$/m);
        assert.match(SRC, /^readonly LOGGER=\/usr\/bin\/logger$/m);
        assert.match(SRC, /^export LC_ALL=C$/m);
        assert.match(SRC, /^PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/m);
        assert.match(SRC, /^set -uf -o pipefail$/m, 'set -f: no globbing anywhere');
        assert.match(SRC, /^exec "\$SUDO" -n "\$CTL" "\$\{args\[@\]\}"$/m);
        const code = SRC.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
        assert.ok(!/\beval\b/.test(code), 'no eval');
        assert.ok(!/\bsource\b|^\s*\.\s/m.test(code), 'nothing sourced');
        assert.ok(!/\$SSH_ORIGINAL_COMMAND(?!")/.test(code.replace(/req=\$SSH_ORIGINAL_COMMAND$/m, '')), 'the request is read once, into req');
        assert.ok(!/\$\{?req\}?(?!")/.test(code.replace(/\$\{#req\}|"\$req"|\[\[ \$req =~|safe "\$req"/g, '')), 'req is never used unquoted');
        assert.ok(!/(^|[^\w])(bash|sh) -c/.test(code), 'no shell -c');
        // deploy.sh's --no-restart flag (ADR 0011) is not a ctl verb.
        assert.ok(!/\brestart\b|\benable\b|\bdisable\b/.test(code.replace(/^readonly .*$/gm, '').replace(/ --no-restart /g, ' ')), 'no other verb in the code');
    });
});

describe('mindcraft-rotn-ssh-gate: ADR 0011 (deploy, deploy-check and release as rotn-build; reset-state BOT NAME)', () => {
    const LIST = ['-n', CTL, 'list'];
    const isEnabled = (b) => ['-n', CTL, 'is-enabled', b];
    const infos = (r) => r.logger.filter((a) => a[3] === 'auth.info').map((a) => a.at(-1));
    const warnings = (r) => r.logger.filter((a) => a[3] === 'auth.warning').map((a) => a.at(-1));

    test('deploy TAG with no bot enabled: every listed bot is asked, then `sudo -n -u rotn-build DEPLOY_SH --no-restart deploy TAG`, and "deploy TAG exit=0" is logged', () => {
        const r = gate('deploy rotn-v0.1.8', { FAKE_LIST: 'frcfld\\nbot-2\\n' });
        assert.equal(r.code, 0, r.stderr);
        assert.deepEqual(r.sudo, [LIST, isEnabled('frcfld'), isEnabled('bot-2'), [...AS_BUILD, '--no-restart', 'deploy', 'rotn-v0.1.8']]);
        assert.deepEqual(infos(r), ['allowed: deploy rotn-v0.1.8', 'deploy rotn-v0.1.8 exit=0']);
        assert.deepEqual(warnings(r), []);
        // No bot at all is fine too; the tag's digits may have any length.
        const none = gate('deploy rotn-v10.20.300');
        assert.equal(none.code, 0);
        assert.deepEqual(none.sudo, [LIST, [...AS_BUILD, '--no-restart', 'deploy', 'rotn-v10.20.300']]);
    });

    test('the deploy result is logged (not exec\'ed) and comes back to the client: exit=N at auth.warning', () => {
        for (const rc of [1, 3, 141]) {
            const r = gate('deploy rotn-v0.1.8', { FAKE_RC: String(rc) });
            assert.equal(r.code, rc);
            assert.deepEqual(infos(r), ['allowed: deploy rotn-v0.1.8']);
            assert.deepEqual(warnings(r), [`deploy rotn-v0.1.8 exit=${rc}`]);
        }
    });

    test('deploy is not run while any bot is enabled, or when that cannot be told: exit 2, logged, deploy.sh never runs (fail closed)', () => {
        const cases = [
            [{ FAKE_LIST: 'frcfld\\n', FAKE_EN_frcfld: 'enabled' }, /bot frcfld is not disabled \(is-enabled: 'enabled'\)/],
            [{ FAKE_LIST: 'frcfld\\nbot-2\\n', FAKE_EN_bot_2: 'enabled' }, /bot bot-2 is not disabled/],
            ...['enabled-runtime', 'static', 'masked', 'linked', 'alias', 'indirect', 'generated', ''].map((st) => [{ FAKE_LIST: 'frcfld\\n', FAKE_EN_frcfld: st }, /bot frcfld is not disabled/]),
            [{ FAKE_LIST: 'frcfld\\n', FAKE_LIST_RC: '2' }, /ctl list failed/],
            [{ FAKE_LIST: 'Frcfld\\n' }, /ctl list printed an unexpected line/],
            [{ FAKE_LIST: 'frcfld x\\n' }, /ctl list printed an unexpected line/],
            [{ FAKE_LIST: '../x\\n' }, /ctl list printed an unexpected line/],
        ];
        for (const [env, re] of cases) {
            const r = gate('deploy rotn-v0.1.8', env);
            assert.equal(r.code, 2, JSON.stringify(env));
            assert.ok(!r.sudo.some((a) => a.includes(DEPLOY_SH)), `deploy.sh never ran: ${JSON.stringify(env)}`);
            assert.match(r.stderr, re, JSON.stringify(env));
            assert.equal(warnings(r).length, 1);
            assert.match(warnings(r)[0], /^deploy rotn-v0\.1\.8 not run: /);
            assert.deepEqual(infos(r), [], 'not logged as allowed');
        }
    });

    test('deploy-check TAG and release run as rotn-build (exec\'ed: their exit code comes back); neither asks the ctl', () => {
        const check = gate('deploy-check rotn-v0.1.8', { FAKE_RC: '1' });
        assert.equal(check.code, 1);
        assert.deepEqual(check.sudo, [[...AS_BUILD, 'check', 'rotn-v0.1.8']]);
        assert.deepEqual(infos(check), ['allowed: deploy-check rotn-v0.1.8']);
        const rel = gate('release');
        assert.equal(rel.code, 0);
        assert.deepEqual(rel.sudo, [[...AS_BUILD, 'status']]);
        assert.deepEqual(infos(rel), ['allowed: release']);
    });

    test('reset-state BOT NAME runs `sudo -n mindcraft-rotn-ctl reset-state BOT NAME`; NAME is ^[A-Za-z0-9_]{1,16}$', () => {
        for (const name of ['FRCFLD', 'a', 'Bot_2', 'A'.repeat(16), '0']) {
            const r = gate(`reset-state frcfld ${name}`);
            assert.equal(r.code, 0, name);
            assert.deepEqual(r.sudo, [['-n', CTL, 'reset-state', 'frcfld', name]], name);
            assert.deepEqual(infos(r), [`allowed: reset-state frcfld ${name}`]);
        }
        assert.equal(gate('reset-state frcfld FRCFLD', { FAKE_RC: '2' }).code, 2, 'the ctl\'s refusal comes back');
    });

    test('a client locale cannot widen the tag or name patterns (non-ASCII digits and letters stay refused)', () => {
        for (const loc of ['tr_TR.UTF-8', 'ar_EG.UTF-8', 'en_US.UTF-8']) {
            const env = { LANG: loc, LC_ALL: loc, LC_CTYPE: loc, LC_COLLATE: loc };
            assert.equal(gate('deploy rotn-v١.٢.٣', env).code, 126, loc);
            assert.equal(gate('reset-state frcfld FRCİFLD', env).code, 126, loc);
            assert.equal(gate('release', env).code, 0, loc);
        }
    });

    test('the source: root\'s deploy.sh as rotn-build through sudo (which resets the environment), no env passing, no other deploy.sh verb', () => {
        assert.match(SRC, /^readonly DEPLOY_SH=\/usr\/local\/lib\/mindcraft-rotn\/deploy\.sh$/m);
        assert.match(SRC, /^readonly BUILD_USER=rotn-build$/m);
        assert.match(SRC, /^readonly DEPLOY_RUN=\("\$SUDO" -n -u "\$BUILD_USER" "\$DEPLOY_SH"\)$/m);
        assert.match(SRC, /^readonly DEPLOY_RE="\^\(deploy\|deploy-check\) \(\$TAG_RE\)\\\$"$/m);
        assert.match(SRC, /^readonly TAG_RE='rotn-v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+'$/m);
        assert.match(SRC, /^readonly RESET_RE="\^reset-state \(\$BOT\) \(\[A-Za-z0-9_\]\{1,16\}\)\\\$"$/m);
        const code = SRC.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
        assert.ok(!/home\/deploy/.test(code), 'never /home/deploy/deploy.sh');
        assert.ok(!/--preserve-env|\s-E\b|env_keep|\/usr\/bin\/env\b/.test(code), 'nothing passes an environment on');
        assert.ok(!/\brollback\b/.test(code), 'no rollback');
        assert.ok(!/\/etc\/mindcraft-rotn/.test(code), 'no request touches the env files');
    });
});
