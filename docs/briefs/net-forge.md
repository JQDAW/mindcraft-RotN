# Brief: net-forge

You make a mineflayer bot join a Forge 1.12.2 server running RotN 3.3.4 (ADR 0005) in online mode, and see the modded world at the protocol level. This is the highest-risk work in the project, and it gates everything else (G1).

## You own

- `packages/forge-bridge/` (new package, plain ES modules, no build step)
- Entries in `patches/` that touch mineflayer, minecraft-protocol or protodef
- The `initBot` function in `src/utils/mcdata.js` (how the bot is created and the bridge is attached)

Do not edit anything else. Put requests for other files in `coord/STATUS-net-forge.md`.

## Inputs

- `docs/research/fml-spec.md` (from forge-protocol-analyst) and `docs/research/seam-map.md`
- A test server from harness-ops (`deploy/test-server.sh`). Never connect to the live server.

## Deliverables, in order

1. **Spike (G1):** the bot completes the `FML|HS` handshake, logs in online with the bot account, stays connected 10 minutes, sends and receives chat, and walks a few blocks. Log every plugin-channel message to a capture file.
2. **Captures as fixtures:** store sanitized handshake and registry captures under `packages/forge-bridge/test/fixtures/`. They must contain no tokens or session IDs.
3. **Registry sync:** parse RegistryData and expose the name <-> numeric ID maps for blocks, items and entities. Extend mineflayer's registry at login so `bot.blockAt()` and inventory items carry modded names. Coordinate the data shape with rotn-data (it adds properties such as hardness).
4. **Mod entities:** decode FML entity spawn messages so mod mobs appear in `bot.entities` with their registry names.
5. **Channel stubs:** answer only the mod channels that are proven to kick silent clients.
6. **Resilience:** reconnect with backoff after kicks and server restarts.

## Acceptance tests

- Unit tests replay the fixtures and check the parsed mod list, registry sizes and a sample of known IDs.
- A harness scenario on the test server covers G1 (login, 10 minutes, chat, walk) and G2's protocol half (modded block and mob names visible).
- `npm test` passes; no new ESLint errors.

## If the spike fails

Write your findings to `coord/STATUS-net-forge.md` and tell the lead. Do not sink more than about two working sessions into one dead end without escalating. The lead decides on the fallbacks in `docs/PLAN.md`.

## Phase 0 research revisions (rotn-lead, 2026-11-01)

Read `docs/research/fml-spec.md` (especially **section R**), `docs/research/seam-map.md` sections A-C, and `docs/adr/0003-forge-bridge-approach.md` before starting. Where this section and the text above disagree, this section wins.

**Approach (ADR 0003).** Write `packages/forge-bridge` fresh as a node-minecraft-protocol client plugin. Do not depend on `minecraft-protocol-forge`: npm has only a 2016 build, and its master breaks on direct connections. Copying its BSD-3 ProtoDef types with attribution is fine. Do not translate code from MCC (CDDL), Velocity (GPL) or BungeeCord; use them as behavioural references only.

**Ownership additions.** You also own:

- `src/process/agent_process.js`, for restart and backoff.
- patch-package entries for prismarine-chunk, minecraft-data's 1.12.2 protocol, mineflayer-pathfinder, mineflayer-pvp and prismarine-viewer. The existing patch files name pinned versions (`mineflayer+4.33.0`, `minecraft-data+3.97.0`). Once the lead commits the lockfile, rebase any patch whose version no longer matches.

**RotN 3.3.4 ships RoughlyEnoughIDs (REID) 2.2.2**, which changes the wire format:

- Slot item ids are VarInts, in both directions. Fix with an nmp `slot` override.
- The full-chunk biome array is a VarInt array **inside the chunk-data buffer**. Fix it in the prismarine-chunk patch, not with a protocol override.
- `entity_effect`: expected layout is the vanilla byte kept, with a VarInt effect id appended after the vanilla fields (2.2.2 TAIL injection); a capture fixture must confirm it. `remove_entity_effect` carries an **i32**.
- REID's own `jeid` channel sends biome-change messages. Decode and log them; no reply is needed.

`fml-spec.md` section R lists these against the 2.2.2 jar. Detect REID from the server's ModList entry **`jeid`** (version 2.2.2); the mod id is not `roughlyenoughids`. Stock mineflayer will misparse inventories, and at least the biome part of chunks, even after a perfect handshake.

**Revised deliverables, in order:**

1. **Spike (G1).**
   - Handshake exactly per spec section 1.3, with a full capture: Run A (debug flag, compression off) and Run B (bot side), as in spec section 6.
   - Confirm the Forge build, the REID version and the chunk bits per block.
   - Get REID-correct chunk and slot parsing working.
   - Then: online login, stay 10 minutes, chat, walk.
   - Classify every kick (spec section 4).
2. **`initBot` fixes**, all small and in your function:
   - Pin the version for real. `mc_version` is read at module load, before settings exist, so a configured version never reaches `createBot` (seam-map section A). Read `settings.minecraft_version` inside `initBot`; do not edit module-level line 11, so the change stays inside your function.
   - The position-packet throttle (`mcdata.js` L70-98, inside `initBot`) drops newer packets while one is pending. Fix it so the newest position is sent.
   - Add `profilesFolder` from `MINDCRAFT_PROFILES_FOLDER`, so each bot has its own token cache (`docs/research/ops.md` section 1).
   - Stop silently swallowing `PartialReadError`: count and log it, and keep the capture when it happens. Also make the protodef "partial packet" log line (silenced by `patches/protodef+1.19.0.patch`) switchable by an env var.
3. **Fixtures.** Handshake, RegistryData bodies, `window_items`/`set_slot`, chunk samples and FML entity spawns. Sanitize them: no tokens, username or UUID.
4. **Registry sync and the shared-registry contract (ADR 0003, decision item 4).**
   - Extend `bot.registry` after the last RegistryData, so `bot.blockAt()` and inventory items carry modded names.
   - Agree the data shape with rotn-data, which switches the `mcdata.js` helpers to read it.
5. **Dependency patches.**
   - prismarine-chunk: use the packet's `bitsPerBlock`.
   - minecraft-data 1.12.2: entity-metadata type is a VarInt.
   - Make the mineflayer `place_block` 500 ms wait configurable (seam-map section C).
   - mineflayer-pathfinder: guard `_properties` and fix `setBlockStateId(pos, 1)` for 1.12.
6. **Mod entities.**
   - Decode FML EntitySpawn into `bot.entities`.
   - Map names through rotn-data's mod-local entity table (ADR 0004).
   - OpenGui: log it for now. A synthetic window is only needed if a ready-to-try item requires a mod GUI.
7. **Channel stubs**, only where a kick is proven.
8. **Resilience.**
   - Reconnect with backoff after kicks and server restarts.
   - Split fatal kicks (mod rejection, ban) from transient ones, using the exit-code contract in ADR 0003 decision 5: `0` clean stop, `1` transient (backoff), `3` fatal (no restart). This includes the main-process behaviour on agent exit `0` and `3` described there.
   - Kick handling inside `src/agent/agent.js` belongs to skills-rotn; coordinate through your status file.
   - `spawn_timeout` lives in `settings.js`, which the lead owns. Request a change if the Forge login takes longer than 30 s.

**Online login.** The spike needs the bot's Microsoft account signed in on the machine where you run it. The human does this once on this PC, using a device code; the token cache lives in a `MINDCRAFT_PROFILES_FOLDER` outside the repo (NEEDS-HUMAN). Never read or print the cache.

**Added acceptance tests:**

- A unit test parses a REID `window_items` fixture and a chunk fixture.
- A unit test asserts the exact outgoing handshake sequence against the captured server messages.
