# Status: harness-ops

Updated: 2026-11-08 (04:43 UTC, from `date -u`)

## Now: G4, offline (no paid run, nothing on the CX23). Waiting for the human's step 0 and a written GO.

- **Merged:**
  - **#365, the CX23 SSH gate** (ADR 0009). It allows `status`, `start`, `stop`, `metrics BOT` and `journal BOT [--since]` through `sudo -n mindcraft-rotn-ctl`, refuses everything else with exit 126, and logs to syslog under `rotn-ssh-gate`. `deploy/cx23/README.md` has the human's exact G4 step-0 commands.
  - **#369:** `deploy.sh` deploys only `rotn-v` release tags. Upstream's `v0.1.0` is on develop. The step-0 tag is `rotn-v0.1.1`.
  - **#371, the service adapter:** `run.mjs --service frcfld` drives the bot through `ssh cx23-ctl`. It is async, needs `ROTN_SERVICE_GO`, never retries a start, and treats exit 126 as an incident.
  - **#374, `g4-service-reconnect`** (G4 #1): a console kick and a test-server restart must each be followed by an in-process rejoin with the right `agent_process` class, with `NRestarts` unchanged and a clean ctl stop. `effective_settings` checks #325's line.
  - **#359 and #367:** the Mod Director check follow-ups (`awk ENVIRON`, line breaks, a missing pin fails closed, hashing from stdin, a missing or failing `find` fails closed).
- **Open:** #379, the #371 and #374 review nits:
  - no second start for the service;
  - `stop` retries on 255;
  - an unknown state after 3 failed status checks;
  - IPv6 redaction that keeps times;
  - a reconnect test through the real `serviceBot`.
- **Next:** the lead's next G4 task. **The step-7 runner, when it starts, gets its own PR for the lead's G4 evidence rule** (2026-11-08). A run counts only if all of these hold, each checked and recorded, otherwise not-gate:
  - `ROTN_G4_ACCEPT`;
  - the S service;
  - one `rotn-v` commit read from the CX23;
  - the human-confirmed gate and ctl hashes;
  - a fresh test server, with its host confirmed.

## Earlier: G3 PASSES (lead, after #361). A and D on `0daeef2d` (#353); B and C on `8aaf370c`, rerun after their fixes (#361).

- **The rerun (2026-11-08, the human's GO):** B PASS 5/5 (in its shelter all night, after one unexplained move one block lower), C PASS 7/7 (the task at minute 2.2 while the agenda ran; paused, done, resumed). Spend USD 0.014972; 2 servers, 54 min; all gone (0/0/0). B started after 00:00 UTC (DRIVER.md).
- **The fixes behind it:** #354 (our C scenario: a 2-min minimum warm-up, the task at the first active-and-progressing moment; an agenda that ends first is an explicit "not reached") and skills-rotn's #355 (B's pillar block; its path was not exercised in the rerun).
- **Then open:** #359 (merged since) and the gate2 wording PR (#363, merged).
  - For skills-rotn: B's move one block lower at 00:19:39, and the dawn line "found no safe side to open".

## Earlier: the first G3 gate batches on `0daeef2d` (#353): A PASS, B FAIL, C FAIL, D PASS.

- **B (`survived_night`):** scaffolding in the shelter's head cell (likely a zombie's) made it "no longer usable". The bot left, `self_defense` interrupted the rebuild, and a zombie killed it. This is for skills-rotn.
- **C (task steps "not reached"):** the agenda finished in 4.8 min, inside the scenario's 5-min warm-up, so no task was sent. This is a scenario-timing gap in our `g3-task-preempts-agenda`; the fix needs the lead's decision.
- **Then (the gate rule):** fixed, and B and C rerun as new gate batches with the human's approval (#361).
- **Gate spend:** USD 0.019575; 4 servers, 64 min; all gone (0/0/0).

## Earlier: G3 smoke round 10 evidence (#352). The restart on `0daeef2d` passed 4 of 4 (smoke).

- **Attempt 1, on `12fd263e`** (`g3a-20261107-r10-attempt1`): an infra fault, exit 125, before any scenario.
  - The #347 check refused the zip's jar names with spaces. #351 fixed it and dropped the unused list pin (Mod Director keeps no copy on disk).
- **The restart on `0daeef2d`** (human-approved): A PASS 7/7, B PASS 5/5 (a night in the shelter, 0 deaths), C PASS 7/7, D PASS 7/7. Smoke, never gate evidence.
- **Spend:** USD 0.022691 (`batch.json`). Hetzner: 5 servers, 81 min, about EUR 0.69. All servers, IPs and keys are gone (0/0/0).
- **Watch items:** in D's README (the round summary). gz+b64 booted on all five servers; the Mod Director check passed 4/4 (337 zip jars + ESM-Tweaks).
  - B's shelter paths (digging alarm, repairs, fights, falling blocks) were not exercised: no mob came.

## Earlier: the pinned Mod Director downloads (ADR 0008; #347, merged). The lead chose option (a): fail closed from the first run.

- **Why:** the pinned zip ships only Mod Director (`mods/!mod-director-launchwrapper-1.9.1.jar`) and a pointer to a list on the pack's moving `stable` branch. That list has no hash and names `esmtweaks-1.12.2-0.4.5.jar` (GitHub release asset), installed at every start as a top-level `mods/` jar.
- **`deploy/test-server/mod-director.sha256`** has full SHA-256 values:
  - the jar `b57590bf…f235f933`: GitHub's digest, re-verified on the bytes downloaded on the CX33;
  - the list's copy `48ba1339…`, checked only if Mod Director keeps it on disk.
- **The check, `rotn-test mod-director`, at Done:**
  - only top-level `mods/*.jar`, against the zip's top-level jars plus the list plus any `--extra-mod` hashed before start;
  - subfolders are excluded (Forge writes there);
  - on a problem: the server is stopped, the phase is `failed:mod-director: ...`, `test-server.sh` exits 125 before any scenario, and the hashes go into the run log.
- **Restarts:** the `restart` verb is in #324 (HOLD). After both merge, it must run `rotn-test mod-director` after its new Done. That is a small follow-up, or an addition to #324 if the lead asks.
- **Tested:**
  - `mod-director.test.js` (10, on a fake server dir; a mutation that compares subfolders fails 6 of them);
  - `test-server.test.js` (exit 125 with nothing run and all deleted; the report in the run log; the list in the user-data);
  - 112 pass. ESLint clean.

## Earlier: the `g4-death-report` fixes after the T1 rehearsal (this PR; the lead's decisions after T1). Next: the Mod Director downloads inventory (report first).

- **`no_spam` is a loop test** (the ready-to-try wording: "without a chat-spam loop"):
  - it fails on a repeated line (near-identical lines count together), more than one death report, a spam kick, or the bot gone;
  - 40 lines a minute is a backstop only;
  - the thresholds (4 a minute, 7 in 5 min) come from the G3 evidence: ordinary lines repeat at most 5 times in 5 min, while the reflex loops ("I'm dying!" 12, "Fighting zombie..." 9, "My brain disconnected" 6 in 60 s) fail, as intended;
  - lines count together only when their keys are equal (no fuzzy match).
- **`loss_reported`'s window runs from the kill**, and the respawn is dated by its first reading above 0.
- **The counts are taken closer to the kill:** a pre-kill sweep, then the kill at once; each item is judged on the range of its last two counts.
- **The loss comparison** sums variants and allows for variants among "and K more kinds": one shared budget of K times the smallest named count, and at most K unnamed items (#342 review). "Lost nothing" and "not reached" use the same bound.
- **Not done (dropped):** the `stayed_online` window for `g3-first-night`. B's leave in round 9 was real: the agent's own `cleanKill` after an action refused to stop (#330, corrected).
- **Tested:** `g4-death.test.js` 14 tests (5 new, failing on the old code), plus `g3-spend`: 95 pass. ESLint clean. `batch.mjs --preflight-files` passes (timeout 48 min).

## Earlier: G3 smoke round 9 (670fe8aa, smoke) is over: 3/4, so no gate on this commit. T1 (the `g4-death-report` rehearsal) ran after it. Evidence: this PR.

- **Under the human's written GOs** (round 9 at about 12:46 UTC; T1 at about 12:51 UTC, after the four batches), relayed by the lead. Each batch ran on its own fresh server after its own pre-checks, with no skip flags, no reruns and no retries. Every server, Primary IP and SSH key was verified gone (0/0/0 with `grep -c .`).
- **Results:**
  - **A** `g3-rocks-to-stone-tools`: PASS 7/7. The whole agenda took 6 min; sticks came from leaves.
  - **B** `g3-first-night`: FAIL 3/5. The shelter was opened after 17.5 min; no pickaxe, because `sticks` stalled; 2 zombie deaths. Then the agent killed its own process: after the second death, `!collectBlocks` refused to stop for 10 s, so `cleanKill` ran (`stayed_online`, a real fail; I first called it a harness false fail, which was wrong).
  - **C** `g3-task-preempts-agenda`: PASS 7/7.
  - **D** `g3-untrusted-refused`: PASS 7/7.
  - **T1** `g4-death-report`: FAIL 7/9, a rehearsal and never G4 evidence. The respawn took under 2 s, the death report came 6 s after the kill, and the agenda resumed. `loss_reported` failed on its window, which is harness-side (the window started at the confirming respawn reading, 1 s after the report). The loss mismatch (planks 6 vs 3, metamorphic rock 3 vs 7) is likely harness-side too (stale counts, a variant compared to a whole item), but that is not proven. `no_spam`: the bot did post 13 lines in one minute against the limit of 10; the lead has since redefined it as a loop check (fix pending).
- **Spend:** round 9 cost USD 0.0186 by the batch figures and T1 USD 0.0069. The key reads 0.902050 of 4.50. Hetzner: 5 servers, each billed about 1 h (about EUR 0.69 plus IPv4).
- **Queued for after the freeze (the lead decides):**
  - the `g4-death-report` fixes (report window from the kill, counts closer to the kill, variant-aware loss check);
  - the `no_spam` definition.
- **For skills-rotn (via the lead):** B's shelter breach with no pickaxe; the luck-dependent `sticks` step; and the action that would not stop after a death (a 10-second `cleanKill`, then a restart). There is no `death_report.js` fault; an optional point is to sum metadata variants in the chat line.

## Earlier (before the round 9 GO): waiting for the human's GO for G3 smoke round 9 (then T1); develop frozen at 670fe8aa; branch-only work meanwhile

- **Round 9, ready (05:31 UTC):**
  - the checkout `/home/mindcraft-RotN-batch/670fe8aa` (`npm ci` 8/8 patches, clean);
  - A's pre-checks all passed: `msa-login`, key present, empty project counted with `grep -c .`, preflight with probe (HTTP 200, Wafer, 37 min), dry run (sweeper by cadence), the `/home` pack default with the pin matched, 5,019 MB free;
  - B, C and D's file-only preflights pass (67, 34 and 16 min);
  - the key reads USD 0.875735 of 4.50.
- **The order:** A, B, C, D, each on its own fresh CPX42 (the DRIVER.md GO template, smoke, no skip flags). Then the g4-death-report rehearsal **T1** on the same commit (its preflight passes, 47 min, `--ttl-hours 2`).
- **Cost:** about EUR 0.55 + USD 0.03 for the round; about EUR 0.14 + USD 0.02 for T1. B is a memory window over 20 min: no other heavy jobs then.
- **Branch work (no PR while develop is frozen): `agent/harness-ops/g4-reconnect-tools`**, the pieces `g4-service-reconnect` (G4 #1) needs:
  - `rotn-test restart` (on the server): console `stop`, wait for rotn-server to exit (exit 4 if it does not), `systemctl start`, wait for a NEW Done line: a rolled-over `latest.log` with Done, or more Done lines than before (exit 5 if none). Phase `restarting`, then `ready` or `failed:restart: ...`.
  - `deploy/test-server.sh restart [TIMEOUT_S]` (30..900, default 300) runs it.
  - `ctlServer.restart()`: never re-sent after an ordinary failure, only after a bash that never started.
  - Console rules for `g4-service-reconnect` only, built like #320's kill: `kick <this run's bot>` (any other name and every selector refused; no valid bot param, no rule) and `stop` exactly. `guardConsole` lets the restart through only where the list admits `stop`.
  - **Tested** (targeted): `g4-reconnect-tools.test.js` (6 tests) and new tests in `test-server.test.js` (the helper with a fake systemctl and console: the usual case, the same-file Done, no Done, no stop, already stopped, bad timeout; the verb through the fake ssh). With runner, the G3 and G4 tests and deploy-eol: **319 pass, 0 fail**. ESLint clean; baseline 253. shellcheck is not installed on this server, so CI runs it.

## Earlier (before the round 9 GO; the #326 branch): waiting for the human's GO for G3 smoke round 9 (then T1); develop frozen at 670fe8aa; branch-only G4 work

- **Round 9 is ready** (checkout `/home/mindcraft-RotN-batch/670fe8aa`; A's pre-checks passed at 05:31 UTC; the run script is in place). T1 runs after the round.
- **#324 (HOLD, approved at 61eae31e):** `test-server.sh restart` / `rotn-test restart`, `ctlServer.restart`, `g4-service-reconnect`'s kick/stop rules. It merges after the G3 gate.
- **This branch, `agent/harness-ops/ctl-journal-metrics` (HOLD PR): the read-only ctl verbs from the G4 plan.**
  - `mindcraft-rotn-ctl journal BOT [--since TIME]` runs `journalctl --unit=mindcraft-rotn@BOT.service --no-pager --no-hostname --utc --output=short-iso --lines=20000`.
    - TIME: only `YYYY-MM-DD HH:MM[:SS]`, `YYYY-MM-DDTHH:MM[:SS][Z]` (normalised to "... UTC") or `@EPOCH`. Relative times, words, offsets and anything extra are refused.
  - `mindcraft-rotn-ctl metrics BOT` runs `systemctl show --no-pager --property=MemoryCurrent,MemoryPeak,NRestarts,ActiveState` on that unit only.
  - Exact argument counts and the existing unknown-bot refusal (now one `unit_of` helper for every per-bot action). Fixed paths (`/usr/bin/journalctl` too), no env overrides. **No new sudo rights:** the sudoers rule still allows only the ctl (the bootstrap test still pins it).
  - **Tested:** `cx23.test.js` (3 new tests: journal with each `--since` form; 23 refused journal shapes, with journalctl never run; metrics exact, and 6 refused shapes) and `deploy-eol`: **55 pass, 1 skipped** (mode-000 as root, as before).

## Earlier: `g4-death-report` was built offline (#320, merged); its T rehearsal run plan goes to the lead. No paid run without the human's GO.

- **The scenario** (`test/scenarios/g4/g4-death-report.mjs`, G4 #6, gate G4, the real agent):
  1. the G2 world, production givers;
  2. the server counts what the bot holds (count-only `clear` of 15 early-agenda items) until it holds at least 6;
  3. `kill <bot>` on the test console, then the server's own times (`hh:mm:ss`) for the kill, the respawn and the chat.
- **Checks:**
  - `had_items` and `died` (`stat.deaths` plus the death line);
  - `respawned` (`health` 0, then above 0, within 30 s);
  - `loss_reported`: exactly one `I died at ...; lost ...` line within 60 s of the respawn, consistent with the server's count per item (max(2, 25 %); unnamed only when truncated);
  - `no_spam`: at most 10 lines in any 60 s for 5 min, no spam kick, online;
  - `agenda_resumed`: (c)'s agenda counter rises within 5 min;
  - `no_cheat`.
- **The wiring** (lead's rule: test-server G4 runs are rehearsals):
  - `kill` only of this run's bot by its exact name (built from the run's parameters; `kill JQDAW`, any other name and every selector are refused; #320 review), and the read-only `health` objective, for this scenario alone (`SCENARIO_CONSOLE_EXTRA`, `consoleAllowFor`; G3 scenarios still cannot kill);
  - #320 review fixes: `loss_reported` is "not reached" when the server counts no loss (all kept) or an after-respawn count is unread; no kill without our driver's start event;
  - `g3Policy` marks every G4 run not-gate;
  - `batch.mjs --gate` refuses a G4 scenario;
  - G4 results need a vouching `batch.json` and are never accepted in a gate claim;
  - `run.mjs` stamps their batch marker.
- **Tested** (targeted only): `g4-death.test.js` (9 tests: the helpers on real death-report lines, the full pass, kept items, every failure mode, the wiring), plus g3-spend, the four G3 scenario tests and runner: **204 pass, 0 fail**.
  - `batch.mjs --preflight-files` passes for the rehearsal command (timeout 47 min) and refuses `--gate`.
  - Every loss item id is in rotn-data's 3.3.4 item list. ESLint clean; baseline 253.
- **Nothing in `src/agent/` changed.** If the rehearsal finds something in `death_report.js`, I report it to skills-rotn via the lead.

## Earlier: the G4 plan (#316, merged) after the lead's review

- **#316 review (REQUEST CHANGES, bdc7143), all applied:**
  - G4 accepts no test-server evidence: T runs are rehearsals only;
  - step 7 runs every item #1-#12 on S, with 6 servers listed, and steps 1-4 give their server counts;
  - C (#10) and the task queue (#11) need a trusted player on S (JQDAW, or a second scripted account, the human's call);
  - #6 on S has its own forced `kill`;
  - #1 passes on `agent_process.js`'s in-process restart line plus the rejoin (`NRestarts` stays the soak's measure);
  - "today" is G3 smoke only, and no G3 gate batch has passed;
  - the CX33-to-CX23 channel is the human's decision (probably an ADR);
  - the console `kill`, `kick` and `stop` are test-server only by construction;
  - the live whitelist comes after G4 has passed.

- **`test/scenarios/g4/PLAN.md` (this PR):** each of the 12 ready-to-try items mapped to:
  - what exists today (G1-G3 smoke on a test server, unit tests, `test/evidence/cx23`); none of it is G4 evidence;
  - the new scenario it needs (`g4-service-reconnect`, `g4-death-report`, `g4-control-commands`, `g4-restart-persistence`, `g4-soak-2h`, `g4-second-bot`);
  - G4 evidence only from the CX23 service against a CPX42 (S); test-server runs (T) are rehearsals;
  - the human items;
  - order, servers, cost and time: about EUR 2.8 + USD 0.2 in all; the acceptance run (step 7) is 6 servers, about 6 h.
- **Decisions the plan asks for (lead / human):**
  - how the CX33 drives the CX23: a scripted Orca terminal, or a dedicated SSH key, which needs `restrict` and a forced `command=` wrapper allowing only `mindcraft-rotn-ctl` verbs to be limited (the sudo rule alone limits only what `deploy` runs as root) (the human's decision, probably an ADR);
  - `kill`, `kick` and `stop` on the test-server console allowlist;
  - a startup log line with the effective `allow_insecure_coding` (`main.js`, lead-owned);
  - the soak ADR's targets;
  - a second Minecraft account (#12), and a trusted player on S: the human as JQDAW for about 15 min (follow, come, stop, one trusted task, one task across a restart), or a second scripted trusted account.
- **First build (the lead's pick): `g4-death-report`.** Its T rehearsal needs no CX23 and no human item, only `kill` on the test console. Plan step 1's dry run on S needs the CX23 and H4, H5 and H6.
- **#314 (merged): the memory-summary counter fix.**
  - Open summaries are a queue, and each outcome line closes the oldest. A new start closes nothing. A non-zero exit empties all open ones. Overlapped summaries are never attributed to a provider.
  - Recounted, only round 7 A, B and C change (2, 1 and 2 empty become 0, as their READMEs said).
  - Tests: 126 pass. The updated and new tests fail on the old counter.
- **#313 (round 8 evidence):** the review nits are fixed (text only, ee3e7bb). The dead bush gave 1 stick, held (1 of 3); there were four `!collectBlocks("stick", 3)` calls, each "Collected 0 stick".
- #313 (round 8 evidence) is merged too.
- **Cleanup:** both batch checkouts under `/home/mindcraft-RotN-batch/` are removed.

## Earlier: G3 smoke round 8 (e5029f23, smoke, the first full round from the CX33) is over: 3/4, so no gate on this commit.

| Batch (evidence folder) | Result |
| --- | --- |
| A (`g3a-20261107-r8`) | FAIL 3/7: stuck at `sticks` (02:28:51, "5 min of self-prompting; agenda paused"). No cane or bamboo within 511 blocks, felling gave no sticks, and a dead bush gave 1 stick (held 1 of 3). No table, no stone tools. |
| B (`g3b-20261107-r8`) | **PASS 5/5:** all 11 steps by 02:45; in the shelter from sunset until morning; dawn, 0 deaths, food 14. |
| C (`g3c-20261107-r8`) | **PASS 7/7:** on the gold block at minute 5.6; "task t1 done"; agenda resumed (counter 10 to 13). |
| D (`g3d-20261107-r8`) | **PASS 7/7:** refusal in the same second as the whisper. |

- **The GO's limits held:** no rerun, no gate batch, no retry, no skip flags. A's FAIL is a check result (exit 1), not an infra or harness fault, so the round went on. Every per-batch pre-check passed (`msa-login`, key present, empty project counted with `grep -c .`, sweeper, preflight with probe, dry run, free memory 5.1-5.6 GB).
- **For skills-rotn (the lead routes):**
  - A's `sticks` stall (round 5 A rerun again);
  - B's three rejected equip clicks, with "cursor: stone_pickaxe" kept across each resync;
  - "shelter_blocks started" logged before "logs done" (A) and before "crude_axe done" (the validation batch);
  - **B showed no "no longer usable" shelter line this round** (the shelter held all night), so #296's new line was not exercised.
- **LLM:** 158 requests, all Wafer, 0 empty answers. Memory summaries: 36 stored, 0 empty. B's "1 empty" in its `result.json` is the overlapping-summary miscount.
- **Spend:** USD 0.026617 by the batch figures, 0.026625 by the key (0.849110 to 0.875735 of the 4.50 stop). Hetzner: 14 + 43 + 10 + 8 min, 4 servers at about EUR 0.14 each; every server, Primary IP and SSH key was verified gone.
- **Open:** the round 8 evidence PR. My next code work, after the gate, is the overlapping-summary counter fix.

## Earlier: the dev-server validation batch (G3 smoke D, validation only) PASSED 7/7; merged as #308; the fake-driver leak fix merged as #309

| Batch (evidence folder) | Result |
| --- | --- |
| D, validation only (`g3d-20261107-v1`, develop 198bacbb) | **PASS 7/7:** the refusal came 1 s after the whisper; no kick, no deaths. A SMOKE batch that never counts toward G3. |

- **This validates the CX33 as the batch machine:** Linux paths, plain bash, Node 22, the token cache at `/root/.mindcraft-rotn/FRCFLD/msa`, the test key in the batch session, the sweeper check, and Linux-path redaction (#305).
  - The pack zip upload was not exercised: the server used the CurseForge download. The `/home` default was checked by the pre-batch dry run (pin matched).
- **LLM:** 14 requests: 12 replies and 2 memory summaries stored. 0 failed, 0 empty, all Wafer.
- **Spend:** USD 0.002393 by the batch figure. The key reads USD 0.849107 of the 4.50 stop (01:56:32 UTC).
- **Hetzner:** 6 min, billed about 1 h, est. EUR 0.1381. Server, Primary IP and SSH key verified gone; the project had 0/0/0 (counted with `grep -c .`) at 01:56:20.
- **Observation for skills-rotn (the lead routes; no effect on the checks):** "agenda step shelter_blocks started" was logged 2 s before "agenda step crude_axe done".
- **Corrected:** during prep I reported Hetzner resources appearing and vanishing. That was my miscount: an empty `hcloud ... -o noheader` prints one blank line, and `wc -l` counted it. From now on I count with `grep -c .`.
- **Next (the lead's order):** find the unit test that leaves `fake-driver.mjs` running after it ends (offline, targeted runs only), and fix it in a separate small PR.

## Earlier: the Linux-paths PR (the lead's task before the validation batch); merged as #305

Branch `agent/harness-ops/linux-paths` from develop c8323be8. It carries #302's STATUS commit (identical hunks, so either merge order is clean; if this one merges first, #302 can be closed).

- **(1) `test/tools/redact-evidence.mjs`:** a second local-path rule, `LINUX_PATH`, used by both the tool and `--check` (kind `local-path`):
  - `/home/mindcraft-RotN-worktrees/<agent>` (the agent's folder goes too), any `/home/<user>` (the main checkout `/home/mindcraft-RotN`, the CX23's `/home/deploy`), and `/root` when a path goes on below it, all become `<local>`;
  - spellings: `/`, JSON's `\/`, and inside `file:///` URLs (Node's ESM stack frames). Backslash spellings are Windows-only and stay with the old rule;
  - the pinned zip keeps its name: `<local>/RotN 3.3.4 Server Pack.zip`, as on Windows;
  - kept: a bare `/root`, `/home` or `/home/*`, `/rootfs`, `/home2`, `/opt/...`, URL paths and relative paths (`./root/x`, `a/home/b`, `~/root/x`).
- **Two committed CX23 evidence files now count as leaks and were re-run through the tool** (committed evidence comes out of the tool):
  - `test/evidence/cx23/README.md`: `/root/.ssh` and `/root/orca/workspaces/mindcraft/tunicate` became `<local>/...`;
  - `test/evidence/cx23/post-bootstrap-20261103/check.txt:31`: `/home/deploy` became `<local>`.
  - Those are CX23 paths, not this server's; the rule can't tell machines apart, so it fails closed. **Lead's call** if you'd rather keep them.
- **(2) `deploy/test-server.sh`:** `PACK_ZIP` defaults to `/home/RotN 3.3.4 Server Pack.zip`, and to the old Windows path under Git Bash or Cygwin (`$OSTYPE`). `ROTN_PACK_ZIP`, then `--pack-zip`, still win. The size and SHA-256 pin check is unchanged. The usage text says so.
- **Tested** (targeted only, no full `npm test`):
  - `node --test` over `evidence-redaction`, `test-server`, `g2`, `g3-rocks`, `g3-spend` and `deploy-eol` (the unit files that touch the redactor, the evidence or the script): 305 pass, 0 fail (6.5 min).
  - The new pack-default test failed against the old script (got the Windows path) and passes now. It uses fake `stat` and `sha256sum` and never hashes the real zip.
  - `redact-evidence.mjs --check test/evidence` is clean; `g3-batch-check --tree test/evidence` exits 0; ESLint on the three touched JS files is clean; the lint baseline is 253 (unchanged).
- **For the lead (not mine, info only):** `.claude/agents/independent-reviewer.md:28-32` and `.claude/agents/rotn-gameplay-analyst.md:11` still name `C:/Users/admin/...` paths.
- No paid batch, no Hetzner server.

## Earlier: on the CX33 dev server, ready; waiting for a task (2026-11-07)

- **Set up:** worktree `/home/mindcraft-RotN-worktrees/harness-ops`, branch `agent/harness-ops/cx33-start` from develop c8323be8, `npm ci` done. Read CLAUDE.md, PLAN.md, my brief, this file and the lead's 00:10 UTC snapshot.
- **Check:** `node --test "test/unit/**/*.test.js"` on Linux: 533 tests, 531 pass, 0 fail, 2 skipped, 5 min 55 s (three other sessions running). No Hetzner server exists (`hcloud server list` empty, context `mindcraft-rotn-test`). Free memory at the check: 4.5 GB available of 7.6 GB, no swap (round 6 had 5.9-6.1 GB free on the PC).
- **No open PRs of mine.** The round 7 evidence was merged as #292. No batch has run from this server.
- **The lead's four items before the validation batch (read only; nothing changed):**
  1. **Pack zip:** `deploy/test-server.sh:125` still defaults to the Windows path. Setting `ROTN_PACK_ZIP="/home/RotN 3.3.4 Server Pack.zip"` per command works as it is. Optional: change the default (one line, `deploy/`).
  2. **`MINDCRAFT_PROFILES_FOLDER=/root/.mindcraft-rotn/FRCFLD/msa`** per command; the driver already requires it (DRIVER.md:23) and never prints it.
  3. **Redactor: a real gap.** `test/tools/redact-evidence.mjs:56` (`LOCAL_PATH`) matches only `<drive>:/Users/<name>` and `/c/Users/<name>`. `/root/...` and `/home/...` (the worktree, `/home/RotN 3.3.4 Server Pack.zip`, the MSA folder if it ever showed up) pass through, and `--check` would not flag them. **Proposed fix (small `test/` PR, before the validation batch's evidence):** also mask `/root/<...>` and `/home/<...>` to `<local>`, with offline tests from this server's paths, and a `--check` over the existing evidence to show nothing else changes.
  4. **Bash:** `test/runner/lib/adapters.mjs:13` uses Git Bash only on `win32` and plain `bash` elsewhere; `batch.mjs:76` and `mindcraft-driver.mjs:229` branch on `win32` the same way. Nothing to change.
- **Memory rule still holds** (Requests item 13): during a paid batch over 20 min, no other agent runs `npm ci` or a full suite. With four sessions on 7.6 GB and no swap, the unit tests alone took 6 min, so I'd announce each batch window as before.
- **Proposed order (the lead decides):** the redactor PR (with the pack default, if wanted), then the validation smoke batch on the lead's written GO. After the gate: the overlapping memory-summary counter fix (below).
- **Note:** "Blocked", "Requests" and "Open PRs" at the bottom of this file date from the Windows PC ("this PC" means the old one); they are kept for the record.

## Earlier: G3 smoke round 7 (pre-gate, 42a8e94) is over: 3/4, so no gate on this commit. No batch until a new GO. Handoff for the move to the new dev server below.

| Batch (evidence folder) | Result |
| --- | --- |
| A (`g3a-20261106-r7`) | **PASS 7/7:** dirt piles for the shelter (#288), sticks by felling, Hit With Axe plank, "agenda done". |
| B (`g3b-20261106-r7`) | 4/5: in a working shelter for 8 min 23 s, then "no longer usable (fire, lava or a block inside)"; it left to rebuild; `self_defense` could not equip ("Server rejected transaction for clicking on slot 16"); slain by a zombie 28 s later. After the respawn "cursor: quark:tallow". |
| C (`g3c-20261106-r7`) | **PASS 7/7:** on the gold block at minute 5.8 (checked under its feet); Near AI new in the provider rotation. |
| D (`g3d-20261106-r7`) | **PASS 7/7:** refusal in the same second as the whisper. |

- **Spend:** USD 0.030442 by the batch figures, 0.030543 by the key (to 0.846126 of 4.50). Hetzner 14 + 27 + 11 + 6 min, all verified gone; the project is empty.
- **Memory summaries, true:** 38 stored, 0 empty. The run logs' "5 empty" (A 2, B 1, C 2) are a harness miscount: overlapping summaries (a second starts before the first's reply), which the counter's "next start closes it as empty" rule gets wrong. **The fix waits until after the gate** (lead), so the commit stays 42a8e94; the READMEs give the true figures.
- **Corrected in the evidence:** the round 5 C and D and round 6 A-D READMEs said "the human approved the run command". Run commands go through Claude Code's auto mode (the human, via the lead); the one block (round 5 C, 15:06Z) was a one-off.
- **For skills-rotn / net-forge (the lead routes):** B's shelter judged unusable while it worked; the rejected window click in `equip` (cursor item or inventory desync); leaving a working shelter at night.
- ~~Open: the round 7 evidence PR.~~ **Merged** (#292).

### Handoff (for the next session, on the new dev server)

- **Gate rule (PLAN.md, #290):** a clean smoke round A-D on the final commit, each batch on its own fresh server, must pass 4/4; then one `--gate` batch per scenario on that same commit. A gate failure: the other gate batches still run; after the fix only the failed scenario reruns, with the human's approval. The gate plan (cost about EUR 0.55 + USD 0.025, about 1 h 45 min) is in "Earlier: the G3 gate plan" below.
- **My next code work, after the gate:** the overlapping-summary counter fix in `test/runner/lib/llm-spend.mjs` (match each "Memory updated to:" to the oldest open summary; close open ones only on a non-zero agent exit; update the #267 tests that expect "the next start closes it").
- **Before each batch:** a detached checkout of the GO's commit and `npm ci`; `msa-login FRCFLD --check` (`MINDCRAFT_PROFILES_FOLDER` set per command, never read); an empty project; the batch preflight on its own with `ROTN_BATCH_TTL_MINUTES`; `test-server.sh up --dry-run`; free memory noted. The run command is DRIVER.md's GO template; raw logs in `captures/raw/r<N>-g3<x>/` (not committed). A sweeper "would refuse": wait and re-check, never a skip flag.
- **Evidence:** per file with `node test/tools/redact-evidence.mjs IN OUT --bot FRCFLD` (`batch.json`, `run.log`, the scenario's `driver.log`, `result.json`, `server.log`); then `--check test/evidence` and `node test/tools/g3-batch-check.mjs --tree test/evidence`. Check summary counts by hand (starts vs "Memory updated to:") until the counter fix lands.
- **Rules that bite:** never read keys, tokens, `.env*` or SSH keys; the OPENROUTER key is checked for presence only; a pre-join infra retry is a paid run (GO or the lead's word); tell the lead when pushing to a PR under review; STATUS times from `date -u`.

## Earlier: the G3 gate plan (the lead, after #283 and #286; nothing run)

**What a G3 gate claim needs** (`batch.mjs --gate`, `lib/g3.mjs`, DRIVER.md "Smoke is the default" and "Where G3 evidence goes"):
- **A gate batch:** `batch.mjs --gate` writes `"gate": true, "smoke": false` into `batch.json`; without `--gate` a batch is smoke and never gate evidence.
- **Gate-valid runs:** every G3 run carries `ROTN_G3_BATCH=<batch id>:2`, the pinned model in `llm.models`, a recorded spend, the default parameters compared 'equal' (`maxBatchUsd` 2, (b)'s `maxMinutes` 55, `nightFrom`, `dawnBelow`; (c)'s pinned marker and counter), and no `notGate` reason. All four round 6 results already say `gateValid: true`, so the code needs no change.
- **The gate claim check, per batch:** `node test/tools/g3-batch-check.mjs <batch.json> <result.json>...` exits 0 only if the batch says `gate: true` (not smoke), every result's marker is that batch, the batch ran each scenario exactly once, each `runId` is the one the batch read back, no passing result has a nonzero exit, and no result is an infra fault.
- **Evidence layout:** `test/evidence/g3/<batch>/batch.json` with each scenario's `result.json`, `driver.log` and `server.log` in a folder below it, redacted with `redact-evidence.mjs --bot FRCFLD`, plus a README. `g3-batch-check --tree test/evidence` must stay consistent. Proposed names: `g3a-<date>-gate`, `g3b-<date>-gate`, `g3c-<date>-gate`, `g3d-<date>-gate`.
- **How many runs:** PLAN.md (phase 3, "G3: rocks to stone tools on a fresh spawn; survives the first night; a task preempts the agenda, which then resumes", plus ready-to-try's "untrusted players' tasks are politely refused") sets no repeat count. G2's precedent: each scenario passed once as a gate run. **Proposal: one gate run per scenario (A, B, C, D), each in its own gate batch; the lead decides if more are wanted.**

**Batches and order** (as in rounds 5 and 6; D needs its own fresh server, so four gate batches):

| Batch | `--ttl-hours` | Server minutes (round 6) | LLM USD (round 6) |
| --- | --- | --- | --- |
| A `g3-rocks-to-stone-tools` | 2 | 11 | 0.005 |
| B `g3-first-night` | 3 | 38-47 | 0.007 |
| C `g3-task-preempts-agenda` | 2 | 12-14 | 0.008 |
| D `g3-untrusted-refused` | 1 | 8 | 0.003 |

- **Cost:** 4 servers, each billed about 1 h: EUR 0.55 plus Primary IPv4; LLM about USD 0.025 (the stops stay USD 2 per batch and USD 4.50 by the key, which reads 0.8152 now).
- **Time:** about 1 h 45 min of wall clock, the checks before each batch (`npm ci` about 2 min) included; B alone is about 45 min (Extended Days' two 10 min holds).
- **The run command:** as in the round GO template, with `--gate` added to `batch.mjs`: `bash deploy/test-server.sh run --yes --ttl-hours <h> --seed 1880465901402976865 -- node test/runner/batch.mjs --gate --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario <id> --out <raw>/<dir> -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`. The rest of the round rules unchanged (preflight on its own first, no skip flags, deletion verified, stops, the human approves each run command, free memory noted).

**Before the gate (for the lead):**
1. **B's shelter fix** (skills-rotn): round 6 B died because the shelter counts no RotN cobble. B should pass a smoke run on the gate's develop commit first.
2. **(b)'s dawn rule is pinned** (lead, after #287): night at or above 13000 after dusk, dawn the next sample below 12000, `maxMinutes` 55. "Provisional" is dropped in DRIVER.md and the scenario header (the pin-dawn doc PR).
3. **One commit for all four gate batches,** with a smoke round on that commit just before (A, C and D passed on f7fbe4fe).
4. **A failed gate run:** it stays in the evidence as it is. A rerun is a new gate batch, a paid retry the lead approves, and the README lists every gate attempt for that scenario, so no passing run is picked from several.

## Earlier: G3 smoke round 6 is over (smoke, develop f7fbe4fe).

| Batch (evidence folder) | Result |
| --- | --- |
| A (`g3a-20261106-r6`) | **PASS 7/7:** sticks by felling, the first plank by Hit With Axe with the crude axe kept, both stone tools by minute 4.8, "agenda done". |
| B (`g3b-20261106-r6`) | 4/5: the whole agenda, then the shelter counted "0 sturdy blocks" (it misses Underground Biomes cobble; the bot had 11) and a zombie killed the bot in the open. |
| C (`g3c-20261106-r6`) | **PASS 7/7:** the bot stood on the gold block and checked the block under its feet before `!taskDone`; the server confirmed it. |
| D (`g3d-20261106-r6`) | **PASS 7/7:** the refusal in the same second as the whisper. |

- **Memory summaries:** 42 stored, 0 empty; every provider line names Wafer. **Spend:** USD 0.022473 by the batch figures, 0.022631 by the key (to 0.815220 of 4.50). Hetzner 11 + 38 + 12 + 8 min, all verified gone. Free memory 5.9-6.1 GB at each start.
- **The daytime holds at 3001 and 16001 are Extended Days** (lead; checked against the pack's `config/extendeddays.cfg`: 3000 and 16000, 10 real minutes each). In DRIVER.md and the round 5 B rerun README.
- **For skills-rotn (the lead routes):** the shelter's sturdy blocks should include RotN's cobble variants; `!taskDone` used for an agenda step (harmless).
- **Merged: #283** (round 6 evidence, Extended Days) and **#286** (#282 nits). **Merged: #287** (the #283 nit and the gate plan). **Open:** the pin-dawn doc PR. The lead takes the gate decisions (passes needed, failure handling) to the human and records them in PLAN.md.

## Earlier: G3 smoke round 5 is over (smoke).

| Batch (evidence folder) | Result |
| --- | --- |
| A (`g3a-20261106-r5`, c32521e5) | 3/7: five agent crashes on empty memory summaries; the chat limit off. Fixed (#266, skills-rotn, #267). |
| A rerun (`g3a-20261106-r5-rerun`, 1a7d990f) | 3/7: the agenda paused at `sticks` (1 stick from felling, no planks without a table, 180 s towards an underground log). |
| B (`g3b-20261106-r5`, 1a7d990f) | Scenario error: Git Bash could not start (0xC0000142) on the runner's machine, short of memory. Fixed in #273. |
| B rerun (`g3b-20261106-r5-rerun`, a6825e81) | **PASS 5/5:** all 11 agenda steps, 4 sticks by felling, the night in a shelter, 0 deaths. |
| C (`g3c-20261106-r5`, a6825e81) | 5/7: `!goToCoordinates(..., 1)` stopped beside the gold block; the bot said it stood on it and called `!taskDone`. |
| D (`g3d-20261106-r5`, a6825e81) | **PASS 7/7:** its own fresh server, no catch-up burst, refusal 1 s after the whisper. |

- **Memory summaries by provider:** with Wafer (B rerun, C, D), 17 stored and 1 empty of 18 attributed, plus 6 stored unattributed. Before OpenInference was excluded (A, A rerun, B; no provider lines then): 0 stored of 20.
- **Spend:** USD 0.021827 by the batch figures, 0.021851 by the key (0.770735 to 0.792586 of the 4.50 stop). Hetzner: 12 + 13 + 21 + 47 + 14 + 8 min, every server, Primary IP and SSH key verified gone.
- **For skills-rotn (the lead routes):** C's "task done" without standing on the marker (range 1; check the block under the feet); stuck against trunks at `sticks` (A rerun, D); felling with no drops within 6 s; `!searchForBlock("log")` choosing an underground log.
- **Merged: #275** (the round 5 evidence) and **#276** (the #273 nits).
- **Open: the sweeper PR** (the lead approved the proposal below in principle, #275 review): at most one dispatch run within 180 s after each scheduled helper run is left out, every choice tried, so a real cron run in that window still passes. Plus the #275 and #276 review nits (the B README verdict line; the llm-spend comment on `finish_reason length`).

### The sweeper check without the throttled cron (approved in principle in the #275 review; now in the sweeper PR)

**What happened at 15:38Z (D waited 9 min):**
- (a), the sweeper's own `schedule` run, was 426 min old (limit 120). GitHub throttles cron; on 2026-11-06 the scheduled runs came hours apart.
- (b), the helper repo's `schedule` run (`JQDAW/rotn-sweeper-cron`), was 42 min old (limit 40). Its own cron is throttled the same way: on 2026-11-06 it ran at 00:04, 06:56 and 14:56, every 6-8 h.
- (c), the dispatch cadence, refused because of a 4.6 min gap. The external cron dispatches the sweeper every 15 min, on time all day (10:15 to 16:00, 25 runs, all successful). The gap came from **the helper itself**: its 14:56:12 `schedule` run dispatched a sweeper run at 14:56:18, between the 14:45 and 15:00 cron runs. `workflow_dispatch` runs from both sources look the same to (c), so each helper run breaks (c) for up to 50 min.

**What the check guarantees today:** before any create, proof that something off this PC, which an agent cannot fake, ran the sweeper recently and keeps doing so. The sweeper deletes every labelled server, Primary IP and SSH key whose `delete-after` (create + TTL) has passed, so a crashed batch bills at most TTL plus one sweep interval. There is no on-box watchdog: a server cannot delete itself without a Hetzner token on it, and a powered-off Hetzner server still bills.

**Proposal: (c) forgives only the helper's own dispatch, proven from the helper repo.**
1. When (c) counts the `workflow_dispatch` sweeper runs on develop in the last 50 min, leave out a run that was created within 3 min after a successful `event=schedule` run of `dispatch-sweeper.yml` in the helper repo.
2. Everything else in (c) stays: at least 3 remaining runs, every gap 10-20 min, the newest under 20 min old. `sweeper_newest_ok` stays too (the newest completed sweeper run must not have failed).
3. **Why this does not weaken the guarantee:**
   - An agent cannot make a helper `schedule` run: a manual run of the helper is `workflow_dispatch` there and does not count. So only a real helper run can excuse an extra sweeper run, and only one, within 3 min after it.
   - A manual sweeper dispatch by an agent still makes a short gap, and (c) still refuses for up to 50 min.
   - The proof of the external cron is unchanged: 3 runs at 10-20 min gaps that no helper run explains.
4. **Today's runs under the proposal:** at 15:38, 14:56:18 is excused (6 s after the helper's 14:56:12 run), leaving 14:45:28, 15:00:59, 15:15:28 and 15:30:45: gaps 15.5, 14.5 and 15.3 min, newest 7 min old. D would have started at once.
5. **Not proposed:** dropping the 10 min minimum gap (it is what stops a faked cadence); relying on (a) or (b) (the throttled cron cannot keep within 120 or 40 min); a poweroff timer on the box (a stopped server still bills).
6. **Alternative (needs the human's helper repo):** the helper passes an input such as `source=helper` to the dispatch, the sweeper workflow shows it in its `run-name`, and (c) leaves those runs out by name. Cleaner, but it changes the human's repo; the time-window rule above needs no change outside `deploy/`.
7. **If approved:** one small `deploy/` PR: the rule in `sweeper_cadence_ok`, offline tests with today's run lists (the helper run excused; a manual dispatch still refused; a helper run more than 3 min before the extra run not excused), and `deploy/README.md`.

## Earlier: round 5 stopped after B (13:49 UTC)

| Batch | Result |
| --- | --- |
| A (12:03Z, develop c32521e5) | FAIL 3/7: the agent crashed five times on a null memory summary, and the chat limit was off. Fixed elsewhere (#266, skills-rotn) and in #267 (fresh `memory.json`). |
| A rerun (12:53Z, develop 1a7d990f) | FAIL 3/7, a result: the agenda paused as stuck at `sticks`. Felling gave 25 logs and 1 stick; `!craftRecipe("planks")` said it needs a crafting table; `!searchForBlock("log")` led to an underground log and 180 s of pathfinding. No crash, no deaths, the chat limit on, memory reset. |
| B (13:08Z, develop 1a7d990f) | Scenario error at 13:26:21 after login_online and fresh_start passed: "console failed (3221225794)". The bot had reached step 8 (table, planks, 5 sticks). No server log (its fetch failed the same way). |

- **B's cause:** this Windows machine was short of memory. 3221225794 is 0xC0000142: `bash.exe` failed to start, so nothing reached the server. Claude Code had reaped the batch's wrapper shell for low memory a minute before. No harness process was left behind. (The `npm test` tree from 03:17Z is not mine; the lead says leave it.)
- **All round 5 memory summaries came back empty** (0 of 20 stored; the probe named OpenInference each time). The human has excluded OpenInference from the preset.
- **LLM and Hetzner:** A USD 0.001557 (12 min), A rerun 0.002087 (13 min), B 0.005139 (21 min). The key reads USD 0.779532 of 4.50. Every server, Primary IP and SSH key verified gone; the project is empty.
- **Open: my PR (the lead's order, after B):**
  - the console and the final log fetch retry a bash that never started for up to 135 s (5, 10, 20, 40, 60 s), and the error names the free memory;
  - per-provider counts from `openrouter.js`'s provider line (#271): requests, empty answers, and summaries ok/empty, attributed only when unambiguous;
  - #267 nits: history.js's "[memory] summary returned" lines count (B: 11 empty, not 10), an exit counts only when non-zero, plain wording at DRIVER.md:372.
- **Merged: #267** (fresh `memory.json` at every G3 start; empty summaries counted). **#258** (round 4 cleanup).
## Earlier: G3 smoke round 4 is over (GO 06:30Z, develop 09197157, smoke).

| Batch | Result |
| --- | --- |
| A | **PASS 7/7.** All 11 agenda steps in 6.3 min. `crafting_table` passes on "held" (the skill picks the table up after each craft). |
| B | 4/5. "fell from a high place" 2.4 min in, at the `sticks` step, while the unstuck reflex had interrupted `!collectBlocks("stick", 4)`. Not the falling tree. |
| C | **PASS 7/7.** The task preempted the active agenda, the server confirmed the bot on the marker, and the agenda resumed and finished. |
| D | FAIL 3/7. Kicked for spamming 3 s after the join: the agenda catch-up burst (11 "done" lines and "agenda done") on (c)'s inventory. The "late refusal" is **my misreport**: the refusal came 1 s after the whisper (fix PR below). |

- **LLM:** 0 failed replies in all four scenarios. USD 0.0114 for the round; the key reads USD 0.7707 of 4.50. Hetzner: 12 + 7 + 13 min; every server, Primary IP and SSH key verified gone. No StackUp-count or NaN guard lines from forge-bridge.
  - By the key, the round cost USD 0.011611 (A's start to the 07:49 reading); the batch figures give 0.011406. The rest is usage OpenRouter recorded after a scenario's end reading, plus the probes (cleanup PR).
- **Open: the cleanup PR (lead, after #257).** It explains the two usage gaps, names both probes and exempts the in-scenario login retry from the GO retry rule. deploy-eol now also checks HEAD's blobs for CR.
  - The batch.mjs JSDoc and poll overshoot (#251), the `HCLOUD_SERVER_ID` export (`redact-evidence.mjs:58`), the 52-of-62 note (`g3a-20261106-r3b/README.md:59`) and the crafting-table anchor (`tablePlacements`) were already on develop.
- **For skills-rotn (the lead routes):** the spam kick (D, sent). The fall during unstuck at the sticks step and the low leaf drop rate (B). The "late refusal" was not the bot: please withdraw it.
- **Merged: #254 (the round 4 evidence), #255 ((d) after an early kick; (d) in its own batch; the GO template), #257 (nits).** The crafting-table answer:
  - **Why the use stat stays 0:** Forge 1.12.x `ForgeHooks.onPlaceItemIntoWorld` sets the stack to its new count, then calls `addStat(StatList.getObjectUseStats(itemstack.getItem()))`.
  - Placing the last item of a stack leaves an empty stack, whose item is air, so the use is credited to air.
  - The bot only ever holds one table, so the stat can never count its placement. DRIVER.md and the scenario header now say so; the check is unchanged (the held count and the placed block carry it).
- **Merged #255, (d) after an early kick.** `gone()` stays true after the kick, even though the agent process rejoined before the task was sent. So the observe loop never ran, and the refusal was called late.
  - Fix: a bot that left before the task is sent makes (d) "not reached", with the kick named, and no task is sent.
  - Offline test included.
- **Decided (the lead, after round 4): (d) runs in its own batch on a fresh server** from round 5. There is no allowlist change. A fresh world gives the first-join inventory, so the agenda starts at `rocks`.
  - The batch layout, the TTL figures (D: 16 + 25 = 41 of 60 min, `--ttl-hours 1`) and a round GO template are in DRIVER.md, in #255.
  - The catch-up burst itself still needs skills-rotn's fix.
- **Merged: #251, the Windows test PR** (the lead, low priority; net-forge's report). The tests did not hang: Git Bash process starts on Windows made `cx23.test.js` take 189 s and `test-server.test.js` 255 s alone, beyond tool time limits.
  - The 8 shell-heavy blocks now skip on a local Windows run with a stated reason, unless `ROTN_RUN_SHELL_TESTS=1`. They never skip on CI (`CI=true`) or on Linux.
  - `deploy-eol`'s on-disk check skips on Windows (not CI) for a stale CRLF working copy, naming the files and the verified fix (`git checkout -- deploy/cx23`).
  - Full `npm test` on Windows: 80 s, 1214 pass, 0 fail.
  - Plus the two #248 doc nits.

## Earlier: G3 smoke round 3 is over (the lead, 2026-11-06)

The continuation ran on the new preset, `@preset/glm-5-3-flash-cheap-reliable`, from develop aec33fe7. A probe before each batch returned 200 (OpenInference). LLM, corrected (#246): 103 agent replies, 28 memory summaries and 3 failures (A's 3 empty answers); not "0 failures in 109 replies".

| Batch | Result |
| --- | --- |
| A rerun | 6/7. **All 11 agenda steps done** in 8.5 min, incl. 10 `chalk_cobble`. `crafting_table` is a false negative: the table was placed at -42 67 -54, but the use stat stayed 0. |
| B | 4/5. Crushed by a falling Dynamic Trees tree at 3.7 min, at the `logs` step. |
| C | **PASS 7/7.** Task preempted the active agenda, server-confirmed on the marker, agenda resumed. |
| D | FAIL. Kicked for spamming (an agenda catch-up burst of 11 lines at the join), then two DecoderException disconnects (NaN position, malformed packets; net-forge). |

- **LLM:** USD 0.0142; cumulative by the key USD 0.7591 of the 4.50 stop. Every server, Primary IP and SSH key was verified deleted.
- **Merged:** #244 (the r3b evidence) and #245 (the crafting_table placed block).
- **Merged:** #248 (the LLM-failure stop rule, with its infra-fault outcome). It had to be in place before the next paid round, and it is.
- **For other agents (the lead routes):**
  - skills-rotn: felling stance (B); the death cause for "crushed by a falling tree" (B); the agenda catch-up chat burst that drew the spam kick (D).
  - net-forge: the NaN position and malformed packets (D; the lead has sent it).

## Earlier: the hold before the new preset (round 3 continuation)

- **Continuation batch A** (develop 73c25461, `captures/raw/r3b-g3a/`): FAIL, but it never tested the bot.
  - Every LLM call failed: 20 "My brain disconnected" replies, 11 of them `429 Provider returned error`. The agenda stuck at `rocks` after 3 self-prompter runs (2.6 min).
  - LLM USD 0; Hetzner 8 min; the server, Primary IP and SSH key were verified gone. Stopped before B as an infra fault.
- **Round 3 batch B (#237) had the same fault:** its 11 "calls" were all failures, so it survived on reflexes and the night routine alone. Its README is to be corrected in the next evidence PR.
- **Probes of `@preset/glm-5-1-mindcraft`** (01:32:08Z and 01:42:16Z): HTTP 429 both times. Provider Baidu, `tpm_rate_limit_exceeded`, `upstream_provider_shared_pool`.
- **The human's decision:** every LLM run now uses `openrouter/@preset/glm-5-3-flash-cheap-reliable`. One PR carries both `LLM_MODEL` (harness-ops) and `profiles/rotn-bot.json` (skills-rotn's ca334176, unchanged); it supersedes #239.
- **Next, after the lead's word:** a probe with the new preset, then A, B, C+D under the existing GO, with a probe before each batch.
  - New stop rule: 5 or more LLM failures and no successful reply in a batch's first 5 min means an infra fault, so stop.
- **Later (`test/` PR):** an LLM probe in the preflight, and a result note counting successful versus failed LLM calls. Plus round 3 B's README fix and the #236/#237 nits.

## Earlier: G3 smoke round 3 paused after batch B (the lead's GO, 2026-11-06)

- **A** (`g3-rocks-to-stone-tools`, develop 609490f6): FAIL 6 of 7.
  - Both stone tools, the table and all five crafts were done; 10 of 11 agenda steps in about 7 min, with no deaths.
  - `cobblestone` failed: `!craftRecipe("cobblestone")` asks for Twilight Forest's giant cobblestone; the rock's own `chalk_cobble` was never tried. That is fixed by skills-rotn's #234.
  - LLM USD 0.1715.
- **B** (`g3-first-night`): a scenario error, not a verdict on the bot.
  - The server log rolled over at 00:00 UTC, the begin marker was gone, and the run stopped at 00:00:56. Until then: no deaths, and online.
  - Stopped per the GO. C+D did not start.
- **Cumulative LLM** by the key: USD 0.7449 of the 4.50 stop. Both servers were verified deleted, and the project was checked empty.
- **Merged:** #237, A's and B's smoke evidence.
- **Open:** #236, the log roll-over fix. The session reads the rolled-over `.gz` plus `latest.log` once the marker is gone and records `notes.logWindow`; `rotn-test console` survives it; `batch.mjs` warns about runs past 00:00 UTC.
  - The lead's review fixes are pushed (70818871): a daily-only `.gz` glob, the rotated fallback for the evidence `server.log` too, one retry on a half-written `.gz`, a `no_cheat` test across the rotation, and a doc block moved.
- **Queued for the next evidence or redactor PR** (#237 nits): the "16 vs 17 min" wording, and masking Hetzner's numeric server IDs in the redactor.
- **#236 merged** (the log roll-over fix).

## Done: G3 smoke round 2 (the lead's written GO, 2026-11-05)

All SMOKE batches (no `--gate`; `batch.json` says `gate: false, smoke: true`). Evidence is in `test/evidence/g3/*-20261105-r2/`, one PR for all three. Every server was verified deleted, and the project was checked empty after each batch. There was no retry.

| Batch | develop | Verdict | LLM USD | Hetzner |
| --- | --- | --- | --- | --- |
| A rocks to stone tools | 139239f2 | FAIL: slain 4 times (Grove Sprite, then "Zombie <bot>" 3 times); agenda stuck at `crude_axe` | 0.1189 | 13 min, 1 h billed |
| B first night | 139239f2 | PASS, 5/5: survived the night; agenda reached stone_axe | 0.2018 | 44 min, 1 h billed |
| C task preempts agenda | eb9b5657 | FAIL: task done (server-confirmed at minute 5.9), but the agenda had already paused itself as stuck, so there was no preemption to see | 0.0438 | 11 min, 1 h billed (C+D) |
| D untrusted refused | eb9b5657 | FAIL, not reached: Leaves above the pinned marker `-20,70,-56` (site not clear) | 0.0054 | with C |

Round 2 LLM total: USD 0.3699. Cumulative with round 1: USD 0.5505 of the 4.50 stop.

**For the lead (decisions):**
- (c) should send its task only while the agenda runs, or record "agenda not active at the task" as not reached.
- (d)'s marker needs re-pinning, or a short list of pinned candidates.

**Requests (for skills-rotn, via the lead):**
- In B, the night shelter said "without a pickaxe" while the bot held a stone pickaxe.
- In A, `self_preservation` threw 6 times around the deaths.

**Merged:** #228 (round 2 evidence) and #230 (the lead's decisions):
- (c) sends its task only while the agenda is active (bounded wait, else not reached), and the `agenda_resumed` wording is fixed;
- (d) uses pinned S1 candidate markers, and the first clear one wins.

**Merged:** #231, the derived runner timeouts:
- `batch.mjs` gives each scenario `ceil(runMinutes + 8)` from the scenario itself: (a) 37, (b) 67, (c) 34, (d) 16 min.
- `--timeout-min` may only raise it; a lower value is refused in the preflight.
- No `--timeout-min` is needed in the next GO's commands.

**Merged:** #232 (the TTL check and the `--timeout-min` cap).

## Done: the first G3 smoke batches (the lead's written GO, 2026-11-05)

Evidence is in `test/evidence/g3/` (branch `agent/harness-ops/g3-smoke-evidence`, one PR for all three batches). Every server was verified deleted, and the project was checked empty after each batch. There was no retry.

| Batch | Code | Verdict | LLM USD | Hetzner |
| --- | --- | --- | --- | --- |
| A `g3-rocks-to-stone-tools` | d5ae8e75 | FAIL (gate-valid): agenda stuck at `crafting_table` (`!useOn` hang); `no_cheat` false positive | 0.0765 | 13 min, 1 h billed |
| B `g3-first-night` | 202b8263 | FAIL (gate-valid) on `no_cheat` only (the same false positive); survived the night, 0 deaths | 0.0526 | 45 min, 1 h billed |
| C `g3-task-preempts-agenda` | c62f63d5 | FAIL (gate-valid): task accepted, never run (`!searchForBlock("log", 64)` never returned) | 0.0354 | 20 min, 1 h billed (C+D) |
| D `g3-untrusted-refused` | c62f63d5 | PASS (gate-valid), 7/7 | 0.0160 | (with C) |

Total LLM USD 0.1805, and 3 billed server hours (about EUR 0.41 plus 3 Primary IPv4-hours).

**The lead's decisions (2026-11-05):**
1. `cheatProblems` allows exactly `gamerule commandBlockOutput false` and `gamerule sendCommandFeedback false` (value false only) at any time. Small `test/` PR, recorded in DRIVER.md.
2. The `!useOn` hang goes to skills-rotn (the lead routes it).

**Requests (for skills-rotn, via the lead):**
- In (c), a long-running action (`!searchForBlock("log", 64)`) blocked a newly accepted task. Accepting a task should interrupt the current action, or every action needs a bound.
- In C+D (3 times in each scenario), breaking Dynamic Trees branches gave no log ("Broke dynamictrees:sprucebranch but got no log"). It did not appear in A or B.

**Merged:** #218 (this evidence) and #219 (the `cheatProblems` change).

**Merged:** #220 (the #207 nits).

**Open PR (in the lead's review):** #223, reworked to the lead's #220 decision:
- smoke is the default, and only `batch.mjs --gate` writes `gate: true` into `batch.json`;
- the gate claim check needs `gate: true`;
- the evidence check (`--tree`) rejects G3 results without `gate: true`, except explicit `smoke: true` records. That exception is my reading of the decision, flagged for the lead, because CI would otherwise fail on the three marked smoke folders;
- the three 2026-11-05 folders are marked `smoke: true`;
- the setblock answer is anchored (#220 nit), and the #219 prefix/suffix tests are added.

**Next:** the lead's review of #223. A gate batch's command needs `--gate` right after `batch.mjs`, and any new batch needs a new GO.

## Resumed after the Orca restart (2026-11-05 16:55 UTC)

- **#208 (d) is ready for the lead's merge.** Both re-review fixes were already in f097de1e. I merged develop in (#206, #210) as 3d1de0be and pushed it, no force-push.
- **Retested after the merge:** g3-untrusted 6/6, g3-task 9/9, g3-spend 45/45, mindcraft-driver 14/14.
- **Next:** the #207 nits PR, branched from develop once #208 merges (see step 2 below). Still open for the lead: #208 nit (2), the refusal deadline.

## PAUSED for the Orca restart (2026-11-05 01:49 UTC, the lead's request)

**Branch:** `agent/harness-ops/g3d-untrusted-refused` (PR #208, targets develop), pushed and clean. Nothing is running, and no paid work is pending.

**State:** #201 (a), #203 (b) and #207 (c) are merged. #208 (d) has both re-review fixes pushed (f097de1e) and awaits the lead's merge.

**Exact next step after the restart:**
1. `git fetch`. If #208 is merged, branch from develop for the #207 nits PR; if not, answer any new review on #208 (merge develop in, never force-push).
2. The #207 nits PR (small, `test/` only):
   - gate the driver's `clearBotState` to G3 runs (or fix its comment), and prune old `.bak` files;
   - confirm the gold block with `testforblock <marker> minecraft:gold_block 0` after the `setblock` in (c) and (d).
   - Tests: `mindcraft-driver.test.js`, `g3-task.test.js` and `g3-untrusted.test.js`, one at a time; ESLint on the changed files.
3. Open question for the lead: #208 nit (2), measuring the refusal deadline from the chat line's timestamp instead of the 5 s poll.
4. The G3 batches (A alone, B alone, C+D together) each need a written GO. Not started.

## Earlier: the G3 scenarios, offline only (lead, after #196 merged as a92faf0)

The lead's order: one scenario per small PR, (a) first, then (b) first night, (c) a task preempts the agenda and it resumes, (d) untrusted players refused. Each gets server-side pass checks, maxBatchUsd 2 and an offline test against fakes. **No batch:** nothing is running, no paid work is pending, and nothing touches the CX23.

**PR #201: G3 (a), `g3-rocks-to-stone-tools`** (branch `agent/harness-ops/g3a-early-game`).
- **The lead's review (REQUEST CHANGES), fixed:**
  - **No tp in G3 at all:** the position track is dropped, and `G3_CONSOLE_ALLOW` has no `tp`. Life evidence comes from `stat.deaths` and the log. G2 keeps its own `tp`.
  - `fresh_start` also needs the pack's first-join `give_bread` and `give_bundle`.
  - A test for the rejected use stat with the table placed but not held.
  - A comment on the uncounted gap before the objectives exist (fails safe).
  - Approved: the `stat.useItem.minecraft.crafting_table` objective, with the "held" fallback. `notes.craftingTablePath` records the path used.
- **The scenario:** `test/scenarios/g3/g3-rocks-to-stone-tools.mjs`, run with the real agent (`llm: true`, the Mindcraft driver, the pinned model). `maxMinutes` 25 and `maxBatchUsd` 2 are compared 'equal', and the world is the G2 seed.
- **Checks:** `login_online`, `fresh_start`, `stone_tools`, `crafting_table`, `cobblestone` (rotn-data's 4-rocks outputs, exact name and meta), `crafted_by_bot` (gating, all five craft stats) and `no_cheat`.
- **Shared arbiters in `lib/g3.mjs`** (for b-d too): `cheatProblems` (allows only the pack's first-join gamerules and the Bread and Bundle gives, once each, within 10 s of the join) and `statCriterion`.
- **For the lead:** the crafting-table check also accepts "placed", read from `stat.useItem.minecraft.crafting_table` (1.12 counts a placed block as a use of its item). That is the approved `scoreboard objectives add` command, but a new criterion. S1 did not check it, and the first G3 smoke batch confirms it.
- **Tested:** `g3-rocks.test.js` 12/12, `runner.test.js` 42/42 (1 Windows skip), `g3-spend.test.js` 45/45, `mindcraft-driver.test.js` 13/13. ESLint is clean on the changed files.

**PR #203: G3 (b), `g3-first-night`** (branch `agent/harness-ops/g3b-first-night`; #201 merged, so #203 now targets develop).
- **The #203 review, fixed:**
  - dusk must be seen before a night counts (`dawnOf`), with a mid-night start test;
  - a `fresh_start` check as in (a);
  - `time set day` is removed from `G3_CONSOLE_ALLOW`.
  - Approved read-only for G3: the `gamerule <rule>` query, `testfor` and `testforblock`, as commented in the allowlist.
  - The batch layout is updated here and in DRIVER.md: A alone, B alone, and C+D together.
- **The scenario:** `test/scenarios/g3/g3-first-night.mjs`, with the real agent. Nothing about time is set, and there is no `tp`.
- **The dawn rule (provisional):** night is a sample at or above 13000; dawn is the next one below 12000. `maxMinutes` 55, `nightFrom` and `dawnBelow` are compared 'equal'; `maxBatchUsd` is 2.
- **Checks:** `login_online`, `survived_night` (dawn reached, `stat.deaths` 0 and no death line), `stayed_online` and `no_cheat`. The new shared `deathLines` is in `lib/g3.mjs`.
- **The lead's decisions (#203):** the shelter snapshot is dropped. The `food` criterion is approved as a read-only objective: hunger at the end is recorded as evidence only, and `G3_CONSOLE_ALLOW` allows only that criterion besides `stat.*`.
- **Tested:** `g3-night.test.js` 10/10 on S1-A's measured cycle, `g3-spend.test.js` 45/45 and `g3-rocks.test.js` 15/15. ESLint is clean.

**PR #207: G3 (c), `g3-task-preempts-agenda`** (branch `agent/harness-ops/g3c-task-preempts`; #203 merged, so #207 now targets develop).
- **The #207 review, fixed:**
  - **State:** the driver moves `tasks.json` and `agenda.json` aside before every G3 run (`fresh_bot_state`), and (c) cancels any task still open at the end.
  - **Preemption:** "agenda paused for task <id>" is now required for `task_done`.
  - **Counter:** the stick pickup stat is dropped, and every criterion must be added, or the run is not gate-valid.
- **Pinned (the lead's decision), `PINNED` true:**
  - the marker `-42,68,-50` (S1-A's rock pile about 19 blocks from spawn; the nearest sample to the 20-30 band), with a read-only air preflight for Y+1 and Y+2;
  - the counter: the rock and log mine stats plus the five craft stats.
- **Requested from skills-rotn (via the lead):** re-check `isTaskGiver` when a stored task runs.
- **Checks:** `agenda_active`, `task_accepted`, `task_done` (the server's `testfor` volume on the marker AND the bot's done line), `agenda_resumed` and `no_cheat`. There is no `tp`.
- **For the lead to pin:** the marker `x,y,z` (no default) and the agenda counter (a provisional list of early-game stats). Until then every run is not gate-valid.
- **Tested:** `g3-task.test.js` 7/7. ESLint is clean.

**PR #208: G3 (d), `g3-untrusted-refused`** (branch `agent/harness-ops/g3d-untrusted-refused`; #207 merged, so #208 now targets develop).
- **The #208 re-review, fixed:**
  - `not_on_marker` needs a definite "found nothing" for every poll; no answer is not proof.
  - The `setblock` allowlist entry is narrowed to the two pinned marker cells (`G3_MARKERS`).
- **#207 nits, for a later small PR (lead):**
  - gate the driver's `clearBotState` to G3 runs, or fix its comment, and prune old `.bak` files;
  - confirm the gold block with `testforblock` after the `setblock`.
- **The #208 review, fixed:**
  - **Server-side evidence:** an untrusted "stand on the gold block at X Y Z" task at (d)'s own marker (`-20,70,-56`, with the air preflight); `not_on_marker` requires that `testfor` never matches for 90 s.
  - **`no_task`** is widened to any `task <id> accepted|started|done|failed`.
  - **`fresh_bot_state`** comes from the driver's `botState`.
  - **The untrusted sender** is documented as the console with the switch off. The human decided this is enough for G3; a second-account player test is revisited at G4 if the human wants it.
- **Checks:** `production_givers` (the driver's start event says `serverTaskGiver` false), `refused_politely` (skills-rotn's refusal line), `no_task` (no accepted, started, paused or "used taskAdd" line for 90 s) and `no_cheat`.
- **The driver:** `ROTN_G3_PRODUCTION_GIVERS=1` turns the test-only `Server` giver off (only off, never on), and `mindcraft_start` reports `serverTaskGiver`.
- **Tested:** `g3-untrusted.test.js` 4/4, `mindcraft-driver.test.js` 13/13, `runner.test.js` 42/42 (1 Windows skip), `g3-spend.test.js` 45/45 and `g3-rocks`/`night`/`task` 15/10/7. ESLint is clean.

**The stack:** #201 (a) <- #203 (b) <- #207 (c) <- (d). Each PR retargets to develop as the one below it merges; never force-pushed. **Next:** the lead's reviews, then pinning the marker and agenda counter for (c), and the G3 smoke batch (needs a written GO).

## Done just before (2026-11-04)

- **#196 merged (a92faf0):** the #189 review nits, and the #165 follow-ups (the server's food must rise after the eat; RotN's hunger model in the P1 sim; docs). The worktrees `../harness-ops-p1` and `../harness-ops-p1b` were removed (both clean; the lead said the raw captures were no longer needed).

## Before the pause (2026-11-03 afternoon)

**State:** **P1 is done: the rerun (attempt 2) was a SMOKE-PASS, 8 of 8 checks** (below). Attempt 1 had failed at setup on a late console reply, fixed by #183. Both servers are deleted. P1's spend was about EUR 0.28 plus 2 IPv4-hours. Nothing is running. Nothing touches the CX23. Merged since the restart: #165, #169, #170, #172, #173, #176, #180, #183, #184 and net-forge's #167 and #177. Only this PR edits this file.

**PRs (mine):**
- **#189 (merged): the P1 rerun evidence**, `test/evidence/probe/p1-20261103-a2/`. The README covers each pass check, the serverbound REID ids, the FastWorkbench window, the placement latencies, the bread's food gain and the spend. The capture summary comes from the new `test/tools/p1-capture-summary.mjs` (unit-tested).

**Next step:**
- **#165 follow-ups (lead's nits), one small PR:** use net-forge's RotN hunger model (`simulateHunger`, #177: Hunger Overhaul and AppleCore; `20 24` with at least 25 s before eating) instead of my vanilla sums; the lead's rule that each P1 attempt uses a fresh server; and the lead's approval of the `p1food` scoreboard commands, recorded at `P1_CONSOLE_ALLOW` and in DRIVER.md.
- **For net-forge (via the lead):** the measured placement latencies (589-1158 ms) are under `place_block_timeout_ms` 2000; the capture's 300-record caps for `block_change` and `entity_metadata` ran out during the login, so a placement's `block_change` is never in a P1 capture.
- **The first G3 batch** needs the lead's check that a fresh Orca terminal sees `OPENROUTER_API_KEY` (set or not set only), and a written GO.
- If a PR conflicts with develop, it is almost always this file: merge develop in and push. Never force-push.

**Rules still in force:**
- Targeted test files only, one at a time; no full suite locally (CI runs it). During a paid batch over 20 minutes, nothing else heavy runs on this PC.
- Write markdown and code edits with the Write/Edit tools or script files, never inside double-quoted shell strings.

## Real P1 batches

### P1 attempt 2, the rerun (2026-11-03): SMOKE-PASS, 8 of 8 (a probe, never a gate); the server is deleted

The full record is in `test/evidence/probe/p1-20261103-a2/README.md` (this PR).
- **Run:** the lead's "P1 rerun: go"; a new clean detached worktree of develop at defbaa69 (with #183) after `npm ci`; `msa-login --check` exit 0; an empty project; the preflight on its own passed (cadence path); `--ttl-hours 2`, no skip flags, a fresh server; no LLM key in the batch's environment.
- **Times (UTC):** start 15:20:16, created 15:20:26, ready 15:25:33, scenario 15:25:33-15:28:40, "verified gone" 15:29:05. Project empty at 15:29:12.
- **Checks, all PASS:** `login_online`, `setup` (5/5 gives), the four crafts (crude axe, Crafting Tools, crafting table, and the 3x3 stone pickaxe at the placed table), `place_5` and `eat`. No late replies, no contract problems, no kicks.
- **REID:** 33/33 serverbound window clicks accepted, 7 of them with item ids above 4095 (8917 `pyrotech:rock`, 9075 `pyrotech:crude_axe`, 12510 `contenttweaker:crafting_tools`).
- **FastWorkbench:** the table's right-click opened FML's `fastbench` mod window after 138 ms; the 3x3 craft ran in it (10 clicks, all accepted, 10 fastbench payloads).
- **Placement latencies:** 1158, 589, 1095, 904 and 634 ms (median 904).
- **Bread:** food 15 -> 18 (+3, RotN's bread). The food before it was 15, exactly what net-forge's RotN model (#177) predicts for `22 19`.
- **Also seen:** a 2.16 s server lag spike (CoFH cascading worldgen) during the food wait; the same first-join commands as attempt 1, plus a `lifescroll:spawnscroll` in the hotbar.
- **Spend:** 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour.

### P1 attempt 1 (2026-11-03): FAIL at setup (a harness timing false negative); the server is deleted

The full record is in `test/evidence/probe/p1-20261103-a1/README.md` (#184).
- **Run:** the lead's written GO (approved by the human); a clean detached worktree of develop at e6196244 after `npm ci`; `msa-login --check` exit 0; the preflight on its own passed (cadence path); `--ttl-hours 2`, no skip flags; no LLM key in the batch's environment.
- **Times (UTC):** start 14:34:07, created 14:34:20, ready 14:39:42, scenario 14:39:42-14:41:02, "verified gone" 14:41:33. Project empty at 14:41:47.
- **Checks:** `login_online` PASS; `setup` FAIL (4/5 gives confirmed); the four crafts, `place_5` and `eat` not reached.
- **Cause:** after `clear`, gamestages and antiqueatlas saved, and the server answered the rock `give` at 14:40:23, about 3 s later, after the console's 1 s window. All five gives are in the server log. Fix: #183.
- **No retry:** neither infrastructure nor a probe finding. The lead approved the fix and one rerun on a fresh server.
- **For G3:** on a fresh world's first join the pack runs, as the bot, `gamerule commandBlockOutput false`, `gamerule sendCommandFeedback false`, gives 1 Bread and 1 Bundle, and grants one game stage.
- **Spend:** 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour.

## Done

- G0 tooling written and unit-tested offline on branch `agent/harness-ops/g0-test-server` (PR #4):
  - `deploy/test-server.sh`: up, run, down, list, sweep, console, fetch, verify, `--dry-run`.
  - `deploy/test-server/`: the cloud-init build, the on-server helper and the systemd unit.
  - `.github/workflows/test-server-sweeper.yml`: the off-PC watchdog.
  - `test/scenarios/g0-test-server.sh` and `test/scenarios/g0-watchdog.sh`.
  - `test/tools/status-ping.mjs`.
  - `test/unit/*.test.js`: 44 tests (`npm test`), all passing; `npx eslint test/` is clean, and the repo total is still 259.
- Read-only checks against the real API (2026-11-01), all passing:
  - `hcloud context list` shows `mindcraft-rotn-test` active.
  - The project has no servers and no Primary IPs. It has one human SSH key with no labels, which the sweeper's selector never matches.
  - `ubuntu-24.04` is available (x86).
  - nbg1 gross prices: CPX42 EUR 0.138136/h, CX23 EUR 0.010912/h.
  - `test-server.sh up --dry-run` and `sweep --dry-run` work against the real API.
- Pack: CurseForge file 7564549 is "RotN 3.3.4 Server Pack.zip" with 791,130,136 bytes, the same as the local zip. Its CDN URL answers HEAD with 200.
  - The SHA-256 is not yet verified: the first build downloads the file, hashes it on the server and logs the result.
  - If the hash does not match the pin, the build falls back to uploading the local zip.
- Independent verifier pass: static PASS, no blockers. Its should-fixes are applied in commit ce07fc0 (whitelist by UUID, sweep cap, interval assertion, timeouts).
- PR #4 independent review (REQUEST CHANGES): findings 1, 2, 3, 4, 6 and 9 are fixed on the same branch:
  1. **Context pin.**
     - Every hcloud call passes `--context mindcraft-rotn-test`, with `HCLOUD_TOKEN` and `HCLOUD_CONTEXT` stripped from hcloud's environment.
     - Any other context is refused before the first call.
     - The sweeper's `ROTN_HCLOUD_AUTH=env-token` mode is accepted only when `GITHUB_ACTIONS=true`.
     - `g0-watchdog.sh` is pinned in the same way.
  2. **Watchdog control.**
     - It has an expired `delete-after` and no `purpose=mindcraft-rotn-test`, so it proves selection by label.
     - Its own expiry is the separate label `control-expires`.
  3. **Control watchdog.** The sweeper deletes `purpose=mindcraft-rotn-watchdog-control` servers once `control-expires` plus 30 min has passed. Costs corrected below.
  4. **Cleanup by ID.** `g0-watchdog.sh` cleanup deletes only the IDs returned by its own `create -o json`, never by name.
  6. **Pre-create guard.** It also blocks on leftover labelled Primary IPs and SSH keys.
  9. **Flags checked.** Every hcloud subcommand and flag the scripts use was checked with `--help` on hcloud 1.70.2, and nothing was created. The `create -o json` output shapes were checked in the v1.70.2 source.

  Unit tests cover 1, 2 and 4 (plus 3 and 6). Part of finding 5 is done as well: the cost wording now says TTL + 1 billed hours.

### Real G0 batches (2026-11-01, branch `agent/harness-ops/g0-evidence`)

- PR #4 merged into develop as 70c5c3a; the sweeper is active on develop.
- Re-review nits (commit 31cefa0):
  - `deploy/test-server.sh` and `g0-watchdog.sh` now also strip `HCLOUD_ENDPOINT` and `HCLOUD_CONFIG` from hcloud's environment.
  - `check_context` has a comment explaining why `GITHUB_ACTIONS=true` forces env-token mode.
  - Two new unit tests fail without the fix. `npm test` passes 46/46, and `npx eslint test/` is clean.
- Sweeper dry-run dispatch [41257157372](https://github.com/JQDAW/mindcraft-RotN/actions/runs/41257157372) at 00:32:00 UTC, before any create: the token works, 0 deletions.
- **Real batch 1, G0 build: PASS, 21/21 checks.**
  - Batch `mcr-test-20261101-003243`: cpx42, nbg1.
  - **Start 00:32:37 UTC** (create 00:32:44), ready 00:35:52, **stop 00:36:16** (deletion verified).
  - The pack was downloaded from CurseForge, and its SHA-256 matches the pin. Java 8, Forge 14.23.5.2860, REID 2.2.2, 346 mods in the ping, online mode, whitelist FRCFLD and JQDAW, console OK.
  - **Cost: 1 billed hour x EUR 0.138136 = EUR 0.14**, plus 1 Primary IPv4-hour.
- **Real batch 2, watchdog proof (`--mode dispatch`): PASS.**
  - Batch `mcr-wd-20261101-003652`.
  - **Start 00:36:52, stop 00:38:18 UTC.**
  - Sweeper run [41257552258](https://github.com/JQDAW/mindcraft-RotN/actions/runs/41257552258) deleted the target server, its Primary IPv4 (auto-delete off) and its SSH key 34 s after creation. The control (expired `delete-after`, no test label) was untouched, then deleted by the script's cleanup by ID.
  - **Cost: 2 x cx23 x 1 billed hour x EUR 0.010912 = EUR 0.02**, plus 1 Primary IPv4-hour.
- After each batch, `hcloud server list` and `primary-ip list` were empty (00:36:21 and 00:38:24). The only thing left in the project is the human's unlabelled SSH key.
- Total for both batches: about **EUR 0.16** plus 2 Primary IPv4-hours. The stated maximum was about EUR 1.29.
- Evidence is in `test/evidence/g0/`. An independent verifier pass gave PASS. Its should-fix (capture the project-wide empty checks) and nits are applied.

- PR #5 (G0 evidence) merged as 65792f3: **G0 test-server half passed, "schedule pending"**.

- PR #7 (G0 follow-ups: sweeper preflight, name check, `--allow-from`, label alerts, watchdog attribution) merged as bbcb0ef.
- PR #8 (CI: `npm ci`, `npm test` and the lint gate on every PR) merged as a04ea22. Its own CI run passed: 55/55 tests, lint 259/259.
- PR #9 (scenario runner plus the G1 scenario, brief deliverable 2) merged as f1aefab after re-review: all 12 findings fixed, APPROVE WITH NITS.
  - `test/runner/` holds the engine, the server-log parsers, the adapters, the CLI and the driver contract (`DRIVER.md`), plus a stock-mineflayer reference driver. The scenario is `test/scenarios/g1/g1-login-chat-walk.mjs`.
  - No paid run yet. The first real G1 run needs net-forge's driver, the bot's token cache (NEEDS-HUMAN), the lead's approval and an observed scheduled sweeper run.

- PR #11 (review follow-ups: scheduled-only watchdog evidence, `gh --repo`, lint ratchet that fails closed) merged as e3c1732: APPROVE, lint gate proven end to end. Its review findings 1 and 3 and nits 4 and 5 were fixed in 5296086.
- PR #12 (sweeper cron at the off-peak minutes `7,22,37,52 * * * *`) merged as 971262f at 11:45:11 UTC: APPROVE.
- PR #13 (PR #9 re-review nits: confirm the `say` marker before `bot.start`; reject `[Rcon]` and `[@]`) merged as 04b57c3: APPROVE WITH NITS.
- PR #17 (low-priority nits from the #11, #12 and #13 reviews) merged as 032da12 at 12:16:28 UTC.
- PR #21 (sweeper preflight: (a) its own schedule, (b) the helper repo's schedule, or (c) a cadence of external-cron dispatch runs; a failed newest sweeper run blocks all three) merged as 2abdd3b. Its CI race fix is in c5a4a8c (atomic writes of the fakes' state).
- PR #22 (status: off-peak cron 0/8, helper not firing, helper workflow review) merged as a8ccac8.
- **Off-PC sweeper trigger:** cron-job.org has dispatched the sweeper every 15 min since 14:15 UTC (set up by the human). Path (c) passed on the live runs at 14:55 UTC: gaps 15.2 and 14.8 min.
- PR #27 (small queued items: status-ping flake, PR #21 findings 3/4/6, PR #17 nits; then the sweeper preflight refuses without GitHub's Date header, and ROTN_TEST_NOW needs ROTN_TEST_MODE=1) merged as 62ec6f1.
- PR #30 (CX23 runtime, offline: bootstrap, unit template, check-env, ctl wrapper, tag deploy and rollback) merged as 501c490 after re-review: APPROVE WITH NITS. The lead cross-checked the pinned NodeSource fingerprint on keyserver.ubuntu.com.
- **G1 PASSED** (PR #31, b554547), with this runner and the G1 scenario as the gate evidence.
- PR #33 (runner: `git: {sha, dirty, untracked}` in result.json) merged as a42fb26.
- PR #40 (CI: `dumper-build` workflow for rotn-data's dumper; JDK 8, Gradle 4.10.3 checksum-verified, SHA-pinned actions) merged as 063c0a4. It was proven on PR #34's code in a throwaway trial PR (#39, closed). The first run failed red on the old ForgeGradle 2 userdev jar; after rotn-data moved to ForgeGradle 3, it went green. #42 (wording) merged as 0fb6deb.
- **PR #36 (G2 scenarios) merged as eedab96** after three review rounds:
  - **Scenarios:** `g2-blocks-named`, `g2-mobs-named` and `g2-items-roundtrip`. The bot only reports names; the server confirms each with `testforblock`, `testfor`, `summon` and `give`.
  - **Blocks:** the census leaves out air; the runner picks samples per type; 40 non-air spot checks are weighed against the census.
  - **Mobs:** the list comes from rotn-data's `common-mobs.json`, and needs a modded mob.
  - **Items:** the full table round-trips through the agent's naming.
  - **Agent naming:** `agentNaming` imports `src/utils/mcdata.js` in a child process. Its `toNew`/`toOld` must be functions and pass the full table both ways; otherwise every run is `notGate`.
  - **Evidence:** the world seed is required.
  - **Naming wired:** rotn-data's #44 merged on develop. My `agentNaming` check confirms all 643 table entries round-trip through `mcdata.js` (21:45 UTC).

## Doing

- **Phase 3 (G3).**
  - The G3 plan, the driver interface proposal, the CX23 plan and the human items H1-H6 are merged (#101).
  - **S1 is done.** S1-A's evidence and findings are merged (#113); the S1 tooling is in #106.
  - **The lead's decisions after S1-A:**
    - the G3 world is the G2 world (seed 1880465901402976865, cube -45 66 -66);
    - **S1-B is cancelled**;
    - the dawn bound is provisional until the first G3 smoke batch;
    - memory: option 1 (Requests item 13).
  - **The G3 driver is merged (#116)** (`test/runner/drivers/mindcraft-driver.mjs`). It runs the real Mindcraft agent under the runner contract:
    - no task files, and it refuses skills-rotn's `MINDCRAFT_ROTN_ALLOW_TASK_FILES` too;
    - no insecure settings;
    - no process left behind on a stop.
    - It is tested offline with a fake `main.js`.
  - **Merged (#122, 2b30405), required before any G3 paid batch (lead, #116 review):**
    - **`test/runner/batch.mjs`:** the batch spend stop at `maxBatchUsd` USD 2. It reads the key's usage before every scenario (numbers only), stops above the limit, always fetches the logs, and exits 5. Without a reading it refuses to start.
    - **Per scenario:** LLM calls and cost recorded in `result.json` (`llm`). An unknown cost is notGate.
    - **G3 console allowlist:** no `give`, `summon`, `kill` or op commands.
    - **`Server` is test-only:** the driver refuses a production `settings.js` that lists it as a task giver.
    - **#122 review fixes:**
      - the end of a batch fails closed (over the limit exits 5, no reading exits 6);
      - the test-mode overrides are refused inside a real test-server run, and `testMode` is recorded;
      - every G3 scenario has `llm: true` and `maxBatchUsd` 2 'equal' (unit test), with the guard whenever `llm` is true;
      - a G3 run without `batch.mjs`'s `ROTN_G3_BATCH` marker is notGate;
      - `llm` is in progress and killed records;
      - the spend is checked between scenarios only, as documented in DRIVER.md.
  - **CX23 GO 1, the read-only probe: DONE (#128, 8fcec45). The cx23 terminal is closed** (opened 22:05:21, closed 22:06:05 UTC on 2026-11-02, checked with `orca terminal list`).
    - **Where:** in the human's workspace `/tmp/mindcraft-RotN`. Only the approved read-only commands ran, with `ls -la /root` last. No installs or writes. Nothing under `/root/.ssh` was read.
    - **The human's other workspaces** were left alone: `/tmp/mindcraft` and `/root/orca/workspaces/mindcraft/tunicate`, plus their two terminals.
    - **Evidence:** `test/evidence/cx23/`. The findings table is in its README.
    - **Ubuntu: 26.04.1 LTS.** The human chose to keep it (ADR 0007, #134). The bootstrap accepts it (#137, f028e9b; its re-review nits in #144, 655bcaa), and the 26.04 CI job (#135, 05b1a5b) passes. All GO 2 prerequisites are merged; the lead is handing the bootstrap steps to the human.
    - **RAM and swap:** 2 vCPU, 3,814 MB RAM, **no swap**.
    - **Disk:** 38 GB, 6% used.
    - **What setup will change:**
      - turn on ufw (SSH only);
      - add a 2 GB swapfile;
      - install Node 22;
      - create the `deploy` and `mindcraft-rotn` users, the unit, the scripts, the sudoers rule and the folders.
      - Unattended upgrades are already on.
    - **Unexpected or worth noting:**
      - **no firewall is active** (ufw is inactive and the nft ruleset is empty);
      - **sshd allows password logins** (`passwordauthentication yes`);
      - **only SSH (port 22) is public.** Orca's server listens on loopback only.
      - The users are root and nobody only. The running services are a standard cloud set. Nothing of ours is there yet.
    - GO 2 waits on the human (Ubuntu 26.04 against the 24.04 pin, and sshd password logins); the lead is asking.
  - **Merged (#129, c2d6867): the #122 review nits**, with the #129 review fixes (its re-review nits 1-3: #139, f1fd589):
    1. **The G3 gate evidence is cross-checked against `batch.mjs`'s summary** (`test/tools/g3-batch-check.mjs`), because the `ROTN_G3_BATCH` marker alone can be forged.
       - The check is forced: CI fails on any G3 `result.json` anywhere under `test/evidence/` that no `batch.json` in its own folder or a parent folder covers.
       - Each result is bound to its batch by its `runId`, which `batch.mjs` reads back from the scenario's `result.json`. A second, hand-run result under a reused batch id therefore fails.
    2. **The wiring test** checks the G3 scenarios only. While there are none, it is skipped visibly with "no G3 scenarios yet".
    3. **Timeouts:** a timed-out scenario is recorded as 124, whatever run.mjs exits.
    4. **Spawn errors:** a runner that cannot start is recorded as 127 instead of hanging the batch.
    - **Nit 5 (a stricter fake-cloud check) is not done.** `TEST_SERVER_FAKE_CLOUD=1` is already set only with `ROTN_TEST_MODE=1`, the fake state and a non-default hcloud binary.
  - **Next:** the G3 arbiters library (inventory by count-only `clear`, the stat objectives with absent read as 0, deaths, leaves and no-cheat), then the scenarios once skills-rotn's chat formats are agreed.
- **G2 PASSED** on batch 8 (#97): blocks, mobs and items all gate-valid in one batch on the fixed world and cube.
- **History:**
  - G2 batches 1-4 FAILED. The lead's decisions went into #64, #66, #67, #73, #77 and #79, and the double-plant fix into #80-#82.
  - Batch 5 PASSED (#83), but its world had no double plants, so the lead fixed the world (#85).
  - Batch 6 FAILED: its spawn on a canopy made the cube 90% air (#88). The lead then fixed the cube (#92).
  - Batch 7 FAILED: items was kicked for an invalid move packet (#93); net-forge's movement guard followed (#95).
  - The redaction and runner follow-ups are in #94 and #96.
- **Follow-up (lead, not blocking):** in `g2-mobs-named`, require a run-tagged entity within 1 block of a matched mob report.

## Watching

- rotn-data's #47 (first RotN 3.3.4 dump, `common-mobs.json`): the G2 batch waits for it.

## Real S1 batches

### S1-A (2026-11-02): the G2 world, a survey (never a gate). Cut short by this PC's memory; the server is deleted

The full record is in `test/evidence/s1/s1a-20261102/README.md` (this PR).

- **Run:**
  - The GO came from the lead at 19:09 UTC; the code was develop 16db8ac, clean.
  - Checks before the create: `msa-login --check` exit 0 (output discarded); the preflight on its own (helper path); an empty project.
  - The command was the planned one, unchanged; only S1's console commands were used.
- **Times (UTC):** start 19:12:08, ready 19:15:15, survey 19:15:17-19:18:50, arbiters 19:18:50-19:20:15, day cycle from 19:20:15. "Verified gone" at 19:57:08.
- **Cost:** up 44 min, 1 billed hour, about **EUR 0.14** plus 1 IPv4-hour. At 19:57:13 the project was empty, apart from the human's unlabelled SSH key.
- **What broke:**
  - At about 19:55 Claude Code reaped the batch's tracking shell and my hard-stop watcher, because the PC was critically low on memory. The batch processes kept running unsupervised.
  - Following the GO ("stop, delete, report"), I fetched the server logs by hand at 19:56:27.
  - At 19:56:37 the day-cycle run failed by itself: a console call could not start a process on the PC (Windows `0xC0000142`).
  - The batch's EXIT trap then deleted everything normally.
  - S1-B was not started.

**Findings:**

- **World 1880465901402976865 (radius 48 around the fresh spawn -50.5 64 -66.5).** The census was complete: 323 types, 0 unloaded.
  - **Rock piles: 203 blocks,** mostly `pyrotech_compat:rock_metamorphic`, `_igneous` and `_sedimentary`, plus `pyrotech:rock` 4. They are on the surface, 19-46 blocks from spawn.
  - **Trees:** 8,521 blocks. **Stone:** 406,694 blocks of Underground Biomes stone.
  - **Containers: 7 blocks in two underground dungeons:** 2 `minecraft:mob_spawner` and 5 `minecraft:chest`. They are 38-45 blocks below spawn and 34-41 blocks away; every sampled position was server-confirmed.
  - **172 unclassified modded types** are listed for the lead (leaves, `osv:*` ore variants, cave moss, gases, plants, `pyrotech:rock_grass`); none has a container-like class.
- **Reply forms (the parsers matched the real server):**
  - `<bot> has N items that match the criteria`;
  - `Could not clear the inventory of <bot>, no items to remove`;
  - `Added new objective '<name>' successfully`, and `No objective was found by the name '<name>'`;
  - `Showing N tracked objective(s) for <bot>:` with `- <name>: <score> (<name>)`;
  - `Time is N`.
  - **For G3:** `scoreboard players list` omits objectives that have no score yet, so an absent objective reads as 0.
- **Craft stats:** all exist on RotN 3.3.4: `pyrotech.crude_axe`, `contenttweaker.crafting_tools`, `minecraft.crafting_table`, `minecraft.stone_pickaxe`, `minecraft.stone_axe`, `minecraft.cobblestone`, plus `stat.deaths` and `stat.playOneMinute`.
- **The count-only `clear`** really removes nothing: it counted 1, then 1 again, for the given pickaxe.
- **The whisper sender:** a console `tell` reaches mineflayer's `whisper` event as **`Server`**.
- **The day cycle** (from the server log's `Time is N` lines; `time-segments.txt`):
  - running, the vanilla rate: 1,199 ticks per minute;
  - Extended Days **freezes the time twice per cycle, about 10 min each: at 3000 (morning) and at 16000 (early night)**;
  - so a cycle is about 20 min running plus 20 min frozen, about **40 min**; the night (12542-23460) is about **19 min**;
  - not observed: 0-3000 and the wrap past 24000 (the run stopped at 23635);
  - Time Shall Not Pass pauses the cycle while no player is online.

**Proposals for the lead (from S1-A):**

1. **The world.** The G2 world has plenty of rock piles and trees near spawn, but two dungeons 38-45 blocks down.
   - Proposal: keep it. `crafted_by_bot` can now gate for every G3 item (all the stats exist), so tools from a dungeon chest cannot pass. A bot without a pickaxe is also unlikely to reach y 19-26 in 25 min.
   - S1-B (batch 5's world, about EUR 0.14) would give a comparison. The lead decides whether it is still needed.
2. **The dawn bound for `g3-first-night`:**
   - Dawn is the first `time query daytime` sample below 12000 after the bot has seen 13000 or more (the time has wrapped past 24000).
   - Expected about 40 min after the first join on a fresh server: about 20 min of day including the freeze at 3000, plus about 19 min of night including the freeze at 16000.
   - Proposal: the scenario's limit is 55 min, compared 'equal'.
   - The wrap itself was not observed (the run stopped at 23635). The first G3 smoke batch confirms it.
3. **`crafted_by_bot` gates for all five items:** the crude axe, Crafting Tools, the table and both stone tools. That assumes the counters really count when the agent crafts, which the G3 smoke batch checks.

## Real G2 batches

### G2 batch 8 (2026-11-02): PASS (blocks, mobs and items all PASS, gate-valid, one batch, one SHA); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 16:24 UTC (relayed by the human).
- **Code:** a clean detached checkout of develop at 0bdb537 (#84, #85, #92, #94, #95, #96), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create (16:25 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: exit 0, output discarded.
  - The preflight on its own: cadence path; no servers or Primary IPs.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. Then the runner's commands, including `tp <bot> -45 66 -66`.

**Real times (UTC):**
- start 16:26:11, created 16:26:28, ready 16:29:18;
- blocks 16:29:26-16:40:05, mobs 16:40:08-16:42:52, items 16:42:55-16:44:44;
- teardown "verified gone" at 16:45:06.

Up 18 min, 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour. At 16:45:19 the server and primary-ip lists were empty; the only SSH key was the human's unlabelled one.

**Results.** All three runs: `pass: true`, `gateValid: true`, `weakenedParams: []`, no notGate reasons, no kicks. Also in all three:
- seed `1880465901402976865`;
- `loginRetry` `{retried: false}`;
- `botStoppedByRunner: true` (128, SIGTERM);
- remap line `applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped`;
- no movement-guard line, and no `movement_trace` in any capture.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | **PASS** | Cube centre -45 66 -66: teleport confirmed, checked position -44.5 66 -65.5, landing offset 0 (first spawn -51.5 65 -63.5). 50 types. `blocks_confirmed` 150/150, `metaDrift` 0 of 150, `worldChanges` none. Spot check 40 of 40 non-air in 72 positions, 0 unloaded, no skew. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 modded. Replaced 1 of 12 (`charm:spectre` vanished). |
| `g2-items-roundtrip` | **PASS** | 643/643 table; 30/30 read, named and round-tripped. Joined at the batch 7 kick spot and stayed connected. |

- **Double plants and Dynamic Trees (blocks):**
  - census: `minecraft:double_plant 10` (upper halves) 23 blocks, `double_plant 3` 23 blocks, and 31 Dynamic Trees types;
  - samples: 3 upper-half and 3 meta-3 double plants, plus 93 Dynamic Trees samples, **all server-confirmed**.

**Evidence:** `test/evidence/g2/batch8-20261102/` (this PR). Every file came out of the merged tool; no hand edits. The CI leak check passes. Raw files, including all three captures: `captures/raw/batch8-20261102/`.

### G2 batch 7 (2026-11-02): FAIL (blocks PASS, mobs PASS, items FAIL: kicked for an invalid move packet); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 15:11 UTC (relayed by the human).
- **Code:** a clean detached checkout of develop at 1bd66cd (#84, #85, #92), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create (15:13 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: exit 0, output discarded.
  - The preflight on its own: cadence path; no servers or Primary IPs.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. Then the runner's commands, including `tp <bot> -45 66 -66`.

**Real times (UTC):**
- start 15:14:02, created 15:14:26, ready 15:17:32;
- blocks 15:17:40-15:28:28, mobs 15:28:31-15:31:12, items 15:31:15-15:34:52;
- teardown "verified gone" at 15:35:15.

Up 21 min, 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour. At 15:35:22 the server and primary-ip lists were empty; the only SSH key was the human's unlabelled one.

**Results.** Seed `1880465901402976865` and `loginRetry` `{retried: false}` in all three runs. The remap line was the same in all three: `applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | **PASS**, gate-valid | Cube centre -45 66 -66: teleport confirmed, checked position -44.5 66 -65.5 (first spawn -43.5 66 -66.5). 50 types. `blocks_confirmed` 150/150, `metaDrift` 0 of 150, `worldChanges` none. Spot check 40 of 40 non-air in 80 positions, 0 unloaded, no skew. Runner-stopped (128, SIGTERM). |
| `g2-mobs-named` | **PASS**, gate-valid | 12/12 named and confirmed by run tag, 7 modded. Replaced 1 of 12 (`charm:spectre` vanished). Runner-stopped. |
| `g2-items-roundtrip` | **FAIL** (gate-valid parameters) | `items_table` 643/643 and `login_online` PASS. Kicked at 15:31:26, 2 s after the join: server "Invalid move player packet received", client `multiplayer.disconnect.invalid_player_movement`. So `items_read`, `items_named` and `items_roundtrip` got no reply (FAIL). Driver exit 1, not runner-stopped. |

- **Double plants and Dynamic Trees (blocks):**
  - census: `minecraft:double_plant 10` (upper halves) 20 blocks, `double_plant 3` 20 blocks, and 33 Dynamic Trees types;
  - samples: 3 upper-half and 3 meta-3 double plants, plus 99 Dynamic Trees samples, **all server-confirmed**.
- **The kick:** the mobs session had joined at the same position (-44.5 66 -65.5, on dirt) and played normally. The capture has no client position packets, so it cannot show the bad packet itself. Raw capture: `captures/raw/batch7-20261102/FRCFLD-2026-11-02T15-31-20-713Z.jsonl`.

**Evidence:** `test/evidence/g2/batch7-20261102/` (#93). Every file came out of the merged tool; no hand edits. The CI leak check passes. Raw files: `captures/raw/batch7-20261102/`.

### G2 batch 6 (2026-11-02): FAIL (blocks timed out in its spot check; batch stopped); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 13:41 UTC (relayed by the human).
- **Code:** a clean detached checkout of develop at 2de68ec (#84, #85), after `npm ci` (all patches applied). 0 changes in `git status`.
- **Checks right before the create (13:52 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: exit 0; its output was discarded.
  - The preflight on its own: cadence path, 3 dispatch runs; no servers or Primary IPs in the project.
- **Command:** the planned one, unchanged, with `--seed 1880465901402976865`.
- **Console:** `gamerule doDaylightCycle false` once, then `time set day` before blocks and before mobs. Then the runner's commands.

**Real times (UTC):**
- start 13:53:11, created 13:53:32, ready 13:56:05;
- blocks 13:56:12 until the timeout kill at 14:11:12;
- mobs 14:11:15, stopped by me at 14:12:02 after its login (logs fetched by hand at 14:11:51 first);
- teardown "verified gone" at 14:12:17.

Up 18 min, 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour. At 14:12:33 the server and primary-ip lists were empty; the only SSH key was the human's unlabelled one.

**Results**
- **World seed** `1880465901402976865` (the planned world) in both sessions. **Remap line:** `applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped` (#84 works: batch 5 skipped 124).
- **Blocks:**
  - `login_online` PASS;
  - `blocks_named` PASS: 50 of 87 non-air types; air 32360 of 35937; 0 unloaded;
  - `blocks_confirmed` PASS: **150/150**, including the 38 Dynamic Trees types in the top 50, all server-confirmed;
  - `blocks_spotcheck` not reached; no `result.json` (so no `metaDrift`, `worldChanges` or `botStoppedByRunner` fields).
  - 342 `testforblock` confirmations and no mismatch.
- **Double plants:** none in the top 50, the samples or any spot answer.
- **Why blocks ran out of time:**
  - The bot spawned on a Dynamic Trees canopy (y 83, standing on `dynamictrees:leaves0`); batch 4's centre in the same world was -45 66 -66, on the ground.
  - The cube was therefore 90% air. The spot loop needs 40 confirmed non-air answers, and at about 18.5 s per batch of 8 it had 17 non-air of 192 positions after 7.4 min.
  - Reaching 40 needs about 400 positions (the `spotMaxPositions` cap), about 15 min more.
- **Mobs:** login PASS; stopped before any summon. **Items:** did not run.

**Evidence:** `test/evidence/g2/batch6-20261102/` (#88), redacted with the merged tool, plus one manual redaction (the server address in `run.log`; since #92 the tool gives the same file). The CI leak check passes. Raw files: `captures/raw/batch6-20261102/`.

### G2 batch 5 (2026-11-02): PASS (blocks, mobs and items all PASS, gate-valid); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 02:59 UTC.
- **Code:** a clean detached checkout of develop at 01a8193 (#79-#82), after `npm ci`, which applied #81's prismarine-chunk patch. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: cadence path, 4 dispatch runs; no leftovers.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario: 4 lines, in the raw `latest.log` only. Then the runner's commands. No difficulty change.
- **Raw files:** batch 4's are in `captures/raw/batch4-20261102/`, including the capture net-forge used.

**Real times (UTC, 2026-11-02)**

| Event | Time |
| --- | --- |
| Batch start | 03:01:57 |
| Server created | 03:02:06 |
| Ready | 03:05:09 |
| `g2-blocks-named` | 03:05:15 to 03:11:52 (394 s) |
| `g2-mobs-named` | 03:11:55 to 03:14:44 (166 s) |
| `g2-items-roundtrip` | 03:14:47 to 03:16:41 (112 s) |
| EXIT-trap teardown | started 03:16:50; "verified gone" 03:17:05 |

- **Server up:** 15 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 03:17:20 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `pass: true`, `gateValid: true`, `weakenedParams: []`, no `notGate` reasons, no kicks, and `notes.loginRetry` `{retried: false}`. The driver's remap line at login was the same in all three: `state-id remap active: 382 state ids in 94 of the table's 132 blocks`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | **PASS** | 20 non-air types; census sum 16706 + air 19231 + unloaded 0 = 35937. `blocks_confirmed` 50/50; `worldChanges` none; `metaDrift` 0 of 50. `blocks_spotcheck` 41 of 40, 80 positions, 0 unloaded, no skew; every spot hit is a census type. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 of them modded. **Replaced 1 of 12:** `charm:spectre` vanished, replaced by `quark:stoneling`. |
| `g2-items-roundtrip` | **PASS** | 643/643 table entries; 30/30 read, named and round-tripped. |

**Caveats and notes**
- **The double-plant case was not exercised.** The spawn cube (centre -703 65 -210, world seed 8796110535854059511) has sedimentary stone, sand, water and sandstone, and no double plants or Dynamic Trees blocks.
  - The remap is active in all three sessions, and its `minecraft:double_plant` entries (upper-half ids map to meta 10) were not skipped.
  - The 124 skipped entries are all modded blocks, skipped by forge-bridge as "cycle" (e.g. `animania:block_trough`, `artisanworkstumps:*`). None of them is in this cube.
  - The lead decides whether G2 needs a double-plant world.
- **A server-side error, not caused by the bot:** at 03:06:23 (during blocks), `[File IO Thread/ERROR] [Universal Tweaks]: Failed to save chunk` with a NullPointerException in NBT writing. It is a pack-side save error; all checks used the live world. Worth knowing for the live server.

**Evidence:** `test/evidence/g2/batch5-20261102/` (#83), redacted with the merged tool; the CI leak check passes.

### G2 batch 4 (2026-11-02): FAIL (blocks 147/150, mobs PASS, items PASS); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 01:11 UTC.
- **Code:** a clean detached checkout of develop at 3102f6c (#72-#77), after `npm ci`, which applied #74's prismarine-auth patch. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: a scheduled sweeper run 21 min old; no leftovers.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario: 4 lines, in the raw `latest.log` only. Then the runner's commands. No difficulty change.
- **Batch 3 raw files** were moved to `captures/raw/batch3-20261102/` first.

**Real times (UTC, 2026-11-02)**

| Event | Time |
| --- | --- |
| Batch start | 01:13:26 |
| Server created | 01:13:32 |
| Ready | 01:16:37 |
| `g2-blocks-named` | 01:16:43 to 01:27:45 (660 s) |
| `g2-mobs-named` | 01:27:48 to 01:30:39 (168 s) |
| `g2-items-roundtrip` | 01:30:42 to 01:32:38 (113 s) |
| EXIT-trap teardown | started 01:32:48; "verified gone" 01:33:04 |

- **Server up:** 20 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 01:33:44 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons, no kicks, and `notes.loginRetry` `{retried: false}`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | FAIL | 50 non-air types. `blocks_confirmed` **147/150**; `worldChanges` none; `metaDrift` 0 of 147. `blocks_spotcheck` PASS: 43 of 40 non-air, 72 positions, 0 unloaded, no skew. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 of them modded. **Replaced 1 of 12:** `charm:spectre` vanished, replaced by `quark:stoneling`. |
| `g2-items-roundtrip` | **PASS** | 643/643 table entries; 30/30 read, named and round-tripped. |

**The 3 failures: double plant upper halves (needs an owner).**
- All three failures are double plant upper halves in chunk (-3, -4): -44,67,-58; -38,70,-50; -36,71,-50.
- At each, the bot's census and fresh answers say `minecraft:double_plant 11`, and the server says data value 10.
- The census has `double_plant 11` (24 blocks) and no `double_plant 10`. The lower halves (`double_plant 3`) were confirmed 3/3.
- In 1.12 an upper half's meta is `8 | facing.getHorizontalIndex()`, and a generated plant gets the default NORTH (= 10). So the server's 10 is the expected value, and the bot's 11 suggests its decode of this block state differs (unverified).
- **Data for whoever takes it:** the blocks session's forge-bridge capture holds the `map_chunk` for chunk (-3, -4). It is in `captures/raw/` on this PC and not committed. Decoding it offline shows whether the server sent 10 (a client-side decode bug) or 11 (a server-side mismatch between the chunk and `testforblock`).

**Not related:** three `betterwithmods` `[EXPLOSION]` lines at (118, 6, -216), about 160 blocks away and underground, at 01:18. The `lost connection: Disconnected` at 01:30:36 is the driver's own quit.

**Evidence:** `test/evidence/g2/batch4-20261102/` (#78), redacted with the merged tool; the CI leak check passes.

### G2 batch 3 (2026-11-02): FAIL (blocks 110/111, mobs PASS, items PASS); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 00:26 UTC.
- **Code:** a clean detached checkout of develop at 1a396f5 (#72, #73), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: cadence path, gaps 15.4 and 14.5 min; no leftovers.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. That is 4 lines in the raw `latest.log` only, since the committed excerpts start at each marker. Then the runner's commands. No difficulty change.
- **Batch 2 raw files** were moved to `captures/raw/batch2-20261101/` first.

**Real times (UTC, 2026-11-02)**

| Event | Time |
| --- | --- |
| Batch start | 00:28:34 |
| Server created | 00:28:44 |
| Ready | 00:31:49 |
| `g2-blocks-named` | 00:31:55 to 00:41:50 (592 s) |
| `g2-mobs-named` | 00:41:53 to 00:44:09 (133 s) |
| `g2-items-roundtrip` | 00:44:12 to 00:46:06 (112 s) |
| EXIT-trap teardown | started 00:46:14; "verified gone" 00:46:30 |

- **Server up:** 18 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 00:46:47 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons, no kicks, and `notes.loginRetry` `{retried: false}`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | FAIL | 39 non-air types. `blocks_confirmed` **110/111**; `metaDrift` 0 of 110. `blocks_spotcheck` PASS: 40/40 non-air, 88 positions asked, 0 unloaded, no skew. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 of them modded. 0 replaced. `otherSeen`: one natural `primitivemobs:grovesprite`. |
| `g2-items-roundtrip` | **PASS** | 643/643 table entries; 30/30 read, named and round-tripped. |

**The failed sample.** `-56,95,-58 census biomesoplenty:plant_0 0 fresh minecraft:air 0 server found: FAIL`.
- The census (about 00:33) named a plant there.
- At the re-ask (00:33-00:38) the bot said air, and the server confirmed air.
- The bot was right both times; the plant was gone. The #67 rule (fresh name must equal the census name) fails it.
- Why the plant went is not logged. A mob, or a neighbouring block change that pops a plant, could do it.
- The 11 other `plant_0` samples were confirmed.

**Proposal (the lead decides).** Like the mob replacements, a sample whose block **changed name** since the census becomes a world change, provided the server confirms the bot's fresh answer **exactly**. In that case:
- it is recorded in `notes.worldChanged`;
- it is replaced by another candidate of the same census type (5 unpicked candidates per type remain), which must pass the full rule;
- more than 2% of samples (3 of 150) changed makes the run notGate.

Nothing is tolerated on naming: each counted sample still needs census name = fresh name = the server's answer. The alternative is to keep the rule as it is and re-run: this happened to 1 of 111 samples.

**Evidence:** `test/evidence/g2/batch3-20261102/` (#76), redacted with the merged tool; the CI leak check passes.

### G2 batch 2 (2026-11-01): FAIL (mobs PASS, items PASS, blocks did not run); the server is deleted

**Run conditions**
- **GO:** the lead, 23:28 UTC.
- **Code:** a clean detached checkout of develop at 53a1d5e, after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: cadence path, 3 dispatch runs, gaps 15.4 and 14.5 min; no leftovers.
- **Command:** the planned one, unchanged. No `--skip-sweeper-check`.
- **Console:** `gamerule doDaylightCycle false` once, `time set day` before each scenario (3 lines in the raw `latest.log` in `captures/raw/`; the committed `server.log` excerpts start at each scenario's marker, so they do not show them), then the runner's scenario commands. No difficulty change; nothing on the live server.
- **Batch 1 raw files** were moved to `captures/raw/batch1-20261101/` first.

**Real times (UTC)**

| Event | Time |
| --- | --- |
| Batch start | 23:31:00 |
| Server created | 23:31:07 |
| Ready | 23:34:14 |
| `g2-blocks-named` | 23:34:20 to 23:34:41 (19 s) |
| `g2-mobs-named` | 23:34:44 to 23:37:36 (169 s) |
| `g2-items-roundtrip` | 23:37:39 to 23:39:34 (112 s) |
| EXIT-trap teardown | started 23:39:44; "verified gone" 23:39:57 |

- **Server up:** 9 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 23:40:12 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons and no kicks.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-mobs-named` | **PASS** | 12/12 named, 12/12 confirmed by run tag, 7 of them modded. **Replaced 1 of 12** (cap 3): `charm:spectre` vanished, replaced by `quark:stoneling`. `otherSeen` is empty; no placeholder names. |
| `g2-items-roundtrip` | **PASS** | `items_table` 643/643; `items_read`, `items_named` and `items_roundtrip` 30/30 each. |
| `g2-blocks-named` | FAIL | `login_online` FAIL ("driver exited with code 0 before joining"); the other three checks not reached. No census, so no `metaDrift` or samples. |

**Why blocks did not run.** `driver.log`: `Failed to obtain profile data for FRCFLD, does the account own minecraft?` (minecraft-protocol `microsoftAuth.js:31`), 1 s after the driver started.
- prismarine-auth swallows any error from the profile fetch (`fetchProfile(...).catch(debug)`), and minecraft-protocol then throws this generic message, so the real cause is not logged.
- It was transient: the same cache passed `--check` at about 23:30 and logged in normally for mobs (23:34:52) and items (23:37:46).
- The server log shows no join attempt for the blocks session.
- Not to be investigated with `DEBUG=prismarine-auth`: that prints tokens.

**Proposals (the lead decides):**
1. **Batch 3, blocks only:** the same command with only the `g2-blocks-named` line, on a new written GO. About 15 min and EUR 0.14.
2. **One login retry in the runner** (`test/runner/lib/session.mjs`, mine): if the driver exits before joining with exactly this profile-fetch error, start it once more and record the retry in notes. `login_online` would still pass only if the bot joins. This would hide a single transient failure, so it needs your approval.
3. **net-forge:** log the profile fetch's HTTP status (no tokens, no body), so the next failure says why.

**Whether G2 can combine batches is your call:** mobs and items from batch 2 plus blocks from a batch 3, or all three in one batch.

**Evidence:** `test/evidence/g2/batch2-20261101/` (#71), redacted with the merged tool; the CI leak check passes.

### G2 batch 1 (2026-11-01): FAIL; the server is deleted

**Run conditions**
- **GO:** the lead, 22:03 UTC.
- **Code:** a clean detached checkout of develop at 36d7ee8, after `npm ci`. All three `result.json` show `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: `wired: true`, all 643 entries round-trip.
  - `msa-login FRCFLD --check`: OK. Its output is not recorded.
  - The preflight on its own (`up --dry-run`): sweeper OK via path (a), a scheduled run 54 min old; no leftover labelled resources.
- **Command:** the planned one, unchanged (one CPX42, nbg1, `--ttl-hours 2`). No `--skip-sweeper-check`.
- **Console:** only `time set day` and `gamerule doDaylightCycle false`, plus the runner's scenario commands. Nothing on the live server.

**Real times (UTC)**

| Event | Time |
| --- | --- |
| Batch start | 22:10:12 |
| Server created | 22:10:20 |
| Ready | 22:13:02 |
| `g2-blocks-named` | 22:13:10 to 22:20:18 (425 s) |
| `g2-mobs-named` | 22:20:18 to 22:22:07 (106 s) |
| `g2-items-roundtrip` | 22:22:07 to 22:23:58 (108 s) |
| EXIT-trap teardown | started 22:24:07; "verified gone" 22:24:20 |

- **Server up:** 14 min (plan about 37, hard stop 56).
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 22:24:37 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results** (`captures/raw/g2-*/result.json`). Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons and no kicks.

| Scenario | Verdict | Checks |
| --- | --- | --- |
| `g2-items-roundtrip` | **PASS** | all 5 passed. `items_table`: 643/643. `items_read`, `items_named`, `items_roundtrip`: 30/30. |
| `g2-blocks-named` | FAIL | `login_online` and `blocks_named` passed (50 non-air types). `blocks_confirmed` failed (0/150). `blocks_spotcheck` failed (0 of 40; it stopped after 16 positions and 10 failures). |
| `g2-mobs-named` | FAIL | `login_online` passed. `mobs_named` failed (9/12). `mobs_confirmed` failed (10/12). |

**Findings**
1. **Parser bug, fixed in #64.** The server prints `Successfully found the block at -38, 72, -58`: commas with spaces, no full stop. The parser expected the lang form `x,y,z.`, so every confirmation counted as a failure. This was a false fail, never a false pass. The server log has 158 success lines out of 166 `testforblock` calls.
2. **Dynamic Trees state drift** (needs a decision). The other 8 replies were `had the data value of N (expected: M)`, all on `dynamictrees`/`dynamictreesbop` leaves and branches.
   - In every case the name was right; only the meta differed (for example 14 against 6, the 8 bit).
   - These blocks change state over time, and the samples were checked 2-5 min after the census.
   - So even with #64, `blocks_confirmed` would be 142/150 and still fail under the exact rule.
   - **Proposal:** re-ask the bot for each sample position right before its `testforblock`, and require (a) the fresh answer to equal the server exactly and (b) the fresh name to equal the census name. Every verdict stays the server's, comparing the same moment.
3. **Vanilla animals that can't exist in RotN** (needs a decision). The server refused to summon `minecraft:chicken` and `minecraft:pig` (`Unable to summon object`); Animania probably replaces vanilla animals as they join. They come from `common-mobs.json` (rotn-data, built from spawn lists). **Proposal:** either rotn-data drops mobs that can't be summoned, or the scenario replaces a refused summon with the next mob in rank and notes it. A refusal is the server's, not the bot's.
4. **`charm:spectre`** (needs a decision). It was summoned but was gone before the bot looked (`kill` didn't find it either). It probably vanishes in daylight. **Proposal:** right before asking the bot, `testfor` each summoned entity; any the server no longer has are replaced and noted, and the bot must report all the rest.
5. **`mobs_confirmed` checked ambient mobs** (needs a decision). It ran `testfor` on every entity the bot reported, including two untagged, never-summoned Animania animals (`cow_angus`, `calf_angus`) that had walked out of the 3-block radius by then. **Proposal:** confirm only the summoned, run-tagged entities (`@e[tag=<run tag>,type=...]`); other reports go to notes.
6. **Time Shall Not Pass re-enables the daylight cycle on each player connect** (FYI). It logged "Daylight Cycle Module: The daylight cycle has been enabled" at each join, so `gamerule doDaylightCycle false` did not hold. **Proposal:** approve `time set day` before each scenario for the re-run (test server only).
7. **A pack mod runs commands as the player on join** (FYI, not ours). The log shows `[FRCFLD: Game rule commandBlockOutput/sendCommandFeedback has been updated to false]`, and on the first join also `Given [Bread]` / `Given [Bundle]`. `git grep` finds neither gamerule in this repo. The runner's console replies were unaffected.

**Evidence:** raw output is in `captures/raw/g2*` (git-ignored). The redacted `test/evidence/g2/` comes in the evidence PR.

## Planned real batches

### CX23 first run (the plan; nothing touches the CX23 until the lead's written GO for each step)

The CX23 is the bot's own VPS, reachable as the Orca SSH target **`cx23`** (root, by an SSH key on this PC that the human added). After the bootstrap, the human replaces it with **`cx23-deploy`** (H3). It is not the live server, which stays off-limits.

**The human's decisions on #101:**
- no lockdown;
- the target swap instead;
- only the test OpenRouter key for now (USD 5);
- the first CX23 start joins a disposable test server, with the CX23's IP supplied by the human at that GO.

**Ground rules:**
- I never read, print or copy the key or Orca's SSH settings, and I never run `ssh` or `scp` myself.
- Commands go through an Orca terminal on the SSH target: a folder workspace on that host, which is Orca metadata only, and `orca terminal create/send/read`.
  - Root work (GO 1, GO 2) goes through `cx23` before the human's target swap (H3).
  - Everything after goes only through `cx23-deploy`.
- The server's IP address appears nowhere in the repo or STATUS; I use the name `cx23`.
- Raw output stays in `captures/raw/cx23/` (git-ignored). Anything committed goes through `test/tools/redact-evidence.mjs` and the CI leak check, plus a manual read before the PR.

#### Step 1: a read-only probe (GO 1)

- **No installs and no changes.** No `apt update` (it writes package lists), no file writes, no service changes. Each command only reads.
- **The commands:**
  - **OS and hardware:** `cat /etc/os-release`, `uname -r`, `nproc`, `lscpu | head -20`, `free -m`, `swapon --show`, `df -h /`, `lsblk -o NAME,SIZE,TYPE,MOUNTPOINT`, `timedatectl`.
  - **Network (no addresses needed):** `ss -tulpn` (listening sockets), `ufw status verbose`, `nft list ruleset | head -50`.
  - **SSH config, effective:** `sshd -T | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers|kbdinteractiveauthentication) '`.
  - **Users:** `getent passwd | awk -F: '$3==0 || $3>=1000'` (names, uids and shells only), `ls -ld /home/*`, `ls -l /etc/sudoers.d`.
  - **Services:** `systemctl list-units --type=service --state=running --no-pager`, `systemctl list-unit-files --state=enabled --no-pager`.
  - **Packages:** `dpkg -l nodejs git unattended-upgrades ufw 2>/dev/null | tail -n +6`, `command -v node git`, `cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null`.
  - **Our footprint (expected: none):** `ls -ld /opt/mindcraft-rotn /var/lib/mindcraft-rotn /etc/mindcraft-rotn 2>&1`, `id deploy mindcraft-rotn 2>&1`.
- **Not read:** `authorized_keys`, `/etc/shadow`, environment variables, shell history, `ip addr` (MAC and public addresses).
- **Output:** saved from `orca terminal read` to `captures/raw/cx23/probe-<date>.txt`. Then redacted with the tool into `test/evidence/cx23/probe-<date>.txt`: every IPv4 and IPv6 address becomes `<ip>`, and local paths become `<local>`. The hostname stays only if it does not contain the IP.
- **Then a short findings note in STATUS:** Ubuntu version, RAM and swap, what `setup` will change, and anything unexpected (other users, open ports, running services).

#### Step 2: the bootstrap (GO 2, through `cx23` as root, after the probe and H1; then the human's H2 and H3)

**What `deploy/cx23/bootstrap.sh setup` does** (README "One-time bootstrap"; tested offline in `test/unit/cx23.test.js`, plus shellcheck and `systemd-analyze verify` in CI):
- **Users:**
  - `deploy`: key login only, groups `sudo` and `mindcraft-rotn`;
  - system user `mindcraft-rotn`: no login, home `/var/lib/mindcraft-rotn`. The bot runs as this user.
- **Updates and resources:** unattended **security** upgrades (`20auto-upgrades`); a 2 GB `/swapfile` with `vm.swappiness=10` if no swap exists.
- **Firewall:** ufw denies all incoming except SSH (it allows SSH before enabling ufw, so the session survives). The bot needs no inbound port, and the MindServer UI binds to localhost only.
- **Node 22** from NodeSource's apt repo, with the repo key's fingerprint pinned (`6F71F525...BE0B4`; setup refuses on a mismatch), then git.
- **Installed:**
  - the unit template `mindcraft-rotn@.service`;
  - `/usr/local/lib/mindcraft-rotn/check-env-names` and `check-env` (+ `check-env.mjs`);
  - `/usr/local/sbin/mindcraft-rotn-ctl`;
  - a sudoers rule, checked with `visudo -c`, that lets `deploy` run only `mindcraft-rotn-ctl` without a password.
- **Folders:** `/opt/mindcraft-rotn` (`deploy:mindcraft-rotn` 0750), `/var/lib/mindcraft-rotn`, `/etc/mindcraft-rotn` (`root:mindcraft-rotn` 0750).

**How the unit starts a bot** (`mindcraft-rotn@frcfld`):
1. `ExecStartPre=+check-env-names` runs **as root**. It reads only `/etc/mindcraft-rotn/frcfld.env` (`root:root` 0600), and every line must be a comment, blank, or `NAME=value` with an allowlisted NAME. It prints names and line numbers, never values.
2. `ExecStartPre=check-env` runs as the bot user. It checks the **effective** environment the way `main.js` reads it:
   - it refuses `INSECURE_CODING` and `BLOCKED_ACTIONS` if set at all;
   - `SETTINGS_JSON` may hold only `auth`, `host`, `port` and `auto_open_ui`;
   - it refuses a `DEBUG` that would print tokens;
   - it refuses loader, proxy and TLS-override variables;
   - the token cache folder must exist, be 0700 and be owned by `mindcraft-rotn`;
   - the OpenRouter key must be set and not the placeholder.
3. `ExecStart` runs `node main.js` in the current release.
   - `MINDCRAFT_SINGLE_BOT_SERVICE=1`, so a clean stop exits 0. `Restart=always` with `RestartPreventExitStatus=0 3`: no restart after a clean stop or a fatal kick. `StartLimitBurst=6` per 10 min.
   - `UMask=0077`; memory caps `MemoryHigh=1G` and `MemoryMax=1536M`, to confirm in the soak.

**No lockdown (the human's decision on #101).** Root SSH stays enabled on the CX23. `bootstrap.sh lockdown` stays in the repo but is not run. Instead, the human swaps the Orca targets: after the bootstrap, a new target for `deploy` comes in, and the root target `cx23` is **removed** from Orca. So everything that needs root (GO 1 and GO 2) runs through `cx23` **before** the swap, and afterwards agents work **only** through the `deploy` target.

**The order** (each line run by me through the named Orca target unless marked **human**):
1. **GO 1, through `cx23` (root):** the read-only probe (Step 1).
2. **Human (H1):** the `deploy` public key file on the CX23 (see H1). Agents never see the private key.
3. **GO 2, through `cx23` (root)**, in one sitting:
   1. Get the bootstrap files without copying from this PC: `git clone --depth 1 --branch <tag> https://github.com/JQDAW/mindcraft-RotN /root/mindcraft-rotn-src` (the repo is public).
      - The tag is one the lead creates on develop. I check `git rev-parse HEAD` against the tag's SHA before running anything from it.
      - If git is missing on the image (the probe shows this), the human copies the folder instead.
   2. `bash /root/mindcraft-rotn-src/deploy/cx23/bootstrap.sh setup --deploy-key-file /root/deploy.pub`. No `--ssh-from`: SSH stays open to key logins, and the narrowing is for later, if the lead wants it.
   3. `bash /root/mindcraft-rotn-src/deploy/cx23/bootstrap.sh add-bot frcfld`. It creates `/var/lib/mindcraft-rotn/frcfld/msa` (0700, `mindcraft-rotn`) and `/etc/mindcraft-rotn/frcfld.env` (`root:root` 0600, from `bot.env.example`, with placeholders). It never overwrites an existing file.
   4. Read-only checks as root while I still can:
      - `systemctl cat mindcraft-rotn@frcfld`;
      - `ufw status verbose`;
      - `visudo -c`;
      - `stat -c '%U:%G %a %n'` on `/etc/mindcraft-rotn/frcfld.env` and `/var/lib/mindcraft-rotn/frcfld/msa`;
      - `node -v`.
      - Then I report "GO 2 done" and stop using `cx23`.
4. **Human (H2):** `passwd deploy` in a terminal the human opens as root. This is `deploy`'s own sudo password, which the human needs for H4 and H5.
5. **Human (H3), the target swap:**
   - add the Orca SSH target **`cx23-deploy`** (user `deploy`, the H1 key) and connect once;
   - **remove** the root target `cx23` from Orca;
   - tell the lead.
   - From here on, agents use only `cx23-deploy`. My first action there is a read-only `whoami && id`.
6. **The first release, as `deploy`** (GO 3, through `cx23-deploy`). `/root` is 0700, so `deploy` uses its own copy of the public repo:
   - `git clone --depth 1 --branch <tag> https://github.com/JQDAW/mindcraft-RotN ~/deploy-src`, with the same SHA check;
   - then `bash ~/deploy-src/deploy/cx23/deploy.sh deploy <tag>`. Its paths are fixed under `/opt/mindcraft-rotn`. It makes a bare clone, runs `git archive` of the tag (refusing a tag not on develop) and `npm ci`, and refuses a release whose `settings.js` does not evaluate to `allow_insecure_coding === false`.
   - No bot is enabled yet, so nothing starts.
   - Then `sudo -n mindcraft-rotn-ctl status frcfld` (allowed without a password).
7. **Human, later (H4 and H5):** the bot's long-term OpenRouter key into the env file (H4), and the bot's Microsoft login (H5).
   - The first start needs both: `check-env` refuses a placeholder key, and the bot cannot join without a token cache.
   - The human decided that for now there is only the test key (Requests item 12, for the PC), so the CX23's first start waits for H4.
8. **The first start (its own GO):** it joins a **disposable test server**, never the live one.
   - The human gives the CX23's IPv4 address in that GO message (H6; agents do not look it up). I pass it only on the command line as `deploy/test-server.sh run --allow-from <it>/32`, plus this PC. It never goes into the repo or STATUS, and evidence goes through the redaction tool.
   - Then `sudo -n mindcraft-rotn-ctl enable frcfld` and `start frcfld`, and the journal is watched for `check-env` results and the login. The server is deleted afterwards as in every batch.

**Secrets never pass through chat, git or an agent-read terminal:**
- **Who types them:** the human types the deploy password (H2), the OpenRouter key (H4) and the Microsoft code (H5) in a terminal tab the human opens and titles `HUMAN ONLY`.
- **What protects that tab:** agreement plus order, not a technical barrier.
  - Orca would let an agent read any terminal, so agents agree never to `terminal read` (or list the output of) a tab titled `HUMAN ONLY`.
  - The human does these steps only when no agent step on the CX23 is in progress, and closes the tab afterwards.
- The Microsoft device code lasts minutes.
- The token cache stays in `/var/lib/mindcraft-rotn/frcfld/msa` (0700, `mindcraft-rotn`). No agent reads it, and `check-env` prints no values.

**Undo:**
- Root SSH stays on, so the human can revert anything.
- Through `deploy`, agents can stop and disable the unit (`mindcraft-rotn-ctl stop|disable`) and roll back a release (`deploy.sh rollback`).
- `setup` and `add-bot` are safe to re-run.

**Time and cost:** the CX23 is already paid monthly (about EUR 6.81). The probe takes about 5 min; the bootstrap about 15 min; the first deploy about 15-30 min, mostly `npm ci`.

### G3 batches (the plan; lead, 2026-11-02 after G2 PASSED. Nothing paid without the lead's written GO.)

**Goal:** G3 gate evidence for the three PLAN items:
- rocks to stone tools on a fresh spawn;
- survive the first night;
- a task preempts the agenda, which then resumes.

The brief adds "the queue survives a restart": offline in G3, real on the CX23 in G4 (lead, #101).

**Same rules as G2.**
- The server is the arbiter: every pass condition is read from the server log or the console, never from the bot's own word.
- Gate parameters ('min' or 'equal'); a weakened run is never a gate pass.
- The world seed is recorded and checked; `git.dirty: false`.
- One batch must pass all scenarios on one SHA.
- Evidence goes only through `test/tools/redact-evidence.mjs`, with the CI leak check.
- Unit tests on a simulated server first, offline. Every new console command needs the lead's approval (listed below).

**What changes from G2: the real agent.** The bot under test is the real Mindcraft agent (`main.js` with skills-rotn's profile, agenda and task queue), talking to OpenRouter, not `g1-driver.mjs` alone. So:
- runs are slower and not deterministic;
- each batch has an LLM cost on top of the server;
- the runner never gives hints the human player would not. It whispers only what a task giver would type.

#### World and start state

- **A fresh spawn:** a new test server per batch, so the bot's player data is new. It holds only RotN's start kit (Scroll of New Life, Bundle, bread). At the start the runner confirms with `clear` in test mode (below) that the bot has none of the target items.
- **The world:** a fixed seed, as in G2. Candidates:
  - (a) the G2 world `1880465901402976865`: a forest at spawn, and trees are certain. Rock piles were not in its top-50 census, so their density is unknown.
  - (b) batch 5's world `8796110535854059511`: had `pyrotech:rock` piles (metas 6 and 8) in its spawn cube, so **rocks do generate in the Overworld**, against `rotn-progression.md`'s config reading. But it had no trees in the cube.
  - **Proposal:** decide with survey batch S1 (below), which measures rock piles, trees and exposed stone within 48 blocks of spawn in both worlds.
- **Spawn stone is Underground Biomes stone** (`undergroundbiomes:*_stone` in every G2 census), not `minecraft:stone`. Its rocks are UB rock variants, so "4 rocks to cobblestone" may not give `minecraft:cobblestone`. The scenarios take the accepted outputs from rotn-data's recipe table (every output of a 4-same-rocks recipe), not from a hard-coded name.
- **Difficulty:** the server default (no peaceful), daylight cycle on. `time set day` is used only where a scenario says so.

#### Server-side arbiters (no op mods; 1.12 vanilla commands)

1. **Inventory:** `clear <bot> <item> <meta> 0` in test mode. A maxCount of 0 removes nothing and prints "<bot> has N items that match the criteria". This is the main pass check: it counts what the bot really holds.
2. **Statistics:** scoreboard objectives on stat criteria.
   - **Gating rule (lead, #101):** `crafted_by_bot` **gates** for every item whose craft statistic S1 shows to exist. The vanilla stone tools and the crafting table certainly have one. For the RotN items (crude axe, Crafting Tools) it gates if S1 finds their stat; otherwise those are recorded only.
   - `stat.craftItem.pyrotech.crude_axe`, `stat.craftItem.minecraft.crafting_table`, `stat.craftItem.minecraft.stone_pickaxe`, `stat.craftItem.minecraft.stone_axe`;
   - `stat.mineBlock.<log blocks>`;
   - `stat.deaths` and `stat.playOneMinute`.
   - Read them with `scoreboard players list <bot>`.
   - They prove that the bot itself crafted, which the inventory alone cannot (the crude axe may be used up by Crafting Tools).
3. **Placed blocks:** `testforblock` (as in G2), for example the placed crafting table that the bot reports.
4. **Position:** none. There is no `tp` in G3 at all (lead, #201 review): even `tp <bot> ~ ~ ~` is a teleport in 1.12.
5. **Life:** the server log's join, leave and death lines for the bot (the vanilla death messages "<bot> was slain by", "<bot> died", and so on, and Corpse Complex's lines), plus `stat.deaths`.
6. **No cheating:** the scenario fails if, during the run:
   - the log shows a `Given [` line or a gamemode change for the bot;
   - the bot runs any command (its chat is never a `/`-command reply);
   - or the bot is op (`ops.json` empty, already true on the test server).
   - The runner itself gives nothing in G3.

**Console commands approved for G3 (lead, #101; test servers only, never the live server):**
- `clear <bot> <item> <meta> 0` (test mode only, never a real clear);
- `scoreboard objectives add|remove` and `scoreboard players list <bot>`;
- `time query daytime`;
- `setblock` **only** for the task marker.

G2's list without `tp` (`say`, `seed`, `tell`, `testforblock`, `testfor`, `time set day`, `gamerule doDaylightCycle`) stays. Not `give`, `summon` or `kill` in G3, except in S1.

**Pinned before any gate batch (lead, #101):** these become gate parameters compared 'equal', fixed after S1 and before the first G3 gate batch.
- the dawn bound for `g3-first-night` (from S1's day/night measurement);
- the task marker's position (a surface block in the chosen world, 20-30 blocks from the spawn area);
- the agenda counter that `agenda_active` and `agenda_resumed` read (a named stat or inventory item, chosen from skills-rotn's agenda).

#### Scenario `g3-rocks-to-stone-tools` (ready-to-try item 4)

- **Run:**
  - Login, then the runner checks the start inventory, then the agent plays its agenda with no runner input.
  - The scenario ends when the agent holds the targets, or at `maxMinutes` (default 25, compared **'equal'**, lead #101: a longer limit would be a weaker run).
- **Checks:**
  - `login_online`.
  - `fresh_start`: none of the target items at the start.
  - `stone_tools`: `clear` test finds at least 1 `minecraft:stone_pickaxe` and 1 `minecraft:stone_axe`.
  - `crafting_table`: one is placed (the bot reports its position; the server's `testforblock` confirms), or at least 1 is held.
  - `cobblestone`: at least 1 of the rotn-data outputs of a 4-rocks recipe is held, or placed and confirmed.
  - `crafted_by_bot` (**gating**, lead #101): the craft statistic is at least 1 for the crafting table and both stone tools, and for the crude axe if S1 shows its stat exists.
  - `no_cheat`.
- **Notes:**
  - minutes to each milestone (from periodic `clear` tests every 60 s);
  - deaths, and a position track every 60 s;
  - **LLM calls and cost for this scenario** (see "LLM spend" below).
- **Not claimed:** logs and planks are not separate checks. The table and the tools prove them, and the planks come from the debark interaction, which no stat counts.

#### Scenario `g3-first-night` (ready-to-try item 5)

- **Run:**
  - Fresh spawn; the runner sets nothing about time, so the bot lives a real first day and night.
  - The scenario ends at the first dawn after a full night, by `time query daytime`, against the **pinned dawn bound** (measured in S1, because Extended Days may change the cycle; `rotn-progression.md` says about 20 min of day in a 40 min cycle).
- **Checks:**
  - `login_online`;
  - `survived_night`: no death line and `stat.deaths` 0 from login to dawn;
  - `stayed_online`: no leave or kick line;
  - `no_cheat`.
- **Decided (lead, #101): survival is the night gate; shelter is evidence.** The shelter data is recorded, not gating:
  - at the middle of the night, the bot's position and `testforblock` results for its 6 neighbours and the block above its head;
  - the bot's hunger at dawn, if the bot reports it.
- **Length:** about 40-50 min. This scenario alone is longer than G2's whole batch.

#### Scenario `g3-task-preempts-agenda` (ready-to-try item 10, task part)

- **Run:**
  - Login; the agent works its agenda for `warmMinutes` (5).
  - Then the test-only task giver `Server` whispers a task with a server-checkable result: "go to the gold block at x y z and stand on it". The runner places the marker with `setblock` (approved for this only) at the **pinned marker position**.
- **Checks:**
  - `agenda_active`: the **pinned agenda counter** rises before the task (the bot is doing its agenda);
  - `task_accepted`: the bot's chat acknowledges the task id within 60 s;
  - `task_done`: the server sees the bot within 1.5 blocks of the marker within `taskMinutes` (5), and the bot reports done;
  - `agenda_resumed`: the pinned counter rises again within 5 min after done;
  - `no_cheat`.
- **Untrusted refusal (item 10's last sentence):** a separate short session, `g3-untrusted-refused`. It uses the production task-giver list, so the console whisperer is not on it. The bot's chat must show a polite refusal, and `!task list` must show no new task.

#### Queue survives a restart (ready-to-try item 11): offline in G3, real in G4 (lead, #101)

- **G3, offline:** a unit test runs the runner's stop and start against the simulated server, with a fake agent that keeps its queue in a file. After the restart, `!task list` in chat must show the same task id and status, and the agenda counter must rise again. No paid batch.
  - skills-rotn's own unit tests cover the real queue file.
- **G4, real:** the same checks on the CX23 with a real service restart (`mindcraft-rotn-ctl restart frcfld`), as part of the G4 acceptance run.

#### Who gives tasks in a test (decided: lead, #101)

The runner can only whisper from the console, which the bot sees as the player `Server`. JQDAW is the human's account, and agents never use it.

**Approved: the console sender `Server` as a test-only task giver, on test servers only, never in production.**
- It is allowed only through the G3 test profile's task-giver override, and recorded in each `result.json`.
- A unit test checks that the production profile's list does not contain `Server`.
- `g3-untrusted-refused` runs with the production list (JQDAW only), so it shows that `Server` is refused there.
- A second Microsoft account as a test task giver is not needed.

#### The G3 driver: the real Mindcraft agent (proposal for skills-rotn, through the lead)

harness-ops writes `test/runner/drivers/mindcraft-driver.mjs` (in `test/`, mine). It keeps the runner's driver contract (`DRIVER.md`):
- **Start:**
  - `node main.js` with `MINDCRAFT_SINGLE_BOT_SERVICE=1`, `PROFILES=["<scenario profile>"]`, `SETTINGS_JSON={"host":..., "port":..., "auth":"microsoft", "auto_open_ui":false}`, a free `MINDSERVER_PORT`, and `MINDCRAFT_PROFILES_FOLDER` (the PC's FRCFLD cache).
  - `OPENROUTER_API_KEY` comes through the runner's `--pass-env` and is never printed.
  - It never sets `INSECURE_CODING` or `BLOCKED_ACTIONS`. The same checks as `deploy/cx23/check-env.mjs` run first.
- **No Mindcraft task files (lead, 2026-11-02).** G3 scenarios never load Mindcraft task files: no `--task_path` or `--task_id`, and nothing from `tasks/`. Task files run op commands (`/give`, `/tp`, ...) regardless of cheat mode; skills-rotn is adding a refusal by default.
  - The driver starts `main.js` with no task arguments, and refuses to start if its arguments or environment carry any.
  - A unit test asserts both.
  - G3 inputs come only as whispers from the test-only task giver `Server`.
- **Stop:** on SIGTERM it stops the agent cleanly. On Windows it kills the whole process tree (`taskkill /T`), because `main.js` starts the agent as a child process, and a hard kill of the parent alone would leave the bot online.
- **Exit codes:** 0, 1 and 3 pass through (ADR 0003 decision 5).

What skills-rotn provides (to agree):
1. **A G3 test profile** (`profiles/`) that is the production profile plus only the task-giver override above, the model, and an LLM budget.
2. **The agenda at a fresh spawn:** the agent starts its RotN early-game agenda by itself on spawn, with no prompt from the runner.
3. **Fixed chat formats** the runner can parse from the server log (`<FRCFLD> ...`). For example:
   - `task <id> accepted: <text>`;
   - `task <id> done` and `task <id> failed: <reason>`;
   - `task refused: <giver> is not a task giver`;
   - `!task list` lines as `task <id> <status> <priority> <giver>`;
   - for the table, `placed crafting_table at x y z`.
4. **Where the queue and agenda files live** (under the bot's folder), so a restart keeps them. The runner reads only chat, never the files.
5. **Exit codes** as in ADR 0003 (already in `agent.js`).

#### Batches (each needs a written GO)

- **S1, survey and smoke (no LLM, `g1-driver.mjs`).** The tooling is in `test/scenarios/s1/` (`s1-site-survey`, `s1-arbiters`, `s1-day-cycle`) and `test/runner/lib/s1.mjs`; see DRIVER.md "S1". It checks:
  - (a) rock piles, trees and stone within 48 blocks of a fresh spawn: a G2 census around the bot (no teleport), radius 48, up to 400 types, with up to 5 positions per group confirmed by `testforblock`;
  - (b) the `clear`-test reply form, and which stat criteria exist (the vanilla ones must; `stat.craftItem.pyrotech.crude_axe` and `contenttweaker.crafting_tools` are the finding);
  - (c) the day length with Extended Days: `time query daytime` every minute for 45 min, with the bot online and the time untouched;
  - (d) whether a console `tell` reaches mineflayer's `whisper` event, the one Mindcraft's agent listens to, and as which sender (`Server` expected). This is checked at the mineflayer level with `g1-driver.mjs`, so no LLM is needed;
  - (e) **no loot containers near the cube** (lead, #101). The check fails closed (#106 review):
    - a type is a container by its registry name, as a vanilla inventory block or spawner, or by its Java class in rotn-data's block dump;
    - without the dump the check fails;
    - every unclassified modded type in the radius is listed for the lead.
    - A looted stone tool would fool the inventory check, and the craft statistics are the second guard.
- **The S1 batches (each needs a written GO; S1 is a survey, so nothing in it is a gate pass):**
  - **S1-A, the G2 world** (`--seed 1880465901402976865`): all three scenarios, the survey first (the fresh spawn).
    ```bash
    deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- bash -c '
      D="node packages/forge-bridge/tools/g1-driver.mjs";
      timeout 15m node test/runner/run.mjs --scenario s1-site-survey --out captures/raw/s1-survey   -- $D; a=$?;
      timeout 10m node test/runner/run.mjs --scenario s1-arbiters    --out captures/raw/s1-arbiters -- $D; b=$?;
      timeout 55m node test/runner/run.mjs --scenario s1-day-cycle   --out captures/raw/s1-day      -- $D; c=$?;
      bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/s1/server;
      echo "survey=$a arbiters=$b day=$c"; [ "$a$b$c" = 444 ]'
    ```
    - **Exit codes:** every S1 run is not gate-valid, so a run whose checks all passed exits **4** ("smoke"), never 0. The batch line checks for 444; 1 means a check failed, and 124 means the timeout hit.
    - **No time or gamerule changes in S1-A:** no `time set`, and no `gamerule` with a value. The day cycle is measured as it really runs.
    - `s1-day-cycle` only **queries** the rule with `gamerule doDaylightCycle` without a value (read-only; 1.12 prints its current value), and records the reply.
    - About 4 min build, 6 min survey, 2 min arbiters, 46 min day cycle: about 60 min, so 1-2 billed hours, about **EUR 0.14-0.28** plus IPv4.
    - Hard stop at 90 min (1.5x).
  - **S1-B, batch 5's world** (`--seed 8796110535854059511`): `s1-site-survey` only, with the same command minus the other two scenarios. About 15 min, 1 billed hour, about **EUR 0.14** plus IPv4. Hard stop at 25 min.
  - **After both:** the evidence goes through the redaction tool into `test/evidence/s1/`, and the findings go into STATUS: the world proposal, the dawn bound, which RotN stats exist (so where `crafted_by_bot` gates), and the whisper sender.
- **G3 batches: the layout (lead, #203 review).** Three batches, each on its own newly built server with its own written GO and its own spend stop (`maxBatchUsd` USD 2). The restart check is offline in G3.
  - **Batch A, `g3-rocks-to-stone-tools` alone,** on a fresh server: it needs FRCFLD's first join on a fresh world. About 25 min plus about 5 min of build: 1 billed hour, about **EUR 0.14** plus IPv4. Hard stop at 45 min.
  - **Batch B, `g3-first-night` alone,** on a fresh server, for the same reason. About 55 min plus the build: 1-2 billed hours, about **EUR 0.14-0.28** plus IPv4. Hard stop at 90 min.
  - **Batch C+D, `g3-task-preempts-agenda` then `g3-untrusted-refused`,** on one server (neither needs a fresh spawn). About 15 + 4 min plus the build: 1 billed hour, about **EUR 0.14** plus IPv4. Hard stop at 45 min.
  - **In all:** 3-4 billed hours, about EUR 0.42-0.56 plus 3 IPv4-hours, plus the LLM spend (at most USD 2 per batch).

#### LLM spend (lead, #101)

- **Per scenario:** `result.json` records the LLM call count and the cost.
  - The calls are counted from the agent's own log lines (one per request to OpenRouter).
  - The cost is the difference in the test key's `usage`, read from OpenRouter's key endpoint (`GET /api/v1/key`) before and after the scenario. The runner prints and records only the numbers, never the key.
- **Batch spend stop:** before each scenario the batch script reads the key's usage. If the batch has spent more than `maxBatchUsd`, it stops the batch: no further scenarios, logs fetched, the server deleted as always.
  - **Decided (lead, #116 review): `maxBatchUsd` is USD 2 per batch,** a gate parameter compared 'equal'.
  - The key's USD 5 credit limit is the hard cap behind it.
- **Order of work:**
  1. this plan;
  2. the offline runner parts (arbiters, fake server, the driver wrapper with a fake `main.js`);
  3. S1 (GO);
  4. the scenarios against skills-rotn's agent as it lands;
  5. a G3 smoke batch;
  6. G3 batches.

**Decided on #101 (lead):**
- `Server` is the test-only task giver;
- the console commands above are approved;
- survival is the night gate;
- the restart is offline in G3 and real in G4;
- `maxMinutes` is 'equal';
- the dawn bound, the marker and the agenda counter are pinned before any gate batch;
- `crafted_by_bot` gates where S1 finds the stat;
- S1 checks for loot chests;
- LLM calls and cost are recorded per scenario, with a batch spend stop;
- the test key is a user environment variable with a USD 5 limit.

**Decided after S1-A (lead):**
- **The world:** the G2 world (seed 1880465901402976865, cube -45 66 -66). The dungeon chests cannot fake a pass, because `crafted_by_bot` gates all five items.
- **S1-B is cancelled.**
- **The dawn bound, provisionally:** the wrap past 24000 after the night, about 40 min from the first join, limit 55 min. The first G3 smoke batch runs a full night and confirms it before it is pinned as an 'equal' parameter.

**Decided (lead, #116 review):** `maxBatchUsd` is USD 2.

**Required before any G3 paid batch (lead, #116 review; my next PR):**
- the spend stop: `maxBatchUsd` as an 'equal' gate parameter; a numbers-only read of the key's usage (`GET /api/v1/key`); per-scenario LLM calls and cost; and a test that the batch stops, fetches the logs and deletes the server;
- `Server` as a test-only task giver;
- `give` and `summon` excluded from G3.

**Still open:** the model (skills-rotn's profile).

### G2 batch (the plan for every G2 gate batch; batches 1-7 ran on 2026-11-01/02. Each batch needs the lead's written GO.)

**Goal:** G2 gate evidence. All three G2 scenarios at the gate parameters (no `--param` overrides, so the default `dataRoot`), with the agent's own naming, on one disposable test server.

**The world is fixed (lead, after G2 batch 5):** a G2 gate run must use batch 4's world, **seed `1880465901402976865`**.

**The cube is fixed too (lead, after G2 batch 6):** `g2-blocks-named` teleports the bot to batch 4's ground centre **-45 66 -66** (`tp FRCFLD -45 66 -66`, test server only) after login and before the census, checks its real position with `tp FRCFLD ~ ~ ~`, and takes the census of that cube. The `cubeCentre` and `maxLandingOffset` gate parameters are compared 'equal'. A bot more than 2 blocks from the landing spot -44.5 66 -65.5 is notGate (lead, #92 review; #94). Batch 6's spawn was on a canopy 17 blocks higher, and its cube was 90% air.
- That world's spawn cube (centre -45 66 -66 in batch 4) has double plants and Dynamic Trees blocks, the cases batches 1-4 found.
- The server is created with `--seed 1880465901402976865` (below).
- The scenarios check it: the recorded seed must equal `G2_WORLD_SEED` (`test/runner/lib/g2.mjs`), otherwise the run is notGate. The spawn point may move by the spawn radius (about 10 blocks), so the cube is the same area, not necessarily the same centre.

**Preconditions, all checked right before the run:**
1. The lead's written GO in `coord/STATUS-rotn-lead.md`.
2. #47 merged: `packages/rotn-data/3.3.4/common-mobs.json` is on develop and lists at least one modded mob. Otherwise `g2-mobs-named` is `notGate` by design, and the batch would only be a smoke run.
3. The naming path is wired. The runner's own check (`agentNaming`) must report "all N table entries round-trip", with no failures. On develop at eedab96 it reports `wired: true`, all **643** entries (checked 2026-11-01 21:45 UTC). I check it again offline before creating the server:

   ```bash
   node --input-type=module -e "import { agentNaming } from './test/runner/lib/g2.mjs'; console.log(agentNaming('.'))"
   ```
4. **#54 merged:** the driver (net-forge's `g1-driver.mjs` answering the G2 protocol). See "Driver" below.
5. `msa-login.mjs FRCFLD --check` prints the profile name. If it asks for a new login, stop and add a NEEDS-HUMAN entry. Its output **never** goes into evidence or any committed file.
6. `test-server.sh`'s sweeper preflight passes unchanged; no `--skip-sweeper-check`.
7. The code is the develop head, with no local changes. `result.json` records `git.sha` and `git.dirty`, and a dirty run doesn't count.
8. **net-forge's mod-entity-table wiring merged**, so modded mobs carry their real registry names (not placeholders).
9. **rotn-data's second dump import merged.**
10. **#57 merged:** the census waits for the cube's chunks and counts unloaded positions apart; more than 1% unloaded makes the run `notGate`.
11. **#53 merged** (the minimal environment for the naming check), and `agentNaming('.')` (precondition 3) **rerun on develop under that reduced environment**: `wired: true`, all entries round-trip.
12. **For the re-run after batch 1:**
    - #64 merged: `testforblock` replies in the real server's form;
    - #67 merged: findings 2-5 (re-asked block samples, mob replacements capped at 3, tagged confirms, placeholder names fail);
    - #66 merged: the batch 1 evidence plus the redaction tool and CI leak check;
    - and a **new** written GO from the lead.
13. **For batch 6 (lead, after batch 5):** net-forge's fix for the 124 remap entries skipped as "cycle" merged; the world-seed check (#85) merged; and a new written GO.
14. **For batch 7 (lead, after batch 6):** #92 merged (the fixed cube, killed-run records, the redaction rule), and a new written GO.
15. **For batch 8 (after batch 7):** net-forge's movement guard (#95) merged, and a new written GO (both done; batch 8 PASSED).

**Driver (agreed: net-forge's #54).**
- **The driver:** net-forge's `packages/forge-bridge/tools/g1-driver.mjs`. It already builds the bot with the real `initBot` (`src/utils/mcdata.js`) with forge-bridge attached, and speaks the G1 protocol through `attachScenario`. The G2 extension is about three lines in **their** file:

  ```js
  import { attachG2, agentNames } from '../../../test/runner/drivers/scenario-protocol.mjs';
  const mc = await import('../../../src/utils/mcdata.js');
  attachG2(bot, { names: agentNames(mc).names }); // logs nothing secret; names via bot.registry + mcdata toNew/toOld
  ```

  So the bot names things through the agent's own code: `bot.registry`, as forge-bridge extends it and `world.js` reads it, plus `mcdata.js`'s `toNew`/`toOld`.
- **Not proposed:** the stock `mineflayer-reference.mjs`. It has no forge-bridge, so it can't join a Forge 1.12.2 server with RotN's mod list.

**Where things run.**
- **Server:** `deploy/test-server.sh run`, unchanged, with `--seed 1880465901402976865`. CPX42 in nbg1, `--ttl-hours 2`, EUR 0.138/h. The `run` EXIT trap deletes the server, with the watchdog and the sweeper as backup.
- **The bot runs on this PC.** The runner gives the driver only its allowlisted environment: `TEST_SERVER_HOST`/`PORT`, `MINDCRAFT_PROFILES_FOLDER` and the `ROTN_*` variables. It never gets `TEST_SERVER_CTL` or cloud credentials.
- **Login cache:** `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa` exists only in this PC's environment, as for G1.
- **Whitelist:** FRCFLD and JQDAW (the default).
- **Console use (test server only, never the live server):**
  - **Before the first scenario**, approved by the lead on the disposable test server only: `gamerule doDaylightCycle false`. **No** peaceful difficulty.
  - **Before each scenario**, approved by the lead on #65 for the disposable test server only: `time set day`, so the bot isn't attacked at night. Batch 1 showed that Time Shall Not Pass re-enables the daylight cycle whenever a player connects, so the gamerule alone does not hold.
  - **During the scenarios**, through the runner: `say`, `seed`, `tp` (`tp FRCFLD ~ ~ ~`, and in blocks `tp FRCFLD -45 66 -66`), `tell`, `testforblock`, `testfor`, `summon`, `kill @e[tag=<run tag>]`, `clear` and `give`.

**Command** (one server, three scenarios in sequence, each with its own bot session):

```bash
deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- bash -c '
  C() { bash "$TEST_SERVER_CTL" console --wait 2 -- "$@"; };
  C gamerule doDaylightCycle false;
  D="node packages/forge-bridge/tools/g1-driver.mjs";
  C time set day; timeout 15m node test/runner/run.mjs --scenario g2-blocks-named    --out captures/raw/g2-blocks -- $D; b=$?;
  C time set day; timeout 15m node test/runner/run.mjs --scenario g2-mobs-named      --out captures/raw/g2-mobs   -- $D; m=$?;
  C time set day; timeout 15m node test/runner/run.mjs --scenario g2-items-roundtrip --out captures/raw/g2-items  -- $D; i=$?;
  bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g2/server;
  echo "blocks=$b mobs=$m items=$i"; [ "$b$m$i" = 000 ]'
```

- **Timeout:** each `run.mjs` is wrapped in `timeout 15m` (exit 124 if hit). A hung scenario can't stop the log fetch, and the server is deleted by the `run` EXIT trap either way.

**Time and cost.**

| Step | Expected |
| --- | --- |
| Server build and boot (batch 1: 3 min from create to ready; G1 took longer) | about 5-15 min |
| `g2-blocks-named`: login, settle 20 s, census, about 150 samples re-asked in about 19 batches of 8 and each checked with `testforblock`, then about 100 spot positions. Batch 1 took 7 min without the re-asks. | about 10-12 min |
| `g2-mobs-named`: login, 12 summons plus replacements, 1-4 verify rounds of 12 tagged `testfor` 10 s apart, the reply, about 12 `testfor`. Batch 1 took 2 min. | about 3-5 min |
| `g2-items-roundtrip`: the full-table check, login, `clear`, 30 `give`, one reply. Batch 1 took 2 min. | about 2-5 min |
| **Total** | **about 20-37 min**: 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour |

- **Hard stop:** past **56 min (1.5x)** I stop and delete the server.
- **Worst case** if everything else fails: TTL + 1 h = 3 h, about **EUR 0.42** plus IPv4.

**After the run.**
- If a scenario used the one login retry (`notes.loginRetry.retried`, approved by the lead on #71), the evidence README says so, for that scenario.
- Confirm `hcloud server list` and `hcloud primary-ip list` are empty, and record the real start and stop times and the cost here.
- Raw files stay in `captures/raw/` (git-ignored). Sanitized evidence goes to `test/evidence/g2/` in a PR: each `result.json`, plus `server.log` excerpts with the world seed and cube centre.
- **Redaction**, in every committed `server.log` excerpt and in `result.json` (`notes` included), following the G1 evidence's conventions:
  - the 1.12 log's `FRCFLD[/IP:port] logged in`, which is this PC's public IP, becomes `<ip>:<port>`;
  - **every** IPv4 and IPv6 address becomes `<ip>`;
  - every player UUID becomes `<uuid-v4>`;
  - local paths are replaced.
- **A check that fails the evidence PR:** a unit test over `test/evidence/g2/**` fails if any IPv4 address (four dotted octets 0..255) or IPv6 address, or any unredacted UUID, is left. It goes in with the evidence PR, so CI enforces it.
- The `msa-login --check` output is never part of the evidence.

**What the G2 evidence will claim.** Only the checks of the three scenarios:
- the 50 most common non-air blocks near spawn named, server-confirmed and consistent with spot checks;
- the common mobs from `common-mobs.json`, modded included, named and confirmed;
- 30 vanilla items read and named, with the full table round-tripping through the agent's `mcdata.js`.

Nothing about crafting, survival or reconnects.

**Reply strings: confirmed by batch 1.** All of these matched the real server:
- `Found <name>`;
- `Object successfully summoned` and `Unable to summon object`;
- `Given [...] * 1 to NAME`;
- `Seed: N`;
- `Selector '...' found nothing`.

The exception was `testforblock`: it prints `x, y, z` with no full stop, which #64 fixed.

**Known risk for the re-run:** the tagged `testfor @e[tag=...,type=...,x=,y=,z=,r=3]` selector hasn't been run on this server yet. If it never matches, `mobs_confirmed` fails and every summon counts as "vanished" (so the run is notGate). Neither can pass falsely.

## Blocked

- **G3 batches:** the lead's decisions on the G3 plan's open questions and on S1-A's proposals, skills-rotn's agent and profile, the test OpenRouter key (Requests item 12), and a written GO for each batch.
- **Any further paid batch:** a written GO. For batches over 20 min, I announce the batch window to the lead first (Requests item 13).
- **The CX23** (Requests item 8):
  1. ~~GO 1, the read-only probe, through `cx23`~~ **done** (2026-11-02);
  2. H1, the deploy key;
  3. GO 2, the bootstrap, through `cx23`: it needs the 26.04 CI job (#135) and this PR merged, then the lead's GO;
  4. H2, the deploy password, and H3, the target swap;
  5. GO 3, the first deploy, through `cx23-deploy`;
  6. later H4 and H5;
  7. the first-start GO, with H6, the CX23's IP, for a disposable test server.

## Requests to other agents or the lead

0. ~~Lead, routed to net-forge: the G2 driver~~ **Agreed:** net-forge's `g1-driver.mjs` with the G2 protocol, in #54.

1. ~~Lead: re-review and merge PR #4~~ **Done** (70c5c3a).
2. ~~Human: GitHub Environment `hetzner-test-sweeper`~~ **Done** (the lead verified it via the GitHub API on 2026-11-01): deployment branches `develop` only, environment secret `HCLOUD_TOKEN`, no repository-level secrets.
3. **Lead (info only):** my unit tests use `"test/unit/**/*.test.js"`, which `npm test` already covers.
4. ~~Lead: merge the G0 evidence PR~~ **Done** (#5, 65792f3).
5. ~~Lead / human: the sweeper's schedule never fired~~ **Done.** GitHub ran almost no scheduled workflows for this account: its own cron fired 1 of about 44 slots, the off-peak cron 0 of 8, and the helper repo 0 of 3. The human set up cron-job.org (a dispatch every 15 min), and the preflight accepts that cadence (path c, PRs #21 and #27). The history is in this file at a8ccac8.
6. **Lead: review notes on the helper workflow `dispatch-sweeper.yml`** (read from the public repo):
   1. Every line of the committed file starts with one space (checked in the raw bytes). The YAML is still valid and GitHub accepted it, but an edit that adds a line at column 0 would break the file. Remove the leading spaces.
   2. The fine-grained token expires. When it lapses, helper runs fail (GitHub emails the owner) and path (b) refuses. Note its expiry date.
   3. Brand-new schedules often start late: the 13:18 and 13:33 slots were missed. Path (b)'s 40-min window tolerates about two missed slots.
   4. The rest looks right: `permissions: {}`, no checkout, no third-party actions, the secret is scoped to one step, the timeout is 3 min. `ubuntu-latest` instead of a pinned image is a minor point.
   5. GitHub disables the helper's schedule after 60 days without activity in the helper repo. The preflight warns from day 45; a small commit to the helper repo resets the clock.

7. **Lead: a `.gitattributes`** with `*.sh text eol=lf` and `deploy/cx23/** text eol=lf`. Root files are yours. The stopgap is in place: the scripts are `.sh`, and bootstrap strips CRs.
8. **Human, via the lead: the CX23 items** (the CX23 exists as Orca SSH target `cx23`; the plan is under "Planned real batches", "CX23 first run"). They replace the three short CX23 items in NEEDS-HUMAN. Never paste a key, password, token or code into a chat, a file in the repo or a status file. The human's decisions on #101 apply: no lockdown, the target swap, the test key only for now, and a test server for the first start.
   - **Order:** H1 before GO 2; H2 and H3 right after GO 2; H4 and H5 later, before the first start; H6 at the first-start GO.
   - **H1. The `deploy` key** (about 5 min, in your own terminal on this PC, before GO 2):
     1. `ssh-keygen -t ed25519 -f C:/Users/admin/.ssh/mindcraft-rotn-deploy -C deploy@mindcraft-rotn`. A passphrase is optional; Orca must be able to use the key.
     2. Put the **public** key on the CX23 as `/root/deploy.pub`: in an Orca terminal **you** open on `cx23`, run `nano /root/deploy.pub`, paste the one line from `mindcraft-rotn-deploy.pub`, and save.
     3. Tell the lead "H1 done". Agents never read either key file.
   - **H2. `deploy`'s sudo password** (right after GO 2, still as root): in a terminal **you** open on `cx23`, titled `HUMAN ONLY`, run `passwd deploy`. Keep the password in your password manager. You need it for H4 and H5 (`sudo` as `deploy`).
   - **H3. Swap the Orca targets** (right after H2):
     1. Add an Orca SSH target **`cx23-deploy`**: the same host, user `deploy`, the H1 private key. Connect once to check it.
     2. **Remove** the root target `cx23` from Orca.
     3. Tell the lead "H3 done". From then on, agents work only through `cx23-deploy`. Root SSH itself stays enabled on the server (no lockdown), for you.
   - **H4. The bot's long-term OpenRouter key** (**later**: for now there is only the test key on the PC, item 12). Before the CX23's first start:
     1. Create a key at https://openrouter.ai/settings/keys, named `mindcraft-rotn-frcfld-cx23`, with a **credit limit** (the lead sets it in the soak ADR).
     2. In a terminal **you** open on `cx23-deploy`, titled `HUMAN ONLY`, run `sudo nano /etc/mindcraft-rotn/frcfld.env`.
     3. Replace `<set-by-human-never-in-repo>` after `OPENROUTER_API_KEY=` with the key. Fill in `"host"` in `SETTINGS_JSON` at the first-start GO (the test server's name or address). Save.
     4. Check: `sudo stat -c '%U:%G %a' /etc/mindcraft-rotn/frcfld.env` must print `root:root 600`.
     - The first start needs this: `check-env` refuses a placeholder key.
   - **H6. The CX23's IPv4 address, at the first-start GO:** give it to the lead in that GO message. Agents do not look it up. I pass it only on the command line (`deploy/test-server.sh run --allow-from <it>/32`); it never goes into the repo or STATUS.
   - **H5. The bot's Microsoft login on the CX23** (later, before the first start, after the first deploy), in a `HUMAN ONLY` terminal on `cx23-deploy`:
     1. `sudo -u mindcraft-rotn env MINDCRAFT_PROFILES_FOLDER=/var/lib/mindcraft-rotn/frcfld/msa node /opt/mindcraft-rotn/current/packages/forge-bridge/tools/msa-login.mjs FRCFLD`
     2. Open the Microsoft link it prints, enter the code, and sign in with the bot's account on Microsoft's page only.
     3. Then run the same command with `--check` at the end. It prints only the profile name (FRCFLD); tell the lead "H5 done".
     - This is the same tool as for this PC's cache. The cache stays in that folder (0700, owned by `mindcraft-rotn`).
   - **Agents never:**
     - use root except for GO 1 and GO 2 through `cx23` before H3;
     - see a private key, the OpenRouter key, the deploy password or the Microsoft code;
     - read a `HUMAN ONLY` terminal (protected by this agreement plus the order above, not by a technical barrier);
     - connect to your live server.

9. ~~Lead: decide how G2 handles the cube after batch 6~~ **Decided** (#88 comment): P1 and P2 approved, P3 declined; done in #92. The original proposals, for the record:
   - **P1 (recommended): fix the cube too.** After login, the runner teleports the bot to batch 4's ground centre (-45 66 -66) with `tp`, which is already on the plan's console list. It then waits for chunks and takes the census there, so every G2 run sees the same cube (the one where batch 4 found double plants and Dynamic Trees blocks). The new gate parameter `cubeCentre` would be 'equal'.
   - **P2: keep partial results.** On SIGTERM (`timeout`), the runner writes `result.json` with the checks done so far, verdict FAIL and an "interrupted" error, so a kill no longer loses passed checks.
   - **P3 (optional): make the spot check faster or give it more time.** Either one SSH console call per batch of 8 `testforblock` commands (a `deploy/test-server.sh console` change), or `timeout 25m` for blocks with the hard stop adjusted. P1 alone should bring the spot check back to about 1-2 min (batch 4: 43 non-air in 72 positions).

10. ~~Lead (info): G0 evidence predates the redaction rules~~ **Done** (#94): G0 redacted with the tool, and the check runs over all evidence. The original note: `test/evidence/g0/g0-batch.log` lines 9 and 17 hold the G0 test server's public IPv4 (the "is at" and "READY ... at" forms). That server was deleted on 2026-11-01. The CI leak check covers only `test/evidence/g2/**`, so it never flagged them. Say if you want them redacted with the tool (a small PR of mine). The G1 `server.log`'s other flags are FML's pipe-table mod versions, a form G2 excerpts never contain.
11. ~~Lead, routed to net-forge: batch 7's items kick~~ **Done:** net-forge's movement guard (#95). In batch 8 items joined at the same spot, passed, and the guard never had to act. The original request: 2 s after joining, the bot was kicked with `multiplayer.disconnect.invalid_player_movement` (server: "Invalid move player packet received"; 1.12 sends it for a non-finite or out-of-range position or rotation in a move packet). The raw capture is `captures/raw/batch7-20261102/FRCFLD-2026-11-02T15-31-20-713Z.jsonl` on this PC, and the evidence is in `test/evidence/g2/batch7-20261102/items/`. The capture logs no client position packets; it may need to.
12. **Human, via the lead: a test OpenRouter key on this PC, for G3 batches** (the real agent calls the LLM).
    - **Accepted (lead and human, #101):** a user environment variable with a **USD 5 credit limit**. This is the only OpenRouter key for now.
    - Create a **separate** key at https://openrouter.ai/settings/keys: name `mindcraft-rotn-test-pc`, credit limit **USD 5**.
    - Set it as a **user environment variable** on this PC: `OPENROUTER_API_KEY` (Windows: Settings > System > About > Advanced system settings > Environment Variables > User variables). Then restart Orca, so new terminals see it.
    - The runner passes it only to the agent (`--pass-env OPENROUTER_API_KEY`) and never prints or records it. Agents never read `keys.json`.
    - Not needed for survey batch S1.
13. ~~Lead (and the human): this PC's memory during paid batches~~ **Decided (lead, after S1-A): option 1.**
    - During any paid batch over 20 minutes, no other agent runs `npm ci` or a full test suite, and reviews are static, with at most one running.
    - **I announce each batch window to the lead,** who tells the others.
    - Option 2 is the human's choice; the lead told them.
    - S1-B is cancelled. The original note:
    - **What happened:** Claude Code reaped my background shells (the batch's tracking shell and the hard-stop watcher) because the PC was critically low on memory. Minutes later, new processes could not start (`0xC0000142`), which ended the day-cycle run.
    - **The safety net held:** the batch script's own teardown, plus the TTL and sweeper behind it, still deleted everything.
    - **But:** a long batch (G3's first night, about 45 min; S1's day cycle) cannot be supervised when the PC runs out of memory. Several agents and test runs were active at the same time; for example, another worktree's `deploy/test-server.sh` processes were running then, which look like unit tests.
    - **Options (decision for the lead and the human):**
      1. Fewer concurrent heavy agents or test runs during a paid batch. I propose this, at least for batches longer than 20 minutes.
      2. The human could start Claude Code with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`. That keeps supervision alive, but it does not add memory.
      3. Re-run S1-B and the missing day-cycle piece (0-3000 and the wrap) only after 1 is in place.

14. ~~Lead (and the human): cx23 runs Ubuntu 26.04.1, not 24.04~~ **Decided (ADR 0007, #134):** keep 26.04 and turn SSH password login off in setup. This PR does the bootstrap part. The original note: (GO 1 probe, `test/evidence/cx23/`). CLAUDE.md pins 24.04, and `deploy/cx23/bootstrap.sh` refuses any other version. The options:
    1. **Rebuild cx23 from Hetzner's `ubuntu-24.04` image** (I propose this). It keeps the pin, ADR 0002's Node 22 checks and the bootstrap as reviewed. But it erases what is on cx23 now: the human's clones, the Orca server install and its workspaces. The human then re-adds the Orca SSH target, and I run GO 1 again before GO 2 (about one minute).
    2. **Keep 26.04 with an ADR**, plus a small bootstrap change that accepts it. NodeSource's `nodistro` line should work there, but Node 22 and the native dependencies are untested on 26.04 (kernel 7.0).

    **A separate point for the human:** sshd allows password logins (`passwordauthentication yes`), and nothing filters the ports until GO 2 turns on ufw. With no lockdown (the human's decision), the `deploy` password from H2 will also work over SSH. Turning off `PasswordAuthentication` before H2 would close that. It is the human's call, and it is not part of my bootstrap.

15. **net-forge: the P1 reply contract** (lead: coordinate it through STATUS). **#165 uses #162's protocol as it is** (`packages/forge-bridge/tools/probe-commands.mjs`), and **`test/unit/probe-e2e.test.js` holds it to the real code.** It runs the scenario against a real `g1-driver.mjs` process with `ROTN_DRIVER_PROBE=1` on your fake server and craft world (`packages/forge-bridge/test/craft-world.js`, `fake-containers.js`). What the scenario relies on, so a change on your side shows up in that test:
    - **Commands:** `probe-craft TOKEN RECIPE_ID [x,y,z]` (P1: `crafttweaker:pyro_crude_axe`, `crafttweaker:crafting_tools`, `crafttweaker:crafting_table`, and `crafttweaker:stone_pickaxe` at the table), `probe-place TOKEN ITEM x,y,z FACE` and `probe-eat TOKEN ITEM`, as a console whisper from `Server`.
    - **Replies:** exactly one `DRIVER {"type":"probe","token","cmd","ok",...}` per token, within your 60 s limit. Fields read:
      - craft: `ok`, `error`, `result`, `before`, `after`, `ms`, `variant`, `tableBlock`;
      - place: `ok`, `error`, `after`, `updateMs` (into `notes.placeLatencyMs`), `totalMs`;
      - eat: `ok`, `error`, `foodBefore`, `foodAfter`, `countBefore`, `countAfter`, `ms`.
    - **The capture path** comes from your `forge` event (`capture`). Rejected transactions and the `fastbench` mod window are read from the capture in the evidence step; the e2e test checks that the capture has the `fastbench` `mod_window`.
    - **I use your test helpers** (`craft-world.js`, `fake-forge-server.js`, `stack` from `fake-containers.js`, `helpers.js`) from `test/unit/probe-e2e.test.js`. Please keep their exports, or tell me here before you change them.
    - **Optional, later:** per-craft `modWindow` and `transactions` in the craft reply would let a scenario check them directly. They are not needed for P1.

16. **skills-rotn (via the lead): the RotN profile's model.** Open as skills-rotn's #170. The Mindcraft driver refuses any profile whose `model` is not `"openrouter/@preset/glm-5-1-mindcraft"` (the human's decision; #169). Until the RotN profile in `profiles/` sets it, every G3 or smoke run is refused: by the batch preflight before any server exists, and by the driver at each start (exit 3, `refused`). That fails closed, as intended.
    - If the profile sets `code_model` or `vision_model`, they must be the same model.
    - The embedding model is not checked.
17. **net-forge (info, via the lead):** on this PC, `packages/forge-bridge/test/probe-e2e.test.js` test 4 fails at :142 (`hung.timedOut` is undefined: the hung stick placement came back before its 6 s time limit), twice in a row. The file is the same as on develop, and develop's CI is green, so it looks timing- or Windows-dependent.

## Open PRs

- This PR: the P1 rerun evidence (`test/evidence/probe/p1-20261103-a2/`) and `test/tools/p1-capture-summary.mjs`.
- Merged since the restart: #165 (P1 scenario), #169 (model pin), #173 (#139 nits), #176 (G3 batch preflight), #180 (#176 nits), #183 (late console replies), #184 (P1 attempt 1 evidence), and the others' #167, #170, #172 and #177.
- Merged since the last update: #122 (2b30405), #128 (8fcec45), #129 (c2d6867), #135 (05b1a5b), #137 (f028e9b), #139 (f1fd589), #144 (655bcaa), #147 (the #128 and #135 review nits), #150 (the Java 8 on Ubuntu 26.04 note), #157 (the G3 test-only Server giver), #159 (every file under `deploy/cx23/` is LF), #163 (the GO 3 CX23 post-bootstrap check, 54d653b; the terminal was closed at 02:16:21 UTC), #166 (`deploy.sh` refuses the test-only giver settings), and the lead's #134 (ADR 0007).
