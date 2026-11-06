# G3 smoke round 3, batch B (2026-11-05/06 UTC): `g3-first-night`, scenario error at the log roll-over; a SMOKE batch; the server is deleted

**Result in one line:**
- At 00:00 UTC the server rolled `logs/latest.log` over into `logs/2026-11-05-1.log.gz`.
- The scenario's next poll (00:00:56) no longer found its begin marker and stopped: "scenario marker not in the last 20000 log lines; raise logTail".
- That was a harness failure, not a verdict on the bot. Until then (28.5 min after the join) it was online with `stat.deaths` 0.
- **Correction (round 3 continuation, 2026-11-06):** not one LLM call of this run succeeded.
  - `driver.log` shows 11 requests and 11 `Error [429] ... Provider returned error`, and no other reply: 10 "Generated response: My brain disconnected, try again." and one memory summary that stored the same stand-in ("Memory updated to:  My brain disconnected, try again.").
  - An earlier wording said "20 ... replies"; that count included the 9 echo lines ("full response to system") and the memory line.
  - The old preset's upstream provider was rate-limited: Baidu, `tpm_rate_limit_exceeded`, confirmed by two probes at 01:32Z and 01:42Z.
  - So the bot's 28.5 min came from its reflexes and the night routine alone. This run says nothing about the LLM-driven agent.
  - Since then, every LLM run uses `@preset/glm-5-3-flash-cheap-reliable` (#241).
- The run stopped per the GO (unexpected, after the join, so no retry). C+D did not start.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 3 (approved by the human, 2026-11-06), batch B.
- **Code:** a clean detached checkout of `origin/develop` at `609490f6`, after `npm ci`.
- **Checks right before the create (23:27:47-23:27:57 UTC), all passed:**
  - `msa-login FRCFLD --check`: exit 0;
  - `OPENROUTER_API_KEY` is set;
  - `hcloud server list` and `primary-ip list` are empty;
  - the batch preflight on its own, with the TTL (`ROTN_BATCH_TTL_MINUTES=180`): "timeouts: g3-first-night 67 min";
  - `deploy/test-server.sh up --dry-run --ttl-hours 3 ...`: sweeper OK (cadence).
- **Command** (no skip flags, no `--gate`, no `--timeout-min`):
  ```
  deploy/test-server.sh run --yes --ttl-hours 3 --seed 1880465901402976865 -- \
    node test/runner/batch.mjs --max-batch-usd 2 --logs-out captures/raw/r3-g3b/server --summary captures/raw/r3-g3b/batch.json \
      --scenario g3-first-night --out captures/raw/r3-g3b/night \
      -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json
  ```

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 23:28:05 |
| Server created, ready | 23:28:14, 23:31:19 |
| Begin marker, FRCFLD joined | 23:31:20, 23:31:28 |
| "[night] sunset is near" / "no shelter after 3 tries ... without a pickaxe" | 23:45:56 / 23:46:59 |
| **Log roll-over** | 00:00 |
| Scenario error | 00:00:56 |
| Batch command exit | 00:01:05 |
| Teardown, "verified gone" | 00:01:18 |
| Project checked empty by hand | 00:01:25 |

## Checks (`night/result.json`)

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night`, `stayed_online`, `no_cheat` | not reached (scenario error) |

The last samples (`notes.samples`): minute 28.5, daytime 16001 (Time Shall Not Pass's midnight hold), deaths 0, food 18.

## The cause, from the fetched logs (`server-logs-listing.txt`)

- `logs/` at the end held `2026-11-05-1.log.gz` (26,322 lines, the begin marker at its line 25,784) and a new `latest.log` of 12 lines.
- Every G3 scenario read only `latest.log`'s tail, so the marker was gone.
- `night/server.log` (the runner's own window) holds a single line for the same reason.
- **`night/server-across-rollover.log`** is assembled from the fetched files: the rolled-over file from the begin marker to its end, then all of the new `latest.log` (551 lines). It is the run's server log across the roll-over, and it went through the redactor like the rest.
- The fix: the session reads the rolled-over file plus `latest.log` once the marker is gone, and records which files it read (`notes.logWindow`). `batch.mjs` warns about runs past 00:00 UTC (PR #236).

## Cost

- **LLM:** 11 failed calls (429) and no successful one, which is why the batch's readings show USD 0 (0.7449 before and after). This line first said "11 calls" and blamed the usage lag; that was wrong.
- **Hetzner:** about 33 min, 1 billed hour, about EUR 0.14 (excl. IPv4), plus 1 Primary IPv4-hour.
- **Cumulative LLM** by the key's last reading: USD 0.7449 of the 4.50 stop.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits. They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log`;
- `night/result.json`, `night/server.log`, `night/driver.log`;
- `night/server-across-rollover.log` (assembled by command, as described above);
- `server-logs-listing.txt`.

The full server logs stay in `captures/raw/r3-g3b/server/` on the PC.
