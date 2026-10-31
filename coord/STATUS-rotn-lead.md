# Status: rotn-lead

Updated: 2026-11-01

## Done

- Phase 0 steps 1-3: read all docs; toolchain check; the `upstream` remote was already present.
- Human setup (2026-11-01), verified by the lead:
  - Node v22.23.4 (nvm-windows), hcloud 1.70.2, `HCLOUD_TOKEN` set (user variable).
  - Task giver `JQDAW`.
  - Pack chosen: RotN 3.3.4 zip, SHA-256 `90642fd5…f5205`.
  - Prices from the Hetzner API: CPX42 EUR 0.1381/h, CX23 EUR 0.0109/h.
- Phase 0 step 4: four research reports filed in `docs/research/`.
- Phase 0 step 5: ADRs 0002 (Node 22), 0003 (forge-bridge), 0004 (dumper) and 0005 (RotN 3.3.4).
- Phase 0 step 6: briefs revised. The PR #2 independent review (REQUEST CHANGES, 12 findings) is addressed:
  - REID facts corrected against the 2.2.2 jar shipped in the zip: remove-effect is i32; biomes sit inside the chunk buffer; there is a `jeid` channel; enchantment ids are ints.
  - Exit-code contract (0/1/3).
  - Bot login on this PC added to NEEDS-HUMAN.
  - Ownership defaults to the lead.
  - Recipe shape and crafting owner decided.
  - harvestInfo test reworded.
  - Env-var safety for `INSECURE_CODING`/`SETTINGS_JSON`.
  - The sweeper's secret goes in a GitHub Environment.
  - Stale facts fixed (mineflayer 4.26, prices).

## Doing

- PR #2: re-review of the fixes, then merge.

## Next

- Human: restart Orca; name the bot account. (Briefs approved, `mindcraft-test-env` deleted, live server confirmed as the 3.3.4 zip: all 2026-11-01.)
- Lead (PR #3): `npm install` on Node 22, commit `package-lock.json`, add `engines` and a `"test"` script (`node --test`) to `package.json`, and check that the patch files still apply.
- Then spawn harness-ops (G0), then net-forge (G1).

## Blocked

- Spawning dev agents: waiting for the PR #2 merge and an Orca restart (so agents inherit Node, hcloud and the token).

## Spend so far

- Hetzner: the human's CPX42 `mindcraft-test-env` ran about 1-2 h (about EUR 0.28), then the lead deleted it at the human's request on 2026-11-01. The test project is empty. No servers were created by agents. OpenRouter: EUR 0.

## Open PRs

- #2 Phase 0: research reports, ADRs 0002-0005, revised dev briefs
