# S1-A, 2026-11-02: the G2 world (seed 1880465901402976865). A survey, never a gate

harness-ops ran this batch on the lead's written GO (2026-11-02 19:09 UTC, relayed by the human), as planned in `coord/STATUS-harness-ops.md`, "The S1 batches". Every run is notGate by design ("S1 is a survey/smoke, never a gate pass").

**The batch was cut short:**
- At about 19:55 UTC Claude Code reaped the batch's tracking shell and the hard-stop watcher, because this PC was critically low on memory. The batch processes themselves kept running.
- Following the GO ("if anything breaks: stop, delete, report"), harness-ops fetched the server logs by hand at 19:56:27.
- At 19:56:37 the day-cycle run then failed by itself: a console call could not start a new process on the PC (Windows code 3221225794, `0xC0000142`).
- The batch script tore the server down normally ("verified gone" 19:57:08).
- S1-B was **not** started.

All files came out of the merged `test/tools/redact-evidence.mjs` (with `--bot FRCFLD`, except `time-segments.txt`, which holds no names), with no hand edits. The CI leak check passes.

| Folder | Scenario | Result |
| --- | --- | --- |
| `survey/` | `s1-site-survey` | FAIL on `no_containers` (a finding: two underground dungeons); `login_online`, `census_complete`, `findings_confirmed` PASS |
| `arbiters/` | `s1-arbiters` | SMOKE-PASS (not a gate pass): all 5 checks pass |
| `day-cycle/` | `s1-day-cycle` | FAIL (the run stopped at 19:56:37 on the PC's process error). The samples up to then are in its `server.log` excerpt (`Time is N` lines) and in `time-segments.txt`, computed from them |

## Run

- **Code:** a clean detached checkout of develop at 16db8ac (#106), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks before the create (19:11 UTC):**
  - `msa-login FRCFLD --check` exit 0, its output discarded;
  - the preflight on its own passed via the helper path;
  - no servers or Primary IPs in the project.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `--seed 1880465901402976865`, `deploy/test-server.sh run` unchanged.
- **Console:** only S1's commands. No `time set`, and no `gamerule` with a value.
- **Times (UTC):**
  - batch start 19:12:08, server created about 19:12:20, ready 19:15:15;
  - survey 19:15:17-19:18:50, arbiters 19:18:50-19:20:15, day cycle from 19:20:15 until the stop at 19:56:37;
  - teardown "verified gone" 19:57:08.
- **Cost:** up 44 min, 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 19:57:13 the server and primary-ip lists were empty; the only SSH key was the human's unlabelled one. No batch process was left on the PC.

## Survey (radius 48 around the fresh spawn)

- **Spawn:** -50.5 64 -66.5, on the ground.
- **The census:** 323 non-air types (limit 400), so the census claims the whole cube; 0 of 912,673 positions unloaded.
- **Rock piles: 203 blocks**, mostly Underground Biomes rocks. 5 sampled positions were confirmed, all on the surface (4-10 blocks above spawn level), 19-46 blocks from spawn.
  - `pyrotech_compat:rock_metamorphic` 0 81 and 6 23;
  - `pyrotech_compat:rock_igneous` 0 71 and 7 8;
  - `pyrotech_compat:rock_sedimentary` 0 15, 1 1 and 2 1;
  - `pyrotech:rock` 4 3.
  - Also 149 `pyrotech:rock_grass` (not counted as rocks; listed as unclassified).
- **Trees: 8,521 blocks** (Dynamic Trees branches and trunk shells, plus 335 `minecraft:log`).
- **Stone:** 406,694 blocks of `undergroundbiomes:*_stone` (metamorphic, igneous, sedimentary).
- **Containers: 7 blocks, in two underground dungeons.** Every sampled position was confirmed by `testforblock`.
  - `minecraft:mob_spawner` 0 2; `minecraft:chest` 4 2, 2 2 and 5 1.
  - Sampled: spawners at -68 26 -36 and -24 22 -98, chests at -65 26 -36, -39 19 -104 and -27 22 -96.
  - That is 38-45 blocks below spawn level and 34-41 blocks away horizontally.
- **Unclassified modded types: 172**, listed in `survey/result.json` (`notes.findings.unclassifiedModded`). Most are:
  - Dynamic Trees and Rustic leaves;
  - `osv:*` ore variants;
  - `rotn_blocks:cave_moss` and `verribyne`;
  - `adpother` gases;
  - Biomes O' Plenty plants, `quark:roots`, and `pyrotech:rock_grass`.
  - None has a container-like class in rotn-data's dump.

## Arbiters

- **Stat criteria:** all 8 were `added`, including the RotN ones:
  - `stat.craftItem.pyrotech.crude_axe` and `stat.craftItem.contenttweaker.crafting_tools`;
  - `stat.craftItem.minecraft.crafting_table`, `.stone_pickaxe`, `.stone_axe` and `.cobblestone`;
  - `stat.deaths` and `stat.playOneMinute`.
- **`scoreboard players list <bot>`** shows only objectives that have a score: "Showing 1 tracked objective(s) for <bot>:" with `s1_played` 36. An objective with no score yet is absent, not 0.
- **The count-only `clear <bot> <item> -1 0`:**
  - "<bot> has 1 items that match the criteria" for the given stone pickaxe, twice, so it removed nothing;
  - "Could not clear the inventory of <bot>, no items to remove" for `minecraft:diamond` and `pyrotech:crude_axe`.
- **`time query daytime`:** "Time is 3001".
- **Removing a missing objective:** "No objective was found by the name '<name>'".
- **The whisper:** the console `tell` reached mineflayer's `whisper` event with the sender **`Server`**.

## Day cycle (with Extended Days; the bot online)

From the `Time is N` replies in `day-cycle/server.log`, analysed in `time-segments.txt`:
- **Rate:** while it runs, the day time advances at the vanilla rate, a median of 1,199 ticks per real minute.
- **It freezes twice per cycle, for about 10 minutes each time:**
  - at daytime **3000**, in the morning: from about 19:18 (inferred) to 19:27:17, about 9.3 min;
  - at **16000**, early night: from 19:38:08-19:39:13 to 19:48:58-19:50:02, about 10 min.
- No other freeze appeared between 3000 and 23635, the last sample at 19:55:28.
- **The cycle:** 24,000 running ticks (about 20 min) plus about 20 min frozen, so about **40 min**. That matches the RotN wiki's "about 20 minutes of a 40-minute cycle" for the day.
- **The night** (vanilla 12542-23460) lasts about 9 min running plus 10 min frozen, about **19 min**.
- **Not observed:** the stretch from 0 to 3000 and the wrap past 24000 (the run stopped at 23635). Time Shall Not Pass also pauses the cycle while no player is online (seen at 19:20:12-19:20:22, between scenarios).
