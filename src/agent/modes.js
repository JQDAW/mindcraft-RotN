import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';
import * as names112 from './library/names112.js';
import * as threats from './library/threats.js';
import * as food from './library/food.js';
import { standsOnTree, isLethal, hazardOf } from './library/fall_safety.js';
import { REPAIR_LABEL, nightPhase, minutesToSunset } from './library/night.js';
import { RESERVE_LEAD_MIN } from './agenda.js';
import { huntTarget, knownBases, huntAnimal } from './library/hunting.js';
import { isFalling } from './library/shelter.js';
import { fallingTreeNear } from './library/felling.js';

/**
 * A falling block at the head in the night shelter (#346 review 1): dig it out by hand and stay, but
 * wait settleMs after each dig and look again (a falling column lands one block after another); leave
 * after maxDigs digs within windowMs, or below minHealth (it suffocates meanwhile).
 */
export const HEAD_DIG = { settleMs: 300, maxDigs: 3, windowMs: 10_000, minHealth: 6 };
import { createErrorReporter } from './update_loop.js';
import { safeError } from './safe_error.js';
import { requestReplan, replanPromptDue, takeReplanNote } from './replan.js';
import { mayRepeat, handedToChat } from './chat_repeat.js';
import { fleeLine, mobName } from './library/survival_log.js';

/**
 * G4 #7 (the soak): the most of the behavior log kept between two LLM messages. It is flushed only
 * when a message is handled (agent.handleMessage, which reads its last 500 chars), so a bot on
 * hold, in its night shelter or with nothing to do grew it by every reflex line, for hours.
 */
export const BEHAVIOR_LOG_MAX = 2000;

async function say(agent, message) {
    const modes = agent.bot.modes;
    modes.behavior_log += message + '\n';
    if (modes.behavior_log.length > BEHAVIOR_LOG_MAX) modes.behavior_log = modes.behavior_log.slice(-BEHAVIOR_LOG_MAX);
    if (agent.shut_up || !settings.narrate_behavior) return;
    // No chat-spam loop (lead, after G3 round 9): an identical reflex line at most once a minute.
    if (!mayRepeat(agent, message, { tag: '[reflex]' })) return;
    handedToChat(agent, message); // counts as said once the chat limit sends it (#344 review 1)
    // Reflex narration is low priority for the chat limit: dropped when chat is busy (G3 round 4 C+D).
    agent.openChat(message, { priority: 'low' });
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

/**
 * Modes that would walk, dig or light the bot out of its night shelter (D2b-2). They are quiet while
 * the night routine has it sheltered (bot.rotnSheltered true). When a wall is open
 * (bot.rotnSheltered 'open') self_defense acts again, so the bot fights at the opening: from where it
 * stands, only mobs within reach, and never while the night's repair runs (G3 round 9 B).
 * self_preservation (fire, lava, a falling block on its head) always acts.
 */
export const SHELTER_QUIET_MODES = ['cowardice', 'self_defense', 'hunting', 'item_collecting', 'torch_placing', 'elbow_room', 'unstuck'];
export function shelterQuiet(name, bot) {
    let sheltered = false;
    try { sheltered = bot?.rotnSheltered ?? false; } catch { return false; } // the loop must survive any bot (A3)
    if (sheltered === true) return SHELTER_QUIET_MODES.includes(name);
    if (sheltered === 'open') return name !== 'self_defense' && SHELTER_QUIET_MODES.includes(name);
    return false;
}

/** A mob in reach is named in chat at most this often from the shelter (T1: up to 24 lines a minute). */
export const SHELTER_SAY_MS = 30_000;
let shelterSaidAt = -Infinity;

/**
 * The night routine's own work, which the in-shelter fight and eating never interrupt: the repair
 * (REPAIR_LABEL), and (#355 review 1) the routine's job (the build or hole dig) that leaves a deadly
 * shelter with a mob near (agent._night.leaveFrom), while it runs: fighting or eating then keeps
 * the bot in a cell that drowns, suffocates or burns it. Between tries (no job, #355 re-review) the
 * bot fights in place and eats as in any shelter: cowardice and the flee are quiet there too.
 */
/**
 * The time of day to judge by: the night routine's NightClock (it knows a frozen time and falls
 * back to the wall clock, #422 review 7), else the server's value; null when unknown.
 */
function timeOfDayFor(agent, now = Date.now()) {
    const fromClock = agent._night?.clock?.timeOfDay?.(now);
    if (Number.isFinite(fromClock)) return fromClock;
    const t = agent.bot?.time?.timeOfDay;
    return Number.isFinite(t) ? t : null;
}

/** G4 #5: the food reserve's rule (food.foodShortfall) says the bot is short of food now. */
export function foodDue(agent) {
    const bot = agent.bot;
    const t = timeOfDayFor(agent);
    return food.foodShortfall({ food: bot?.food, held: food.heldFoodHunger(bot), minutesToSunset: t === null ? Infinity : minutesToSunset(t),
        finished: !!agent.agenda?.finished, reserveLeadMin: RESERVE_LEAD_MIN }) !== null;
}

/** Full daylight by the freeze-aware clock (not dusk, not night). */
const isDaylight = (agent) => { const t = timeOfDayFor(agent); return t !== null && nightPhase(t) === 'day'; };

function nightRoutineBusy(agent) {
    return agent.actions.currentActionLabel === REPAIR_LABEL || (!!agent._night?.leaveFrom && !!agent._night?.job);
}

/**
 * The fight from inside the night shelter (G3 round 9 B; #331 review 1-4): never while the night's
 * repair runs, nor within SHELTER_FIGHT.restMs after the last such fight (the night routine checks
 * and repairs first); else the nearest hostile mob in reach (threats.shelterEnemy, whatever the
 * plan says) is hit in place for as long as one is in reach, capped. Returns whether it started.
 */
function fightInShelter(mode, agent, { override = false } = {}) {
    const bot = agent.bot;
    if (nightRoutineBusy(agent)) return false;
    if (Date.now() - (bot.rotnFightEndedAt ?? -Infinity) < skills.SHELTER_FIGHT.restMs) return false;
    const target = world.getNearestEntityWhere(bot, (e) => threats.shelterEnemy(e) && skills.inShelterReach(bot, e), skills.SHELTER_FIGHT.reach + 1);
    if (!target) return false;
    if (!claimThreat(mode.name, Date.now(), { override })) return false;
    if (Date.now() - shelterSaidAt >= SHELTER_SAY_MS) {
        shelterSaidAt = Date.now();
        Promise.resolve(say(agent, `Fighting ${target.name} from the shelter!`)).catch(err => reportModeError(mode.name, err));
    }
    execute(mode, agent, async () => {
        await skills.defendInPlace(bot, threats.shelterEnemy);
        // CX23 soak: between fights, hurt and too hungry to heal (food below REGEN_FOOD): eat.
        if (!bot.interrupt_code) {
            const ate = await food.eatToHeal(bot);
            if (ate?.ate) console.log(`[reflex] ate between fights in the shelter (health ${bot.health}, food ${ate.before} -> ${bot.food})`);
        }
    }).catch(err => reportModeError(mode.name, err));
    return true;
}

/**
 * Low health in the night shelter (the lead's decision after G3 round 9 B): no flee out into the
 * night. While the night's repair runs, nothing (it closes the opening). Else a mob within reach is
 * hit from where the bot stands; else, hungry with food held, the bot eats.
 */
function holdInShelter(mode, agent) {
    const bot = agent.bot;
    if (fightInShelter(mode, agent, { override: true })) return;
    if (nightRoutineBusy(agent)) return;
    const item = Number.isFinite(bot.food) && bot.food < 20 ? food.chooseFood(bot) : null;
    if (!item) return;
    execute(mode, agent, async () => {
        const r = await food.eatFood(bot, item);
        console.log(`[reflex] hurt in the shelter: ${r.ate ? 'ate' : 'could not eat'} ${food.foodKey(item)} (health ${bot.health}, food ${r.before})`);
    }).catch(err => reportModeError(mode.name, err));
}

/**
 * One owner per threat (G3 round 2 batch A: self_preservation and self_defense kept interrupting
 * each other while a Grove Sprite attacked; each switch stopped the other action, so the bot
 * neither fled nor fought, and died). A threat mode (cowardice, self_defense) claims the threat
 * when it acts and holds it for THREAT_HOLD_MS while its action runs: in that time no other
 * threat mode starts or interrupts it; the owner may act again, which renews the hold.
 * The low-health flee (self_preservation) overrides the hold at once (#227 review 2); the
 * lower modes respect its hold. The hold ends when the owner's action ends or fails (review 3),
 * so a flee with no path does not leave the bot doing nothing while hurt.
 * Hazards (fire, lava, a falling block, drowning) are not threats here: they always act.
 */
export const THREAT_HOLD_MS = 6000;
const threatLease = { owner: null, until: 0 };

/**
 * Claim the threat for this mode, or false when another threat mode holds it.
 * override: the low-health flee, which takes the threat from any lower mode at once.
 */
export function claimThreat(modeName, now = Date.now(), { override = false } = {}) {
    if (!override && threatLease.owner && threatLease.owner !== modeName && now < threatLease.until) return false;
    threatLease.owner = modeName;
    threatLease.until = now + THREAT_HOLD_MS;
    return true;
}

/** The owner's action ended or failed: the threat is free again (#227 review 3). */
export function releaseThreat(modeName) {
    if (threatLease.owner === modeName) {
        threatLease.owner = null;
        threatLease.until = 0;
    }
}

/** Tests only. */
export function __resetThreatLease() {
    threatLease.owner = null;
    threatLease.until = 0;
}

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
                    // The lead's decision after #331: in the night shelter, sand or gravel at the head is
                    // dug out by hand (no tool needed) and the bot stays; it leaves only when the dig
                    // fails, since it would suffocate.
                    if (bot.rotnSheltered) {
                        const head = bot.entity.position.floored().offset(0, 1, 0);
                        // rotn-data's gravity first (#346 nit: modded falling blocks; not sandstone).
                        const falling = (b) => !!b && b.name !== 'air' && (isFalling(b) || this.fall_blocks.some(name => b.name?.includes(name)));
                        let why = null;
                        for (;;) {
                            const recent = (bot.rotnHeadDigs ?? []).filter(at => Date.now() - at < HEAD_DIG.windowMs);
                            bot.rotnHeadDigs = recent;
                            if (recent.length >= HEAD_DIG.maxDigs) { why = `${recent.length} digs in ${HEAD_DIG.windowMs / 1000} s and it keeps falling`; break; }
                            if ((bot.health ?? 20) < HEAD_DIG.minHealth) { why = `health ${bot.health}`; break; }
                            let dug = false;
                            try { dug = await skills.breakBlockAt(bot, head.x, head.y, head.z); } catch { dug = false; }
                            recent.push(Date.now());
                            if (!dug) { why = 'the dig failed'; break; }
                            await new Promise(resolve => setTimeout(resolve, HEAD_DIG.settleMs)); // the next block of a column lands
                            if (bot.interrupt_code) return;
                            if (!falling(bot.blockAt(head))) {
                                console.log(`[reflex] dug ${blockAbove.name} out of the shelter's head space; staying in`);
                                return;
                            }
                        }
                        console.warn(`[reflex] ${blockAbove.name} at the head in the shelter (${why}); getting out`);
                    }
                    await skills.moveAway(bot, 2);
                });
            }
            // Molten metal (a modded fluid with forge.hazard 'lava', #259) is lethal like lava, and
            // a modded fire block (forge.hazard 'fire': 14 on 3.3.4) burns like fire (#264 review 3).
            else if (names112.isLava(block.name) || block.name === 'fire' ||
                names112.isLava(blockAbove.name) || blockAbove.name === 'fire' ||
                isLethal(bot, block) || isLethal(bot, blockAbove) ||
                hazardOf(bot, block) === 'fire' || hazardOf(bot, blockAbove) === 'fire') {
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
            else if (bot.health > 0 && bot.isAlive !== false // not while dead (it fled from the death hit)
                && Date.now() - bot.lastDamageTime < 3000 && (bot.health < 5 || bot.lastDamageTaken >= bot.health)) {
                // The lead's decision after G3 round 9 B: in the night shelter (closed or open) the bot
                // stays: the repair goes on, else it hits what is in reach in place, else it eats. It
                // leaves only for the hazards above (fire, lava, drowning, a falling block).
                if (bot.rotnSheltered) {
                    holdInShelter(this, agent);
                    return;
                }
                claimThreat(this.name, Date.now(), { override: true }); // the low-health flee wins at once (#227 review 2)
                // G4 #5: the journal's flee line names the nearest hostile mob, when one is near.
                const near = world.getNearestEntityWhere(bot, (e) => threats.shelterEnemy(e), 16);
                console.log(fleeLine(near ? mobName(near) : 'unknown', `low health ${Math.round(bot.health * 10) / 10}`));
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
        // D1: RotN foods by rotn-data (mineflayer-auto-eat sees only vanilla foods and eats the bread
        // first; it is off, agent.js). Before cowardice and self_defense in this list, so the bot
        // can eat at food 6 or lower in a fight: the loop stops at the first active mode (#206 review 4).
        name: 'eating',
        description: 'Eat at food 12 or lower when idle and no threat is near, and at 6 or lower always, in a fight too. Never hawthorn berries or cloudsbluff; bread only when nothing else is left.',
        interrupts: ['all'],
        on: true,
        active: false,
        miss_ms: 30_000, // no safe food: look again after this
        backoff_ms: 10_000, // after an eat that did not happen: 10 s, then 20 s
        max_fails: 3, // a food that fails this often is not tried again
        check_ms: food.CONSUME_CHECK_MS, // after a consume that threw, judge the eat this long later
        wait_until: -Infinity,
        fails: {},
        given_up: new Set(),
        update: function (agent) {
            const bot = agent.bot;
            if (Date.now() < this.wait_until) return;
            let threatened = false;
            try { threatened = !!threats.threatPlan(bot); } catch { threatened = false; }
            if (!food.wantsToEat(bot.food, { idle: agent.isIdle(), threatened })) return;
            const item = food.chooseFood(bot, { skip: this.given_up });
            if (!item) {
                this.wait_until = Date.now() + this.miss_ms;
                console.warn(`[reflex] eating: food ${bot.food}, but no safe food in the inventory`);
                return;
            }
            const key = food.foodKey(item);
            // Not awaited, so the update loop is not held up by the eat (execute never rejects).
            execute(this, agent, async () => {
                const r = await food.eatFood(bot, item, { checkMs: this.check_ms });
                if (r.ate) {
                    delete this.fails[key];
                    console.log(`[reflex] ate ${key} at food ${r.before}${r.threw ? ' (the eat timed out, but it went through)' : ''}`);
                    return;
                }
                const n = this.fails[key] = (this.fails[key] ?? 0) + 1;
                if (n >= this.max_fails) {
                    this.given_up.add(key);
                    console.warn(`[reflex] eating: ${key} could not be eaten ${n} times; not trying it again`);
                } else {
                    this.wait_until = Date.now() + this.backoff_ms * 2 ** (n - 1);
                    console.warn(`[reflex] eating: ${key} was not eaten (${r.threw?.message ?? 'no change'}); trying again in ${this.backoff_ms * 2 ** (n - 1) / 1000} s`);
                }
            }).catch(err => reportModeError('eating', err));
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
            // A skill that keeps the bot in place on purpose sets bot.rotnStationary while it does
            // (D2b: the shelter build, once at the site; not the walk there, #195 review 6).
            if (agent.isIdle() || agent.bot?.rotnStationary === true) {
                this.prev_location = null;
                this.stuck_time = 0;
                return; // don't get stuck when idle
            }
            // A tree falling near the bot (G3 round 10 A: this reflex walked the bot from where it
            // waited out its own cut into the fall, and it was crushed): hold still until it is down.
            if (fallingTreeNear(agent.bot)) {
                this.prev_location = null;
                this.stuck_time = 0;
                return;
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
                if (!claimThreat(this.name)) return; // checked after the await: another mode may own it now
                console.log(fleeLine(mobName(plan.from), plan.why)); // G4 #5
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
            // G3 round 9 B: in the shelter with a wall open, self_defense interrupted the repair and
            // defendSelf walked out after the zombie (pvp.attack follows its target); the bot died
            // outside. Now the repair runs on, and the fight is in place, at mobs within reach.
            // #331 review 1 and 2: in the shelter any hostile mob in reach is hit, whatever the plan
            // says (two zombies, a skeleton or a creeper near make it 'flee'), for as long as one is
            // in reach (capped, review 3).
            if (agent.bot.rotnSheltered) {
                fightInShelter(this, agent);
                return;
            }
            const plan = threats.threatPlan(agent.bot);
            if (plan?.action === 'fight' && await world.isClearPath(agent.bot, plan.from)) {
                if (!claimThreat(this.name)) return; // checked after the await: another mode may own it now
                say(agent, `Fighting ${plan.from.name}!`);
                execute(this, agent, async () => {
                    // defendSelf pauses cowardice, so the plan is checked each round: a creeper or more
                    // mobs arriving end the fight, and the bot backs off (#186 review).
                    await skills.defendSelf(agent.bot, 8, plan.isEnemy, () => threats.threatPlan(agent.bot)?.action === 'fight');
                    const next = threats.threatPlan(agent.bot);
                    if (next?.action === 'flee') {
                        console.log(fleeLine(mobName(next.from), next.why)); // G4 #5
                        await say(agent, `Backing off: ${next.from.name.replace("_", " ")} (${next.why})!`);
                        await skills.avoidEnemies(agent.bot, next.away, next.isEnemy, (e) => threats.threatFor(e)?.reaction === 'fight');
                    }
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt a wild animal for food when food is short, by day, with no threat near, when idle. Never one that may belong to a player.',
        // #422 review 6: it never interrupts anything (a giver's follow included): only when idle.
        interrupts: [],
        on: true,
        active: false,
        skipped_said: '',
        update: async function (agent) {
            // G4 #5 (CX23 soak m1: food fell to 1, nothing got food): only when the food reserve is
            // due (food.foodShortfall), in full daylight, with no threat near, idle, not sheltered;
            // never an animal that may belong to a player (hunting.js, the lead's hard rule).
            const bot = agent.bot;
            if (!foodDue(agent) || bot.rotnSheltered || !agent.isIdle()) return;
            if (!isDaylight(agent)) return;
            let threatened = true;
            try { threatened = !!threats.threatPlan(bot); } catch { threatened = true; }
            if (threatened) return;
            const skipped = [];
            const target = huntTarget(bot, { bases: knownBases(agent), skipped });
            const said = skipped.join('; ');
            if (said && said !== this.skipped_said) console.log(`[reflex] hunting: left alone, it may belong to a player: ${said}`);
            this.skipped_said = said;
            if (!target || !await world.isClearPath(bot, target)) return;
            execute(this, agent, async () => {
                say(agent, `Hunting ${target.name} for food!`);
                // #422 review 1: bounded (HUNT.maxMs), and over once the day is (dusk) or a threat comes.
                const keepGoing = () => { if (!isDaylight(agent)) return false; try { return !threats.threatPlan(bot); } catch { return false; } };
                const end = await huntAnimal(bot, target, { keepGoing, equip: (b) => skills.equipHighestAttack(b) });
                console.log(`[reflex] hunting ${target.name}: ${end}`);
            });
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
            // No random looks either while a do-not-look mob is loaded nearby: one could land on it (#186 review).
            if (Date.now() > this.next_change && !threats.doNotLookNear(agent.bot)) {
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
export async function moveAwayWithin(bot, distance, timeoutMs) {
    let timer;
    // #415 review 1: the climb down has its own run token, aborted at the timeout, so its dig
    // (digDownThroughLeaves) ends with the reflex instead of running on beside the next action.
    const run = { aborted: false };
    const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => {
            run.aborted = true;
            try { bot.stopDigging?.(); } catch { /* best effort */ }
            resolve({ outcome: 'timeout' });
        }, timeoutMs);
    });
    // Stuck up on a tree (G3 round 4 B: the bot fell to its death 3 s after this reflex took over
    // in a tree): climb down to firm ground, no drop over 3 blocks, instead of a walk in any direction.
    // Every walk away is fall-safe too (skills.goToGoal).
    const free = standsOnTree(bot)
        ? skills.descendFromTree(bot, run).then((down) => { if (!down) throw new Error('no safe way down from the tree'); })
        : skills.moveAway(bot, distance);
    const moved = free.then(() => ({ outcome: 'freed' }), (error) => ({ outcome: 'failed', error }));
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
        releaseThreat(mode.name); // the hold ends with the owner's action (#227 review 3)
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
            if (shelterQuiet(mode.name, _agent.bot)) continue; // D2b-2: inside a closed night shelter
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

/** For tests: the reflexes' chat line. */
export { say as __sayForTest };
