# G3 smoke round 9, batch A (2026-11-07): `g3-rocks-to-stone-tools`, PASS 7 of 7; on 670fe8aa; a SMOKE batch; the server is deleted

**Result in one line:** the bot ran the whole agenda in 6 minutes. It made a crude axe, Crafting Tools, a crafting table (placed at -42 64 -65), 10 metamorphic cobblestone, a stone pickaxe and a stone axe, and logged "agenda done" at 12:57:18.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** the human's written GO for G3 smoke round 9 (2026-11-07, about 12:46 UTC), relayed by the lead.
  - Scope: one smoke batch each of A, B, C, D, in that order, each on its own fresh server, with no skip flags.
  - Not covered: `--gate`, reruns, retries of a pre-join failure.
- **Code:** a clean detached checkout of `670fe8aa2f29` (develop, frozen for the round), after `npm ci` (8 of 8 patches). The run is on the CX33 dev server.
- **Free memory at 12:47 UTC:** 4,850 MB available of 7,746 MB, no swap.
- **Checks right before the create (12:47:11-12:47:26 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - the key present;
  - an empty project (0/0/0, counted with `grep -c .`);
  - the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL;
  - the dry run (sweeper OK by cadence);
  - the pack zip default `<local>/RotN 3.3.4 Server Pack.zip`, hashed and matched to the pin.
- **Command:** `deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-rocks-to-stone-tools --out <raw>/rocks -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`, with no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created, ready | 12:48:24, 12:51:11 |
| Batch start | 12:51:13 |
| FRCFLD joined; "agenda step rocks started" | 12:51:24, 12:51:26 |
| "sticks started"; "sticks done" | 12:52:01, 12:52:35 |
| "agenda done" | 12:57:18 |
| Command exited (PASS, exit 0) | 12:58:55 |
| Server, Primary IP and SSH key verified gone | 12:59:05 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS: none of 24 target items held; the pack's first-join Bread and Bundle seen |
| `stone_tools` | PASS: stone pickaxe 1, stone axe 1; the agent reports its cobblestone step done |
| `crafting_table` | PASS: the bot's own placement at -42 64 -65 (server) |
| `cobblestone` | PASS: `undergroundbiomes:metamorphic_cobble:0` 10 |
| `crafted_by_bot` | PASS: crude axe 2, Crafting Tools 1, crafting table 1, stone pickaxe 1, stone axe 1 |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.
- **Where the sticks came from (the lead asked):** leaves.
  - The `sticks` step was one `!collectBlocks("stick", 3)` call. It broke `dynamictrees:leaves0` until it had 3 sticks: several leaf blocks gave none ("Broke dynamictrees:leaves0 but got no stick."), and the call ended "Collected 3 stick."
  - No dead bush was used: there is no dead-bush line in the driver log.
  - Felling came later, in the `logs` step: the bot cut the tree at -42 66 -69 for logs, not sticks.
  - The 12 sticks used for the pickaxe and axe were crafted from planks at the table (`!craftRecipe("stick", 2)`).
- **A short detour:** at 12:53:55, after "first_plank done", the agenda started `shelter_blocks`. The bot dug 40 dirt piles, then went back to `crafting_tools`.
- **This is the opposite of round 8's A**, which stalled at `sticks` (felling gave no sticks, and a dead bush gave 1).

## LLM, providers and memory summaries

- **Requests:** 52: 40 agent replies and 12 memory summaries. None failed, none was empty, no HTTP errors.
- **Checked by hand:** 12 "Storing memories..." and 12 "Memory updated to:".

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 52 | 0 | 12 (6 attributed, 6 unattributed) | 0 |

## Cost

- **Spend:** USD 0.006498 (key usage 0.875739 to 0.882237, from `batch.json`).
- **Hetzner:** ran 10 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0, counted with `grep -c .`.

## Files

- `batch.json`, `run.log`, and `rocks/result.json`, `rocks/driver.log`, `rocks/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- The raw logs are in `captures/raw/r9-g3a/` (not committed).
- The round summary is in the batch D README (`g3d-20261107-r9`).
