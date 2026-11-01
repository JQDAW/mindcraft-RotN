# Status: rotn-lead

Updated: 2026-11-01 (about 01:00 UTC)

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

## Notes for dev agents

- mineflayer-pvp pulls in a nested `mineflayer@2.41.0` and `minecraft-data@2.221.0` through `mineflayer-utils` (upstream issue). net-forge should keep this in mind when it extends the registry.
- Merge with `gh pr merge --squash` **without** `--delete-branch` while the authoring agent is still working in that worktree.
- For net-forge (deliver with its next message): regenerate `patches/minecraft-data+3.97.0.patch` for the installed minecraft-data 3.119.0. CI logs a "patch file version mismatch" warning; the patch still applies (from PR #8's review).
- PR #8 (CI) merged 2026-11-01 as `a04ea22`. Review: APPROVE WITH NITS. Follow-ups 1, 2, 3, 5 and 7 are queued with harness-ops.
- PR #7 (G0 follow-ups) merged 2026-11-01 as `bbcb0ef`, after the lead updated the branch so CI ran (pass). Review: APPROVE WITH NITS. Findings 1-7 are queued with harness-ops; finding 1 (scheduled-mode attribution) must be fixed before scheduled mode counts as evidence.
  - The new preflight in `deploy/test-server.sh up` refuses to create servers until an `event=schedule` sweeper run on `develop` exists. This enforces the lead rule in code.
- `.claude/agents/independent-reviewer.md` (committed in PR #14) gained two rules: always flag gate-file changes, and run tests in a scratch worktree, never in an agent's live worktree.
