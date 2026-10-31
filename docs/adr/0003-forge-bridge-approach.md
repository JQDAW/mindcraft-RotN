# ADR 0003: forge-bridge is a fresh nmp client plugin, REID-aware, with registries shared through `bot.registry`

- Status: accepted
- Date: 2026-11-01
- Author: rotn-lead

## Context

- `docs/research/fml-spec.md` (forge-protocol-analyst, plus lead addendum R) covers the following.
  - The FML protocol 2 handshake, registry sync, mod entity spawns and channel behaviour, all from the Forge 1.12.x source.
  - `minecraft-protocol-forge`: npm has only a 2016 build (1.0.0). Its GitHub master expects a HandshakeReset first, so it breaks on a direct connection. It parses no registries, no `FML|MP` and no entity spawns.
  - Minecraft Console Client (CDDL), Velocity (GPL) and BungeeCord work, but their licences do not fit this MIT repo.
- **RotN 3.3.2 ships RoughlyEnoughIDs (REID).** The lead verified this in the pack repo at the 3.3.2 commit. REID changes the wire format:
  - Item ids in every slot are VarInts, in both directions.
  - Full-chunk biomes are a VarInt array.
  - Potion effect ids are VarInts.
  - Block state ids may exceed vanilla ranges.

  Stock mineflayer cannot parse inventories or chunks on this server, even after a successful handshake.
- `docs/research/seam-map.md` section A says Mindcraft's `mcdata.js` helpers read a private `minecraftData(bot.version)` instance, not `bot.registry`. Modded IDs injected into `bot.registry` would therefore be invisible to them.

## Options

1. **Fork `minecraft-protocol-forge`.** Saves about 300 lines, most of which need rewriting anyway. It has no REID support, no registry parsing and no entity spawns.
2. **Port MCC or Velocity.** Licence contamination (CDDL per-file copyleft, GPL), and the result would still need REID work.
3. **Write `packages/forge-bridge` fresh as a node-minecraft-protocol client plugin**, using the Forge source as the authority. The BSD-3 ProtoDef type definitions from `minecraft-protocol-forge` may be copied with attribution.
4. **Fallbacks in PLAN** (a headless real client, or a server-side puppet mod). Not yet justified: nothing found so far is impossible on the mineflayer route.

## Decision

Option 3, with these specifics.

1. **Plugin shape.** `packages/forge-bridge` exports a function that takes the nmp client (`bot._client`) before connect. It works as follows.
   - It sets `tagHost = '\0FML\0'`, never `fakeHost`.
   - It implements the Forge client handshake state machine exactly (spec section 1.3). It sends its ModList as the server's ModList, taken from a status ping or a pinned fixture.
   - It reassembles `FML|MP` multipart payloads and decodes the `FML` (EntitySpawn, OpenGui) and `FORGE` (DimensionRegister, FluidIdMap) channels.
   - It emits typed events.
2. **REID support** goes in as protocol type overrides, gated on REID being in the server's ModList. The overrides are slot item id as VarInt, `map_chunk` biomes as a VarInt array, and entity effect ids as VarInt. They are a protocol customization owned by forge-bridge, or a patch-package entry. Upstream files are never edited in place.
3. **Dependency patches** (net-forge owns them):
   - prismarine-chunk 1.9 uses the packet's `bitsPerBlock` and a registry-derived max width.
   - minecraft-data 1.12.2 entity-metadata type becomes VarInt.
   - A mineflayer hook injects FML-spawned entities into `bot.entities` and emits `entitySpawn`.
4. **Shared registry contract.**
   - After the last RegistryData, forge-bridge extends `bot.registry`: blocks, items, entities, biomes, name and id maps, and block states `id << 4 | meta`.
   - `mcdata.js` helpers must read the bot's registry after login, not a private `minecraftData()` copy. rotn-data owns that change. The `initBot` wiring that hands the registry over belongs to net-forge.
   - Properties such as hardness, harvest level and the mod-local entity table come from rotn-data's dump (ADR 0004). forge-bridge provides the names and numbers.
5. **Licensing.** No code is translated from MCC, Velocity or BungeeCord; they serve as behavioural references only. Copied BSD-3 code keeps its notice in `packages/forge-bridge/THIRD_PARTY.md`.
6. **Spike order** (G1):
   1. Handshake, with the full capture.
   2. Confirm the REID version and the bits per block.
   3. Get chunk parsing and inventory parsing to work. This is the minimum needed to walk and chat.
   4. Stay connected 10 minutes, with kick classification (spec section 4).

## Consequences

- The net-forge brief now lists REID overrides, the dependency patches, the shared-registry contract and the restart/backoff work (`src/process/agent_process.js`) as explicit deliverables. G1 explicitly depends on REID-correct chunk and slot parsing.
- The rotn-data brief gains the `mcdata.js` "read from `bot.registry`" change and the mod-local entity ID table.
- Risk that stays open: mod channels that need client replies. These can only be found by capture (spec section 4). If unexplained kicks persist after two working sessions, net-forge escalates and the lead considers a golden capture from a real client (needs the human), then the PLAN fallbacks.
- We maintain our own Forge protocol code. It is small (the 1.12 networking is frozen), and fixtures plus unit tests keep it honest.
