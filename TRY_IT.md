# Try it: playing with FRCFLD

FRCFLD is an AI player on your Rebirth of the Night (RotN 3.3.4) server. It plays the early game on its own and does what you ask. This page is for you as a player: how to talk to it, what to type, what it does by itself, its limits, how to stop it, and what it costs.

> **Draft for G4 step 7.** The human reviews the wording then. The behaviour is marked **seen live** (in the G3 gate runs on test servers) or **built, not yet seen live** (its G4 run on the CX23 is still to come). The hourly cost is **TBD** until the 2-hour soak measures it.

<!--
Sources (harness-ops, 2026-11-08). Behaviour: src/agent/agent.js (respondFunc, handleMessage: typed commands, refusals,
"full response"), src/agent/chat_sender.js (#400: who sent a line), src/agent/commands/actions.js and queries.js (the
commands), src/agent/control.js (holds, control.json), src/agent/priority.js (the priority stack, task budget),
src/agent/task_queue.js (task lines), src/agent/agenda.js and agenda_driver.js (the agenda), src/agent/night_routine.js
(nights), src/agent/library/death_report.js (deaths: the chat lines, DROPS_LAST_MIN from corpsecomplex.cfg's Drop Despawn Timer
600, the Zombie Players zombie), src/agent/chat_limit.js (the chat limit), packages/forge-bridge/src/kicks.js and
exit-contract.js (fatal exits: 3), src/agent/modes.js (reflexes, not gated by a hold), settings.js
(task_givers, only_chat_with, allow_insecure_coding, show_command_syntax). Service: deploy/cx23/README.md,
deploy/cx23/mindcraft-rotn-ctl.sh, deploy/cx23/mindcraft-rotn@.service, deploy/cx23/mindcraft-rotn-ssh-gate.sh (ADR 0009).
Evidence: test/evidence/g3/g3a-20261107-gate (agenda), g3b-20261108-gate2 (first night), g3c-20261108-gate2 (a task
interrupts the agenda; the giver there was the test-only console giver), g3d-20261107-gate (an untrusted player refused).
G4 (follow, come, stop by JQDAW; death report; soak; second bot): test/scenarios/g4/, not run yet.
-->

## Talking to it

- **Public chat or a whisper.** Type in chat (`T`), for example `FRCFLD, what are you doing?`, or whisper it with `/tell FRCFLD ...` (`/msg` and `/w` are the same). It answers in public chat either way.
- **Only real chat counts.** It takes a line only from a player's own chat or a whisper. `/say`, `/me`, `/tellraw`, command blocks and mod broadcasts are never read as anyone's message, so `[Server] JQDAW: !stop` is not you.
- **Only you give orders.** The task givers are `["JQDAW"]` (`settings.js`); changing that needs a new release from the lead.
- **It reads every public chat line on the server, from anyone, and may answer it.** Each line it answers is a model call, which costs money (see the cost section), even when the line was not meant for it.
- **Everyone else may chat, nothing more.**
  - The bot answers their questions.
  - Nothing they type runs: a typed command gets `Sorry <name>, I only run commands from task givers.`, at most one such line per player per 10 s.
  - When their words ask for an action, the bot replies `Sorry <name>, I only do things for task givers.`
  - What they say reaches the model only as quoted data, never as instructions.
  - **Seen live** (G3 D).
- **Typed commands run directly.** When you type a command (it starts with `!`), it runs at once without asking the model, and the bot echoes `*JQDAW used <command>*`. When you ask in your own words ("follow me", "come here"), the model decides what to do, which is slower and less certain. For anything that matters, type the command.

## Commands for you (JQDAW)

| You type | What happens |
| --- | --- |
| `!goToPlayer("JQDAW", 2)` | Comes to you, to within 2 blocks. |
| `!followPlayer("JQDAW", 3)` | Follows you at 3 blocks, endlessly. Tasks and the agenda wait while it follows; end it with `!stop`, then `!resume`. |
| `!stop` | Stops what it is doing **now** and holds: `stopped; on hold until a task giver types !resume`. Tasks and the agenda wait, and the hold survives a crash or a service restart (`control.json`). |
| `!pause` | Lets the current action finish, then holds until `!resume`. |
| `!stfu` | Goes quiet (no chat, no self-prompting) and finishes the current action; holds until `!resume`. |
| `!resume` | Ends a `!stop`, `!pause` or `!stfu`: `resumed (after <kind> by JQDAW)`. Tasks and the agenda carry on. |
| `!taskAdd("bring me 10 logs", "normal")` | Queues a task (`"urgent"` goes first). See the replies below. |
| `!taskList` | One line per open task: `task <id> <status> <priority> <giver>`. |
| `!taskCancel("t1")` | Cancels an open task: `task t1 cancelled`. |
| `!agenda` | Shows its own plan: whether it is active, the current step, the steps done, and any hold. |
| `!agendaStop` / `!agendaStart` | Turns its own plan off or on. |

**A task's life, in chat:**
```
task t1 accepted: bring me 10 logs
agenda paused for task t1
task t1 started: bring me 10 logs
task t1 done                      (or: task t1 failed: <why>)
agenda resumed: <step>
```
- **Budget:** a task gets at most 3 attempts and 10 minutes of model time; then it fails with a reason.
- **Timing:** a new task waits for the current action to reach a safe point, at most about 5 s, then stops it.
- **Seen live** (G3 C), with the test-only console giver; with you as the giver: built, not yet seen live (G4).

`!followPlayer`, `!goToPlayer` and `!stop` from you: **built, not yet seen live** (G4 #3, `g4-control-commands`).

## What it does on its own

- **Its agenda:** RotN's first day, step by step, using no model calls to judge progress. The steps, in order:
  1. collect 6 rocks;
  2. collect 3 sticks;
  3. craft a crude axe;
  4. collect 3 logs;
  5. make the first plank;
  6. craft Crafting Tools;
  7. craft a crafting table;
  8. make planks and sticks at the table;
  9. craft a stone pickaxe;
  10. craft a stone axe;
  11. make cobblestone from rocks.

  It reports in chat: `agenda step <id> started: …`, `agenda step <id> done`, and at the end `agenda done`. A step whose model budget is spent ends in one of two ways:
  - `agenda step shelter_blocks stuck: <why>; going on without it until the night`: the shelter reserve is skipped, and the agenda goes on.
  - `agenda step <id> stuck: <why>; agenda paused`, for any other step. The agenda waits. **Type `!agendaStart` to retry that step with a fresh budget** (`!agenda` shows it as `paused (step <id> stuck: …; a giver's !agendaStart retries it)`).

   The plan's progress is saved and picks up after a restart. **Seen live** (G3 A: rocks to stone tools from a fresh spawn).
- **Nights:** shortly before sunset it gathers blocks for a shelter (cobblestone or stone with a pickaxe, dirt without one). From dusk to full daylight it shuts itself in that shelter and repairs it; tasks and the agenda wait. If it cannot build one, it stays where it is with its normal reflexes until morning. Your `!stop` or `!pause` comes first, so a bot on hold does not build a shelter. **Seen live** (G3 B: a night in the shelter, no death).
- **Reflexes:** it eats, fights back or flees by itself. These come before everything else, and a hold does not turn them off: **a bot on `!stop` still eats and defends itself.**
- **After a death:**
  - It respawns and measures what it lost. It does not guess.
  - It says one line, exactly in this form: `I died at <x>, <y>, <z> (<cause>); lost <n> <item>, <n> <item>, ….` It names up to 6 kinds, then `and <n> more kinds`, or says `lost nothing`. It adds `; XP level <before> -> <after>` when it lost levels, and leaves out the cause when the server named none.
  - At most one such line a minute. After 3 deaths in 10 minutes it says once `I died 3 times in 10 min; I stop reporting deaths in chat for now.` and then reports deaths only in its log.
  - Then it carries on.
  - **What is lost:** what it dropped lies at the death spot for **10 minutes** and then despawns (`corpsecomplex.cfg`, Drop Despawn Timer 600 s).
  - **A hostile `Zombie FRCFLD` rises at the death spot** (the Zombie Players mod). It does not burn in daylight and does not leave. The bot goes back for its things only with a weapon and more than half its health, and not at all once the 10 minutes are over.
  - **Built, not yet seen live** (G4 #6).

## Known limits

- **RotN's early game only.** The agenda ends at stone tools and cobblestone. After `agenda done` it waits for your tasks. It is not built for the mid or late game.
- **No code writing.** `allow_insecure_coding` is `false` in every committed settings file, so it cannot write or run code (`newAction is disabled …`).
- **A chat limit**, to stay clear of the server's spam kick:
  - about 5 lines at once, then one every 2 s;
  - its replies to you go first and are never dropped;
  - routine lines wait their turn;
  - reflex chatter ("I'm stuck!") may be dropped;
  - long answers may arrive a little late.
- **One account, one bot.** A second bot needs its own Minecraft account and its own unit (G4 #12, built, not yet seen live).
- **It plays where its env file points.** The server is the `host` in `/etc/mindcraft-rotn/frcfld.env` on the CX23, set only by you.
- **A kick is not a stop.** It reconnects after a kick or a server restart (G4 #1, built, not yet seen live). A ban or a whitelist removal does stop it, as a fatal exit. To stop it, use the next section.

## How to stop it

1. **In game:** type `!stop`. It stops at once and stays on hold, even across a restart, until you type `!resume`.
2. **The service, on the CX23 as root:** `mindcraft-rotn-ctl stop frcfld` (as `deploy`: `sudo mindcraft-rotn-ctl stop frcfld`, as `deploy/cx23/README.md` gives it).
   - It stays stopped until a `start`.
   - After G4, once the bot is `enable`d, it also comes back after a reboot of the CX23. **To keep it off, also run `mindcraft-rotn-ctl disable frcfld`.**

The lead can also stop it from the dev server, through the restricted SSH gate (ADR 0009). That gate allows `stop` but not `disable`.

**When it restarts itself:** systemd restarts the bot after a crash or a passing failure, 20 s later and at most 6 times in 10 minutes. It does **not** restart it after a `stop`, a clean exit, or a fatal one (`RestartPreventExitStatus=0 3`). Fatal means something a human must fix first: a ban, a removal from the whitelist, a mod rejection, or a login that needs you. After a fatal exit the bot stays off until a `start`.

Check it with `sudo mindcraft-rotn-ctl status frcfld`, or read its log with `sudo mindcraft-rotn-ctl journal frcfld --since <YYYY-MM-DDTHH:MM, UTC>`.

## What it costs

- **Model calls (OpenRouter): TBD per hour.** Its own play costs model calls, and so does every public chat line it answers, from anyone, so a busy chat costs more.
- **The hourly figure is** measured by the 2-hour soak (G4 #7) and set in the soak ADR. The G3 test runs were short sessions on test servers, so they are no measure of a normal hour; this page gets the soak's number.
- **The CX23** is the server it runs on (a fixed monthly price).
