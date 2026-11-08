# G4 step 0: the first start of FRCFLD on the CX23 (2026-11-08)

**Label: the step 0 first start, under the lead's written GO `G4-S0-20261108`.** It is **never G4 acceptance evidence**: G4 evidence comes only from the six step-7 runs under their own rules (test/scenarios/g4/PLAN.md). No scenario ran; the runner sent nothing to the bot or the console. The CX23's address is redacted everywhere (`<ip>`), as is the dev server's.

## Who did what
- **The human:** the CX23 side, by hand under the GO. This covered the release `rotn-v0.1.2`, the env file (its `host` set to this test server), the starts, and the stop at 14:56:13 UTC. The unit stays **disabled**.
- **harness-ops:** the disposable test server (`deploy/test-server.sh up` from develop `026e639c`). Under the GO it read the server log and console, and `cx23-ctl` `status`, `journal` and `metrics` for frcfld, read-only. It deleted the server afterwards.
- **The lead:** read the unit's journal and metrics through the restricted gate (ADR 0009). Facts marked *(lead, via the gate)* below are the lead's reading.

## The test server
| | |
| --- | --- |
| Name | `mcr-test-20261108-135521`, CPX42, nbg1, Ubuntu 24.04 |
| Created / ready / deleted (UTC) | 13:55:28 / 14:00:22 (`Done (27.054s)!` at 14:00:06) / 14:58:39 |
| Watchdog | `delete-after` 2026-11-08T21:55:28Z (the default 8 h) |
| Firewall | 22 and 25565 only from the CX23 and the dev server (`firewall_allow_from=<ip>/32 <ip>/32`). An explicit `--allow-from` replaces the default, so the dev server's own address was passed too |
| Server | online mode, whitelist `<bot>,JQDAW`; Forge 14.23.5.2860, 346 mods (status ping) |
| Pack | RotN 3.3.4 server zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205` |
| Mod Director (ADR 0008) | `mods/esmtweaks-1.12.2-0.4.5.jar` SHA-256 `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 jars of the pinned zip match; 0 extra mods |
| Cost | ran 63 min, billed about 2 h: EUR 0.2762, plus the Primary IPv4 |
| After | `hcloud server list`, `primary-ip list` and the labelled `ssh-key list`, counted with `grep -c .`: 0, 0, 0 |

## The bot's run
**Active 14:34:36–14:56:13 UTC** *(lead, via the gate)*.
- **The join (server log):** at 14:34:46, with a version-4 (Mojang) UUID, so an online login with its own account. It spawned at (-48.5, 82, -64.5).
- **Its start lines (journal, read by harness-ops):**
  - `[settings] effective allow_insecure_coding=false`
  - `[settings] effective task_givers=["JQDAW"] allow_server_task_giver=false`
  - `[state] <bot> at start: tasks=absent agenda=absent memory=absent`
  - `[naming] <bot> near spawn: 4 kinds; unknown 0; undergroundbiomes:sedimentary_sandstone:332 biomesoplenty:dirt:118 biomesoplenty:grass:83 biomesoplenty:plant_0:5`
- **The unit:** `NRestarts=0` *(lead, via the gate)*. MemoryPeak about 463 MB *(lead)*; at the join, harness-ops read 345 MB current and 357 MB peak.
- **LLM:** 60 calls, USD 0.00758, the sum of the `[openrouter] usage … cost_usd` lines *(lead, via the gate)*. About USD 0.02 per hour over this 21-minute session. That is a single short session, not the soak's measure.
- **The agenda (the bot's own chat, server log):**
  - rocks done at 14:35:35;
  - sticks and logs at 14:38:37;
  - crude axe, first plank, Crafting Tools, crafting table, planks and sticks, and stone pickaxe from 14:39:09 to 14:39:52;
  - cobblestone at 14:42:35;
  - `agenda step stone_axe stuck: 5 min of self-prompting; agenda paused` at 14:47:35;
  - `[night] in the shelter at 157, 53, -62 until morning` at 14:49:15.
- **Insecure coding is off, live:** the model tried `!newAction`, and the bot answered `newAction is disabled. Enable with allow_insecure_coding=true in settings.js` (14:36:16).
- **Survival** *(lead, via the gate)*: it ate bread at food 12. One `windowOpen` timeout at 14:46 recovered (the server log has the bot's "Pathfinding got stuck" at 14:46:07).
- **The stop:** the human's ctl stop at 14:56:13 (`<bot> left the game`).

## The earlier failed starts (the same day, before this run)
1. **`PROFILES` still `./profiles/frcfld.json`**, from `bot.env.example`: `main.js` died with ENOENT (main.js:81). systemd hit `StartLimitBurst` (6 starts in 10 min) at 14:09:41. The human fixed `PROFILES` and started it again.
   - **Fix pending:** `check-env` refuses a profile path the release lacks; `bot.env.example` defaults to `./profiles/rotn-bot.json`; the README covers the start limit.
2. **`deploy.sh` deleted the release's tracked `bots/execTemplate.js` and `bots/lintTemplate.js`** (it replaces `bots/` with the link to the shared folder). The Coder threw ENOENT in a callback and the agent crash-looped. The human copied both templates at `rotn-v0.1.2` into the shared folder.
   - **Fixed in code:** #410 (the Coder reads the templates on first use; a missing one is a log line, never a crash).
   - **Pending:** `deploy.sh` keeps them (the approach is the lead's decision).

## Watch items (for the owners; not judged here)
- **Food 12, low, at 14:48 with no eat** *(lead, via the gate)*: for skills-rotn (G4 #5, the soak's `ate_when_low`).
- **`stone_axe` stuck after 5 min of self-prompting:** the agenda paused there, with pathfinding stuck around 14:46 (skills-rotn).
- **On first join the pack ran its own commands** as the player: `commandBlockOutput` and `sendCommandFeedback` set to false, a bread and a bundle given. These are the known pack first-join commands, also seen in G3. With `sendCommandFeedback` false, command feedback (`execute … testfor`) is not echoed to players on this pack.

## Files
- `server-log-excerpt.log`: the server's `Done` line and every line naming the bot from 14:34 to 14:59 (121 lines). It was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`, and the leak check (`--check`) is clean. The full server log (3.8 MB) stays on the dev server, uncommitted.
