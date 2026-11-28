import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';
import { buildMemory, emptyFacts, MEMORY_FACTS, MEMORY_MODES, memoryMode, recordDecision } from './memory_facts.js';


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

/** Soak 13 (C2): the turns one summary takes: max_messages - 5 (5 stay in context), at least 5 (upstream's chunk). */
export const SUMMARY_KEEP = 5;
export function summaryChunkSize(maxMessages) {
    return Number.isFinite(maxMessages) ? Math.max(5, maxMessages - SUMMARY_KEEP) : 5;
}

/**
 * Round 17 M: the profile's "memory" key. "code" (profiles/rotn-bot.json): $MEMORY is built from the game state
 * (memory_facts.js) plus the bot's notes, and the summary model runs only for a chunk with a task giver's words, its
 * reply being the notes. "summary" (or none: upstream's profiles): today's model summary every chunk. The switch is
 * the way back if soak 17 shows worse play (the human's approval is conditional).
 */
export { MEMORY_MODES, memoryMode };

/** Round 17 M (#637 review 4): how the old notes open the turns a code-mode summary call reads. */
export const OLD_NOTES_PREFIX = 'Your old notes: ';

/**
 * Round 17 M: a chunk the summary model reads in code mode: one with a user turn not marked untrusted (#637 review 6:
 * a player's words that are not an [untrusted: ...] line; another bot's words count too, though this pack runs one).
 * Self-prompts, agenda nudges and command results are system turns, the bot's own are assistant turns: never.
 */
export function hasPlayerTurn(turns) {
    return turns.some(t => t?.role === 'user' && !isUntrustedTurn(t));
}

/**
 * #645 review 1: the scroll's use saved before (memory.json), so a save never writes null over it: on the CX23
 * load_memory is false, so a History after a restart starts with scrollUsed null without reading the file.
 */
function savedScrollUsed(fp) {
    try {
        if (!existsSync(fp)) return null;
        const v = JSON.parse(readFileSync(fp, 'utf8'))?.scrollUsed;
        return v && typeof v === 'object' ? v : null;
    } catch { return null; }
}

export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory ("summary" mode); in "code"
        // mode (round 17 M) the memory is built from the game state, and only the notes are kept here.
        this._summary = '';
        this.notes = '';
        this.facts = emptyFacts();
        this._factsLogged = null;
        // Round 17 P: the Scroll of New Life's use ({pos, at}), kept across restarts in both memory modes: a bed must
        // never end it (!goToBed refuses).
        this.scrollUsed = null;

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        // Soak 13 (C2, the lead): 5 (upstream) with max_messages 15 summarized every 5 turns (one summary
        // every 2 to 3 commands, 69 in 2 h, 26% of the calls). Now max_messages - 5 (10 at 15): a summary every
        // 10 turns, and 5 turns stay in context after it. At least 5.
        this.summary_chunk_size = summaryChunkSize(this.max_messages);
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    get memoryMode() { return memoryMode(this.agent); }

    /**
     * $MEMORY. "summary": the model's summary, as upstream. "code": the facts from the game state now plus the notes,
     * for every prompt (#637 review 4: the summary prompt gets its old notes as its first turn, not through $MEMORY).
     */
    get memory() {
        if (this.memoryMode !== 'code') return this._summary;
        let text;
        try { text = buildMemory(this.agent, { facts: this.facts, notes: this.notes }); } catch (err) {
            console.warn(`[memory] facts could not be built (${err?.message ?? err}); the notes alone`);
            return this.notes;
        }
        // One line when the text changes, for the evidence (round 17 M check 1): the facts as the model saw them.
        if (text !== this._factsLogged) {
            this._factsLogged = text;
            console.log(`[memory] facts ${text.length} chars: ${text.replace(/\n/g, ' / ')}`);
        }
        return text;
    }

    set memory(value) {
        if (this.memoryMode === 'code') this.notes = typeof value === 'string' ? value : '';
        else this._summary = value;
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
        // Code mode (#637 review 4): the old notes go in as the first turn of what is summarized, so $MEMORY stays the
        // facts and notes for every other prompt while this call is out.
        const input = this.memoryMode === 'code' ? [{ role: 'system', content: `${OLD_NOTES_PREFIX}'${this.notes}'` }, ...turns] : turns;
        try {
            reply = await this.agent.prompter.promptMemSaving(input);
        } catch (err) {
            console.warn(`[memory] summary failed (${err?.message ?? err}); keeping the previous memory`);
            return;
        }
        if (!isMemoryReply(reply)) {
            const what = typeof reply === 'string' ? (reply.trim() ? `failure reply "${reply.trim()}"` : 'an empty reply') : `a ${reply === null ? 'null' : typeof reply} reply`;
            console.warn(`[memory] summary returned ${what}; keeping the previous memory`);
            return;
        }
        if (this.memoryMode === 'code') {
            // Round 17 M: the reply is the notes, at most MEMORY_FACTS.notesMax chars.
            let notes = reply.trim().replace(/\s+/g, ' ');
            if (notes.length > MEMORY_FACTS.notesMax) notes = notes.slice(0, MEMORY_FACTS.notesMax - 3) + '...';
            this.notes = notes;
            console.log("Memory updated to: ", this.notes);
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
        // Soak 18 B: the bot's own "X can wait" decisions, for the facts (memory_facts.recordDecision).
        // #680 review 5: never from an untrusted turn.
        if (role === 'assistant' && !untrusted) { try { recordDecision(this.facts, content); } catch { /* no decision */ } }

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            // A non-giver's words must not become a "long-term reminder" in $MEMORY, which every
            // later prompt (self-prompts included) trusts (#174 review 1): they are left out.
            const trusted = chunk.filter(t => !isUntrustedTurn(t));
            // Round 17 M: in code mode the facts need no summary; only a task giver's words are worth the call.
            if (trusted.length > 0 && this.memoryMode === 'code' && !hasPlayerTurn(trusted)) {
                console.log(`[memory] summary skipped (no player turn) turns ${trusted.length} kept ${this.turns.length}`);
            } else if (trusted.length > 0) {
                // Soak 13 (C2, the lead): one marker per summary call, numbers only, for the harness's count.
                console.log(`[memory] summary turns ${trusted.length} kept ${this.turns.length}`);
                await this.summarizeMemories(trusted);
            }
            await this.appendFullHistory(chunk);
        }
    }

    async save() {
        try {
            const code = this.memoryMode === 'code';
            const data = {
                // Code mode keeps the notes and the fact records; the summary mode its summary.
                memory: code ? '' : this.memory,
                ...(code ? { notes: this.notes, facts: this.facts } : {}),
                scrollUsed: this.scrollUsed ?? savedScrollUsed(this.memory_fp),
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
            // A memory.json from before round 5 A may hold a failure reply as the memory ("My brain
            // disconnected, try again."): dropped, so it never reaches $MEMORY (#268 follow-up 4).
            if (this.memoryMode === 'code') {
                // Round 17 M: an old summary is the model's narration (some of it wrong): dropped; the notes and the
                // fact records come back.
                this.notes = typeof data.notes === 'string' ? data.notes.slice(0, MEMORY_FACTS.notesMax) : '';
                this.facts = { ...emptyFacts(), ...(data.facts && typeof data.facts === 'object' ? data.facts : {}) };
                if (data.memory) console.log('[memory] the saved summary is not used (code-built memory)');
            } else this.memory = isMemoryReply(data.memory) ? data.memory : '';
            if (this.memoryMode !== 'code' && data.memory && !this.memory)
                console.warn(`[memory] the saved memory was not a summary (${typeof data.memory === 'string' ? `"${data.memory.trim().slice(0, 60)}"` : typeof data.memory}); starting with none`);
            this.turns = data.turns || [];
            const su = data.scrollUsed;
            this.scrollUsed = su && typeof su === 'object' ? { pos: Number.isFinite(su.pos?.x) ? { x: su.pos.x, y: su.pos.y, z: su.pos.z } : null, at: su.at ?? null } : null;
            console.log('Loaded memory:', this.memoryMode === 'code' ? `notes "${this.notes}"` : this.memory);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            throw error;
        }
    }

    clear() {
        this.turns = [];
        this.memory = '';
        this.facts = emptyFacts();
    }
}