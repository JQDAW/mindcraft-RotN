# G1 Batch B+C, 2026-11-01: FAIL (root cause found)

net-forge ran this batch on the lead's GO, recorded in `coord/STATUS-rotn-lead.md` at 15:55 UTC. Files in this folder are committed under a lead-approved exception (`test/` is harness-ops'): the harness runner's result files for Batch C, sanitized. The bot name is `<bot>`, and the UUIDs, the player's IP:port and local paths are replaced. No tokens appear in them.

| File | What |
| --- | --- |
| `result.json` | The runner's verdict for `g1-login-chat-walk`, with default gate parameters (`gateValid: true`, `weakenedParams: []`). |
| `server.log` | The test server's log from the scenario's marker line on. |
| `driver.log` | stdout and stderr of `packages/forge-bridge/tools/g1-driver.mjs`. |

## Run

- **Code:** a clean branch at origin/develop 2abdd3b (`agent/net-forge/g1-batch-bc`), without the unmerged PR #25. Run with `deploy/test-server.sh run --yes --ttl-hours 2`, unchanged.
- **Preflight:** passed on its own (sweeper cadence: 3 dispatch runs, gaps 15.2 and 14.7 min, newest 8 min old).
- **Server:** one CPX42 in nbg1 with a 2 h TTL. It was created at 15:53:27 UTC, ready at 15:56:33, and deleted by the EXIT trap at 16:02:09, so it was up 522 s (expected about 35 min, cap 55 min).
- **Cost:** 1 billed hour, about EUR 0.14 (EUR 0.1381 excl. Primary IPv4).
- **Afterwards:** at 16:02:36 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.
- **Batch B** (spike, not gate evidence) ran from 15:56:35 to 15:58:25. **Batch C** (this folder) ran from 15:58:25 to 16:01:43.

## Result

| Check | Batch C | Why |
| --- | --- | --- |
| `login_online` | PASS | Online-mode login with a version-4 (Mojang) UUID; the FML handshake completed. |
| `chat_send` | PASS | The server logged `<<bot>> hello-...`. |
| `chat_receive` | FAIL | The bot stopped receiving packets 1 s after spawn (below). |
| `walk` | FAIL | The bot had already disconnected. |
| `stay_10min` | FAIL | The client quit after a 60 s keep-alive timeout. |

Batch B failed the same way: handshake, spawn, outgoing chat and a local 19-block walk worked, and receiving chat and the stay did not.

## Root cause: Triumph's extended advancement display

- **What failed:** the first `play.advancements` packet failed to parse, with `unexpected tag end` (Batch C: one 42 KB partial read, then a fatal 50 KB packet). A non-partial parse error makes protodef end node-minecraft-protocol's packet stream. After that no packet arrives, the keep-alive times out after 60 s, and the client quits.
- **Why:** Triumph 3.19.2 (`com.bloodnbonesgaming.triumph.advancements.display.ExtendedDisplayInfo`, confirmed with `javap`) sets flag bit 8 in the display and appends:
  - four optional ints (icon and title colours);
  - an optional boolean;
  - two optional ints (line colours);
  - an optional boolean;
  - an int count of extra connection ids, then that many strings;
  - two optional ints (position).
- **Not covered:** minecraft-data's vanilla layout has no such fields.
- **Proof:** a hand-written step parser with this extension reads both captured packets to their last byte: 150 and 174 advancements, all extended.
- **Fix:** follows in the same PR; a re-run needs a new GO.

## The questions the lead asked

- **Kicks:** none. Both sessions ended with the client quitting (`lost connection: Disconnected`, which the runner classes `client-quit`), after the client-side keep-alive timeout.
- **JustEnoughDimensions login error:** it did not occur (0 times). It appeared only in Batch A, so it came from `-Dfml.debugNetworkHandshake`.
- **`OBFUSCATE|HS` (5 zero bytes) and `dimstack` (317 bytes, sent on every login):** neither got an answer, and the server never kicked over them during the 60 s each session lasted. There is no sign they need one. Because the sessions were short, the re-run's 10-minute stay is the real check.
