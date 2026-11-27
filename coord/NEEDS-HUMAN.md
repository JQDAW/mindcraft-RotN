# Needs the human

Agents add items here when they need something only the human can do. The human ticks them off. Never put secrets in this file: say where you put them instead.

## Open

- [ ] **Your live server: the one mod the pack downloads at start** (lead, 2026-11-07; ADR 0008). The pinned zip doesn't contain ESM-Tweaks 0.4.5. Mod Director downloads it at every server start, from a list on the RotN GitHub `stable` branch. That mod decides whether zombies can dig through dirt and wood. The test servers now pin its SHA-256 and stop on any change. Your choice for the live server:
  - (a) keep the auto-download and accept that the mod may change upstream;
  - (b) pin it too, for example with a local copy of the jar and the list.
  This isn't needed for G3; it matters before the bot joins the live server.
- [ ] **Before the bot joins your live server: should it answer only when addressed?** (lead, 2026-11-09; your decision). Today it reads every public chat line from anyone, and each line it reads is one LLM call. That is cheap with no other players (about USD 0.012 per hour in the soaks) but will cost more on a busy server.
- [ ] **OpenRouter production key credit limit** (lead, 2026-11-09): ADR 0010's ceiling is USD 0.05 per hour, about USD 1.20 a day, plus player chat. Please check the limit you set allows that.
- [ ] **Whitelist the bot** on the live server when the lead asks. This comes after G4, not G3: G4 runs only against disposable test servers, and the first live join follows the proven ready-to-try list (lead, 2026-11-07, aligned with `test/scenarios/g4/PLAN.md`).
- [x] **When development resumes: deploy the next release on the CX23** (lead, 2026-11-09). `rotn-v0.1.7` was live until the install. **Done 2026-11-19 23:38 UTC: the ADR 0011 install is complete and `rotn-v0.1.11` (272ff9b9) is live.** D1-D5 all matched (one D2/D4 check, `test -r`, was a false negative of uutils `test`; the README fix is a harness-ops request from 2026-11-19). From now on the lead deploys, reads the release and resets bot state through the gate; the env file stays yours. FRCFLD is stopped and disabled. The env file's `"host"` still names a deleted test server (Hetzner can give that address to someone else), so it must be set again from the lead's GO before any start; nothing starts the bot until then. G4 step 0 itself is done (evidence #411).
- [x] **Soak 7: your GO** (lead, 2026-11-20). **Done: GO `G4-SOAK-7-20261120` given 2026-11-20 ~22:25 UTC; run 22:42-00:42 UTC, FAIL 8/9, one death (evidence #515).**
- [x] **Soak 8: your GO** (lead, 2026-11-21). **Done: GO `G4-SOAK-8-20261121` given 2026-11-21 just before 22:55 UTC; run 23:07-01:08 UTC on `rotn-v0.1.14` (Better Combat on), FAIL 7/9 (food), no death, health 20 throughout (evidence #558). Root cause: a flooded pit after mining copper under water; fixes in progress.**
- [x] **Memory summaries: reasoning off? (your decision, before soak 14)** (lead, 2026-11-24). **Decided 2026-11-24 about 14:30 UTC: option (a), keep it for memory summaries only (as shipped in `rotn-v0.1.20`); the preset item below is amended to match. Soak 14 checks the summaries' reasoning tokens and cost.** **Soak 14 (#608): the preset's model refused `effort: "none"` (HTTP 400; the retry without it worked) on the first summary call, so the setting was dropped for the run and had no effect; cost still passed (USD 0.037/h). Decided 2026-11-24 about 18:00 UTC: option (b), the lead reverts #600 and #603 (no per-request reasoning setting at all, as decided on 2026-11-22), in the release after `rotn-v0.1.20`.** Soak 13 failed only on cost (USD 0.0552/h against 0.05, #599): memory summaries were 42% of the spend, with up to 18,156 reasoning tokens for a note of about 500 characters, and reasoning was 95.7% of all completion tokens. The lead's #600 (with #603) makes memory-summary calls only send OpenRouter `reasoning: { effort: "none" }` (the bot's play, chat and code calls are unchanged), and it is in the deployed `rotn-v0.1.20`. **That goes against your 2026-11-22 decision in the preset item below ("the lead sends no per-request reasoning setting"), which the lead missed when writing #600.** Choose one: (a) **keep it for memory summaries only** (the lead's recommendation: summaries are the bot's own notes, the play prompts keep full reasoning, and with skills-rotn's #601 they also run half as often); (b) **remove it**: the lead reverts #600/#603 and deploys `rotn-v0.1.21` before soak 14 (#601's changes alone may or may not bring the cost under 0.05/h). If you choose (a), the lead adds a dated amendment to the preset item below so the two items agree. Soak 14 waits for this answer.
- [ ] **Soak 18: your GO** (lead, 2026-11-27). `rotn-v0.1.24` is deployed (by the lead through the gate, 02:28 UTC).

  **Soak 17** (`rotn-v0.1.23`) was a SMOKE-PASS 9/9, but a `!collectBlocks("cobblestone")` dug about 55 blocks down to a buried block, the escape could not get out, and zombies killed the bot in its shaft (item below; evidence #661). The new `no_trap` check fails it. Each change below was reviewed independently, most in two or three rounds.

  **What changed for the bot:**
  - **Collects stay near the surface (#665):** a collect never digs down more than 2 blocks below where it started; it may still walk down into a valley under open sky for a log or a boulder it can walk back up from, but never into a cave or to a pit's bottom. Cobblestone is crafted from the rocks the bot carries first. Every walk in the bot now goes through one guarded movement setup.
  - **The escape (#667):** it makes its own crafting table (crude axe, crafting tools, table) and a new pickaxe before the old one wears out (not with a hostile near); while it climbs it fights in place instead of fleeing; at dusk, if it is at least 6 blocks down, has the blocks and enough food for the night, it seals its shaft and climbs on in the morning (a food emergency makes it climb out at once); a model command waits for the escape instead of cutting into it, and if a `!stop`, a death or a reflex ends the escape first, the waiting command is dropped (the bot says to send it again).
  - **The memory's agenda line (#670):** no "all steps done" before a step is picked, and no finished step named as current (soak 17's 3 wrong facts); the food figure in the goal is read after a pickup; a failure stays in the memory while it matters; the club is not used to break rock; an input held only in the off hand is moved into the inventory before a craft.
  - **Crafting plans (#669, #671):** `!getCraftingPlan` counts every rock kind held, plans cobblestone from rocks, and uses the pack's recipes.
  - **Inventory clicks (#664):** after a dig, the next inventory click waits for the server, so the pickaxe's wear is no longer one step behind (one rare case is still not covered and is resynced).
  - **Hands and inventory (#657, merged after soak 17's tag, so new here):** one inventory view for every count, so the crafting grid, the result slot and worn armour are no longer counted as carried, and food in the off hand counts; between actions the bot puts its pickaxe back in the off hand and its weapon in the main hand (also after a respawn).

  **For the team (no bot change):** the new `no_trap` check (#662: fails a soak when the bot is trapped or shut in its shelter for over 5 minutes, or dies while trapped; soaks 15 (shut in the shelter), 16 and 17 would fail it); test-tool follow-ups (#660), the memory checker counts real wrong facts only (#662).

  **How the memory is judged (your 2026-11-26 decision):** the code-built memory stays; if soak 18 shows it causing worse play, the lead switches back to the summaries with the one profile setting.

  **Steps (as before):**
  1. Your GO here.
  2. harness-ops creates one CPX42 (TTL 4 h) and reports its IP.
  3. You run the host check on the CX23 and paste the output.
  4. The 2-hour run.
  5. The server is deleted.
  6. The evidence PR.

  **Cost:** like soak 17 (USD 0.029 of LLM over 2 h; the CPX42 for about 2-3 h, EUR 0.40-0.55). Allow up to USD 0.30.

  **Watch items:**
  - `no_trap` (not trapped or shut in a shelter for over 5 min, no death while trapped), and every `[escape]` / `[trapped]` line, a table made by the escape, a re-made pickaxe, a dusk seal;
  - collects that skip targets below the floor ("Left N ... below y F"), and cobble crafted from rocks;
  - the memory checks (wrong facts, repeats) and the summary share;
  - `click rejected:` lines (expected 0 or close to it);
  - `[hands] idle:` lines (the pickaxe and weapon put back between actions).
- [x] **Code-built memory after soak 17: keep it with fixes, or switch back to summaries? (your decision)** (lead, 2026-11-26). **Decided 2026-11-26 about 22:40 UTC** (your words: "If the code-built memory was a likely cause of the bot's performance worsening, switch back to the more expensive variant"). **The lead's finding: it was not a likely cause, so the code-built memory stays (option (a)), with the fixes, and soak 18 judges it again by the same rule.** The 3 wrong agenda facts cost at most one call each and changed no play (17:17:05: the model's reply was a greeting, and the facts were right 7 s later; 17:22:20: the model checked `!agenda` once; 17:22:23: it went on to the right step). The true repeat (the crafting-table cell) came 1.5 min after the memory first named that failure, and 7 s after it named it again as "here", so the memory did not hide it. One other repeat (the ewe) followed the memory's 3-entry failure list dropping that failure; the code refused it, at the cost of one call (the lead asks skills-rotn to keep a failure in the list while it matters, in its small-fixes PR). Soak 17's worse outcomes, the trap and the death, came from the collect that dug down (#665) and the escape's gaps (#667): no table, a worn pickaxe, and interruptions by a craft the standing goal offered and by a zombie flee. The facts lines during the trap were right (the lost pickaxe, the block counts), so the memory did not cause them. If soak 18 shows the memory causing worse play, the lead switches back with the one profile setting. Your condition (the closed item below) was to keep it only if play improves, with no check worse. The judging rule for soak 17 had four tests: (1) every fact it states that can be checked matches the game; (2) summaries under 5% of the spend; (3) the agenda no slower than soak 16 (within 15%); (4) no check worse than soak 16; and "if any check is worse, one profile setting switches back to the summaries". Soak 17 (#661, every number checked by hand and by an independent review):
  - **(1) Not met: 3 wrong facts**, all in the agenda line: once "all steps done" before the agenda had started, and twice a step still named as current a few seconds after it was done. Two known causes (`describeAgenda` before the first step is set; the step name lagging a finished step); the lead asks skills-rotn to fix both in its small-fixes PR. The 26 misses the checker flagged were all checker errors; it missed the 3 real ones. Two fields (pickaxe, food held) had no samples the checker could use; checked by hand, the pickaxe was right at every change.
  - **(2) Met:** memory summaries 0% of the spend (soak 16: 33.6%); LLM cost USD 0.0146/h (soak 16: 0.028).
  - **(3) Met:** the agenda was done in 12.7 min (soak 16: 45.7). The evidence cannot say how much of that is the memory: `rotn-v0.1.23` also brought the RotN prompts (#645) and the escape and craft changes, and most of the gap is one step (stone_axe, done on day 2 in soak 16).
  - **(4) Not met: 1 true repeated failure** (soak 16: 0): the same crafting-table cell a minute after the memory named the failure. The checker counted 4; by hand 1 true repeat, 2 fair retries elsewhere, 1 refused by the code (the 3-entry failure list had already dropped that failure).
  - **Level:** the model made 0 wrong claims about its own state (0 of 15; soak 16: 0 of 7). Does level count as better play for you?
  - Separately, the standing goal's "you hold" food figure (code-built prompt text, not the memory lines) was stale twice, and the model repeated it.
  - **By that rule the default is (b); (a) asks you for an exception.** Choose one: (a) **keep the code-built memory, with fixes**, and judge it again in soak 18 by the same rule: the lead would ask skills-rotn to keep the agenda line in step with the agenda, keep a failure in the list while it matters, and build the food figure after a pickup (the lead's recommendation: the errors have two known causes, the savings are real, and the wrong claims stayed at 0); (b) **switch back to the summaries** for soak 18 (one profile setting, `"memory": "summary"`; cost probably near soak 16's USD 0.028/h).
  - No change to the preset or any reasoning setting either way (your 2026-11-22 and 2026-11-24 decisions stand).
- [x] **Soak 17: your GO** (lead, 2026-11-26). **Done: GO given about 14:20 UTC (G4-SOAK-17-20261126); the lead reset FRCFLD state at 14:20; the first server (mcr-test-20261126-142215) waited for the host check until 16:04 and was deleted unused; on your "Try the soak again" a second server got the same address, you confirmed the host at about 17:16, and the 2-hour run 17:16-19:17 UTC on `rotn-v0.1.23` was a SMOKE-PASS 9/9 (not gate evidence, by design; the scenario also had no trap check yet, see below); the server was deleted at 19:17:57 (evidence #661).** What it showed: the agenda was done in 12.7 min (soak 16: 45.7); all three nights were quiet in a shelter; a hen it hunted was killed, and no animal hit the bot; LLM cost USD 0.0146/h (half of soak 16), memory summaries 0% of the spend. But at 18:01 a `!collectBlocks("cobblestone", 7)` went for a buried cobblestone block at y 26, about 55 blocks below the surface (probably a dungeon wall), and its walk dug down to it (#642's depth rule covers walks, not the collect plugin's own walk). The escape could not get out: it cannot make a crafting table (on RotN a table needs crafting tools), its only pickaxe wore out (the break was logged twice), and the model's own craft and then a flee from zombies interrupted it. The model made a crafting table itself, the escape then made a pickaxe at it, and zombies killed the bot in its shaft at 18:09 (one 6.2-min trap from the first trap line, about 8 min underground). A second, shorter trap at 18:40 (a stone collect) was cleared by the escape in 90 s. Fixes in progress: collects never dig more than 2 below their start, and cobblestone is crafted from carried rocks (skills-rotn, PR T, with one shared movements setup for every digging path); the escape makes its own table, re-makes a pickaxe before it wears out, fights in place instead of fleeing, and at dusk seals its shaft for the night (PR E); a short hold after a dig before the next inventory click, so the server sends the pickaxe's new damage before that click and the click is not rejected (net-forge); and a new soak check, `no_trap` (the lead's decision): a soak FAILS if the longest trap is over 5 min or the bot dies while trapped (harness-ops; earlier verdicts are not rewritten). `rotn-v0.1.23` is deployed (by the lead through the gate, 02:08 UTC).

  **Soak 16** (`rotn-v0.1.22`) FAILED 8/9 (item below): a walk that dug down through stone used up its pickaxe (probably) and trapped the bot for 35 minutes, then two deaths (zombies at the top of its dig-out; a hen it had provoked, which it never fought back). Cost passed at USD 0.028/h, and memory summaries were 33.6% of the spend. Each change below was reviewed independently, most in two or three rounds.

  **What changed for the bot:**
  - **Getting trapped (#642):**
    - when the way out needs a pickaxe and none is carried, the escape crafts one (from cobble or rocks and sticks, at a table it places beside it); once the agenda's pickaxe step is done, the bot re-makes a lost pickaxe in idle time (at most 2 tries a day);
    - walks keep the last fifth of the pickaxe's uses and never dig more than 2 blocks below the lower of their start and goal; with no usable pickaxe they never break stone;
    - a walk that ends "unable to reach" now counts as failed, so the escape runs after it;
    - a trapped bot is re-planned even when its daily budget is spent (bounded: at most 3 model calls per place per day);
    - a broken tool is logged.
  - **Animals that fight back (#652):** a hen (or another weak animal) that attacks is fought at once; with no weapon only above 6 health, otherwise it flees. The bot never swings at an animal that is not its target.
  - **Shelter at night (#652):** a roof block that will not stay is retried from other sides, then one block lower if that is safe.
  - **Code-built memory (#637), your decision with its condition:** the bot's memory is now built from the game state (agenda, reserves, recent failures, deaths, places); the summary model runs only when a task giver (a trusted player) spoke. Soak 17 measures whether play improves (see below); one profile setting switches back if it does not.
  - **Prompts for this pack (#645):** examples written for RotN, fewer commands shown to the model, and `!goToBed` refused once the Scroll of New Life is used (a bed would end its protection).
  - **Crafting (#638, #639):** a craft the server would turn into a different item is refused with no items lost (soak 16: 9 sticks became a stick wall), and such recipes are offered last.
  - **Safety (#636):** `!attackPlayer` is removed entirely.
  - **Diagnostics (#653):** every attack names its target and the code that sent it.

  **For the team (no bot change):** the trap length is measured properly (#648: soak 16 reads 34.9 min, was 7.8), the memory checks for your condition (#655), a recipe-collision tool (#647).

  **How the memory is judged (your condition):** it stays only if every fact it states that can be checked matches the game, the summaries are under 5% of the spend (the USD per hour is reported too), the agenda is no slower than soak 16 (within 15%), and no check is worse than soak 16. Soak 16 had no wrong-state claims (0 of 7) and no repeated failures, so these two can only stay level, not improve; the lead reports them and asks you whether that counts as better play. If any check is worse, one profile setting switches back to the summaries.

  **Steps (as before):**
  1. Your GO here.
  2. harness-ops creates one CPX42 (TTL 4 h) and reports its IP.
  3. You run the host check on the CX23 and paste the output.
  4. The 2-hour run.
  5. The server is deleted.
  6. The evidence PR.

  **Cost:** like soak 16 (USD 0.056 of LLM over 2 h; the CPX42 billed about 3 h, about EUR 0.45). ADR 0010's target is USD 0.05/h (about USD 0.10 for the 2 h); allow up to USD 0.30 in case a day runs far above it.

  **Watch items:**
  - no trap (the trap span), and any escape or `[trapped]` lines;
  - the memory checks and the summary share;
  - fights with animals and every `[attack]` line;
  - roof retries at night;
  - craft refusals and rejected clicks;
  - `[tool] broke` lines.
- [x] **Code-built memory instead of most memory summaries (your decision)** (lead, 2026-11-25). The outside review (Fable, `/home/rv/bot-typical-issues-fable-review.md` Q4.1 on the dev server) found that memory summaries are 34-52% of LLM spend (Q4.1); its section 5.4 also notes the model claiming state the bot did not have (soak 15: "Up to y=60" while it stayed at y 57). It proposes building the memory from game state in code (`progress.js`, the agenda, the last 3 failures) and calling the summary model only when a player spoke or the model asked to remember something. The lead plans to add held items, deaths and known places, and to count only trusted players (the untrusted-player rules stay). **Decided 2026-11-25 about 20:20 UTC: approved, on the condition that it improves the bot's play, not only its cost** (your words: "I'll agree to the LLM cost item if it improves the bot's performance"). The lead measures that in the evidence (the memory text against the game state, the model's wrong-state claims, agenda time, plus the spend share against soak 16's baseline) and keeps it only if the evidence shows better play (no check worse). It does not change the preset or send any reasoning setting (your 2026-11-22 and 2026-11-24 decisions stand).
- [x] **Soak 16: your GO** (lead, 2026-11-25). **Done: GO given about 20:20 UTC (G4-SOAK-16-20261125), in the lead session; the lead reset FRCFLD state through the gate at 20:23 UTC; harness-ops creates the CPX42. The run 20:29-22:29 UTC on `rotn-v0.1.22` FAILED 8/9 (`ate_when_low`: 4 of 10 low-food lines with no eat, one during the dig-out, 36 s before death 1, and three after death 2 had cost the bot its food); the server was deleted at 22:30:23 (evidence #644).** What it showed: the new escape got the bot out of a hole in 127 s (20:41); then a destructive `!goToCoordinates` walk buried it 11 blocks down at 21:19 with its stone pickaxe gone (probably worn out; no line shows it), and it stayed trapped until 21:54, when the model crafted a new pickaxe and dug out; zombies killed it at the top (death 1); at 22:01 an Animania hen, which attacks only a player who hurt it (probably hit during the bot's fight with a hog), pecked the bot to death, and the bot never fought back because it treats hens as food (death 2); on night 3 its hole shelter's roof block would not stay in place and it spent the night in an open hole. One rejected click came from a recipe collision (9 sticks make a stick wall on the server, not planks). Cost passed: USD 0.028/h (day 0.071/h, night 0.004/h); memory summaries were 33.6% of the spend, the baseline for the code-built memory (#637). Already fixed on develop: the trap (#642: a pickaxe is made before the climb, walks keep pickaxe uses and never dig below both ends, a trapped bot is re-planned), the recipe collision (#638, #639, #641), `!attackPlayer` blocked (#636), the code-built memory (#637). In progress: fighting back at a provoked animal, the refused roof, RotN prompts (#645). `rotn-v0.1.22` is deployed (by the lead through the gate, 18:36 UTC).

  **Soak 15** (`rotn-v0.1.21`) was the first SMOKE-PASS 9/9, with no death and USD 0.044/h. But the bot spent about 80 of 120 minutes trapped about 8 blocks underground after a rock collect dug down. Each item below was reviewed independently; most were also checked offline in the new fake world.

  **What changed for the bot:**
  - **No more digging into holes (#630):**
    - the rock collect takes loose rocks first, then stone open to the air;
    - the rock collect never breaks a block that would leave no walkable way out;
    - the shelter blocks are now a scripted job in the morning;
    - the agenda no longer tells the model to mine stone for rocks.
  - **Getting out (#624):** one escape is used everywhere:
    - `!goToSurface` (aims at real open ground, not treetops, and reports the truth);
    - the morning dig-out (more than 4 steps);
    - after a collect that dug the bot down;
    - on a respawn that could not walk away.

    It spends dirt and planks first and keeps the 14-block shelter reserve by day.
  - **The pickaxe (#619):** the off-hand pickaxe is taken back around every action and before any dig (the probable soak 15 cause). The 2x2 crafting grid is emptied after a failed craft. `!inventory` shows what is in the grid, on the cursor and in the off hand. `!newAction` is no longer offered while code is off.
  - **Inventory sync (#618, #633):** the bot now uses the server's real stack sizes. StackUp, a pack mod, changes how many items fit in a slot (256 dirt piles or rocks, for example), and the bot assumed 64. So the bot's inventory clicks now match what the server does. This was the cause of soak 15's rejected clicks; the failed crafts are covered by #619's grid return.
  - **Food (#627, with rotn-data's weapon sweep data #621):**
    - a daytime food reserve (the night's need + 4) is filled by a scripted forage/hunt job; the model is only asked where to go when nothing is in sight (or after the job's 4 runs in a day);
    - hogs are now huntable: they have no attack (the ownership check still applies);
    - the herd rule counts same-breed cows nearby; a bull counts only if the weapon's sweep could reach it (the club does not sweep); the rule is re-checked during the chase (the soak 15 cow).
  - **Truthful lines (#632):** "Broke" only when the server shows the block gone, the walk's own digs reported apart, "4 rocks make 1 cobble" named.
  - **Diagnostics (#618, #625):** one line per rejected click and per refused dig, naming where every pickaxe is.

  **For the team (no bot change):**
  - a journal checker over all soaks (#623, #626);
  - a shared fake world (#628, #631);
  - a fake Forge server (#629).

  **Steps (as before):**
  1. Your GO here.
  2. The lead resets FRCFLD's state through the gate; harness-ops creates one CPX42 (TTL 4 h) and reports its IP.
  3. You run the host check on the CX23 and paste the output.
  4. The 2-hour run (the runner starts the bot through the gate, without enable).
  5. The server is deleted.
  6. The evidence PR.

  **Cost:** EUR 0.40-0.55 for the server (soak 15 was billed about 3 h, EUR 0.41 plus the IPv4); LLM about USD 0.09 (soak 15: 0.088), allow up to USD 0.30.

  **Watch items:**
  - no trap underground;
  - the shelter-blocks job in the morning;
  - the food reserve at each sunset;
  - no rejected clicks;
  - rock-search stalls of about 2 s on stone-poor ground.
- [x] **Soak 15: your GO** (lead, 2026-11-24). **Done: GO given about 22:25 UTC (G4-SOAK-15-20261124); host confirmed about 22:36; the 2-hour run 22:36-00:37 UTC on `rotn-v0.1.21` was a SMOKE-PASS 9/9, the first soak with no failed check (not a gate pass): no death, agenda done at 00:06:56, lowest food 7, ate_when_low 8 of 8, USD 0.0437/h, peak 594 MiB (evidence #616); the server was deleted at 00:37:38. But the bot spent about 80 of the 120 minutes trapped about 8 blocks underground after a rock collect dug down, probably because #614 keeps the stone pickaxe in the off hand (and once it sat on the cursor after a rejected click), where the pathfinder and `!digDown` cannot see it, so every way out failed until the model dug its own way out on day 3 (00:01). Fixes in progress (net-forge: the pack's real stack sizes, which probably also explain 9 rejected inventory clicks; skills-rotn: the pickaxe handled around every action, the crafting grid emptied, the existing escape wired in). An outside review of the recurring issues is at `/home/rv/bot-typical-issues-fable-review.md` on the dev server.** `rotn-v0.1.21` is deployed (by the lead through the gate, 21:58 UTC). Soak 14 (`rotn-v0.1.20`) FAILED 6/9 with 3 deaths: a Grove Sprite (provocation still unexplained; the bot's hurt lines could not name it) and two starvations (Hunger Overhaul kills 4 s after food 0); cost passed (USD 0.037/h). After the two starvation deaths digs hung (dirt by hand 926 s), because mineflayer kept the low-food Mining Fatigue IV after the respawn. `rotn-v0.1.21`: mineflayer drops stale effects on a respawn, and the journal counts attack packets (#610); food for the night: the bot eats at 8 (least valuable first; the most valuable at 6 or lower), works out the night's need (about 7 points for a sealed night), makes a food run of at most 3 min at sunset when short, and at food 4 or less with nothing held leaves even a closed shelter for food (at most 5 resumes and 6 min in all, then back to the shelter, or a new one where it is); hurt lines name any mob that hits it (#612); after a daytime death it gathers shelter blocks before dusk first (not at very low food), keeps its stone pickaxe in the off hand so a death keeps it, and dig limits follow the real tool and effects (#614); the hunger facts are pack data (#611); the memory-summary reasoning setting is reverted, your decision (b) (#609). **Steps:** as for soak 14 (the lead has one disposable CPX42 created, you check FRCFLD's `"host"` and the file mode, the lead resets state, then the 2-hour `g4-soak-2h`; the server is deleted afterwards). **Cost:** EUR 0.40-0.55 for the server plus LLM use: soak 14 spent USD 0.075 over 2 h, so allow up to about USD 0.30.
- [x] **Soak 14: your GO** (lead, 2026-11-24). **Done: GO given about 14:30 UTC (G4-SOAK-14-20261124); host confirmed about 14:40; the 2-hour run 14:42-16:43 on `rotn-v0.1.20` FAILED 6/9 (agenda_done, food_floor, ate_when_low; cost passed at USD 0.037/h): 3 deaths (a Grove Sprite at 14:47, starved at 15:29 and 16:26); the memory-summary setting (#600, #603) had no effect (HTTP 400; reverted in #609). The server was deleted at 16:43:44. Evidence #608; fixes in `rotn-v0.1.21` (soak 15 item above).** `rotn-v0.1.20` is deployed (by the lead through the gate, 06:58 UTC). Soak 13 (`rotn-v0.1.19`) had no death and no hurt for the whole 2 hours and FAILED only `usd_per_hour` (0.0552 against 0.05; #599). `rotn-v0.1.20`: memory summaries without reasoning (#600, #603; see the item above), animal searches say what is in sight and are limited to 64 blocks (the server shows the bot Animania animals only within 64 blocks), and after 3 misses in one area the reply says nothing more is near and to move on, summaries every 10 turns instead of 5, the food goal says food held, not the hunger bar, and an unknown block or item name gets close suggestions (#601); the Scroll of New Life (refused at all 3 sunsets in soak 13: the bot's cobble walls take 1.5 s with its stone pickaxe) now counts only what a death keeps (the hands), each "no walkable way out" refusal names the cells that blocked it, and in the morning the bot tries the scroll from its opened shelter; if it uses it, it then takes the roof down (when the sky above is open and no hostile is near) so a zombie there burns by day (#604); and a spend tool for the evidence (#602). **Steps:** as for soak 13 (the lead has one disposable CPX42 created, you check FRCFLD's `"host"` and the file mode, the lead resets state, then the 2-hour `g4-soak-2h`; the server is deleted afterwards). **Cost:** EUR 0.40-0.55 for the server plus LLM use: soak 13 spent USD 0.110 over 2 h, so allow up to about USD 0.30.
- [x] **Soak 13: your GO** (lead, 2026-11-23). **Done: GO given about 01:35 UTC 2026-11-24 (G4-SOAK-13-20261124); the env file already named the new server (same address), host confirmed about 01:50; the 2-hour run 01:51-03:52 on `rotn-v0.1.19` FAILED 8/9 (`usd_per_hour` 0.0552 against 0.05): no death and no hurt, the Scroll of New Life refused at all 3 sunsets; the server was deleted at 03:52:59. Evidence #599; fixes in `rotn-v0.1.20` (soak 14 item above).** `rotn-v0.1.19` is deployed (by the lead through the gate, 22:03 UTC). Soak 12 had no death for 109 min, then 16 in the last 11 min (#591). `rotn-v0.1.19`: a zombie inside the bot's shelter cell is fought at any health when the bot is armed (unarmed: one burrow, then it hits back), the bot no longer "eats" with a hostile in reach, and mob scaffolding is never broken while a mob is over it (#592); the scroll is never used in a hole or a cell with no walkable way out, a night respawn with hostiles near escapes and may dig out (at most 6 quick blocks, never under gravel or sand), self-preservation's low-health flee cannot cut the escape short (fire, lava, drowning and falling blocks still can), two deaths at the same spawn within 5 min make it burrow and seal instead, the club goes to the main hand at a respawn, after a night respawn with fewer than 3 shelter blocks and no hostile within 16 it gathers dirt nearby, and a blocked hole shelter is dug out of in the morning (#593); open fights stop when no hit lands, !attack picks up its kill, and arrows are named in the hurt lines (#594, #597); pack tools now dig at the server's speed (a flint pickaxe breaks stone in 0.6 s, was 7.5 s) and a dig the pack forbids fails at once with "needs a better tool" (#595, #597). **Steps:** as for soak 12: the lead has one disposable CPX42 created (4 h TTL, 8-hour delete-after watchdog) and gives you its address; you check (and if needed set) FRCFLD's `"host"` and confirm the host line and that the env file is `root:root` 600; the lead resets FRCFLD state through the gate; then the lead's run starts FRCFLD through the ctl, without `enable`, for the 2-hour `g4-soak-2h`; the server is deleted afterwards. **Cost:** EUR 0.40-0.55 for the server and its Primary IPv4, plus LLM use: soak 12 spent USD 0.069 over 2 h, so allow up to about USD 0.30.
- [x] **Soak 12: your GO** (lead, 2026-11-23). **Done: GO given about 12:30 UTC (G4-SOAK-12-20261123); the env file already named the new server (same address), host confirmed about 13:20; the 2-hour run 13:21-15:22 on `rotn-v0.1.18` FAILED 8/9 (ate_when_low): no death for 109 min, then 16 deaths in the last 11 min. Death 1: an Epic Siege Mod zombie bridged into the bot's night-3 shelter and the bot never fought it; deaths 2-16: a loop at the Scroll of New Life respawn point, the bottom of the night-2 hole shelter. Evidence #591; fixes in `rotn-v0.1.19` (soak 13 item below).**
- [x] **Soak 11: your GO** (lead, 2026-11-22). **Done: GO given about 20:23 UTC (G4-SOAK-11-20261122); host confirmed about 20:36; the 2-hour run ended 22:37 (FAIL 6/9: 6 deaths, 3 at shelter breaches, 1 in the open after the night-2 shelter tries failed, 1 starving, 1 spider; no death loop, the respawn escape worked every time; evidence #585); the server was deleted at 22:37:35.** `rotn-v0.1.17` is deployed (by the lead through the gate, 20:07 UTC). Soak 10 ran the full 2 hours with no craft hang or restart, but the bot entered night 1 with no weapon (the agenda spent its crude axe), a zombie breached the dirt shelter with no blocks left to repair it, the bot hand-fought and died, and then died 125 more times at the world spawn, where every death leaves a player zombie that never burns or despawns; it got out only at full day (#578). `rotn-v0.1.17` makes the wooden club (2 logs, no table) its weapon, crafted without the model (#579); keeps 4 spare dirt for repairs, repairs with logs or planks, and burrows and seals itself in rather than hand-fighting (#580); and, after a death near player zombies, sprints at least 64 blocks from the spawn and every recent death spot at any time of day, then uses its Scroll of New Life once at a safe shelter so later deaths there raise no player zombie (#581). Still untested in a soak: the escape from a stuck spot (#562), the ore skip by a liquid (#564), and Better Combat against a mob that fights back with a real weapon. **Steps:** as for soak 10: the lead has one disposable CPX42 created (4 h TTL, 8-hour delete-after watchdog) and gives you its address; you set FRCFLD's `"host"` to it (the file still names soak 10's deleted server) and confirm the host line and that the env file is `root:root` 600; the lead resets FRCFLD state through the gate; only then does the lead's run start FRCFLD through the ctl, without `enable`, for the 2-hour `g4-soak-2h`; the server is deleted afterwards. **Cost:** EUR 0.40-0.55 for the server and its Primary IPv4 (billed by the hour, deleted after), plus LLM use: soak 10 spent USD 0.051 over 2 h (0.079/h while self-prompting, with the preset's default reasoning, your decision), so allow up to about USD 0.30.
- [x] **Soak 10: your GO** (lead, 2026-11-22). **Done: GO given about 15:11 UTC (G4-SOAK-10-20261122); host confirmed about 15:19; the 2-hour run ended 17:20 (FAIL 7/9: no weapon at night 1, then a death loop at the world spawn, 126 deaths; evidence #578); the server was deleted at 17:20:48.** `rotn-v0.1.16` is deployed (by the lead through the gate, 14:28 UTC). Soak 9 finished the whole 11-step agenda in about 14 minutes with no death, then ended at minute 15: after a stone pickaxe craft at a table it had placed, the bot's action hung (most likely picking the table back up, in mineflayer-collectblock's unbounded pickup wait), ignored the unstuck reflex's stop, and Mindcraft killed the process; the harness ends a soak at the first lost connection (#568). `rotn-v0.1.16` bounds the craft and the table pickup and ends them on a stop (#571, #574), and patches mineflayer-collectblock so its pickup and cancel waits end (#570, #573). Still untested in a soak: the escape (#562), the ore skip by a liquid (#564) and the walk to better ground (#557) (soak 9 used only `!placeHere`'s jump-place from #564, which worked), and Better Combat against a mob that fights back. **Steps:** as for soak 9: the lead has one disposable CPX42 created (4 h TTL, 8-hour delete-after watchdog) and gives you its address; you set FRCFLD's `"host"` to it (the file still names soak 9's deleted server) and confirm the host line and that the env file is `root:root` 600; the lead resets FRCFLD state through the gate; only then does the lead's run start FRCFLD through the ctl, without `enable`, for the 2-hour `g4-soak-2h`; the server is deleted afterwards. **Cost:** EUR 0.40-0.55 for the server and its Primary IPv4 (billed by the hour, deleted after), plus LLM use: soak 9 ran USD 0.14/h of daytime work with the preset's default reasoning (kept, your decision), so allow up to about USD 0.30 for the 2 h.
- [x] **Soak 9: your GO** (lead, 2026-11-22). **Done: GO given 2026-11-22 ~11:35 UTC (GO id `G4-SOAK-9-20261122`); the lead reset FRCFLD state through the gate at 11:37 UTC; harness-ops creates the CPX42 from `rotn-v0.1.15`. You confirmed the host (to the lead, about 11:50 UTC; the unit started at 11:50:57). The run ended at minute 15 on a craft hang (FAIL 7/9, evidence #568); the server was deleted at 12:07.** `rotn-v0.1.15` is deployed (by the lead through the gate, 04:07 UTC). It carries the soak 8 fixes: the escape from a flooded pit or any stuck spot (digging pathfinder that may tower, else hand-dug stairs, else a jump-and-place pillar; at most 8 blocks and 90 s per escape, 2 failed escapes per spot; #562), `!placeHere` pillaring out of the bot's own cell and skipping ore that has a liquid near it and no dry footing (#564), and walking to better ground when there is no shelter site where it stands (#557). It also refuses to start if its RotN data cannot load (exit 3, not restarted; #555), and treats an unknown living modded mob as hostile (#553). Better Combat's attack stays on (still untested on a mob that fights back: soak 8 had no fight with a hostile mob, only one `!attack` kill of a sow). **Steps:** the lead has one disposable CPX42 created (4 h TTL, 8-hour delete-after watchdog) and gives you its address; you set FRCFLD's `"host"` to it and confirm the host line and that the env file is `root:root` 600; the lead resets FRCFLD state through the gate; only then does the lead's run start FRCFLD through the ctl, without `enable`, for the 2-hour `g4-soak-2h`; the server is deleted afterwards. **Cost:** EUR 0.40-0.55 for the server and its Primary IPv4 (billed by the hour, deleted after), plus LLM use: soak 8 ran USD 0.0437/h over 2 h (0.117/h by day; see the preset item below), so allow up to about USD 0.25 for the 2 h unless the preset's reasoning is turned off first.
- [x] **OpenRouter preset: hidden reasoning tokens** (lead, 2026-11-21; your account). **Decided 2026-11-22: you keep the preset's default reasoning on, for better bot behaviour. The lead sends no per-request reasoning setting and keeps logging `[openrouter] reasoning_tokens`; soak reports keep showing the day rate against ADR 0010's USD 0.05/h.** **Amended 2026-11-24 (your decision, the memory-summary item above): memory-summary calls only send `reasoning: { effort: "none" }` (#600, #603); every other call keeps the preset's default reasoning and sends no setting.** **Amendment withdrawn 2026-11-24 about 18:00 UTC (your decision (b), the memory-summary item above): #600 and #603 are reverted; the 2026-11-22 decision applies unchanged, no call sends a reasoning setting.** **Measured in soak 8 (#558): 96% of completion tokens were reasoning** (303,189 of 315,860; every completion logs `[openrouter] reasoning_tokens`), at about 1,400 hidden tokens per completion (about 4,000 per memory summary), and each completion cost 58% more than in soak 7 (USD 0.000405 against 0.000257). Day rate USD 0.117/h (0.131/h while self-prompting) against ADR 0010's USD 0.05/h; the 2-hour average (0.0437/h) passes only because nights make no calls. In soak 7 the day rate was 0.090/h against soak 6's 0.057/h (about 1.6 times). Memory summaries are 52% of the spend. Please turn reasoning off (or cap its tokens) in the preset `glm-5-3-flash-cheap-reliable` on openrouter.ai; that is your call on your account. If you prefer, the lead can instead send a per-request reasoning setting from the bot (a code change in `src/models/openrouter.js`); say which.
- [ ] **G4: the service GO marker names the bot** (#401): each S run's GO from the lead gives a GO id, and the runner is started with `ROTN_SERVICE_GO=<GO id>:<bot unit>:test-server-host-confirmed` (for example `...:frcfld:...`). Your confirmation in that GO covers that bot's env file only.
- [ ] **G4: a trusted player for the control and task checks** (later). Follow, come, one trusted task, and a task kept across a service restart need a real player who is a task giver. Choose one:
  - about 10 minutes of you playing as JQDAW on a disposable test server, at a time harness-ops arranges;
  - a second, scripted account that you add to `task_givers` (your decision).

  One extra account could serve both this item and the next one (not at the same time).
- [ ] **G4: a second Minecraft account** (later) for the "second bot profile" smoke test. The profile name must equal the account name, and one account can't be online twice. It needs its own device-code login, done by you.
- [ ] **G4: the CX23's IPv4 for each service batch** (later): give it in each GO message for `--allow-from`. It never goes in the repo.
- [ ] **Move the lead and the four dev agents to the CX33 dev server** (the human's plan, 2026-11-06; the human corrected the type from CPX32 to CX33 on 2026-11-07; after G3 smoke round 7; it ends the RAM pressure on the Windows PC). Every step marked *you* involves a secret or an account, so no agent does it.
  1. **Before** (the lead confirms): every agent has pushed its branches and STATUS handoff; no Hetzner test server exists; no batch is running.
  2. **Base system** (you): Node.js 22 LTS (same major as here, ADR 0002), git, build tools for native modules (`build-essential`, `python3`), `gh`, `hcloud`, `jq`, `bash`, `curl`, `unzip`, `openssh-client` (`ssh`, `ssh-keygen`, `scp`), and a JDK 8 (rotn-data uses `javap` to cite pack bytecode; `tools/dumper/build.sh` needs JDK 8).
  3. **The pack zip** (you): copy the pinned RotN 3.3.4 server pack zip (SHA-256 `90642fd5...f5205`) to the dev server; harness-ops sets `ROTN_PACK_ZIP` to its path (`PACK_ZIP` defaults to a Windows path in deploy/test-server.sh).
  4. **Accounts and secrets** (you, never in a file in the repo):
     - Hetzner: an hcloud context for the **test** project (`hcloud context create mindcraft-rotn-test`, token typed by you), not an exported `HCLOUD_TOKEN`. Keep the dev server itself in a different Hetzner project from the test servers, so the sweeper can never touch it.
     - GitHub: `gh auth login` as JQDAW (the keyring, not an exported token).
     - OpenRouter: `OPENROUTER_API_KEY` (the test key) only in the session that runs batches (harness-ops), not in every agent's shell.
       - **Open (2026-11-07):** the lead's shell on the CX33 has it set (checked set/unset only), so other agents' shells probably inherit it too. Move it out of the shared shell profile into the harness-ops session only.
     - Your SSH key for reaching the dev server.
  5. **Repo and worktrees** (agents, after 2-4): clone `JQDAW/mindcraft-RotN`, `npm ci` in each worktree (patch-package must apply), one worktree per agent on its branch, as on this PC.
     - **Done 2026-11-07** by the lead: worktrees `/home/mindcraft-RotN-worktrees/<agent>` on `agent/<agent>/cx33-start`; `npm ci` passed in each, with 8/8 patches applied.
  6. **Bot account** (you, after 5): run the device-code login for FRCFLD once, `node packages/forge-bridge/tools/msa-login.mjs` with `MINDCRAFT_PROFILES_FOLDER` set (deploy/cx23/README.md); harness-ops gives you the exact command and folder, then checks it with `--check`.
     - **Done 2026-11-07** by the human: the profile was `FRCFLD`. The lead's `--check` passed. Folder `/root/.mindcraft-rotn/FRCFLD/msa`, mode 0700, root only. harness-ops sets `MINDCRAFT_PROFILES_FOLDER` to it for batches.
  7. **Agent sessions** (you): start the lead and the four agents the way you prefer (Orca or another terminal manager), never in bypass-permissions mode. Orca's agent launch can add the bypass flag: decline that prompt and start plain `claude` instead. The lead rebuilds its own memory notes from STATUS and PLAN.
     - **Done 2026-11-07:** the human removed Orca's saved bypass argument. The lead started rotn-data, skills-rotn and harness-ops in Orca terminals as plain `claude` (auto mode). net-forge was started, then closed for lack of a task.
  8. **Validation** (the lead gives a GO): one G3 smoke batch from the dev server, all checks as usual. It only checks the environment and never counts toward the gate: under docs/PLAN.md the full 4/4 A-D smoke round on the final commit still runs before any gate batch. The test-server sweeper and watchdog are unchanged.
     - **Done 2026-11-07:** smoke D on `198bacbb`, PASS 7/7 (evidence PR #308, validation only).

## Done

- [x] **G4 step 0 on the CX23**: done by the human, 2026-11-08: reviewed ctl and gate installed and checked by SHA-256, `add-bot frcfld`, env file with the production OpenRouter key, `deploy.sh`, FRCFLD's device-code login (`--check` exit 0), first start on a test server (evidence #411).

- [x] **G4: decide how the dev server drives the CX23**: done by the human on 2026-11-07, option (b). A dedicated key from the CX33 to `deploy@cx23`, restricted with `from=` (the CX33), `restrict` and a forced command, `/usr/local/sbin/mindcraft-rotn-ssh-gate`, which allows only `status`, `start` and `stop` with a valid bot name through `sudo -n mindcraft-rotn-ctl`. See ADR 0009.
- [x] **CX23: swap the Orca targets** (done by the human, 2026-11-03 about 02:00 UTC, as they reported in the lead session; `orca environment list` on this PC shows only `cx23 deploy`). The deploy user has its own Orca environment with a folder workspace at /tmp; the root target is removed. Root SSH stays enabled on the server, key only, for the human.
- [x] **CX23: reboot for the pending kernel** (done by the human, 2026-11-03 about 01:50 UTC: updated and rebooted). GO 3 evidence shows kernel 7.0.0-42-generic, Ubuntu 26.04.1 (test/evidence/cx23/post-bootstrap-20261103/check.txt:16).
- [x] **OpenRouter test key (USD 5 limit) for G3 batches:** stored by the human as the Windows user environment variable `OPENROUTER_API_KEY` (2026-11-03 about 02:50 UTC; the lead checked only that it is set). Orca terminals see it after an Orca restart, scheduled by the lead before the first G3 batch; if Orca filters it, the human runs the batch command in their own PowerShell. Model for all LLM runs: `@preset/glm-5-3-flash-cheap-reliable`.

- [x] **CX23 bootstrap (GO 2)**, run by the human as root, 2026-11-03 about 01:20-01:35 UTC, from develop with #144. The human first stripped Windows CR line endings from the copied files. Read-only check first: only `Include /etc/ssh/sshd_config.d/*.conf`, no Match. `setup` completed:
  - users `mindcraft-rotn` (no login) and `deploy` (key authorized);
  - a sudoers rule for `mindcraft-rotn-ctl` only, checked under sudo-rs 0.2.13;
  - Node v22.23.4 from NodeSource; a 2 GB swapfile;
  - ufw allows incoming SSH only;
  - SSH password login off (verified with `sshd -T`), with root's key login unchanged.

  The human then set `passwd deploy`, and confirmed the `deploy` key login from a second terminal (01:25 UTC).
- [x] **CX23 root access for setup:** the human added the Orca SSH target `cx23` (root via an SSH key on this PC; the IP is not in the repo), 2026-11-02 18:12 UTC. Replaces "CX23 root login".
- [x] **Set up an external cron job that triggers the sweeper every 15 min** (rotn-lead, 2026-11-01 13:55 UTC; you chose this option).
  - **Why.** GitHub does not run scheduled workflows on your account at all. The non-fork helper repo also missed 13:18, 13:33 and 13:48, while manual and API dispatch always work. GitHub's status page shows no incident.
  - **About 10 minutes:**
    1. **Create a second fine-grained token** at https://github.com/settings/personal-access-tokens/new:
       - Name `rotn-sweeper-cronjob`, expiration 90 days (calendar reminder).
       - Resource owner JQDAW, **Only select repositories: mindcraft-RotN**.
       - Repository permissions: **Actions: Read and write**, nothing else.
       - Copy it; paste it only in step 2c below.
    2. **Create a cron job** at https://cron-job.org (free account), "Create cronjob":
       a. Title `rotn test-server-sweeper`. URL:
          `https://api.github.com/repos/JQDAW/mindcraft-RotN/actions/workflows/test-server-sweeper.yml/dispatches`
       b. Schedule: **every 15 minutes**.
       c. Advanced:
          - Request method **POST**.
          - Headers:
            - `Accept: application/vnd.github+json`
            - `Authorization: Bearer <the token from step 1>`
            - `X-GitHub-Api-Version: 2022-11-28`
            - `Content-Type: application/json`
          - Request body: `{"ref":"develop"}`
       d. Notifications: turn on "notify me when execution fails", so a failing call reaches your email.
    3. **Test run.** Use cron-job.org's "Test run"; GitHub answers **204** (no content). Within a minute a new `workflow_dispatch` run appears in mindcraft-RotN, Actions, test-server-sweeper.
  - Then tick this box. harness-ops changes the preflight so it accepts a steady cadence: **at least 3 successful dispatched sweeper runs on develop in the last 50 min, roughly 15 min apart**, as well as the sweeper's own scheduled runs. The lead checks the cadence before approving any paid batch.
  - The helper repo `rotn-sweeper-cron` can stay; it costs nothing. If GitHub scheduling recovers, it becomes a second trigger. You may also delete it and revoke its token.
- [x] **Helper repo set up by the human (2026-11-01, about 13:08 UTC).** The lead verified through the API:
  - `JQDAW/rotn-sweeper-cron` is public and not a fork; its secret `SWEEPER_DISPATCH_TOKEN` exists (name only).
  - `dispatch-sweeper` is active, with the expected content.
  - A manual test chain worked: helper run at 13:08:08, then a test-server-sweeper `workflow_dispatch` run at 13:08:17, both successful.
  - Still to observe: the helper's own scheduled runs (slots :03/:18/:33/:48).
  - (Original item:) **Set up the helper repo that triggers the sweeper every 15 min** (rotn-lead, 2026-11-01 13:00 UTC; you chose this option).
  - **Why.** GitHub drops almost all scheduled runs of `test-server-sweeper` in this fork: one in about 12 h, and all four off-peak slots after the 11:45 fix. Manual dispatch always works. A small **non-fork** repo with its own schedule dispatches the sweeper. If the problem is fork-specific, its schedule fires normally.
  - **About 10 minutes:**
    1. **Create a public repo** named `rotn-sweeper-cron` under JQDAW (https://github.com/new). Public means free Actions minutes; a secret stays secret in a public repo too. Tick "Add a README".
    2. **Create a fine-grained token** at https://github.com/settings/personal-access-tokens/new:
       - Name: `rotn-sweeper-dispatch`. Expiration: 90 days (put a reminder in your calendar).
       - Resource owner: JQDAW. Repository access: **Only select repositories**, then **mindcraft-RotN** only.
       - Permissions: Repository permissions, **Actions: Read and write**. Nothing else (Metadata: read is added automatically).
       - Generate it and copy it. Do not paste it anywhere except step 3.
    3. **Store it as a secret** in the new repo: `rotn-sweeper-cron`, Settings, Secrets and variables, Actions, **New repository secret**, name **`SWEEPER_DISPATCH_TOKEN`**, value is the token.
    4. **Add the workflow.** In `rotn-sweeper-cron`, "Add file", "Create new file", path `.github/workflows/dispatch-sweeper.yml`, with exactly this content, then commit to `main`:

       ```yaml
       name: dispatch-sweeper
       # Triggers JQDAW/mindcraft-RotN's test-server-sweeper every 15 minutes.
       # GitHub drops nearly all scheduled runs in that repo (a fork), so this non-fork repo
       # provides the schedule. The token can only run Actions workflows in mindcraft-RotN.
       on:
         schedule:
           - cron: '3,18,33,48 * * * *'
         workflow_dispatch:
       permissions: {}
       jobs:
         dispatch:
           runs-on: ubuntu-latest
           timeout-minutes: 3
           steps:
             - name: Dispatch test-server-sweeper on develop
               env:
                 GH_TOKEN: ${{ secrets.SWEEPER_DISPATCH_TOKEN }}
               run: gh workflow run test-server-sweeper.yml --repo JQDAW/mindcraft-RotN --ref develop
       ```

    5. **Test it once.** In `rotn-sweeper-cron`, Actions, dispatch-sweeper, **Run workflow**. Within a minute a new `workflow_dispatch` run should appear in mindcraft-RotN, Actions, test-server-sweeper.
  - Then tick this box. The lead checks that the helper's scheduled runs fire. harness-ops changes the preflight so it accepts "a successful scheduled run of the helper within 40 min, followed by a sweeper run", in addition to the sweeper's own scheduled runs.
  - Note: GitHub turns off schedules in public repos after 60 days without activity. harness-ops will add a monthly keep-alive or a reminder.
- [x] **The off-PC sweeper runs far too rarely on its schedule** (rotn-lead, 2026-11-01 02:05 UTC; updated 11:15 UTC). **Resolved 2026-11-01:** the human set up the cron-job.org dispatch (every 15 min), which the preflight now accepts (PR #21).
  - **Update, 11:15 UTC:** one scheduled run did happen, at 06:30:54 UTC (success). That is the only one in about 10 h on a `*/15` cron, so the schedule is registered but GitHub drops almost every run.
  - The lead has authorized harness-ops to move the cron to off-peak minutes (`7,22,37,52 * * * *`) in a small reviewed PR. Busy :00/:15/:30/:45 marks are a known cause of dropped runs, and merging the change also re-registers the schedule.
  - Steps 1-2 below are still worth a look if you have a minute. If you check the Actions tab, please note here what it shows.
  - Original report (02:05 UTC): This blocks every paid test batch, because `deploy/test-server.sh up` refuses until a scheduled sweeper run exists.
  - **Facts.**
    - `test-server-sweeper.yml` has been on `develop` (the default branch) since 00:25 UTC, with `cron: '*/15 * * * *'`, and its state is `active`.
    - It ran twice through manual dispatch (00:32, 00:37, both successful), but there has been **no `event=schedule` run in 1 h 40 min**.
    - GitHub's docs say nothing about forks for `schedule`. Community reports say scheduled workflows are often off by default in **forks** (this repo is a fork of mindcraft-bots/mindcraft), or never fire until the workflow is re-registered.
  - **The lead tried to disable and re-enable the workflow with `gh`.** Claude Code's permission check blocked that as a CI change, which is right: it is your decision.
  - Please try, in order. Stop as soon as a scheduled run appears in the Actions tab; allow about 30 minutes after each step.
    1. GitHub, repo **Actions** tab. If there is a banner about workflows or scheduled workflows being disabled in this fork, click to enable them.
    2. Actions, **test-server-sweeper**, "..." menu, **Disable workflow**, then **Enable workflow**.
    3. If still nothing: tell the lead. Options then:
       - have harness-ops commit a trivial change to the cron line (this re-registers the schedule);
       - ask GitHub Support;
       - detach the repo from the fork network (Settings, a GitHub Support request; a big change, your call);
       - trigger the sweeper from an outside scheduler through `workflow_dispatch`.
  - Sources the lead read:
    - https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
    - https://github.com/orgs/community/discussions/203880
    - https://github.com/orgs/community/discussions/205999
- [x] **FRCFLD device-code login: done by the human on 2026-11-01**, as FRCFLD, using the steps below.
  - The lead verified it without opening any file. Names only: `C:/Users/admin/.mindcraft-rotn/FRCFLD/msa` holds three prismarine-auth cache files (live, xbl, mca).
  - The folder's ACL allows only admin, Administrators and SYSTEM, and it is not inside any git work tree.
  - (Original item, kept for reference:) **Ready now: one-time FRCFLD device-code login** (net-forge via rotn-lead, 2026-11-01). Needed for net-forge's online G1 run.
  - **About the helper.** `packages/forge-bridge/tools/msa-login.mjs`, reviewed line by line and merged in PR #10 (`26a0b5e`).
    - It contacts only Microsoft/Xbox/Minecraft login servers.
    - It prints only Microsoft's sign-in instruction and the profile name.
    - It writes only token-cache files into the folder below, outside the repo.
    - The lead checked that `DEBUG` is not set on this PC. If it were, the auth library could print tokens, so step 2 clears it anyway.
  - **Steps.** Use a new **PowerShell** window of your own, not an agent's terminal:

    ```powershell
    cd C:\Users\admin\source\mindcraft-RotN
    git log -1 --format="%h %s"          # should start with 26a0b5e or later on develop
    Remove-Item Env:DEBUG -ErrorAction SilentlyContinue
    $env:MINDCRAFT_PROFILES_FOLDER = "C:/Users/admin/.mindcraft-rotn/FRCFLD/msa"
    & "C:\nvm4w\nodejs\node.exe" packages/forge-bridge/tools/msa-login.mjs FRCFLD
    ```

    1. It prints a message like "To sign in, use a web browser to open https://www.microsoft.com/link and enter the code XXXXXXXX".
    2. Open that page, enter the code, and sign in with the **bot account**. Type the credentials **only there**.
    3. Back in PowerShell it should end with `Signed in. Minecraft profile: FRCFLD`.
  - **Afterwards:** tick this box and write here only whether the profile name was `FRCFLD`. Never paste the code, the email, the password or anything from the cache folder.
- [x] **Create a GitHub Environment for the off-PC test-server sweeper**: done by the human on 2026-11-01. The lead verified through the API: environment `hetzner-test-sweeper`, deployment branch policy `develop` only, environment secret `HCLOUD_TOKEN` (name only), no repository-level secrets. (harness-ops via rotn-lead, 2026-11-01) The sweeper deletes expired test servers even if this PC is asleep. Its token must live in an Environment that only `develop` can use, so a workflow changed on an agent branch cannot read it.
  1. https://github.com/JQDAW/mindcraft-RotN/settings/environments, "New environment", name **`hetzner-test-sweeper`**.
  2. "Deployment branches and tags": choose "Selected branches", add **`develop`** only. "Required reviewers": none, otherwise every scheduled run would wait for you.
  3. Add an **environment secret** (not a repository secret) named **`HCLOUD_TOKEN`**. Its value is a **new Read & Write API token of the Hetzner test project** (Hetzner console, test project, Security, API tokens). Make a separate token for this, so either one can be revoked on its own.
  - Needed for the watchdog proof (G0). No agent ever sees the token.
- [x] **Approve the dev briefs** in `docs/briefs/` (gate G0, human half). **Approved by the human in chat, 2026-11-01.**
  - Each of `net-forge.md`, `rotn-data.md`, `skills-rotn.md` and `harness-ops.md` ends with a "Phase 0 research revisions" section. The original text above it is unchanged, except that the RotN version now says 3.3.4.
  - Decisions behind them: `docs/adr/0002`-`0005`.
  - Main changes:
    - **net-forge** handles RoughlyEnoughIDs' changed packet formats. It also takes over restart and backoff, using a shared exit-code contract (0 clean stop, 1 retry, 3 fatal), plus more dependency patches.
    - **rotn-data** builds a server-side dumper mod (test server only) that also exports the mod-mob ID table, and emits recipes that skills-rotn can execute.
    - **skills-rotn** starts with safety fixes (no cheat mode, no restart after every smelt, no crash from one bad mode), then the RotN first-plank interaction and the survival rules. It also owns real crafting on the server. `JQDAW` is the first task giver.
    - **harness-ops** builds the test server with cloud-init, from the 3.3.4 zip pinned by SHA-256. It runs an off-PC cleanup sweeper whose token lives in a restricted GitHub Environment, never lets env files turn on insecure coding, and logs real hourly prices.
  - To approve: tick this box, or write "approved, except ..." under it. The lead then starts harness-ops, then net-forge.
- [x] **Restart Orca**: done 2026-11-01. Node 22 and hcloud now resolve in Orca terminals.
- [x] **hcloud context**: the human created `mindcraft-rotn-test` (2026-11-01). The lead verified it is active and that `hcloud server list` succeeds with `HCLOUD_TOKEN` unset (the project is empty). Orca terminals do not get the `HCLOUD_TOKEN` user variable; the context replaces it. The token lives in `%APPDATA%\hcloud\cli.toml`, which agents never read.
- [x] **Orca skip-permissions launch option turned off** by the human (2026-11-01). Earlier, `orca worktree create --agent claude` had added `--dangerously-skip-permissions`; the lead declined that prompt, so nothing ran in bypass mode. The lead still checks each new agent's launch screen.
- [x] **CPX42 `mindcraft-test-env`**: the human chose to delete it (2026-11-01). The lead deleted server 173843514. Its IPv4 and IPv6 Primary IPs went with it (auto-delete), and the test project is empty.
- [x] **Bot Microsoft account: sign in once on this PC** (rotn-lead, 2026-11-01, from the PR #2 review). The test server runs in online mode, so net-forge's G1 spike needs the bot's own Microsoft/Minecraft account signed in on the machine where it runs. **Done 2026-11-01** (see the FRCFLD device-code item).
  - **Nobody needs your credentials.** You have the bot account's login and rightly keep it out of the repo and the chat. A device-code login means you type the email and password only on Microsoft's own page (microsoft.com/link), never in a terminal, file or chat.
  - **Bot player name: `FRCFLD`** (given by the human, 2026-11-01). harness-ops whitelists FRCFLD and JQDAW on the test server. The bot profile's name must equal `FRCFLD` (PLAN, multi-bot readiness).
  - When net-forge is ready, it will ask you to run a one-time device-code login: open a URL and type a code. The token cache will be written to a folder outside the repo, e.g. `C:\Users\admin\.mindcraft-rotn\<bot>\msa`.
  - Never paste a code or password in chat or in this file.
- [x] **GitHub CLI login** on this PC: logged in as JQDAW (verified 2026-10-31). `gh` now defaults to `JQDAW/mindcraft-RotN`.
- [x] **Node 22 on this PC**: v22.23.4 via nvm-windows (verified 2026-11-01). ADR 0002.
- [x] **hcloud CLI**: 1.70.2 via winget (verified 2026-11-01).
- [x] **Hetzner test project + `HCLOUD_TOKEN`**: set as a user environment variable (presence verified, value never read into chat; 2026-11-01).
- [x] **Server types available, and prices**: CPX42 EUR 0.1381/h and CX23 EUR 0.0109/h gross, read from the Hetzner API on 2026-11-01. The research's "price increase / not available" flag was wrong.
- [x] **Server pack**: you chose `C:\Users\admin\source\RotN 3.3.4 Server Pack.zip` (SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`). The project is now pinned to **RotN 3.3.4** (ADR 0005). The human confirmed on 2026-11-01 that the live server runs exactly this pack with default configs.
- [x] **Task-giver list**: `JQDAW` (2026-11-01). Others will be added later.
