# Gate G0 evidence: test-server half (2026-11-01)

Two real batches in the Hetzner **test** project (hcloud context `mindcraft-rotn-test`), run by harness-ops from `agent/harness-ops/g0-evidence` at commit `31cefa0` (develop `70c5c3a` plus the re-review nits). The sweeper ran from `develop`. Nothing touched the live server.

## 1. G0 build: the test server builds from the pinned pack and runs RotN 3.3.4

Command: `deploy/test-server.sh run --yes -- test/scenarios/g0-test-server.sh`

| Item | Value |
| --- | --- |
| Batch | `mcr-test-20261101-003243`, server 173872455, `cpx42`, `ubuntu-24.04`, `nbg1`, TTL 8 h |
| Start / stop (UTC) | 00:32:37 command start, 00:32:44 create, 00:35:52 ready, 00:36:16 deletion verified |
| Result | **21 passed, 0 failed** (`g0-result.json`) |
| Pack | CurseForge file 7564549 downloaded on the server; SHA-256 `90642fd5...f5205` matches the ADR 0005 pin (`pack_source=download`, so the upload fallback was not needed) |
| Server | Java `1.8.0_504`, Forge `14.23.5.2860`, RoughlyEnoughIDs 2.2.2, 338 mod jars, `online-mode=true`, whitelist on (FRCFLD, JQDAW), "Done (17.914s)", heap `-Xms4G -Xmx8G`, Java RSS 4194 MB of 15608 MB |
| From outside | Status ping: 1.12.2 / protocol 340, `modinfo.type=FML`, 346 mods incl. `forge` 14.23.5.2860 and `jeid` 2.2.2 (`status-ping.json` has the full mod list) |
| Console | `list` round-trip works ("There are 0/10 players online") |
| Teardown | EXIT trap deleted the server, then its Primary IPv4, then its SSH key, and verified all three gone. Project-wide `hcloud server list` / `primary-ip list` were empty at 00:36:21 (`project-empty-checks.txt`) |
| Cost | 212 s run, 1 billed hour x EUR 0.138136 (gross, `hcloud server-type describe cpx42`, nbg1) = **EUR 0.14**, plus the Primary IPv4 for 1 hour (its price is not exposed by `server-type describe`; it is a small fraction of the server price) |

## 2. Watchdog acceptance test: off-PC sweeper deletes by label only

Command: `test/scenarios/g0-watchdog.sh --yes --mode dispatch` (dispatches `test-server-sweeper.yml` on `develop`)

| Item | Value |
| --- | --- |
| Batch | `mcr-wd-20261101-003652` |
| Start / stop (UTC) | 00:36:52 start, 00:37:25 all four resources created, 00:38:18 cleanup verified |
| Target | server 173873036 (`cx23`), labels `purpose=mindcraft-rotn-test`, `delete-after=now-60`; its own Primary IPv4 159353814 with auto-delete **off**; SSH key 132037905 |
| Control | server 173873069 (`cx23`, IPv6 only), the same expired `delete-after`, but `purpose=mindcraft-rotn-watchdog-control` instead of the test label |
| Sweeper | GitHub Actions run [41257552258](https://github.com/JQDAW/mindcraft-RotN/actions/runs/41257552258) (`workflow_dispatch`, develop, Environment `hetzner-test-sweeper`): deleted the target server, then its Primary IP, then its SSH key: "3 deletion(s), status 0" (`sweeper-run-41257552258.log`) |
| Result | **PASS**: target, Primary IPv4 and SSH key gone **34 s** after creation (limit: one 15-min interval + 5 min); control untouched by the sweeper, then deleted by the script's own cleanup by ID (`watchdog-result.json`) |
| Teardown | Project-wide `hcloud server list` / `primary-ip list` empty at 00:38:24; only the human's unlabelled SSH key remains (`project-empty-checks.txt`) |
| Cost | 2 x `cx23`, 1 billed hour each x EUR 0.010912 (`hcloud server-type describe cx23`, nbg1) = **EUR 0.02**, plus the target's Primary IPv4 for 1 hour. Calculated by hand: `g0-watchdog.sh` does not write to the cost ledger |

An earlier dry-run dispatch, [41257157372](https://github.com/JQDAW/mindcraft-RotN/actions/runs/41257157372) at 00:32:00, confirmed the Environment token works before anything was created ("0 deletion(s)").

## Total

Both batches: about **EUR 0.16** plus two Primary IPv4-hours, against a stated maximum of about EUR 1.29. Both batches ran within plan.

## Files

| File | What |
| --- | --- |
| `g0-batch.log`, `watchdog-batch.log` | Full console output of both batches |
| `g0-result.json`, `verify.txt` | Scenario checks and the on-server facts they read |
| `status-ping.json` | 1.12.2 status response with the FML mod list (346 mods) |
| `watchdog-result.json`, `sweeper-run-41257552258.log` | Watchdog verdict and the sweeper's own log lines |
| `cost-ledger.jsonl` | `deploy/test-server.sh`'s ledger for the G0 build batch (start, stop, run seconds, billed hours, estimate) |
| `project-empty-checks.txt` | Project-wide server, Primary IP and SSH key listings after each batch |

The IP addresses in these logs belonged to deleted test servers. No tokens, keys or passwords are in these files.
