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

- Bootstrap with the root login once: create a `deploy` user with an SSH key, disable root and password login, enable unattended security updates, firewall SSH only, 2 GB swap, Node 20.
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
