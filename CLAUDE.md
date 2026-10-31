# Mindcraft-RotN: project rules for every agent

This repo is a fork of [mindcraft-bots/mindcraft](https://github.com/mindcraft-bots/mindcraft). The goal is an LLM-driven bot that plays the Minecraft 1.12.2 modpack **Rebirth of the Night (RotN) 3.3.4** on a Forge server, running on a Hetzner CX23 VPS.

The single success criterion is **ready-to-try**: every item in `docs/PLAN.md` -> "Definition of ready-to-try" passes in a harness scenario on the real CX23. An agent's claim that something works does not count.

Read `docs/PLAN.md` once at the start of every session. Read your own brief in `docs/briefs/` if you have one.

## Pinned versions (do not change without an ADR)

| Thing | Version |
| --- | --- |
| Minecraft | 1.12.2 (Forge, FML protocol 2) |
| RotN pack | 3.3.4, server pack zip SHA-256 `90642fd5...f5205`, default configs (ADR 0005) |
| Node.js | 22 LTS (ADR 0002; mineflayer 4.26+ needs >=22, Mindcraft warns that v24+ breaks native deps) |
| Java on test server | 8 |
| Integration branch | `develop` (this fork's default branch) |
| Bot OS | Ubuntu 24.04 on the CX23 |

## Who does what

| Agent | Kind | Owns (only it edits these) |
| --- | --- | --- |
| rotn-lead | Main Claude Code session, Orca main worktree | `docs/PLAN.md`, `docs/adr/`, `docs/research/`, `docs/briefs/`, `coord/`, `package.json` + lockfile, root `settings.js`, merges into `develop`, release tags |
| net-forge | Dev agent, own Orca worktree | `packages/forge-bridge/`, `patches/` entries for mineflayer, minecraft-protocol, protodef, prismarine-chunk, minecraft-data, mineflayer-pathfinder, mineflayer-pvp and prismarine-viewer, the `initBot` part of `src/utils/mcdata.js`, `src/process/agent_process.js` |
| rotn-data | Dev agent, own Orca worktree | `packages/rotn-data/`, `tools/dumper/`, the name/registry helpers in `src/utils/mcdata.js` |
| skills-rotn | Dev agent, own Orca worktree | `src/agent/` (skills, commands, modes, self_prompter, new task queue), `profiles/` |
| harness-ops | Dev agent, own Orca worktree | `test/`, `deploy/`, `.github/workflows/`, `TRY_IT.md` |
| research + reviewer subagents | Defined in `.claude/agents/` | Nothing. They return reports; the lead files them in `docs/research/` |

Anything not listed above (for example `main.js`, `src/mindcraft/`, `src/models/`, other `src/utils/` files, `tasks/`, `eslint.config.js`, `.gitignore`, `.claude/`) is owned by rotn-lead. Request changes through your status file.

`src/utils/mcdata.js` is shared by net-forge and rotn-data. Change it only in the functions your brief names, and keep each PR's diff to that file small.

Need a change in a file you do not own? Write it in your `coord/STATUS-<agent>.md` under "Requests" and let the lead route it.

## Workflow rules

- Work on your own branch (`agent/<agent-name>/<topic>`), never directly on `develop`. Only rotn-lead merges into `develop`.
- Every PR states which brief item or gate it serves and how it was tested. The `independent-reviewer` subagent reviews it before the lead merges.
- Keep `coord/STATUS-<agent>.md` current: done, doing, blocked, requests. Update it at least whenever you open a PR or get blocked.
- Anything that needs the human (logins, keys, payments, server admin actions, decisions) goes into `coord/NEEDS-HUMAN.md`. Do not wait silently.
- Decisions that change the plan get an ADR in `docs/adr/` (copy `0000-template.md`).
- Prefer small, test-backed changes. Mindcraft upstream code stays recognizable, so upstream fixes can still be merged from the `upstream` remote.

## Security rules (non-negotiable)

- Never read, print, commit or copy: `keys.json`, `.env*`, token caches (`nmp-cache`, `*.token`), SSH keys, Hetzner API tokens. Use environment variables and placeholders in code and docs.
- `allow_insecure_coding` stays `false` in every committed settings file.
- No `--dangerously-skip-permissions` anywhere.
- The live RotN server is the human's. Agents never get op, console or RCON on it. Tests run on the disposable CPX42 test server only.
- Hetzner test servers must be deleted (not just powered off) after each test batch, and must have a delete-after watchdog (default 8 hours).

## Useful facts about this codebase

- Bot creation, `minecraft-data` and item helpers: `src/utils/mcdata.js` (`initBot`, `WOOD_TYPES`, recipe helpers). This is the main vanilla-1.21 seam.
- Skills: `src/agent/library/skills.js` (~2,100 lines), world queries: `src/agent/library/world.js`.
- Chat commands: `src/agent/commands/actions.js` and `queries.js` (e.g. `!goal`, `!collectBlocks`, `!craftRecipe`).
- Reflex behaviors: `src/agent/modes.js`. Autonomous loop: `src/agent/self_prompter.js`.
- Prompts and examples: `profiles/defaults/*.json`. LLM providers: `src/models/` (`openrouter.js` reads `OPENROUTER_API_KEY`).
- Dependency patches are applied by patch-package from `patches/`. `package-lock.json` is committed (lead-owned); use `npm ci`. mineflayer is pinned to exactly 4.33.0 to match its patch. The minecraft-data patch name (3.97.0) is older than the installed 3.119.0, which patch-package accepts with a warning; net-forge renames it when it next touches that patch.
- `npm test` runs `node --test` on exactly three patterns: `packages/*/test/**/*.test.js`, `test/unit/**/*.test.js` and `src/**/*.test.js`. Unit tests must be offline (no Minecraft server, no Hetzner, no LLM calls). Harness scenarios live elsewhere under `test/` and never match these patterns. `postinstall` uses `patch-package --error-on-fail`, so a patch that no longer applies fails the install. `npm run lint` runs ESLint. The **lint baseline on `develop` is 259 errors**, all from upstream Mindcraft (semi 120, no-undef 44, no-floating-promise 37, require-await 29, others 9). "No new ESLint errors" means a PR does not raise the error count in the files it touches.
- `main.js` lets env vars override settings: `MINECRAFT_PORT`, `MINDSERVER_PORT`, `PROFILES`, `BLOCKED_ACTIONS`, etc. Keys can also come from env vars (`src/utils/keys.js`).
