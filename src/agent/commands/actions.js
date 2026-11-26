import { Vec3 } from 'vec3';
import * as skills from '../library/skills.js';
import { buildShelter } from '../library/shelter.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { addTask, cancelTask } from '../task_queue.js';
import { finishTask, endOpenGoal } from '../priority.js';
import { forgetNightGoal } from '../night_routine.js';
import { hasAutonomyPrefix } from '../agenda_driver.js';
import { nightPhase, nightRoutineActive, minutesToSunset, SHELTER_LEAD_MIN } from '../library/night.js';
import { deathSpotBlocked } from '../library/death_report.js';
import * as world from '../library/world.js';
import { threatFor, hurtBy, hasWeapon } from '../library/threats.js';
import { mayBelongToPlayer, retaliationRisk, knownBases, isHuntableAnimal, tooWeakToHunt, HUNT_MIN_FOOD } from '../library/hunting.js';
import { threatOf } from '../../../packages/rotn-data/index.js';
import { parseStandOn } from '../library/stand_on.js';
import { placeHere } from '../library/escape.js';
import { sightRange, rangeText, nearestOfKind, noteSearchFind, noteSearchMiss, missText, isAnimalKind } from '../library/entity_search.js';

/** Soak 14 (F2): the least a model's collect gets before dusk (it ends by the night routine otherwise). */
export const COLLECT_DUSK_MIN_MS = 30_000;
/**
 * Soak 14 (F2, the lead): the model's collect limits: its total time ends when the night routine takes over (dusk:
 * SHELTER_LEAD_MIN before sunset), at least COLLECT_DUSK_MIN_MS; a task giver's typed command, or no dusk near:
 * COLLECT_LIMITS as before.
 */
export function collectLimitsBeforeDusk(timeOfDay, context = null) {
    const m = Number.isFinite(timeOfDay) ? minutesToSunset(timeOfDay) : Infinity;
    const toDusk = (m - SHELTER_LEAD_MIN) * 60_000;
    return !context?.sender && m > 0 && Number.isFinite(toDusk) && toDusk < skills.COLLECT_LIMITS.totalMs
        ? { ...skills.COLLECT_LIMITS, totalMs: Math.max(COLLECT_DUSK_MIN_MS, toDusk) } : skills.COLLECT_LIMITS;
}

/** The model's !stay is at most this many seconds; longer (or -1, forever) needs a giver's typed command. */
export const STAY_LIMITS = { modelMaxS: 120 };
/** Modes that keep the bot alive: only a task giver who types !setMode may turn them off (CX23 soak). */
export const SURVIVAL_MODES = ['self_preservation', 'cowardice', 'self_defense'];

/**
 * Soak 2 (rotn-v0.1.4): long walks while hungry burned the last food (8 -> 1 in 9 min: two
 * !moveAway(64) and searches out to 256 blocks), and food 0 is instant death on this pack. Below
 * HUNGRY_WALK.belowFood the model's !moveAway, !searchForBlock and !searchForEntity go at most
 * HUNGRY_WALK.maxBlocks.
 */
export const HUNGRY_WALK = { belowFood: 8, maxBlocks: 32 };
function hungryCap(agent, what, blocks, context) {
    if (context?.sender) return blocks; // lead decision (#443 review): a task giver's typed command is not capped
    const food = agent.bot?.food;
    if (!Number.isFinite(food) || food >= HUNGRY_WALK.belowFood || !(blocks > HUNGRY_WALK.maxBlocks)) return blocks;
    skills.log(agent.bot, `${what} ${HUNGRY_WALK.maxBlocks} blocks at most at food ${food}, not ${blocks}: walking costs hunger, and food 0 kills you at once on this pack. Eat or !forage first.`);
    return HUNGRY_WALK.maxBlocks;
}

/**
 * #432 nit: below HUNGRY_WALK.belowFood, !goToCoordinates and !goToPlayer walk at most
 * HUNGRY_WALK.maxBlocks toward a target farther than that: the goal's closeness becomes the
 * distance left after such a walk. Returns the closeness to use (unchanged when not capped).
 * Lead decision (#443 review): a task giver's typed command (context.sender, as !stay and
 * !setMode) is never capped; the caps are for the model's own walks.
 */
export function hungryCloseness(agent, toward, target, closeness, context) {
    if (context?.sender) return closeness;
    const food = agent.bot?.food;
    const here = agent.bot?.entity?.position;
    if (!Number.isFinite(food) || food >= HUNGRY_WALK.belowFood || !here || !target) return closeness;
    const d = here.distanceTo(target);
    if (!(d - (Number.isFinite(closeness) ? closeness : 0) > HUNGRY_WALK.maxBlocks)) return closeness;
    skills.log(agent.bot, `Walking ${HUNGRY_WALK.maxBlocks} blocks at most toward ${toward} at food ${food}, not ${Math.round(d)}: walking costs hunger, and food 0 kills you at once on this pack. Eat or !forage first.`);
    return d - HUNGRY_WALK.maxBlocks;
}

/**
 * The block the running task (or else the self-prompt goal) says to stand on, when a walk to
 * x, y, z means that block: its own position or the one above it (G3 round 5 C: the model walked to
 * the gold block's position with range 1 and ended beside it). Else null.
 */
export function standOnTarget(agent, x, y, z) {
    const task = agent.tasks?.tasks?.find(t => t.status === 'active');
    const t = parseStandOn(task?.text) ?? parseStandOn(agent.self_prompter?.prompt);
    if (!t) return null;
    const [fx, fy, fz] = [x, y, z].map(Math.floor);
    return fx === t.x && fz === t.z && (fy === t.y || fy === t.y + 1) ? t : null;
}

/** 'day', 'dusk' or 'night' by the night routine's clock (else the server time), or null. */
function phaseNow(agent, now = Date.now()) {
    let phase = null;
    try { phase = agent._night?.clock?.phase?.(now) ?? null; } catch { phase = null; }
    const t = agent.bot?.time?.timeOfDay;
    return phase ?? (typeof t === 'number' ? nightPhase(t) : null);
}

/**
 * Why the model's !buildShelter is refused, or null (a task giver's typed one is always obeyed).
 * G3 round 2 B: by day it only spends blocks; the night routine builds at dusk. Soak 3 (rotn-v0.1.5):
 * while the routine runs (dusk to full day, the dawn gap included, where the clock already says
 * day) it would cut into the routine's own build or hole, which it did three times in a second.
 * Checked before the action starts, so the running action is not interrupted.
 */
export function shelterCommandRefusal(agent) {
    if (agent.control?.typed > 0) return null;
    if (nightRoutineActive(agent)) {
        return `Not building a shelter now: the night routine is seeing to it (${agent._night.state}) until full day, and this would interrupt it. Stay where you are.`;
    }
    if (phaseNow(agent) === 'day') return 'Not building a shelter by day: the night routine builds one at dusk. Keep your cobblestone for it.';
    return null;
}

const buildShelterAction = runAsAction(async (agent) => { await buildShelter(agent.bot); }, false, -1, 'buildShelter');

/** False (with a log line) when the walk would lead back to the death spot too soon (G3 round 2). */
function deathSpotOk(agent, x, y, z) {
    const why = deathSpotBlocked(agent, { x, y, z });
    if (!why) return true;
    skills.log(agent.bot, `Not going to ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}: it is near where you died, and ${why}.`);
    return false;
}

/**
 * Total time limits per command, in minutes (G3 smoke C+D and the #221 review). The limit is
 * kept inside the action: at the limit the bot is interrupted (pathfinder, collect, pvp and
 * digging stop), gets STOP_GRACE.ms (5 s) to end, and the command ends with a line the model sees,
 * instead of the upstream manager's kill after 10 s. The manager's own timeout (limit + 1 min)
 * stays the backstop. Walks inside are also bounded (GO_TO_LIMITS, COLLECT_LIMITS, USE_ON_LIMITS).
 * Commands not listed keep their own timeout; !followPlayer and !stay run until stopped.
 */
export const ACTION_LIMITS_MIN = {
    goToPlayer: 5, goToCoordinates: 5, standOnBlock: 5, searchForBlock: 5, searchForEntity: 5, moveAway: 5,
    goToRememberedPlace: 5, goToBed: 5, goToSurface: 6, useOn: 2,
    collectBlocks: 10, attack: 3, attackPlayer: 3, buildShelter: 5, digDown: 5,
    craftRecipe: 4, smeltItem: 12, clearFurnace: 2, putInChest: 2, takeFromChest: 2, viewChest: 1,
    givePlayer: 2, placeHere: 1,
};
export const STOP_GRACE = { ms: 5000 };

const limitText = (ms) => (ms >= 60_000 ? `${+(ms / 60_000).toFixed(1)} min` : `${+(ms / 1000).toFixed(1)} s`);

/**
 * Run fn with a total limit of ms. At the limit: interrupt the bot, wait up to STOP_GRACE.ms for
 * fn to end, then end the command with "!<name> failed: time limit of <t> reached; stopped."
 * A throw from fn before the limit is passed on, as before.
 */
export async function withinLimit(agent, name, fn, ms) {
    const TIMED_OUT = Symbol('timed out');
    // This command's run: skills take it at their start and check run.aborted after their awaits
    // (skills.currentRun). It is cleared when the command ends, so a later skill outside a limited
    // command (a reflex) never sees an old aborted run.
    const token = { aborted: false };
    agent.bot.action_run = token;
    const release = () => { if (agent.bot.action_run === token) agent.bot.action_run = null; };
    const run = Promise.resolve().then(fn);
    let timer;
    const limit = new Promise(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
    let res;
    try { res = await Promise.race([run, limit]); }
    finally { clearTimeout(timer); if (res !== TIMED_OUT) release(); }
    if (res !== TIMED_OUT) return;
    token.aborted = true; // the skill still holds it; stays set after the interrupt flag is cleared below
    release();
    run.catch(() => {}); // a late throw after the limit is not an unhandled rejection
    try { agent.requestInterrupt(); } catch (err) { console.warn(`[actions] interrupt failed: ${err?.message}`); }
    let grace;
    await Promise.race([run.catch(() => {}), new Promise(resolve => { grace = setTimeout(resolve, STOP_GRACE.ms); })]);
    clearTimeout(grace);
    // Clear the interrupt so the manager reports the output (an interrupted action reports nothing).
    agent.bot.interrupt_code = false;
    skills.log(agent.bot, `!${name} failed: time limit of ${limitText(ms)} reached; stopped.`);
}

/**
 * Soak 16 (E3, the lead): the commands after which a bot that dug and is now trapped (no walkable way to the sky) gets
 * out first (escape.escapeIfTrapped, the day budget): 'down-or-failed' (#624 review 2, the lead: a cave is "trapped"
 * too, and a collect in one is no reason) only when the collect took the bot 3 or more blocks below where it started,
 * or a walk of it failed (no path, out of reach); 'deep' (!digDown: a hole dug on purpose) only deeper than 2 below
 * where it started; 'walk' (soak 16 trap, the lead's go; was 'failed') when the walk itself failed (no path, the time
 * limit, or "Unable to reach": it ended short), or ended 3 or more blocks below where it started ('failed', kept for
 * other callers: only a failed walk). Model commands only: never a reflex or a night job. (!breakBlockAt is no
 * command: a skill only.)
 */
export const POST_ESCAPE = { collectBlocks: 'down-or-failed', digDown: 'deep',
    goToCoordinates: 'walk', searchForBlock: 'walk', goToRememberedPlace: 'walk', goToBed: 'walk', goToPlayer: 'walk' };
/** The escape's own minutes, added to a command's limit when its post-condition may run. */
const POST_ESCAPE_MIN = 6;
export async function postEscape(agent, label, start, { escapeIfTrapped = null } = {}) {
    const kind = POST_ESCAPE[label];
    if (!kind) return null;
    const bot = agent.bot;
    const walkFailed = (bot.rotnWalkFailedAt ?? 0) >= start.t;
    if (kind === 'failed' && !walkFailed) return null;
    // Soak 16 trap (the lead's go): a walk that dug is checked when it failed (no path, the time limit, "Unable to
    // reach": a walk that ended short), or when it ended 3 or more blocks below where it started.
    // #624 re-review nit 1 (the lead): the collect only when its last walk failed or it got fewer than asked
    // (bot.rotnCollectEnd), never for one target out of reach on the way.
    const end = bot.rotnCollectEnd;
    const collectShort = kind === 'down-or-failed' && (end?.at ?? 0) >= start.t && (end.lastWalkFailed || end.short);
    // #642 review 7: a walk that reached a goal whose own y is 3 or more below its start went down on purpose (a bed or a
    // saved place underground): no check.
    const reached = bot.rotnWalkReached;
    if (kind === 'walk' && !walkFailed && start.at && (reached?.at ?? 0) >= start.t && reached.y <= start.at.y - 3) return null;
    const minDepth = kind === 'deep' ? 3 : kind === 'down-or-failed' && !collectShort ? 3 : kind === 'walk' && !walkFailed ? 3 : 0;
    const run = escapeIfTrapped ?? (await import('../library/escape.js')).escapeIfTrapped;
    const line = await run(bot, { digsBefore: start.digs, from: start.at, minDepth });
    if (line) skills.log(bot, line);
    return line;
}

function runAsAction (actionFn, resume = false, timeout = -1, label = null) {
    let actionLabel = label;  // Will be set on first use (given when a perform checks first, then runs this)
    
    const wrappedAction = async function (agent, ...args) {
        // Soak 10 (#581 review 4): no command runs over the respawn escape (it would end it among the
        // player zombies at the spawn); it is refused, said why, until the escape ends.
        // #581 re-review nit 5: its whole window (agent._escape.due, set by each escape tick; no import of
        // respawn_escape.js here: that would be an import cycle through commands/index.js).
        // #581 follow-up 1: the flag only while fresh (dueUntil): a control hold stops the ticks that refresh it.
        const esc = agent._escape;
        if (esc?.job || (esc?.due && Date.now() < (esc.dueUntil ?? 0))) return 'Not now: the respawn escape is running (sprinting away from the spawn and the places you died). Try again when it has ended.';
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const limitMin = ACTION_LIMITS_MIN[actionLabel] ?? 0;
        const run = limitMin > 0
            ? () => withinLimit(agent, actionLabel, () => actionFn(agent, ...args), limitMin * 60_000)
            : async () => { await actionFn(agent, ...args); };
        // Soak 16 (E3): the post-condition (POST_ESCAPE) after the command, within the same action (interruptible, the
        // hands rule around it), with its own minutes on top of the command's limit.
        const post = POST_ESCAPE[actionLabel];
        const actionFnWithAgent = post
            ? async () => {
                const start = { t: Date.now(), digs: agent.bot.rotnDigs?.count ?? 0, at: agent.bot.entity?.position?.floored?.() ?? null };
                await run();
                await postEscape(agent, actionLabel, start);
            }
            : run;
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent,
            { timeout: limitMin > 0 ? limitMin + 1 + (post ? POST_ESCAPE_MIN : 0) : timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

const useOnAction = runAsAction(async (agent, tool_name, target) => {
    await skills.useToolOn(agent.bot, tool_name, target);
}, false, -1, 'useOn');
const goToBedAction = runAsAction(async (agent) => { await skills.goToBed(agent.bot); }, false, -1, 'goToBed');

/**
 * Round 17 P: the Scroll of New Life's use, {pos, at} or null: this session's (the night routine's respawnSet, round 17
 * M) or the saved one (History.scrollUsed, kept in memory.json across restarts).
 */
export function scrollUsed(agent) {
    const n = agent?._night?.respawnSet;
    if (n) return n;
    const h = agent?.history?.scrollUsed;
    if (h && typeof h === 'object') return h;
    // #645 review 1: no scroll held means used (memory.json is not reloaded on the CX23: load_memory is false).
    return skills.scrollUsedOn(agent?.bot);
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent, context) {
            // A task giver who types it also puts autonomy on hold until !resume (E3), so the
            // agenda or a task cannot undo it. When the model uses it, only the action stops.
            if (context?.sender) {
                agent.control.setHold('stop', context.sender);
                if (agent.self_prompter.isActive()) agent.self_prompter.stop(false);
                forgetNightGoal(agent); // #463 nit 1: nor does the goal the night stopped come back
            }
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.bot.emit('idle');
            if (context?.sender) return 'stopped; on hold until a task giver types !resume';
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'A task giver types this to stop all chatting and self prompting, but continue the current action.',
        forcedOnly: true, // task givers only (E3, lead's #146 review); it holds autonomy until !resume
        perform: async function (agent, context) {
            if (!context?.sender) return 'stfu: a task giver must type !stfu themselves';
            agent.openChat('Shutting up until a task giver types !resume.');
            agent.control.setHold('quiet', context.sender);
            agent.shutUp();
            return;
        }
    },
    {
        name: '!pause',
        description: 'A task giver types this to pause tasks and the agenda: the current action finishes, then the bot waits for !resume.',
        forcedOnly: true,
        perform: function (agent, context) {
            if (!context?.sender) return 'pause: a task giver must type !pause themselves';
            agent.control.setHold('pause', context.sender);
            if (agent.self_prompter.isActive()) agent.self_prompter.stop(false);
            return 'paused; the current action finishes, then I wait until a task giver types !resume';
        }
    },
    {
        name: '!resume',
        description: 'A task giver types this to end a !stop, !pause or !stfu: tasks and the agenda carry on.',
        forcedOnly: true,
        perform: function (agent, context) {
            if (!context?.sender) return 'resume: a task giver must type !resume themselves';
            const was = agent.control.release();
            agent.shut_up = false;
            return was ? `resumed (after ${was.kind} by ${was.by})` : 'resumed (nothing was on hold)';
        }
    },
    {
        name: '!taskDone',
        description: 'Call when the player task you are working on is done. Say briefly what you did.',
        params: {
            'summary': { type: 'string', description: 'What you did, in a few words.' }
        },
        perform: function (agent, summary) {
            return finishTask(agent, 'done', summary);
        }
    },
    {
        name: '!taskFailed',
        description: 'Call when the player task you are working on cannot be done. Say why.',
        params: {
            'reason': { type: 'string', description: 'Why it cannot be done, in a few words.' }
        },
        perform: function (agent, reason) {
            return finishTask(agent, 'failed', reason);
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness, context) => {
            const target = skills.findPlayer(agent.bot, player_name)?.entity?.position;
            await skills.goToPlayer(agent.bot, player_name, hungryCloseness(agent, player_name, target, closeness, context));
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            // A follow that could not start, or whose player left (false), is not resumed again
            // after the next idle (G4 #3 prep): it would retry every second, and a giver's typed
            // follow would hold tasks and the agenda for nothing.
            if (await skills.followPlayer(agent.bot, player_name, follow_dist) === false) agent.actions.cancelResume();
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness, context) => {
            if (!deathSpotOk(agent, x, y, z)) return;
            const near = hungryCloseness(agent, `${x}, ${y}, ${z}`, new Vec3(x, y, z), closeness, context);
            if (near !== closeness) { await skills.goToPosition(agent.bot, x, y, z, near); return; } // part of the way: no stand-on
            const stand = standOnTarget(agent, x, y, z);
            if (stand) {
                skills.log(agent.bot, `The task says to stand on the ${stand.name ?? 'block'} at ${stand.x} ${stand.y} ${stand.z}, so standing on top of it and checking.`);
                await skills.standOnBlock(agent.bot, stand.x, stand.y, stand.z, stand.name);
                return;
            }
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!standOnBlock',
        description: 'Stand on the block at x, y, z (the block\'s own coordinates) and check it is under your feet. Use it whenever you must stand on a block; say you are on it only after it says so.',
        params: {
            'type': {type: 'BlockName', description: 'The block to stand on, e.g. gold_block.'},
            'x': {type: 'float', description: 'The x coordinate of the block.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate of the block.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate of the block.', domain: [-Infinity, Infinity]},
        },
        perform: runAsAction(async (agent, type, x, y, z) => {
            if (!deathSpotOk(agent, x, y + 1, z)) return;
            await skills.standOnBlock(agent.bot, x, y, z, type);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: runAsAction(async (agent, block_type, range, context) => {
            if (range < 32) {
                skills.log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, hungryCap(agent, 'Searching', range, context));
        })
    },
    {
        name: '!searchForEntity',
        description: 'Go to the nearest entity of a type within a range. A pig, cow, sheep or rabbit also finds the pack\'s Animania ones; animals are seen only within 64 blocks, and a miss lists the animals in sight.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range, context) => {
            // Soak 13 (C1): a generic kind (cow, pig, sheep, rabbit) also finds its Animania food adults; the
            // range is what the bot can see at most; the model's miss says what is in sight, and after 3 misses
            // in one area that searching there finds nothing more (entity_search.js). A task giver's typed
            // command gets the plain miss line and is not counted (as hungryCap).
            // Soak 14 (F1, the lead): at food 2 an ewe was in sight beyond 32 blocks and the capped search could not
            // reach it. The animal asked for, in sight, armed and strong enough to hunt (food > HUNT_MIN_FOOD): no
            // hungry cap (that walk is the food); else as before.
            const bot = agent.bot;
            const huntable = isAnimalKind(entity_type) && !context?.sender && Number.isFinite(bot?.food) && bot.food > HUNT_MIN_FOOD
                && hasWeapon(bot) && !!nearestOfKind(bot, entity_type, Infinity);
            const capped = huntable ? range : hungryCap(agent, 'Searching', range, context);
            if (huntable && Number.isFinite(bot.food) && bot.food < HUNGRY_WALK.belowFood && range > HUNGRY_WALK.maxBlocks)
                skills.log(bot, `Searching past ${HUNGRY_WALK.maxBlocks} blocks at food ${bot.food}: ${entity_type} is in sight, and it is the food.`);
            // #601 review 1: not an animal (a zombie, a villager): upstream's search, the asked range, the plain line.
            if (!isAnimalKind(entity_type)) { await skills.goToNearestEntity(agent.bot, entity_type, 4, capped); return; }
            const r = sightRange(capped);
            const found = nearestOfKind(agent.bot, entity_type, r);
            if (!found) {
                if (context?.sender) skills.log(agent.bot, `Could not find any ${entity_type} in ${rangeText(r)} blocks.`);
                else skills.log(agent.bot, missText(agent, entity_type, capped, r, noteSearchMiss(agent, entity_type)));
                return;
            }
            noteSearchFind(agent);
            await skills.goToNearestEntity(agent.bot, found.name, 4, Number.isFinite(r) ? r : Number.MAX_VALUE);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance, context) => {
            await skills.moveAway(agent.bot, hungryCap(agent, 'Moving away', distance, context));
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            if (!deathSpotOk(agent, pos[0], pos[1], pos[2])) return;
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            // BlockOrItemName (E2): an item with a world rule works too, e.g. "stick" (from a felled tree).
            'type': { type: 'BlockOrItemName', description: 'The block or item to collect: a block (e.g. "log") or an item that comes from breaking blocks (e.g. "stick" from a felled tree, "pyrotech:rock" from rock piles and stone).' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num, context) => {
            // Soak 14 (F2, the lead): the model's collect ends before the night routine needs the bot (dusk:
            // SHELTER_LEAD_MIN before sunset), not after its 8 min: after death 2 the dirt collect took the
            // last 8 min before sunset.
            const limits = collectLimitsBeforeDusk(agent.bot?.time?.timeOfDay, context);
            // The off-hand pickaxe and the re-arm: the action boundary (library/hands.js; soak 15).
            await skills.collectBlock(agent.bot, type, num, null, hungryCap(agent, 'Collecting within', 64, context), limits);
        })
    },
    {
        // G4 #5: wild food before hunting (rotn-data forageFood; library/foraging.js).
        name: '!forage',
        description: 'Gather ripe wild food near you: picks wildberry bushes (right-click; they regrow), breaks ripe wild herbs and HarvestCraft gardens, picks the food up. Never a bare bush, an unripe herb, hawthorn, poison ivy or thorns, nor a crop near fences, farmland, chests or houses (it may be a player\'s).',
        perform: runAsAction(async (agent) => {
            await skills.forageNearby(agent.bot);
        })
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            // Upstream restarted the process after every successful smelt "to update
            // inventory". On Forge each restart is a full relogin, so it no longer
            // restarts (skills-rotn A3).
            await skills.smeltItem(agent.bot, item_name, num);
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place one block where you stand. A full block (dirt, cobblestone) goes under you by a jump, so you stand one higher on it (a way up out of a pit or water); a torch or the like goes where you stand. Only single blocks or torches, never structures.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            // Soak 8 (the escape plan PR 2): the bot's own cell; a full block by a jump (escape.placeHere).
            await placeHere(agent.bot, type);
        })
    },
    {
        name: '!buildShelter',
        description: 'Build a closed 1x2 night shelter of cobblestone or stone around yourself, from inside (up to 10 blocks; walls you stand next to that are already rock are kept). Run it again inside the shelter to repair an open wall.',
        params: { },
        perform: function (agent) {
            // The model's own !buildShelter: refused by day and while the night routine runs
            // (shelterCommandRefusal), before anything running is interrupted. A task giver who
            // types it is obeyed.
            const refusal = shelterCommandRefusal(agent);
            if (refusal) return Promise.resolve(refusal);
            return buildShelterAction(agent);
        }
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type, context) => {
            // A mob that only fights back is not attacked unless it hurt the bot (#226 review: the
            // model attacked a grove sprite; rotn-data marks it ignore-unless-provoked).
            const mob = world.getNearbyEntities(agent.bot, 24).find(e => e.name === type);
            // #453 review 2 and 3: an animal that must never be fought (rotn-data provoked.fightBack
            // false: an Animania bull, a polar bear, a panda, a book wyrm) is never attacked by the
            // model, hurt or not; a task giver who types it may, with a warning (ownership still holds).
            const giver = context?.sender ?? null;
            const never = mob ? threatFor(mob)?.provoked : null;
            if (mob && never?.fightBack === false) {
                if (!giver) {
                    skills.log(agent.bot, `Not attacking ${type}: it must never be fought (it hits for ${never.damage}${never.health ? ` and has ${never.health} health` : ''}${never.callsForHelp ? ', and others join in' : ''}). Get away from it instead.`);
                    return;
                }
                skills.log(agent.bot, `Warning: ${giver} asked for it, so attacking ${type}, which is never fought otherwise (it hits for ${never.damage}${never.health ? ` and has ${never.health} health` : ''}).`);
            }
            // Soak 2: at food 4 or lower Hunger Overhaul's weakness leaves the bot unable to hurt an
            // animal; the chase only burns the last hunger (food 0 kills on this pack).
            if (mob && isHuntableAnimal(mob) && tooWeakToHunt(agent.bot) && !hurtBy(agent.bot, mob)) {
                skills.log(agent.bot, `Not hunting ${type}: your food is ${agent.bot.food}, and at ${HUNT_MIN_FOOD} or lower you are too weak to hurt it (weakness). Eat anything you hold, or !forage nearby; food 0 kills you at once on this pack.`);
                return;
            }
            // Soak 5 (#500 follow-up 2): no hunt with no weapon (the model chased a sow bare-handed
            // after a death, with zombies near). A task giver who types it may, with a warning; the
            // ownership refusal below still holds.
            // #501 decision (reviewer nit 1): also a provoked one that hurt the bot (unarmed, #497 flees
            // from it); a giver may still override.
            if (mob && isHuntableAnimal(mob) && !hasWeapon(agent.bot)) {
                if (!giver) {
                    skills.log(agent.bot, `Not hunting ${type}: you hold no weapon. Forage for food first (!forage); make a weapon (a wooden club from 2 logs, no table: !craftRecipe("spartanweaponry:club_wood", 1)) before you hunt.`);
                    return;
                }
                skills.log(agent.bot, `Warning: ${giver} asked for it, so hunting ${type} with no weapon.`);
            }
            if (mob && threatFor(mob)?.reaction === 'ignore-unless-provoked' && !hurtBy(agent.bot, mob) && !(giver && never?.fightBack === false)) {
                skills.log(agent.bot, `Not attacking ${type}: it attacks only when hurt, and it has not hurt you. Leave it alone; if it attacks you, the bot defends itself.`);
                return;
            }
            // G4 #5 (the lead's hard rule for the live server): never an animal that may belong to a
            // player (unknown metadata, a name tag, tamed, leashed, ridden, saddled or dyed, near
            // player-built blocks or a known base). #422 review 2: every target that is not a hostile
            // mob to fight and not a player is checked (rotn-data knows no threat for forge-bridge's
            // placeholders such as animania:entity_7, nor for an unknown name). Of this type, the
            // nearest one that is not maybe a player's; none: refused, with why.
            // Hostile only by rotn-data's own entry: threatFor's fallback (mc.isHostile) calls every
            // unknown name a fight mob, which would let a placeholder through unchecked.
            const HOSTILE = ['fight', 'avoid', 'keep-distance', 'take-cover'];
            let known = null;
            try { known = mob ? threatOf(mob.name) : null; } catch { known = null; }
            // A mob that just hurt the bot may be fought back (self-defense comes first).
            const forced = giver && never?.fightBack === false; // the giver's own call on a never-fight animal
            if (mob && mob.type !== 'player' && !HOSTILE.includes(known?.reaction) && (forced || !hurtBy(agent.bot, mob))) {
                const skipped = [], risky = [];
                let riskyOne = null;
                const bases = knownBases(agent);
                // #448: nor one whose hunt brings a bull or a herd down on the bot (retaliationRisk).
                // Soak 5: not one an attack just gave up on (no closer, no hit; skills.isUnreachable).
                const ofType = world.getNearbyEntities(agent.bot, 24).filter(e => e.name === type);
                let free = ofType.filter(e => !skills.isUnreachable(agent.bot, e))
                    .find(e => {
                        const why = mayBelongToPlayer(agent.bot, e, { bases });
                        if (why) { skipped.push(why); return false; }
                        const risk = retaliationRisk(agent.bot, e);
                        if (risk) { risky.push(risk); riskyOne ??= e; return false; }
                        return true;
                    });
                // #453 review 3: a task giver may override the bull and herd refusal (warned), never ownership.
                if (!free && riskyOne && giver) {
                    skills.log(agent.bot, `Warning: ${giver} asked for it, so attacking ${type} although ${risky[0]}.`);
                    free = riskyOne;
                }
                if (!free) {
                    // #453 review 3: every reason, when the candidates were refused for different ones.
                    const why = [];
                    if (ofType.some(e => skills.isUnreachable(agent.bot, e))) why.push(`the ones it could not reach in the last ${skills.ATTACK_PROGRESS.skipMs / 60_000} min are left alone`);
                    if (skipped.length) why.push(`it may belong to a player (${[...new Set(skipped)].join('; ')})`);
                    if (risky.length) why.push([...new Set(risky)].join('; '));
                    // Soak 16 (F5): the herd is others of its breed; a bull counts only within a sweeping weapon's reach.
                    const hint = skipped.length && risky.length ? 'Find a lone, wild one away from others of its breed, fences, farms and houses.'
                        : skipped.length ? 'Find a wild one away from fences, farms and houses.' : risky.length ? 'Find a lone one, away from others of its breed (with a sword, also away from bulls).' : 'Try another one, another place, or !forage.';
                    skills.log(agent.bot, `Not attacking ${type}: ${why.join('; and ')}. ${hint}`);
                    return;
                }
                // Soak 16 (F5): the herd rule again during the chase (not after a giver's override).
                const overridden = free === riskyOne && !!giver;
                await skills.attackEntity(agent.bot, free, true, overridden ? {} : { stillAllowed: (b, e) => retaliationRisk(b, e, { weapon: b.heldItem ?? null }) });
                return;
            }
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: function (agent, ...rest) {
            // Round 17 P (rotn-data, the lead's addendum): any spawn change other than the Scroll of New Life itself (a
            // bed sets the spawn when you wake) ends the scroll's respawn point and its 32-block Zombie Player guard
            // for good. Once the scroll is used, never a bed.
            const used = scrollUsed(agent);
            if (used) return skills.bedRefusalText(used);
            return goToBedAction(agent, ...rest);
        }
    },
    {
        name: '!stay',
        description: `Stay in the current location. Pauses the other modes; self-preservation and self-defense stay on. At most ${STAY_LIMITS.modelMaxS} s unless a task giver types it.`,
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever (a task giver only).', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds, context) => {
            // #414/#422 follow-up (lead): the model could pause every survival mode for good with
            // !stay(-1). Its stay is capped at STAY_LIMITS.modelMaxS; longer, or forever, only when a
            // task giver typed it (context.sender, as !setMode). self_preservation always stays on (skills.stay).
            let s = seconds;
            if (!context?.sender && (s === -1 || s > STAY_LIMITS.modelMaxS)) {
                console.log(`[modes] the model asked to stay ${s === -1 ? 'forever' : `${s} s`}; capped at ${STAY_LIMITS.modelMaxS} s (only a task giver may stay longer)`);
                skills.log(agent.bot, `Staying ${STAY_LIMITS.modelMaxS} s at most: only a task giver can make you stay longer.`);
                s = STAY_LIMITS.modelMaxS;
            }
            // #424 review: the model's stay keeps self_defense (only cowardice pauses: its flee
            // contradicts a stay); a task giver's stay may pause both, as before.
            await skills.stay(agent.bot, s, { pauseSelfDefense: !!context?.sender });
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on, context) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            // CX23 soak (rotn-v0.1.3): unarmed after a death, the model turned self_defense off and
            // left cowardice off, and player zombies killed the bot again and again. The survival
            // modes are turned off only by a task giver who types it (context.sender); the model is refused.
            if (!on && SURVIVAL_MODES.includes(mode_name) && !context?.sender && modes.isOn(mode_name)) {
                console.log(`[modes] refused: the model asked to turn ${mode_name} off; only a task giver may`);
                return `Mode ${mode_name} stays on: it keeps you alive, and only a task giver may turn it off.`;
            }
            if (on && modes.isDisabled(mode_name))
            return `Mode ${mode_name} is disabled: ${modes.disabledReason(mode_name)}.`;
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!taskAdd',
        description: 'A task giver types this to queue a task. Priority is "urgent" or "normal".',
        // Only on the forced path: the giver is the sender of the typed command, passed per call,
        // never shared state or a name the LLM writes; not offered to the LLM (#146 review).
        forcedOnly: true,
        params: {
            'text': { type: 'string', description: 'The task, in the player\'s words.' },
            'priority': { type: 'string', description: 'urgent or normal.' } // required: the parser has no optional params
        },
        perform: function (agent, text, priority, context) {
            return addTask(agent.tasks, { giver: context?.sender ?? null, text, priority }, (name) => agent.isTaskGiver(name));
        }
    },
    {
        name: '!agendaStop',
        description: 'A task giver types this to stop the RotN agenda (autonomous play).',
        forcedOnly: true, // only a player who typed it, never the LLM (E2)
        perform: function (agent, context) {
            if (!context?.sender) return 'agenda: a task giver must type !agendaStop themselves';
            agent.agenda.stop();
            if (agent.self_prompter.isActive()) agent.self_prompter.stop(false);
            return 'agenda stopped';
        }
    },
    {
        name: '!agendaStart',
        description: 'A task giver types this to start (or resume) the RotN agenda.',
        forcedOnly: true,
        perform: function (agent, context) {
            if (!context?.sender) return 'agenda: a task giver must type !agendaStart themselves';
            agent.agenda.start();
            return 'agenda started';
        }
    },
    {
        name: '!taskCancel',
        description: 'A task giver types this to cancel an open task by its id (like t3).',
        forcedOnly: true,
        params: {
            'id': { type: 'string', description: 'The task id, for example t3.' }
        },
        perform: function (agent, id, context) {
            return cancelTask(agent.tasks, { by: context?.sender ?? null, id }, (name) => agent.isTaskGiver(name));
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt, context) {
            // While the agenda is on or a player task is open, the model may not set its own goal
            // (E3; #174 review 3: in a back-off gap it escaped every budget). A task giver who types
            // !goal may; only such a goal is exempt from the budgets (goal_by, priority.js).
            const sp = agent.self_prompter;
            if (!context?.sender && (agent.agenda?.active || agent.tasks?.current()))
                return 'Not now: the RotN agenda or a player task sets your goal. Keep working on it with commands.';
            if (!context?.sender && hasAutonomyPrefix(prompt))
                return 'Not now: goal texts that start like the agenda or a player task are set only by them.';
            sp.goal_by = context?.sender ?? null;
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent, context) {
            agent.self_prompter.stop();
            // #463 nit 1: a task giver's !endGoal also ends the goal the night stopped (resumeNightGoal).
            if (context?.sender) { forgetNightGoal(agent); endOpenGoal(agent); } // #468 review 1 (iii): and the open goal until the retry
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        // Bounded inside useToolOn (60 s); ACTION_LIMITS_MIN (2 min) is the backstop (G3 batch A: it hung).
        perform: function (agent, tool_name, target, ...rest) {
            // #645 review 6: right-clicking a bed sets the spawn too: refused once the Scroll of New Life is used.
            const used = /(^|:|_)bed$/.test(String(target ?? '')) ? scrollUsed(agent) : null; // #645 nit: asked once
            if (used) return skills.bedRefusalText(used);
            return useOnAction(agent, tool_name, target, ...rest);
        }
    },
];
