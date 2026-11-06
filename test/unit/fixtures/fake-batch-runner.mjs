// A stand-in for run.mjs in batch.mjs's tests (test mode only, ROTN_BATCH_RUNNER): records which
// scenario ran, with which maxBatchUsd and whether batch.mjs's ROTN_G3_BATCH marker came along, then
// "spends" FAKE_SPEND US dollars by raising the usage in the fake key-usage file
// (ROTN_OPENROUTER_USAGE_FILE). FAKE_BREAK_USAGE=<scenario id> makes that file unreadable afterwards
// (a failed reading). Exits FAKE_RUN_EXIT (default 0).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const argv = process.argv.slice(2);
const id = argv[argv.indexOf('--scenario') + 1];
const max = argv.find((a) => a.startsWith('maxBatchUsd='));
const marker = /^[0-9A-Za-z-]+:\d+(\.\d+)?$/.test(process.env.ROTN_G3_BATCH ?? '') ? 'batch:set' : 'batch:unset';
fs.appendFileSync(path.join(process.env.FAKE_DIR, 'ran.txt'), `${id} ${max} key:${process.env.OPENROUTER_API_KEY ? 'set' : 'unset'} ${marker}\n`);
// Like run.mjs, a result.json with this run's runId in --out (batch.mjs reads it back into its summary).
const out = argv[argv.indexOf('--out') + 1];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ scenario: id, runId: `fake-${id}-${process.pid}` }));
const file = process.env.ROTN_OPENROUTER_USAGE_FILE;
const body = JSON.parse(fs.readFileSync(file, 'utf8'));
body.data.usage = Math.round((body.data.usage + Number(process.env.FAKE_SPEND || 0)) * 1e6) / 1e6;
fs.writeFileSync(file, process.env.FAKE_BREAK_USAGE === id ? '{"data":' : JSON.stringify(body));
// FAKE_LLM=<scenario id>:<failed>:<ok>: that scenario writes a driver.log in --out with <failed> stand-in
// replies (with their 429 lines) and <ok> real replies, then hangs (for the LLM-failure stop rule).
const [llmId, llmFailed, llmOk] = (process.env.FAKE_LLM ?? '').split(':');
if (llmId === id) {
    const lines = [];
    for (let i = 0; i < Number(llmFailed); i++) {
        lines.push('Awaiting openrouter api response...', 'Error while awaiting response: Error [429] (status 429): 429 Provider returned error',
            'Generated response: My brain disconnected, try again.', 'FRCFLD full response to system: """"');
    }
    for (let i = 0; i < Number(llmOk); i++) lines.push('Awaiting openrouter api response...', 'Generated response: On it!', 'FRCFLD full response to system: ""On it!""');
    fs.writeFileSync(path.join(out, 'driver.log'), lines.join('\n') + '\n');
}
// FAKE_HANG=<scenario id>: that scenario never ends on its own (for the batch's timeout); on SIGTERM it
// exits 143 like run.mjs does.
if (process.env.FAKE_HANG === id || llmId === id) {
    process.on('SIGTERM', () => process.exit(143));
    setInterval(() => {}, 1000);
} else {
    process.exit(Number(process.env.FAKE_RUN_EXIT || 0));
}
