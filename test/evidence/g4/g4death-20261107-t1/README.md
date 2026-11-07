# G4 T1 rehearsal (2026-11-07): `g4-death-report` on a test server; FAIL 7 of 9; on 670fe8aa; a SMOKE batch; the server is deleted

> **A rehearsal, never G4 evidence.** G4 accepts no test-server evidence: only set-up S (the CX23 service against a CPX42) counts (`test/scenarios/g4/PLAN.md`). `result.json` says `"gate": "G4"`, `"gateValid": false`, and `batch.json` says `"gate": false, "smoke": true`.

**Result in one line:** the console killed the bot at 14:03:33. It respawned within 2 s and posted one death report 6 s after the kill. The agenda resumed: the bot rebuilt 10 cobblestone and moved on to `stone_axe`. Of the two failed checks: `loss_reported` failed on its window, which is harness-side. The loss mismatch behind it (planks 6 vs 3, metamorphic rock 3 vs 7) is likely harness-side too (counts stale within the same second, a variant compared to a whole item), but that is not proven. `no_spam` failed because the bot did post 13 lines in one minute against the scenario's limit of 10. The lead has since redefined `no_spam` as a loop check (fix pending). As the rehearsal it was meant to be, it found fixes for the scenario and nothing shown broken in `death_report.js`.

## Run conditions

- **GO:** the human's additional written GO for the T1 rehearsal (2026-11-07, about 12:51 UTC), relayed by the lead.
  - It runs after round 9's four batches, on the same commit and checkout.
  - It uses the prepared command, with no `--gate` and no skip flags. The best possible outcome is SMOKE-PASS.
- **Code:** a clean checkout of `670fe8aa2f29` (develop, frozen), on the CX33. Round 9's batch D had ended at 13:55:22.
- **Free memory at 13:55 UTC:** 4,901 MB available of 7,746 MB, no swap.
- **Checks right before the create (13:55:35-13:55:50 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g4-death-report 47 min" for a 120 min TTL;
  - the dry run (sweeper OK through the helper's scheduled run);
  - the pack default with the pin matched.
- **Command:** `deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g4-death-report --out <raw>/death -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`, with no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created, ready | 13:56:29, 13:59:17 |
| Batch start; FRCFLD joined | 13:59:18, 13:59:28 |
| The server's counts of the 15 loss items, one console call each | 14:03:12-14:03:29 |
| The console `kill FRCFLD`: "FRCFLD fell out of the world", "Killed FRCFLD" | 14:03:33 |
| First health reading after the kill: 20 (`stat.deaths` 1) | 14:03:35 |
| The death report in chat | 14:03:39 |
| Second health reading, 20, which the scenario took as the respawn | 14:03:40 |
| The agenda counter rose 20 to 21 | by 14:05:10 |
| Command exited (check FAIL, exit 1) | 14:09:03 |
| Server, Primary IP and SSH key verified gone | 14:09:16 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `had_items` | PASS: the server counts 33 of the loss items (at least 6 needed) |
| `died` | PASS: `stat.deaths` rose; "FRCFLD fell out of the world" at 14:03:33 |
| `respawned` | PASS: "health above 0 at 14:03:40, 7s after the kill" (really by 14:03:35, 2 s; see below) |
| `loss_reported` | FAIL: "a death report came, but not within 60s of the respawn ... at 14:03:39" |
| `no_spam` | FAIL: 13 chat lines in one 60 s (limit 10); 17 in 5 min |
| `agenda_resumed` | PASS: the counter rose 20 to 21 by 14:05:10 |
| `no_cheat` | PASS |

## What the lead asked for

- **Respawn time:**
  - The bot respawned within 2 s: health was already 20 at the first reading, 14:03:35.
  - The scenario recorded 14:03:40 (7 s) because a first reading above 0 with no 0 seen needs a second reading to confirm it, and the scenario stamped the confirming reading's time.
- **The loss line against the server's counts:**
  - **The report:** "I died at -41, 67, -13; lost 10 dirt, 9 log, 6 planks, 4 betterwithmods:dirt_pile, 3 pyrotech_compat:rock_metamorphic:6, 3 sapling and 10 more kinds." One line, 6 s after the kill, and no second report.
  - **The server's counts before the kill:**
    - 7 `pyrotech_compat:rock_metamorphic`, 2 `rock_sedimentary`, 4 stick, 11 log, 3 planks, 4 dirt_pile, 1 bread, 1 bundle;
    - after the respawn, 0 of each, so all 33 were lost;
    - dirt and sapling are not among the 15 counted items, so they are not judged.
  - **The check, re-run offline on these counts:** `dirt_pile` 4/4 and `log` 9 vs 11 (within the tolerance of 3) match. Two items do not:
    - **planks, report 6, server 3:** the server counted planks at 14:03:19, the same second the bot crafted planks ("Successfully crafted planks, you now have 6 planks."). The server's count was taken before the craft and was stale by the kill.
    - **metamorphic rock, report 3, server 7:**
      - The report names variants apart (`rock_metamorphic:6` 3), and other variants are among the "10 more kinds".
      - The server counted all variants at 14:03:12. The stone pickaxe was crafted at 14:03:24-27, after that count.
      - The bot's own list at 14:02:02 had 4 `:0` and 3 `:6`, which makes 7.
  - **Verdict:** the mismatch is likely harness-side (the harness counted over 17 s while the bot was crafting, and compared a variant to a whole item), but that is not proven. The logs do not show the bot's inventory at the death; they show nothing that contradicts the report.
- **Chat lines per minute:**
  - 17 lines in the 5 min after the kill, at most 13 in one 60 s (14:04:56-14:05:55). The scenario's limit was 10, so by that rule the check failed as run; the lead has since redefined `no_spam` as a loop check.
  - Those 13 lines are ordinary work: the agent narrating each command, `!agenda`, `!inventory`, plus the agenda's own "step ... done / started" lines, while it crafted cobblestone.
  - Only 1 of the 17 is the death report. There is no repeated line and no loop, and no spam kick.
  - For comparison, before the kill the bot posted 50 lines in 5 min, at most 24 in one 60 s (fast crafting steps, each with agenda lines). After the death it was quieter, not louder.
- **Agenda resumed:**
  - Yes. The first reply after the respawn (14:03:43): "Died and dropped everything — rough! But the stone pickaxe survived with me. I still need 10 cobblestone fast."
  - It gathered rocks again, crafted 10 metamorphic cobblestone, finished the `cobblestone` step (14:05:45) and started `stone_axe`.
  - The counter rose 20 to 21 by 14:05:10.

## For the harness (mine, after the freeze; the lead decides)

1. **`loss_reported`'s window starts at the kill, not at the confirmed respawn reading.** A report can only come after the respawn, so a window from the kill to the respawn + `reportS` loses nothing. Also, stamp the respawn with the first reading above 0, not the confirming one.
2. **Count the loss items closer to the kill.**
   - Today the 15 counts take about 17 s, one console call each, while the bot crafts.
   - Count twice and kill right after a second count that matches the first, or count in one burst just before the kill and widen the tolerance for items that changed between the two counts.
3. **`lossConsistency` compares a whole item to one named variant.** It should judge an item named by only some of its variants only as "at least the named count", when the report ends in "and K more kinds".
4. **`no_spam` needs a definition decision (the lead's call):**
   - (a) raise the per-minute limit to fit the agent's normal narration rate (up to 24 a minute in this run, before the death);
   - (b) judge a spam *loop*: repeated or near-identical lines, or more than one death report;
   - (c) skills-rotn makes the agent quieter;
   - (b) matches the ready-to-try wording ("without a chat-spam loop").

## For skills-rotn (via the lead; nothing broken)

- **`death_report.js` worked:** one line, 6 s after the kill, consistent with its own inventory snapshot. The respawn and the agenda resumption were fine too.
- **An optional readability point:** the line keeps 1.12 metadata variants apart and names ids, as in "3 pyrotech_compat:rock_metamorphic:6". Summing variants of the same item in the chat line ("7 metamorphic rock") would make it shorter and clearer for a human, and fewer kinds would hide behind "and N more". This is not needed for the scenario once harness item 3 is fixed.

## LLM, providers and memory summaries

- **Requests:** 56: 43 agent replies and 13 memory summaries. None failed, none was empty, no HTTP errors. All went to Wafer, and all 13 summaries were attributed.
- **Checked by hand:** 13 "Storing memories..." and 13 "Memory updated to:".

## Cost

- **Spend:** USD 0.006904 (key usage 0.895146 to 0.902050, from `batch.json`). The key reads 0.902050 of the 4.50 stop.
- **Hetzner:** ran 12 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0, counted with `grep -c .`.

## Files

- `batch.json`, `run.log`, and `death/result.json`, `death/driver.log`, `death/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- `g3-batch-check --tree` lists this batch among the smoke batches, never gate evidence.
- The raw logs are in `captures/raw/t1-g4death/` (not committed).
