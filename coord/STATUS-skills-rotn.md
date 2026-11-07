# Status: skills-rotn

Updated: 2026-11-07T07:10Z (from `date -u`)

## Round 9 B fix (e): digging at the shelter is noticed while it happens (branch `agent/skills-rotn/shelter-dig-alarm`, 2026-11-07T14:23Z by `date -u`)

- **Task (lead, 2026-11-07, round 9 B fixes, priority 2):** at 13:35:22 the 10-second check found the east side already open, with the zombie in it (`r9-g3b/night/server.log` 536-537). Epic Siege Mod's digging shows first as block break progress, which mineflayer emits as `blockBreakProgressObserved(block, destroyStage, entity)`.
- **Change (`night_routine.js`):**
  - Once per bot, the routine listens for that event. Digging seen on a shelter block (`shelterShell`) while the bot is inside raises an alarm: it logs "[night] zombie is digging the shelter at …: checking at once, ready to repair" and puts a block in hand (sturdy first, else dirt).
  - For `DIG_ALARM_MS` (15 s) after the last such event, every tick checks the shelter instead of every `CHECK_MS` (10 s), so the repair starts on the tick after the block breaks.
  - A reset, leaving for a giver, and a new shelter clear the alarm.
- **Tests (`night_routine.test.js`, 1 new):** digging 5 blocks away does nothing. Digging the east wall makes the next tick check at once (well before `CHECK_MS`) with dirt in hand, and when it breaks through the repair starts on the next tick.
  - **On develop it fails:** "checked at once, not after CHECK_MS", 0 checks.
  - With the fix: `night_routine`, `shelter`, `night` and `priority`, 87/87. Lint: 0 in both files, as on develop.
- **Unverified:** that Epic Siege Mod's digging (ESM-Tweaks' digging AI) sends the break progress packet. Its config talks of partly mined blocks being "visually reset", which suggests it does. If it doesn't, nothing changes: the 10-second check stays.

## Decision (1) after round 9 B: low health in the night shelter, the bot stays (branch `agent/skills-rotn/shelter-hold-flee`, stacked on #331; 2026-11-07T14:48Z by `date -u`)

- **Task (lead, 2026-11-07):** "self-preservation in an open shelter at night: stay put, eat, block or fight within reach; leave only for fire, lava or drowning". A new PR after #331, with nothing pushed to #331.
- **Change (`modes.js` self-preservation):** the low-health flee (`moveAway(20)`) no longer runs while `bot.rotnSheltered` is set, whether the shelter is closed or open. Instead:
  - while the night's repair runs (`REPAIR_LABEL`), nothing; the repair closes the opening;
  - else a mob within reach is hit in place (`skills.defendInPlace`, from #331);
  - else, below food 20 with food held, the bot eats (`food.chooseFood`/`eatFood`).
  - The hazard branches before it are unchanged: water at the head, a falling block above, fire, lava and molten metal. Outside the shelter nothing changes.
- **Tests (`shelter_defense.test.js`, 2 new):**
  - Hurt in the open shelter with a zombie in reach: hit in place, no walk.
  - Hurt with nothing in reach: eats bread, no walk, no fight.
  - Hurt while the repair runs: no interrupt.
  - **Both fail on #331's head.**
  - With the change: `shelter_defense`, `threat_arbitration`, `night_routine`, `quiet_reflexes`, `update_loop` and `food`, 63/63. Lint: modes.js 28, as on #331; the test file 0.
- **Question:** a falling block above the head (sand, gravel) still moves the bot 2 blocks away, out of the shelter. I kept that with the hazards because it would suffocate the bot, like drowning. Say if it should stay put too.

## Round 9 B fix (c): self-defense never takes the bot out of its night shelter (branch `agent/skills-rotn/shelter-hold-defense`, 2026-11-07T14:17Z by `date -u`)

- **Task (lead, 2026-11-07, round 9 B fixes, priority 2):** at 13:35:22 a digging zombie (Epic Siege Mod, `minecraft:zombie` "Digging": true) opened one side of the dirt shelter. Self-defense interrupted the night's repair (`r9-g3b/night/driver.log` 471), and `defendSelf` walked out after the zombie: its `GoalFollow`/`GoalInvert` walks, and `pvp.attack`, which follows its target. The bot died outside at -78 58 -60 (487).
- **Change:**
  - **`library/night.js`:** adds `REPAIR_LABEL` (`action:repairShelter`). The night routine runs its repair under that label; the first build keeps `action:buildShelter`.
  - **`modes.js` self-defense, in the shelter with a wall open:**
    - it does not start while the repair runs;
    - it fights only a mob within reach (`SHELTER_FIGHT.reach`, 3 blocks from the feet);
    - it fights with the new `skills.defendInPlace`: look at the mob, `bot.attack`, every 600 ms, no pathfinder and no mineflayer-pvp.
  - Outside the shelter nothing changes.
- **Tests (new `src/agent/shelter_defense.test.js`, 3):**
  - the repair is not interrupted;
  - a zombie in the opening is hit in place until it dies, with no walk, no pvp and the bot not moved;
  - a zombie 5 blocks away is not chased.
  - **On develop all 3 fail,** run with develop's label `action:buildShelter`: the repair is interrupted by `mode:self_defense`, `defendSelf` walks (`GoalInvert(GoalFollow)`), and a fight starts at the far zombie.
  - With the fix: `shelter_defense`, `night_routine`, `threat_arbitration`, `quiet_reflexes`, `update_loop`, `shelter`, `night` and `threats`, 96/96. Lint: no new errors (modes.js 28 and skills.js 20, as on develop; the others 0).
- **#331 review (lead, REQUEST CHANGES on f54db6c), answered (2026-11-07T14:56Z by `date -u`):**
  1. **Any hostile mob in reach is hit, whatever the plan says.** In the shelter, self-defense hits any hostile mob within reach (`threats.shelterEnemy`: any mob rotn-data does not ignore, never a calm one or the enderman family). Before, two zombies, a skeleton or a creeper near made the plan 'flee', with cowardice quiet, so nothing was hit.
  2. **The fight goes on while an enemy is in reach,** not only while the plan says fight.
  3. **`defendInPlace` is capped:** `maxMs` 6 s, `maxSwings` 8, and 4 hits on one mob whose known health did not drop. Afterwards self-defense rests `restMs` (1.5 s), so the night routine repairs first.
  4. **While a wall is known open, every tick checks and repairs,** not every `CHECK_MS`. The "open … repairing" line is said once and then only logged, and a check that finds it closed again restores the shelter's rules.
  5. **Folded in from #341 (the lead's decision):** at low health in the shelter the bot stays. The repair goes on, else it fights in reach, else it eats. It leaves only for fire, lava, drowning or a falling block. #341 is to be closed.
  - **#334 nit:** `defendInPlace` equips the weapon just before each swing and sets `bot.rotnFightingInPlace` while it runs. When develop is merged into #334, its dig-alarm handler will skip the block equip while that flag is set.
  - **Tests:** 6 new or changed in `shelter_defense` and `night_routine`; all 6 fail on f54db6c. With the changes: 8 related files, 107/107. Lint unchanged (modes.js 28, skills.js 20, the others 0).

## G4 item 11 prep: the task queue and agenda across a restart (branch `agent/skills-rotn/g4-restart-prep`, HOLD PR; 2026-11-07T06:55Z by `date -u`)

- **Task (lead, 2026-11-07):** check offline that after a process restart (a) the agenda continues at the same step, with no step done twice and no attempt-counter reset; (b) a giver's queued task is still queued and runs; (c) a task running at the restart is resumed or reported, not silently dropped; (d) a `!stop` hold survives the restart.
- **Design as found** (`agenda.json`, `tasks.json` and `control.json` are written atomically):
  - (a) `done_at` and `spent` are kept, so a done step stays done. Every run is saved when it starts (`recordAttempt`), so a restart never resets the count. The restart's own run counts: at once with the self-prompter restored from `memory.json`, otherwise after the back-off, which doubles per run. A crash loop therefore ends with the step stuck (at the first tick once its 3 runs are spent), never with endless runs.
  - (b) A queued task stays queued and runs.
  - (c) A task that was active is queued again at load and runs again, with its spent budget kept (in the task).
  - (d) The hold is reloaded, so the first tick returns `held:stop` and stops a restored self-prompter. Nothing restarts until `!resume`.
- **Gaps found and fixed** (their tests fail on develop):
  1. **(a), (c): a restart looked like a new start.** The agenda said "agenda step <id> started: …" again for the step it was on, and a task that was running said "task <id> started: …", so nothing reported that it was interrupted.
     - Now the first such line after a restart ends with " (resumed after a restart)": `Agenda.loadedActive`, and `TaskQueue.requeuedAtLoad` (in memory, from the load).
     - The lines keep the "started:" form that harness-ops' parsers match (`agendaActive` in `g3-task-preempts-agenda.mjs`, `TASK_TAKEN` in `g3-untrusted-refused.mjs`). A test runs both parsers on the new lines.
  2. **(d): under a stored hold, startup restored upstream's self-prompter** from `memory.json`. That sent one LLM request before the first `autonomyTick` (about 300 ms later) stopped it. Now `_setupEventHandlers` does not restore it while a hold is stored, and logs `[control] not restoring the self-prompter: on hold (…)`. After `!resume`, the agenda or the task drives it again from its own files.
- **Tests:** 6 new in `priority.test.js` (`fakeAgent` and `harnessAgent` take a `dir`, so a restart reuses the same files); 4 of them fail on develop. The existing "stored as active and taken over after a restart" test now expects the restart suffix. 14 `src/agent` files plus 6 `test/unit` files: 379 pass, 1 skipped (a `test/unit` test outside this change), 0 fail. Lint: unchanged.
- **For the G4 scenario (harness-ops):** after `ctl restart`, look for "agenda step <id> started: <short> (resumed after a restart)" for the same step (with no "agenda step <id> done" again for earlier steps), and "task <id> started: <text> (resumed after a restart)" for a task that was running.
- **Note:** this branch and #323 both append tests at the end of `priority.test.js`. Whichever merges second needs develop merged in.
- **#327 review (lead, APPROVE WITH NITS on `9098c02`), answered (2026-11-07T07:10Z by `date -u`):**
  1. `Agenda.start()` clears `loadedActive` (after its early return for an agenda already active). So `!agendaStop` then `!agendaStart` before the first step line is a fresh start with no restart label. Test added.
  2. The PR body now says that while a hold is stored `handleLoad` is skipped, so a giver's own `!goal` text and a stored PAUSED state are not restored either. The agenda and task goals are rebuilt from their own files after `!resume`.
  3. (optional, done) `TaskQueue.setStatus` drops a task from `requeuedAtLoad` once it is closed (done, failed or cancelled) before it restarts. Test added.
  - Tests: 382 run, 381 pass, 1 skipped (`test/unit`), 0 fail. Lint 0 in the touched files.

## Round 9 B fix (a): leaves out of reach no longer use up the stick attempts (branch `agent/skills-rotn/sticks-unreachable-leaves`, 2026-11-07T14:07Z by `date -u`)

- **Task (lead, 2026-11-07, round 9 B fixes, priority 1):** in round 9 B, `!collectBlocks("stick", 3)` reached none of three leaves at y 73 that had passed the ground check. Each logged "Could not reach … from the ground; skipping it" and used one of the 3 attempts, so the run ended "Collected 0 stick." and no tree was tried (`r9-g3b/night/driver.log` 128-134). Four more collects tried the same three leaves (149-151, 207-209, 264-266).
- **Change (`skills.js` `collectBlock`):**
  - A leaf that is out of reach after the walk uses no attempt.
  - After `COLLECT_LIMITS.unreachableLeaves` (3) such leaves, the collect takes no more leaves and says so. Trees and far dead bushes then get the attempts.
  - Each such leaf is remembered for this bot for `unreachableMs` (10 min), so the next collect does not walk to it again.
- **Tests (`collect_sticks.test.js`, 2 new):** the fake gains loose leaves and walks that get nowhere.
  - The round 9 B shape: 3 unreachable leaves, then a tree within 2 attempts, and the next collect does not walk to those leaves.
  - The cap of 3 per collect.
  - **Both fail on develop:** "Collected 0 stick." after the "Could not reach" lines, and `unreachableLeaves` undefined.
  - With the fix: `collect_sticks` 12/12. `collect_rotn`, `fall_safety`, `fell_tree`, `dirt_piles` and `axe_chop`: 72/72. Lint: no new errors (skills.js has the same 20 upstream errors as on develop; the test file has 0).
- **Next:** (b), `trunkshell` as a tree part, on its own branch. Request to rotn-data via the lead: confirm from the Dynamic Trees jar that breaking `dynamictrees:trunkshell` fells the tree (`BlockTrunkShell` forwarding the break to the thick branch inside).

## G4 item 3 prep: stop, follow, come (branch `agent/skills-rotn/g4-control-prep`, branch only while develop is frozen; 2026-11-07T05:50Z by `date -u`)

- **Task (lead, 2026-11-07):** check offline that `!stop`, `!followPlayer` and `!goToPlayer` work on 1.12.2 with RotN's pathfinder settings and the task-giver rules; add tests for any gap; fix on the branch only. The branch also has the two cosmetic nits after #321.
- **Design as found, now covered by tests:**
  - **Only task givers command.** A non-giver's typed `!followPlayer`, `!goToPlayer` or `!stop` runs nothing and sets no hold; they get "Sorry <name>, I only run commands from task givers." (new test).
  - **A giver's `!stop` beats the agenda and a running task.** The action stops at once and the self-prompter stops. A stored `stop` hold (`control.json`, kept across a restart) returns `held:stop` on every tick, so nothing restarts by itself until a giver types `!resume`. The step or task then resumes without using a new run of its budget. The task case was tested already; the agenda case has a new test. The model's own `!stop` stops only the action.
  - **A giver's typed action holds tasks and the agenda while it runs** (`held:command`), then autonomy carries on by itself. That is "come" (`!goToPlayer`) and "follow" while it runs.
- **Gaps found and fixed (tests fail on develop):**
  1. **A typed follow died at the first reflex.** A reflex (item pickup, self-defense, unstuck) interrupts the follow, the typed command returns, and the hold ended. The agenda's self-prompter then started within one tick (300 ms), and the action manager never resumes while the self-prompter is active, so the agenda took the bot over. Now a giver's typed resumable action that a reflex interrupted keeps `held:command` until it resumes, until `!stop` cancels it, or until it ends by itself (`control.typedResume`, checked in `autonomyTick`). The model's own follow holds nothing.
  2. **An unknown player threw.** `goToPlayer` and `followPlayer` read `bot.players[name].entity`, which is a TypeError for a name not online. Now they say "Could not find <name>: not online, or too far away to see." A name in the wrong case ("jqdaw") is found (`findPlayer`).
  3. **The follow was not fall-safe.** It walked with plain `pf.Movements`; now it uses `fallSafe(...)`, so there is no drop over 3 blocks and never a broken Dynamic Trees branch. `goToPlayer` walks through `goToGoal`, which was fall-safe already.
  4. **The follow outlived the player.** It went on after the player left or went out of sight (a stale entity). Now, with no entity, it waits `FOLLOW_LIMITS.lostMs` (12 s) and says "Lost sight of <name>; waiting up to 12 s for them." If the player is back within that time (a respawn, a dimension change, a short loss of tracking), it says "Following <name> again." with a new goal. Only after 12 s does it stop with a line and clear the goal, and then `!followPlayer` cancels its resume, so it does not retry every second.
  5. **`goToPlayer` said "You have reached" after a stopped walk.** Now it says "Did not reach <name>." and returns false.
- **Tests:** new `follow_player.test.js` (7) and 4 new tests in `priority.test.js`; 9 of the 11 fail on develop (the 2 design tests pass). The 27 test files that import the touched code: 373/373.
- **Lint:** `skills.js` went from 20 to 18 errors (two upstream missing semicolons on the replaced lines), so `test/lint-baseline.json` is lowered from 253 to 251 as the ratchet requires. The other touched files are unchanged.
- **For the G4 scenario (harness-ops):** a follow ends with `!stop` (then `!resume` for the agenda), when the player has been out of sight for 12 s, or when its resume could not be started (below). The log lines are "You are now actively following player <name>.", "Lost sight of <name>; waiting up to 12 s for them.", "Following <name> again.", "Stopped following <name>: not seen for 12 s (they left, or are too far away to see).", and "You have reached <name>." / "Did not reach <name>.".
- **PR #323** (title "HOLD until after G3 round 9/gate: …"). The lead approved the lint baseline 253 → 251. **#323 review (lead, APPROVE WITH NITS on `9b6c07d`), answered (2026-11-07T06:31Z by `date -u`):**
  1. **MUST, a stall without 'idle':** the action manager resumes only on 'idle', and an interrupted action emits none (`onTeleport` stops the action and starts nothing). Now, when a giver's follow waits to resume and nothing has executed for `TYPED_RESUME.waitMs` (5 s), `autonomyTick` calls `resumeAction()`. After `TYPED_RESUME.kicks` (3) tries that did not start it, the hold is dropped, the resume is cancelled, and the bot says "<giver>'s !followPlayer did not resume after 3 tries; tasks and the agenda carry on".
     - Why resume rather than drop at once: the giver's command still stands, and a teleport should not end it. The tries are bounded, so tasks, the agenda and the night routine are never blocked for good.
  2. **The follow ended at the first missed entity:** now there is the 12 s grace above, and the claim is fixed here and in the PR body.
  3. **The hold matched the label only:** it is now tied to the giver's own follow (`control.typedResume.fn` is that follow's `resume_func`, and `by` is the giver). A follow the model starts in its place holds nothing.
  4. **New test:** the hold lasts while the resumed follow runs (no extra tries) and ends when the follow ends by itself (the real `followPlayer` returns false and `!followPlayer` cancels its resume).
  - **Tests:** `follow_player` 8/8 (the leave test now checks the grace period, plus a new come-back test) and 3 new `priority` tests. On `9b6c07d`, review tests 1 and 3 fail; test 4 is coverage and passes on both. The 27 files: 377/377. Lint: unchanged, baseline 251 OK.

## The leaves fallback is removed (branch `agent/skills-rotn/leaves-fallback-out`, 2026-11-07T04:58Z by `date -u`)

- **Task (lead, 2026-11-07, the last change before the round 9 freeze):** rotn-data #319's `leaves-sticks` rule is on develop, so the temporary `LEAVES_STICKS` fallback and `isPlainStick` come out of `rotn_sources.js`. The file is now identical to its version before #315 (`bffe1d59`). `worldSources('stick')` returns `fell-tree`, `leaves-sticks` and `deadbush-sticks`.
- **Test names (`collect_sticks.test.js`):** no title claims "never climbs" or "no climbing" any more. The fake's walks end on the ground (y 64), and a comment there says that a real walk never climbs a tree is proven in `fall_safety.test.js`. The leaves-source test now checks rotn-data's rule id, and that there is exactly one leaves rule.
- **Tests:** the 19 collecting test files, 248/248. Lint: 0 in both files.

## Task 3: "shelter_blocks started" before an earlier step's "done" is log order, not a step run out of order (2026-11-07T04:14Z by `date -u`)

- **Answer: no step runs out of order, and no code change is needed.** Two designed things meet:
  1. **The before-night reserve interrupts.** `judge()` returns `reserveWanted(state) ?? step` (G3 round 6 B). Near sunset, `shelter_blocks` takes the self-prompter's goal from whatever step is current, says "started", and afterwards "agenda resumed: <step>".
  2. **"Done" is when a step's condition is first seen true.** Each step is judged from the inventory on every tick, whatever its place in the order. An action or a pickup that finishes after the reserve took over is recorded on the next tick.
- **Round 8 A** (`g3a-20261107-r8/rocks/server.log`):
  - 02:24:32 "shelter_blocks started" interrupted sticks.
  - 02:24:34 "logs done": the felled spruce's logs had been picked up. Logs is step 4 and was only recorded; the bot did not work on it.
  - 02:25:06 "agenda resumed: sticks".
- **Validation** (`g3d-20261107-v1/untrusted`):
  - 01:55:18 "crude_axe started", and the bot issued `!craftRecipe("pyrotech:crude_axe", 1)` under that goal.
  - 01:55:35 the reserve took the goal.
  - 01:55:37 "crude_axe done" when the craft already running had finished. The next reply ("I already had one … Now for the shelter blocks") shows it.
- Round 8 B and C show the same pattern. C's "agenda resumed: first_plank" at 03:25:16 is the task preempt (scenario C).

## Round 8 B cursor: equip to the hand is one number-key swap (branch `agent/skills-rotn/equip-hotbar-swap`, 2026-11-07T04:13Z by `date -u`)

- **Task (lead, 2026-11-07):** in round 8 B, three equips in a row were rejected at slots 36-38. Each resync showed the stone pickaxe on the cursor, and "put the stone_pickaxe on the cursor into slot 9" did not clear it (#313, `g3b-20261107-r8/night/driver.log:1020-1028`).
- **Finding:**
  - The put-down did take. Each `[inventory] … trying once more` line is the first try of a separate `equip`, so 36, 37 and 38 are three equips; a retry's failure was not logged.
  - With a full hotbar, mineflayer 4.33's `equip` (`simple_inventory.js`) moves the item into its least recently used hotbar slot with `moveSlotItem`: pick up, put down (a swap), put back. Each new equip found the pickaxe in slot 9 and lifted it onto the cursor again. The server rejected the swap into the hotbar slot and kept the pickaxe on its cursor.
  - Also, #296's retry ran `equip` with the same Item object, whose `.slot` was stale after the resync.
  - Which hotbar stack made the server's view differ is not in the log: the server log has nothing, and the driver log does not list hotbar slots.
- **Fix (`inventory_sync.js`):**
  - An item in the main inventory goes to the hand with one number-key click, `clickWindow(slot, k, 2)` then `setQuickBarSlot(k)`, where `k` is an empty hotbar slot or else the selected one. There is no cursor and no put-down, and for this click the 1.12 server returns an empty stack, so no slot's contents are compared.
  - Every try, the retry included, takes the item from where the window has it now (`currentItem`).
  - A failed second try is logged.
  - Anything else (another destination, an item already in the hotbar, an open container) is mineflayer's `equip`.
- **Tests:** new `equip_hand.test.js`, 4/4. It uses prismarine-windows' real player window, mineflayer 4.33's `equip`/`moveSlotItem` as they behave with a full hotbar, and a fake 1.12 server that applies a click, then compares, and rejects a put-down into the hotbar.
  - On develop's guard the 3 behaviour tests fail, and a replay prints round 8 B's lines: "rejected … slot 36", "cursor: stone_pickaxe", "put the stone_pickaxe … into slot 9", "rejected … slot 37".
  - `inventory_sync`, `threats`, `use_on` and `dirt_piles` (37/37 with the new file) pass. Lint: 0 in both files.
- **#317 review (lead, APPROVE WITH NITS on `c76a1a9`), answered (2026-11-07T04:22Z by `date -u`).** origin/develop (with #311) is merged in, not rebased; this file's conflict is resolved with both sides kept.
  1. If the cursor still holds a stack after the tidy, `equipToHand` uses mineflayer's `equip` with the item as it is now. A number-key click does nothing while the cursor holds a stack.
  2. An item no longer in the inventory is an error: `[inventory] equip: the <name> is no longer in the inventory`, then a throw. The stale Item is never used, and through the guard there is no retry, because this is not a rejected click.
  3. `currentItem` searches the hotbar first, then the main inventory, then the off hand, so a copy in the hotbar needs no click.
  - **Tests:** `equip_hand` 6/6 (2 new tests, and `currentItem` gains the hotbar case); all 3 fail on `c76a1a9`. `inventory_sync`, `threats`, `use_on`, `dirt_piles` and `equip_hand`: 39/39. Lint: 0 in both files.
## Request 17: leaves give sticks (branch `agent/skills-rotn/leaves-sticks`, stacked on #311; 2026-11-07T04:02Z by `date -u`)

- **Task (lead, 2026-11-07):** rotn-data #312 found that leaves DO give sticks (Pyrotech: 1 stick half the time when a player breaks leaves).
- **Change:**
  - `collectBlock('stick')` breaks leaves reachable from the ground (Dynamic Trees leaves too), never climbing. The order is dead bushes, then leaves, both within 24 blocks; then trees, with #311's species detour; then bushes and leaves out to 64 blocks.
  - Leaves are told by the block, not by the rule's id, so rotn-data's coming `leaves-sticks` rule ranks the same. Until it lands, a cited, temporary `LEAVES_STICKS` fallback (the same 4 blocks, `countRange` 0-1) stands in. It switches off as soon as any rotn-data rule names leaves, and I remove it after their PR.
  - A leaf that gave nothing uses no attempt (capped, as for bushes), and leaves are never broken with shears.
  - Removed: `fell_tree.test.js`'s "leaves are no stick source" and the agenda's "Leaves drop no sticks". The goal text now gives the full order.
- **Order choice:** the lead asked for leaves after dead bushes and before felling a species that gave 0. I put leaves before **all** felling. rotn-data #312 says the stick count follows tree shape, not species, and leaves give a steady 0.5 per block for a few seconds' work. If the lead wants leaves after the first felling instead, that's a one-line change in `tierOf`.
- **Tests:** `collect_sticks` 10/10 (3 new; all 3 fail on #311's head). The felling tests use an out-of-reach canopy.
  - With and without rotn-data's `leaves-sticks` rule: `collect_sticks`, `fell_tree`, `fall_safety` and `agenda`, 79/79 each time. For the "with" run I checked out rotn-data's branch `world-sources.json` temporarily; it was not committed.
  - All 19 collecting test files: 248/248. Lint: unchanged.

## Round 8 A fix: sticks from dead bushes first, then other tree species (branch `agent/skills-rotn/stick-sources`, 2026-11-07T03:11Z by `date -u`)

- **Task (lead, 2026-11-07, approved after my round 8 A analysis):** A failed 3/7 at the agenda's sticks step.
  - The bot spawned on a canopy, its rock run took it to spruces, and two felled spruces gave 32 logs and 0 sticks.
  - A dead bush stood next to it, but `!collectBlocks("stick", 3)` went for a tree.
  - Not #296, #304 or the LLM: no craft was ever attempted.
- **Fix:**
  1. `collectBlock('stick')` breaks dead bushes by hand first, nearest first, before any tree.
     - The source is a cited fallback in `rotn_sources.js` (`DEAD_BUSH_STICKS`). It switches itself off as soon as a rotn-data rule names `minecraft:deadbush`, and I remove it in the PR after rotn-data's rule lands.
     - A bush that gave nothing uses no attempt (0-2 sticks each), and the same spot is never tried twice.
  2. A felled species that gave 0 of the item is tried last after that. This holds for this bot across collects (round 8 A's second spruce came in a new collect), and in memory only. With only that species left it is still felled.
  3. The agenda's sticks goal names dead bushes and the species switch. The 5-minute step budget is unchanged.
- **Tests (targeted only; develop frozen, no full suite during round 8):**
  - New `collect_sticks.test.js`, 4/4. On develop's code all 4 fail. The dead-bush test logs "Broke dynamictrees:sprucebranch but got no stick (it gave 3 log:1)" and "Collected 0 stick", as in round 8. The species test fells `sprucebranch@13`, not `darkoakbranch@-14`.
  - The 19 test files that use collecting (241/241) and `test/unit/g3-untrusted` plus `mindcraft-driver` (27 pass, 1 skipped) all pass.
  - `fall_safety.test.js`'s sticks-text test is updated to the new wording.
  - Lint: `skills.js` 20 errors, as on develop; the other touched files 0.
- **PR:** #311, opened during the freeze; it merges after round 8.
- **#311 review (lead, APPROVE WITH NITS on `7e20d43`), answered (2026-11-07T03:53Z by `date -u`).** origin/develop (with rotn-data #312) is merged in, not rebased.
  1. **MUST, free attempts:** only a rule whose yield can be 0 (rotn-data `countRange.min === 0`, the dead bush) breaks without using an attempt, and at most `COLLECT_LIMITS.freeMisses` (6) times per collect. Rock piles, River Cane and other by-hand rules count every break as before. `worldSources` now passes `countRange` through.
  2. **Bush radius:** dead bushes come first only within `handFirstRadius` (24). Then come trees; bushes up to 64 blocks away are the last resort.
  3. **Shears:** a dead bush is broken by hand or with any non-shears item. `equipForBlock` is not called for it, and held shears are switched off by `stopHoldingWhere` (shears have no tool class, so they are matched by name).
  4. **Species:** a species that gave 0 loses only to a tree at most `speciesDetour` (16) blocks farther. So a spruce-only area still fells the near spruce (rotn-data #312: the stick count follows the tree's shape).
  5. **Fallback removed:** `DEAD_BUSH_STICKS` is gone; rotn-data's `deadbush-sticks` rule is used.
  - **Tests:** `collect_sticks` 8/8 and `collect_rotn` 14/14 (one new test: rock piles that give nothing use 2 attempts, not 5). On `7e20d43`'s code, all 6 new or changed review tests fail. All 19 collecting test files: 245/245. Lint: `skills.js` 20 (same as develop), `rotn_sources.js` 0, tests 0.

## The goToGoal test is no longer flaky under load (branch `agent/skills-rotn/goto-test-load`, 2026-11-07T01:03Z by `date -u`)

- **Task (lead, 2026-11-07):** make `src/agent/library/use_on.test.js` "goToGoal: a walk that never arrives" robust under load without weakening it. My CX33 start report (#301) is merged, and develop is merged into this branch (this file's conflict resolved, both sections kept).
- **Cause:** the 1.5 s bound timed the whole `goToNearestBlock` call. Its first wood search in a process pays a one-off cold load of 1.1-1.3 s on the CX33 (a second identical call takes 13 ms). The bounded walk itself stopped at 300-301 ms every time.
- **Fix (test only, no skill code):** the fake pathfinder records each walk's time from `goto` to the `stop` that ended it. The test asserts one walk, stopped (not left running), ran 299-2000 ms against the 300 ms limit, plus the unchanged "time limit of 0.3 s reached" line.
- **Tests:** the file passes 15/15 and ESLint shows 0 problems in it.
  - Mutations: with the walk unbounded (the old bug), the test fails at the 5 s per-test timeout. With the limit firing at 50 ms, it fails with "the walk ran 52 ms; the limit is 300 ms".
  - Under load: 6 CPU burners on the 4 vCPU (load up to about 5.4), with the file run alternately with the old version. The old test failed 13/13 while the burners ran. The new one passed 20/20, 13 of them under load. The other 14 tests in the file never failed.
- **Review (lead, APPROVE WITH NITS on `da54e4b`), answered (2026-11-07T01:10Z by `date -u`):**
  1. origin/develop merged in, not rebased.
  2. `t.after(() => bot.pathfinder.stop())`: if the walk is ever unbounded again, the test still fails at its 5 s timeout, and the stop then ends the pending walk. `goToGoal` clears its door-check `setInterval` and node exits.
     - Shown with the unbounded mutation in scratch copies of `skills.js` and the test, deleted afterwards (`skills.js` is identical to develop). With the hook, node exits 1 after 6 s (the test is `not ok`, counted as cancelled). Without it, node was still hung at 40 s (killed by `timeout`).
  3. A comment says the "0.3 s" message assertion pins the exact limit, and 2000 ms is only a ceiling.
  - Tests: the file passes 15/15 and ESLint shows 0 problems.
- **PR:** #306, waiting for the lead's re-check.

## Report to the lead: up on the CX33 (session 4, 2026-11-07T00:32Z by `date -u`)

- **Where:** worktree `/home/mindcraft-RotN-worktrees/skills-rotn`, branch `agent/skills-rotn/cx33-start` from develop `c8323be8`. `npm ci` was already done. Node 22.23.4. `hcloud server list` is empty. I read CLAUDE.md, PLAN.md, my brief, this file and the lead's 2026-11-07 snapshot, and rebuilt my memory note from them.
- **Open PRs:** none. #296 (the round 7 B fixes) is merged as `cb24eaa5`. No local-only work. The old `agent/skills-rotn/*` branches were squash-merged; `night-threats` is stale, as noted below.
- **Check on this server:** `node --test 'src/**/*.test.js'` gives 481 tests, 480 pass and **1 fails, twice in a row**: `src/agent/library/use_on.test.js:181` "goToGoal: a walk that never arrives ends at GO_TO_LIMITS". It took 1574 ms against its 1500 ms wall-clock bound. The load average was about 5 on 4 vCPU while the other agents ran their checks. Run alone it passes 3/3. The lead's full `npm test` on `cb24eaa5` passed, so this is a timing-sensitive test, not a code fault. **Proposal (not started):** a small PR that makes the bound relative to the 300 ms limit with more headroom, or measures the time limit from the skill's own log line, so CI and the gate commit don't fail on a busy runner. I'll do it only if you give the task.
- **Next (waiting for a task):** the next smoke or gate findings for G3 (b). In the next B run, check the new "[night] the shelter at X is no longer usable: <block> at <pos> (<why>)" line and the `[inventory]` cursor lines (cursor put down, resync) to confirm #296 live.
- **Open requests (unchanged):** Request 1, the rest of it: `pause_when_empty: false` and `!searchWiki` in `blocked_actions` (settings.js, lead). FYI for net-forge: mineflayer 4.33 ignores the server's cursor packet (`set_slot` window -1, slot -1); #296 handles it in `src/agent`, and a mineflayer patch would be the cleaner home.

## Handoff (before the move to the dev server, 2026-11-06T21:49Z by `date -u`)

- **Open PRs:** **#296** (`agent/skills-rotn/r7-shelter-cursor`): the round 7 B fixes (the shelter check, cursor sync, rejected-click recovery, self-defense fights on). Full `npm test` 1360 pass, 0 fail, 3 skipped; lint 253. The lead's review (2 safety fixes and a nit) is answered in `3db993d0` (2026-11-06T22:16Z by `date -u`): water at head height in the bot's own shelter counts as unusable (drowning), and lava anywhere; after the first failed equip of a fight no more are tried; a cursor-stack drop goes to the bot's own log. develop (#297) is merged in. It waits for the re-review.
- **Branches:** everything is committed and pushed. Nothing is local only.
  - `agent/skills-rotn/r7-shelter-cursor`: #296.
  - `agent/skills-rotn/r7`: STATUS-only commits, already merged into #296's branch; no PR of its own.
  - `agent/skills-rotn/night-threats`: 2 old commits now pushed; their change (do-not-look from rotn-data's `lookAt`) is already in develop by another commit, so the branch is stale.
  - Every other `agent/skills-rotn/*` branch is merged.
- **Next task:**
  1. #296's re-review, if anything is left.
  2. Then the next smoke or gate findings for G3 (b), starting with what the new "no longer usable: <block> at <pos> (<why>)" line names in the next B run. Round 7 did not name the cause.
  3. Watch for `[inventory]` lines (cursor put down, resync) to confirm the cursor fix live.
- **Open requests:**
  - Request 1 (lead, `settings.js`), the remaining parts: `pause_when_empty: false`, and `!searchWiki` in `blocked_actions` (it returns vanilla 1.21 facts). `task_givers` and `allow_server_task_giver` are in.
  - FYI for net-forge: mineflayer 4.33 ignores the server's cursor packet (`set_slot` window -1, slot -1). #296 handles it in `src/agent`. A mineflayer patch would be the cleaner home, if net-forge wants it.


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
14. ~~rotn-data (via the lead, #206 review 1)~~ (answered by rotn-data #209: `foodValues`, `avoidFood`, `installFoods`): export `foodOf(name, meta)`, returning `{ hunger, saturation }` with the pack's `scripts/food.zs` values on top of the dump (bread 3, not 5), or `null` for a non-food. `food.js` uses it as soon as it exists, and a skipped test then checks bread 3. Also wanted: a structured "harmful food" field with sources, so `AVOID_FOODS` can leave the code.
15. **rotn-data (via the lead, D1b #212):** from the pack's `hordes-1.1.7` jar (`assets/hordes/lang/en_us.lang`) and any pack override, list the message keys and English texts sent at a wave or horde start, and whether each is a title, a subtitle or chat. The matcher then narrows from "names a horde" to exactly those.
11. ~~Lead: forced commands from any player~~: **decided** (lead): forced `!` commands from anyone who is not a task giver are refused; they may still chat. Done in #146: their typed commands are refused, and in LLM replies to them only queries run, never actions.
16. **DONE in #277 (merged; lead): no stop sequence for memory summaries, and a user turn.** Was: **Lead (`src/models/prompter.js`, `src/models/*.js`), round 5 A rerun item 4:** `promptMemSaving` calls `sendRequest([], prompt)`, so the prompt is the only message (system) and the stop sequence is the default `'*'`. Please consider sending the summary prompt as a user turn, and passing no stop sequence (or `null`) for the memory call, so a markdown summary is not cut at its first `*`. My profile change (plain text, no asterisks) only lowers the chance.

## Open PRs

- **#296** (`agent/skills-rotn/r7-shelter-cursor`): the round 7 B fixes, opened 2026-11-06T21:47Z after the lead lifted the code freeze. Details are in "Round 7 B fixes" below.
- Round 7 is over: A 7/7, B 4/5, C 7/7, D 7/7. No gate on that commit. **#291** (dirt piles) is merged as develop `42a8e94`.

## Round 7 B fixes (branch `agent/skills-rotn/r7-shelter-cursor`, 2026-11-06T21:30Z by `date -u`)

From the run: the bot was sealed in a shelter at -36, 69, -114 at sunset. About 8 min later it logged "no longer usable (fire, lava or a block inside)" without naming anything, and started a new build. Then a zombie came: self_defense's `equipHighestAttack` threw "Server rejected transaction for clicking on slot 16" (skills.js:62), the bot never hit back, and it died. After the respawn, mineflayer still showed `quark:tallow` on the cursor.

The log does not show what made the shelter unusable. The next run's line will name the block and where it is.

1. **The shelter check names what it found and where** (`shelter.js` `siteProblem`). The line is now, for example, "[night] the shelter at X is no longer usable: cobblestone at 0, 65, 0 (a solid block in the 1x2 space); building a new one".
   - Only real fire or lava (by rotn-data material), or a solid block in the bot's two cells (rotn-data `solid` with a collision box), ends a sealed shelter.
   - A dropped item (an entity) never counts. Neither do a torch, a carpet, a snow layer, water, or a floor change: when the floor goes, the bot falls, and the position check takes over.
   - Before, the name test `/lava|fire/` matched every `iceandfire:` block, and minecraft-data gives a carpet or a snow layer a `'block'` bounding box. Either one would have ended the shelter.
   - The repair (`buildShelter({site})`) uses the same rules. Its refusal names the block.
2. **The cursor and rejected clicks** (new `library/inventory_sync.js`, installed in `agent.js`).
   - **Cause:** mineflayer 4.33 drops the server's cursor packet (`set_slot` for window -1, slot -1). A 1.12 server sends that packet with the whole window after it rejects a click, and on a respawn. So mineflayer's cursor goes stale (the tallow), and clicks built on it are rejected.
   - **The fix:**
     - the cursor follows the server's packet;
     - before `equip`, `unequip`, `craft`, `toss`, `tossStack` and `moveSlotItem`, a cursor stack goes into a free slot, or is dropped when there is none;
     - a rejected or unanswered click waits for the server's resend (window and cursor, up to 1 s), clears the cursor again, and tries once more;
     - an operation run inside a guarded one is not retried again.
3. **Self-defense never stops because an equip failed** (`skills.js`). `equipHighestAttack` never throws. The fight goes on with what is in hand, with one line per fight: "Could not take the stone_sword in hand (...); fighting with wheat_seeds."

**Tests** (targeted only):
- `night_routine.test.js` (1 new, 1 updated), `shelter.test.js` (1 new), `inventory_sync.test.js` (4 new), `threats.test.js` (1 new).
- Run together with `use_on` and `dirt_piles`: 85/85 pass.
- On the old code:
  - the new night test and the updated one fail;
  - the self-defense test fails (the rejection is thrown);
  - the shelter test fails, at its first assertion with a stand-in `siteProblem`;
  - `inventory_sync` is a new module.
- Lint in the touched files: `agent.js` 11 and `skills.js` 20, as in the baseline; the other files 0.
- After the freeze lifted: full `npm test` 1363 tests (1360 pass, 0 fail, 3 skipped); `lint-baseline.mjs` 253 OK. Pushed as **#296**.

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
- **D2b-2, the night routine: #204 merged** (`f84efaa`) (branch `agent/skills-rotn/night-routine`). `src/agent/night_routine.js`, `nightTick`, sits in the priority stack after control holds and before tasks. No LLM calls.
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
  - **Develop merged in** (`28c2bbfc`, after #202's squash merge; I kept this branch's side, which only adds to the #202 tip); GitHub reports the PR as mergeable. `isFalling` now uses rotn-data's `falls()` from #205 (`2d653a4d`). `src/agent/**` 245/245; lint 254.
  - **#204 re-review (lead: two fixes, then merge), fixed in `66640bbc`, reply posted:**
    1. a giver's `!goal` or typed command from inside the shelter clears `rotnSheltered` and sets the state to building, so the bot shelters again after it; `!stop` and `!pause` keep it sheltered;
    2. `mobIn` counts only mobs and players.

    Develop (#211) was merged in first. Tests: `night_routine.test.js` 17/17; `shelter.test.js` 14/14; `src/agent/**` 250/250; lint 254; mergeable.
  - **Lead decisions on #204 (2026-11-04), recorded in the PR:**
    1. no shelter possible: idle until morning with reflexes is accepted for now; the G3 (b) smoke run shows whether a dig-into-a-hillside fallback is needed;
    2. night above tasks is accepted; typed commands, `!stop` and `!pause` still act at once.
- **Security fix (lead, required before D1b): #211 merged** (branch `agent/skills-rotn/task-giver-recheck`).
  - A stored task's giver is checked again with the current settings when the task starts and when a task stored as active is taken over (after a restart).
  - A giver who is no longer listed gets the task cancelled: `task <id> dropped: its giver <giver> is no longer a task giver`, with no task text, and its restored goal is stopped.
  - A takeover now says `task <id> started: …`.
  - Tests: `priority.test.js` 28/28 (the 3 new ones fail on the old code); `src/agent/**` 227/227; lint 254.
- **Next (lead order):**
  1. the #206 and #212 reviews (#204 is merged);
  2. D1: eating, and re-planning after teleports (AggroTP) or invasions (then D3, the death report):
     - **D1a, eating: #206 open** (branch `agent/skills-rotn/eating`). An `eating` mode eats by rotn-data's food values (auto-eat sees only vanilla foods and ate the bread first; it is off now):
       - at food 12 or lower when idle, and at 6 or lower during an action;
       - never hawthorn berries, cloudsbluff or the vanilla bad foods;
       - bread only when nothing else is left.

       Tests: `food.test.js` 5/5; `src/agent/**` 224/224; lint 254. Request to rotn-data (via the lead) in the PR: a structured "harmful food" field.
       - **#206 review (REQUEST CHANGES), fixed in `cd765ae6`, reply posted:**
         1. pack food values through rotn-data's `foodOf` when it exists; until then the dump's vanilla values, said once; no test pins vanilla values; the pack check (bread 3) is skipped until `foodOf` exists (Request 14);
         2. a consume that times out is judged by the food level and the item count after 1 s; the mode backs off 10 s, then 20 s, and gives up a food after 3 failures;
         3. `eating` now comes before `cowardice` and `self_defense`, so the bot eats at food 6 or lower in a fight; at 12 or lower only when idle with no threat near.

         Tests: `food.test.js` 8/8 plus 1 skipped; `src/agent/**` 227/227 plus 1 skipped; lint 254.
       - **On rotn-data #209 (merged), in `bb57f4e4`:**
         - develop merged in (not rebased: no force-push);
         - pack food values from `foodValues` (bread 3, beef 2, berries 1; an estimate for not-computed foods);
         - foods to avoid from `avoidFood` by meta, plus a short cited local list (hawthorn, chorus fruit, golden apples);
         - auto-eat's `bannedFood` from the same list, by name (all of `fish`, as auto-eat cannot see `fish:3`); auto-eat stays off.

         Tests: `food.test.js` 10/10; `src/agent/**` 237/237; lint 254; mergeable. Request 14 is answered by #209.
       - **Lead (2026-11-05):** #206 waits for rotn-data's pack food values PR. When that merges, I bring #206 up to date by **merging** develop in, not rebasing: rebasing a pushed branch needs a force-push, which the rules forbid. Then I drop the `foodOf` fallback check if the API differs, and the skipped bread-3 test runs.
     - **D1b: #212 open** (branch `agent/skills-rotn/replan-jumps`; develop with #204 merged in, so its diff is D1b only).
       - A `teleport_watch` mode: a horizontal jump of 5 or more blocks between mode updates stops the action and requests a re-plan; death and spawn reset it.
       - A horde warning: a title whose translation key or text names a horde, read from the raw 1.12 title packet, at most once a minute.
       - The #204 nit: a typed command under a stored stop, pause or quiet hold also ends the shelter rules (`typed > 0`).

       Tests: `hazard_watch.test.js` 4/4; `night_routine.test.js` 18/18; `src/agent/**` 255/255; lint 254. Request 15 (below): the exact hordes 1.1.7 message keys.
  3. D3: the death report.

## Session 3 (respawned after the Orca restart, 2026-11-05)

- The branch matched origin (`d60d9008`).
- **#212 review fixed, ready for re-review:**
  - `adf8420b` rewrites `hazard_watch.test.js` for the new API, then develop (#206) was merged in (`c5373dbc`).
  - Tests: `hazard_watch` 4/4; with `night_routine`, `quiet_reflexes`, `update_loop` and `food`, 47/47. Lint 254 (baseline OK).
  - The tests cover:
    - walking 8 blocks with no `forcedMove` gives no re-plan (review 3);
    - a forced move of 7 blocks stops the action and the pathfinder and requests a re-plan;
    - a respawn after a death is no teleport;
    - `EventEnd` and `TrySleep` do not match (review 2);
    - `onHordeMessage` works by forge and by the title fallback, once a minute.
- **Open:** forge-bridge's `hordes_hordeevent` event is not on develop yet. When it lands, `bindHordeWatch` calls `onHordeMessage(key, { via: 'forge' })` from it (review 1).
- **D3, the death report: #215 open** (branch `agent/skills-rotn/death-report`, from develop; merges cleanly with #212).
  - `library/death_report.js`: the loss is measured (the fullest of the last 3 samples taken while alive, against the inventory 3 s after the respawn), with the XP level and the cause.
  - One report per death: a `[death] died at ...; lost ...` log line, and chat at most once a minute. After 3 deaths in 10 min, one line, then log only.
  - The upstream LLM prompt per death is gone. A re-plan note gives the bot's own state only, never the server's death text.
  - If the bot is not alive 9 s after death, it asks for the respawn again every 3 s.
  - Tests: `death_report` 5/5; related tests 72/72; lint 254.
- **Lead REQUEST CHANGES on both; fixed, replies posted (2026-11-05):**
  - **#212, `29dba5e8`:**
    - The teleport watch resets on `respawn`, `mount` and `dismount`, and ignores forced moves and samples while dead (it was a false teleport on every death).
    - `bindHordeWatch` listens to net-forge's `rotn:horde` (#214), with the title as the fallback.
    - Tests: `hazard_watch` 4/4 (2 fail on the old code); related 40/40; lint 254.
  - **#215, `9c3cb655`:**
    - A death re-plan is due even when nothing ran (label captured at death; a `due` flag), except in a death streak.
    - The LLM note hedges the Corpse Complex claim.
    - `clearReplan` keeps notes for the next prompt.
    - Fixed 3 lint errors (`setImmediate`) that my earlier baseline run missed because the file was untracked.
    - Tests: `death_report` 6/6 (2 fail on the old code); related 81/81; lint 254.
- **Merged (lead, 2026-11-05):** #212 D1b (`70b1bb5`) and #215 D3 (`202b826`). STATUS now lives on `agent/skills-rotn/useon-bound` (#216), with develop merged in.
- **#216 merged** (lead, 2026-11-05). **The #216 follow-up PR is open** (branch `agent/skills-rotn/useon-followup`; STATUS lives here now):
  1. plank gain: the agenda judges `first_plank` from the inventory only (`plankWood`). A debarked log, a block change with `!useOn` returning true, is `logWood` and does not finish the step (new agenda test). `useToolOn` documents that true does not mean an item was gained, and the block-change line says "no item gained (not a plank or any other item yet)";
  2. the entity path: `equip`/`unequip` and `useOn` are bounded by the time left; `interrupt_code` is checked after the walk and before the use; the `nothing` path is bounded too;
  3. the walk timeout message gives the real limit (`within 0.3 s (the 0.3 s limit)` when the total limit cuts it);
  4. the upstream `!bot.game.gameMode === 'creative'` (always false) is now `gameMode !== 'creative'`: a missing tool is refused at once, `hand` needs none.

  Tests, one file at a time: `use_on` 7/7 (on the #216 code, 3 new tests hang or fail); `agenda` 14/14. Per-file lint: `skills.js` 20 (unchanged), the tests 0.
- **#217 merged** (lead, 2026-11-05, `c62f63d`). The G3 smoke batches are over (lead, received before 2026-11-05T19:23Z by `date -u`); normal targeted testing again.
- **G3 smoke findings (harness-ops #218, C+D evidence; they block G3 (a) and (c)):**
  1. **#221 merged** (lead, 2026-11-05): a queued task stops the self-prompter's action in flight after `PREEMPT_GRACE_MS` (5 s) (`action:` labels only; a reflex finishes on its own), then starts; every `goToGoal` walk has a total limit (`GO_TO_LIMITS`, 3 min) and the eight walking commands a 5 min action backstop; `goToNearestBlock`/`goToNearestEntity` return the real result. Tests: `priority` 29/29, `use_on` 8/8; on develop the new tests fail (priority) or hang (goToGoal). Related: `shelter` 14/14, `collect_rotn` 13/13, `names_e2e` 7/7, `night_routine` 18/18. Per-file lint unchanged.
  2. **#222 merged** (lead, 2026-11-05): rotn-data's `fell-tree` rule id now reaches `collectBlock`. After a branch break it waits for the fall (at most 6 s, until the drops settle), then walks to each drop within 12 blocks of the **branch** (8 s per walk, 30 s total) and counts the real gain from the inventory. Tests: `fell_tree` 3/3 (all fail on develop); `collect_rotn` 13/13, `rotn_names` 9/9, `names_e2e` 7/7, `use_on` 7/7. Per-file lint unchanged. Unconfirmed live: the fall time, how far the logs land, and the drop entity name.
  3. **#224 merged** (lead, 2026-11-05, `139239f`), the lead's required follow-ups from the #221/#222 reviews before the next G3 round:
     - per-command total limits kept inside the action (`ACTION_LIMITS_MIN`: `!collectBlocks` 10 min, `!attack`/`!attackPlayer` 3, `!buildShelter` 5, `!digDown` 5, `!craftRecipe` 3, `!smeltItem` 12, `!putInChest`/`!takeFromChest` 2, the walks 5, `!useOn` 2, and a few small ones). At the limit: interrupt, 5 s grace, then `!<name> failed: time limit of <t> reached; stopped.` The manager's timeout (limit + 1 min) stays the backstop;
     - `collectBlock`: each block is bounded (`COLLECT_LIMITS.blockMs` 90 s; then it is cancelled, given up and skipped), and so is the whole run (8 min);
     - the raw `pathfinder.goto` calls in `defendSelf`, `placeBlock` (step back: 15 s) and `moveAwayFromEntity` (30 s) are bounded;
     - `collectFelledDrops` waits for a count above the starting one, and logs "no drops appeared" instead of "Felled" when none came;
     - #221 nit: a giver's typed action is never preempted.

     Tests: `action_limits` 3/3 (new), `use_on` 11/11, `fell_tree` 4/4; on develop the new tests hang or fail. Related: 11 files pass. Lint 254.
- **Tracked (#222 review 3, not done):** stepping aside from a falling tree. Dynamic Trees can hurt entities in the fall path, and the rule says "Stand to the side". Check the damage in the next G3 (a) run before building it (chop from the side, then walk around).
  4. **#225 merged** (lead, 2026-11-05, `a7aecd0`), the #224 review follow-ups:
     - each limited command gets a run token (`bot.action_run`), marked aborted at the limit and cleared when the command ends. The chest, furnace and collect skills take it at their start and check it after their awaits: a late window is closed and nothing more is done;
     - `collectBlock` waits up to 5 s for a timed-out, cancelled break to end before it moves on;
     - `!craftRecipe`'s limit is now 4 min.

     Tests: `action_limits` 5/5 (the late-window test deposits on develop), `use_on` 11/11 (the collect test goes on before the break ends on develop). Related: 10 files pass. Lint 254.
     - #225 review fixes: `smeltItem` and `clearNearestFurnace` take the run on their first line, so a limit hit during the walk stops them before the furnace opens. Checks after the awaits were added in `craftRecipe`/`craftByFill` (a table placed after the abort is picked up again), in `goToPosition` (after the walk) and inside `collectBlock` (after the equip, the walk and the dig, before `autoLight`). Tests: `action_limits` 8/8 (the 3 new ones fail on the previous code); related 8 files pass; per-file lint unchanged.
- **G3 smoke round 2 running (lead, received before 2026-11-05T20:13Z by `date -u`, about 2 hours):** until the lead says it is over: no `npm ci`, no full `npm test`, no long node scripts; targeted test files only, one at a time.
- **#227 merged** (lead, 2026-11-05), the round 2 batch A findings:
  1. **Arbitration:** cowardice and self_defense claim the threat and hold it for `THREAT_HOLD_MS` (6 s) while their action runs; neither interrupts the other in that time. The low-health flee overrides the hold at once. The hold is released when the owner's action ends or fails (`execute`'s finally). `self_preservation` does not flee while dead. `PathStopped` is an interrupt (`goToGoal` returns false).
  2. **Player zombie** (`zombie_players:zombie_player`, matched by entity type; rotn-data #226): fought only with a weapon (a sword or axe, not a pickaxe) and health above half (> 10); otherwise avoided from 24 blocks. The name rule is gone.
  3. **Death spot** (`deathSpotBlocked`, for `!goToRememberedPlace` and `!goToCoordinates`, within 24 blocks of the last death, same dimension only): refused for 5 min; at dusk or night only within 20 min (one Minecraft day) of the death; and while a player zombie is loaded near the spot. The bot's shelter or home (places named home, shelter, bed or base, or the night site, within 4 blocks) is always allowed.
  4. **`!attack`** refuses an ignore-unless-provoked mob (a grove sprite) unless it hurt the bot (angry, or a hit within 3 s while it was within 4 blocks), with a logged reason.

     Tests: `threat_arbitration` 8/8. On develop, 7 fail, and the flap test shows cowardice interrupting self_defense 1 s after each start. Against the previous #227 head, the override and release tests fail. Also `use_on` 12/12 (PathStopped); related 10 files pass; lint per file unchanged.
- **#229 merged** (lead, 2026-11-05), the round 2 batch B findings:
  1. The night routine's "without a pickaxe": the real dump rules out the level and name hypotheses. `items()` misses the cursor and the off hand, so `toolLevels` now counts every carried stack, and the refusal names the pickaxes it saw.
  2. The cobblestone step counts rotn-data's `cobblestone` ore (the bot's 10 metamorphic cobble never counted). The model's daytime `!buildShelter` is refused unless a giver typed it.
  3. A #224 regression is fixed: `collectBlock` threw on position-less blocks after a give-up.

     Tests: `shelter` 17, `agenda` 15, `use_on` 12; on develop the new tests fail (the real-dump test passes by design); related 8 files pass; lint per file unchanged.
  4. **#229 review:** one source for the pickaxe. `stowCarried` moves a pickaxe on the cursor or in the off hand back into the inventory before the shelter check and before digging out, and `toolLevels` reads `inventory.items()` only again, as `allowedTool` and `equipForBlock` do. Before refusing, the check waits 600 ms for pending slot updates (after a rejected click the server resends every slot) and logs the inventory, off hand, cursor and held item.

     Tests: `shelter` 18 (cursor and off hand moved back; the refusal lists every place), `night_routine` 19 (digOut from the off hand; it fails with "no pickaxe in hand" on the previous head). Related files pass; lint per file unchanged.
  5. **#229 review 2:** `stowCarried` deals with an open window (a chest or a table) first. It puts that window's cursor stack into one of its inventory slots, then closes the window; closing a 1.12 container drops a cursor stack on the ground. With no free slot it leaves the window open. Each click has `STOW_CLICK_MS` (3 s). The passive 600 ms resync wait was accepted by the lead. Tests: `shelter` 21/21 (an open chest with the pickaxe on its cursor; no free slot; a click never answered, which hangs on the previous head).
- **G3 smoke round 3 running** (lead, received before 2026-11-05T23:06Z by `date -u`, about 2 hours): until the lead says it is over: no `npm ci`, no full `npm test`, no long node scripts; targeted test files only.
- **#233 merged** (lead, round 3 batch A). `!craftRecipe("cobblestone")` with 8 sedimentary rocks asked for Twilight Forest's giant cobblestone.
  - Now "cobblestone" means the cobblestone the held rocks make. The new `library/cobble.js` takes rotn-data's `rockRecipes()`, keeps the outputs in the `cobblestone` ore (26 of the 35; not the sandstones, holystone or defiled stone), and chooses the kinds the bot has 4 of, most first.
  - `craftRecipe` crafts those outputs until the count is reached, with a clear line when no kind has 4.
  - The cobblestone step's goal names that output (`goalNow(state)`; `agendaGoal` takes the state).
  - Tests: `cobble` 5/5, with sedimentary, igneous, metamorphic and plain rocks, mixed kinds, and too few. On develop the craft tests fail with "1 twilightforest:giant_cobblestone", as in round 3. `agenda` 16/16 (the goal names the output). Related 8 files pass; lint per file unchanged.
- **#234 merged** (lead), the #233 follow-up:
  1. The cobble is crafted by the rock's own `recipeId` (`craftByFill`), so `recipesFor` cannot pick `undergroundbiomes:regular_cobblestone` and use the bot's modded cobble. Only the real gain counts.
  2. The rock-specific goal is sent once the bot has the rocks (`agendaTick` resends a changed goal text of the same step; not a new run). The text stays the same while the rock kind is the same.
  3. One `!craftRecipe` in the goal.
  4. A failed oredict load is not cached.

  Tests: `cobble` 7/7, `agenda` 17/17; every new test fails on develop (the modded cobble is used up; the goal is not resent; the empty load is cached). Related 5 files pass; lint per file unchanged.
- **#238 merged** (lead):
  1. #234 nits:
     - the goal gives the real number (`!craftRecipe("cobblestone", 2)`, at most what the step still needs);
     - `describeNeeds` with no inputs gives nothing, so there is no "To craft X: .";
     - `craftByFill` says where the items came from (`needs.how`: "from your <rock> rocks");
     - a recipe lookup error is not cached.
  2. #225 nits:
     - `smeltItem` picks up the furnace it placed by its position (lit or not), also on an aborted run. It now has `FURNACE_OPS` for placing and picking up, as `craftRecipe` does for its table;
     - a `!clearFurnace` walk-then-limit test.
  3. #227 nits: `hurtBy`'s note (an approximation: 1.12 does not name the attacker); `hasWeapon` also looks at the off hand.

  Tests: `furnace` 3 (new), `cobble` 9, `agenda` 16, `threat_arbitration` 9, `action_limits` 9. On develop the new tests fail, except the clearFurnace one (behaviour already fixed in #225; the test was missing). Related 7 files pass; lint per file unchanged.
  4. #238 review:
     - `equipHighestAttack` moves a weapon from the off hand into the inventory and equips it in the main hand (a test checks what the bot holds when it hits);
     - `placeFurnaceNear` trusts only its own placement: the `placeBlock` result and `bot.blockAt(pos)`, never the nearest furnace. A failed placement gives null, and `smeltItem` says "Could not place your furnace."

     Tests: `furnace` 5, `use_on` 14; the three new ones fail on the previous head.
- **#238 nits, ready for the next PR** (branch `agent/skills-rotn/next2`, from develop, pushed without a PR as the lead said "no rush"; STATUS lives here):
  1. `placeFurnaceNear`: when `placeBlock` returns false or throws, `blockAt(pos)` still decides, so a furnace placed anyway is picked up. `pos` was free, so a furnace there is the bot's own.
  2. A weapon that cannot leave the off hand is logged: "Could not take the stone_sword from the off hand: the inventory is full."
  3. A better off-hand weapon beats a worse one in the inventory, by `weaponRank`: material, then sword over axe. It is a heuristic: neither mineflayer nor rotn-data has attack damage, upstream's `attackDamage` sort was a no-op, and RotN's durabilities do not follow damage.

  Tests: `furnace` 6, `use_on` 15; the new ones fail on develop. Related 4 files pass; lint per file unchanged.
- **Model preset merged in #241** (my profile commit plus harness-ops' `LLM_MODEL`; #239 closed as superseded): `openrouter/@preset/glm-5-3-flash-cheap-reliable`.
- **#242 merged** (lead). "FRCFLD was crushed by a falling tree", 3 s after its cut, with 12 items lost. The pack has Dramatic Trees with RLMixins' "Falling Overhaul": a cut tree falls as one `dynamictrees:falling_tree` entity.
  1. **Safe felling** (`library/felling.js` plans, `skills.fellTree` acts):
     - it finds the lowest trunk block (also from a limb in the canopy);
     - it stands 2-3.5 blocks out on the side away from the canopy's lean, with no leaves or branches overhead and no trunk next to it, within reach;
     - it cuts that block, steps back 4 blocks at once, and waits until the falling tree entity is gone (at most 15 s) before collecting the logs. The drop baseline is now taken before the cut;
     - with no safe place, the tree is not cut and its blocks are skipped.
  2. **The death report:**
     - the cause now arrives for a modded death message: its untranslated key, with the bot's name as an argument (`deathCauseText` in agent.js). Before, the cause was dropped;
     - a falling-tree death is recognised by its cause, or by a death within 15 s of the bot's own cut;
     - the re-plan note says a falling tree crushed it and to get logs only through `!collectBlocks("log", n)`.

  Tests: `fell_tree` 6/6 (rewritten on a fake tree world; on develop the bot cut from inside the canopy), `death_report` 9/9 (the 3 new ones fail on develop). Related 7 files pass; lint per file unchanged.
  3. **#242 review:**
     - the trunk must stand on rooty soil or ground, never on a tree block (a limb on leaves is not the trunk);
     - the walks during felling use `canDig = false`;
     - the death message is the bot's only when the bot is argument 1;
     - the death key is verified in the pack (DramaticTrees-1.12.2-0.13.4.jar, `assets/dynamictrees/lang/en_us.lang`: `death.attack.fallingtree=%1$s was crushed by a falling tree`, damage source `fallingtree`), and the regex also covers `falling_tree`;
     - places are never above the cut height, and the cut hits the side face towards the bot.

     Nit tests: no place reached, a 2x2 trunk, a slope. Tests: `fell_tree` 11/11, `death_report` 10/10; the review-item tests fail on the previous head. Related 6 files pass; lint 254.
- **Round 3 over** (lead): full tests allowed again.
- **#247 merged** (the #242 follow-up and the #238 nits; branch `agent/skills-rotn/approach-and-nits`, a fresh branch off develop, with the #238 nits commit cherry-picked from `next2` (the same result as a rebase, no force-push); STATUS lives here):
  1. The first approach to a tree has the normal walk limit (`GO_TO_LIMITS.totalMs`), still without digging. The other places, once the bot is at the tree, keep a step's time. Test: a 0.5 s approach with a 0.15 s step and a 3 s walk; with the old step limit, "could not reach a safe place".
  2. The `[object Object]` fallback in `deathCauseText` is commented.
  3. The #238 nits: `placeFurnaceNear` trusts `blockAt(pos)` after a failed or thrown placement; a weapon stuck in the off hand is logged; a better off-hand weapon beats a worse one (`weaponRank`).

  Tests: `fell_tree` 12, `furnace` 6, `use_on` 15, `death_report` 10; related 6 files pass; lint 254.
  4. rotn-data Request 12 (lead decision, routed from #243):
     - the death note says plainly that the items lie at the death spot for 10 min, guarded by a zombie that never burns and never leaves. They are lost unless it is killed within 10 min; waiting for day does not help; go back only with a weapon and more than half the health, otherwise move on. The "(unconfirmed)" hedge is gone;
     - `deathSpotBlocked` keeps the zombie avoid rule, except within the fight policy (`canFightHard`). The 5 min wait and the night rule stay.

     Tests: `death_report` 11 (the note, and the rule with and without a weapon, at half and at 18 health); both fail on the previous head.
  5. #247 review:
     - after 10 min the items are lost: no fight past the zombie, and no walk to the spot itself ("items already lost"); the area around stays open;
     - the note gives the minutes left, counted from the death time;
     - the night rule says "do not go back now; the items left there will be lost" instead of "only by day";
     - `placeFurnaceNear` requires air at the place before placing.

     Tests: `death_report` 14, `furnace` 7; the 4 new ones fail on the previous head; lint 254.
- **#247 nit**: folded into the fall-safety PR (commit cherry-picked from `next3`). From 10 to 20 min the night text says the items are already lost. The rounding nit was accepted as is.
- **#256 merged** (#252 closed as superseded). The round 4 PR, #256 (lead: one PR, built on rotn-data's `agent/rotn-data/sticks-from-felling`, superseding #252 and my #253). Branch `agent/skills-rotn/round4`: rotn-data's branch with `fall-safety` merged in (no rebase); STATUS lives here.
- **G3 round 4 batch B, the fall** (first opened as #253, now in the round 4 PR). "FRCFLD fell from a high place" during `!collectBlocks("stick", 4)` on leaves, 3 s after unstuck took over.
  - **Findings:**
    - Leaves went through `bot.collectBlock.collect`, whose pathfinder may dig, tower and step onto leaves.
    - Every walk could dig a Dynamic Trees branch, which fells the whole tree.
    - Pickups lost their no-dig movements inside `goToGoal`.
    - Every modded block is a full cube in the bot's registry, so branches look like footing.
    - Rotn-data (Request 13, #252): leaves never drop sticks; a felled tree does, by hand too. So the sticks the bot gained came from branches its pathfinder dug.
  - **Fixed (`fall_safety.js`):**
    - every walk drops at most 3 blocks and never breaks a branch;
    - leaves only from the ground (no dig, tower, parkour or step onto tree blocks);
    - a bot on a tree climbs down first (collect and unstuck);
    - drops lying on leaves are left;
    - a branch is always cut by `fellTree`;
    - the agenda's stick step says felling;
    - `moveAway` logs a copied start position.
  - **Tests:** `fall_safety` 9 (7 fail on develop; 2 cover the new module). The related files pass one at a time. Lint 254.
  - **Sticks with rotn-data #252** (agreed with rotn-data): `fell-tree` gives sticks with `tool: null` and `preferredTool` axe. `collectBlock` equips a held axe for it, otherwise cuts by hand, never "needs an axe". The stick step also mentions planks -> sticks. Test: `fell_tree` #13, which fails without the `preferredTool` code.
- **#256 review (REQUEST CHANGES, small), fixed on the same branch:**
  1. **The chat queue is capped** at 20; when full, a low line goes first, then the oldest normal one; high lines are kept.
     - A refusal carries a per-sender key: at most one waits (repeats collapse into it), and the next one goes out at least 10 s after the last.
     - Replies to task givers are high; replies to other players are normal.
     - Test: a non-giver typing a command every second for 2 min while agenda lines come. The result: one waiting refusal, the queue bounded, every agenda line sent, the first refusal within 2 s and then at most one per 10 s.
  2. **A warning when `bot._client.chat` is missing** (the limit is off).
  3. **Fall limit corrected.** Pathfinder 2.4.5 `getLandingBlock` accepts `node.y - landing.y <= maxDropDown` and the bot then stands on top of the landing block, so the fall is that minus 1. Now `maxDropDown` is 4: falls of 3, which do no damage. The test uses the real `Movements`: a fall of 3 is allowed, 4 is refused, and the old setting refused 3.
  - **Nits:** the shared mineflayer-collectblock movements change is commented as intended; water and lava no longer count as empty in `fall_safety.js`.
  - **Tests:** `chat_limit` 8 (4 new; they fail on the previous head), `fall_safety` 10 (the landing test fails with the old setting). Related files pass one at a time. Lint 254.
- **G3 round 4 C+D, the spam kick** (in the round 4 PR):
  - **Agenda:** two or more steps done in one tick send one line, `agenda steps done: a, b, ...`. One step keeps `agenda step <id> done`; `agenda done` and `started` are unchanged, so the harness parsers still match.
  - **Outgoing chat limit** (`chat_limit.js`, at `bot._client.chat`, so every packet counts):
    - a budget of 100 that refills at 10 per second (vanilla 1.12 kicks above 200, with 20 per packet and 1 removed per tick; no pack config changes it, checked in the pinned zip);
    - high priority (replies to players, refusals) goes first and is never dropped;
    - normal (agenda lines, self-prompted replies) is queued, never dropped;
    - low (reflex narration) is dropped when busy or after 15 s.
  - **The "late refusal"** was the harness's reading (lead: harness #255). The server log has it 1 s after the whisper.
  - **Tests:** `chat_limit` 5 and `agenda` #17; the agent wiring and agenda tests fail on develop. Full `npm test` after `npm ci`: 1331 pass. The 1 failure is `deploy-eol`, which checks `deploy/cx23/` on disk for CR; this Windows checkout converts to CRLF, and I didn't touch `deploy/`. Lint 254.
- **#260 merged** (the #256 follow-up):
  - A refusal waiting in its 10 s gap no longer holds up lines that may go now: they go at once when the budget allows.
  - A new line that may go sooner moves the drain timer earlier.
  - Collapsed repeats are logged.
  - The comment notes that waiting high lines are bounded by the number of players (plus the givers' replies).
  - Tests: `chat_limit` 11; the 3 new ones (two timing tests and the collapse log) fail on develop. Lint 254.
- **Waiting for net-forge #259 to merge** (lead, from the #259 review; not started). Once #259 marks modded fluids as liquid in the registry and adds `forge.hazard` on traps, fires and portals:
  - (a) `fall_safety.js` `isEmpty`/`firstBelow` use the liquid flag, not only the names water/lava (molten metals, poison, acid, tar);
  - (b) every walk's Movements avoids `forge.hazard` blocks.
  - With tests, in #260 or the next PR.
  - On 2026-11-06 #259's head (`agent/net-forge/collision-shapes`) had neither field yet.
- **#260 nits, ready for the fluids and hazards PR** (branch `agent/skills-rotn/fluids-hazards`, from develop, pushed without a PR; STATUS lives here):
  1. **Per-key order.** A new keyed line (a refusal) never goes ahead of an older waiting line with its key: it replaces it. Test: a drain timer firing 500 ms late, the budget fitting before it fires, two refusals to one player. Result: one refusal, the newest text. Fails on develop.
  2. **The end handler also resets `timerAt`.** The guard test passes on develop too, because `schedule()` reads `timerAt` only while a timer is set: consistency, no live bug.
  - Tests: `chat_limit` 13. Lint 254.
- **Fluids and hazards** (#259 merged; lead: required before smoke round 5). Same branch, `agent/skills-rotn/fluids-hazards`, with develop merged in. PR open; STATUS lives here.
  - **`fall_safety.js`:** `isLiquid` (vanilla by name, modded by the registry's `liquid` flag) and `hazardOf` (per state, forge-bridge `stateHazard`). `isLethal`: molten metal counts as lava. `isEmpty`, `firstBelow` and `isFirmGround` treat any liquid or hazard as not ground and not empty.
  - **Every walk:** `installWalkSafety` wraps `bot.pathfinder.setMovements` after spawn, so all walks (ours, mineflayer-collectblock, pvp, upstream) go through `fallSafe`. That gives:
    - whole-block hazard ids in `blocksToAvoid`, never a block with `hazardByMeta`;
    - a per-state exclusion: never step into a hazard state, nor onto a cell above a liquid or a hazard; never dig either;
    - modded liquids and hazard states made unsafe and not solid in the pathfinder's view, as it treats lava, so it never stands, lands or drops onto them;
    - vanilla water left as the pathfinder treats it.
  - **The reflex:** `self_preservation` treats molten metal at the feet or head like lava.
  - **The #260 nits** are included.
  - **Tests:** `fall_safety` 14 (4 new), `threat_arbitration` 10 (1 new). All 5 new tests fail on develop's code; `fall_safety` was checked with develop's file plus stub exports. Full `npm test`: 1261 pass, 0 fail. Lint 254.
  - **net-forge #263** (not merged) makes `hazardBlockIds` whole-block by default. My filter on `hazardByMeta` is right with and without it.
- **#264 review (REQUEST CHANGES), fixed on the same branch:**
  1. **Vanilla water is left to the pathfinder.** The step and break checks use `isWalkHazard` (a liquid or a hazard, but not vanilla water); before, the head-cell check refused water. Tests: wading, swimming on the surface and under water give the same moves as the raw pathfinder; a floor of milk is still refused.
  2. **Never dig next to a modded fluid.** `getBlock` marks modded fluids `.liquid`, and the break exclusion checks the 5 neighbours itself, because collectblock turns `dontCreateFlow` off. Test: stone next to molten tin is not breakable with `dontCreateFlow` on or off; the raw pathfinder would dig it.
  3. **Modded fire reflex.** A `forge.hazard` `'fire'` at the feet or head makes `self_preservation` act; a trap does not.
  - **Nits:**
    - `isClearPath` uses `fallSafe` movements (test).
    - The step exclusion turning off the pathfinder's path shortcuts is noted in the code.
  - **Tests:** `fall_safety` 17, `threat_arbitration` 11. The 4 new ones fail on the previous head (`f5fd928`). Full `npm test`: 1265 pass, 0 fail.
  - **Lint 253:** my `isClearPath` edit added a missing semicolon to an upstream line, so per CLAUDE.md this PR commits the lowered baseline (`test/lint-baseline.json`, via `--update`).
- **Next:** the #264 re-review.
- **2026-11-06T11:55Z:** G3 smoke round 5 has started (lead). Until it ends: no npm ci, no full npm test, no long node scripts; targeted test files only. No #264 change while the re-review runs.
- **#264 merged** (`c32521e`).

## Round 5 batch A fixes (branch `agent/skills-rotn/r5-batch-a`, 2026-11-06T12:27Z by `date -u`)

Source: the lead's batch A findings (raw log: harness-ops `captures/raw/r5-g3a/`).

1. **Memory crash loop** (`history.js:44`, null from `promptMemSaving`, 5 restarts):
   - `summarizeMemories` keeps the previous memory, with a `[memory]` warning, for: a null, empty or non-text reply; a model failure reply ("No response received.", "My brain disconnected, try again.", and the other canned replies in `src/models/`); a throw.
   - A real summary is trimmed and kept as before.
2. **Chat limiter off all run:**
   - minecraft-protocol assigns `client.chat` only in `onReady` (after login).
   - `installChatLimit` now waits rather than giving up: it wraps on the client's `playerJoin`, the bot's `login` and every `spawn`. These also re-wrap a replaced `client.chat` or a reconnect's new client.
   - A spawn that still has nothing to wrap warns that the limit is OFF.
3. **Tree guard too strict, 0 sticks:**
   - The stand ring of 2 to 3.5 blocks lay under any grown canopy. It now reaches 4.5 out, and the cut reach is 5 from the eyes (the server allows 6).
   - A place under leaves is allowed if no branch is above it and it is not on the side the canopy leans to. Places under no canopy still come first.
   - A refused tree is said once per collect; it was said again for each of its blocks.
   - **Fallback:** when sticks are still short, `collectBlocks("stick")` crafts the rest from held planks (`ore:stickMat`, 2 planks give 4).
- **Tests** (targeted, round 5 rules):
  - `history.test.js` (new, 2);
  - `chat_limit` 14 (1 new);
  - `fell_tree` 15 (2 new; the plan and grove tests updated to the new rule; the grove test also checks one refusal per tree).
  - All new tests fail on develop's code.
  - Related files pass: `collect_rotn`, `fall_safety`, `agenda`, `priority`, `rotn_names`, `cobble`, `threat_arbitration`.
  - Lint 253 (baseline).
- **Merged as #268** (`1a7d990`). Review: APPROVE WITH NITS. Round 5 must show no falling-tree death with the relaxed guard.

## #268 follow-ups (branch `agent/skills-rotn/r5-followups`, 2026-11-06T12:48Z by `date -u`)

Round 5 resumed before 12:48Z, per the lead (A rerun, B, C, D): targeted tests only.

- **2. Logs to planks first:** `sticksFromPlanks` makes held logs (`ore:logWood`) into planks when there is no pair of one kind, then makes sticks. It runs in bounded rounds, and each round must make progress.
- **3. Planks per kind:** `stickCraftsHeld` counts pairs of one kind only, so a mixed pair makes no stick.
- **4. Load:** a failure string, or a memory that is not text, in an old `memory.json` is dropped on load with a `[memory]` warning; the turns are kept.
- **1 (evidence for round 5):**
  - the cut log line says "(from under its leaves)" when that was the stand;
  - `rotnLastFell.underLeaves` is set;
  - a falling-tree `[death]` line says "[its last cut was from under the tree's leaves]" or "[... under no canopy]".
- **Tests:**
  - `history` 3 (1 new);
  - `fell_tree` 17: 2 new; the planks test now uses a crafting model per kind; the oak test also checks the under-leaves log;
  - `death_report` 15 (1 new).
  - All new or changed tests fail on develop's code (with a stub export for `stickCraftsHeld`).
  - Related files pass: `collect_rotn`, `agenda`, `fall_safety`.
  - Lint 253.
- **Opened as #270.**

## Round 5 A rerun fixes (branch `agent/skills-rotn/r5-rerun`, on top of #270; 2026-11-06T13:29Z by `date -u`)

Source: the lead's A rerun findings (raw log: harness-ops `captures/raw/r5-g3a-rerun/`). Pushed without a PR: the lead wants the PR after the round.

1. **Felling drops late and far; sticks rare:**
   - `FELL_LIMITS`: radius 12 → 20, settle 6 → 15 s, quiet 1 → 2 s, total 30 → 60 s (bounded). New `pickupMs` (1 s): the gain is counted after the last pickup.
   - A cut tree's blocks, as the bot saw them before the cut, are skipped for the rest of the collect. In the log, one tree was cut 4 times because the bot still saw its trunk.
   - "Trunk not in sight" now skips every branch around the block: once, not 4 times.
   - A break with no target gain says what it gave ("it gave 3 log:1"). For sticks from felling it adds "A felled tree drops few sticks, often none."
2. **No path from logs to sticks before the table:**
   - rotn-data's answer (from the pack scripts and bytecode): every log → planks recipe is a 1x3 column, so a table is needed. Without a table, the only route is Hit With Axe: right-click a placed log twice with an axe (the crude axe qualifies) for 1 plank, and a placed plank once for 2 sticks.
   - River Cane (`biomesoplenty:plant_1:5`) and BOP bamboo are `ore:stickWood`, picked by hand. They fill the crude axe's and the Crafting Tools' stick slots.
   - **Agenda:** the sticks step now needs 3 `stickWood` (2 for the crude axe, 1 for the Crafting Tools; it was 4 sticks). Its goal names felling (rare), River Cane and bamboo, and says planks come after the table.
   - The rest of the path is unchanged: crude axe → logs → `first_plank` (`!useOn` the crude axe on a placed log, 2 uses) → `crafting_tools` (uses up the axe) → `crafting_table` → planks and sticks at the table.
   - The crude axe and Crafting Tools goals mention the stand-ins.
   - **The stick fallback** now makes logs into planks only with a crafting table near or held; otherwise it says why and names the stand-ins.
3. **Underground logs:**
   - `world.isUnderground(bot, pos)`: solid non-tree ground within 48 blocks above.
   - `!searchForBlock` for wood also searches Dynamic Trees branches (fell-tree) and never picks a block underground ("Could not find any log on the surface...").
   - `collectBlocks` for wood skips underground blocks.
4. **Empty memory summaries:**
   - `promptMemSaving` sends the prompt as the only (system) message, with the default stop sequence `'*'`. A summary that opens with markdown (`**`, `* `) stops at its first character, which gives empty content with `finish_reason stop`, as logged.
   - Profile side: `saving_memory` now asks for plain text with no asterisks, bullets, headings or thinking out loud.
   - The rest is lead-owned code; see Requests 16. Not checked against the live model: a paid call needs a lead GO.
- **Tests** (targeted):
  - `fell_tree` 22 (5 new; 2 updated for radius 20; the logs-first test gets a table);
  - `agenda` 18 (1 new; 3 updated for "collect 3 sticks");
  - `history` 4 (1 new);
  - `craft_needs` 34 (1 new guard: River Cane and bamboo fill both recipes);
  - `fall_safety` 17 (the sticks-goal test updated).
  - All new tests fail on #270's head (with a stub for `isUnderground`).
  - Related files pass: `collect_rotn`, `priority`, `death_report`, `rotn_names`, `cobble`.
  - Lint 253.
- **2026-11-06T13:36Z: #270 merged** (`1d69707`); develop merged into this branch (the tree is unchanged: #270 was already in it). **#270 review follow-ups:**
  1. **Clear reasons:**
     - with no table near or held: "Not making planks: in RotN logs become planks only at a crafting table, and there is none near or held. Get or make a table first (...). Until then, River Cane or bamboo ... work as sticks", said once and with no craft tried;
     - a planks or sticks craft that makes nothing says so, and the run stops ("not trying again in this collect").
  2. **Tests:**
     - the `crafter()` mock gains `planksNeedTable` (logs to planks only at a table, as on RotN);
     - none near or held: no craft, one reason, 0 sticks, the logs kept;
     - a table placed near: planks at the table, then sticks (a guard; it also passes on develop).
  3. **`underLeaves`** also counts vanilla leaves (`isLeafBlock`); new test.
  - `fell_tree` 25. The two new non-guard tests fail on develop's `skills.js`. Lint 253.
  - **Path choice:** rotn-data had already answered (Hit With Axe; River Cane and bamboo are `stickWood`). The path above follows it. The lead asked me to wait for that answer, so it is open to the lead's call.
- **2026-11-06T14:21Z: Hit With Axe sticks** (lead decision; rotn-data #272 merged, `a6825e8`, and merged into this branch):
  - **`skills.sticksByAxe(bot, need)`:** with any axe of level 0 or more (crude, flint, stone), it places a held log near the bot and uses the axe on it twice (debark, then 1 plank). It places a plank and uses the axe once for 2 sticks, and picks up the drops around the block.
    - A pair of spare planks is crafted into 4 sticks in the grid, which costs no axe use.
    - Before the bot has a table (none near or held), 1 plank is kept for it.
    - **Bounded:** at most 8 axe uses (the crude axe's life) and 90 s per call.
    - **Stops with a reason when:** there is no axe at the start ("you hold no axe"), the axe breaks, a use changes nothing, or there are no logs or spare planks.
    - Places and pickups go through `AXE_CHOP_OPS` (tests replace them).
  - **`collectBlocks("stick")`:** when sticks are short and no table is near or held, the fallback uses `sticksByAxe` if the bot holds an axe. Otherwise it says why ("...you hold no axe to chop them...").
  - **Agenda:** the `crafting_tools` goal names `!collectBlocks("stick", 1)` for a missing stick (about 5 crude-axe uses, a plank kept).
    - The sticks step stays at 3 `stickWood`: the logs step's cut (1), the first plank (2) and the axe-route stick (5) would use all 8 of the crude axe's uses, so the third stick should still come from the sticks step.
  - **Tests:**
    - `axe_chop.test.js` (new, 6), with a fake world where a log is debarked then gives a plank, a plank gives 2 sticks, and the axe breaks after N uses:
      - no axe;
      - 2 logs give 2 sticks in 5 uses, with a plank kept;
      - 3 logs give 4 sticks by crafting;
      - a use that changes nothing, a broken axe, and the use cap;
      - only the kept plank;
      - via `collectBlocks`;
    - `agenda` 19 (1 new);
    - `fell_tree` 25 (2 messages updated).
    - All new tests fail on the previous head. They pass after the #272 merge, as do `collect_rotn` and `craft_needs`. Lint 253.

- **2026-11-06T15:50Z: round 5 C, stand on the block** (lead; raw `captures/raw/r5-g3c/task/`):
  - **What happened:** for the task "go to the gold block at -42 68 -50 and stand on it", the model ran `!goToCoordinates(-42, 68, -50, 1)`. That is the block's own position with range 1, so the bot ended beside the block. It then said "Standing on the gold block" and called `!taskDone`, and the server's on-marker check never found it.
  - **`library/stand_on.js` (new):**
    - `parseStandOn(text)` finds a stand-on text's block coordinates and block name (`gold block` and `block of gold` both give `gold_block`; an unknown name gives null, and only the position is checked);
    - `standCheck(bot, target)` passes only when the block under the feet is the target block and the bot is on the ground; otherwise it says what is under the feet.
  - **`skills.standOnBlock(bot, x, y, z, name)`:**
    - walks to x, y+1, z with range 0, then checks the block under the feet;
    - when it ends within 2 blocks (off by one), it walks once more; otherwise it does not retry;
    - on failure it says "You are NOT standing on ...: <why>. Do not say you are on it, and do not report a task done for it.";
    - when the block at x, y, z is the wrong block or not solid, it fails without walking.
  - **`!standOnBlock(type, x, y, z)`** is a new command with a 5 min limit.
  - **`!goToCoordinates`:** when the active task (or else the self-prompt goal) says to stand on a block, and the target is that block or the spot above it, it runs `standOnBlock` instead.
  - **`!taskDone`:** for a stand-on task, it is refused until the check passes ("Not done: ... Use !standOnBlock(...) first, then !taskDone; or !taskFailed"). The task stays active, and its attempts and LLM-time budget still end it.
  - **Prompt:** the task's self-prompt goal names `!standOnBlock(...)` and says to claim it only after that command confirms.
  - **Tests:**
    - `stand_on.test.js` (new, 7): parsing, the check, the range-0 walk, off by one twice, far away, the wrong block, the round 5 C replay through `!goToCoordinates`, and the command.
    - `priority.test.js`: the gold-block task test now shows `!taskDone` refused from beside the block and accepted on top of it.
  - On the old source, `stand_on.test.js` fails to load (no `standOnTarget` export) and the priority test fails. `action_limits`, `no_cheat`, `smelt_and_login`, `threat_arbitration`, `axe_chop` and `task_queue` pass (55). Lint error counts in the changed files are unchanged.

- **2026-11-06T16:29Z: grid planks from modded logs** (rotn-data #278 correction; pushed to #274):
  - **The correction:** only vanilla logs need a table for planks. Seven modded logs make planks in the 2x2 grid: mangrove, Pam's maple, cinnamon and paperbark, twilight oak, tower wood and the End log. My sticks fallback had assumed a table for all logs.
  - **`skills.gridPlanksReady(bot)`** (new, exported) returns a `stickMat` plank that a held log makes now with no table, by rotn-data's recipes. Only recipes whose inputs are all logs count, so planks are never turned into other planks.
  - **`sticksFromPlanks`:** with no table, it crafts those planks first and then sticks. A failed grid craft is said once and not tried again, and then the axe path or the reason follows as before.
  - **Wording:** the reason now says "most logs (all vanilla ones)", and the agenda sticks goal says "Planks from ordinary logs need a crafting table here".
  - **Tests (`fell_tree` 27, +2):**
    - a held Pam maple log, with no table and no axe, gives planks in the grid, then 4 sticks, with planks left for the table;
    - by the real recipes: a mangrove log gives `biomesoplenty:planks_0:6`, a maple log gives `planks` and an End log gives `stygian:endplanks`; a vanilla log or planks alone give nothing.
  - The first test fails on the old `skills.js`. All `src` tests: 445/445. Lint 253.

- **2026-11-06T16:49Z: #274 review fixes** (the lead's 4 required items and 2 nits; develop with #275-#278 merged in):
  1. **The axe keeps a use** (`skills.js`, `rotn_sources.js`):
     - `toolUsesLeft(item)` is rotn-data's `maxDamage` minus the damage (1.12 metadata), so the crude axe has 8.
     - A log is chopped only when an axe keeps 1 use after its 2 clicks, and a plank only when one keeps 1 after its 1 click. Otherwise: "Keeping the axe for the Crafting Tools: it has N uses left, and chopping a log takes 2; stopping."
     - With several axes held, the one with the most uses left chops, so a stone axe does it and the crude axe is untouched.
  2. **Stand-on coordinates** (`stand_on.js`): only the triple right after "stand on", or for "stand on it/there/that" the last named block before it ("the gold block at X Y Z"). Never the first triple in the text; a bare position with "stand on it" gives null.
  3. **Every early exit cleans up:** a `finally` after each placement breaks what is left (log, debarked log or plank) back by hand, not with the axe, bounded at 5 s, then picks up the drops. When the run was stopped or aborted, the block is still broken back, but the bot does not walk after the drops ("Stopped; the drops are left near ...").
  4. **Placement** (`chopSpot` and `chopSpotOk`):
     - an empty cell 1.5 to 3 blocks away, on firm ground (`isFirmGround`: not leaves, a branch, a liquid or a hazard);
     - no liquid or hazard in the 3x3x3 around it;
     - no ledge: each side is solid or has firm ground under it;
     - `placeNear` uses it and says why when there is none, and `pickUpNear` only walks to drops lying on the ground (`itemOnGround`).
  - **Nits:**
    - `standCheck` uses the cell of feet y - 0.01, so a slab or farmland underfoot counts;
    - `TREE_COVER` matches wood only as a whole name part (`log`, `log2`, `log_0`, `twilight_log`, `petrified_wood`), not `wooden_slab` and the like.
  - **Tests:**
    - `axe_chop` 10 (+4): a worn axe (damage 3, 2 and 7), the stone axe chosen over the crude axe, three early exits (a use that changes nothing, the use cap, an abort), and the placement spot;
    - `stand_on` 9 (+2): the coordinates and the slab;
    - `fell_tree`: a wooden roof is not tree cover.
  - All 7 new or changed tests fail on the old source. `src` and `packages` tests: 903/903 after the develop merge. Lint 253.

- **2026-11-06T16:56Z: #274 re-review fix** (the lead's re-review: all four items fixed; one small fix):
  - **`stand_on.js` `AFTER`:** the article and a comma before "at" are now optional ("stand on gold block at X Y Z", "stand on the gold block, at X Y Z").
  - "at" must be a whole word after a space or comma (not the end of "cat").
  - The block name comes from the last 1 to 4 words before "at" (`nameIn`), so "go to gold block at X Y Z and stand on it" names gold_block.
  - **Test:** `stand_on` 10 (+1), which uses the scenario's own `taskText` (`test/scenarios/g3/g3-task-preempts-agenda.mjs`), where the coordinates come before "stand on it". It resolves to that gold block for three markers.
  - The new test fails on the old `stand_on.js` (at the missing-article case; the exact scenario text already resolved before). `src` and `packages` tests 904/904. Lint 253.

## Round 6 B fixes (branch `agent/skills-rotn/r6`, 2026-11-06T18:47Z by `date -u`)

- **Finding (the lead; raw `captures/raw/r6-g3b/night/`):** at dusk the shelter was refused three times ("needs 9 sturdy blocks (cobblestone or stone); you have 0"). The bot held 11 `undergroundbiomes:metamorphic_cobble:6`, 44 rocks and 32 dirt piles. A zombie killed it at 18:16:30, and after the respawn the shelter was refused "without a pickaxe".
- **Cause:** `isSturdy` needed hardness 1.5 or more. Meta 6 is soapstone cobble, whose hardness is 1.2 in the dump, so all 11 failed. The agenda's cobblestone step (ore count) had counted them.
- **(1) Sturdy blocks from the data:** `night.js isSturdy` also accepts every member of the rotn-data ore dictionaries `cobblestone` and `stone` (Underground Biomes cobble and stone, `contenttweaker:chalk_cobble`, vanilla, ...), when it is a whole block. A test checks every member of both ores against the real dump. The rotn-data lists are enough, so no request was needed.
- **Dirt fallback (`shelter.js`):**
  - With too few sturdy blocks, the shelter first makes cobblestone from the rocks held.
  - If it is still short, dirt (`dirt` ore, dug by hand) fills the rest, made from dirt piles (`pileDirt`, 4 each) when needed. Sturdy blocks are placed first.
  - The log says how many walls are dirt. The night routine's breach check and repairs keep dirt walls, and `digOut` opens a dirt side first.
- **(2) Reserve:** `SHELTER_RESERVE_STEP` (`agenda.js`). When sunset is within `RESERVE_LEAD_MIN` (10 min of running time) and the bot holds fewer than 10 sturdy blocks, this step comes before the current one. It also runs after "agenda done". A spent budget skips it until the next day instead of pausing the agenda.
  - With the measured cycle this means "from the morning freeze on", because only about 8 min run between time 3001 and sunset.
- **(3) No pickaxe (after a death):** the shelter is built from dirt only, at a site with a side that can be dug out by hand. With nothing held, the refusal names both the pickaxe and the missing dirt.
- **Tests:** 11 new (shelter 6, night_routine 2, agenda 3). All fail on the old source. `src` and `packages` tests 919/919; lint 253.
- **Not tried on a server.** Crafting dirt from piles uses its own `craftRecipe` call through rotn-data's 2x2 recipe, which is untested offline beyond a fake.
- **2026-11-06T19:09Z: #284 review fixes** (the lead's review; all three items plus the nit):
  1. The reserve is not due at night: `due` needs `minutesToSunset` > 0, because it is 0 from sunset to sunrise.
  2. **Lead decision:**
     - With no pickaxe held, the reserve counts dirt and the dirt that held piles make (`placeableDirt`) toward the 10, and asks for dirt (`!collectBlocks("dirt", n)`), never for rocks.
     - With a pickaxe, it asks for sturdy blocks only.
  3. With no pickaxe, a failed sturdy-site search no longer refuses. The dirt-wall search is tried first, and it keeps existing dirt walls, for example under gravel.
  - **Nit:**
    - The data shows that all five `pileDirt` piles make a dirt-ore block, but only BWM's makes `minecraft:dirt`. The loamy, sandy and silty piles make `biomesoplenty:dirt` variants, and the aether pile makes `aether_dirt`.
    - So `dirtPileRecipes` reads each pile's own no-table recipe from rotn-data, and each pile is crafted into its own dirt.
  - **Tests:** 4 new (agenda 2, shelter 2) and 2 updated. All 6 fail on #284's previous head. `src` and `packages` tests 923/923; lint 253.
- **2026-11-06T19:23Z: #284 re-review fix** (the lead):
  - With no pickaxe, the reserve counts only placeable dirt (held, or made from the piles held), because the shelter then places only dirt. Before, 10 cobblestone and no dirt marked the reserve done, and the shelter was refused at dusk.
  - Cobblestone is dropped from the no-pickaxe prompt.
  - The static fallback goal now tells the two cases apart: with a pickaxe, sturdy blocks; without one, dirt only.
  - **Tests:**
    - `agenda.test.js` round 6 B: 10 sturdy blocks and no pickaxe are still due, and 10 dirt ends the reserve;
    - #284 review 2: the prompt wording and the static goal are asserted.
  - Both tests fail on the previous head. `src` and `packages` tests 924/924; lint 253. SHELTER_RESERVE stays 10 (lead).
- **2026-11-06T19:28Z: next, after rotn-data #288 merges** (rotn-data's dirt drop rule, confirmed by the human's play):
  - Dirt dug by hand, or with any shovel below level 1, drops 4 `betterwithmods:dirt_pile`. A level-1+ shovel gives plain dirt.
  - #284 already counts the piles and crafts them into dirt.
  - The follow-up PR, in my own files:
    1. `worldSources` passes `unlessTool` through;
    2. collecting `dirt_pile` never equips, or keeps holding, a level-1+ shovel;
    3. the no-pickaxe reserve goal asks for `!collectBlocks("betterwithmods:dirt_pile", 4n)` instead of `"dirt"` (`collectBlocks("dirt")` gets piles and counts 0).

## Dirt piles (branch `agent/skills-rotn/dirt-piles`, 2026-11-06T19:57Z by `date -u`)

- **Data (rotn-data #288, confirmed by the human's play):** dirt and grass dug by hand, or with any tool except a shovel of level 1+, drop 4 `betterwithmods:dirt_pile`. 4 piles make 1 dirt in the grid. A level-1+ shovel gets the dirt block.
- **`rotn_sources.js`:**
  - `worldSources` passes `unlessTool` through;
  - new `isToolFor(item, tool)`;
  - new `handRoute(bot, name)`: a no-table craft from one input the bot can collect now (dirt from 4 piles).
- **`collectBlock`:**
  - For a rule with `unlessTool`, a matching tool is never equipped (a held one is put away, again right before the dig). The dig is done by hand, not by `collectBlock.collect`, which equips the fastest tool.
  - The shovel route (`howToGet(dirt).ways[0]` is now dirt-with-shovel): when the item's own blocks need a tool the bot lacks and a hand route exists, it collects `per` inputs for each item still wanted (inputs held count) and crafts them (`COLLECT_ROUTE_OPS.craft`).
  - With a level-1 shovel, dirt is dug with the shovel as before.
- **Reserve:** the no-pickaxe goal asks for `!collectBlocks("betterwithmods:dirt_pile", 4n)`. The pile and per-dirt count come from rotn-data's recipe. It also says not to use a level-1 shovel for it. The static goal matches.
- **Tests:**
  - `dirt_piles.test.js`, 3 new: `unlessTool` and the shovel route in the data; no level-1 shovel held at any dig, a held one put away, no collectBlock.collect; dirt by route with 2 piles held (3 digs, crafted `dirt:0` x3), and with an iron shovel the plain route;
  - the `agenda.test.js` #284 review 2 test, updated.
  - All 4 fail on develop's code.
  - `use_on` (2) and `names_e2e` (1) used dirt as a neutral block, so they now use sand.
  - `src` and `packages` tests 928/928; lint 253.
- Not tried on a server.
- **2026-11-06T20:11Z: #291 review fix** (the lead):
  - mineflayer's `unequip('hand')` tosses the held stack when no slot is free. So `stopHolding(bot, tool)` now:
    1. switches to an empty hotbar slot, or to one holding something that is not a level-1+ shovel;
    2. otherwise calls `unequip` only while an inventory slot is free;
    3. otherwise skips the dig with the reason.
  - **Nit:** `dirtPile()` keeps the recipe's meta.
  - **Tests:**
    - the `dirt_piles` fake now models mineflayer's slots and `unequip`, including the toss;
    - 1 new full-inventory test: the shovel is never tossed; another hotbar item is held, or the dig is skipped with the reason; with a free slot, `unequip` moves it;
    - 1 new agenda test for the nit.
  - Both new tests fail on the previous head. `src` and `packages` tests 930/930; lint 253.

## Before the restart (PAUSED, received before 2026-11-05T01:49Z by `date -u`)

- **Merged since the last entry:** #204 (`f84efaa`), #206 (D1a eating), #211 (security).
- **Branch `agent/skills-rotn/replan-jumps`** (#212, lead REQUEST CHANGES) held a **WIP** commit `22232274`, pushed.
  - Done in the WIP:
    1. the `teleport_watch` mode is gone. `Agent.bindTeleportWatch()` samples the position on `physicsTick` and judges a jump only on mineflayer's `forcedMove` (the server's position packet), so walking by `self_preservation` never counts (review 3). `onTeleport` logs `[reflex] teleported N blocks (...); re-planning`, stops the action, and requests a re-plan. Death and spawn reset `this._jumpWatch`;
    2. `hordeWarning` matches `message.hordes.EventStart` only (review 2). `Agent.onHordeMessage(keyOrComponent, { via })` is the handler for forge-bridge's coming `hordes_hordeevent` event (review 1). The vanilla title packet is the fallback only.
  - **Not done:** `src/agent/library/hazard_watch.test.js` still tests the old API (`JumpWatch.observe`, the `teleport_watch` mode, `resetJumpWatch`). It fails now. No test was run after the WIP edits; the edited files only passed `node --check`.
- **Exact next step on resume:**
  1. rewrite `hazard_watch.test.js` for the new API:
     - `JumpWatch.sample`/`forced`: walking with no forced move is not a jump; a forced move of 7 blocks is; a forced move while riding is not; a reset;
     - `hordeWarning`: `EventStart` as a key and inside a component matches; `EventEnd`, `TrySleep` and other titles do not;
     - `Agent.bindTeleportWatch` with an EventEmitter bot: `physicsTick`, then a walk of 8 blocks with no `forcedMove`, gives no re-plan (the `self_preservation` case); a `forcedMove` of 7 blocks gives a re-plan and stops the action; `death` resets;
     - `Agent.onHordeMessage` via forge and via the title fallback, with the once-a-minute limit;
  2. then run the targeted tests (`hazard_watch`, `night_routine`, `quiet_reflexes`, `update_loop`), lint the touched files, push, and reply on #212;
  3. when net-forge's forge-bridge `hordes_hordeevent` event lands, wire it to `onHordeMessage(key, { via: 'forge' })` in `bindHordeWatch`;
  4. then D3 (the death report).

