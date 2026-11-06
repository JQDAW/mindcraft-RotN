# G3 smoke round 3 continuation, batch C+D (2026-11-06): (c) PASS 7/7, (d) FAIL (spam kick, then malformed packets); a SMOKE batch; the server is deleted

**Result in one line:**
- **(c) passed every check:** the agenda was active when the task came, it paused for the task, the server found the bot on the gold block, the bot said "task t1 done", and the agenda resumed.
- **(d) never got to the refusal.** Three seconds after its join, the bot was kicked "for spamming" by an agenda chat burst. It then rejoined and lost its connection twice to malformed packets from the client.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for the round 3 continuation (approved by the human at 01:07Z on 2026-11-06), on the new preset (#241).
- **Probe right before:** 02:42:44Z, HTTP 200, provider OpenInference, model `z-ai/glm-5.3-flash`. The 16 tokens ran out before any reply text (`finish: length`), but the call succeeded.
- **Code:** a clean detached checkout of `origin/develop` at `aec33fe7`, after `npm ci`.
- **Checks right before the create (02:44:40-02:44:47 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - an empty project;
  - the batch preflight on its own ("timeouts: g3-task-preempts-agenda 34 min, g3-untrusted-refused 16 min"), and no midnight warning;
  - `test-server.sh up --dry-run`: sweeper OK.
- **Command:** as in the round 3 C+D layout (no skip flags, no `--gate`, no `--timeout-min`), with the output in `captures/raw/r3b-g3cd/`.
- **The 5-minute LLM rule:** at 02:54:01 there were 28 successful replies in (c) and no failures.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 02:45:01 |
| Server created, ready | 02:45:07, 02:48:12 |
| (c) FRCFLD joined | 02:48:21 |
| (c) gold block placed and confirmed; the agenda active (waited 2 s) | 02:53:33 |
| (c) task sent / on the marker (server) | minute 5.3 / minute 5.6 |
| (d) start, FRCFLD joined | 02:55:52, 02:56:01 |
| (d) 10 "agenda step ... done" lines and one "started" in the same second; "lost connection: Kicked for spamming" | 02:56:04 |
| (d) rejoined; lost connection (DecoderException) | 02:56:18; 02:56:26 |
| (d) lost connection again (DecoderException) | 02:57:04 |
| (d) gold block placed and confirmed (first candidate, -20 70 -56) | 02:57:16 |
| Teardown, "verified gone" | 02:58:07 |
| Project checked empty by hand | 02:58:15 |

## (c) checks (`task/result.json`): PASS 7/7

| Check | Result |
| --- | --- |
| `login_online`, `fresh_bot_state` | PASS |
| `agenda_active` | PASS: counter 1 -> 5 over 5 min (11/11 objectives) |
| `task_accepted` | PASS: "task t1 accepted: go to the gold block at -42 68 -50 and stand on it" |
| `task_done` | PASS: "the server found the bot on the marker at minute 5.6; the bot said "task t1 done"; the agenda was paused for it" |
| `agenda_resumed` | PASS: counter 6 -> 12 within 5 min (the agent said "agenda resumed") |
| `no_cheat` | PASS |

`notes.agendaAtTask`: `{active: true, waitedS: 2, last: "agenda step stone_pickaxe started: ..."}` (#230). `notes.marker.reply` is the "Block placed" line itself, and `goldBlock: true`.

## (d) checks (`untrusted/result.json`): FAIL

| Check | Result |
| --- | --- |
| `login_online`, `production_givers`, `fresh_bot_state`, `no_cheat` | PASS |
| `refused_politely`, `no_task` | FAIL: "the bot is gone: lost" |
| `not_on_marker` | FAIL: "no definite "found nothing" from the server in 0 testfor polls: not proven" |

**What happened:**
1. **The spam kick (for skills-rotn).** (d) moves the bot's `agenda.json` aside, but the bot still holds (c)'s items. At the join, the agenda re-evaluated and posted 10 "agenda step ... done" lines and one "started" line in one second, and the server kicked it: `disconnect.spam` ("Kicked for spamming"). The agenda's catch-up should not chat each step, or should rate-limit its lines.
2. **The packets (for net-forge; the lead has sent it).**
   - After the rejoin, forge-bridge logged "movement guard: bot state became invalid (position NaN 58 NaN) at physicsTick; restored the last good state".
   - The server then dropped the bot twice with `DecoderException`s on its packets: `IndexOutOfBoundsException: readerIndex(11) + length(4) exceeds writerIndex(14)`, and `CPacketConfirmTeleport ... found 1 bytes extra`.
   - The agent's restart (40 s) came too late for the scenario.

## Cost

- **LLM:** (c) 40 successful replies, (d) 5; 0 failures. USD 0.0062 for the batch (the key's usage went from 0.7529 to 0.7591).
- **Hetzner:** about 13 min from the create to "verified gone", 1 billed hour, about EUR 0.14 plus 1 Primary IPv4-hour.
- **The continuation in all** (A rerun, B, C+D): LLM USD 0.0142. Cumulative by the key: USD 0.7591 of the 4.50 stop.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits, server ids masked. They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log`;
- `task/` and `untrusted/`: `result.json`, `server.log`, `driver.log`.
