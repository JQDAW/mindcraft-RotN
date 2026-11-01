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

## Notes for dev agents

- mineflayer-pvp pulls in a nested `mineflayer@2.41.0` and `minecraft-data@2.221.0` through `mineflayer-utils` (upstream issue). net-forge should keep this in mind when it extends the registry.
- Merge with `gh pr merge --squash` **without** `--delete-branch` while the authoring agent is still working in that worktree.
