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
const file = process.env.ROTN_OPENROUTER_USAGE_FILE;
const body = JSON.parse(fs.readFileSync(file, 'utf8'));
body.data.usage = Math.round((body.data.usage + Number(process.env.FAKE_SPEND || 0)) * 1e6) / 1e6;
fs.writeFileSync(file, process.env.FAKE_BREAK_USAGE === id ? '{"data":' : JSON.stringify(body));
process.exit(Number(process.env.FAKE_RUN_EXIT || 0));
