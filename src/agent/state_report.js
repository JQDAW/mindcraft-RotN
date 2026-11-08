// G4 #10 (test/scenarios/g4/PLAN.md, D on the CX23 service): harness-ops' fresh_bot_state check
// reads which state files a bot had when it started. One journal line per agent start, written
// after tasks.json and agenda.json are loaded and before anything can call an LLM:
//
//   [state] <name> at start: tasks=<tasks> agenda=<agenda> memory=<memory>
//
//   tasks:  absent | corrupt | <n>        n: the task entries kept from tasks.json (any status)
//   agenda: absent | corrupt | <step id> | all-done
//                                         the first step agenda.json does not record as done
//   memory: absent | corrupt | <n>        n: the saved turns in memory.json
//
// Counts and step ids only: never a task's text, a giver's name or the memory summary.

import { existsSync, readFileSync } from 'fs';

const token = (s) => String(s).replace(/[^\w:.-]/g, '_') || 'unknown';

/** tasks= for a TaskQueue (its loadState is set by load()). */
export function tasksValue(queue) {
    if (queue?.loadState === 'corrupt') return 'corrupt';
    if (queue?.loadState !== 'present') return 'absent';
    return String(queue.tasks.length);
}

/** agenda= for an Agenda (its loadState is set by load()): the step it is on, by its done steps. */
export function agendaValue(agenda) {
    if (agenda?.loadState === 'corrupt') return 'corrupt';
    if (agenda?.loadState !== 'present') return 'absent';
    const next = agenda.steps.find(s => !agenda.done_at?.[s.id]);
    return next ? token(next.id) : 'all-done';
}

/** memory= for the memory file, read here (History loads it later, after the examples). */
export function memoryValue(file) {
    if (!existsSync(file)) return 'absent';
    try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        return String(Array.isArray(data?.turns) ? data.turns.length : 0);
    } catch {
        return 'corrupt';
    }
}

export function startStateLine(name, { tasks, agenda, memoryFile }) {
    return `[state] ${token(name)} at start: tasks=${tasksValue(tasks)} agenda=${agendaValue(agenda)} memory=${memoryValue(memoryFile)}`;
}
