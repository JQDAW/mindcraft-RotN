# Status: rotn-lead

Updated: 2026-11-01 (about 21:25 UTC)

## Current snapshot (21:25 UTC)

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

## Notes for dev agents

- mineflayer-pvp pulls in a nested `mineflayer@2.41.0` and `minecraft-data@2.221.0` through `mineflayer-utils` (upstream issue). net-forge should keep this in mind when it extends the registry.
- Merge with `gh pr merge --squash` **without** `--delete-branch` while the authoring agent is still working in that worktree.
- For net-forge (deliver with its next message): regenerate `patches/minecraft-data+3.97.0.patch` for the installed minecraft-data 3.119.0. CI logs a "patch file version mismatch" warning; the patch still applies (from PR #8's review).
- PR #8 (CI) merged 2026-11-01 as `a04ea22`. Review: APPROVE WITH NITS. Follow-ups 1, 2, 3, 5 and 7 are queued with harness-ops.
- PR #7 (G0 follow-ups) merged 2026-11-01 as `bbcb0ef`, after the lead updated the branch so CI ran (pass). Review: APPROVE WITH NITS. Findings 1-7 are queued with harness-ops; finding 1 (scheduled-mode attribution) must be fixed before scheduled mode counts as evidence.
  - The new preflight in `deploy/test-server.sh up` refuses to create servers until an `event=schedule` sweeper run on `develop` exists. This enforces the lead rule in code.
- `.claude/agents/independent-reviewer.md` (committed in PR #14) gained two rules: always flag gate-file changes, and run tests in a scratch worktree, never in an agent's live worktree.
