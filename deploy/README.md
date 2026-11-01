# deploy/

Owner: harness-ops. Test server first (gate G0); CX23 provisioning, the systemd unit and deploys come later.

## Disposable RotN 3.3.4 test server

`deploy/test-server.sh` builds a fresh RotN 3.3.4 Forge server on a Hetzner CPX42 in the **test project**, and deletes it afterwards. It never touches the live server.

- The PC runs only `hcloud`: create, poll, test and delete.
- cloud-init does the whole build on the box (`test-server/build.sh`):
  1. Installs Java 8 (`openjdk-8-jre-headless`, noble universe), plus `unzip`, `tmux`, `jq` and `ufw`. The firewall allows 22 and 25565 only.
  2. Gets the pack. It tries the CurseForge 3.3.4 server file (id 7564549) first and keeps it only if its SHA-256 equals the ADR 0005 pin (`90642fd5...f5205`). Otherwise the PC uploads the local zip over SSH, after checking it against the same pin.
  3. Unpacks it with default configs. It changes only `online-mode=true` and `white-list=true` (plus `network-compression-threshold=-1` with `--capture`). The world is fresh every time. `eula=true` is shipped by the pack and re-asserted.
  4. Writes `whitelist.json` before the first start, with UUIDs the PC resolved from Mojang's profile API. 1.12.2's own `whitelist add` uses a legacy lookup that is known to fail, and Mojang blocks some datacenter IPs.
  5. Starts `forge-1.12.2-14.23.5.2860.jar` with `-Xms4G -Xmx8G` as user `minecraft`, in a tmux console under systemd (`rotn-server.service`).
  6. Waits for the `Done (...)! For help` line, then checks that every name is still whitelisted. A missing name fails the build.

### Commands

Run from Git Bash on Windows or bash on Linux. The scripts only ever use the hcloud context `mindcraft-rotn-test` (the test project):

- Every call passes `--context mindcraft-rotn-test`, with `HCLOUD_TOKEN` and `HCLOUD_CONTEXT` removed from hcloud's environment.
- Any other `--context` or `$HCLOUD_CONTEXT` is refused before the first call.
- Only the GitHub sweeper runs without a context (`ROTN_HCLOUD_AUTH=env-token`, accepted only when `GITHUB_ACTIONS=true`).

```bash
# Batch: create, run a command, always delete (server, then Primary IPv4, then SSH key; verified).
deploy/test-server.sh run --yes -- test/scenarios/g0-test-server.sh

# Interactive: leave it up (deleted by `down` or by the watchdog at delete-after, default 8 h).
deploy/test-server.sh up --yes [--capture] [--extra-mod dumper.jar] [--console "cmd"] [--fetch path]
deploy/test-server.sh console "list"     # type into the server console
deploy/test-server.sh fetch logs         # copy /opt/rotn/server/logs into the batch's out/
deploy/test-server.sh verify             # key=value G0 facts from the box
deploy/test-server.sh down               # delete and verify

deploy/test-server.sh list               # labelled resources and time left
deploy/test-server.sh up --dry-run       # show the create commands and cost, create nothing
```

Options for the other agents:

- **net-forge Run A:** `--capture` sets `-Dfml.debugNetworkHandshake=true` and `network-compression-threshold=-1`. Then use `fetch logs`.
- **rotn-data dumper (ADR 0004):** `--extra-mod tools/dumper/build/libs/<jar>` uploads the jar before the first start. `--console "<dump command>"` runs once the server is ready, and `--fetch <output dir>` copies the files into `--out DIR`.
- **Whitelist:** `--whitelist NAME` or `NAME:UUID`, repeatable. The default is `FRCFLD JQDAW` (the bot and the task giver), or `$ROTN_TEST_WHITELIST`. A name that cannot be resolved stops the script before anything is created.
- **Timeouts:** `--ready-timeout` (120 min) starts again after a pack upload, because the upload, unpacking and the first Forge start all count against it.

Inside `run`, the command gets `TEST_SERVER_NAME`, `TEST_SERVER_HOST`, `TEST_SERVER_PORT`, `TEST_SERVER_STATE_DIR` and `TEST_SERVER_CTL` (this script).

### Cleanup guarantees

| Layer | What it does |
| --- | --- |
| Labels | Every server, Primary IP and SSH key gets `purpose=mindcraft-rotn-test`, `delete-after=<epoch>` and `batch=<name>`. |
| EXIT trap | `run` always deletes. `up` deletes if the build fails (unless `--keep-on-failure`). Deletion runs server first, then the IP, then the key, and checks that each is gone. |
| Off-PC sweeper | `.github/workflows/test-server-sweeper.yml` runs every 15 min from `develop`. It deletes labelled resources whose `delete-after` has passed, selecting only by label. No `delete-after` keeps a labelled resource alive past created + 24 h + 30 min. The job fails if an expired labelled resource survives. Watchdog-control servers (`purpose=mindcraft-rotn-watchdog-control`) are never selected by the test label; the sweeper deletes them at their own `control-expires` label plus 30 min. |
| Guards | No create without `--yes` (or a TTY prompt). Any leftover labelled server, Primary IP or SSH key blocks a new batch unless `--allow-multiple` is passed. The TTL is at most 24 h. Each batch has its own SSH key, so Hetzner sends no root-password email. |

The sweeper needs a GitHub Environment named `hetzner-test-sweeper`:

- Its deployment branches are limited to `develop`.
- It holds the secret `HCLOUD_TOKEN`: a Read & Write token of the **test** project, set by the human.

Watchdog acceptance test: `test/scenarios/g0-watchdog.sh --yes --mode dispatch` (or `scheduled`). It passes only if both of these hold:

- The target is gone within one interval (15 min, plus 5 min for the run).
- The control is still there. The control has the same expired `delete-after` as the target but no test label, so it proves the sweeper selects by label.

The script's cleanup deletes only the IDs its own creates returned.

GitHub disables scheduled workflows in a public repository after 60 days without repository activity. If the sweeper's run history stops, re-enable it under Actions -> test-server-sweeper.

### What fires the sweeper, and the preflight

On 2026-11-01, GitHub ran almost no scheduled workflows for this account:
- `test-server-sweeper.yml` here (a fork) fired once in about 11 h with `*/15`, and 0 of 8 slots at the off-peak minutes `7,22,37,52`.
- The non-fork helper repo **`JQDAW/rotn-sweeper-cron`** (`dispatch-sweeper.yml`, cron `3,18,33,48`, runs `gh workflow run test-server-sweeper.yml --repo JQDAW/mindcraft-RotN --ref develop` with its own fine-grained token) fired in none of its first three slots.
- githubstatus showed no incident.

So the human set up an **external cron service** (cron-job.org). Every 15 min it POSTs to `/repos/JQDAW/mindcraft-RotN/actions/workflows/test-server-sweeper.yml/dispatches` with body `{"ref":"develop"}`, using a separate fine-grained token. Its runs show up here as `workflow_dispatch` runs by JQDAW. The sweeper's own cron and the helper stay as extra sources.

Before any create, `up` and `run` (which calls `up`) require **one** of these:

| Path | Evidence (read-only `gh run list --repo ...`) |
| --- | --- |
| (a) own schedule | A successful `event=schedule` run of `test-server-sweeper.yml` on `develop`, at most `ROTN_SWEEPER_MAX_AGE_MIN` old (default 120, allowed 15..240). |
| (b) helper | A successful `event=schedule` run of `dispatch-sweeper.yml` in `ROTN_SWEEPER_HELPER_REPO` (default `JQDAW/rotn-sweeper-cron`), at most 40 min old, **and** a successful `test-server-sweeper.yml` run (any event) on `develop` created after it. |
| (c) cadence | At least **3** successful `workflow_dispatch` runs of `test-server-sweeper.yml` on `develop` in the last **50 min**; **every** gap between consecutive ones is **10..20 min**; the newest is **under 20 min** old. This is what the external cron service produces. |

- A one-off `workflow_dispatch` run of the sweeper never counts. Neither does a manual run of the helper. Both prove that the token and the logic work, not that anything fires on a schedule.
- (b) cannot prove that the helper's run is the one that dispatched the sweeper run after it. GitHub does not link a dispatched run to its caller, and every caller acts as JQDAW. Any successful sweeper run created after a scheduled helper run counts, including a cron-job.org run or a manual one. What (b) proves is that something off this PC fired on a schedule within 40 min, and that the sweeper worked since then.
- Run ages are measured against GitHub's clock: the `Date` header of one read-only `gh api -X GET -i rate_limit`. A PC clock that is minutes off cannot make a stale run look fresh. If that header cannot be read, the preflight warns and uses this PC's clock.
- Before any path is tried, the newest completed sweeper run on `develop` (any event) must not have failed, timed out or failed to start. A just-broken sweeper, such as a revoked token or a persistent ALERT, blocks paid batches.
- In (c), every successful dispatch run in the window counts. An extra manual run between two cron runs therefore makes a gap under 10 min, and (c) refuses for up to 50 min. A missed or failed cron run makes a gap over 20 min.
- Every `gh` call names its repo with `--repo`, and `GH_REPO` and `GH_HOST` are stripped. The preflight never handles a token: `gh` uses the local login.
- The OK line says which path passed, e.g. `sweeper OK (via cadence): cadence of 3 dispatch runs on develop in the last 50 min, gaps 15, 15 min, newest ... 1 min ago`. A refusal gives the reason for every path.

> **Rule: agents never dispatch `test-server-sweeper.yml` to make a cadence**, by any means: `gh workflow run`, the REST API, or a loop or timer on this PC. Path (c) trusts that its `workflow_dispatch` runs come from the external cron service, which runs off this PC. A cadence an agent makes on this PC proves nothing when this PC is asleep or crashed, which is exactly when the sweeper matters. The one exception is `test/scenarios/g0-watchdog.sh --mode dispatch` in a lead-approved watchdog proof. Its single extra run breaks the cadence, so (c) refuses for up to 50 min afterwards; that is fail-safe.
>
> The external service's token and job belong to the human. Agents never handle them.

**Keep-alive.** GitHub also disables the **helper's** schedule after 60 days without activity in the helper repo, and from then on path (b) refuses.
- When path (b) passes, the preflight reads the helper repo's last push with one read-only `gh api -X GET repos/JQDAW/rotn-sweeper-cron`. From day 45 it prints a warning: push any small commit to the helper repo, for example to its README. If the schedule is already disabled, re-enable `dispatch-sweeper` under the helper repo's Actions tab.
- The warning never blocks a batch.
- The fine-grained token also expires. When it does, the helper's runs fail, path (b) refuses, and the refusal points at the helper repo's Actions tab. The human then renews the token and updates the secret.

### Local state and cost log

Local state lives outside the repo, in `~/.mindcraft-rotn/test-server/` (override with `ROTN_TEST_STATE_DIR`):

- `active/<batch>/` holds the batch's SSH key, `known_hosts`, `meta.env`, `user-data.yaml`, `verify.txt` and `ping.json`.
- It moves to `archive/` after `down`, and the private key is removed.
- `ledger.jsonl` logs each batch's server type, location, the hourly gross price read from `hcloud server-type describe`, start and stop times, billed hours (each started hour) and the estimated cost, excluding the Primary IPv4.

### Tests

`npm test` covers `test/unit/test-server.test.js` and `test/unit/status-ping.test.js`. They are offline: `hcloud`, `ssh` and `scp` are fakes, driven through the real scripts.
