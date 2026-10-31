# ADR 0001: Initial architecture and decisions

- Status: accepted
- Date: 2026-10-31
- Author: human + planning session

## Context

Mindcraft targets vanilla Java 1.21.x through mineflayer. The target server runs Forge 1.12.2 with Rebirth of the Night 3.3.2, which needs an FML handshake, registry sync and RotN-specific knowledge. The bot runs on a 4 GB Hetzner CX23.

## Decision

- Keep Mindcraft's LLM brain. Build a Forge network layer (`packages/forge-bridge`), a RotN data layer (`packages/rotn-data`, `tools/dumper`) and RotN skills under it.
- Coordinate with one lead Claude Code session in Orca; research through Claude Code subagents; development through separate Orca worktrees, one agent per area with exclusive file ownership.
- Human answers recorded on 31 Oct 2026: the human admins the live server; RotN 3.3.2; root SSH to the CX23 for one-time bootstrap; OpenRouter as LLM provider; autonomous bot with player tasks as priorities; one bot now, multi-bot ready.
- Test server: disposable Hetzner CPX42, built from scratch from the official server pack zip for each batch, then deleted.
- `allow_insecure_coding` stays off.

## Consequences

- Gate 1 (FML login spike) decides whether the mineflayer route is viable. If not, a new ADR picks between a headless real client and a server-side puppet mod.
- Agents never get admin rights on the live server.
