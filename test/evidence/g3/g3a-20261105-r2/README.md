# G3 smoke round 2, batch A (2026-11-05): `g3-rocks-to-stone-tools`, FAIL (gate-valid parameters); a SMOKE batch; the server is deleted

**Result in one line:** the agent collected its rocks and sticks. Then it was slain four times (`stat.deaths` 4): once by a Grove Sprite (`primitivemobs`), then three times by "Zombie <bot>". It lost its items, the agenda stuck at `crude_axe` (5 min of self-prompting), and nothing was crafted.

**A smoke batch, never gate evidence:** `batch.mjs` ran without `--gate`, so `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). The gate claim check `g3-batch-check.mjs <batch.json> <result.json>` refuses it.

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 2 (approved by the human, 2026-11-05), batch A of three.
- **Code:** a clean detached checkout of `origin/develop` at `139239f2` (it includes #216, #217 and #219-#224), after `npm ci`. `result.json` has `git.dirty: false`.
- **Checks right before the create (20:15:05-20:15:15), all passed:**
  - `msa-login FRCFLD --check`: exit 0;
  - `OPENROUTER_API_KEY` is set (checked for presence only);
  - `hcloud server list` and `primary-ip list` are empty;
  - the batch preflight on its own ("a SMOKE batch (the default ...)");
  - `deploy/test-server.sh up --dry-run --ttl-hours 2 --seed 1880465901402976865`: sweeper OK by the cadence path, and nothing was created.
- **Command** (no skip flags, no `--gate`):
  ```
  deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- \
    node test/runner/batch.mjs --max-batch-usd 2 --logs-out captures/raw/r2-g3a/server --summary captures/raw/r2-g3a/batch.json \
      --timeout-min 32 --scenario g3-rocks-to-stone-tools --out captures/raw/r2-g3a/rocks \
      -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json
  ```
- **Server:** CPX42, nbg1, the pinned RotN 3.3.4 server pack, world seed `1880465901402976865`.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 20:15:24 |
| Server created | 20:15:52 |
| Ready | 20:18:59 |
| FRCFLD joined | 20:19:09 |
| Slain by Grove Sprite / by "Zombie <bot>" | 20:21:52 / 20:23:16, 20:24:34, 20:25:45 |
| Scenario end (agenda stuck at `crude_axe`) | 8.2 min after the join; batch command exit 20:29:08 |
| Teardown, "verified gone" | 20:29:20 |
| Project checked empty by hand | 20:29:45 |

## Checks (`rocks/result.json`)

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `stone_tools` | FAIL: 0 and 0; the agenda is stuck at `crude_axe` |
| `crafting_table` | FAIL: held 0, placed 0 |
| `cobblestone` | FAIL |
| `crafted_by_bot` | FAIL: nothing crafted |
| `no_cheat` | PASS (no pack gamerule repeat in this run) |

Verdict `FAIL`; the result says `gateValid: true` (its parameters), but the batch is a smoke batch.

## Observations

1. **Four deaths** (`notes.finalScores`: `g3a_deaths` 4):
   - While collecting sticks, a Grove Sprite attacked. The `self_defense` reflex fought, and the LLM sent `!attack("primitivemobs:grovesprite")`. "<bot> was slain by Grove Sprite" (20:21:52).
   - The agent went back with `!goToRememberedPlace("last_death_position")` and backed off from the sprite ("outnumbered"). Then "<bot> was slain by Zombie <bot>" at 20:23:16, 20:24:34 and 20:25:45: a zombie carrying the player's name, apparently from a pack mod.
   - rotn-data's #226 (grove sprite only retaliates; a Zombie Players threat entry) answers this. It was merged after this batch.
2. **The death report (skills-rotn D3) worked:** one line per death with the measured loss ("I died at ... lost 6 stick, ..."). After the third death it throttled itself: "I died 3 times in 10 min; I stop reporting deaths in chat ...".
3. **Around the deaths:**
   - `self_preservation` threw 6 times (`PathStopped` among them; `driver.log`);
   - after the respawn the eating reflex had "no safe food in the inventory".
4. 41 LLM calls in 8 min.

## Cost

- **LLM:** USD 0.1189 (41 calls; the key's usage went from 0.1805 to 0.2995).
- **Hetzner:** about 13 min, 1 billed hour, about EUR 0.14 (excl. IPv4), plus 1 Primary IPv4-hour.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits. They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log`;
- `rocks/result.json`, `rocks/server.log`, `rocks/driver.log`.

The full server logs stay in `captures/raw/r2-g3a/server/` on the PC.
