# Brief: skills-rotn

You make the bot behave well in RotN: rewrite Mindcraft's skills, commands, modes and prompts for 1.12.2 + RotN, and build the autonomy model (priority stack, task queue, agenda).

## You own

- `src/agent/` (skills, world queries, commands, modes, self_prompter, a new task queue module)
- `profiles/` (the RotN bot profile, defaults, prompts and examples)

Use rotn-data's API for every block, item and recipe fact. Do not hard-code RotN item names in skills when the data package can answer.

## Inputs

- `docs/research/rotn-progression.md`, `docs/research/seam-map.md`
- `packages/rotn-data/` API, and the forge-bridge registry at runtime
- Test server scenarios from harness-ops

## Deliverables

1. **Basics first** (can start before G2): chat, follow, come, stop, inventory, using translated names.
2. **RotN early game:** gather rocks, make cobblestone, crude axe, logs, planks, crafting table, stone tools, following `rotn-progression.md`.
3. **Reflexes (modes):** fight or flee, eat, escape darkness, lava and deep water, detect AggroTP teleports (sudden position jumps) and invasion warnings, then cancel and re-plan.
4. **Priority stack:** reflexes > control commands > player tasks > autonomous agenda, with interrupts only at safe checkpoints.
5. **Task queue:** persistent JSON per bot (survives restarts), fields include `id`, `text`, `priority` (urgent or normal), `giver`, `assignee`, `status`, `result`. Commands `!task add`, `!task list`, `!task cancel`. Only players on the task-giver list (settings, plus `only_chat_with`) can add tasks; others are politely refused.
6. **Agenda:** a RotN progression plan in a goal file, resumed when the queue is empty, built on `self_prompter.js` and `!goal`. Calls the LLM only at decision points. Optional setting `pause_when_empty` (default false).
7. **Profile:** RotN system prompt (hazards, progression, the command list), RotN examples using real 1.12.2 names, OpenRouter model as primary plus a fallback.
8. **Death handling:** respawn, report losses, avoid chat-spam loops.

## Acceptance tests

- Harness scenarios for G3: rocks to stone tools on a fresh spawn; survives the first night; a task preempts the agenda, then the agenda resumes; queue survives a restart.
- `npm test` passes; no new ESLint errors; upstream code paths you did not need to change stay unchanged.

## Phase 0 research revisions (rotn-lead, 2026-11-01)

Read `docs/research/rotn-progression.md` (progression graph, hazard table, first-day script) and the seam-map rows owned by SK. Where this section and the text above disagree, this section wins.

**Safety and stability fixes first.** Small, test-backed, and possible before G2 (seam-map sections B and E):

- Hard-disable cheat mode: `!setMode cheat`, `/tp`, `/setblock`, and the `god_mode` profile. The bot has no op on RotN.
- Remove the process restart after every `!smeltItem` (`actions.js` L284-291). On Forge, every restart means a full relogin.
- Drop the `/skin` command at login.
- Wrap the `agent.js` update loop so one throwing mode cannot kill it.
- Guard `block.name` uses for modded blocks with no name.
- Stop modes from re-prompting the LLM on every reflex (`modes.js` L306-330).
- Limit `isClearPath` A* cost on the CX23.
- Kick handling in `agent.js` L69-89: coordinate with net-forge, which owns the restart policy in `src/process/agent_process.js`.

**Profile.**

- Remove examples that use non-existent commands (`!collectBlock`, `!craftItem`) and `!newAction`, which is disabled because `allow_insecure_coding` is false.
- Remove "don't refuse requests". It conflicts with the task-giver rule.
- Use RotN 1.12.2 names from `rotn-progression.md` section 4.
- Remove or block `!searchWiki`, which returns vanilla 1.21 information. Blocked actions live in `settings.js`, which the lead owns: request the change.

**Crafting on the server (ADR 0004).** You own executing crafts. mineflayer's `bot.recipesFor` only knows vanilla minecraft-data recipes, so feed rotn-data's prismarine-recipe-shaped recipes to `bot.craft`, or click slots directly. Serverbound slots need net-forge's REID `slot` override; coordinate through your status file.

**Exit codes (ADR 0003 decision 5).** `agent.js` exits with `0` on a requested stop, `1` on a transient disconnect and `3` on a fatal one (mod rejection, ban, not whitelisted). Today it exits with `1` on kicks and with **`0` when the spawn handler throws** (`agent.js` L142). Change that to `1` (or `3` if the cause is fatal), because `0` now means "clean stop, never restart". Codes `2` and `4` are reserved for the task framework. net-forge implements the restart side.

**RotN early game (G3).** This follows `rotn-progression.md` section 1.

- Gather rocks from surface piles.
- Crude axe in the 2x2 grid. It has 8 durability, so keep spares.
- Fell a tree, then the **first plank**: place a log, right-click it with the crude axe to debark it, then right-click again for a plank. This is a world interaction, not a recipe, so it needs its own skill.
- Crafting Tools, then crafting table, then log to 3 planks in the table, then sticks.
- Stone pickaxe and axe (3 rocks + 2 sticks each).
- Mine stone for rocks, then 4 rocks to 1 cobblestone.
- In RotN, mining stone with a pickaxe below Sturdy yields rocks, not cobblestone. Fix the `collectBlock` aliasing (`cobblestone`→`stone`) accordingly.

**Survival rules.**

- Nights are double length, with Hardcore Darkness.
- Mobs dig through walls and are drawn to visible light. Build shelters from cobblestone or stone, not dirt.
- Do not rely on world time values (Extended Days is installed); use sky light and the sunset signal.
- Eat at food 12 or lower; starving is instant death.
- Avoid hawthorn berries, cloudsbluff, villages (bandits), swamps and deep caves early.
- Re-plan after any position jump of 5 or more blocks (AggroTP).

**Death (Corpse Complex).**

- The bot keeps its main hand, off hand, armor and baubles. Everything else drops at the death spot and does not despawn. Respawn takes 7 s.
- The bot reports what it lost and may go back for its items, without chat spam.

**Rules.** Use rotn-data's API for all item, recipe and harvest facts; no hard-coded RotN names where the data package can answer.

**Task givers.** The human named `JQDAW` as the first task giver on 2026-11-01; more will be added later. Read the list from a setting (propose the key name and default to the lead, who owns `settings.js`); never hard-code it.

**Added acceptance tests:**

- Unit tests prove that cheat mode cannot be enabled, by `!setMode` or by profile.
- The update loop survives a mode that throws.
- `!smeltItem` no longer exits the process.
- A task from a player who is not on the list is refused, and one from `JQDAW` is queued.

**Start condition.** At G2, as planned. You may start early on the safety fixes and the task queue, which need no modded facts.
