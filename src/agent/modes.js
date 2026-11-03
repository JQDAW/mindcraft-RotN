import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';
import * as names112 from './library/names112.js';
import * as threats from './library/threats.js';
import { createErrorReporter } from './update_loop.js';
import { safeError } from './safe_error.js';
import { requestReplan, replanPromptDue, takeReplanNote } from './replan.js';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'gravel', 'concrete_powder'], // includes matching substrings like 'sandstone' and 'red_sand'
        update: async function (agent) {
            const bot = agent.bot;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            if (names112.isWater(blockAbove.name)) {
                // does not call execute so does not interrupt other actions
                if (!bot.pathfinder.goal) {
                    bot.setControlState('jump', true);
                }
            }
            else if (this.fall_blocks.some(name => blockAbove.name?.includes(name))) {
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 2);
                });
            }
            else if (names112.isLava(block.name) || block.name === 'fire' ||
                names112.isLava(blockAbove.name) || blockAbove.name === 'fire') {
                say(agent, 'I\'m on fire!');
                // if you have a water bucket, use it
                let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                if (waterBucket) {
                    execute(this, agent, async () => {
                        let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                        if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                    });
                }
                else {
                    execute(this, agent, async () => {
                        let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                        if (waterBucket) {
                            let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                            if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                            return;
                        }
                        let nearestWater = world.getNearestBlock(bot, names112.WATER_BLOCKS, 20);
                        if (nearestWater) {
                            const pos = nearestWater.position;
                            let success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                            if (success) say(agent, 'Found some water, ahhhh that\'s better!');
                            return;
                        }
                        await skills.moveAway(bot, 5);
                    });
                }
            }
            else if (Date.now() - bot.lastDamageTime < 3000 && (bot.health < 5 || bot.lastDamageTaken >= bot.health)) {
                say(agent, 'I\'m dying!');
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 20);
                });
            }
            else if (agent.isIdle()) {
                bot.clearControlStates(); // clear jump if not in danger or doing anything else
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        prev_location: null,
        distance: 2,
        stuck_time: 0,
        last_time: Date.now(),
        max_stuck_time: 20,
        free_timeout_ms: 10_000,
        prev_dig_block: null,
        update: async function (agent) {
            if (agent.isIdle()) { 
                this.prev_location = null;
                this.stuck_time = 0;
                return; // don't get stuck when idle
            }
            const bot = agent.bot;
            const cur_dig_block = bot.targetDigBlock;
            if (cur_dig_block && !this.prev_dig_block) {
                this.prev_dig_block = cur_dig_block;
            }
            if (this.prev_location && this.prev_location.distanceTo(bot.entity.position) < this.distance && cur_dig_block == this.prev_dig_block) {
                this.stuck_time += (Date.now() - this.last_time) / 1000;
            }
            else {
                this.prev_location = bot.entity.position.clone();
                this.stuck_time = 0;
                this.prev_dig_block = null;
            }
            const max_stuck_time = cur_dig_block?.name === 'obsidian' ? this.max_stuck_time * 2 : this.max_stuck_time;
            if (this.stuck_time > max_stuck_time) {
                say(agent, 'I\'m stuck!');
                this.stuck_time = 0;
                const free_timeout_ms = this.free_timeout_ms;
                execute(this, agent, async () => {
                    // Upstream killed the process if this took over 10 s; on RotN terrain
                    // that is likely, and every restart is a full Forge relogin. Now the
                    // attempt is bounded, then the bot stops moving; execute() records the
                    // re-plan for the stuck action (A4).
                    const { outcome, error } = await moveAwayWithin(bot, 5, free_timeout_ms);
                    if (outcome === 'freed') {
                        say(agent, 'I\'m free.');
                        return;
                    }
                    try { bot.pathfinder.stop(); } catch (err) { reportModeError('unstuck', err); }
                    console.warn(outcome === 'timeout'
                        ? `[reflex] unstuck: still stuck after ${free_timeout_ms / 1000} s; re-planning instead of a restart.`
                        : `[reflex] unstuck: could not move away (${safeError(error)}); re-planning instead of a restart.`);
                    say(agent, 'I\'m still stuck.');
                });
            }
            this.last_time = Date.now();
        },
        unpause: function () {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
        }
    },
    // skills-rotn D2c: both modes follow rotn-data's threat table (threats.js threatPlan) instead
    // of fleeing or fighting anything with type 'mob'. cowardice flees what must not be fought
    // (a dangerous mob, one that explodes, a ranged one, two or more melee mobs at once);
    // self_defense fights only melee mobs, or a provoked enderman right after it hit the bot.
    {
        name: 'cowardice',
        description: 'Run away from mobs that must not be fought: dangerous ones, creepers, ranged ones, or several at once. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const plan = threats.threatPlan(agent.bot);
            if (plan?.action === 'flee' && await world.isClearPath(agent.bot, plan.from)) {
                say(agent, `Backing off: ${plan.from.name.replace("_", " ")} (${plan.why})!`);
                execute(this, agent, async () => {
                    await skills.avoidEnemies(agent.bot, plan.away, plan.isEnemy, (e) => threats.threatFor(e)?.reaction === 'fight');
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Fight nearby melee mobs (never creepers, endermen or dangerous mobs). Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const plan = threats.threatPlan(agent.bot);
            if (plan?.action === 'fight' && await world.isClearPath(agent.bot, plan.from)) {
                say(agent, `Fighting ${plan.from.name}!`);
                execute(this, agent, async () => {
                    await skills.defendSelf(agent.bot, 8, plan.isEnemy);
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, agent, async () => {
                        await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (agent) {
            const player = world.getNearestEntityWhere(agent.bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, agent, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(agent.bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (agent) {
            const entity = agent.bot.nearestEntity();
            // Never stare at a mob that attacks whoever looks at it (enderman and the like, rotn-data; D2c).
            let entity_in_view = entity && entity.position.distanceTo(agent.bot.entity.position) < 10 && !threats.doNotLook(entity);
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && mc.isBaby(entity);
                let height = isbaby ? entity.height/2 : entity.height;
                agent.bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    agent.bot.look(yaw, pitch, false);
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    }
];

// { outcome: 'freed' } if skills.moveAway finished within timeoutMs, { outcome: 'timeout' }
// if it did not, { outcome: 'failed', error } if it gave up first (no path, or anything else).
async function moveAwayWithin(bot, distance, timeoutMs) {
    let timer;
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve({ outcome: 'timeout' }), timeoutMs); });
    const moved = skills.moveAway(bot, distance).then(() => ({ outcome: 'freed' }), (error) => ({ outcome: 'failed', error }));
    try {
        return await Promise.race([moved, timedOut]);
    } finally {
        clearTimeout(timer);
    }
}

// Runs a mode's action. Mode update() functions call it without await, so it
// must never reject: errors are caught and reported here, and mode.active is
// always reset (skills-rotn A4). It no longer stops the self-prompt loop or
// prompts the LLM ("Respond accordingly") after each reflex; it records a
// re-plan request instead (replan.js), which the LLM hears at its next
// decision point.
export async function execute(mode, agent, func, timeout=-1) {
    let interrupted_action = '';
    mode.active = true;
    try {
        interrupted_action = agent.actions.currentActionLabel;
        let code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
            await func();
        }, { timeout });
        console.log(`Mode ${mode.name} finished executing, code_return: ${code_return.message}`);

        let should_replan =
            interrupted_action && // it interrupted a previous action
            !agent.actions.resume_func && // there is no resume function
            !code_return.interrupted; // this mode action was not interrupted by something else
        if (should_replan)
            requestReplan(agent, mode.name, interrupted_action);
    } catch (err) {
        reportModeError(mode.name, err);
    } finally {
        mode.active = false;
    }
}

// RotN (skills-rotn A2): the bot has no operator rights on the server, so a
// mode that sends op commands (/tp, /setblock) stays off whatever a profile,
// !setMode or generated code asks. isOn() is the one check skills.js makes
// before its /tp and /setblock branches, so those branches cannot run.
const DISABLED_MODES = {
    cheat: 'the bot has no operator rights on this server, so /tp and /setblock cannot work',
};

let _agent = null;
const reportModeError = createErrorReporter('modes');
const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

// Tests only: a mode object by name (modes.js keeps them module-private).
export function __modeForTest(name) {
    return modes_map[name];
}

// The one LLM call reflexes may cause (A4): when a reflex interrupted an action
// and the bot is not self-prompting (the self-prompter carries the note
// itself), send one coalesced re-plan prompt once things are quiet, at most
// once per MIN_GAP_MS (replan.js).
let last_replan_prompt_at = 0;
function maybePromptReplan(controller, now = Date.now()) {
    const agent = _agent;
    if (!agent?.replan) return; // nothing requested (the common case, every tick)
    const due = replanPromptDue(agent, {
        now,
        idle: agent.isIdle(),
        reflexActive: controller.anyActive(),
        selfPrompting: agent.self_prompter.isActive(),
        lastPromptAt: last_replan_prompt_at,
    });
    if (!due) return;
    last_replan_prompt_at = now;
    const note = takeReplanNote(agent);
    console.log(`[reflex] re-plan prompt: ${note}`);
    const role = convoManager.inConversation() ? agent.last_sender : 'system';
    Promise.resolve(agent.handleMessage(role, `(AUTO MESSAGE) ${note}`))
        .catch(err => reportModeError('replan prompt', err));
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor() {
        this.behavior_log = '';
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    // Returns false when the request is refused (a disabled mode turned on).
    setOn(mode_name, on) {
        if (on && this.isDisabled(mode_name)) {
            console.warn(`[no-cheat] Refused to turn on mode ${mode_name}: ${DISABLED_MODES[mode_name]}.`);
            return false;
        }
        modes_map[mode_name].on = on;
        return true;
    }

    isDisabled(mode_name) {
        return DISABLED_MODES[mode_name] != null;
    }

    disabledReason(mode_name) {
        return DISABLED_MODES[mode_name] ?? null;
    }

    isOn(mode_name) {
        if (this.isDisabled(mode_name)) return false;
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            if (this.isDisabled(mode.name)) continue; // not offered to the LLM
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            if (this.isDisabled(mode.name)) continue; // not offered to the LLM
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        if (_agent.isIdle()) {
            this.unPauseAll();
        }
        for (let mode of modes_list) {
            let interruptible = mode.interrupts.some(i => i === 'all') || mode.interrupts.some(i => i === _agent.actions.currentActionLabel);
            if (mode.on && !mode.paused && !mode.active && (_agent.isIdle() || interruptible)) {
                // One throwing mode must not stop the others or the update loop (skills-rotn A3).
                try {
                    await mode.update(_agent);
                } catch (err) {
                    mode.active = false;
                    reportModeError(mode.name, err);
                }
            }
            if (mode.active) break;
        }
        maybePromptReplan(this);
    }

    anyActive() {
        return modes_list.some(mode => mode.active);
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                if (json[mode.name] && this.isDisabled(mode.name)) {
                    // e.g. profiles/defaults/god_mode.json sets cheat: true
                    console.warn(`[no-cheat] Loaded modes (profile or saved state) set ${mode.name}: true; ignored (${DISABLED_MODES[mode.name]}).`);
                    continue;
                }
                mode.on = json[mode.name];
            }
        }
    }
}

export function initModes(agent) {
    _agent = agent;
    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController();
    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }
    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }
}
