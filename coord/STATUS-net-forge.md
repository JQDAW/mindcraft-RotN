# Status: net-forge

Updated: 2026-11-01

Branch `agent/net-forge/g1-spike`, worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/net-forge-g1`.

## Done (offline, step 1 of the G1 spike; PR #10, merged as 26a0b5e)

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
- **Tests:** `npm test` passes 101/101. All of it is offline, using synthetic fixtures plus the pinned ping.
  - This includes `e2e-initbot.test.js`: the real `initBot` against an in-process fake Forge server on 127.0.0.1. It covers the ping, tagHost, the handshake, a REID chunk, inventory and effect, chat both ways, walking and the capture.
  - Reversing the patches makes the chunk tests fail, so they really test the patch.
- **Verifier pass (adaptive-agents:verifier) on PR #10: PASS WITH ISSUES.** All findings are addressed in a follow-up commit:
  1. **Medium: a capture leak, reproduced by the verifier.** Parse-error and partial-packet records, and raw buffers inside decoded payloads, were base64-encoded before redaction.
     - Every Buffer, and every `b64` string, is now redacted inside the JSON replacer.
     - `test/bridge.test.js` covers each path.
  2. **Low:** `bot.partialReadErrors` never counted deserializer drops. It now includes the bridge's count.
  3. **Low:** reassembled FML|MP payloads are now re-emitted as `custom_payload` (spec 1.6). A length mismatch is logged.
  4. **Low:** the connect wrapper now does nmp's SRV lookup.
  5. **Low:** undeclared dependencies. See request 3, now listing minecraft-protocol and prismarine-auth too.
  6. **Info:** chunk bit widths for local writes. Documented under README "Known limits".
- **Lint:** `npm run lint` gives 259 errors, the baseline. My files add none, and `mcdata.js` stays at its own baseline of 13.

## Done since PR #10 merged (branch `agent/net-forge/g1-review-fixes`, from develop 26a0b5e)

The review findings on PR #10, numbered as in the review comment:

- **2 (medium) kicks:** `Failed to verify username` and `Invalid session` are now transient with `retryCap: 3`. The ban rule only matches `You are banned`, `Your IP address is banned` and `multiplayer.disconnect.banned*` at the start of the reason. "No Minecraft licence" stays fatal as its own category.
  - New `createRestartPolicy()` implements the ADR 0003 backoff (10 s doubling to 5 min, reset after 10 min connected) and the caps. It is not wired in yet; that is `agent_process.js`, brief item 8.
- **3 msa-login:** refuses any folder inside any git work tree. It walks up looking for `.git`, a folder or a worktree's file, and creates nothing on refusal. It creates the folder with mode 0700 and chmods it on POSIX. The check lives in `src/secret-folder.js` and has tests.
- **4:** `delete process.env.DEBUG` runs before prismarine-auth loads. A test checks that order and that the tool refuses a folder inside this repo.
- New: `msa-login.mjs FRCFLD --check` confirms the cache without ever starting a device-code prompt. If the cache needs a new login, it fails.
- **5 chunk widths:** a section now widens its data array when a written state id needs more bits. A section that leaves its palette uses the width of its widest id. `new Chunk({maxBitsPerBlock})` can seed the width. Local `block_change` writes of 20-bit ids are tested. README line 109 is corrected.
- **6:** `test/golden.test.js` holds hand-written hex vectors for ModList, RegistryData (1-, 2- and 3-byte VarInt ids), FML EntitySpawn (metadata, thrower velocity, spawn data) and FML|MP (PART_SIZE 1048496, 2 parts). The layouts come from `javap` on Forge 14.23.5.2860's own classes in the pinned pack's Forge jar, extracted to scratch and never run. Our decoders read each vector, and our encoders reproduce it byte for byte.
- **7:** `ChunkColumn.dump()` writes REID VarInt biomes back, or switches to them for any id over 255. Two tests show that a dump reloads. The viewer stays off (`render_bot_view: false`).
- **8:** the README documents that nmp's `merge` mutates the shared minecraft-data 1.12.2 protocol object. I confirmed this in a node session: `createSerializer` with customPackets changes `mcData('1.12.2').protocol.types.slot`.
- **10:** `g1-spike` `summary.json` records `walkMethod`, plus the blocks under the bot at spawn and along the walk, each with the Forge registry name next to prismarine's name.
- **9:** `summary.json` gets a `scope` field saying the spike does not test reconnects or exit codes. G1 evidence will make no such claim.
- **11:** capture limits per direction and channel (default 2000; the handshake, REGISTER and FORGE are never capped), a 1 MiB per-payload byte cap, a 256 MiB file cap with one `capture_full` event, and C2S packets capped per name. The closing summary records per-channel counts and drops.
- **Tests:** `npm test` passes 175/175, all offline. The chunk patch: reversing it fails all 9 chunk tests. `npm run lint` gives 259, the baseline; `packages/forge-bridge` has 0 errors.
- **FRCFLD login (done by the human, verified by the lead).** I ran the permitted check: `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa node packages/forge-bridge/tools/msa-login.mjs FRCFLD --check`, with `DEBUG` unset. It printed `Signed in. Minecraft profile: FRCFLD`. Nothing in the folder was read, printed or copied by me.

## Done: G1 gate driver for Batch C

- `packages/forge-bridge/tools/g1-driver.mjs` implements `test/runner/DRIVER.md`. It uses Mindcraft's real `initBot` with forge-bridge `on`, and harness-ops' `attachScenario` for hello, echo, walk and SIGTERM.
- It exits 3 without `MINDCRAFT_PROFILES_FOLDER` or host. It never starts a device-code login: `initBot` gained an optional `{ onMsaCode }`, a 5-line diff inside `initBot`.
- Kicks exit 3 when the runner's `FATAL_KICKS` or our `classifyKick` says fatal.
- It records the handshake result, registry sizes, `walkMethod` and block registry names as `DRIVER` lines.
- **Test:** `test/g1-driver.test.js` runs the driver as a subprocess against the fake Forge server, with the runner's allowlisted env.
- The shared fake world moved to `test/fake-world.js`.
- `npm test` passes 178/178; lint 259.

## Done: initBot auth guard and PR #15 nits (branch `agent/net-forge/initbot-auth-guard`, from develop 74b23ed)

- `initBot` throws when `auth` is `microsoft` and `MINDCRAFT_PROFILES_FOLDER` is unset, so it never falls back to nmp's shared default cache. The default `onMsaCode` logs only `device-code login needed, see coord/NEEDS-HUMAN.md` and never the code; a caller can supply its own.
- `msa-login`: the git-tree check also runs on the realpath (junctions, symlinks).
- `g1-driver`: `walkMethod` comes from the scenario (its `method`, else `scenario-protocol walk()`).
- Capture `maxFileBytes` is checked in UTF-8 bytes.
- `npm test` passes 193/193; lint 259.

## Doing

- PR for the initBot auth guard open. Waiting for the preflight (a scheduled sweeper run within 120 min), then Batch A, then Batch B+C on one server.

## Next

1. **G1 batches** (below), after the lead's written approval and a scheduled sweeper run within 120 min (PR #12).
2. Captured fixtures: real handshake, RegistryData, `window_items`/`set_slot`, chunks, `entity_effect`, `jeid`. Then the handshake test against real captured server messages; real Run A bytes become extra golden vectors.
3. Classify every kick seen, confirm chunk bits per block and the REID formats on the wire, and record walk blocks.
4. Brief items 4 (`bot.registry` extension), 6 (EntitySpawn into `bot.entities`) and 8 (`agent_process.js` consumes `createRestartPolicy`).

## G1 batches (approved by the lead 2026-11-01 11:40 UTC in STATUS-rotn-lead.md; nothing run yet)

**Approval:** A as written. B as a spike only, not G1 gate evidence. C is the G1 gate evidence: harness-ops' runner (`test/runner/run.mjs` + `test/scenarios/g1/g1-login-chat-walk.mjs`) with a forge-bridge driver per `test/runner/DRIVER.md`, kept in `packages/forge-bridge/`. B and C may share one server run. **Conditions:** one server at a time, in order; `test-server.sh` unchanged with its preflight passing (no `--skip-sweeper-check`); stop and delete past 1.5x the expected time (A: 30 min, B: 53 min); after each batch, confirm `hcloud server list` and `hcloud primary-ip list` are empty and record the real times and cost here; never the live server.

The setup for both batches:

- **Where things run.** Disposable test server only, never the live server. `deploy/test-server.sh` is used unchanged: CPX42 in nbg1 with `--ttl-hours 2`, EUR 0.138/h. Each server is deleted by the `run` EXIT trap, with the watchdog and the sweeper as backup.
- **The bot runs on this PC.** `test-server.sh run` executes the command locally, with `TEST_SERVER_HOST`/`PORT`/`CTL` set. The bot connects from here to the test server's IP.
- **Login cache.** It is set only in this PC's environment: `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa`. Nothing from that folder is uploaded or sent to the test server; the server only checks the session with Mojang as usual.
- **Whitelist.** FRCFLD is in the default whitelist (`ROTN_TEST_WHITELIST` default `FRCFLD JQDAW`), written before the first start.
- **Code.** Batch A runs from this branch: develop 26a0b5e plus the review fixes, with tests passing. Batch B and C run after the driver exists.
- **Before each batch:** `msa-login.mjs FRCFLD --check` must print the profile name. If it asks for a new login, stop and put the request in NEEDS-HUMAN.

1. **Batch A (spec Run A, handshake capture).** Expected about 20 min, so 1 billed hour. Worst case (TTL + 1 h) 3 h, about EUR 0.42, plus Primary IPv4 hours.

   ```bash
   deploy/test-server.sh run --yes --capture --ttl-hours 2 -- bash -c \
     'node packages/forge-bridge/tools/g1-spike.mjs --mode handshake --out captures/raw/g1-runA; s=$?; bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g1-runA/server; exit $s'
   ```

2. **Batch B+C on one server run.** B is the spike only, not gate evidence: 11 minutes, chat both ways, walk, capture. C is the **G1 gate evidence**: harness-ops' runner with `g1-login-chat-walk` and `g1-driver.mjs`, at the gate parameters (no `--param` overrides).
   - Expected time: about 15 min of server boot, about 13 min for B, and about 13 min for C. That is about 45 min, 1 billed hour, about EUR 0.14. Stop and delete past 68 min (1.5x). Worst case 3 h, about EUR 0.42.

   ```bash
   deploy/test-server.sh run --yes --ttl-hours 2 -- bash -c \
     'node packages/forge-bridge/tools/g1-spike.mjs --minutes 11 --out captures/raw/g1-runB; b=$?;
      node test/runner/run.mjs --scenario g1-login-chat-walk --out captures/raw/g1-runC -- node packages/forge-bridge/tools/g1-driver.mjs; c=$?;
      bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g1-runBC/server; echo "B=$b C=$c"; exit $c'
   ```

   The runner gives the driver only its allowlisted environment: `TEST_SERVER_HOST`/`PORT`, `MINDCRAFT_PROFILES_FOLDER` and the `ROTN_*` variables. It never gets `TEST_SERVER_CTL` or cloud credentials.

- **Totals:** expected EUR 0.28 for two server runs (A, then B+C); maximum EUR 0.84.
- **Outputs:** raw files stay in `captures/raw/` (git-ignored). Only sanitized excerpts go to `packages/forge-bridge/test/fixtures/` and `test/evidence/g1/`.
- **G1 evidence will claim only:** login, handshake, spawn, chat both ways, walking (with `walkMethod` and block names) and 10+ minutes connected. No reconnect or exit-code claims.

## Blocked

- Batch A: approved; waiting only for the preflight (a scheduled sweeper run within 120 min; PR #12 in review).
- Batch B+C: approved; the driver is ready (below). Runs after Batch A, with the same preflight condition.

## Requests to other agents or the lead

1. ~~Human: FRCFLD device-code login.~~ Done; verified by the lead and by `--check`.
2. **Lead (`settings.js` / profile, your files):** for RotN runs, set `"minecraft_version": "1.12.2"` and `"auth": "microsoft"`. Until then, `g1-spike.mjs` sets these itself.
3. **Lead (`package.json`, optional; review item 12):** make the transitive dependencies forge-bridge imports direct ones: `minecraft-protocol`, `protodef`, `prismarine-nbt`, `lodash.merge`, `prismarine-auth`. The lockfile pins them today.
4. **Lead (`docs/research/fml-spec.md`, optional):** the Forge 14.23.5.2860 layouts confirmed by `javap` are listed at the top of `packages/forge-bridge/test/golden.test.js`, if you want them in the spec.
5. **harness-ops (optional):** have `walk()` in `test/runner/drivers/scenario-protocol.mjs` return a `method` field (for example `forward+jump+turn`). g1-driver then reports it as `walkMethod`.
6. **harness-ops / lead (`TRY_IT.md`, `main.js` docs):** with `auth: "microsoft"` (develop's default), `initBot` now refuses to start without `MINDCRAFT_PROFILES_FOLDER`. Please mention this where the run steps are.
7. **skills-rotn (later, through the lead):** `bot.forge.bridge.lastKick` carries `{category, fatal, exitCode, retryCap?}` for the `agent.js` kick handler.

## Open PRs

- (#15 merged as 74b23ed.) New PR: initBot auth guard + PR #15 nits, on `agent/net-forge/initbot-auth-guard`. `npm test` 193/193; lint 259.
