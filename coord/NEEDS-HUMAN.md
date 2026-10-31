# Needs the human

Agents add items here when they need something only the human can do. The human ticks them off. Never put secrets in this file: say where you put them instead.

## Setup (from the initial plan)

- [ ] **Approve the dev briefs** in `docs/briefs/` once the lead has updated them after research (gate G0).
- [ ] **Task-giver list:** which Minecraft player names may give the bot tasks and control commands?
- [ ] **Node 20 on this PC** for local tests, if the lead reports a different version.
- [ ] **GitHub CLI login** on this PC (`gh auth login`) so agents can open PRs.
- [ ] **Hetzner test project + API token:** create a separate Hetzner Cloud project for test servers, create an API token there, and store it as the `HCLOUD_TOKEN` environment variable on this PC (not in the repo).
- [ ] **RotN 3.3.2 server pack URL:** the download link for the official server pack zip, so harness-ops can pin it and its checksum.
- [ ] **CX23 root login:** enter it in Orca's SSH settings for the CX23 (once, for bootstrap). An SSH key is preferred over a password.
- [ ] **OpenRouter key for the bot:** create a key with a credit limit; harness-ops will tell you where to put it on the CX23.
- [ ] **Bot Microsoft account login:** a one-time device-code login on the CX23 when harness-ops asks.
- [ ] **Whitelist the bot** on the live server when the lead asks (after G3).

## Raised by agents

(none yet)
