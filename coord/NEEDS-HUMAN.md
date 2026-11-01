# Needs the human

Agents add items here when they need something only the human can do. The human ticks them off. Never put secrets in this file: say where you put them instead.

## Open

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
