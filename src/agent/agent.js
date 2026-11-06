import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { TaskQueue, isTaskGiver, markUntrusted } from './task_queue.js';
import { Agenda } from './agenda.js';
import { Control } from './control.js';
import { autonomyTick } from './priority.js';
import { autoEatBannedFood } from './library/food.js';
import { resetNight } from './night_routine.js';
import { hordeWarning, JumpWatch } from './library/hazard_watch.js';
import { requestReplan } from './replan.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import { safeError, safeStack } from './safe_error.js';
import { runUpdateLoop, createErrorReporter } from './update_loop.js';
import { bindDeathReport, deathCauseText } from './library/death_report.js';
import { installChatLimit, withChatPriority } from './chat_limit.js';
import { installWalkSafety } from './library/fall_safety.js';

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);
        
        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(3); // fatal: a restart cannot fix the name (ADR 0003 decision 5)
            return;
        }
        
        this.history = new History(this);
        this.tasks = new TaskQueue(this.name); // player tasks, ./bots/<name>/tasks.json (E1)
        this.agenda = new Agenda(this.name); // the RotN agenda, ./bots/<name>/agenda.json (E2)
        this.control = new Control(this.name); // a giver's !stop/!pause/!stfu hold, ./bots/<name>/control.json (E3)
        this.shut_up = this.control.hold?.kind === 'quiet';
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        // The outgoing chat limit (G3 round 4 C+D: kicked for spam): every packet goes through it.
        installChatLimit(this.bot);
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { type } = handleDisconnection(this.name, reason);
     
            // The kick's exit code (3 for fatal, else 1), with the reason for the main process.
            process.exit(this.bot?.forge?.recordExit?.({ event, reason }) ?? 1);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 onDisconnect('Error', safeError(err)); // a safe string, never the whole error
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${safeError(err)}`);
            }
        });

        initModes(this);

        this.bindLoginHandler();
		const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            process.exit(1);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', () => this.onSpawn({ spawnTimeout, save_data, init_message, load_mem, count_id }));
    }

    // The bot's first spawn: upstream's spawn handler, as a method so a test can run it (#174 nit 5).
    async onSpawn({ spawnTimeout, save_data, init_message, load_mem, count_id }) {
        try {
            clearTimeout(spawnTimeout);
            addBrowserViewer(this.bot, count_id);
            console.log('Initializing vision intepreter...');
            this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

            // wait for a bit so stats are not undefined
            await new Promise((resolve) => setTimeout(resolve, 1000));
            
            console.log(`${this.name} spawned.`);
            this.clearBotLogs();
          
            this._setupEventHandlers(save_data, init_message);
            this.startEvents();
          
            if (!load_mem) {
                if (this.task.data) { // a loaded task; a refused task file is null (task_guard.js)
                    this.task.initBotTask();
                    this.task.setAgentGoal();
                }
            } else {
                // set the goal without initializing the rest of the task
                if (this.task.data) { // a loaded task; a refused task file is null (task_guard.js)
                    this.task.setAgentGoal();
                }
            }

            this.autostartAgenda();

            await new Promise((resolve) => setTimeout(resolve, 10000));
            this.checkAllPlayersPresent();

        } catch (error) {
            console.error('Error in spawn event:', safeStack(error));
            process.exit(this.bot?.forge?.recordExit?.({ error }) ?? 1); // 1, or 3 if fatal; never 0
        }
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                // Quiet only while a giver's !stfu holds (E3): a new message no longer undoes it.
                this.shut_up = this.control?.hold?.kind === 'quiet';

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', safeStack(error));
            }
        }

		this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);
        
        this.bot.on('chat', (username, message) => {
            if (serverProxy.getNumOtherAgents() > 0) return;
            // only respond to open chat messages when there are no other agents
            respondFunc(username, message);
        });

        // Set up auto-eat. It stays off: the 'eating' mode eats by rotn-data's pack food values and
        // by meta (skills-rotn D1). Should anything turn it on, its bans come from rotn-data's
        // avoidFood, by name, as it cannot see a meta (all of `fish`, for the pufferfish fish:3).
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 12,
            bannedFood: autoEatBannedFood(),
        };
        this.bot.autoEat.disable?.();

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am "+this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
        this.bot.pathfinder.stop();
        this.bot.pvp.stop();
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);
        // A player who is not a task giver may chat, but nothing they say makes the bot act (Request 11).
        const untrusted_sender = !self_prompt && !from_other_bot && !this.isTaskGiver(source);

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            const user_command_name = containsCommand(message);
            if (user_command_name) {
                // Lead decision (Request 11): only task givers may make the bot run a command by
                // typing it. Others may still chat, but nothing they type runs.
                if (!this.isTaskGiver(source)) {
                    // High priority, at most one waiting per sender (chat_limit.js, #256 review 1).
                    this.routeResponse(source, `Sorry ${source}, I only run commands from task givers.`, { priority: 'high', key: `refusal:${source}` });
                    return false;
                }
                if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
                // The sender travels with this one call (task commands read it; #146 review).
                // A giver's typed action is a control command: tasks and the agenda wait while it
                // runs (E3), so "come" is not cut short by the self-prompter's next command.
                const typed_action = isAction(user_command_name);
                if (typed_action) this.control?.beginTyped();
                let execute_res;
                try {
                    execute_res = await executeCommand(this, message, { sender: source });
                } finally {
                    if (typed_action) this.control?.endTyped();
                }
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages. A non-giver's words are kept as marked, quoted data (E3).
        const untrusted = { untrusted: untrusted_sender }; // every turn of this exchange (#174 review 1)
        await this.history.add(source, untrusted_sender ? markUntrusted(source, message) : message, untrusted);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                // A reply to a non-giver that asks for an action is not run, and it is not kept as the
                // bot's own words either, so a later self-prompt cannot repeat it (#174 review 2).
                const refused = untrusted_sender && commandExists(command_name) && isAction(command_name);
                if (!refused)
                    this.history.add(this.name, res, untrusted);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`, untrusted);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                if (refused) {
                    // Questions (queries) are answered; actions are not run for a non-giver.
                    this.history.add('system', `${command_name} was not run: ${source} is not a task giver, so only questions are answered for them.`, untrusted);
                    this.routeResponse(source, `Sorry ${source}, I only do things for task givers.`, { priority: 'high', key: `refusal:${source}` });
                    break;
                }
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                let execute_res = await executeCommand(this, res);

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                if (execute_res)
                    this.history.add('system', execute_res, untrusted);
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res, untrusted);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message, { priority = null, key = null } = {}) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        // The chat limit's priority (chat_limit.js, G3 round 4 C+D): a reply to a task giver goes
        // first and is never dropped; other replies wait their turn. Refusals pass 'high' and a key.
        priority ??= self_prompt ? 'normal' : (this.isTaskGiver?.(to_player) ? 'high' : 'normal');
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat, with the chat limit's priority
            this.openChat(message, { priority, key });
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message, { priority = 'normal', key = null } = {}) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                withChatPriority(this.bot, priority, () => this.bot.whisper(username, message), key);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) withChatPriority(this.bot, priority, () => this.bot.chat(message), key);
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', safeError(err));
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        // D3: one death report per death (loss diff, rate-limited chat, respawn retry, re-plan note).
        bindDeathReport(this);
        // Every walk keeps to falls of 3 at most, never breaks a branch, and keeps out of liquids
        // and hazards, whoever sets the pathfinder's movements (fall_safety.js; #259).
        installWalkSafety(this.bot);
        this.bot.on('death', () => {
            this.actions.cancelResume();
            this.actions.stop();
        });
        this.bindNightReset();
        this.bindTeleportWatch();
        this.bindHordeWatch();
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            // D3: the server's death message only names the cause in the death report. The upstream
            // LLM prompt per death is gone (a chat-spam loop risk); bindDeathReport reports once.
            // A modded death message arrives untranslated, as its key (G3 round 3 B: "crushed by a
            // falling tree" never reached the report): deathCauseText checks the arguments too.
            const cause = deathCauseText(this.name, message, jsonMsg);
            if (cause) this._death?.cause(cause);
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this.actions.resumeAction();
                }
            }, 1000);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval.
        // A throwing update is logged (rate-limited) and the loop carries on (skills-rotn A3).
        const INTERVAL = 300;
        const reportUpdateError = createErrorReporter('update');
        setTimeout(async () => {
            await runUpdateLoop((delta) => this.update(delta), {
                interval: INTERVAL,
                onError: (err) => reportUpdateError('agent update', err),
            });
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        autonomyTick(this); // control holds > tasks > agenda; no LLM call (E2, E3)
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    // The one 'login' listener (A3/A4b; a test emits 'login' on a fake bot).
    // Not sheltered any more after a death, or after a spawn (mineflayer emits 'spawn' again after
    // a respawn, and the bot is elsewhere) (#204 review 6).
    bindNightReset() {
        this.bot.on('death', () => { resetNight(this, 'death'); this._jumpWatch?.reset(); });
        this.bot.on('spawn', () => { resetNight(this, 'spawn'); this._jumpWatch?.reset(); });
    }

    // D1b: a teleport (AggroTP) is a server position packet, after which mineflayer emits
    // 'forcedMove'. Measured against the position at the last physics tick, so the bot's own
    // walking never counts (#212 review 3). A jump of 5 or more blocks stops the running action
    // and asks for a re-plan (no LLM call now).
    // Not a teleport (#212 re-review): a respawn or a dimension change (mineflayer's 'respawn'; the
    // position packet that follows comes while isAlive is false), or a ride (physics stops on
    // mount, and the dismount position packet can come after bot.vehicle clears).
    bindTeleportWatch() {
        const w = this._jumpWatch = new JumpWatch();
        const dead = () => this.bot.isAlive === false || !(this.bot.health > 0);
        this.bot.on('physicsTick', () => { if (dead()) w.reset(); else w.sample(this.bot.entity?.position); });
        for (const ev of ['respawn', 'mount', 'dismount']) this.bot.on(ev, () => w.reset());
        this.bot.on('forcedMove', () => {
            if (dead()) { w.reset(); return; }
            const jump = w.forced(this.bot.entity?.position, { riding: !!this.bot.vehicle });
            if (jump) this.onTeleport(jump);
        });
    }

    onTeleport(jump) {
        const at = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
        const label = this.actions?.currentActionLabel || '';
        console.log(`[reflex] teleported ${jump.blocks.toFixed(1)} blocks (${at(jump.from)} -> ${at(jump.to)}); re-planning`);
        try { this.bot.pathfinder?.stop?.(); } catch (err) { console.warn(`[reflex] teleport: ${safeError(err)}`); }
        if (label) Promise.resolve(this.actions.stop?.()).catch(err => console.warn(`[reflex] teleport: ${safeError(err)}`));
        requestReplan(this, 'teleport', label);
    }

    // D1b: the hordes mod's wave warning (lang key message.hordes.EventStart) asks for a re-plan; at
    // night the bot is in its shelter anyway. At most once a minute. The mod sends it on the Forge
    // channel hordes_hordeevent (#212 review 1); forge-bridge emits it as 'rotn:horde' (#214). A
    // vanilla title carrying the key is the fallback.
    onHordeMessage(keyOrComponent, { now = Date.now(), via = 'forge' } = {}) {
        const w = hordeWarning(keyOrComponent);
        if (!w) return false;
        if (now - (this._horde_warned_at ?? -Infinity) < 60_000) return false;
        this._horde_warned_at = now;
        console.log(`[reflex] horde warning (${w.key}, by ${via}): re-planning`);
        requestReplan(this, 'horde_warning', this.actions?.currentActionLabel || '');
        return true;
    }

    bindHordeWatch({ now = () => Date.now() } = {}) {
        // forge-bridge (#214) decodes hordes_hordeevent: {kind: 'start'|'end'|'message', key} or
        // {kind: 'wave', ...} (no key, ignored). hordeWarning keeps EventStart only.
        this.bot.on('rotn:horde', (ev) => {
            if (typeof ev?.key === 'string') this.onHordeMessage(ev.key, { now: now(), via: 'forge' });
        });
        // Fallback: a vanilla 1.12 title packet carrying the key (mineflayer's 'title' event drops keys).
        this.bot._client?.on('title', (packet) => {
            if (packet?.action !== 0 && packet?.action !== 1) return;
            this.onHordeMessage(packet.text, { now: now(), via: 'title' });
        });
    }

    bindLoginHandler() {
        this.bot.on('login', () => this.onLogin());
    }

    /**
     * The RotN agenda starts by itself on a fresh bot (E2; harness-ops' G3 driver proposal).
     * With an agenda.json it is left as saved: active resumes, while a giver's !agendaStop,
     * a stuck step or "agenda done" survive a restart (#164 review). Returns whether it started.
     */
    autostartAgenda() {
        if (this.task?.data || settings.agenda_autostart === false || this.agenda.existed) return false;
        this.agenda.start();
        return true;
    }

    /**
     * Whether a sender is a task giver (Request 11, #146 review). "Server" counts only for a
     * console whisper (no online player of that name) with the test-only setting on.
     */
    isTaskGiver(name) {
        const fromConsole = typeof name === 'string' && !this.bot?.players?.[name];
        return isTaskGiver(name, settings, { fromConsole });
    }

    // Called on the bot's 'login' event. Upstream also sent "/skin set ..." or
    // "/skin clear" here (Fabric Tailor); RotN is Forge and has no such command,
    // so nothing is sent to the server chat (skills-rotn A3).
    onLogin({ proxy = serverProxy } = {}) {
        console.log(this.name, 'logged in!');
        proxy.login();
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
        this.history.save();
        // Exit 1 here is a deliberate restart (requested_restart). If the Minecraft
        // connection is already gone, recordExit reports the disconnect or kick instead.
        process.exit(code === 1 ? (this.bot?.forge?.recordExit?.({ requestedRestart: true }) ?? code) : code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
