# G3 smoke round 10, batch A (2026-11-07): `g3-rocks-to-stone-tools`, PASS 7 of 7; on 0daeef2d; a SMOKE batch; the server is deleted

**Result in one line:** a fresh bot ran the whole 11-step agenda to a stone pickaxe and a stone axe in 10.5 min. It died once on the way: "crushed by a falling tree" during its first stick collect, right after the `unstuck` reflex moved it.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** the lead's written GO for the round 10 RESTART, approved by the human (2026-11-07, about 18:50 UTC).
  - The first attempt on `12fd263e` stopped on a harness infra fault (`g3a-20261107-r10-attempt1`), fixed in #351.
  - Scope: one smoke batch each of A, B, C, D, in order, each on its own fresh server, from a NEW detached checkout of `0daeef2d` with `npm ci`; the same seed; no skip flags.
  - Not covered: `--gate`, any further rerun, a pre-join retry, the death-report rehearsal.
- **Code:** a clean detached checkout of `0daeef2da14f` (develop, frozen), after `npm ci` (patches applied, 0 changed files).
- **Pack as tested (ADR 0005 + ADR 0008):**
  - the server pack zip SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`;
  - the Mod Director download `mods/esmtweaks-1.12.2-0.4.5.jar`, SHA-256 `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933`.
- **Free memory at 19:18 UTC:** 4,381 MB available of 7,746 MB.
- **Checks right before the create (19:18:40-19:19:05 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL;
  - the dry run (sweeper OK, scheduled run 27 min before);
  - the user-data:
    - 16,962 bytes, gz+b64;
    - `cloud-init schema`: valid;
    - every `write_files` entry equals the checkout's file;
  - the pack default matched the pin.
- **Command:** `deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-rocks-to-stone-tools --out <raw>/rocks -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`, with no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created | 19:19:31 |
| `booting:running`, `unpack`, `starting` | 19:20:08, 19:20:39, 19:20:55 |
| Ready, after the Mod Director check | 19:22:44 |
| Batch start; FRCFLD joined | 19:22:46, 19:22:58 |
| Crushed by a falling tree; respawned | 19:24:27, 19:24:31 |
| Agenda done | 19:33:24 |
| Command exited (PASS, exit 0) | 19:33:41 |
| Server, Primary IP and SSH key verified gone | 19:33:52 |

## Mod Director check (ADR 0008, from `run.log`)

- `mod-director: pinned mods/esmtweaks-1.12.2-0.4.5.jar sha256 b57590bf…f933 OK`.
- `mod-director: OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)`.
- The remote list's own hash is not checked: Mod Director keeps no copy on disk (attempt 1; #351).

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS: none of 24 target items held; the pack's first-join Bread and Bundle seen |
| `stone_tools` | PASS: `minecraft:stone_pickaxe` 1, `minecraft:stone_axe` 1 (`shelter_blocks` got stuck after 5 min of self-prompting, and the agenda went on without it until the night, by design) |
| `crafting_table` | PASS: placed by the bot at -52 65 -95 |
| `cobblestone` | PASS: `undergroundbiomes:metamorphic_cobble:0` 6 |
| `crafted_by_bot` | PASS: crude axe, Crafting Tools, crafting table, stone pickaxe, stone axe |
| `no_cheat` | PASS |

- No kick, no agent exit. One death (below); this scenario has no death check.

## Where the sticks came from (the lead's watch item)

- **The first `!collectBlocks("stick", 3)` (19:23:39):**
  - The `unstuck` reflex interrupted it ("Moved away from (-78, 63, -89) to (-75, 64, -93)").
  - The bot said "I'm stuck!" at 19:24:23 and "I'm free." at 19:24:27. In that same second it was "crushed by a falling tree" at that spot.
  - It had 1 stick, lost with the death. The shortened action output does not say which block gave it.
- **The second call (19:24:42):**
  - It skipped `dynamictrees:leaves0` blocks it could not reach from the ground (#328: "Could not reach … from the ground; skipping it").
  - Then it felled the tree at -69 63 -75: "Collected 7 stick".
  - No dead bush or trunk shell was involved.
- **For skills-rotn (the lead routes):** `unstuck` moved the bot under a tree that was coming down. The collect was interrupted with 8 "waiting for code to finish executing..." lines, and it did stop.

## Other watch items

- **Stop refusals:** no "refused stop after 10 seconds" in `driver.log` or the bot's saved history, and no agent exit.
- **Chat:**
  - The reflex line "eating: food 12, but no safe food in the inventory" came 10 times in the console and never in chat.
  - Two lines were repeated within 60 s: `!craftRecipe("stone_axe", 1)` and `!craftRecipe("cobblestone", 1)`. Both were the LLM's own command replies, not reflex lines.
- **`[inventory]` rejected-click lines:** none.

## LLM, providers and memory summaries

- **Requests:** 64: 49 agent replies and 15 memory summaries. None failed, none was empty, no HTTP errors; all went to Wafer.
- **Memory summaries:** 15 "Storing memories..." and 15 "Memory updated to:".

## Cost

- **Spend:** USD 0.008157 (key usage 0.902245 to 0.910402, from `batch.json`).
- **Hetzner:** ran 14 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
