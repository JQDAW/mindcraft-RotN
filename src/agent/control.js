// Control commands from task givers (skills-rotn E3; PLAN priority stack level 2).
//
// A giver's typed !stop, !pause or !stfu puts autonomy (player tasks and the
// agenda) on hold until a giver types !resume. The hold is kept in
// ./bots/<name>/control.json, written atomically, so a crash or a service
// restart does not undo it. A giver's typed action (like !goToPlayer, "come")
// holds autonomy while it runs; that part is in memory only.
// A corrupt file is moved aside and reported; the bot then starts with no hold.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const HOLD_KINDS = ['stop', 'pause', 'quiet'];

export class Control {
    /**
     * @param {string} botName
     * @param {{dir?: string, now?: () => number}} [opts] dir defaults to ./bots/<botName>
     */
    constructor(botName, { dir = `./bots/${botName}`, now = Date.now } = {}) {
        this.file = path.join(dir, 'control.json');
        this.now = now;
        this.hold = null; // {kind, by, at}
        this.typed = 0; // giver-typed actions running now
        this.typedResume = null; // {label, fn, by, idleSince, kicks}: a giver-typed resumable action a reflex interrupted
        this.loadProblem = null;
        this.load();
    }

    load() {
        if (!existsSync(this.file)) return;
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8'));
            if (!data || typeof data !== 'object' || !('hold' in data)) throw new Error('no control state');
            const h = data.hold;
            this.hold = h && HOLD_KINDS.includes(h.kind) && typeof h.by === 'string' ? h : null;
        } catch (err) {
            const aside = `${this.file}.corrupt-${this.now()}`;
            try { renameSync(this.file, aside); } catch { /* left in place; the next save overwrites it */ }
            this.loadProblem = `[control] ${this.file} could not be read (${err.message}); moved it to ${aside}. No hold is set.`;
            console.warn(this.loadProblem);
        }
    }

    save() {
        try {
            mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            writeFileSync(tmp, JSON.stringify({ version: 1, hold: this.hold, updated_at: this.now() }, null, 2));
            renameSync(tmp, this.file);
        } catch (err) {
            console.warn(`[control] Could not save ${this.file} (${err.message}).`);
        }
    }

    /** Put autonomy on hold (a giver typed !stop, !pause or !stfu). */
    setHold(kind, by) {
        if (!HOLD_KINDS.includes(kind)) throw new Error(`unknown hold ${kind}`);
        this.hold = { kind, by, at: this.now() };
        this.save();
    }

    /** A giver typed !resume. Returns the hold it lifted, or null. */
    release() {
        const was = this.hold;
        if (was) { this.hold = null; this.save(); }
        return was;
    }

    /** A giver's typed action starts or ends (autonomy waits while one runs). */
    beginTyped() { this.typed++; }
    endTyped() { this.typed = Math.max(0, this.typed - 1); }

    /**
     * A giver's typed resumable action (!followPlayer) was interrupted by a reflex and waits for
     * the action manager to resume it (G4 #3 prep): autonomy waits for it too, as while it runs.
     * Tied to that action's own resume function (#323 review 3), so another follow with the same
     * label (the model's own) holds nothing. priority.js clears it once the action manager no
     * longer holds that resume (!stop cancels it), and resumes it when no 'idle' came (#323 review 1).
     */
    holdTypedResume(label, fn, by) { this.typedResume = { label, fn, by, idleSince: null, kicks: 0 }; }

    /** What holds autonomy now: 'stop', 'pause', 'quiet', 'command' (a typed action runs), or null. */
    blocking() {
        return this.hold?.kind ?? (this.typed > 0 ? 'command' : null);
    }
}
