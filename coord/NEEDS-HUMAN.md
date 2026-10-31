# Needs the human

Agents add items here when they need something only the human can do. The human ticks them off. Never put secrets in this file: say where you put them instead.

## Setup (from the initial plan)

- [ ] **Approve the dev briefs** in `docs/briefs/` once the lead has updated them after research (gate G0).
  - **Ready for review (2026-11-01).** Each of `net-forge.md`, `rotn-data.md`, `skills-rotn.md` and `harness-ops.md` now ends with a "Phase 0 research revisions" section. The original text above it is unchanged.
  - The decisions behind them are in `docs/adr/0002`-`0004`.
  - Main changes:
    - net-forge must handle RoughlyEnoughIDs' changed packet formats. It also takes over restart and backoff (`src/process/agent_process.js`) and more dependency patches.
    - rotn-data builds a server-side dumper mod (test server only), which must also export the mod-mob ID table.
    - skills-rotn starts with safety fixes: no cheat mode, no restart after every smelt, no crash from one bad mode. It also gets the RotN first-plank interaction and the survival rules.
    - harness-ops builds the test server with cloud-init, runs an off-PC cleanup sweeper, and logs real hourly prices.
  - CLAUDE.md ownership now also gives the lead `package.json`, the lockfile and `settings.js`, and gives net-forge `src/process/agent_process.js` and the extra patch entries.
  - To approve: tick this box, or write "approved, except ..." under it. Once it is ticked, the lead starts harness-ops, then net-forge.
- [ ] **Task-giver list:** which Minecraft player names may give the bot tasks and control commands?
- [ ] **Node 20 on this PC** for local tests, if the lead reports a different version.
- [x] **GitHub CLI login** on this PC (`gh auth login`) so agents can open PRs. (Verified by rotn-lead 2026-10-31: logged in as JQDAW.)
- [ ] **Hetzner test project + API token:** create a separate Hetzner Cloud project for test servers, create an API token there, and store it as the `HCLOUD_TOKEN` environment variable on this PC (not in the repo).
- [ ] **RotN 3.3.2 server pack URL:** the download link for the official server pack zip, so harness-ops can pin it and its checksum.
  - Research found a candidate (`docs/research/rotn-progression.md`, section A): CurseForge file **7219650**, "Rebirth of the Night 3.3.2 Server Pack.zip", 735.6 MB, uploaded 2025-11-14, page https://www.curseforge.com/minecraft/modpacks/rebirth-of-the-night/files/7219650. It ships Forge 14.23.5.2860.
  - **Please confirm two things here:** (1) that this is the file your live server was built from; (2) that the live server is really on 3.3.2. Newer 3.3.3 and 3.3.4 server packs exist, and the bot must match the live server exactly.
  - CurseForge publishes no checksum, so harness-ops will record a SHA-256 on first download and pin it.
- [ ] **CX23 root login:** enter it in Orca's SSH settings for the CX23 (once, for bootstrap). An SSH key is preferred over a password.
- [ ] **OpenRouter key for the bot:** create a key with a credit limit; harness-ops will tell you where to put it on the CX23.
- [ ] **Bot Microsoft account login:** a one-time device-code login on the CX23 when harness-ops asks.
- [ ] **Whitelist the bot** on the live server when the lead asks (after G3).

## Raised by agents

- [ ] **Install Node 22 LTS on this PC** (rotn-lead, 2026-10-31; version decided by you 2026-11-01, see `docs/adr/0002-node-22.md`). Phase 0 check found **no Node.js at all**: `node` is missing in both Git Bash and PowerShell, and `C:\Program Files\nodejs` does not exist. Without it no agent can run `npm ci`, `npm test` or ESLint, so PR reviews cannot run tests. Install Node **22.x** (the "v22" MSI from https://nodejs.org/en/download, or `winget install OpenJS.NodeJS.22`). Do not take plain "LTS" without checking: the current active LTS is 24, which Mindcraft warns about. Any version manager (nvm-windows, fnm, volta) is fine as long as `node -v` prints `v22.*` in a new terminal. Restart Orca afterwards so agents see it, then tick this box.
- [ ] **Install the hcloud CLI on this PC** (rotn-lead, 2026-10-31). `hcloud` is not installed; harness-ops needs it for `deploy/test-server.sh`. Easiest: `winget install HetznerCloud.CLI` or the Windows zip from https://github.com/hetznercloud/cli/releases (put `hcloud.exe` on PATH). Check with `hcloud version`.
- [ ] **`HCLOUD_TOKEN` is not set yet** (rotn-lead, 2026-10-31). This is the "Hetzner test project + API token" item above; noting it is still open so harness-ops does not start the G0 server build before it exists. Set it as a *user* environment variable (System settings, Environment Variables), not in any file in the repo, then restart Orca so agents inherit it.
- [ ] **Check that Hetzner CPX42 and CX23 can be ordered, and at what price** (rotn-lead, 2026-11-01). Ops research (`docs/research/ops.md`, flag 4) found that Hetzner raised cloud prices on 15 June 2026, and that hetzner.com/cloud shows shared plans as "Currently not available". Both claims come from secondary sources and are not verified. When you create the test project, please look in the Cloud Console's "Add server" page and note here whether **CPX42** (test server) and **CX23** (bot VPS) can be selected in your location, and their hourly price. If either is unavailable, the lead will write an ADR for an alternative type (e.g. CCX or a CPX of the same size). The plan's EUR 0.138/h figure may be out of date.
- Toolchain that is fine: git 2.54, `gh` logged in as JQDAW (scopes repo + workflow), Orca 1.4.245 running, `upstream` remote present. I ticked the GitHub CLI login item above.
