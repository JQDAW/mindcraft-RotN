# G3 GATE batch A (2026-11-07): `g3-rocks-to-stone-tools`, PASS 7 of 7; on 0daeef2d; a GATE batch; the server is deleted

**Result in one line:** a fresh bot ran the whole 11-step agenda to a stone pickaxe and a stone axe in about 8 min, with no death.

**A gate batch:** `batch.json` says `"gate": true, "smoke": false` (written by `batch.mjs --gate`, not edited by hand). The single-batch gate claim check passes: `node test/tools/g3-batch-check.mjs batch.json rocks/result.json` → "consistent: 1 result(s) vouched for by … a gate batch (gate: true)".

## Run conditions

- **GO:** the lead's written GO for the G3 gate batches, given by the human (2026-11-07, about 20:55 UTC) under `docs/PLAN.md`'s G3 gate rule, after the clean smoke round 10 restart (PASS 4/4, #352).
  - Scope: exactly one `batch.mjs --gate` batch per scenario, A, B, C, D in that order, each on its own fresh server, the same seed, no skip flags.
  - Rules: a failed gate batch is a result and stays in the evidence; the remaining batches still run; no rerun, no pre-join retry, no extra batch without the human.
- **Code:** the verified detached checkout of `0daeef2da14f` (develop, frozen) used for the smoke restart; `npm ci` state unchanged, 0 changed files.
- **Pack as tested (ADR 0005 + ADR 0008):**
  - the server pack zip SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`;
  - the Mod Director download `mods/esmtweaks-1.12.2-0.4.5.jar`, SHA-256 `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933`.
- **Free memory at 20:59 UTC:** 4,306 MB available of 7,746 MB.
- **Checks right before the create (20:59:44-20:59:59 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the gate preflight (`--preflight --gate`) with the LLM probe (HTTP 200, Wafer): "timeouts: g3-rocks-to-stone-tools 37 min; a GATE batch (gate: true)", for a 120 min TTL;
  - the dry run (sweeper OK by cadence);
  - the user-data: 16,962 bytes, gz+b64, valid schema, every `write_files` entry equals the checkout's file;
  - the pack default matched the pin.
- **Command:** `deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --gate --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-rocks-to-stone-tools --out <raw>/rocks -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`, with no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 21:00:32, 21:03:44 |
| Batch start; FRCFLD joined | 21:03:46, 21:03:57 |
| Agenda done | 21:12:14 |
| Command exited (PASS, exit 0) | 21:13:37 |
| Server, Primary IP and SSH key verified gone | 21:13:50 |

## Mod Director check (ADR 0008, from `run.log`)

- `mod-director: pinned mods/esmtweaks-1.12.2-0.4.5.jar sha256 b57590bf…f933 OK`.
- `mod-director: OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)`.

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS: none of 24 target items held; the pack's first-join Bread and Bundle seen |
| `stone_tools` | PASS: `minecraft:stone_pickaxe` 1, `minecraft:stone_axe` 1; the agent reports its cobblestone step done |
| `crafting_table` | PASS: placed by the bot at -44 65 -25 |
| `cobblestone` | PASS: `undergroundbiomes:metamorphic_cobble:0` 10 |
| `crafted_by_bot` | PASS: crude axe, Crafting Tools, crafting table, stone pickaxe, stone axe |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.

## Watch items

- **Sticks:** one `!collectBlocks("stick", 3)`, output not shortened. A `deadbush` and two `dynamictrees:leaves0` each logged "got no stick". Two later "Picked up 1 items" lines made up "Collected 3 stick". The tree was felled later, for logs.
- **Chat:** no identical bot line within 60 s; none held back. **Stop refusals:** none; no agent exit.

## LLM and cost

- **Requests:** 61: 47 agent replies and 14 memory summaries. None failed, none was empty; all went to Wafer.
- **Spend:** USD 0.007996 (key usage 0.925693 to 0.933689, from `batch.json`).
- **Hetzner:** ran 13 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
