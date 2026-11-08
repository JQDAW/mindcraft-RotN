// G4 #10: the "[state] <name> at start: ..." journal line (state_report.js), read by harness-ops'
// fresh_bot_state check on S. Real TaskQueue and Agenda on temporary files; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { TaskQueue } from './task_queue.js';
import { Agenda } from './agenda.js';
import { startStateLine } from './state_report.js';

const LINE_RE = /^\[state\] (\S+) at start: tasks=(absent|corrupt|\d+) agenda=(absent|corrupt|all-done|[\w:.-]+) memory=(absent|corrupt|\d+)$/;
const fresh = () => mkdtempSync(path.join(tmpdir(), 'state-report-'));
const quiet = (t) => t.mock.method(console, 'warn', () => {});
const line = (dir) => startStateLine('FRCFLD', {
    tasks: new TaskQueue('FRCFLD', { dir }), agenda: new Agenda('FRCFLD', { dir }), memoryFile: path.join(dir, 'memory.json'),
});

test('G4 #10: a fresh bot (no state files): every value is absent', () => {
    const dir = fresh();
    const text = line(dir);
    assert.equal(text, '[state] FRCFLD at start: tasks=absent agenda=absent memory=absent');
    assert.match(text, LINE_RE);
    assert.ok(!existsSync(path.join(dir, 'tasks.json')) && !existsSync(path.join(dir, 'agenda.json')), 'loading wrote no file');
});

test('G4 #10: with state files: the task count, the step the agenda is on, the memory\'s turn count; never their content', () => {
    const dir = fresh();
    const q = new TaskQueue('FRCFLD', { dir });
    q.add({ text: 'secret plan: bring me 64 diamonds', giver: 'JQDAW' });
    q.add({ text: 'another', giver: 'JQDAW' });
    const a = new Agenda('FRCFLD', { dir });
    a.start();
    a.done_at = { [a.steps[0].id]: 1, [a.steps[1].id]: 2 };
    a.save();
    writeFileSync(path.join(dir, 'memory.json'), JSON.stringify({ memory: 'the memory summary text', turns: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'system', content: 'x' }] }));
    const text = line(dir);
    assert.equal(text, `[state] FRCFLD at start: tasks=2 agenda=${a.steps[2].id} memory=3`);
    assert.match(text, LINE_RE);
    for (const secret of ['secret', 'diamonds', 'JQDAW', 'summary', 'hi']) assert.ok(!text.includes(secret), `no "${secret}" in ${text}`);
    // All steps done; an empty task list and a memory with no turns are present, with 0.
    const done = fresh();
    writeFileSync(path.join(done, 'tasks.json'), JSON.stringify({ version: 1, nextId: 1, tasks: [] }));
    const all = new Agenda('FRCFLD', { dir: done });
    all.done_at = Object.fromEntries(all.steps.map((s, i) => [s.id, i + 1]));
    all.save();
    writeFileSync(path.join(done, 'memory.json'), JSON.stringify({ memory: '' }));
    assert.equal(line(done), '[state] FRCFLD at start: tasks=0 agenda=all-done memory=0');
});

test('G4 #10: unreadable state files are "corrupt" (tasks and agenda are moved aside by their loaders)', (t) => {
    quiet(t);
    const dir = fresh();
    for (const f of ['tasks.json', 'agenda.json', 'memory.json']) writeFileSync(path.join(dir, f), '{not json');
    const text = line(dir);
    assert.equal(text, '[state] FRCFLD at start: tasks=corrupt agenda=corrupt memory=corrupt');
    assert.match(text, LINE_RE);
});

test('G4 #10: the agent prints the line once at start, after loading tasks and agenda and before the first await that can reach an LLM', () => {
    const src = readFileSync(new URL('./agent.js', import.meta.url), 'utf8');
    const at = (s) => { const i = src.indexOf(s); assert.ok(i >= 0, `agent.js has ${s}`); return i; };
    const call = at('console.log(startStateLine(this.name');
    assert.equal(src.split('startStateLine(this.name').length - 1, 1, 'printed in one place');
    assert.ok(at('this.tasks = new TaskQueue(') < call && at('this.agenda = new Agenda(') < call, 'after the loads');
    assert.ok(call < at('await this.prompter.initExamples()'), 'before the examples (their embeddings may call a model)');
    assert.ok(call < at('this.history.load()') && call < at('this.self_prompter.handleLoad('), 'before memory and the self-prompter');
});
