# Status: rotn-lead

Updated: 2026-11-07 00:10 UTC (from `date -u`)


## Current snapshot (2026-11-07 00:10 UTC): on the CX33 dev server, the move is nearly done

- **Dev server:** a Hetzner **CX33** (the human corrected CPX32 to CX33 on 2026-11-07). Ubuntu 26.04.1, 4 vCPU, 7.6 GB RAM, **no swap**; everything runs as root. Root is for the dev server only; the CX23 keeps its `mindcraft-rotn` service user and `deploy` user (deploy/cx23/README.md), so do not copy this setup there. The memory rule (Requests item 13) still applies: during a paid batch over 20 min, no other agent runs `npm ci` or a full suite.
- **Move checklist (coord/NEEDS-HUMAN.md):**
  - Step 1: no PR is open and no Hetzner test server exists (`hcloud server list` is empty).
  - Step 2: the base system is complete. Node 22.23.4 (nvm), npm 10.9.9, git 2.53, gh 2.103, hcloud 1.70, jq, curl, unzip, xz, ssh, scp and ssh-keygen, build-essential, python3, OpenJDK 1.8.0_504 with `javac` and `javap`.
  - Step 3: the pack zip is at `/home/RotN 3.3.4 Server Pack.zip`, and its SHA-256 matches `90642fd5...f5205`.
  - Step 4: gh is logged in as JQDAW. The active hcloud context is `mindcraft-rotn-test`, and `HCLOUD_TOKEN` is not exported. `OPENROUTER_API_KEY` is set in the lead's shell (checked set/unset only). The checklist wants it only in the batch session, so that is with the human.
  - Step 5: done by the lead. The main checkout `/home/mindcraft-RotN` (develop) passed `npm ci` (8/8 patches), `npm test` (1468 pass, 0 fail, 2 skipped) and lint (253, the baseline). Worktrees `/home/mindcraft-RotN-worktrees/<agent>` are each on a fresh `agent/<agent>/cx33-start` from develop `cb24eaa5` (every earlier branch was merged), and each passed `npm ci` with 8/8 patches.
  - Step 6: done. The human did the FRCFLD device-code login (profile `FRCFLD`). The lead's `msa-login.mjs FRCFLD --check` passed. The folder is `/root/.mindcraft-rotn/FRCFLD/msa`, mode 0700.
  - Step 7 is open: the human starts the four agent sessions.
  - Step 8 is open: one validation smoke batch, on the lead's GO.
- **Git:** remote `upstream` = mindcraft-bots/mindcraft, fetch only (its push URL is disabled). `gh repo set-default JQDAW/mindcraft-RotN`, so `gh` keeps using the fork now that a second remote exists.
- **For harness-ops, before the validation batch:**
  - set `ROTN_PACK_ZIP="/home/RotN 3.3.4 Server Pack.zip"` (the `deploy/test-server.sh` default is still the Windows path);
  - set `MINDCRAFT_PROFILES_FOLDER=/root/.mindcraft-rotn/FRCFLD/msa` per command;
  - check that `test/tools/redact-evidence.mjs` covers Linux paths: `LOCAL_PATH` matches only Windows user folders, and this server's paths are `/root/...` and `/home/mindcraft-RotN-worktrees/...`;
  - the Git Bash and Windows branches in `test/runner/lib/adapters.mjs` fall back to plain bash here.
- **For net-forge:** `xz` is on PATH, and the pack zip path is above (`build-collision-overrides.mjs --pack`).
- **For rotn-data:** the cobblestone variant list was in the old PC's scratchpad. Rebuild it from `packages/rotn-data/3.3.4/` only if skills-rotn asks.


## Handoff snapshot (2026-11-06 22:04 UTC): before the move to the dev server (a CX33; first written as CPX32)

- **G3:** smoke rounds 1-7 are done. Round 7 on `42a8e94` scored A 7/7, B 4/5, C 7/7 and D 7/7 (evidence: test/evidence/g3/*-r7, #292). B died to a zombie after leaving a working shelter: the shelter check misjudged it, and the equip click was rejected (cursor desync). skills-rotn's fix is **#296**, in review.
- **Gate rule** (docs/PLAN.md, the human's decision 2026-11-06): a clean 4/4 smoke round A-D on the final commit, each batch on its own fresh server; then one `batch.mjs --gate` batch per scenario on that commit, each on a fresh server. On a failure the rest still run, and only the failed scenario is rerun, with the human's approval. A batch run only to validate the dev server never counts.
- **Next, in order:**
  1. Merge #296.
  2. The move (coord/NEEDS-HUMAN.md checklist, #293).
  3. One validation smoke batch from the dev server (lead GO).
  4. A 4/4 smoke round on the final commit (human GO).
  5. The gate batches (human GO).
- **Spend:** the OpenRouter test key read USD 0.846 of the 4.50 stop after round 7. Model: the preset `@preset/glm-5-3-flash-cheap-reliable`. Providers seen are Wafer and Near AI, both fine; OpenInference was excluded by the human after empty summaries.
- **Lead tools:** `coord/tools/lead-merge-one.sh <pr> <reviewedSHA>` is the CI-gated squash merge. It refuses non-merge commits added after the reviewed head.
- **Rules learned:**
  - Run commands go through auto mode; the human does not approve them. A block means stop and ask.
  - Reviewers run at medium effort and never link another worktree's node_modules (the main repo has its own now).
  - harness-ops' post-gate todo: the overlapping memory-summary counter fix.

## Earlier snapshot (2026-11-03 03:11 UTC): before the human's Orca restart

- **Team:** harness-ops (worktree harness-ops-g0), rotn-data (rotn-data-g2), skills-rotn (skills-rotn-g3), net-forge (net-forge-g1, back since 2026-11-03 on the human's approval: Request 2, crafting/placing packets and probe P1). All four were asked to push everything and update STATUS before the restart.
- **CX23 (Ubuntu 26.04, ADR 0007):** GO 2 bootstrap done by the human; deploy key login confirmed; updated and rebooted (kernel 7.0.0-42); Orca has only the "cx23 deploy" environment (folder /tmp); the root target is removed. GO 3 read-only check as deploy merged (#163). Open: sshd -T after the reboot (needs root).
- **LLM:** model is the human's OpenRouter preset `@preset/glm-5-3-flash-cheap-reliable` (#168; changed by the human on 2026-11-06 from `@preset/glm-5-1-mindcraft`). The test key is a Windows user env var `OPENROUTER_API_KEY`; after this restart the lead checks (set/not set only) that a fresh Orca terminal sees it; if not, the human runs batch commands in their own PowerShell.
- **Open PRs at the restart:** #164 (E2 agenda, REQUEST CHANGES: bounded LLM use per step, !agenda must not write, autostart only without agenda.json, wood from rotn-data); #165 (P1 scenario, REQUEST CHANGES: recipe ids, ROTN_DRIVER_PROBE=1, reply contract, kick abort, timeouts, e2e test against the real probe module); #167 (net-forge P1 reply contract + fake test server); #169 (harness-ops: pin the model in the driver); #170 (skills-rotn: RotN profile uses the preset). Review state: #164 and #165 REQUEST CHANGES with fixes pushed, re-review pending; #167 reviewed (APPROVE WITH NITS, not merged); #169 and #170 not reviewed yet.
- **Paid work pending:** probe P1 (about EUR 0.14, under 30 min) needs #165 and #167 merged, then the lead's written GO. The first G3 batch needs E2/E3, C1/C2, P1 results and the env var check.
- **Lead decisions this session:** forced commands from non-task-givers are refused (#146); task_givers ["JQDAW"], allow_server_task_giver false, place_block_timeout_ms 2000 in settings.js (#158, #160); E3 must mark non-giver history as untrusted and make !stfu giver-only; P1 setup may use console give/effect/setblock (test server only, never a gate).
- **Spend:** unchanged since S1-A (about EUR 2.26 plus IPv4-hours); no Hetzner server running.

## Earlier snapshot (2026-11-02 22:42 UTC): Phase 3 (G3)

- **Merged since 20:26 UTC:**
  - harness-ops: #122 (G3 spend stop), #128 (CX23 read-only probe findings);
  - skills-rotn: #123 (quiet reflexes), #124 (1.12 names), #126 (a new action clears a stale re-plan);
  - rotn-data: #125 (isHuntable reads the 1.12 baby flag), #127 (mustCollectManually from the dump's collision boxes).
- **In review:** #129 (harness-ops, #122 follow-up), REQUEST CHANGES:
  - a G3 result.json with no batch.json still passes CI;
  - the wiring test counts all scenarios, not G3 ones.

  Both are required before the first G3 gate batch.
- **CX23 (GO 1 done, PR #128):** the server runs Ubuntu 26.04.1 LTS with 3.8 GB RAM and no swap. Only SSH is public, there is no firewall, and sshd has `PasswordAuthentication yes`.
- **Human decisions (2026-11-02, about 22:30 UTC):**
  - the bot OS moves to Ubuntu 26.04 (ADR 0007), with a CI job on 26.04 before GO 2;
  - the bootstrap turns SSH password login off (root keeps key-only login).
- **Lead decisions for rotn-data:**
  - Request 7 is granted as a one-off: one `mc.installRotnRecipes()` call in `initBot` (net-forge's part; net-forge is paused);
  - Request 9 (prismarine-recipe outShape patch) is deferred until after G3;
  - isHuntable keeps the vanilla animal list for G3;
  - no GO for the Pyrotech machine-recipe dumper part.
- **Routed to skills-rotn:** craftRecipe passes the resolved meta; the villager profession is index 13 on 1.12 (world.js).
- **GO 2 (the bootstrap) waits on:** the 26.04 CI job, the bootstrap accepting 26.04 with password login off, and #129.

## Earlier snapshot (2026-11-02 20:26 UTC): Phase 3 (G3)

- **Team:** skills-rotn, rotn-data and harness-ops; net-forge is paused (#99).
- **Merged in Phase 3 so far:**
  - skills-rotn: #103 and #104 (log hygiene in the agent and model layers; required before the CX23 run), #108 (cheat can't be enabled), #109 (the update loop survives a throwing mode; no restart after smelting), #110 (Mindcraft task files refused unless a test-only opt-in is set; G3 never uses them).
  - rotn-data: #102 (RotN recipes in bot.registry), #107 (howToGet), #111 and #115 (first-night threats; creeper and skeleton variants, witch, stray and others), #112 and #114.
  - harness-ops: #101 (G3 and CX23 plan), #106 (S1 tooling), #113 (S1-A evidence).
- **S1-A survey** (19:12-19:57 UTC, about EUR 0.14; the server was deleted):
  - the G2 world has 203 rock-pile blocks within radius 48 of spawn (5 sampled, all on the surface, 19-46 blocks away), and 2 dungeons (5 chests) underground;
  - craft stats exist for all five G3 items;
  - the count-only `clear` removes nothing;
  - the console whisper sender is `Server`;
  - Extended Days: a cycle of about 40 min, a night of about 19 min, and two freezes of about 10 min.

  The run was cut short by this PC's low memory (Claude Code reaped the batch shell); the teardown worked.
- **Lead decisions after S1:**
  - G3 uses the G2 world (seed `1880465901402976865`, cube -45 66 -66);
  - S1-B is cancelled;
  - `crafted_by_bot` gates all five items, so the dungeon chests can't fake a pass;
  - the dawn bound is provisional (about 40 min from the first join, limit 55 min) until the first G3 smoke batch's full night;
  - `maxBatchUsd` is USD 2.
- **Memory rule (Requests item 13):** during any paid batch over 20 min, no other agent runs `npm ci` or a full suite, and reviews are static with at most one running. The human's optional `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` was offered and is not recommended.
- **CX23:** the read-only probe (GO 1) is approved but waits for the human to open a folder workspace at `/root` on the Orca target `cx23` (Orca must connect from the desktop app). Helper files Orca places itself are accepted, and `ls -la /root` is approved as a last read-only command.
- **Open follow-ups:**
  - rotn-data: cited entries for dread_lich and troll, plus the remaining Overworld "fight" mobs (Quark ashen and dweller first), before the first-night batch;
  - skills-rotn A4: quiet reflexes, unstuck no longer kills the agent, an awaited execute;
  - harness-ops: README nits on #113, then the G3 runner and driver offline.
- **Spend:** agent batches total about EUR 2.26 plus IPv4-hours (S1-A added EUR 0.14).

## Earlier snapshot (2026-11-02 17:07 UTC; decisions added 2026-11-02 18:14 UTC)

- **G2 passed** on G2 batch 8 (#97): strict review APPROVE, plus an independent verifier MET WITH CAVEATS. Details and caveats are in `docs/PLAN.md` Status.
- **The path since the last snapshot:**
  - G2 batches 1-4, 6 and 7 failed honestly, and each failure fed a fix (#64-#96); batch 5 passed but was not declared (#83: its world lacked the defect's blocks).
  - The double-plant defect was Forge's two-pass network ids, fixed via the dumper's state-meta-remap and client-view decoding.
  - G2 runs now use a fixed world seed and cube.
  - The movement guard (#95) stopped the items kick.
  - Evidence is redacted by one tool, with a CI leak check over all of `test/evidence/**` (#94).
- **Paid batches since the last snapshot** (each under a written GO, project empty afterwards):
  - G2 batches 2-8, about EUR 0.14 each;
  - dump 3 (state-meta-remap), about EUR 0.14.

  The total so far is about EUR 2.12 plus IPv4-hours.
- **Orca restart (2026-11-02, about 13:30 UTC):** the dev agents' sessions ended. With the human's approval they were respawned with a plain `claude` in their existing worktrees.
- **New dev-agent rules recorded:** prismarine-auth is an approved net-forge patch (CLAUDE.md); new independent reviewers run at medium effort (the human's instruction).
- **Phase 3 (G3) starts.** The human chose to pause net-forge (worktree kept, respawn for protocol issues). skills-rotn is spawned; the team is skills-rotn, rotn-data and harness-ops. skills-rotn's first inputs are this file's "Requests for skills-rotn" and the G2 caveats in PLAN.
- **Before the first CX23 run** (still open): skills-rotn's `src/agent/agent.js:87/456` print whole error objects.

## Earlier snapshot (2026-11-01 23:30 UTC)

- **G2 batch 1** (GO 22:03): an honest **FAIL**; the server was deleted at 22:24:20, about EUR 0.14.
  - Items passed fully (643/643).
  - Blocks failed on a reply-parser bug (#64) and Dynamic Trees state drift.
  - Mobs failed on summons the server refused (Animania replaces vanilla animals), a spectre that vanished in daylight, and untagged confirms.
  - The report is in #65 and the evidence in #66.
  - Lead decisions on findings 2-7 are in the #65 comment.
- **Fixed and merged since:**
  - #64 parser;
  - #66 evidence redaction and CI leak check (three review rounds, IPv6 evasions closed);
  - #67 re-asked samples, the 0..15 meta bound (the 1.12 `-1` wildcard), metaDrift, mob replacements (max 3 of 12), tagged confirms, placeholder names fail;
  - #62 entity threat overrides (the Animania rabbits were a misread, reverted) and the Animania-replaced vanilla animals;
  - #63, #68, #69.
- **G2 batch 2: GO given at 23:28 UTC** (below). G2 is not passed until its evidence PR is reviewed and merged.
- Hetzner spend for agent batches, an estimate from the batch records: about EUR 1.00 + IPv4-hours. That is G0 0.16, G1 batches 3 × 0.14, dumps 2 × 0.14 and G2 batch 1 0.14, each 1 billed CPX42 hour at EUR 0.1381 (G0 includes two CX23s).
- Since 22:25 UTC every *new* independent-reviewer subagent runs at medium effort (the human's instruction).
- For skills-rotn: a pack mod sets `commandBlockOutput`/`sendCommandFeedback` to false for the player on join (G2 batch 1 finding 7).

## Earlier snapshot (22:05 UTC)


- **Every G2 precondition is merged** (develop `36d7ee8`):
  - #51 the G2 batch plan;
  - #53 the minimal env for the naming check;
  - #54 g1-driver for the G2 protocol;
  - #55 the second dump with serializers.json;
  - #56 the entity table and serializers 14-18 in initBot;
  - #57 the census waits for chunks and counts unloaded positions apart;
  - #59 canonical import order and maxTickMs;
  - #60 the driver census and chunk-wait knob.
- **Second dump batch (serializers): PASS, within the 21:23 GO.**
  - CPX42 21:23:50-21:27:46 UTC, about EUR 0.14 + IPv4. The project was empty at 21:27:56.
  - Jar SHA-256 `438b3ce6...7d33` (run 41351598338) matches the manifest; 0 errors, 0 entryErrors.
  - Serializer 14 is confirmed as AquaAcrobatics' pose; 15 Base, 16 Mowzie's Mobs, 17 Charset, 18 Requious, 256/257 DoggyTalents.
- Hetzner spend for agent batches: about EUR 0.86 + IPv4-hours.
- **G2 batch: GO given at 22:03 UTC** (below). G2 is not passed until its evidence PR is reviewed and merged.
- Open: #58 (CX23 env-file name allowlist). REQUEST: the check fails open on an unreadable file, so it must fail closed.

## Earlier snapshot (2026-11-01 21:25 UTC)

- **The G2 code is all on develop:**
  - #43 translation follow-ups (`c9b1855`);
  - #46 mod metadata serializers, `applyProperties`, `mcdata = bot.registry` (`c2ae301`);
  - #44 mcdata.js naming API, `toNew`/`toOld` (`c047d29`);
  - #49 applyProperties hardening (`6fb1fd4`);
  - #36 G2 scenarios (`eedab96`);
  - #47 first RotN 3.3.4 dump plus common-mobs.json (`7978d27`).

  #48 (dumper follow-ups and serializers.json) and #50 (G1 evidence follow-ups) are merging CI-gated.
- **Combined check** (reviewer, #36 + #44 merged together): harness-ops' `agentNaming` against the real `mcdata.js` reports wired, with 643 of 643 entries round-tripping.
- **First dump batch result:** PASS, within the GO.
  - CPX42 created 19:25:54, deleted 19:30:18 UTC; about EUR 0.14 + IPv4. The project was empty afterwards.
  - The jar SHA-256 `2d32ee40…b94c` (run 41341359100) equals `manifest.dumperJar.sha256`. 0 errors.
  - The brief's recipe and harvest acceptance now runs against the real dump: 15/15 pass.
  - Hetzner spend for agent batches so far: about EUR 0.72 + IPv4-hours.
- **G2 not passed yet:** it needs a real G2 batch. harness-ops is writing the plan, and the driver choice is being settled with net-forge. That batch needs a written GO.
- **Next paid batch:** the serializers dump (rotn-data), with a written GO only after #48 merges.
- **Lint baseline** is now 255 (#44); CLAUDE.md updated.

## Requests for skills-rotn (route when it is spawned)

- From PR #55's review: never key on CraftTweaker-generated recipe ids (e.g. `crafttweaker:rustic_chair_N`); they are rebound between dumps. Match recipes by output and ingredients.
- From PR #56's review: rotn-data's entity table types mobs by `IMob`, so the Ice and Fire fire dragon shows as passive (other large modded threats may too). The lead **requested** (22:00 UTC, terminal message, not yet agreed or recorded by rotn-data) a documented `dangerous` override list with a source for each entry. Danger and avoid logic must not rely on `type` alone.

- From PR #44's review: with `prefer: 'old'`, `grass`, `stone_slab`, `snow`, `melon` and `nether_brick` keep their 1.12 meaning. `src/agent/library/skills.js:706` (`empty_blocks`) uses `'grass'` for the plant, so it would treat grass blocks as empty. Review every 1.21 block or item name in skills, modes and prompts against `mcdata.resolveName`.
- From PR #44's review: `getItemId('spruce_log')` returns the shared 1.12 `log` id, dropping the meta, so inventory counts by id lump all logs together. Use `resolveName(...).meta` for counts and crafting checks.

## Earlier snapshot (19:40 UTC)

- **Phase 2 (G2) under way.** G0 and G1 passed. Three dev agents are running (harness-ops, net-forge, rotn-data), the maximum.
- **Merged today since G1:**
  - #25 registry extension (`9ad3673`);
  - #35 direct deps (`598bc8a`);
  - #40 dumper-build CI (`063c0a4`);
  - #41 ADR 0006, dumper on ForgeGradle 3 (`49aaad6`);
  - #37 rotn-data package and name translation (`441020b`);
  - #42 dumper-build wording (`0fb6deb`);
  - #34 dumper mod (`3158776`);
  - #38 FML EntitySpawn (`a4720df`).

  Each had an independent-reviewer pass and was merged CI-gated at the reviewed head.
- **Open:** #36, G2 scenarios (harness-ops). REQUEST CHANGES: names must be checked through `src/utils/mcdata.js`, the agent's own code, not rotn-data directly. Until mcdata.js is wired to rotn-data, every run is `notGate`; a null seed is also `notGate`.
- **Routed:** rotn-data's Requests 2 and 4 (the properties call shape; mcdata reads `bot.registry` in `initBot`) went to net-forge.
- **Follow-ups queued:**
  - rotn-data: #37 items 3-5; #34 nits (per-tick time cap if `timing.items` is heavy, a try/catch per entry, the importer expanding meta 32767).
  - net-forge: #38 nits (README must say the table supplies `type`; `kind` defaults to `'unknown'`).
- **Brief acceptance not ticked:** rotn-data's `recipesFor` and harvest acceptance stays open until a real dump is imported.

## Done

- **Phase 0 complete; G0 passed (one item pending).** See PLAN "Status".
  - Research reports filed.
  - ADRs 0002 (Node 22), 0003 (forge-bridge), 0004 (dumper) and 0005 (RotN 3.3.4).
  - Briefs revised and approved by the human.
  - Toolchain and human setup verified.
- G0 test-server half (harness-ops): a real CPX42 built RotN 3.3.4 with 21/21 checks passing and was deleted. The watchdog proof passed: the sweeper deleted an expired, labelled CX23 with its IPv4 and key, and left alone a differently labelled control (`purpose=mindcraft-rotn-watchdog-control`).
- **Pending:** no `event=schedule` sweeper run has been seen yet. One is a precondition for the next real paid batch.

## Doing

- harness-ops, session 2: worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/harness-ops-g0`, terminal `term_292a0a8e-ca67-48d3-a2b1-fedc30ba07a2`, auto mode. Assigned:
  - PR #5 review nits 2-5;
  - deferred findings 5, 7, 8 and 10;
  - CI (npm ci, test and lint on every PR; no Hetzner secret in `pull_request` jobs);
  - the scenario runner plus the G1 scenarios;
  - watching for the first scheduled sweeper run.

  No paid batches without lead approval.
- net-forge, session 1 (started 2026-11-01 on the human's go-ahead): worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/net-forge-g1`, branch `agent/net-forge/g1-spike`, terminal `term_00eb1416-7aff-484e-a008-e05ffa79e2b9`, auto mode (launch screen checked, no bypass). Assigned:
  - offline forge-bridge work first (handshake state machine, RegistryData, FML|MP, REID overrides gated on `jeid`, `initBot` fixes, unit tests);
  - then real G1 runs on test servers built with `deploy/test-server.sh`, each paid batch after written lead approval, only once a scheduled sweeper run has been seen;
  - a request to the human for the FRCFLD device-code login (cache in `C:/Users/admin/.mindcraft-rotn/FRCFLD/msa`).

## Next

- Spawn net-forge for the Phase 1 FML login spike (G1). Use the safe launch path and check its launch screen for bypass mode. At most three dev agents run at a time; currently one.
- The net-forge spike needs:
  - the human's one-time device-code login for FRCFLD on this PC (NEEDS-HUMAN);
  - a capture test server (`--capture`), which may only start after a scheduled sweeper run has been seen.
- Later phases still need from the human: the CX23 root login and the OpenRouter key.

## Blocked

- Next paid batch: waiting for the first observed `event=schedule` sweeper run (since 2026-11-01 00:25 UTC, when PR #4 merged).

## Spend so far

- Hetzner:
  - The human's CPX42 `mindcraft-test-env`: about 1-2 h, about EUR 0.28; the lead deleted it at the human's request.
  - G0 batches: about EUR 0.16 (CPX42 build plus two CX23s for the watchdog), plus Primary IPv4 hours. The CX23 share is estimated.
  - The test project is empty, except for the human's unlabelled SSH key.
- OpenRouter: EUR 0.

## Open PRs

- (none)

## Merged

- #2 Phase 0: research reports, ADRs 0002-0005, revised briefs. Review: REQUEST CHANGES, then APPROVE WITH NITS; all fixed.
- #3 Lockfile, mineflayer pinned to 4.33.0, engines/test/lint scripts. Review: APPROVE WITH NITS; fixed.
- #4 G0 tooling: test-server script, cleanup, off-PC sweeper (harness-ops). Review: REQUEST CHANGES, then APPROVE WITH NITS. Orca removed the agent's worktree on merge because of `--delete-branch`; nothing was lost.
- #5 G0 evidence (harness-ops). Review: APPROVE WITH NITS; the nits are assigned to the next harness-ops PR. Merged without `--delete-branch`.

## Batch approvals (written)

- **2026-11-01 11:40 UTC, net-forge G1 batches.** Approved as planned in `coord/STATUS-net-forge.md` ("Planned real batches"):
  - **Batch A (handshake capture):** approved as written. CPX42, nbg1, `--ttl-hours 2`; expected about EUR 0.14, maximum about EUR 0.42 + IPv4.
  - **Batch B (online spike, 11 min):** approved as a **spike only**. It is not G1 gate evidence.
  - **Batch C (G1 gate evidence):** approved in principle. It must run through harness-ops' runner (`test/runner/run.mjs` with `test/scenarios/g1/g1-login-chat-walk.mjs`) and a forge-bridge driver that implements `test/runner/DRIVER.md`. Same server type, TTL and cost bounds as A and B. Batches B and C may share one server run if the driver is ready.
  - **Conditions for all three:**
    - One server at a time, in order.
    - `deploy/test-server.sh` unchanged, with its preflight passing; `--skip-sweeper-check` is not allowed.
    - Stop and delete if a batch runs past 1.5 times its expected time.
    - After each batch, confirm the project is empty, and record the real start and stop times and cost.
    - Raw captures stay in `captures/raw/`; only sanitized fixtures and evidence are committed.
    - Never the live server; the FRCFLD cache is used only from this PC.

- **2026-11-01 15:35 UTC: GO for net-forge Batch A** (handshake capture), as approved above.
  - Preconditions met:
    - PR #21 merged (`2abdd3b`): the preflight accepts the external-cron cadence, and a newer failed run blocks it.
    - The cadence is live: cron-job.org dispatches at 15:00:51, 15:15:25 and 15:30:40, all successful.
    - The project was empty.
  - Run it from a clean checkout of develop at `2abdd3b` or later, not from an unmerged branch.

- **Batch A result (2026-11-01):** PASS.
  - CPX42 created 15:36:30, ready 15:39:34, handshake done 15:39:44, deleted and verified 15:40:14 (224 s up).
  - About EUR 0.14 + IPv4. The project was empty afterwards (lead verified).
  - Evidence is in PR #26.
- **2026-11-01 15:55 UTC: GO for net-forge Batch B + C on one server** (online spike + G1 runner scenario).
  - Run from a clean checkout of origin/develop, **without** the unmerged PR #25.
  - Expected about 35 min; stop and delete at 55 min; maximum about EUR 0.42 + IPv4.
  - Same conditions as above, with the preflight on its own.
  - Watch the JustEnoughDimensions login error and the `OBFUSCATE|HS` / `dimstack` channels.
  - Lead-approved exception: net-forge may add **only** `test/evidence/g1/` (sanitized runner result files) in its evidence PR.

- **Batch B + C result (2026-11-01, about 15:55-16:02 UTC): G1 NOT passed yet.**
  - Passed: online login, spawn, chat send, walk.
  - At spawn the 90 KB `advancements` packet failed to parse (NBT "unexpected tag end"). The client later timed out and disconnected, so the runner failed chat receive, walk and the 10-min stay.
  - About EUR 0.14. The project was empty afterwards (lead verified 16:03).
  - net-forge is diagnosing offline. The next batch needs a new written go-ahead.
- PR #26 (Batch A evidence) merged as `c40856d`, APPROVE WITH NITS. The STATUS-line fixes are queued for net-forge.

- **2026-11-01 17:05 UTC: GO for net-forge Batch B + C retry** (one server).
  - Prerequisite met: PR #28 merged (`a83c22b`): the Triumph advancements are opaque, and the parse safety net is in place.
  - Run from a clean checkout of origin/develop at `a83c22b` or later, **without** the unmerged PR #25.
  - Same conditions as the 15:55 GO: preflight on its own; one CPX42; stop and delete at 55 min; maximum about EUR 0.42 + IPv4; the project empty afterwards; real times and cost recorded; sanitized evidence only (`test/evidence/g1/` exception stands).

- **Batch B + C retry result: G1 PASS** (PR #31 `b554547`, confirmed by an independent reviewer). CPX42 17:09:58-17:34:44 UTC, about EUR 0.14; the project was empty at 17:35:19 (lead verified at about 17:48).
- Hetzner spend for agent batches so far: G0 about EUR 0.16, Batch A about EUR 0.14, B+C about EUR 0.14, retry about EUR 0.14, so about EUR 0.58 + IPv4-hours.

- **rotn-data spawned 2026-11-01 about 18:00 UTC** for Phase 2 (G2). Worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/rotn-data-g2`, branch `agent/rotn-data/g2-dumper`, terminal `term_ea9c811e-debc-4b19-8707-aefda537172d`, auto mode (launch screen checked). Three dev agents now run (the maximum).

- **2026-11-01 about 19:24 UTC (corrected; first recorded as 19:35): GO for rotn-data's first RotN 3.3.4 dump batch** (given in writing as an Orca terminal message to rotn-data, right after dumper-build run 41341359100 succeeded; recorded here in PR #45, committed 19:28:49 UTC, after the server was created), the "Paid test-server plan" in `coord/STATUS-rotn-data.md`.
  - Run it from a clean, separate checkout of origin/develop at `3158776` or later.
  - The jar is the dumper-build artifact of push run 41341359100 (develop `3158776`, success). Record its SHA-256 before the batch and match it against `manifest.dumperJar.sha256` afterwards.
  - Disposable test server only, never the live RotN server.
  - `deploy/test-server.sh` unchanged, with its preflight passing on its own; no `--skip-sweeper-check`. One CPX42 in nbg1, TTL 2 h, `timeout 3600`. Stop and delete past 45 min. Maximum about EUR 0.28 + IPv4.
  - Afterwards the project must be empty; record the real times and cost.
  - Raw output stays out of git. Commit only the imported data and the manifest, in a PR.
  - Report `manifest.timing` per part and the error count.

- **2026-11-01 21:23 UTC: GO for rotn-data's second dump batch** (serializers.json), given as an Orca terminal message.
  - Same conditions as the first. The jar is from dumper-build push run 41351598338 (develop `7f0feef`).
  - One CPX42, TTL 2 h, `timeout 2700`. Maximum about EUR 0.28 + IPv4.
  - Result: PASS (see the 22:05 snapshot).
- **2026-11-01 22:03 UTC: GO for harness-ops' first real G2 batch**, exactly as planned in `coord/STATUS-harness-ops.md` "G2 batch" (#51).
  - A clean checkout of origin/develop at `36d7ee8` or later; `git.dirty` must be false.
  - Runtime preconditions are checked just before creating the server: `agentNaming` wired, `msa-login FRCFLD --check` (stop and add a NEEDS-HUMAN item if it asks for a login; its output is never evidence), and the preflight passing on its own. No `--skip-sweeper-check`.
  - One CPX42 in nbg1, TTL 2 h, `timeout 15m` per scenario. Hard stop at 56 min; worst case about EUR 0.42 + IPv4. No concurrent batch.
  - Console commands only on the test server, only those the plan lists: `time set day` and `gamerule doDaylightCycle false`, no peaceful.
  - Afterwards: the project empty; real times and cost recorded; raw output in `captures/raw/`.
  - The FRCFLD token cache is used only from this PC. The driver gets only the runner's allowlisted env: no cloud credentials and no `TEST_SERVER_CTL`.
  - The evidence PR redacts every IP (including the `FRCFLD[/IP:port] logged in` line), every UUID and local paths, with a CI check. Each scenario's pass, gateValid and notGate reasons are reported honestly. A failure needs a new written GO.

- **2026-11-01 23:28 UTC: GO for G2 batch 2**, the re-run, exactly as planned in `coord/STATUS-harness-ops.md` "Planned real batches" (console list and command at about lines 107-124; redaction rules in the same section):
  - `gamerule doDaylightCycle false` once, then `time set day` and `timeout 15m` before each scenario;
  - develop `53a1d5e` or later, clean;
  - the same conditions as batch 1: runtime preconditions just before the create, no `--skip-sweeper-check`, one CPX42, TTL 2 h, a hard stop at 56 min, worst case about EUR 0.42 + IPv4, test server only, the FRCFLD cache only from this PC, the project empty afterwards, and evidence through the merged redaction tool with the CI leak check;
  - an honest report of pass, gateValid, notGate, replacements and metaDrift.

- **2026-11-02 18:12 UTC: the human's CX23 and LLM decisions (on harness-ops' plan #101):**
  - **No lockdown:** root SSH stays enabled for the human. The bootstrap creates `deploy`; the human then adds a `deploy` Orca target and removes the root `cx23` target, so root steps (the probe and the bootstrap setup) run before that swap.
  - Only the **test OpenRouter key** (USD 5 limit) for G3 batches for now; the long-term key comes later.
  - The first CX23 start joins a **disposable test server**; the human supplies the CX23's IP for `--allow-from` at that GO.
- **Lead decisions on #101:**
  - maxMinutes is compared 'equal';
  - the dawn bound, marker and agenda counter are pinned before gate batches;
  - crafting must be proven by craft statistics if S1 shows they exist, plus S1 checks for no loot chests near the cube;
  - LLM calls and cost are recorded per scenario, with a batch spend stop;
  - on test servers only (never in production): `Server` as a test-only task giver, `clear … 0`, `scoreboard`, `time query`, and `setblock` for the marker only;
  - `give` and `summon` stay out of G3 scenarios (S1 only);
  - survival is the night gate (shelter is evidence);
  - restarts are tested offline in G3 and for real in G4.
- **Incident (2026-11-02, harness-ops):** plan text passed through a bash string executed backticked `ssh`, `scp` and `passwd deploy`. All failed locally; none used `cx23` or an address, and nothing reached the CX23. Rule: write markdown with the Write or Edit tools, never through shell strings (memory note added).
- **Lead-owned exception for skills-rotn:** `src/models/openrouter.js:40,49` and `src/models/prompter.js:124-125,131-132,238`, which print whole errors or completions, may be changed to use `safeError` in one small PR.

## Notes for dev agents

- mineflayer-pvp pulls in a nested `mineflayer@2.41.0` and `minecraft-data@2.221.0` through `mineflayer-utils` (upstream issue). net-forge should keep this in mind when it extends the registry.
- Merge with `gh pr merge --squash` **without** `--delete-branch` while the authoring agent is still working in that worktree.
- For net-forge (deliver with its next message): regenerate `patches/minecraft-data+3.97.0.patch` for the installed minecraft-data 3.119.0. CI logs a "patch file version mismatch" warning; the patch still applies (from PR #8's review).
- PR #8 (CI) merged 2026-11-01 as `a04ea22`. Review: APPROVE WITH NITS. Follow-ups 1, 2, 3, 5 and 7 are queued with harness-ops.
- PR #7 (G0 follow-ups) merged 2026-11-01 as `bbcb0ef`, after the lead updated the branch so CI ran (pass). Review: APPROVE WITH NITS. Findings 1-7 are queued with harness-ops; finding 1 (scheduled-mode attribution) must be fixed before scheduled mode counts as evidence.
  - The new preflight in `deploy/test-server.sh up` refuses to create servers until an `event=schedule` sweeper run on `develop` exists. This enforces the lead rule in code.
- `.claude/agents/independent-reviewer.md` (committed in PR #14) gained two rules: always flag gate-file changes, and run tests in a scratch worktree, never in an agent's live worktree.
