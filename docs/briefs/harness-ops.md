# Brief: harness-ops

You build everything that proves the bot works and keeps it running: the disposable test server, the scenario runner, CI, the CX23 setup and deploys. Every gate is checked by your scenarios, so start on day one.

## You own

- `deploy/` (test-server and CX23 provisioning, systemd units, deploy script)
- `test/` (scenario runner, scenarios, smoke tests)
- `.github/workflows/`
- `TRY_IT.md`

## Test server (CPX42, disposable)

- `deploy/test-server.sh` (plus cloud-init) creates a Hetzner CPX42 with the `hcloud` CLI in the dedicated test project, installs Java 8, downloads the official RotN 3.3.2 server pack zip from a pinned URL, checks its SHA-256, unpacks it with default configs, accepts the EULA, sets online mode, whitelists the bot and a test account, and starts a fresh world.
- Labels every server it creates. Always deletes the server and its Primary IPv4 at the end of a batch (powering off does not stop billing).
- A delete-after watchdog (default 8 hours) removes any labelled server that outlives its batch, even if the script crashed.
- Price reference: EUR 0.138/h, EUR 86.17/month cap. Log the run time and estimated cost of each batch.
- Optional: JVM flag `-Dfml.debugNetworkHandshake=true` for net-forge's capture runs.
- Never connect anything to the live server.

## Scenario runner

- Builds on Mindcraft's task format (`tasks/`, `--task_path`, `--task_id`) where it fits, with pass/fail checks read from the bot state and server logs.
- One scenario per ready-to-try item (see `docs/PLAN.md`), grouped by gate.
- A model benchmark mode: same scenarios across 3-4 OpenRouter models, recording success rate and cost per hour.

## CX23 (bot runtime)

- Bootstrap with the root login once: create a `deploy` user with an SSH key, disable root and password login, enable unattended security updates, firewall SSH only, 2 GB swap, Node 22 LTS (ADR 0002).
- `mindcraft-rotn@.service` systemd template unit: one instance per bot, environment file per bot (OpenRouter key, ports, profile path), `Restart=always`, memory limit, runs as a non-root user.
- Microsoft device-code login per bot, token cache in that bot's folder, mode 600.
- Deploy: tag on `develop` -> pull the tag, `npm ci`, restart the instances. Rollback = previous tag.
- Mindcraft web UI bound to localhost, reached through an SSH tunnel.

## Deliverables, in order

1. G0: `deploy/test-server.sh` builds a working RotN 3.3.2 test server and deletes it cleanly; watchdog proven.
2. Scenario runner plus G1 scenarios for net-forge.
3. CI: lint and unit tests on every PR.
4. Scenarios for G2 and G3 as the other agents get there.
5. CX23 bootstrap, template unit, deploy script, 2-hour soak, then the full G4 acceptance run.
6. `TRY_IT.md`.

## Needs from the human (via the lead)

Hetzner API token for a dedicated test project, the pinned server pack URL, the bot account login, the OpenRouter key on the CX23, and the root login for one-time bootstrap. Never ask for these in chat or commit them.

## Phase 0 research revisions (rotn-lead, 2026-11-01)

Read `docs/research/ops.md` (hcloud commands, watchdog design, systemd unit, token cache, budgets) and `docs/research/fml-spec.md` section 6 (capture plan). Where this section and the text above disagree, this section wins.

- **Node 22 LTS** everywhere (ADR 0002): CI, the CX23 and the unit's `ExecStart`.
- **Test-server build.**
  - cloud-init does the whole build, and the PC only calls `hcloud` create, poll, test and delete (`ops.md` section 3).
  - Use `--primary-ipv4` with an explicitly created, labelled Primary IP. Never use `--enable-ipv4`, which does not exist.
  - Delete the server first, then the IP, and verify that both are gone.
- **Watchdog.**
  - Every resource gets labels `purpose=mindcraft-rotn-test` and `delete-after=<epoch>`.
  - An EXIT trap in the script deletes them on normal exit.
  - An **off-PC sweeper** (scheduled GitHub Actions workflow) deletes expired labelled resources even if this PC is asleep. It selects only by label.
  - The sweeper needs a Read & Write Hetzner token as a GitHub Actions secret. Write that request into `coord/STATUS-harness-ops.md` when you need it; the lead puts it in NEEDS-HUMAN. Never handle the token yourself.
  - Prove the watchdog by letting it delete a short-lived labelled server.
- **Pack.**
  - Candidate: CurseForge file 7219650 ("Rebirth of the Night 3.3.2 Server Pack.zip", 771,286,293 bytes). The human must confirm it in NEEDS-HUMAN first.
  - CurseForge publishes no hash, so record the SHA-256 on first download and pin it in the script.
  - Use the pack's own start script and heap flags as the baseline. Starting point: `-Xms4G -Xmx8G` on the CPX42.
  - The server is ready when the log shows "Done" (the pack README also mentions "Unloading dimension 7").
  - Java 8 is `openjdk-8-jre-headless` from Ubuntu noble universe.
- **Script options** for the other agents:
  - `--capture` sets JVM flag `-Dfml.debugNetworkHandshake=true` and `network-compression-threshold=-1` (net-forge Run A).
  - `--extra-mod <jar>` and `--console "<command>"` let the rotn-data dumper run, and fetch its output files (ADR 0004).
  - Console access to the **test** server is fine; never the live server.
- **Cost.** Hetzner prices may have changed in June 2026 (unverified, see NEEDS-HUMAN). Log the server type, the start and stop times, and the hourly price from `hcloud server-type describe` for each batch, not a hard-coded figure.
- **CI** needs a committed lockfile for `npm ci`. The lead owns `package.json` and the lockfile, and commits it once Node 22 is installed on this PC. Until then, CI may use `npm install`.
- **CX23.**
  - Use the unit template in `ops.md` section 2 as the starting point (`Restart=always`, `UMask=0077`, memory caps to confirm in the soak).
  - Each bot's `MINDCRAFT_PROFILES_FOLDER` is mode 0700 outside the repo.
  - The first device-code login is a human action (NEEDS-HUMAN).
- **Hetzner availability.** If CPX42 or CX23 cannot be ordered, stop and report it in your status file. The lead decides the replacement type in an ADR.
