# Mindcraft-RotN plan

Owner: rotn-lead. Source: the concept doc agreed with the human on 31 Oct 2026. The lead keeps this file current; other agents propose changes through their status file.

## Goal

An autonomous LLM bot that joins the human's Rebirth of the Night 3.3.2 server (Forge 1.12.2, online mode) with its own Microsoft account. It plays on its own, takes tasks from trusted players as priorities, and runs on a Hetzner CX23. "Done" means every item in the ready-to-try list below passes.

## Confirmed decisions

| Topic | Decision |
| --- | --- |
| Server | The human admins it. RotN 3.3.2, default server pack configs. Bot is whitelisted. Small server-side helper mods are allowed when they save real work. Agents never get admin access to the live server. |
| Test server | Hetzner CPX42 (8 vCPU, 16 GB, 320 GB), EUR 0.138/h, EUR 86.17/month cap. Built from scratch for every test batch from the official RotN 3.3.2 server pack zip (pinned URL + SHA-256) with Java 8, then deleted along with its IPv4. Delete-after watchdog, default 8 h. Nothing is copied from the live host. |
| Data dump | Runs on the test server, which runs the same default pack as live. |
| Bot VPS | Hetzner CX23, Ubuntu 24.04, Node 22 LTS (ADR 0002). Root SSH is used once to create a key-based `deploy` user; root and password login are then disabled. |
| LLM | OpenRouter via Mindcraft's `openrouter` provider (`OPENROUTER_API_KEY`, model `openrouter/<vendor>/<model>`). One key per bot with a credit limit. Models chosen by scenario benchmark. Embeddings fall back to word overlap. |
| Behavior | Autonomous, player tasks take priority (see priority stack). |
| Scale | One bot at launch. Everything per-bot is configuration. |
| Safety | `allow_insecure_coding` stays false. |

## The technical gap

| # | Gap | On a RotN server | Owner |
| --- | --- | --- | --- |
| 1 | Forge login | `FML\|HS` handshake for mod list and registry IDs; vanilla clients are kicked | net-forge |
| 2 | Version | 1.12.2. ViaProxy does not translate Forge mod content | net-forge |
| 3 | Block/item IDs | Modded IDs come from the handshake's registry data; unknown to `minecraft-data` | net-forge + rotn-data |
| 4 | Modded mobs | Mod entities are believed to spawn via FML's own channel; verify in the spike | net-forge |
| 5 | Item names | Pre-flattening names plus metadata (`log:0`) and `modid:item`; Mindcraft uses 1.13+ names | rotn-data |
| 6 | Recipes | RotN rewrites recipes and progression (crude axe since 3.0, 4 rocks make cobblestone) | rotn-data + skills-rotn |
| 7 | Block properties | Unknown hardness and harvest levels for modded blocks | rotn-data |
| 8 | Survival rules | Deadly darkness, invasions, death penalties, AggroTP teleports | skills-rotn |

## Architecture

```text
CX23 (one process per bot)
  Mindcraft brain        LLM loop, profiles, chat, memory (mostly upstream)   <-> OpenRouter (HTTPS)
  RotN skills layer      skills, commands, modes, task queue, agenda          skills-rotn
  RotN data layer        item catalog, name translation, recipes, harvest     rotn-data   <- JSON dumped on test server
  mineflayer+pathfinder  registry extended at login with modded IDs           net-forge
  forge-bridge           FML handshake, registry sync, mod entities, stubs    net-forge   <-> RotN server (TCP)
```

## Priority stack (autonomy)

1. Reflexes, no LLM, every tick: fight or flee, eat, escape darkness, lava and water, re-plan after an AggroTP teleport or invasion warning.
2. Control commands from trusted players: stop, pause, come, resume.
3. Player tasks in a persistent queue. Only players on the task-giver list may add tasks. Priority urgent or normal. Confirm, work, report done or failed with a reason. Data model includes `assignee` for future multi-bot use.
4. Autonomous agenda: RotN progression plan kept in a goal file, resumed when the queue is empty, aware of nights and invasions. Builds on `self_prompter.js` and `!goal`.

Higher levels interrupt lower ones at the next safe checkpoint. Queue and agenda survive restarts. LLM calls happen at decision points, not on a timer. Optional setting (default off): pause autonomy while no players are online.

## Multi-bot readiness

Per bot: profile JSON (name equals the account's Minecraft name), Microsoft account and token cache folder, memory, queue, agenda, logs, OpenRouter key, web UI port, systemd instance `mindcraft-rotn@<bot>`. Shared: code, forge-bridge, rotn-data, prompts.

## Phases and gates

| Phase | Work | Agents | Exit gate (checked by a harness scenario) |
| --- | --- | --- | --- |
| 0 Bootstrap | Briefs, subagents, test-server script, human setup items | rotn-lead, harness-ops | G0: test server builds from the pack zip and runs RotN 3.3.2; human has approved the briefs |
| 1 Research + spike | Four research subagents in parallel; net-forge spikes the FML login | lead, net-forge, harness-ops | G1: bot logs in online, stays 10 min, chats, walks. Fail -> ADR picks a fallback |
| 2 See the world | Registry sync, mod entities, data dump, name translation | net-forge, rotn-data, harness-ops | G2: top 50 blocks near spawn and common mobs are named; old/new names round-trip |
| 3 Act in RotN | Skills and modes for RotN, task queue, agenda | skills-rotn, rotn-data, harness-ops | G3: rocks to stone tools on a fresh spawn; survives the first night; a task preempts the agenda, which then resumes |
| 4 Deploy + harden | CX23 service, reconnects, 2-hour soak, TRY_IT.md | harness-ops, independent-reviewer, lead | G4: the full ready-to-try list is green on the CX23 |

At most three dev agents run at once. Phase 1 starts net-forge; rotn-data starts once a capture of the registry exists; skills-rotn starts at G2 (it may start early on commands that need no modded facts).

## Definition of ready-to-try

- [ ] Starting the service makes the bot log in with its own account; it reconnects by itself after a kick or server restart.
- [ ] Blocks, items, inventory and nearby mobs show RotN names; none of the 50 most common blocks near spawn shows as unknown.
- [ ] It answers in chat, follows a player, comes when called and stops on command.
- [ ] From a fresh spawn it completes the RotN early game with RotN recipes: rocks to cobblestone, crude axe, logs, planks, crafting table, first stone tools.
- [ ] It eats, fights or flees common early RotN mobs, and survives its first night in or near shelter.
- [ ] After death it respawns, reports what it lost and carries on without a chat-spam loop.
- [ ] A 2-hour soak runs with no crash, within memory and hourly API-cost targets the lead sets in an ADR.
- [ ] Insecure coding is off and no secrets are in the repo.
- [ ] `TRY_IT.md` explains how to talk to the bot, its commands, known limits, how to stop it and its hourly cost.
- [ ] Left alone, it pursues its agenda; a trusted player's task interrupts it at the next safe point; afterwards it reports and resumes. Untrusted players' tasks are politely refused.
- [ ] Task queue and agenda survive a service restart.
- [ ] A second bot profile starts and logs in through the template unit with no code change (smoke test only).

## Risks and fallbacks

| Risk | Mitigation |
| --- | --- |
| `minecraft-protocol-forge` is old and breaks with current mineflayer | Fork it into forge-bridge; port from Minecraft Console Client and the Velocity/Gate legacy-Forge code |
| Mod entities invisible | Decode FML entity spawn messages; backup: a server-side helper mod announcing entities on a custom channel |
| Mods kick silent clients | Log all plugin-channel traffic in the spike; stub only where a kick is proven |
| Modded crafting stations | Recipe dump plus slot-click crafting; ready-to-try needs only crafting table and 2x2 grid |
| AggroTP and invasions break pathing | Mode that detects position jumps and threat spikes, cancels and re-plans |
| LLM uses 1.21 names | Translate at the command boundary; `!lookup` command over the RotN catalog; RotN examples in the profile |
| Anti-cheat or admin kicks | Whitelist; normal movement limits; `block_place_delay` if needed |
| OpenRouter model quality varies | Benchmark 3-4 models on the same scenarios; primary + fallback model in the profile |
| Embeddings | OpenRouter now has `/api/v1/embeddings` (`docs/research/ops.md` D), but Mindcraft's `openrouter.js` does not use it, so word overlap runs today. Wire it in only if scenarios show harm |
| RoughlyEnoughIDs changes the wire format (VarInt slot ids, VarInt biome array, VarInt effect ids) | forge-bridge applies REID protocol overrides when REID is in the ModList (ADR 0003); G1 spike checks chunk and inventory parsing first |
| Mod-local entity IDs are not sent to clients | rotn-data's server-side dumper mod exports the table (ADR 0004) |
| Hetzner prices or availability changed (June 2026, unverified) | Human checks the console; harness-ops logs real hourly prices per batch; ADR if a type is unavailable |

If G1 fails outright, the lead writes an ADR choosing: (a) a real headless Forge client with a small control-API client mod (needs a larger VPS), or (b) a server-side puppet mod controlling a fake player (possible because the human admins the server).

## Status

- 2026-11-01, Phase 0.
  - The four research reports are filed in `docs/research/`.
  - ADRs 0002 (Node 22), 0003 (forge-bridge approach) and 0004 (dumper approach) are accepted.
  - The dev briefs are revised (see the "Phase 0 research revisions" section in each), and the human's approval is pending.
  - G0 is not passed. It needs the human items in `coord/NEEDS-HUMAN.md` and harness-ops' test-server script.

## Open items

- The list of players allowed to give tasks and control commands (ask the human in `coord/NEEDS-HUMAN.md`).
- Memory and hourly-cost targets for the soak test (lead sets them in an ADR after the first measurements).
