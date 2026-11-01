# Status: net-forge

Updated: 2026-11-01

Branch `agent/net-forge/g1-spike`, worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/net-forge-g1`.

## Done (offline, step 1 of the G1 spike)

- **`packages/forge-bridge`**: a fresh nmp client plugin per ADR 0003. Details are in `packages/forge-bridge/README.md`.
  - `tagHost = '\0FML\0'`, set before connect. It never uses `fakeHost`.
  - The exact Forge client handshake state machine. Acks carry the client's own state ordinals (2, 3, 4, 5). Our ModList is the server's own list, byte for byte.
  - RegistryData parsing (ids, then dummied, then overrides) into a RegistrySnapshot with name/id maps.
  - `FML|MP` reassembly, plus decoders for `FML` (EntitySpawn, OpenGui), `FORGE` (DimensionRegister, FluidIdMap) and `jeid`.
  - REID overrides, enabled only when the ModList has **`jeid`**:
    - `slot` item id as a VarInt;
    - `remove_entity_effect` id as an i32;
    - `entity_effect` keeps the vanilla fields and reads a trailing VarInt, which the bridge copies into `effectId`.
  - On every Forge connection: entity-metadata type ids are read as VarInts.
  - The mod list comes from a status ping. If the ping fails, it falls back to `FORGE_MODLIST_FILE`, for which the pinned fixture is `packages/forge-bridge/test/fixtures/rotn-3.3.4/ping.json` (a byte copy of `test/evidence/g0/status-ping.json`).
  - Capture: JSONL of every plugin-channel message in both directions, selected play packets, handshake events, kicks, and parse errors with raw bytes. The username and UUID are redacted at write time. The default folder is `captures/raw/`, which is git-ignored.
  - Kick classification per spec section 4, mapped to the ADR 0003 exit codes (0 clean, 1 transient, 3 fatal).
- **REID 2.2.2 layouts confirmed from the jar.** I ran `javap` on the class files of `RoughlyEnoughIDs-2.2.2.jar` from the pinned zip. The jar was extracted to a scratch folder outside the repo; nothing from it was run. All five section-R rows match. New facts:
  - The `jeid` channel's three message layouts (README table).
  - `remove_entity_effect` reads nothing for the vanilla byte (a Redirect to 0), then reads an i32.

  Lead, you may want to fold these into `fml-spec.md` section R.
- **`initBot` fixes**, all inside the function in `src/utils/mcdata.js`, plus one import line:
  - The version is read from settings inside `initBot`.
  - `profilesFolder` comes from `MINDCRAFT_PROFILES_FOLDER`.
  - forge-bridge is attached through nmp's `connect` option. `FORGE_BRIDGE=auto|on|off`; `auto` attaches when the ping reports FML.
  - The position throttle now keeps the newest state, merging position and look.
  - PartialReadError is counted and logged, no longer swallowed silently.
- **Dependency patches:**
  - New `patches/prismarine-chunk+1.41.0.patch`: the packet's bitsPerBlock is used for global-palette sections, and REID's VarInt biome tail is read.
  - `patches/protodef+1.19.0.patch`: `PROTODEF_LOG_PARTIAL=1` turns the "partial packet" log line back on.
  - `minecraft-data+3.97.0.patch` is renamed to `+3.119.0` (lead's item). patch-package now applies all seven patches with no version warning.
- **Tools** (`packages/forge-bridge/tools/`):
  - `msa-login.mjs`: the human's device-code login. It prints only the profile name.
  - `g1-spike.mjs`: the spike runner, using the real `initBot`.
  - `capture-summary.mjs`.
- **Tests:** `npm test` passes 96/96. All of it is offline, using synthetic fixtures plus the pinned ping.
  - This includes `e2e-initbot.test.js`: the real `initBot` against an in-process fake Forge server on 127.0.0.1. It covers the ping, tagHost, the handshake, a REID chunk, inventory and effect, chat both ways, walking and the capture.
  - Reversing the patches makes the chunk tests fail, so they really test the patch.
- **Lint:** `npm run lint` gives 259 errors, the baseline. My files add none, and `mcdata.js` stays at its own baseline of 13.

## Doing

- Opening the PR for this offline part (forge-bridge, `initBot` fixes, patches) once the WIP is pushed.

## Next

1. **Paid batches**, after the lead's written approval and once a scheduled sweeper run has been seen. See "Planned real batches".
2. Captured fixtures: the real handshake, RegistryData, `window_items`/`set_slot`, chunks, `entity_effect`, and `jeid`. Then the handshake-sequence test against real captured server messages, which the brief requires.
3. Classify every kick seen, confirm the chunk bits per block, and confirm the REID formats on the wire.
4. Later brief items: `bot.registry` extension (item 4), then FML EntitySpawn into `bot.entities` (6), then backoff and exit codes in `agent_process.js` (8).

## Planned real batches (waiting for lead approval; nothing run yet)

Both run on the disposable test server only, never the live server, with `deploy/test-server.sh` used unchanged: CPX42, nbg1, `--ttl-hours 2`, at EUR 0.138/h. Each batch is deleted by the `run` EXIT trap, with the sweeper as backup.

- **Batch A (spec Run A, handshake capture).** Expected about 20 min, 1 billed hour. Maximum (TTL + 1) is 3 h, about EUR 0.42, plus one Primary IPv4-hour.

  ```bash
  deploy/test-server.sh run --yes --capture --ttl-hours 2 -- bash -c \
    'node packages/forge-bridge/tools/g1-spike.mjs --mode handshake --out captures/raw/g1-runA; s=$?; bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g1-runA/server; exit $s'
  ```

- **Batch B (spec Run B, G1 proper).** Login online, stay 11 minutes, chat both ways (the `say` check goes through the test-server console), walk. Expected about 35 min, 1 billed hour. Maximum 3 h, about EUR 0.42, plus one Primary IPv4-hour.

  ```bash
  deploy/test-server.sh run --yes --ttl-hours 2 -- bash -c \
    'node packages/forge-bridge/tools/g1-spike.mjs --minutes 11 --out captures/raw/g1-runB; s=$?; bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g1-runB/server; exit $s'
  ```

- Both batches run with `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa` set. Expected total EUR 0.28; maximum EUR 0.84.
- Raw output stays in `captures/raw/` (git-ignored). Only sanitized excerpts go into `packages/forge-bridge/test/fixtures/` and `test/evidence/g1/`.

## Blocked

- Paid batches: waiting for lead approval and the observed scheduled sweeper run (since 2026-11-01).
- Batch B: waiting for the human's FRCFLD login (below). Batch A also logs in online, so it needs the login too.

## Requests to other agents or the lead

1. **Human, via the lead (NEEDS-HUMAN): one-time device-code login for FRCFLD.** Please run it in your own terminal, not through this chat, so the code never lands in an agent's context:

   ```powershell
   cd C:\Users\admin\orca\workspaces\mindcraft-RotN\net-forge-g1
   $env:MINDCRAFT_PROFILES_FOLDER = "C:/Users/admin/.mindcraft-rotn/FRCFLD/msa"
   node packages/forge-bridge/tools/msa-login.mjs FRCFLD
   ```

   - It prints Microsoft's instruction: open microsoft.com/link and type the code. Sign in there with the bot account; enter credentials only on Microsoft's page.
   - At the end it prints `Signed in. Minecraft profile: FRCFLD`. Please confirm that the name matches. No agent reads or prints the cache.
2. **Lead (`settings.js` / profile, your files):** for RotN runs, set `"minecraft_version": "1.12.2"` and `"auth": "microsoft"`. Until then, `initBot` still attaches the bridge in `auto` mode whenever the ping reports FML, and `g1-spike.mjs` sets these itself.
3. **Lead (`package.json`, optional):** forge-bridge imports three transitive packages of minecraft-protocol: `lodash.merge`, `protodef` and `prismarine-nbt`. The lockfile pins them, so nothing is needed now. Making them direct dependencies would protect against hoisting changes.
4. **skills-rotn (later, through the lead):** `bot.forge.bridge.lastKick` carries `{category, fatal, exitCode}` for the `agent.js` kick handler (ADR 0003 decision 5).

## Open PRs

- (none yet; the PR follows the WIP push)
