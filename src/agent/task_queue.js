// The player task queue (skills-rotn E1; PLAN priority stack level 3).
//
// One persistent JSON file per bot, ./bots/<name>/tasks.json next to its
// memory, written atomically (temp file + rename), so the queue survives a
// restart. Only task givers may add tasks (lead decision: only_chat_with alone
// does not grant it), and only by typing !taskAdd themselves: the giver is the
// sender of that typed command, passed with the call; the LLM cannot add tasks
// (#146 review). A corrupt file is moved aside and reported, not wiped.
// Preempting the agenda and resuming it come with E2/E3; E3 must treat a task's
// text as untrusted data when it goes into a prompt.
//
// Chat formats (agreed with harness-ops; the runner parses them from the server
// log as "<bot> ..."):
//   task <id> accepted: <text>
//   task refused: <giver> is not a task giver
//   task refused: a task giver must type !taskAdd themselves
//   task <id> cancelled
//   task <id> done            (E3 reports these)
//   task <id> failed: <reason>
//   !taskList: one "task <id> <status> <priority> <giver>" line per open task
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PRIORITIES = ['urgent', 'normal'];
export const STATUSES = ['queued', 'active', 'done', 'failed', 'cancelled'];
const OPEN = new Set(['queued', 'active']);

/**
 * Whether a sender may give tasks and type commands (lead decision on Request 11).
 * - A player: on settings.task_givers (case-insensitive).
 * - "Server", the console's whisper sender, which the G3 runner uses: only when the test-only
 *   setting allow_server_task_giver is true (off by default, never in a committed profile)
 *   AND the message really came from the console (fromConsole: no online player of that name),
 *   so a player account named "Server" gets nothing (#146 review).
 */
export function isTaskGiver(name, settings, { fromConsole = false } = {}) {
    if (typeof name !== 'string' || !name) return false;
    if (name.toLowerCase() === 'server') return settings?.allow_server_task_giver === true && fromConsole === true;
    const givers = Array.isArray(settings?.task_givers) ? settings.task_givers : [];
    return givers.some(g => typeof g === 'string' && g.toLowerCase() === name.toLowerCase());
}

// A stored task is used only if it is well formed (#146 review: one without an id broke sorting).
function validTask(t) {
    return t && typeof t === 'object' && typeof t.id === 'string' && /^t\d+$/.test(t.id)
        && typeof t.text === 'string' && typeof t.giver === 'string'
        && PRIORITIES.includes(t.priority) && STATUSES.includes(t.status)
        && Number.isFinite(t.created_at);
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
        this.loadProblem = null; // a sentence for the bot to report, or null
        if (!existsSync(this.file)) return;
        let data;
        try {
            data = JSON.parse(readFileSync(this.file, 'utf8'));
            if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error('no task list');
        } catch (err) {
            // Keep the bad file for a human to look at, and say so (#146 review).
            const aside = `${this.file}.corrupt-${this.now()}`;
            try { renameSync(this.file, aside); } catch { /* left in place; the next save overwrites it */ }
            this.loadProblem = `[tasks] ${this.file} could not be read (${err.message}); moved it to ${aside} and started an empty queue. Its tasks are lost unless restored.`;
            console.warn(this.loadProblem);
            this.tasks = [];
            return;
        }
        this.tasks = data.tasks.filter(validTask);
        const dropped = data.tasks.length - this.tasks.length;
        if (dropped > 0) {
            this.loadProblem = `[tasks] ${dropped} malformed task entr${dropped === 1 ? 'y' : 'ies'} in ${this.file} ignored.`;
            console.warn(this.loadProblem);
        }
        const highest = this.tasks.reduce((n, t) => Math.max(n, Number(t.id.slice(1))), 0);
        this.nextId = Math.max(Number.isInteger(data.nextId) ? data.nextId : 1, highest + 1);
        // A task that was active when the process stopped is interrupted: queue it again.
        let requeued = false;
        for (const t of this.tasks) {
            if (t.status === 'active') {
                t.status = 'queued';
                t.updated_at = this.now();
                requeued = true;
            }
        }
        if (requeued) {
            // A save failure here must not stop the agent from starting (#146 review).
            try { this.save(); } catch (err) { console.warn(`[tasks] Could not save ${this.file} after re-queueing (${err.message}).`); }
        }
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

/**
 * !taskAdd. giver is the sender of the typed command (the forced path); null when the LLM issued
 * it, which is always refused (#146 review). isGiver(name) checks the sender.
 */
export function addTask(queue, { giver, text, priority }, isGiver) {
    if (!giver) return 'task refused: a task giver must type !taskAdd themselves';
    if (!isGiver(giver)) return `task refused: ${giver} is not a task giver`;
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

/** !taskCancel: any task giver may cancel an open task, by typing the command. */
export function cancelTask(queue, { by, id }, isGiver) {
    if (!by) return 'task refused: a task giver must type !taskCancel themselves';
    if (!isGiver(by)) return `task refused: ${by} is not a task giver`;
    const t = queue.get(String(id ?? '').trim());
    if (!t || !OPEN.has(t.status)) return `task ${id} is not an open task`;
    queue.cancel(t.id);
    return `task ${t.id} cancelled`;
}
