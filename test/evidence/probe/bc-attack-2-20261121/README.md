# Probe BC, step 4 of the Better Combat plan: attempt 2 (2026-11-21)

**Label: run under the lead's written GO `G-BC-PROBE-2-20261121`. A probe, never a gate.**

**Result: FAIL, 10 of 13 checks passed.**
- **Better Combat's packet hit in full, every time.** In every Better Combat series, every hit lowered the zombie's health:
  - stone sword: dead in 7;
  - stone axe: dead in 9;
  - bare hand: 40 hits, projecting 53 to kill;
  - the zombie with its AI: dead in 8.
- **The counts are in rotn-data's ranges** (#528): 5–8, 6–9 and 36–54 at a measured start health of 20.
- **No gap between Better Combat packets was under the cooldown,** and the self-check never tripped.
- **The server log is clean:** no `FMLIndexedMessageCodec` line, no error naming `bettercombat`, and no kick.
- **The vanilla attack landed once and then never again** with the stone sword (40 hits) and the bare hand (40 hits), as #518 says.

**The three failures:**
1. **`vanilla_crude_axe` and `bc_crude_axe`: a harness bug, not a Better Combat result.** `give <bot> pyrotech:crude_axe 6 0` was refused: `The number you have entered (6) is too big, it must be at most 1`. A tool does not stack, so 1.12's `give` takes at most 1. Neither crude-axe series ran.
2. **`vanilla_stone_axe`: an anomaly, not the vanilla rule failing.** The zombie at A's cell started at **8** health, not 20, and was at 4 before the bot's first hit. That hit killed it, so the series had 1 hit. The bot also lost 3.3 health during this series (`botHealth` 16.67). See *The stone-axe anomaly*.

Every address is redacted (`<ip>`, `<local>`).

## Set-up
| | |
| --- | --- |
| Harness | A fresh detached checkout of develop at `b9d2bdea5cfc594f79a9579ce3693cfe8a8d73e8` (#537 merged: the enclosed lane at y 120). `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario probe-bc-attack -- node test/runner/drivers/bc-attack-driver.mjs`. It ran once and was not retried |
| Bot | FRCFLD, the local test account's token cache; never the CX23 service. `FORGE_BC_ATTACK=on` for this bot only (the scenario passes `ROTN_DRIVER_BC_ATTACK=on`). No LLM call |
| Test server | `mcr-test-20261121-144510`, a CPX42 in nbg1. Created 14:45:16 UTC, ready 14:48:33, deleted 14:54:49: about 9 min, billed about 1 h, EUR 0.1381 plus the IPv4. The watchdog `delete-after` was 2026-11-21T16:45:16Z (TTL 2 h). **`server-lifecycle.txt`** has the `up` log, `starts=1 files=1`, the `down` log ending `verified gone: server, Primary IPv4 and SSH key`, and the hcloud counts saved right after the delete: 0 servers, 0 Primary IPs, 0 labelled SSH keys |
| Server | The G2/G3/M1 seed `1880465901402976865` and the pinned pack: zip SHA-256 `90642fd5…f5205`. Mod Director: 1 pinned download and 337 zip jars match, 0 extra mods. Firewall, whitelist and online mode as for the soaks |
| Timing | The scenario ran 14:48:39 to 14:54:12. `login_online` passed at 14:48:47. `setup` passed at 14:50:47 with all 68 lane cells as planned. The series ran 14:50:57 to 14:54:08 |

## The series (`result.json` `notes.series`)
**What the columns mean:**
- **Health drops:** each distinct drop, rounded. The last one is the killing hit's remainder.
- **Crits:** marked by `markCrits`. A drop at least halfway from rotn-data's `perHit` to its `critHit` is a crit. For the sword, `perHit` is 2.733 and `critHit` 4.133; for the stone axe 2.323 and 3.542; for the hand 0.371 and 0.559.
- **Gaps:** between `bettercombat` payloads on the Better Combat path, and between `use_entity` ATTACK packets on the vanilla path. `arm_animation` is not used.

| Series | Item | Path | Start health | Hits | End | Health drops | Crits | Hit 1 crit | Gaps (ms), min–max | Cooldown (ms) | Range (measured health) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vanilla_stone_sword` | stone sword | vanilla | 20 | 40 | maxHits | 2.733 on hit 1, then 0 ×39 | – | – | 650–654 | 650 | – | PASS |
| `bc_stone_sword` | stone sword | Better Combat | 20 | 7 | dead | 2.733 ×5, 4.133 (#4), 2.203 (killing) | #4 | **no** | 650–653 | 650 | 5–8 at 20 | PASS |
| `vanilla_stone_axe` | stone axe | vanilla | **8** | 1 | dead | 4 (killing; 8 → 4 came before the hit) | – | – | – | 2500 | – | **FAIL**: only 1 hit |
| `bc_stone_axe` | stone axe | Better Combat | 20 | 9 | dead | 3.542 (#1), 2.323 ×7, 0.195 (killing) | #1 | **yes** | 2499–2502 | 2500 | 6–9 at 20 | PASS |
| `vanilla_crude_axe`, `bc_crude_axe` | crude axe | – | – | – | – | – | – | – | – | 1100 | – | **FAIL**: the give was refused |
| `vanilla_hand` | hand | vanilla | 20 | 40 | maxHits | 0.749 on hit 1, then 0 ×39 | – | – | 650–652 | 650 | – | PASS |
| `bc_hand` | hand | Better Combat | 20 | 40 | maxHits | 0.371 ×38, 0.559 (#6, #18) | #6, #18 | **no** | 650–652 | 650 | 36–54 at 20 (projected 53) | PASS |
| `bc_ai_zombie` | stone sword | Better Combat | 20 | 8 | dead | 2.733 ×7, 0.870 (killing) | none | no (no sneak expected) | 650–2998 | 650 | 5–8 at 20 (not judged) | PASS |

- **Every hit was sent on its own series' path:**
  - `packets.bettercombat` equals the hit count on every Better Combat series, with `use_entity` 0;
  - `packets.use_entity` equals the hit count on every vanilla series, with `bettercombat` 0.
- **One gap was a millisecond under the cooldown:** 2,499 ms on the stone axe's Better Combat path, against 2,500. That is within the documented 2 ms timer slack (`GAP_SLACK_MS`), so the check counts it as on time.
- **The AI zombie's longer gaps** (2,998 and 2,079 ms) are the driver waiting until the zombie was within 3 blocks. It hit the bot: `botHealth` was 13 at the end.
- **No series ended `lost`.** Per the #537 review note, a `gone`/`lost` after the death status would be the zombie despawning, not Better Combat failing; it did not happen here. Every dead series has the death status and health 0 on its last hit, and no hit was sent after a death (`afterDeath`: none).

## Hit 1 of each NoAI Better Combat series (#533 review)
**Hit 1 was a crit in only 1 of the 3 NoAI series:**
- stone axe: yes, 3.542;
- stone sword: no; its one crit was #4;
- bare hand: no; its crits were #6 and #18.

rotn-data #528 expects every such hit 1 to be a sneak-attack crit, because a NoAI zombie has neither an attack target nor a revenge target.

**A possible pattern:**
- Zombie B's Better Combat series always runs right after the vanilla series on A, which stands 4 blocks from B.
- The vanilla series before the sword and the hand ran 27 s and 40 hits. The one before the axe ran 6.5 s with 1 hit, and only there did hit 1 crit.

**A guess, not checked:** something made B notice the bot during the long vanilla series, for example Zombie Awareness or a reinforcement call setting its attack target. Setting a target needs no AI tasks. This is a question for rotn-data. It is not a pass rule, and the ranges allow any number of crits.

## The stone-axe anomaly (`vanilla_stone_axe`)
**What the data shows:**
- A and B were both summoned (`Object successfully summoned` at 14:51:41 and 14:51:42).
- The driver's target at A's cell was entity `62917`. B's was `62921`, so it was very likely A.
- Its health was 8 when the series started (14:51:47) and 4 before the bot's first swing, which came 2.5 s later at Better Combat's 50-tick cooldown.
- That swing killed it.
- The bot itself went from 20 to 16.67 health during this series.
- Nothing in `server.log` explains it. The only lines around it are the pack's advancement function (`Old To-Do Clipboard`, 14:51:31, which sets two game rules), Forge's cascading-worldgen warnings and the kills.
- forge-bridge's capture records at most 100 `spawn_entity_living` and 300 `entity_metadata` packets, so by then it no longer had this zombie's spawn.

**What the extra kills are:** at every step, `kill @e[type=zombie]` killed more zombies than the two summoned: 3, 4, 12, 8, 4, 10 and 1 per second's batch. The kill at the end of a step and the one at the start of the next fall in the same second. `kill @e` kills every zombie in the loaded world, not just the lane's, so these counts do not show zombies in the lane.

**Not known:** what hurt both this zombie and the bot. Possibilities include another mob in or near the lane, a pack mechanic, or a summoned zombie that the pack replaced with a variant. The driver does not record the bot's own hurts, nor anything about the target beyond its health.

## For the lead (before attempt 3)
A small harness-ops PR, then a new GO:
- **(a) The crude axe:** give 1, six times. The allowlist admits exactly `give <bot> pyrotech:crude_axe 1 0`.
- **(b) The driver records the bot's own health changes during each series, with their time.**
- **(b) It also records what it can see of the target at the start:** the entity's name, health, and the baby flag and the equipment, if mineflayer has them.
- **(b) The scenario then flags a target whose start health is not the catalogue's 20** as "not a fresh zombie", and judges that series as not measured. A failure of Better Combat or of the vanilla rule is a different thing.

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `setup` | PASS: `Better Combat's path active; lane 68/68 cells as planned` |
| `vanilla_stone_sword`, `bc_stone_sword` | PASS, PASS |
| `vanilla_stone_axe`, `bc_stone_axe` | **FAIL** (the anomaly above), PASS |
| `vanilla_crude_axe`, `bc_crude_axe` | **FAIL**, **FAIL** (the give) |
| `vanilla_hand`, `bc_hand` | PASS, PASS |
| `bc_ai_zombie` | PASS |
| `server_log` | PASS: 0 codec or `bettercombat` problem lines, 0 kicks. The one `bettercombat` mention is the join's mod list, and the one `lost connection` is the bot's quit at the runner's stop (14:54:12) |
| `self_check` | PASS: never tripped over 7 series |

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result: the checks; `notes.series` (each reply with every hit, plus `expected` and `verdict`); `notes.lane`; `notes.bcStatus`; `notes.landing`.
- `run.log`: the runner's stdout.
- `server.log`: the test server's log for the run, as the runner fetched it.
- `driver.log`: the driver's stdout and stderr, including every `bc_hit` reply.
- `server-lifecycle.txt`: the `up` log, `starts`, the `down` log, and the hcloud counts after the delete.

The raw capture (`capture.jsonl`) and the `since-start` log stay in the raw folder and are not committed.
