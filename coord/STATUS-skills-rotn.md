# Status: skills-rotn

Updated: 2026-11-05T00:38Z (from `date -u`)

Worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/skills-rotn-g3`. Session 1; Phase 3 (G3: act in RotN) starts now. I own `src/agent/` and `profiles/` only.

G3 (PLAN): **(a)** rocks to stone tools on a fresh spawn; **(b)** survives the first night; **(c)** a task preempts the agenda, which then resumes. My brief adds: the queue survives a restart, and the brief's unit acceptance tests.

## Done

- Read CLAUDE.md, PLAN.md, my brief, `STATUS-rotn-lead.md` ("Requests for skills-rotn"), `docs/research/rotn-progression.md` and `seam-map.md`, and the G2 batch 8 record in `STATUS-harness-ops.md`.
  - The G2 entry in PLAN.md (#98, `3a95299`) and the harness-ops record. These caveats matter for G3:
    - **naming was proven only through the harness driver.** The full agent and its LLM command path must prove it at G3/G4, so B1 covers the command boundary;
    - "near spawn" is one fixed world; a spawn can land on a Dynamic Trees canopy (batch 6);
    - modded item names have no old/new rename;
    - `charm:spectre` vanishes in daylight;
    - pack-side errors exist (Universal Tweaks chunk-save NPE; RoughMobsRevamped "Ticking entity" NPE in G1).
- **#100 merged** (`4b175cc`): this file and the G3 plan.
- **#103 merged** (`3a009d9`): A1 log hygiene in `src/agent/` (`safe_error.js`, the static guard, the review nits). Lint baseline 254.
- **#104 merged** (`aa4cead`): model-layer log hygiene under the lead-approved exception (`openrouter.js:40/49`, `prompter.js:124-125/131-132/238/327`). Log hygiene for the CX23 is done (lead, 2026-11-02).
- **#108 merged** (`e3a2a31`): A2, cheat mode cannot be enabled (`!setMode`, profile, `setOn`/`loadJson`); the `/tp` and `/setblock` branches in `skills.js` cannot run.
- **#109 merged** (`004cd38`): A3, the update loop and each mode survive a throw (rate-limited `[modes]`/`[update]` lines); no restart after `!smeltItem`; no `/skin` at login.
- **#110 merged** (`32fb576`): A2b, Mindcraft task files are refused unless `MINDCRAFT_ROTN_ALLOW_TASK_FILES=1`, with a loud warning when they load.
- **#119 merged** (`0cac640`): the #104 regression fix; the OpenRouter test no longer runs inside the agent (guard test added). The lead added #121 (`_model_map.js` skips `*.test.js`), so request 7 is done.
- **#123 merged** (`997da58`): A4, quiet reflexes (a re-plan flag instead of an LLM call per reflex), a safe `execute()`, unstuck re-plans instead of killing the agent, bounded `isClearPath`, behavioural `!smeltItem` and `/skin` tests.
- **#124 merged** (`085dc3d`): B1, the 1.12 name fixes from the seam map (liquids, lit furnaces, grass, empty blocks, doors, world height, profession index 13, biome and door crash guards).
- **#126 merged** (`a08e8c6`): A4b, a new action drops a stale re-plan request; the unstuck no-path wording; the login-wiring test.
- **#133 merged** (`70cf3cb`): A4c, only `action:` labels drop a pending re-plan; the unstuck failure log names the real reason.
- **#131 merged** (`ce02cc8`): B1b, the skills name space (Request 8): canonical names at the command boundary; one shared resolver (`findItem`/`itemMatches`, `blockMatcher`) in every consuming skill; variant-aware counts, block search, crafting, smelting and `!getCraftingPlan`; end-to-end tests per review scenario.
- **#132 merged**: every baby check uses `mc.isBaby` (#125).
- **#141 merged** (`37ba167`): B2, `collectBlock` follows rotn-data's world rules; real inventory gain per break; the rule's tool equipped (never a Sturdy pickaxe for rocks); no `cobblestone` -> `stone` alias.
- **#145 merged** (`6e5d63f`): B2b, a bare rock name covers the rock ore dictionary (the Underground Biomes piles at the G3 spawn); no throw when the pickaxe breaks; the #131 regex nit.
- **#148 merged**: B2c, the #145 nits 2-4 (the log names the items gained; an explicit variant uses only its own blocks; a skipped rule does not use up an attempt).
- Lead notes on #100: the plan is good; Stage A first; A1 must merge before the first CX23 run; net-forge is **paused** (see Request 2). Lead decisions, folded into the plan below:
  - (a) E1: only players on the task-giver setting may add tasks; `only_chat_with` alone does not grant it. Tested both ways.
  - (b) Every log line and command reply that harness-ops' scenarios check must not depend on Minecraft command feedback, because a pack mod sets `sendCommandFeedback` false for the player on join. The bot reports from its own state (inventory, position, its own log lines), never from a `/command`'s chat answer.
  - (c) A1 cites the lead's "Before the first CX23 run" line (`STATUS-rotn-lead.md`).
- Already done by others, so not in my plan:
  - the exit-code contract (`agent.js` exits 1/3, never 0 on a failed spawn), net-forge #23;
  - `mcdata = bot.registry` and the naming API (`toNew`/`toOld`/`resolveName`), #44/#46;
  - entity threat overrides (`isDangerous`), rotn-data #62.

## Doing

**Session 2 (respawned after the Orca restart, 2026-11-03):** the branches matched origin, and CI was green on #164 and #170.
- **#164 E2 agenda: merged** (`ebdc6b1`). Its merge nits went to E3 and are fixed in #174 (`51d4c5e9`).
- **#170 F1 profile:** lead REQUEST CHANGES, fixed in `837cc2c6`: `"name": "FRCFLD"` (lead decision: the bot is FRCFLD, here and on the CX23), with a test of the exact name. The `speak_model` nit is left as is (`settings.speak` is false). Reply posted; CI green. **Approved** by the lead (2026-11-03), merge pending.
- **#175 approved** by the lead (merge pending): the #151 nit (branch `agent/skills-rotn/craft-needs-slot`, base `develop`). `craft_needs.js` finds an input's own recipe slot by its exact stack list (size `choices + more`, every choice in it). Before, `soaking_pot`'s 1-stack slot counted string from the twine slot. The new test fails on the old code; library and command tests pass 57/57.
- **#174 E3 priority stack: merged** (develop `5f8e460`). Also merged: #170 (the RotN profile, bot FRCFLD), #175 (the #151 slot nit), #181 (D2a) and #186 (D2c). From here STATUS lives on my current branch (#190). The #164 nits are fixed in `51d4c5e9`:
  - someone else's `!goal` is not counted against the agenda, and the model's `!goal` is refused while the agenda or a task runs the self-prompter;
  - a run carried into the next step counts as that step's run;
  - LLM time is saved every 10 s. This also fixes the E2 bug that the time was never saved by the timer;
  - a paused bot-to-bot conversation uses no run;
  - `Agent.autostartAgenda()` is tested.

  - **#174 review (REQUEST CHANGES), fixed in `5e7bd56b`:**
    1. untrusted turns (a non-giver's words, the bot's reply and the results) carry a flag and never go into the `$MEMORY` summary; `saving_memory` says so;
    2. a reply to a non-giver that asks for an action is not kept as an assistant turn;
    3. only a goal a giver typed (`goal_by`) is exempt. The model's own `!goal` is refused whenever the agenda is on or a task is open; a model goal that runs anyway is taken over and counts; with nothing autonomous on it gets 5 min;
    4. nit: a new task waits for a giver's goal;
    5. nit: the spawn handler is `Agent.onSpawn`, and a test runs it.

    Tests 1, 2 and 5 fail on the old code.
  - **#174 re-review (lead):** items 1, 2, 4 and 5 are fixed, and no working non-giver channel was found. The one item left is fixed in `9fdc5d56`: the model's own goals share one 5 min count across `!goal` swaps, which reset it before. The count starts again only after self-prompting stopped, or after a giver's goal, a task or the agenda had the self-prompter. The goal-swap test fails on the old code. Tests: `src/agent/**` 185/185; lint 254.
  - **#174 third review (lead), fixed in `3302d960`:** autonomy owns a goal by identity. `driveTo` records the prompt a driver set, and `ownsPrompt` compares against it; the text-prefix check is gone. A model `!goal` starting `Player task `/`RotN agenda, step ` is refused. The test fails on the old code; `src/agent/**` 186/186; lint 254.
  - **Known limit (lead, #174 re-review): bot-to-bot messages are trusted.** `handleMessage` treats a message from another Mindcraft bot (`convoManager.isOtherAgent`) as neither a giver's nor an untrusted sender's: it is not marked untrusted, and its replies may run actions. Before a second bot joins (multi-bot, ready-to-try's last item), bot-to-bot messages need the E3 marking, or giver rules of their own.

  Tests: `src/agent/**` 181/181; lint 254. The E3 contents:
  - control holds: a giver's typed `!stop`, `!pause` (new), `!stfu` (now giver-only) and `!resume` (new), saved in `bots/<name>/control.json`; a giver's typed action holds autonomy while it runs;
  - tasks before the agenda, switching at the checkpoint, with the step-sized budget, `!taskDone`/`!taskFailed`, and the agenda resuming with no new run;
  - non-giver history and task text kept as quoted, marked data;
  - the self-prompter interrupt fix.

  This fixes #164's known limit (`!stop`/`!stfu` undone by the agenda). Tests: `src/agent/**` 170/170; lint 254.
- **Next, in order:**
  1. the #190 review;
  2. C1 crafting execution and C2 (first plank). Net-forge's final Request 2 answer is in #167, which is not merged yet, and P1 (paid, lead GO) measures the place timing. Until then C1 stays blocked;
  3. D2 night shelter, for G3 (b).
     - **D2a, #181: merged** (wall-clock fallback accepted by the lead). Branch `agent/skills-rotn/night-shelter`: `library/night.js`, pure functions, not called yet. **Lead decision applied** (`c3cbc428`): world time first; when it is stuck longer than the freeze plus a margin (15 min), `NightClock` falls back and logs it.
       - The fallback is the wall clock, not sky light: in 1.12 sky light and the sunset event come from the same world time. The PR asks the lead to overrule if wanted.
       - Tests 5/5; `src/agent/**` 166/166 on develop.
       - **#181 review (REQUEST CHANGES), fixed in `be24174c`:**
         - `isSturdy` comes from rotn-data's dump: material rock, `fullCube`, hardness 1.5 or more. A block the dump lacks is not sturdy, so forge-bridge's defaults never pass. Slabs, stairs, walls, netherrack and silverfish stone are out. Tested on real dump entries.
         - The freezes are the measured 3001 and 16001.
         - Fallback: the wall clock, pushed earlier in `c3cbc428`. The reply explains why sky light is not independent, and asks the lead to name a signal if wanted.
     - **D2c, #186: merged** (lead request on #181). the modes react by rotn-data's `threatOf`. `library/threats.js` `threatPlan`, first match wins:
       1. flee a dangerous mob, one that explodes, two or more melee mobs, or a ranged mob;
       2. fight a lone melee mob;
       3. fight an enderman only right after it hit the bot.

       `cowardice` (now on by default) and `self_defense` act on the plan; `idle_staring` never looks at do-not-look mobs. `nightThreatNote` is ready for D2b's night routine. Tests 6/6; `src/agent/**` 167/167; lint 254.
       - **#186 review (REQUEST CHANGES), fixed in `3b65ebc4`:**
         1. the fight re-checks the plan each round (`defendSelf` `keepFighting`) and backs off when a creeper or more mobs arrive;
         2. "provoked" means that enderman is angry (its `screaming` flag, metadata 13), not any damage; a do-not-look mob whose anger cannot be read is never attacked, and the bot backs off after a hit next to it;
         3. no random looks while a do-not-look mob is within 64 blocks.

         The nits went into a comment and the PR, and the data notes to rotn-data. Tested during the P1 rerun with targeted files only (`threats.test.js` 9/9, `quiet_reflexes.test.js` 11/11). An old-code check of the mid-fight test hung (the old fight never ends). I stopped it at once, because the P1 rule forbids long node runs.
       - `nightPhase`/`minutesToSunset` from S1-A's measured cycle (night 12542-23460; Extended Days freezes at 3000 and 16000). This deviates from the brief's "no world time" line, and the PR asks the lead.
       - `shelterPlan` (a 1x2 space, 10 shell blocks, rock only).
     - **D2b** (the shelter agenda step, placing, the night routine) comes after P1's placing results.
- **P1 batch (lead, 2026-11-03):** attempt 1 failed at setup on a harness console-wait. The rerun ran (the lead's message came before 15:24Z by `date -u`). **It is over (lead, received before 2026-11-03T15:33Z): the server is gone and the memory rule is lifted.** Back to normal targeted testing. D2b waits for the lead's placing results from it.

- **Net-forge heads-up sent to the lead** (B2 opened; C1 follows): Request 2 below must be answered (net-forge back, or a probe) before C1.
- **Merged:** E1 #146 (task queue), C1a #151 (craft needs; lead nit for later: `craft_needs.js` should match the exact slot stack list, as the slot found by `choices[0]` is wrong for `soaking_pot` and `hamster_wheel`), #156 (with rotn-data #153).
- **C1 coordination (net-forge is back, working on Request 2):** I build only the C1 parts that need no `window_click`, `block_place` or `use_item`: choosing a RotN recipe the inventory can satisfy (by output and ingredients, never a CraftTweaker id), including #145 nit 1 (fixed in rotn-data #152: mixed rocks make a stone tool, and `canFill` judges the recipe; cobblestone still needs one rock type, one recipe per type). Executing crafts in the 2x2 grid or the table, placing the table and the first-plank interaction (C2) wait for net-forge's report in `coord/STATUS-net-forge.md`. **net-forge progress:** #154 (FastWorkbench crafting-table window for mineflayer, Request 2 item 1) merged; the lead set `place_block_timeout_ms: 2000` in settings.js.
- E2 `agenda` (branch `agent/skills-rotn/agenda`): #164 open. Review REQUEST CHANGES, fixed: each step gets a bounded LLM budget (3 self-prompter runs with a doubling back-off of 30 s then 60 s, and 5 min of self-prompter time), then `agenda step <id> stuck: <why>; agenda paused`; the pause and the runs spent are saved, and a giver’s `!agendaStart` retries with a fresh budget. `!agenda` records nothing. Autostart happens only on a fresh bot (no `agenda.json`). The logs and planks steps count rotn-data’s `logWood`/`plankWood`. Chat failures are logged. Known limits for E3: `!stop`/`!stfu` are undone when the agenda restarts the self-prompter after the back-off (each costs one run of the step budget, so 3 of them make the step stuck); G3 (b) (night) is not served yet (no shelter step; D2).
- **F1 start (human decision):** the RotN profile `profiles/rotn-bot.json` uses the OpenRouter preset `openrouter/@preset/glm-5-1-mindcraft`: #170 open (branch `agent/skills-rotn/rotn-profile`, with a test that it resolves to api openrouter and model `@preset/glm-5-1-mindcraft`; bot name `rotn_bot`).
- **E3 requirements (lead, #146 review):** non-giver history marked as untrusted data, `!stfu` for task givers only, task text framed as untrusted in a prompt. All three are in #174.
- Next after B2c: those C1 parts, then E2 (agenda) and E3 (priority stack, task done/failed lines). Flag for G3 (#141 nit 5): with an axe, collecting log targets Dynamic Trees branches; the count is the real gain, but scattered drops may not all be picked up.

## G3 plan: small PRs, in order

Each PR has offline unit tests (`src/**/*.test.js`, a fake bot, no server and no LLM), adds no ESLint errors (baseline 255), and leaves upstream code paths I do not need unchanged.

**Rules for every PR:**
- Names go through `src/utils/mcdata.js` (`resolveName`, `toNew`/`toOld`, `bot.registry`).
- `grass` and `stone_slab` keep their 1.12 meaning with `prefer: 'old'`. Names the LLM writes use `prefer: 'new'`.
- Counts and crafting checks use `resolveName(...).meta`, never `getItemId` alone, because `getItemId` lumps the log variants.
- Recipes are matched by output and ingredients, never by a CraftTweaker recipe id.
- Danger uses rotn-data's `isDangerous` (with its overrides), not `IMob`/`type` alone.

### Stage A: safety and stability (needs no modded facts)

| PR | Branch topic | Content | Tests | Serves |
| --- | --- | --- | --- | --- |
| A1 | `log-hygiene` | `agent.js:87` and `:456` stop printing whole error objects. A small `safeError(err)` helper prints only the name, the code and a capped, single-line message, with no request or response bodies, headers or tokens. Same treatment for any other `console.error(..., err)` in `src/agent/` that a connection or model error can reach. **Must merge before the first CX23 run.** | the helper strips bodies, headers and long messages; the call sites use it | lead's "Before the first CX23 run" line (`STATUS-rotn-lead.md`) |
| A2 | `no-cheat` | `cheat` cannot be turned on: `!setMode cheat` is refused, a profile's `cheat: true` (`god_mode.json`) is ignored with a log line, and the `/tp` and `/setblock` branches in `skills.js` are unreachable. | `!setMode` and profile tests (brief acceptance) | brief, safety |
| A3 | `loop-and-restarts` | The update loop catches and logs a throwing mode and carries on. `!smeltItem` no longer calls `cleanKill`. The `/skin` chat at login is gone. | loop survives a throwing mode; `!smeltItem` does not exit (brief acceptance) | brief, safety |
| A4 | `quiet-reflexes` | Modes stop calling `self_prompter.stopLoop()` and re-prompting the LLM on every reflex (`modes.js` ~L306-330); a reflex only logs and sets a "re-plan" flag for the agenda. Cap `isClearPath`'s A* cost for the CX23. | one reflex makes no LLM call; the A* cap is passed through | brief, PLAN priority 1 |

### Stage B: 1.12 names and modded blocks in skills, world and modes

| PR | Branch topic | Content | Tests | Serves |
| --- | --- | --- | --- | --- |
| B1 | `names-audit` | Review every 1.21 name in `skills.js`, `world.js`, `modes.js` and the commands against `resolveName`. Fixes include: `empty_blocks` (`'grass'` is the block in 1.12; the plant is `tallgrass`, plus `double_plant`, `snow_layer`, `deadbush`); `flowing_water` and `flowing_lava`; `lit_furnace`; door names and the `_properties` guard; `goToSurface` limited to y 0-255; the 1.12 baby metadata index; guards on `block.name` for modded blocks with no name; the biome lookup guard. **Command boundary** (G2 caveat): `!collectBlocks`, `!craftRecipe`, `!placeHere` and the other name-typed commands accept the names the LLM writes (1.21 or 1.12, `resolveName` with `prefer: 'new'`) and modded `modid:item` names. | a table-driven test on the 1.12 registry with `__setRegistryForTest`; command validation accepts `oak_log`, `log:0` and `pyrotech:rock` | G3 a, b |
| B2 | `collect-rotn` | `collectBlock` aliasing for RotN: `cobblestone` no longer maps to digging `stone`; mining stone below Sturdy yields `pyrotech:rock` (harvest facts from `rotn-data.harvestInfo`). Log counts use the meta. | stone with a stone pickaxe gives rocks; spruce logs are counted apart from oak | G3 a |

### Stage C: RotN early game (G3 a)

| PR | Branch topic | Content | Tests | Serves |
| --- | --- | --- | --- | --- |
| C1 | `rotn-crafting` | Execute crafts from rotn-data's recipes instead of `bot.recipesFor`: pick a recipe by output and ingredients (oredict members and meta are expanded), build a prismarine-recipe-shaped object and call `bot.craft` in the 2x2 grid or the crafting table. Clear errors for a missing table or ingredients. Needs net-forge's serverbound REID slot encoding (Requests). | crude axe (2x2), Crafting Tools, table, sticks, stone pickaxe and axe, 4 rocks to cobblestone, all against the real 3.3.4 dump, offline | G3 a |
| C2 | `first-plank` | A new skill and command for the world interaction: place a log, use the crude axe on it to debark it, use it again for a plank, then collect the drops. It also gathers rocks from surface piles (the block name comes from rotn-data). | a fake bot checks the action sequence and the inventory checks | G3 a |
| C3 | `early-game` | An early-game routine following `rotn-progression.md` section 3, steps 1-9: rocks, sticks from leaves, 2-3 crude axes, fell a tree, first plank, Crafting Tools, table, planks and sticks, stone pickaxe and axe, rocks from stone, cobblestone. Each step is resumable and checks its preconditions from the inventory. It is exposed as one command and as agenda steps. | step planner from inventory states | G3 a |

### Stage D: survive the first night (G3 b)

| PR | Branch topic | Content | Tests | Serves |
| --- | --- | --- | --- | --- |
| D1 | `eat-and-threats` | Eat at food 12 or lower (never hawthorn berries or cloudsbluff; keep the bread as a last resort). Fight or flee by `isDangerous` and the threat count. Re-plan after any position jump of 5 or more blocks (AggroTP) and after an invasion title or sound. | food choice, threat classification, jump detector | G3 b, brief 3 |
| D2 | `night-shelter` | Detect nightfall by sky light and the sunset signal, not world time (Extended Days). Build an enclosed shelter of cobblestone or stone, with 2 blocks of headroom and no light visible from outside, 5-8 min before sunset. Night routine: stay in, repair a breached wall, fight only at the opening, leave at full daylight. | shelter blueprint closure check; night detector on sample values | G3 b |
| D3 | `death-report` | On death: wait for the respawn (7 s), report what was lost once (Corpse Complex keeps the hands, armor and baubles), optionally go back for the items, and rate-limit the death chat so it cannot loop. | loss diff and one report per death | ready-to-try item 6 |

### Stage E: priority stack, task queue and agenda (G3 c)

| PR | Branch topic | Content | Tests | Serves |
| --- | --- | --- | --- | --- |
| E1 | `task-queue` | A persistent JSON queue per bot (`bots/<name>/tasks.json`, written atomically) with `id`, `text`, `priority` (urgent or normal), `giver`, `assignee`, `status`, `result`. Commands `!task add`, `!task list` and `!task cancel`. Only players on the task-giver setting may add tasks; `only_chat_with` alone does not grant it (lead decision a). Others get a polite refusal. | an untrusted task is refused; a player in `only_chat_with` but not on the task-giver list is refused; a task from `JQDAW` (on the list) is queued; the queue survives a reload (brief acceptance) | G3 c, brief 5 |
| E2 | `agenda` | The RotN agenda in a goal file per bot (the early-game steps, then shelter by night), built on `self_prompter.js` and `!goal`. It calls the LLM only at decision points, not on a timer, and does not die silently after 3 replies without a command. `pause_when_empty` (default false). | the agenda resumes after a restart; no LLM call between decision points | G3 c, brief 6 |
| E3 | `priority-stack` | Reflexes > control commands (stop, pause, come, resume) > tasks > agenda. Interrupts happen only at safe checkpoints (between skill steps), and the agenda resumes after a task is reported done or failed. | a task preempts the agenda at the next checkpoint and the agenda resumes; `stop` beats a task | G3 c, brief 4 |

### Stage F: profile

| PR | Branch topic | Content | Tests | Serves |
| --- | --- | --- | --- | --- |
| F1 | `rotn-profile` | A RotN profile: the system prompt (hazards, progression, the real command list), and examples with 1.12.2 names from `rotn-progression.md` section 4. It removes `!newAction`, `!collectBlock`, `!craftItem` and "don't refuse requests". The OpenRouter model is primary plus a fallback, chosen by the lead's benchmark. | a profile lint: every `!command` in the examples exists and is not blocked; no 1.21-only names | brief 7 |

F1 can move earlier if harness-ops needs the profile for scenario dry runs.

### Scenario evidence

harness-ops writes the G3 harness scenarios, and batches run only on the lead's written GO. My part:
- for each stage, the commands and observable log lines a scenario can check (listed in each PR). None of them depends on Minecraft command feedback (lead decision b);
- the open harness questions from `rotn-progression.md` "Open items", which an early probe batch could answer before C2/C3 harden:
  - Does punching a log drop anything?
  - Does Crafting Tools consume the crude axe?
  - How many planks does one click give?
  - Does log to 3 planks work in the 2x2 grid?
  - Which block are the rock piles, and what do they drop by hand?

## Blocked

- Nothing yet.

## Requests to other agents or the lead

1. **Lead (`settings.js`):** add the task-giver setting. Proposed key `task_givers`, default `[]`, with `["JQDAW"]` set where the lead keeps per-deploy values. Add `pause_when_empty: false`. Add `!searchWiki` to `blocked_actions` (it returns vanilla 1.21 facts). Needed by E1/E2; until then the code reads the keys with these defaults. **E1 reads `settings.task_givers`** (default: nobody may give tasks or type commands). Also a **test-only** `allow_server_task_giver: false`: G3 sets it to true (with `SETTINGS_JSON`) so the console whisper sender "Server" is a giver; never true in a committed profile. Until both keys are in `settings.js`, the code reads them with these defaults. **E2 reads** `agenda_autostart` (default true: the agenda starts on a fresh bot) and `pause_when_empty` (default false), and optionally `agenda_step_attempts` (default 3) and `agenda_step_llm_ms` (default 300000), the per-step LLM budget. **E3 (#174) reads** optionally `task_attempts` (default 3) and `task_llm_ms` (default 600000), the per-task LLM budget.
2. **net-forge (paused since 2026-11-02; route through the lead):** C1 and C2 need serverbound slot encoding with REID (VarInt slot ids in `window_click`) and `block_place`/`use_item` working on 1.12 (the `use_item` extra fields in the mineflayer patch). Please confirm that they work, or say what is missing. Also: can the `place_block.js` 500 ms `blockUpdate` wait be made configurable (seam-map C)? A lagging RotN server makes placements report failure. **I will tell the lead 1-2 PRs before C1** (that is, when B2 opens), so the lead can respawn net-forge or verify the current encoding in a probe first.
3. **rotn-data:** for C1, does `recipesFor` give ingredients with oredict members and meta expanded, so that I can match by output and ingredients? For C2, which blocks are the surface rock piles (`pyrotech:rock_pile`?) and what do they drop? The 20 recipes with `matchesSample: false`: I will check whether any is in the early-game set and report back.
4. **harness-ops:** G3 scenarios for (a), (b) and (c), plus "the queue survives a restart". I will post the command and log contract for each as my PRs land. A first exploratory probe batch for the open items above would de-risk C2/C3; that needs the lead's GO.
5. **Lead (`src/models/`, lead-owned; found during A1):** the model layer printed whole error objects too. **Done in #104** under the lead-approved exception, extended by the lead to `prompter.js:327`:
   - `openrouter.js:49` (the whole SDK error) and `:40` (the whole response body when there are no choices);
   - `prompter.js:124-125`, `:131-132` and `:238` (`safeStack`), and `:327` (the goal parser's `err` through `safeError`; the raw model reply stays, as does line 234).

   **Still open, for the lead to decide:**
   - The providers the bot does not use (claude, gpt, gemini, ollama, ...) still print `console.log(err)`. Only OpenRouter is used (PLAN).
6. **Lead and harness-ops (A2b):** Mindcraft task files are now refused unless the env var `MINDCRAFT_ROTN_ALLOW_TASK_FILES` is exactly `1`. No `settings.js` key is needed. Please keep it out of the CX23 env file, and harness-ops: keep it out of the runner's env allowlist for G3 gate runs (a test-only batch may set it, and its evidence should then say so).
7. ~~Lead: `_model_map.js` should skip `*.test.js`~~: done by the lead in #121.
8. ~~Lead: the skills name space for B1b~~: **accepted** (2026-11-02). The command boundary hands skills the bot's 1.12 names in rotn-data's `formatOld` convention; a 1.21 name maps to its exact variant (`oak_log` = `log:0`, oak only), a plain 1.12 `log` means any log. No ADR; documented in the B1b PR.
9. ~~rotn-data: `isHuntable` reads the 1.21 baby flag~~: done in #125 (`mc.isBaby`, index 12). My follow-up: switch `names112.isBaby` callers to `mc.isBaby` (queued).
10. ~~Lead: `getDetailedCraftingPlan` reading ingredient metas~~: decided (lead): it goes to rotn-data (the `mcdata.js` recipe helpers), low priority, after G3 unless C1 needs it.
12. ~~rotn-data (from D2c, #186): a structured do-not-look field~~: **done in rotn-data #187** (`lookAt`). #190 switches `threats.js` to `lookAt === false`, which now also covers the ender creeper and the cockatrice. The data notes (the gorgon, ender dragon, wither, ghast, blaze, zombie horse) are **done in rotn-data #188**: the gorgon is now `avoid` with `lookAt: false`, rechecked on develop and asserted in #190's test.
13. ~~Lead: `prismarine-recipe` as a direct dependency~~: the lead is adding 1.5.0 in a lead PR (2026-11-04).
14. **net-forge (FYI, via the lead):** C1 follows your Request 2 rules: `bot.craft(recipe, 1, table)` with a prismarine-recipe `Recipe` built from bot.registry ids and canFill's real stack metas (never 32767), the result with rotn-data's exact count and meta, NBT results and `remaining` refused, and auto-eat paused around the craft.
11. ~~Lead: forced commands from any player~~: **decided** (lead): forced `!` commands from anyone who is not a task giver are refused; they may still chat. Done in #146: their typed commands are refused, and in LLM replies to them only queries run, never actions.

## Open PRs

- **#195** (D2b-1, `!buildShelter`), waiting for the lead's review; **#198**, the #194 follow-up (branch `agent/skills-rotn/craft-fill-followup`). Merged: #194 (C1, `06ad75f`), #190 (do-not-look from `lookAt`), and #189 (P1 passed: 4/4 RotN crafts, including the stone pickaxe at a FastWorkbench table; modded item ids accepted in clicks; 5/5 placements in 589-1158 ms).

## Resumed (session 3, 2026-11-04, respawned by the lead after the usage-limit pause)

- `agent/skills-rotn/rotn-crafting` matched origin (`89e1b694`); develop had not moved (`88c02bc`).
- **C1, crafting execution: #194 merged** (`06ad75f`). When `bot.recipesFor` finds no variant (bot.registry's RotN variants are capped, so a mix of rock kinds can be missing) but rotn-data's `canFill` says the items fit, `craftByFill` crafts from canFill's assigned stacks: `filledRecipe` + `fillNow` (craft_needs.js) and a prismarine-recipe `Recipe`, one craft at a time, re-judged each time, at a found or placed crafting table (`bot.craft(recipe, 1, table)` at the FastWorkbench table, as P1's probe did).
  - Added on resume, from net-forge's Request 2 rules: auto-eat is paused around every `bot.craft` (`craftPausingAutoEat`, both paths; an eat under way gets up to 3 s); a recipe with an NBT result or container items left in the grid is refused with a clear error; a table `craftRecipe` already placed is reused, not placed twice.
  - Tests: `craft_needs.test.js` 21/21 (the full mixed-rock `!craftRecipe` test fails on the old skills.js); `src/agent/**` 204/204; lint 254 (baseline OK).
- **#194 review follow-up, #198: merged** (`6cd1f66`) (lead: items 1, 2 and 5 are required before the G3 (a) batch), branch `agent/skills-rotn/craft-fill-followup`:
  1. each craft counts only when the item's real inventory count grew, and the loop stops when it did not;
  2. a table placed for the craft (by `craftByFill` or `craftRecipe`) is picked up in a `finally`, so also when `bot.craft` throws; the throw is logged with `safeError`;
  3. nit 3: a missing recipe id logs that cause;
  4. nit 4: no free space for a table logs that, instead of a TypeError.

  Item 5: tests for the 2x2-grid canFill crafts (the crude axe twice; Crafting Tools from a damaged crude axe, never the wildcard meta), the stop on no gain, and the table picked up once after a throw and after a craft. Tests: `craft_needs.test.js` 26/26 (the 5 new ones fail on the old `skills.js`); `src/agent/**` 209/209; lint 254.
- **D2b-1, `!buildShelter`: #195 merged** (branch `agent/skills-rotn/shelter-build`, base develop). `library/shelter.js` builds a closed 1x2 space with sturdy walls and roof from inside:
  - it picks the site within 4 blocks that needs the fewest blocks;
  - it counts first: 10 blocks on open ground, including a roof prop;
  - it digs and replaces dirt or wood in the walls;
  - run again inside a breached shelter, it repairs it;
  - a solid floor is kept even when it is not rock (known limit).

  `unstuck` now leaves `action:buildShelter` alone; that test fails on the old `modes.js`. Tests: `shelter.test.js` 6/6; `src/agent/**` 206/206; lint 254.
  - **#195 review (REQUEST CHANGES), fixed in `1db6abf3`:**
    1. each site is dry-run first: no digging under a falling block or next to a liquid outside the shell;
    2. a pickaxe that can dig the walls is required before sealing in;
    3. only sites where every cell has a support face are chosen;
    4. a cell is retried once after `LATE_UPDATE_MS` (1200 ms) and a fresh `blockAt` look;
    5. nit: no build when centring fails;
    6. nit: `unstuck` is off only while the bot builds at the site (the `bot.rotnStationary` flag);
    7. the fake world models the hitbox, reach, falling blocks, liquids, a ledge and late updates.

    Reply posted. Tests: `shelter.test.js` 10/10; `src/agent/**` 210/210; lint 254.
- **#202** (the #198 follow-up: `craftRecipe` picks up a table it placed in a `finally`, and guards a missing free space): approved by the lead, merge pending.
- **D2b-2, the night routine: #204 open** (branch `agent/skills-rotn/night-routine`). `src/agent/night_routine.js`, `nightTick`, sits in the priority stack after control holds and before tasks. No LLM calls.
  - **Dusk:** at `SHELTER_LEAD_MIN` before sunset (by `NightClock`), it stops the self-prompter at the checkpoint and builds a shelter. A task or the agenda that was running resumes later with no new run.
  - **Inside:** every 10 s it repairs a breach at the same site. If the bot was pushed, teleported or walked out, it builds a new shelter where the bot is.
  - **Full daylight:** after the sunrise, it digs out one side with no liquid outside and hands back to tasks and the agenda.
  - **No shelter:** after 3 tries (30 s apart) the bot stays put until morning ("exposed").
  - **Modes:** while sheltered, the modes that would walk, dig or light the bot out are quiet (`SHELTER_QUIET_MODES`). `self_defense` comes back while a wall is open; `self_preservation` always acts.
  - **Agenda:** the cobblestone step aims for 10, the open-ground shelter.
  - `settings.night_shelter: false` turns the routine off (lead-owned settings; default on).
  - **Review nits folded in:** a crafting table whose block update comes late is found on a second look; tests for placed=true into `craftByFill` with no recipe id and with a 2x2 recipe; a site the caller names is refused when a cell has no support.
  - Tests: `night_routine.test.js` 9/9; `shelter.test.js` 11/11; `craft_needs.test.js` 33/33; `src/agent/**` 236/236; lint 254.
  - **#204 review (REQUEST CHANGES), fixed in `a36c3cd1`, reply posted:**
    1. while a reflex acts nothing starts, and an interrupted build is not a try;
    2. an unusable shelter (fire, lava, a block inside) is left for a new one;
    3. at dusk a running action gets 60 s, then it is stopped; at night at once;
    4. a giver's typed `!goal` runs first, and the giver is told once;
    5. `digOut` uses the build's safety checks and verifies the exit;
    6. reset on death and spawn (`Agent.bindNightReset`) and when the routine is off;
    7. nit: a mob in a wall cell is named.

    Tests: `night_routine.test.js` 16/16; `shelter.test.js` 12/12; `src/agent/**` 244/244; lint 254.
  - **Lead decisions on #204 (2026-11-04), recorded in the PR:**
    1. no shelter possible: idle until morning with reflexes is accepted for now; the G3 (b) smoke run shows whether a dig-into-a-hillside fallback is needed;
    2. night above tasks is accepted; typed commands, `!stop` and `!pause` still act at once.
- **Next (lead order):**
  1. the #204 review (and #202's merge);
  2. D1: eating, and re-planning after teleports (AggroTP) or invasions:
     - **D1a, eating: #206 open** (branch `agent/skills-rotn/eating`). An `eating` mode eats by rotn-data's food values (auto-eat sees only vanilla foods and ate the bread first; it is off now):
       - at food 12 or lower when idle, and at 6 or lower during an action;
       - never hawthorn berries, cloudsbluff or the vanilla bad foods;
       - bread only when nothing else is left.

       Tests: `food.test.js` 5/5; `src/agent/**` 224/224; lint 254. Request to rotn-data (via the lead) in the PR: a structured "harmful food" field.
     - **D1b next:** re-plan after a position jump of 5 or more blocks (AggroTP), and after a title message (a possible invasion);
  3. D3: the death report.
