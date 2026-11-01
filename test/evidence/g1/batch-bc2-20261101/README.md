# G1 Batch B+C retry, 2026-11-01: PASS

net-forge ran this batch on the lead's GO, recorded in `coord/STATUS-rotn-lead.md` at 17:05 UTC, after PR #28 (Triumph advancements opaque, parse safety net) was merged.

Files in this folder are committed under the lead-approved `test/evidence/g1/` exception: the harness runner's result files for Batch C, sanitized. The bot name is `<bot>`, player UUIDs are `<uuid-v4>` (all are version-4 Mojang UUIDs), and the player's IP:port and local paths are replaced. No tokens appear in them; the only "token" is the runner's per-run echo nonce, which is said in public chat.

| File | What |
| --- | --- |
| `result.json` | The runner's verdict for `g1-login-chat-walk`: default gate parameters, `gateValid: true`, `weakenedParams: []`, **`pass: true`**. |
| `server.log` | The test server's log, starting at the marker line the runner writes when the scenario begins. |
| `driver.log` | stdout and stderr of `packages/forge-bridge/tools/g1-driver.mjs`. |

## Run

- **Code:** a clean branch at origin/develop 62ec6f1 (a83c22b + #27), `agent/net-forge/g1-batch-bc2`, without the unmerged PR #25. Run with `deploy/test-server.sh run --yes --ttl-hours 2`, unchanged.
- **Preflight:** passed on its own (sweeper cadence: 3 dispatch runs, gaps 14.7 and 15.4 min, newest 9 min old).
- **Server:** one CPX42 in nbg1 with a 2 h TTL. It was created at 17:09:58 UTC, ready at 17:12:42, and deleted by the EXIT trap at 17:34:44, so it was up 1486 s (24.8 min; expected about 35, cap 55).
- **Cost:** 1 billed hour, about EUR 0.14 (EUR 0.1381 excl. Primary IPv4).
- **Afterwards:** at 17:35:19 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.
- **Batch B** (11-minute spike, not gate evidence) ran from 17:12:44 to 17:23:55. **Batch C** (this folder) ran from 17:23:55 to 17:34:24.

## Result

| Check | Batch C |
| --- | --- |
| `login_online` | PASS: online mode, version-4 (Mojang) UUID |
| `chat_send` | PASS: the server logged `<<bot>> hello-...` |
| `chat_receive` | PASS: the whispered token was echoed |
| `walk` | PASS: 8.6 blocks horizontally (minimum 6) |
| `stay_10min` | PASS: still online after 608 s, no disconnects |

Batch B passed all its own checks too: handshake, spawn, chat both ways, a 6-block pathfinder walk, and an 11-minute stay.

## The lead's questions

- **Did advancements stay opaque?** Yes. Triumph 3.19.2 was detected in both sessions (`bridge_attached.triumph`), and there was no advancements parse error.
- **Did the safety net drop anything?** No: `droppedPackets` is `{}` in B's end-of-session stats.
  - Correction (PR #31 review): an earlier version also cited the absence of "(dropped, allowlisted)" log lines. That string did not exist in the code that ran (it was added later, in commit 56b8aa0 of PR #25), so its absence proves nothing.
  - The only parse errors in both sessions were PartialReadErrors (`entity_metadata`, below). protodef drops those itself; the safety net never handles them.
- **Kicks?** None. The runner's `notes.kicks` is `[]`.
  - B ended with its own `disconnect.quitting`.
  - The server's last "lost connection: Internal Exception: NativeIoException" at 17:34:22 is the teardown, right after `stay_10min` passed: on Windows the runner's SIGTERM ends the driver at once.
- **`OBFUSCATE|HS` and `dimstack`:** neither got an answer, and there was no kick over 11 and 10 minutes, so neither needs one.
- **JustEnoughDimensions error:** 0 occurrences.

## Server-side crash report (not caused by the bot)

At 17:30:59 the server logged a FATAL "Ticking entity" crash report (`server.log` lines 43-815). The cause was `java.lang.NullPointerException` at `com.p1ut0nium.roughmobsrevamped.ai.combat.RoughAIBatTarget.func_75250_a(RoughAIBatTarget.java:51)`, a Rough Mobs Revamped bat AI. The server survived it: the bot stayed connected, and `stay_10min` passed.

## One new finding (not a G1 blocker)

- **What:** each session had one `entity_metadata` PartialReadError (77 and 78 bytes, a player's metadata), dropped by protodef as upstream does.
- **Cause:** key 17 uses serializer type 14. AquaAcrobatics 1.15.4 registers its `PoseSerializer` (an enum written as a VarInt ordinal) with vanilla `DataSerializers.registerSerializer`, so it takes the next vanilla id after 13 (`javap`). Four more mods call that method (base, Charset-Lib, Mowzie's Mobs, Requious Frakto), so the ids from 15 upward are not yet known.
- **Fixture:** the packet is in `packages/forge-bridge/test/fixtures/rotn-3.3.4/entity-metadata-aqua-pose.json`.
- **Tracked and fixed:** since PR #46 it parses (serializer 14 = AquaAcrobatics pose). The id is inferred by fit, so since PR #49 the bridge logs its first decode until rotn-data's dumper confirms the serializer ids.
