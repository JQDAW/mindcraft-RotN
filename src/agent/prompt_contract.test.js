// Round 17 P (Fable verdict 4, section 5.6; the lead's decisions 3 and 4 and the addenda): what the model reads must
// only offer what it can do. Under the committed settings and profiles/rotn-bot.json: no !newAction, no blocked or
// hidden command in the COMMAND DOCS; the RotN examples use only commands in the docs; every command a model-facing
// text names (the escape, the agenda, the skills, the night routine...) exists and is in the docs. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import * as espree from 'espree';
import settings from './settings.js';
import { Vec3 } from 'vec3';
import committed from '../../settings.js';

const profile = JSON.parse(readFileSync(new URL('../../profiles/rotn-bot.json', import.meta.url), 'utf8'));

async function commands() {
    await import('./agent.js'); // the real import order (commands/index.js first)
    return import('./commands/index.js');
}
const agentWith = (extra = {}) => ({ blocked_actions: committed.blocked_actions, prompter: { profile }, ...extra });
const docNames = (docs) => new Set([...docs.matchAll(/^(![A-Za-z]+): /gm)].map(m => m[1]));

test('round 17 P: the committed blocked commands leave commandList too (#636 nit: upstream\'s delete removed nothing)', async () => {
    const { blacklistCommands, listCommands, getCommand } = await commands();
    assert.ok(committed.blocked_actions.includes('!attackPlayer'), 'the lead\'s #636: !attackPlayer blocked');
    blacklistCommands(committed.blocked_actions);
    for (const name of committed.blocked_actions) {
        assert.equal(listCommands().some(c => c.name === name), false, `${name} gone from commandList`);
        assert.equal(getCommand(name), undefined);
    }
});

test('round 17 P: the COMMAND DOCS under the committed settings and the RotN profile: no !newAction, no blocked or hidden command; !taskDone/!taskFailed only while a player task runs', async () => {
    const { blacklistCommands, getCommandDocs } = await commands();
    blacklistCommands(committed.blocked_actions);
    const docs = getCommandDocs(agentWith());
    const names = docNames(docs);
    assert.equal(committed.allow_insecure_coding, false);
    assert.ok(!names.has('!newAction'));
    for (const n of [...committed.blocked_actions, ...profile.docs_hidden]) assert.ok(!names.has(n), `${n} not in the docs`);
    assert.deepEqual(profile.docs_hidden.slice().sort(), ['!clearChat', '!endConversation', '!endGoal', '!goal', '!help', '!lookAtPlayer', '!lookAtPosition', '!restart', '!setMode', '!showVillagerTrades', '!startConversation', '!taskDone', '!taskFailed', '!tradeWithVillager'], 'the lead\'s decision 3');
    for (const n of ['!collectBlocks', '!craftRecipe', '!goToSurface', '!note', '!goToBed', '!followPlayer', '!givePlayer', '!getCraftingPlan']) assert.ok(names.has(n), `${n} kept`);
    // A player task runs: its goal tells the model to use !taskDone / !taskFailed (priority.js), so they are shown.
    const withTask = docNames(getCommandDocs(agentWith({ tasks: { current: () => ({ id: 't1' }) } })));
    assert.ok(withTask.has('!taskDone') && withTask.has('!taskFailed'));
    // Smaller than the docs without the hidden list (the lead's decision 3: about 2k chars).
    const full = getCommandDocs({ blocked_actions: committed.blocked_actions, prompter: { profile: { memory: 'code' } } });
    assert.ok(full.length - docs.length >= 1500, `${full.length} -> ${docs.length}`);
});

test('round 17 P: the RotN examples: few and short, no !newAction, every command in them is in the docs, never a bull, a sheep only as safe', async () => {
    const { blacklistCommands, getCommandDocs } = await commands();
    blacklistCommands(committed.blocked_actions);
    const names = docNames(getCommandDocs(agentWith()));
    const ex = profile.conversation_examples;
    assert.ok(Array.isArray(ex) && ex.length >= 8 && ex.length <= 12, `${ex.length} examples`);
    const text = JSON.stringify(ex);
    assert.ok(text.length < 5000, `${text.length} chars (upstream's 29: 9,288)`);
    assert.ok(!/newAction/.test(text));
    assert.ok(!/\bbull/i.test(text), 'the herd rule is same-breed cows (the lead\'s correction): no bull in any example');
    for (const turns of ex) for (const t of turns) {
        assert.ok(['user', 'assistant', 'system'].includes(t.role));
        if (t.role !== 'assistant') continue;
        for (const m of t.content.matchAll(/!([a-zA-Z]+)/g)) assert.ok(names.has(`!${m[1]}`), `!${m[1]} in "${t.content}"`);
    }
});

// The model-facing texts: string literals in src/agent, parsed with espree (ESLint's parser), so negations and regex
// literals are not read as text. The command definitions (commands/: their own docs) are left out; elsewhere only these
// exact strings may name a command the docs do not offer (#645 review 5: per string, not per file).
const ALLOWED = [
    { file: 'agent.js', text: '!newAction' }, // a task giver's typed !newAction (refused at run time), not a text to the model
    { file: 'coder.js', text: '!newAction' }, // the coder: only with allow_insecure_coding
    { file: 'conversation.js', text: '!endConversation' }, // bot-to-bot messages, not the model's prompt
    { file: 'conversation.js', text: /^I'm talking to someone else, try again later\. !endConversation\("$/ },
    { file: 'conversation.js', text: '!endConversation("' },
    { file: 'self_prompter.js', text: /with this syntax: !commandName\. Respond:$/ }, // a syntax placeholder
    { file: 'tasks/tasks.js', text: /^!(endGoal|endConversation|goal\("|startConversation\(")$/ }, // upstream's benchmark tasks
];
const allowed = (file, text) => ALLOWED.some(a => a.file === file && (typeof a.text === 'string' ? a.text === text : a.text.test(text)));
function namedCommands() {
    const root = new URL('.', import.meta.url).pathname;
    const files = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !p.endsWith('.test.js')) files.push(p); } };
    walk(root);
    const found = new Map();
    for (const f of files) {
        const rel = relative(root, f);
        if (rel.startsWith('commands/')) continue;
        const ast = espree.parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
        const texts = [];
        const visit = (n) => {
            if (!n || typeof n.type !== 'string') return;
            if (n.type === 'Literal' && typeof n.value === 'string') texts.push(n.value);
            if (n.type === 'TemplateElement') texts.push(n.value.cooked ?? n.value.raw);
            for (const k of Object.keys(n)) {
                const v = n[k];
                if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
            }
        };
        visit(ast);
        for (const s of texts) {
            if (allowed(rel, s)) continue;
            for (const m of s.matchAll(/(?:^|[\s("'`])!([a-z][A-Za-z]{2,})\b/g)) {
                const k = `!${m[1]}`;
                if (!found.has(k)) found.set(k, new Set());
                found.get(k).add(rel);
            }
        }
    }
    return found;
}

test('round 17 P: every command a model-facing text names exists and is in the docs (the lead: the trapped bot is pointed only at real commands)', async () => {
    const { getCommandDocs, getCommand, blacklistCommands } = await commands();
    blacklistCommands(committed.blocked_actions);
    const docs = docNames(getCommandDocs(agentWith({ tasks: { current: () => ({ id: 't1' }) } })));
    const bad = [];
    const named = namedCommands();
    assert.ok(named.has('!goToSurface') && named.has('!craftRecipe'), 'the scan reads the texts');
    for (const [name, files] of named) {
        const cmd = getCommand(name);
        if (!cmd) bad.push(`${name} is no command (${[...files].join(', ')})`);
        else if (!docs.has(name) && !cmd.forcedOnly) bad.push(`${name} is not in the docs (${[...files].join(', ')})`);
    }
    assert.deepEqual(bad, []);
});

const SCROLL = { name: 'lifescroll:spawnscroll', count: 1, metadata: 0 };
const botWith = (items) => ({ entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => items, slots: [], selectedItem: null }, output: '' });

test('round 17 P (rotn-data, the lead\'s addendum): !goToBed and !useOn on a bed refuse once the Scroll of New Life is used (this session, saved, or none held); run otherwise', async (t) => {
    t.mock.method(console, 'log', () => {});
    await commands();
    const { actionsList, scrollUsed } = await import('./commands/actions.js');
    const bed = actionsList.find(a => a.name === '!goToBed').perform;
    const useOn = actionsList.find(a => a.name === '!useOn').perform;
    const ran = [];
    const agent = (extra, items = [SCROLL]) => ({ bot: botWith(items), actions: { runAction: (label) => { ran.push(label); return Promise.resolve({ message: 'ok' }); } }, ...extra });
    assert.match(await bed(agent({ _night: { respawnSet: { pos: new Vec3(3, 64, -2), at: 1 } } })), /^Not using a bed: the Scroll of New Life is used \(your respawn point is at 3, 64, -2\), and sleeping in a bed would end its respawn point for good/);
    assert.match(await bed(agent({ history: { scrollUsed: { pos: { x: 1, y: 70, z: 1 }, at: 2 } } })), /respawn point is at 1, 70, 1/);
    // #645 review 1: a fresh start on the CX23 (load_memory false: no saved record read) with no scroll held: used.
    assert.match(await bed(agent({}, [])), /^Not using a bed: the Scroll of New Life is used \(no Scroll of New Life held\)/);
    assert.match(await useOn(agent({}, []), 'hand', 'bed'), /^Not using a bed/);
    assert.match(await useOn(agent({}, []), 'hand', 'quark:white_bed') ?? '', /^Not using a bed/);
    assert.deepEqual(ran, [], 'no walk to a bed, no right-click');
    // The scroll still held and no record: a bed is fine.
    assert.equal(scrollUsed(agent({})), null);
    await bed(agent({}));
    await useOn(agent({}), 'hand', 'bed');
    assert.deepEqual(ran, ['action:goToBed', 'action:useOn']);
});

test('#645 review 6: skills.goToBed itself refuses (npc/controller.js calls it directly)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const skills = await import('./library/skills.js');
    const bot = { ...botWith([]), findBlocks: () => { throw new Error('no search for a bed'); } };
    assert.equal(await skills.goToBed(bot), false);
    assert.match(bot.output, /Not using a bed: the Scroll of New Life is used/);
    const marked = { ...botWith([SCROLL]), rotnScrollUsed: { pos: { x: 5, y: 60, z: 5 }, at: 1 }, findBlocks: () => { throw new Error('no search'); } };
    assert.equal(await skills.goToBed(marked), false);
    assert.match(marked.output, /respawn point is at 5, 60, 5/);
});

test('round 17 P: the scroll\'s use is saved with the history in both memory modes, the night routine records it, and a save never writes null over it (#645 review 1: load_memory false)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const before = { ...settings };
    t.after(() => { for (const k of Object.keys(settings)) delete settings[k]; Object.assign(settings, before); });
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'scroll-'));
    t.after(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
    process.chdir(dir);
    const { History } = await import('./history.js');
    const { rememberScroll } = await import('./night_routine.js');
    const settle = () => new Promise(r => setTimeout(r, 20));
    for (const memory of ['code', 'summary']) {
        const agent = { name: `S${memory}`, bot: {}, prompter: { profile: { memory } }, self_prompter: { state: 0, isStopped: () => true, prompt: '' }, task: { taskStartTime: 0 } };
        agent.history = new History(agent);
        const n = {};
        rememberScroll(agent, n, new Vec3(4.5, 66, -7.2));
        await settle();
        assert.deepEqual(n.respawnSet.pos, new Vec3(4.5, 66, -7.2));
        assert.deepEqual(agent.bot.rotnScrollUsed.pos, { x: 4, y: 66, z: -8 });
        const h2 = new History(agent);
        h2.load();
        assert.deepEqual(h2.scrollUsed.pos, { x: 4, y: 66, z: -8 }, memory);
        // A restart that never loads memory.json (load_memory false): its first save keeps the record.
        const fresh = new History(agent);
        assert.equal(fresh.scrollUsed, null);
        await fresh.save();
        const h3 = new History(agent);
        h3.load();
        assert.deepEqual(h3.scrollUsed?.pos, { x: 4, y: 66, z: -8 }, `${memory}: not overwritten with null`);
    }
});
