import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';


// A turn from or about a non-giver: flagged by add(), or (for a turn saved without the flag)
// carrying the marker task_queue.js markUntrusted() writes.
export function isUntrustedTurn(turn) {
    return !!turn?.untrusted || (typeof turn?.content === 'string' && /^[^:\n]{1,40}: \[untrusted: /.test(turn.content));
}

// The canned replies src/models/*.js return instead of throwing when a request fails.
const MODEL_FAILURE_REPLIES = new Set([
    'No response received.',
    'My brain disconnected, try again.',
    'No response from Claude.',
    'No response data.',
    'An unexpected error occurred, please try again.',
]);

/** A memory summary worth keeping: non-empty text that is not a model failure reply. */
export function isMemoryReply(reply) {
    return typeof reply === 'string' && reply.trim() !== '' && !MODEL_FAILURE_REPLIES.has(reply.trim());
}

export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        // Only role and content go to the model (the untrusted flag is ours, E3).
        return this.turns.map(({ role, content }) => ({ role, content }));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        // G3 round 5 batch A: a null reply (openrouter: null content) crashed here and the agent
        // restarted 5 times. A null, empty, non-text or failure reply, or a throw, keeps the
        // previous memory.
        let reply;
        try {
            reply = await this.agent.prompter.promptMemSaving(turns);
        } catch (err) {
            console.warn(`[memory] summary failed (${err?.message ?? err}); keeping the previous memory`);
            return;
        }
        if (!isMemoryReply(reply)) {
            const what = typeof reply === 'string' ? (reply.trim() ? `failure reply "${reply.trim()}"` : 'an empty reply') : `a ${reply === null ? 'null' : typeof reply} reply`;
            console.warn(`[memory] summary returned ${what}; keeping the previous memory`);
            return;
        }
        this.memory = reply.trim();

        if (this.memory.length > 500) {
            this.memory = this.memory.slice(0, 500);
            this.memory += '...(Memory truncated to 500 chars. Compress it more next time)';
        }

        console.log("Memory updated to: ", this.memory);
    }

    async appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = `./bots/${this.name}/histories/${string_timestamp}.json`;
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
        }
    }

    /**
     * @param {{untrusted?: boolean}} [opts] untrusted: the turn is a non-giver's words, or the bot's
     *   reply and command results in a conversation with one (E3, #174 review). Such turns stay in
     *   the context marked, but never go into the long-term memory summary.
     */
    async add(name, content, { untrusted = false } = {}) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push(untrusted ? { role, content, untrusted: true } : { role, content });

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            // A non-giver's words must not become a "long-term reminder" in $MEMORY, which every
            // later prompt (self-prompts included) trusts (#174 review 1): they are left out.
            const trusted = chunk.filter(t => !isUntrustedTurn(t));
            if (trusted.length > 0)
                await this.summarizeMemories(trusted);
            await this.appendFullHistory(chunk);
        }
    }

    async save() {
        try {
            const data = {
                memory: this.memory,
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender
            };
            writeFileSync(this.memory_fp, JSON.stringify(data, null, 2));
            console.log('Saved memory to:', this.memory_fp);
        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                return null;
            }
            const data = JSON.parse(readFileSync(this.memory_fp, 'utf8'));
            this.memory = data.memory || '';
            this.turns = data.turns || [];
            console.log('Loaded memory:', this.memory);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            throw error;
        }
    }

    clear() {
        this.turns = [];
        this.memory = '';
    }
}