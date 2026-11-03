// The player task queue (skills-rotn E1; PLAN priority stack level 3).
//
// One persistent JSON file per bot, ./bots/<name>/tasks.json next to its
// memory, written atomically (temp file + rename), so the queue survives a
// restart. Only players on the task-giver setting may add tasks (lead decision:
// only_chat_with alone does not grant it). The giver is always the player whose
// message is being handled, never a name the LLM writes.
//
// Chat formats (agreed with harness-ops; the runner parses them from the server
// log as "<bot> ..."):
//   task <id> accepted: <text>
//   task refused: <giver> is not a task giver
//   task <id> cancelled
//   task <id> done            (E3 reports these)
//   task <id> failed: <reason>
//   !taskList: one "task <id> <status> <priority> <giver>" line per open task
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PRIORITIES = ['urgent', 'normal'];
export const STATUSES = ['queued', 'active', 'done', 'failed', 'cancelled'];
const OPEN = new Set(['queued', 'active']);

/** Whether a player may give tasks: on settings.task_givers (case-insensitive). */
export function isTaskGiver(name, settings) {
    if (typeof name !== 'string' || !name) return false;
    const givers = Array.isArray(settings?.task_givers) ? settings.task_givers : [];
    return givers.some(g => typeof g === 'string' && g.toLowerCase() === name.toLowerCase());
}

export class TaskQueue {
    /**
     * @param {string} botName
     * @param {{dir?: string, now?: () => number}} [opts] dir defaults to ./bots/<botName>
     */
    constructor(botName, { dir = `./bots/${botName}`, now = Date.now } = {}) {
        this.botName = botName;
        this.file = path.join(dir, 'tasks.json');
        this.now = now;
        this.tasks = [];
        this.nextId = 1;
        this.load();
    }

    load() {
        if (!existsSync(this.file)) return;
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8'));
            this.tasks = Array.isArray(data.tasks) ? data.tasks : [];
            this.nextId = Number.isInteger(data.nextId) ? data.nextId : this.tasks.length + 1;
        } catch (err) {
            console.warn(`[tasks] Could not read ${this.file} (${err.message}); starting with an empty queue.`);
            this.tasks = [];
            return;
        }
        // A task that was active when the process stopped is interrupted: queue it again.
        let requeued = false;
        for (const t of this.tasks) {
            if (t.status === 'active') {
                t.status = 'queued';
                t.updated_at = this.now();
                requeued = true;
            }
        }
        if (requeued) this.save();
    }

    save() {
        mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: 1, nextId: this.nextId, tasks: this.tasks }, null, 2));
        renameSync(tmp, this.file);
    }

    /** Add a task; the caller has already checked the giver. */
    add({ text, priority = 'normal', giver, assignee = this.botName }) {
        const t = {
            id: `t${this.nextId++}`,
            text: String(text).trim(),
            priority: PRIORITIES.includes(priority) ? priority : 'normal',
            giver,
            assignee,
            status: 'queued',
            result: null,
            created_at: this.now(),
            updated_at: this.now(),
        };
        this.tasks.push(t);
        this.save();
        return t;
    }

    get(id) {
        return this.tasks.find(t => t.id === id) ?? null;
    }

    /** Open tasks (queued or active), in the order they will run. */
    open() {
        return this.tasks.filter(t => OPEN.has(t.status)).sort(byRunOrder);
    }

    /** The next task to run: urgent before normal, then oldest first. */
    next() {
        return this.tasks.filter(t => t.status === 'queued').sort(byRunOrder)[0] ?? null;
    }

    setStatus(id, status, result = null) {
        const t = this.get(id);
        if (!t) return null;
        t.status = status;
        if (result !== null) t.result = result;
        t.updated_at = this.now();
        this.save();
        return t;
    }

    start(id) { return this.setStatus(id, 'active'); }
    done(id, result = 'done') { return this.setStatus(id, 'done', result); }
    fail(id, reason) { return this.setStatus(id, 'failed', reason); }
    cancel(id) { return this.setStatus(id, 'cancelled', 'cancelled'); }
}

function byRunOrder(a, b) {
    const pa = a.priority === 'urgent' ? 0 : 1;
    const pb = b.priority === 'urgent' ? 0 : 1;
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1; // the running task first
    return pa - pb || a.created_at - b.created_at || Number(a.id.slice(1)) - Number(b.id.slice(1));
}

/** "task t3 queued urgent JQDAW" */
export const formatTaskLine = (t) => `task ${t.id} ${t.status} ${t.priority} ${t.giver}`;

// Command handlers (pure; the agent passes its queue, the sender and the settings).

/** !taskAdd: the giver is the player whose message is being handled (null for the bot itself). */
export function addTask(queue, { giver, text, priority }, settings) {
    if (!giver) return 'task refused: tasks come from players, not from the bot itself';
    if (!isTaskGiver(giver, settings)) return `task refused: ${giver} is not a task giver`;
    if (typeof text !== 'string' || !text.trim()) return 'task refused: the task has no text';
    const p = String(priority ?? 'normal').trim().toLowerCase() || 'normal';
    if (!PRIORITIES.includes(p)) return `task refused: priority must be urgent or normal, not ${priority}`;
    const t = queue.add({ text, priority: p, giver });
    return `task ${t.id} accepted: ${t.text}`;
}

/** !taskList: one line per open task, running task first. */
export function listTasks(queue) {
    const open = queue.open();
    return open.length ? open.map(formatTaskLine).join('\n') : 'no open tasks';
}

/** !taskCancel: any task giver may cancel an open task. */
export function cancelTask(queue, { by, id }, settings) {
    if (!by || !isTaskGiver(by, settings)) return `task refused: ${by || 'the bot'} is not a task giver`;
    const t = queue.get(String(id ?? '').trim());
    if (!t || !OPEN.has(t.status)) return `task ${id} is not an open task`;
    queue.cancel(t.id);
    return `task ${t.id} cancelled`;
}
