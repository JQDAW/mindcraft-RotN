# G2 batch 2, 2026-11-01: FAIL (mobs PASS, items PASS, blocks did not run: the bot's login failed)

harness-ops ran this batch on the lead's written GO (23:28 UTC), exactly as the re-run plan in `coord/STATUS-harness-ops.md` says. **It is not a G2 pass.**
- `g2-mobs-named` and `g2-items-roundtrip` passed as valid gate runs: `gateValid: true`, no `weakenedParams`, no `notGate` reasons, no kicks.
- `g2-blocks-named` never got as far as the census. The bot's Microsoft sign-in failed before it connected, so not one blocks check ran.

All files are redacted with the merged `test/tools/redact-evidence.mjs`, and `test/unit/evidence-redaction.test.js` (the CI leak check) passes on them. The `msa-login --check` output is not part of this evidence.

| Folder | Scenario | Files |
| --- | --- | --- |
| `blocks/` | `g2-blocks-named` | `result.json`, `server.log` (from the runner's begin marker), `driver.log` |
| `mobs/` | `g2-mobs-named` | the same |
| `items/` | `g2-items-roundtrip` | the same |

## Run

- **Code:** a clean detached checkout of develop at 53a1d5e, after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create:**
  - `agentNaming('.')`: wired, 643/643 entries.
  - The bot's login cache: OK.
  - The preflight on its own passed via the cadence path (3 dispatch runs, gaps 15.4 and 14.5 min). No leftover labelled resources.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `deploy/test-server.sh run` unchanged.
  - Created 23:31:07 UTC, ready 23:34:14.
  - Deleted by the EXIT trap and verified gone at 23:39:57: up 9 min (hard stop 56).
- **Cost:** 1 billed hour, about EUR 0.14 (EUR 0.1381 excl. Primary IPv4).
- **Afterwards:** at 23:40:12 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.
- **Console:** `gamerule doDaylightCycle false` once, `time set day` before each of the three scenarios, then the runner's scenario commands. The `time set day` lines are only in the raw server log (not committed): each `server.log` here starts at its scenario's begin marker. Test server only, no difficulty change.
- **World seed:** 3236084396548950896.

| Scenario | Time (UTC) | Verdict | Checks |
| --- | --- | --- | --- |
| `g2-blocks-named` | 23:34:20-23:34:41 | FAIL | `login_online` FAIL ("driver exited with code 0 before joining"); the other three checks not reached |
| `g2-mobs-named` | 23:34:44-23:37:36 | **PASS** | `login_online`; `mobs_named` 12/12 (1 replaced); `mobs_confirmed` 12/12 by run tag |
| `g2-items-roundtrip` | 23:37:39-23:39:34 | **PASS** | `items_table` (643/643), `login_online`, and `items_read`, `items_named`, `items_roundtrip` (30/30 each) |

## Mobs

- **Summoned (from `common-mobs.json`, rotn-data #62):**
  - vanilla: `minecraft:slime`, `minecraft:creeper`, `minecraft:spider`, `minecraft:skeleton`, `minecraft:zombie`;
  - modded: `butterflies:butterfly`, `quark:stoneling`, `animania:toad`, `betteranimalsplus:deer`, `animania:cow_holstein`, `animania:hen_rhode_island_red`, `animania:hen_wyandotte`.

  That is 7 modded mobs, all named and confirmed.
- **Replaced:** 1 of 12 (cap 3). `charm:spectre` vanished before the bot was asked; the tagged `testfor` found nothing. It was replaced by the next-ranked `quark:stoneling`.
- **Other entities:** none reported. No placeholder names.

## Blocks: why it did not run

`driver.log`: `Error: Failed to obtain profile data for <bot>, does the account own minecraft?`, raised by minecraft-protocol's `microsoftAuth.js` 1 s after the driver started.
- That library swallows any error from the Minecraft profile fetch (`prismarine-auth` `fetchProfile(...).catch(debug)`) and then throws this message. So the real cause is not logged. It may have been a rate-limit reply, a network error or a server error.
- It was transient. The same account and cache had passed `msa-login --check` at about 23:30, and logged in normally 20 s later for mobs and 3 min later for items.
- The server log has no join attempt for the blocks session.

`metaDrift`, `samples` and the census do not exist for this run, because no blocks check ran.
