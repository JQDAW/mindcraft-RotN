// Fake ssh/scp for offline tests of deploy/test-server.sh.
// argv[2] is "ssh" or "scp"; the rest are the real arguments. Calls are logged to $FAKE_SSH_LOG.
// For ssh, the remote command is everything after the "root@<ip>" argument. `rotn-test phase`
// returns the next entry of $FAKE_SSH_PHASES (comma-separated; the last one repeats). The current
// position is kept in $FAKE_SSH_LOG.pos.
import fs from 'node:fs';
import process from 'node:process';

const [tool, ...args] = process.argv.slice(2);
const logPath = process.env.FAKE_SSH_LOG;
fs.appendFileSync(logPath, JSON.stringify([tool, ...args]) + '\n');

if (tool === 'scp') process.exit(Number(process.env.FAKE_SCP_EXIT || 0));

const hostIdx = args.findIndex((a) => /^root@/.test(a));
const remote = args.slice(hostIdx + 1).join(' ');

if (/rotn-test phase/.test(remote)) {
    const phases = (process.env.FAKE_SSH_PHASES || 'ready').split(',');
    const posPath = logPath + '.pos';
    const pos = fs.existsSync(posPath) ? Number(fs.readFileSync(posPath, 'utf8')) : 0;
    fs.writeFileSync(posPath, String(pos + 1));
    process.stdout.write(phases[Math.min(pos, phases.length - 1)] + '\n');
} else if (/rotn-test verify/.test(remote)) {
    process.stdout.write('phase=ready\njava_version=openjdk version "1.8.0_504"\nonline_mode=true\n');
} else if (/rotn-test console/.test(remote)) {
    process.stdout.write('[Server thread/INFO]: fake console output\n');
} else if (/rotn-test build-log/.test(remote)) {
    process.stdout.write('fake build log\n');
}
process.exit(0);
