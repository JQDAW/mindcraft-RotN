# Needs the human

Agents add items here when they need something only the human can do. The human ticks them off. Never put secrets in this file: say where you put them instead.

## Open

- [ ] **The off-PC sweeper runs far too rarely on its schedule** (rotn-lead, 2026-11-01 02:05 UTC; updated 11:15 UTC).
  - **Update, 11:15 UTC:** one scheduled run did happen, at 06:30:54 UTC (success). That is the only one in about 10 h on a `*/15` cron, so the schedule is registered but GitHub drops almost every run.
  - The lead has authorized harness-ops to move the cron to off-peak minutes (`7,22,37,52 * * * *`) in a small reviewed PR. Busy :00/:15/:30/:45 marks are a known cause of dropped runs, and merging the change also re-registers the schedule.
  - Steps 1-2 below are still worth a look if you have a minute. If you check the Actions tab, please note here what it shows.
  - Original report (02:05 UTC): This blocks every paid test batch, because `deploy/test-server.sh up` refuses until a scheduled sweeper run exists.
  - **Facts.**
    - `test-server-sweeper.yml` has been on `develop` (the default branch) since 00:25 UTC, with `cron: '*/15 * * * *'`, and its state is `active`.
    - It ran twice through manual dispatch (00:32, 00:37, both successful), but there has been **no `event=schedule` run in 1 h 40 min**.
    - GitHub's docs say nothing about forks for `schedule`. Community reports say scheduled workflows are often off by default in **forks** (this repo is a fork of mindcraft-bots/mindcraft), or never fire until the workflow is re-registered.
  - **The lead tried to disable and re-enable the workflow with `gh`.** Claude Code's permission check blocked that as a CI change, which is right: it is your decision.
  - Please try, in order. Stop as soon as a scheduled run appears in the Actions tab; allow about 30 minutes after each step.
    1. GitHub, repo **Actions** tab. If there is a banner about workflows or scheduled workflows being disabled in this fork, click to enable them.
    2. Actions, **test-server-sweeper**, "..." menu, **Disable workflow**, then **Enable workflow**.
    3. If still nothing: tell the lead. Options then:
       - have harness-ops commit a trivial change to the cron line (this re-registers the schedule);
       - ask GitHub Support;
       - detach the repo from the fork network (Settings, a GitHub Support request; a big change, your call);
       - trigger the sweeper from an outside scheduler through `workflow_dispatch`.
  - Sources the lead read:
    - https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
    - https://github.com/orgs/community/discussions/203880
    - https://github.com/orgs/community/discussions/205999
- [ ] **Ready now: one-time FRCFLD device-code login** (net-forge via rotn-lead, 2026-11-01). Needed for net-forge's online G1 run.
  - **About the helper.** `packages/forge-bridge/tools/msa-login.mjs`, reviewed line by line and merged in PR #10 (`26a0b5e`).
    - It contacts only Microsoft/Xbox/Minecraft login servers.
    - It prints only Microsoft's sign-in instruction and the profile name.
    - It writes only token-cache files into the folder below, outside the repo.
    - The lead checked that `DEBUG` is not set on this PC. If it were, the auth library could print tokens, so step 2 clears it anyway.
  - **Steps.** Use a new **PowerShell** window of your own, not an agent's terminal:

    ```powershell
    cd C:\Users\admin\source\mindcraft-RotN
    git log -1 --format="%h %s"          # should start with 26a0b5e or later on develop
    Remove-Item Env:DEBUG -ErrorAction SilentlyContinue
    $env:MINDCRAFT_PROFILES_FOLDER = "C:/Users/admin/.mindcraft-rotn/FRCFLD/msa"
    & "C:\nvm4w\nodejs\node.exe" packages/forge-bridge/tools/msa-login.mjs FRCFLD
    ```

    1. It prints a message like "To sign in, use a web browser to open https://www.microsoft.com/link and enter the code XXXXXXXX".
    2. Open that page, enter the code, and sign in with the **bot account**. Type the credentials **only there**.
    3. Back in PowerShell it should end with `Signed in. Minecraft profile: FRCFLD`.
  - **Afterwards:** tick this box and write here only whether the profile name was `FRCFLD`. Never paste the code, the email, the password or anything from the cache folder.
- [x] **Create a GitHub Environment for the off-PC test-server sweeper**: done by the human on 2026-11-01. The lead verified through the API: environment `hetzner-test-sweeper`, deployment branch policy `develop` only, environment secret `HCLOUD_TOKEN` (name only), no repository-level secrets. (harness-ops via rotn-lead, 2026-11-01) The sweeper deletes expired test servers even if this PC is asleep. Its token must live in an Environment that only `develop` can use, so a workflow changed on an agent branch cannot read it.
  1. https://github.com/JQDAW/mindcraft-RotN/settings/environments, "New environment", name **`hetzner-test-sweeper`**.
  2. "Deployment branches and tags": choose "Selected branches", add **`develop`** only. "Required reviewers": none, otherwise every scheduled run would wait for you.
  3. Add an **environment secret** (not a repository secret) named **`HCLOUD_TOKEN`**. Its value is a **new Read & Write API token of the Hetzner test project** (Hetzner console, test project, Security, API tokens). Make a separate token for this, so either one can be revoked on its own.
  - Needed for the watchdog proof (G0). No agent ever sees the token.
- [x] **Approve the dev briefs** in `docs/briefs/` (gate G0, human half). **Approved by the human in chat, 2026-11-01.**
  - Each of `net-forge.md`, `rotn-data.md`, `skills-rotn.md` and `harness-ops.md` ends with a "Phase 0 research revisions" section. The original text above it is unchanged, except that the RotN version now says 3.3.4.
  - Decisions behind them: `docs/adr/0002`-`0005`.
  - Main changes:
    - **net-forge** handles RoughlyEnoughIDs' changed packet formats. It also takes over restart and backoff, using a shared exit-code contract (0 clean stop, 1 retry, 3 fatal), plus more dependency patches.
    - **rotn-data** builds a server-side dumper mod (test server only) that also exports the mod-mob ID table, and emits recipes that skills-rotn can execute.
    - **skills-rotn** starts with safety fixes (no cheat mode, no restart after every smelt, no crash from one bad mode), then the RotN first-plank interaction and the survival rules. It also owns real crafting on the server. `JQDAW` is the first task giver.
    - **harness-ops** builds the test server with cloud-init, from the 3.3.4 zip pinned by SHA-256. It runs an off-PC cleanup sweeper whose token lives in a restricted GitHub Environment, never lets env files turn on insecure coding, and logs real hourly prices.
  - To approve: tick this box, or write "approved, except ..." under it. The lead then starts harness-ops, then net-forge.
- [x] **Restart Orca**: done 2026-11-01. Node 22 and hcloud now resolve in Orca terminals.
- [x] **hcloud context**: the human created `mindcraft-rotn-test` (2026-11-01). The lead verified it is active and that `hcloud server list` succeeds with `HCLOUD_TOKEN` unset (the project is empty). Orca terminals do not get the `HCLOUD_TOKEN` user variable; the context replaces it. The token lives in `%APPDATA%\hcloud\cli.toml`, which agents never read.
- [x] **Orca skip-permissions launch option turned off** by the human (2026-11-01). Earlier, `orca worktree create --agent claude` had added `--dangerously-skip-permissions`; the lead declined that prompt, so nothing ran in bypass mode. The lead still checks each new agent's launch screen.
- [x] **CPX42 `mindcraft-test-env`**: the human chose to delete it (2026-11-01). The lead deleted server 173843514. Its IPv4 and IPv6 Primary IPs went with it (auto-delete), and the test project is empty.
- [ ] **Bot Microsoft account: sign in once on this PC** (rotn-lead, 2026-11-01, from the PR #2 review). The test server runs in online mode, so net-forge's G1 spike needs the bot's own Microsoft/Minecraft account signed in on the machine where it runs.
  - **Nobody needs your credentials.** You have the bot account's login and rightly keep it out of the repo and the chat. A device-code login means you type the email and password only on Microsoft's own page (microsoft.com/link), never in a terminal, file or chat.
  - **Bot player name: `FRCFLD`** (given by the human, 2026-11-01). harness-ops whitelists FRCFLD and JQDAW on the test server. The bot profile's name must equal `FRCFLD` (PLAN, multi-bot readiness).
  - When net-forge is ready, it will ask you to run a one-time device-code login: open a URL and type a code. The token cache will be written to a folder outside the repo, e.g. `C:\Users\admin\.mindcraft-rotn\<bot>\msa`.
  - Never paste a code or password in chat or in this file.
- [ ] **CX23 root login:** enter it in Orca's SSH settings for the CX23 (once, for bootstrap). An SSH key is preferred over a password.
- [ ] **OpenRouter key for the bot:** create a key with a credit limit; harness-ops will tell you where to put it on the CX23.
- [ ] **Bot Microsoft account login on the CX23:** a one-time device-code login on the CX23 when harness-ops asks.
- [ ] **Whitelist the bot** on the live server when the lead asks (after G3).

## Done

- [x] **GitHub CLI login** on this PC: logged in as JQDAW (verified 2026-10-31). `gh` now defaults to `JQDAW/mindcraft-RotN`.
- [x] **Node 22 on this PC**: v22.23.4 via nvm-windows (verified 2026-11-01). ADR 0002.
- [x] **hcloud CLI**: 1.70.2 via winget (verified 2026-11-01).
- [x] **Hetzner test project + `HCLOUD_TOKEN`**: set as a user environment variable (presence verified, value never read into chat; 2026-11-01).
- [x] **Server types available, and prices**: CPX42 EUR 0.1381/h and CX23 EUR 0.0109/h gross, read from the Hetzner API on 2026-11-01. The research's "price increase / not available" flag was wrong.
- [x] **Server pack**: you chose `C:\Users\admin\source\RotN 3.3.4 Server Pack.zip` (SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`). The project is now pinned to **RotN 3.3.4** (ADR 0005). The human confirmed on 2026-11-01 that the live server runs exactly this pack with default configs.
- [x] **Task-giver list**: `JQDAW` (2026-11-01). Others will be added later.
