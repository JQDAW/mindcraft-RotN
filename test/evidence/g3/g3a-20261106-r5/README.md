# G3 smoke round 5, batch A (2026-11-06): `g3-rocks-to-stone-tools`, 3 of 7; the agent crashed five times on empty memory summaries; a SMOKE batch; the server is deleted

**Result in one line:** every memory summary came back with no text. `history.js` read `.length` on the null reply, so the agent process exited, five times in a row, and the bot was off the server for the last 2 minutes. The four task checks failed because the bot was gone.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 5 (approved by the human at 11:55Z on 2026-11-06).
- **Code:** a clean detached checkout of `origin/develop` at `c32521e5`, after `npm ci`.
- **Checks right before the create (11:57:46-11:57:59 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - an empty project (no servers, no Primary IPs; only the human's own unlabelled SSH key);
  - the batch preflight on its own, with the LLM probe (HTTP 200, provider OpenInference, `z-ai/glm-5.3-flash`), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL, and no midnight warning;
  - `test-server.sh up --dry-run --ttl-hours 2`: sweeper OK.
- **Command:** `bash deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-rocks-to-stone-tools --out <raw>/rocks -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`. No skip flags, no `--gate`, no `--timeout-min`. The LLM-failure stop rule was active and did not fire (there were agent replies).
- **Free memory** on the runner's machine was not yet recorded (the lead asked for it from the B rerun on).

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 11:58:12 |
| Server created, ready | 11:58:42, 12:03:48 |
| FRCFLD joined | 12:04:00 |
| First crash ("lost connection ... Connection reset by peer") | 12:05:25 |
| Rejoins and crashes | 12:05:39-12:05:48, 12:06:12-12:06:14, 12:06:59-12:07:07, 12:08:31-12:08:37 |
| Checks | 12:10:38 |
| Command exited | 12:10:52 |
| Server, Primary IP and SSH key verified gone | 12:11:08 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS (UUID version 4) |
| `fresh_start` | PASS |
| `stone_tools` | FAIL: the bot is gone ("lost ... Connection reset by peer") |
| `crafting_table` | FAIL: held 0, placed 0 |
| `cobblestone` | FAIL: no reply (the bot was gone) |
| `crafted_by_bot` | FAIL: all 0 |
| `no_cheat` | PASS |

## What happened (`rocks/driver.log`)

1. The bot collected its rocks, then started `!collectBlocks("stick", 4)`.
2. The tree guard refused the tree at -62 64 -50 six times ("no place beside it that is out from under its canopy"), so 0 sticks.
3. The history reached its summary limit. The summary request came back with null content, and `History.summarizeMemories` threw "TypeError: Cannot read properties of null (reading 'length')" (`src/agent/history.js:44`). The agent process exited with code 1.
4. `agent_process` restarted it after 10, 20, 40, 80 and 160 s. Each restart reloaded the 14 turns in `bots/FRCFLD/memory.json`, reached the limit again within seconds, and crashed on the same empty reply.
5. **The outgoing chat limit was off** ("[chat] no bot._client.chat to wrap: the outgoing chat limit is OFF for this bot", 5 times). minecraft-protocol assigns `client.chat` only once play starts.

**Fixed since:** null content in `openrouter.js` (#266), `history.js` keeps the old memory on such a reply and the chat limit wraps on login (skills-rotn), and the driver moves `memory.json` aside at every start (#267). Re-run as `g3a-20261106-r5-rerun`.

## LLM, providers and memory summaries

- **Requests:** 19: 11 agent replies, 0 summaries stored, **5 failed: 5 empty memory summaries**, and 3 replies Mindcraft discarded for a newer message.
  - The run log says "0 memory summaries, 0 failed": it was written before #267 and #273 taught the counter about empty summaries. The figures here are the current counter's (`countLlmReplies`) on this `driver.log`.
- **Providers:** this run is from before openrouter.js logged the provider (#271), so it has no provider lines.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| (not logged; the probe named OpenInference) | 19 | not logged | 0 | 5 (not attributed) |

- The probe's provider says only who answered one request before the batch. The human has since excluded OpenInference from the preset.

## Cost

- **Spend:** USD 0.001557 (key usage 0.770735 to 0.772293, from `batch.json`).
- **Hetzner:** ran 12 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `rocks/result.json`, `rocks/driver.log`, `rocks/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r5-g3a/` (not committed).
