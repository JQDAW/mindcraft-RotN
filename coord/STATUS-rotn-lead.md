# Status: rotn-lead

Updated: 2026-11-01

## Done

- Phase 0 steps 1-3:
  - Read all docs.
  - Toolchain check: git, gh (JQDAW) and Orca 1.4.245 are OK. Node, hcloud and `HCLOUD_TOKEN` are missing (see NEEDS-HUMAN).
  - The `upstream` remote was already present.
- Phase 0 step 4: four research reports filed: `docs/research/seam-map.md`, `fml-spec.md`, `rotn-progression.md` and `ops.md`. Lead spot-checks:
  - three seam-map claims, checked in the code;
  - mineflayer's Node >=22 requirement, checked on the npm registry;
  - the RotN 3.3.2 commit and two recipes, checked with `gh api`;
  - REID present in 3.3.2, with its network mixins read.
- Phase 0 step 5: ADR 0002 (Node 22, decided by the human), ADR 0003 (forge-bridge: fresh nmp plugin, REID-aware, shared `bot.registry`), ADR 0004 (dumper: server-side Forge mod on the test server).
- Phase 0 step 6: briefs revised; ownership gaps closed in CLAUDE.md; PLAN risks and status updated.

## Doing

- PR for the Phase 0 docs (branch `agent/rotn-lead/phase0`), with an independent-reviewer pass.

## Next

- Human approves the briefs (NEEDS-HUMAN). Then spawn harness-ops (G0 test-server script), then net-forge (G1 spike).
- Once Node 22 is installed here: `npm install`, commit `package-lock.json`, and add `engines` to `package.json`.

## Blocked

- Spawning dev agents: waiting for the human's brief approval (G0 human half), since 2026-11-01.
- Local tests: waiting for Node 22 on this PC, since 2026-10-31.
- G0 server build: waiting for hcloud, `HCLOUD_TOKEN`, pack confirmation and the Hetzner availability check, since 2026-10-31.

## Spend so far

- Hetzner: EUR 0 (no servers created). OpenRouter: EUR 0.

## Open PRs

- (being opened) Phase 0 research, ADRs 0002-0004, revised briefs
