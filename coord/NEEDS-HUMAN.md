# Needs the human

Agents add items here when they need something only the human can do. The human ticks them off. Never put secrets in this file: say where you put them instead.

## Open

- [ ] **Approve the dev briefs** in `docs/briefs/` (gate G0, human half).
  - Each of `net-forge.md`, `rotn-data.md`, `skills-rotn.md` and `harness-ops.md` ends with a "Phase 0 research revisions" section. The original text above it is unchanged, except that the RotN version now says 3.3.4.
  - Decisions behind them: `docs/adr/0002`-`0005`.
  - Main changes:
    - **net-forge** handles RoughlyEnoughIDs' changed packet formats. It also takes over restart and backoff, using a shared exit-code contract (0 clean stop, 1 retry, 3 fatal), plus more dependency patches.
    - **rotn-data** builds a server-side dumper mod (test server only) that also exports the mod-mob ID table, and emits recipes that skills-rotn can execute.
    - **skills-rotn** starts with safety fixes (no cheat mode, no restart after every smelt, no crash from one bad mode), then the RotN first-plank interaction and the survival rules. It also owns real crafting on the server. `JQDAW` is the first task giver.
    - **harness-ops** builds the test server with cloud-init, from the 3.3.4 zip pinned by SHA-256. It runs an off-PC cleanup sweeper whose token lives in a restricted GitHub Environment, never lets env files turn on insecure coding, and logs real hourly prices.
  - To approve: tick this box, or write "approved, except ..." under it. The lead then starts harness-ops, then net-forge.
- [ ] **Restart Orca (and this Claude session) once** (rotn-lead, 2026-11-01). Node 22.23.4 (nvm-windows) and hcloud 1.70.2 (winget) are installed, and `HCLOUD_TOKEN` is set as a user variable. Processes started before you installed them, including Orca and the current lead session, do not see the new PATH or the token. Dev agents spawned from the current Orca would not see them either. After the restart, `node -v` and `hcloud version` should work in a new Orca terminal.
- [ ] **Decide what happens to the CPX42 `mindcraft-test-env`** (rotn-lead, 2026-11-01).
  - Your test project has one running server: `mindcraft-test-env`, CPX42, hel1, about 1 h old, **no labels**, plus its IPv4 and IPv6 Primary IPs (auto-delete on).
  - It costs EUR 0.138/h (about EUR 3.30/day) while it exists.
  - The plan builds a fresh labelled server for each test batch and deletes it afterwards. The watchdog only touches labelled servers, so it would never clean this one up.
  - The lead asked you in chat; record your answer here.
- [ ] **Bot Microsoft account: sign in once on this PC** (rotn-lead, 2026-11-01, from the PR #2 review). The test server runs in online mode, so net-forge's G1 spike needs the bot's own Microsoft/Minecraft account signed in on the machine where it runs.
  - Please note here **which Minecraft account name the bot will use** (it must own Java Edition, and not be `JQDAW`).
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
- [x] **Server pack**: you chose `C:\Users\admin\source\RotN 3.3.4 Server Pack.zip` (SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`). The project is now pinned to **RotN 3.3.4** (ADR 0005). The lead assumes your live server runs exactly this pack with default configs; please say so here if it does not.
- [x] **Task-giver list**: `JQDAW` (2026-11-01). Others will be added later.
