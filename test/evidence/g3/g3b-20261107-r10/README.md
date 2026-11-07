# G3 smoke round 10, batch B (2026-11-07): `g3-first-night`, PASS 5 of 5; on 0daeef2d; a SMOKE batch; the server is deleted

**Result in one line:** a fresh bot finished the whole agenda (stone pickaxe and axe) by 19:45, built its shelter at sunset (19:52:54), was inside 3 s later, and stayed there until dawn (20:18:32): no deaths, online for all 39.6 min.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** as for batch A (`g3a-20261107-r10`). B ran after A, on its own fresh server.
- **Code:** the same clean checkout of `0daeef2da14f`, on the CX33.
- **Pack as tested:** the zip SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`, plus the Mod Director download `mods/esmtweaks-1.12.2-0.4.5.jar`, SHA-256 `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` (ADR 0005 + ADR 0008).
- **Free memory at 19:34 UTC:** 4,458 MB available of 7,746 MB.
- **Checks right before the create (19:34:18-19:34:32 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-first-night 67 min" for a 180 min TTL;
  - the dry run (sweeper OK);
  - the user-data: 16,962 bytes, gz+b64, valid schema, every `write_files` entry equals the checkout's file;
  - the pack default matched the pin.
- **Command:** the batch A command with `--ttl-hours 3`, `--scenario g3-first-night` and `--out <raw>/night`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 19:34:59, 19:38:14 |
| Batch start; FRCFLD joined | 19:38:16, 19:38:26 |
| `sticks` step started, done | 19:39:02, 19:40:14 |
| Agenda done | 19:45:09 |
| "[night] sunset is near: building a shelter" | 19:52:54 |
| "[night] in the shelter at -34, 64, -49 until morning" | 19:52:57 |
| "[night] morning: found no safe side to open; back to work" | 20:18:32 |
| Command exited (PASS, exit 0) | 20:18:57 |
| Server, Primary IP and SSH key verified gone | 20:19:07 |

## Mod Director check (ADR 0008, from `run.log`)

- `mod-director: pinned mods/esmtweaks-1.12.2-0.4.5.jar sha256 b57590bf…f933 OK`.
- `mod-director: OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)`.

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | PASS: dawn reached; `stat.deaths` 0; death lines 0 |
| `stayed_online` | PASS: online from the join to the end (39.6 min) |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.

## The shelter watch items (lead, after round 9 B)

**No mob reached the shelter all night, so the digging, repair, fight and falling-block paths were not exercised.** What the logs show:

- **Digging alarm** ("… is digging the shelter …: checking at once"): 0. Nothing dug.
- **Repairs:** 0 "the shelter is open at", 0 "the repair placed nothing", 0 "the repair did not close". No repair storm.
- **Fighting:** 0 "Fighting … from the shelter!", 0 "Fought from inside". No line shows the bot leaving the shelter: 0 "not in a shelter any more", 0 "no longer in the shelter".
- **Falling blocks:** 0 "dug … out of the shelter's head space".
- **#337 (after a night death):** not reached (no death).
- **"refused stop after 10 seconds":** none in `driver.log` or the bot's saved history; 0 "waiting for code to finish executing"; no agent exit.
- **For skills-rotn (the lead routes):** at dawn the bot said "morning: found no safe side to open; back to work". The scenario ended 23 s later at dawn, so whether it then dug out is not shown. Worth a look in case that line means the bot stays shut in.

## Where the sticks came from

- **The `sticks` step took 72 s.** In round 9 B it stalled and paused the agenda.
- **The first `!collectBlocks("stick", 3)`:** "Collected 2 stick". A `dynamictrees:leaves0` source is likely, but the output was shortened (`night/driver.log` lines 177-193): it shows leaf breaks that gave none, a "Picked up 1 items", and a pathfinding timeout.
- **Then 4 calls gave 0 before `!newAction`:** `!collectBlocks("stick", 1)`, river cane (`biomesoplenty:plant_1:5`), bamboo (`biomesoplenty:bamboo`), and another `!collectBlocks("stick", 1)` ("No cane or bamboo nearby either").
- **`!newAction`:** the bot tried it; it is disabled and said so.
- **A fourth call (`"stick", 1`, "Under the leaves now"):** picked up 1 stick, so the source is a leaf drop on the ground.
- **No dead bush.** The bot felled trees only later, for logs ("Cut the tree at -46, 65, -54"; "Felled the tree at -50, 64, -66").

## Chat

- No identical bot line within 60 s, and no line held back as a repeat (#344).

## LLM, providers and memory summaries

- **Requests:** 53: 41 agent replies and 12 memory summaries. None failed, none was empty, no HTTP errors; all went to Wafer.

## Cost

- **Spend:** USD 0.006759 (key usage 0.910405 to 0.917163, from `batch.json`).
- **Hetzner:** ran 44 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
