# Probe BC, step 4 of the Better Combat plan: attempt 3 (2026-11-21)

**Label: run under the lead's written GO `G-BC-PROBE-3-20261121`. A probe, never a gate.**

**Result: FAIL, 9 of 13 checks passed; 4 are INCONCLUSIVE (not measured).** None of the four is a Better Combat failure:
- **Three NoAI series** (`vanilla_stone_axe`, `bc_stone_axe`, `bc_crude_axe`) were flagged by the census:
  - two by a Zombie Awareness **scent marker**, which is not a mob;
  - one by a Fish's Undead Rising **parasite** that appeared only after its target zombie had died.
  
  Both are flaws in the new census rule (see *The INCONCLUSIVE flags*). Judged on their hits, the three series behave as planned. `bc_crude_axe` has one further problem: a driver bug sent one bare-handed hit (#5) in it.
- **`bc_ai_zombie` attacked the scent marker, not the zombie.** The driver's target filter matches any name containing "zombie", including `zombieawareness:entityscent`. The AI zombie was not tested.

**What the run shows about Better Combat's packet:**
- **Every hit landed:** each Better Combat hit on a zombie lowered its health.
- **The counts are in rotn-data's ranges, at a measured start health of 20:** stone sword 7 (5–8), stone axe 8 (6–9), crude axe 9 (6–9), bare hand projected 54 (36–54).
- **The vanilla path landed only its first hit,** with all four weapons: 40, 24, 40 and 40 hits.
- **Pacing held:** no gap between Better Combat packets was under the held item's cooldown. The one gap under the crude axe's 1,100 ms is the bare-handed hit at the bare hand's 650 ms (*The crude-axe gap*).
- **The self-check never tripped. The server log is clean:** no `FMLIndexedMessageCodec`, no error naming `bettercombat`, and no kick.
- **The bot was never hurt.**
- **No `lost`/`gone` end.** Per the #537 review, such an end after the death status would be the zombie despawning, not Better Combat failing.
- **No call came back `{sent: false, reason: 'reach'|'sight'}`.** That answer (#541) would be the wrapper refusing, not Better Combat failing.

Every address is redacted (`<ip>`, `<local>`).

## Set-up
| | |
| --- | --- |
| Harness | A fresh detached checkout of develop at `102bc9e78fdd581217177b38088b1a6e72970ba3` (#545 merged: `bc_attack` on by default). `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario probe-bc-attack -- node test/runner/drivers/bc-attack-driver.mjs`. It ran once and was not retried |
| Bot | FRCFLD, the local test account's token cache. `FORGE_BC_ATTACK=on` for this bot only; no LLM. **Not logged in anywhere else:** before the run, a read-only `status frcfld` through the gate showed the CX23 unit `inactive (dead)` and `disabled`, and no soak ran during it |
| Test server | `mcr-test-20261121-165516`, a CPX42 in nbg1. Created 16:55:19 UTC, ready 16:58:18, deleted 17:07:38: about 12 min, billed about 1 h, EUR 0.1381 plus the IPv4. The watchdog `delete-after` was 2026-11-21T18:55:18Z (TTL 2 h). **`server-lifecycle.txt`** holds all three `up` tries, `starts=1 files=1`, the `down` log (`verified gone`) and the hcloud counts saved right after the delete: 0 servers, 0 Primary IPs, 0 labelled SSH keys |
| `up` tries | **Two `up` tries stopped before creating anything.** Mojang's profile API did not resolve a whitelist UUID, first FRCFLD's and then JQDAW's. The third try worked. They are in `server-lifecycle.txt` |
| Server | The G2/G3/M1 seed `1880465901402976865` and the pinned pack: zip SHA-256 `90642fd5…f5205`. Mod Director: 1 pinned download and 337 zip jars match, 0 extra mods. Firewall, whitelist and online mode as for the soaks |
| Timing | The scenario ran 16:58:26 to 17:07:07. `login_online` passed at 16:58:35, and `setup` at 17:00:36 with all 68 lane cells as planned |

## The series (`result.json` `notes.series`)
**What the columns mean:**
- **Crits:** marked from the drops (`markCrits`). Hit 1 is reported per the #533 review.
- **Gaps:** between `bettercombat` payloads, or between `use_entity` ATTACK packets.
- **All targets** were `zombie`, `noAI: true`, `baby: false`, with start health 20, and did not move (`moved` 0). The exception is the AI step's target.

| Series | Item | Hits | End | Health drops | Crits | Hit 1 crit | Gaps (ms) | Cooldown | Range | Check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vanilla_stone_sword` | stone sword | 40 | maxHits | 2.733 on hit 1, then 0 ×39 | – | – | 650–656 | 650 | – | PASS |
| `bc_stone_sword` | stone sword | 7 | dead | 2.733 ×4, 4.133 ×2, 0.803 (killing) | #2, #3 | no | 650–654 | 650 | 5–8 | PASS |
| `vanilla_stone_axe` | stone axe | 24 | maxMs | 2.323 on hit 1, then 0 ×23 | – | – | 2500–2503 | 2500 | – | INCONCLUSIVE (scent marker) |
| `bc_stone_axe` | stone axe | 8 | dead | 2.323 ×5, 3.542 ×2, 1.299 (killing) | #4, #7 | no | 2499–2502 | 2500 | 6–9 | INCONCLUSIVE (scent marker) |
| `vanilla_crude_axe` | crude axe | 40 | maxHits | 2.323 on hit 1, then 0 ×39 | – | – | 1100–1103 | 1100 | – | PASS |
| `bc_crude_axe` | crude axe | 9 | dead | 2.323 ×7, **0.371 (#5, bare-handed)**, 3.366 (killing) | #9 (killing, ambiguous) | no | 952–1104 | 1100 | 6–9 | INCONCLUSIVE (parasite after the death) |
| `vanilla_hand` | hand | 40 | maxHits | 0.749 on hit 1, then 0 ×39 | – | – | 650–653 | 650 | – | PASS |
| `bc_hand` | hand | 40 | maxHits | 0.371 ×40 | none | no | 649–653 | 650 | 36–54 (projected 54) | PASS |
| `bc_ai_zombie` | stone sword | 40 | maxHits | (not a zombie: see below) | – | – | 649–655 | 650 | – | INCONCLUSIVE (target health 538) |

## The INCONCLUSIVE flags: two flaws in the new census rule, and one driver bug
1. **The Zombie Awareness scent marker is not a mob.**
   - `zombieawareness:entityscent` (#87789 in the stone-axe step) has entity type `other`, not `mob`. It floats where a player has been: here at -42.5 121.74 -65.5, in the lane's air.
   - Its metadata index 7 is not health but its own decaying value: 104, then 61, 42 … 1.
   - The census read that as health, so `noAiIntrusion` counted the marker as a living entity in the lane. It cannot hurt anything, and the bot was never hurt.
   - **The fix (a harness bug):** count only `type: 'mob'` entities as living.
2. **The parasite came after the target died.**
   - `mod_lavacow:parasite` #137509 was first seen at t 10,614 ms in the crude axe's Better Combat series, at B's cell. B had died on hit 9 (t 9,613 ms), and the parasite was seen during the 1.5 s settle.
   - So it came from B's own death, after the measurement. This confirms rotn-data's finding that a dying zombie spawns parasites.
   - **The fix:** ignore an entity first seen after the target's death status.
3. **The AI step's target was the scent marker** (#172114, "health" 538, type `other`).
   - The driver's `isZombie` takes any name containing "zombie", and the marker was nearer than the AI zombie: 0.76 against 1.62 blocks.
   - The real AI zombie (#172113, a mob, 20 health) was there and was not attacked.
   - The scent marker's falling "health" (538 to 1) is its own decay, not hits.
   - **The fix:** match only the name `zombie` (`minecraft:zombie`).

## The crude-axe gap (952 ms): a driver bug
- **When the axe broke:** the crude axe broke on hit 4. Each landed hit costs it 2 of its 8 durability, and the vanilla series on A had already landed 1 hit.
- **Why hit 5 went out bare-handed:** the driver checks the held item at the top of each loop, then pre-waits about 950 ms. The break arrived during that wait, so hit 5 went out with an empty hand.
  - The wrapper paced it at the bare hand's cooldown, 13 ticks (650 ms): the gap was 952 ms.
  - Its drop was the bare hand's (0.371).
- **Then:** the driver took the next axe (`reequips` after hit 5).
- **The fix:** check the held item again right before each attack, after the pre-wait.
- **For net-forge, noted only:** hit 6, the first after the re-equip, reported `cooldownTicks` 8, Better Combat's minimum. The attack-speed attribute had not yet been updated for the new item, so for a moment the wrapper's cooldown came from a stale attribute. The gap to hit 6 was still 1,104 ms. That window could let a hit right after an item change go out early; worth a look.

## Hit 1 of each NoAI Better Combat series (#533 review)
**Hit 1 was a crit in 0 of 4 series** (sword, stone axe, crude axe, hand). Attempt 2 had 1 of 3. So the sneak crit that rotn-data #528 expects on a NoAI zombie's first Better Combat hit did not appear reliably on this server. Random crits did appear: sword #2 and #3, stone axe #4 and #7, and possibly the crude axe's killing hit #9.

This is a question for rotn-data. It is not a pass rule, and every count is in the range either way.

## Lane clears, kills, spawns
**Lane clears** (`notes.laneClears`), each 1.5 s after the step's zombie kill:
- before the stone sword: nothing;
- before the stone axe: 2 rotten flesh;
- before the crude axe: 1 zombie skull and 2 rotten flesh;
- before the hand: 1 rotten flesh;
- before the AI zombie: 1 rotten flesh.

No parasite was left in the lane at any step.

**Zombie kills and view distance** (`notes.kills`):

| Step | Killed | View distance |
| --- | --- | --- |
| Setup | 1 | 5 |
| Stone sword, before | 9 | 12 |
| Stone sword, after | 10 | 16 |
| Stone axe, before | 0 | 17 |
| Stone axe, after | 6 | 20 |
| Crude axe, before | 0 | 20 |
| Crude axe, after | 9 | 20 |
| Hand, before | 0 | 20 |
| Hand, after | 6 | 20 |
| AI zombie, before | 0 | 20 |
| AI zombie, after | 5 | 20 |

**The bot's own hurts:** none in any series.

**Spawns near the lane:** each reply lists them, including the summons and the item drops. Their `name` is `null` throughout: the driver reads the name the moment the spawn packet arrives, before mineflayer has named the entity. The census, taken later, has the names.

## For the lead (a small PR before attempt 4)
1. **Match only real zombies:** `isZombie` should take the name `zombie` only (`minecraft:zombie`), not any name containing "zombie".
2. **The census counts only `type: 'mob'` entities as living,** and reads health only from them. Your nit "noAiIntrusion should flag mob-type entities with unread health" fits here.
3. **`noAiIntrusion` ignores entities first seen after the target's death status.**
4. **The driver checks the held item again right before each attack.**
5. **Your other nits:** the misplaced `viewDistanceTail` comment, and `bc-attack-driver.mjs:15` still saying the default is off.
6. **Spawn names:** look them up when the reply is built, not when the packet arrives.

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online`, `setup` | PASS, PASS (68/68 lane cells) |
| `vanilla_stone_sword`, `bc_stone_sword` | PASS, PASS |
| `vanilla_stone_axe`, `bc_stone_axe` | INCONCLUSIVE (scent marker), INCONCLUSIVE (scent marker) |
| `vanilla_crude_axe`, `bc_crude_axe` | PASS, INCONCLUSIVE (parasite after the target's death) |
| `vanilla_hand`, `bc_hand` | PASS, PASS |
| `bc_ai_zombie` | INCONCLUSIVE (the target was the scent marker) |
| `server_log` | PASS: 0 problem lines, 0 kicks. The one `bettercombat` mention is the join's mod list, and the one `lost connection` is the bot's quit at the runner's stop |
| `self_check` | PASS: never tripped over 9 series |

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the checks; `notes.series` (each reply with every hit, the target's identity, `census`, `spawns` and `botHurts`, plus `expected` and `verdict`); `notes.lane`, `notes.laneClears`, `notes.kills`, `notes.inconclusive`.
- `run.log`: the runner's stdout, with each kill and lane clear.
- `server.log`: the test server's log for the run.
- `driver.log`: the driver's stdout and stderr, with every `bc_hit` reply.
- `server-lifecycle.txt`: the three `up` tries, `starts`, the `down` log, and the hcloud counts after the delete.

The raw capture and the `since-start` log stay in the raw folder and are not committed.
