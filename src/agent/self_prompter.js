import { takeReplanNote } from './replan.js';

const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2
export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.dropped_for_reflex = false;
        this.finish_turn = null; // stopAfterTurn's reason, until the loop stops
        this.finish_turn_ran = false; // a command ran since (#508 review 4)
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        this.finish_turn = null;
        this.prompt = prompt;
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
    }

    setPromptPaused(prompt) {
        this.prompt = prompt;
        this.state = PAUSED;
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        let no_command_count = 0;
        const MAX_NO_COMMAND = 3;
        let note = null;
        while (!this.interrupt) {
            // Reflexes no longer stop this loop (skills-rotn A4): wait while one runs,
            // so the next command cannot cut a flee or a fight short.
            while (!this.interrupt && this.reflexActive()) {
                await new Promise(r => setTimeout(r, 500));
            }
            if (this.interrupt) break;
            note = takeReplanNote(this.agent) ?? note; // a reflex's re-plan request, if any
            let msg = `You are self-prompting with the goal: '${this.prompt}'. Your next response MUST contain a command with this syntax: !commandName. Respond:`;
            if (note) msg = `${note} ${msg}`;

            if (this.finishTurnStop()) break;
            this.dropped_for_reflex = false;
            let used_command = await this.agent.handleMessage('system', msg, -1);
            if (!used_command && this.dropped_for_reflex) {
                continue; // a reflex started meanwhile; not the model's fault, and the note is kept
            }
            note = null;
            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    let out = `Agent did not use command in the last ${MAX_NO_COMMAND} auto-prompts. Stopping auto-prompting.`;
                    this.agent.openChat(out);
                    console.warn(out);
                    this.state = STOPPED;
                    break;
                }
            }
            else {
                no_command_count = 0;
                if (this.finishTurnStop()) break;
                await new Promise(r => setTimeout(r, this.cooldown));
            }
            if (this.finishTurnStop()) break;
        }
        console.log('self prompt loop stopped')
        this.loop_active = false;
        this.interrupt = false;
    }

    update(delta) {
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this.interrupt)
            return;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        this.finish_turn = null;
        // Only a running loop needs the interrupt; set with no loop, it stayed on and
        // made the next start a no-op (skills-rotn E3).
        if (this.loop_active) this.interrupt = true;
        if (stop_action)
            await this.agent.actions.stop();
        this.stopLoop();
        this.state = STOPPED;
    }

    /**
     * Soak 6 (c): a budget stop (priority.js, the standing goal's daily budget) dropped the command
     * the model had just returned (18:03:40 !craftRecipe tinder; the loop stopped 2 s later). Stop
     * after the turn in flight instead: a reply already asked for still runs its command, then the
     * loop ends and the state is STOPPED. With no loop running, it stops now. `why` is logged.
     */
    stopAfterTurn(why = 'a stop after the turn') {
        // #508 review 6: STOPPED at once and saved, so a restart meanwhile does not resume the loop;
        // the loop itself ends at its next check (finishTurnStop) or after the turn's first command.
        this.state = STOPPED;
        try { this.agent.history?.save?.(); } catch (err) { console.warn(`[self-prompt] could not save the stop: ${err?.message ?? err}`); }
        if (!this.loop_active) return false;
        this.finish_turn = why;
        this.finish_turn_ran = false;
        return true;
    }

    /** handleMessage ran a command (#508 review 4): with a stop after the turn due, the turn ends here. */
    noteCommandRan(is_self_prompt) {
        if (is_self_prompt && this.finish_turn) this.finish_turn_ran = true;
    }

    /** The loop's check for stopAfterTurn: true (and STOPPED) when a stop after the turn is due. */
    finishTurnStop() {
        if (!this.finish_turn) return false;
        console.log(`[self-prompt] stopping after the turn (${this.finish_turn})`);
        this.finish_turn = null;
        this.finish_turn_ran = false;
        this.state = STOPPED;
        return true;
    }

    async pause() {
        if (this.loop_active) this.interrupt = true;
        await this.agent.actions.stop();
        this.stopLoop();
        this.state = PAUSED;
    }

    // True while a mode's action (a reflex) runs (skills-rotn A4).
    reflexActive() {
        return !!this.agent.bot?.modes?.anyActive?.();
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        // A self-prompt reply that arrives while a reflex runs is dropped, not acted on (A4).
        if (is_self_prompt && this.state === ACTIVE && this.loop_active && this.reflexActive()) {
            this.dropped_for_reflex = true;
            return true;
        }
        // A stop sets the state to STOPPED at once, so the interrupt alone decides: the reply
        // loop ends at its next checkpoint instead of running more commands (E3: !stop, a hold
        // or a task taking over must win before the next command).
        // #508 review 4: a stop after the turn lets one command run, not a chain of them.
        if (is_self_prompt && this.finish_turn && this.finish_turn_ran) return true;
        return is_self_prompt && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}