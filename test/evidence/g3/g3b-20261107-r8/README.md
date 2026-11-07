# G3 smoke round 8, batch B (2026-11-07): `g3-first-night`, PASS 5 of 5; on e5029f23; a SMOKE batch; the server is deleted

**Result in one line:** all 11 agenda steps were done by 02:45:06. At sunset the bot built a shelter, stayed in it until morning at -68 58 -75, and reached dawn with 0 deaths and food 14.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** the round 8 GO (as in batch A). The run command went through auto mode.
- **Code:** the same clean detached checkout of `e5029f2307a5`.
- **Free memory at 02:31:13 UTC:** 5,629 MB available of 7,746 MB. This batch was the round's memory window (over 20 min), announced to the lead.
- **Checks right before the create (02:31:13-02:31:20 UTC), all passed:**
  - `msa-login`; the key present; an empty project (0/0/0);
  - the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-first-night 67 min" for a 180 min TTL, no midnight warning;
  - the dry run (sweeper OK by the scheduled path).
- **Command:** as in batch A, with `--ttl-hours 3` and `--scenario g3-first-night --out <raw>/night`.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 02:34:39 |
| Server created, ready | 02:31:38, 02:34:38 |
| FRCFLD joined; "agenda step rocks started" | 02:34:49, 02:34:51 |
| "sticks done" (felling, second try); "agenda done" | 02:40:14, 02:45:06 |
| Dusk (11928), night (13219), dawn (407) | minute 19.1, 20.1, 39.5 after the start |
| Command exited | 03:15:20 |
| Server, Primary IP and SSH key verified gone | 03:15:33 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | PASS: dawn reached; `stat.deaths` 0; death lines 0 |
| `stayed_online` | PASS: online from the join to the end (39.6 min) |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths. Food 14 at the end.
- **The night, from the driver log:**
  - "[night] sunset is near: building a shelter";
  - "[night] in the shelter at -68, 58, -75 until morning";
  - "[night] morning: found no safe side to open; back to work".
- **There was no "no longer usable" shelter line this round:** the shelter held from sunset to morning.
- **`[inventory]` cursor lines (for skills-rotn):**
  - one rejected craft click ("Server rejected transaction for clicking on slot 0, on window with id 1"); the resync showed "cursor: empty";
  - **three rejected equip clicks in a row** (slots 36, 37 and 38, window 0). After each, the resync showed "cursor: stone_pickaxe" and the bot logged "before equip: put the stone_pickaxe on the cursor into slot 9", but the next click was rejected again. The action went on, and the unstuck mode then interrupted a `!goToCoordinates`.
- `shelterAtMidnight` was not taken: there is no `tp` in G3, so there is no position to test around. Survival is the gate.
- The bot called `!taskDone` for an agenda step (harmless; seen before in round 6).

## LLM, providers and memory summaries

- **Requests:** 65: 49 agent replies and 16 memory summaries. No failed answer, no disconnect, no HTTP errors. All went to Wafer.
- **Memory summaries, true figures:** 16 stored, 0 empty, checked by hand (16 "Storing memories..." and 16 "Memory updated to:").
  - `result.json` reads "1 failed, 1 empty memory". That is the known overlapping-summary miscount (a second summary starts before the first's reply), which is fixed after the gate.

| Provider | Requests | Empty answers | Summaries stored |
| --- | --- | --- | --- |
| Wafer | 65 | 0 | 16 (11 attributed, 5 unattributed) |

## Cost

- **Spend:** USD 0.010916 (key usage 0.856083 to 0.866999, from `batch.json`).
- **Hetzner:** ran 43 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0 at 03:15:39, counted with `grep -c .`.

## Files

- `batch.json`, `run.log`, and `night/result.json`, `night/driver.log`, `night/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- The raw logs are in `captures/raw/r8-g3b/` (not committed).
