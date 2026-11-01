# forge-bridge

A Forge 1.12.2 (FML protocol 2) client plugin for node-minecraft-protocol (nmp), aware of RoughlyEnoughIDs (REID). It lets Mindcraft's mineflayer bot join a Rebirth of the Night 3.3.4 server.

- Decision: `docs/adr/0003-forge-bridge-approach.md`. Spec: `docs/research/fml-spec.md` (sections 1-4, 6 and R).
- Owner: net-forge. Plain ES modules, no build step, no dependencies beyond the root `node_modules`.
- Written fresh from the Forge 1.12.x source behaviour described in the spec. No code was copied or translated from minecraft-protocol-forge, MCC, Velocity or BungeeCord (see `THIRD_PARTY.md`).

## How Mindcraft uses it

`initBot` in `src/utils/mcdata.js` passes `createForgeConnect(...)` as nmp's `connect` option. nmp calls it after authentication. It then:

1. Pings the server. If the status response has `modinfo.type == "FML"`, it uses that mod list. If the ping fails, it falls back to `FORGE_MODLIST_FILE`.
2. Calls `attachForgeBridge(client, { modList })`. This sets `client.tagHost = '\0FML\0'` (never `fakeHost`). It adds the protocol overrides to `client.customPackets`. The REID overrides are included only if the mod list contains `jeid`.
3. Opens the socket.

After Login Success, the bridge runs the client handshake. Forge's client states and the messages sent:

| Client state | Trigger | Bot sends |
| --- | --- | --- |
| HELLO | ServerHello | REGISTER, ClientHello, then the server's own ModList |
| WAITINGSERVERDATA | server ModList | ack 2 |
| WAITINGSERVERCOMPLETE | each RegistryData, until the last (`hasMore = false`) | ack 3 |
| PENDINGCOMPLETE | server ack | ack 4 |
| COMPLETE | server ack | ack 5 |

Each ack value is the ordinal of the client's own state.

The bridge also decodes the other Forge and REID channels:

- `FML|MP` multipart reassembly.
- `FML`: EntitySpawn and OpenGui.
- `FORGE`: DimensionRegister and FluidIdMap.
- `jeid`: REID biome messages.

`bot.forge.bridge` exposes:

- `registries`: a RegistrySnapshot with name/id maps for every registry.
- `serverMods`, `serverChannels`, `overrideDimension`.
- `stats` and `lastKick`.
- Events: `registries`, `handshakeComplete`, `entitySpawn`, `openGui`, `jeid`, `kick` and `parseError`.

### Environment switches

| Variable | Meaning |
| --- | --- |
| `FORGE_BRIDGE` | `auto` (default): attach when the ping reports FML. `on`: require it. `off`: never. |
| `FORGE_CAPTURE` | `1`: write `captures/raw/<bot>-<time>.jsonl` (git-ignored). Any other value is used as the file path. |
| `FORGE_MODLIST_FILE` | Ping JSON to use when the live ping has no mod list. The pinned one is `test/fixtures/rotn-3.3.4/ping.json`. |
| `MINDCRAFT_PROFILES_FOLDER` | Per-bot Microsoft token cache, outside the repo. Becomes nmp's `profilesFolder`. |
| `PROTODEF_LOG_PARTIAL=1` | Turns protodef's "partial packet" console line back on (`patches/protodef+1.19.0.patch`). |

## REID 2.2.2 wire changes (confirmed from the jar)

The lead's section R lists these. net-forge confirmed each one with `javap -c -p` on the class files inside `mods/RoughlyEnoughIDs-2.2.2.jar`, from the pinned 3.3.4 zip. The jar was only extracted to a scratch folder outside the repo; nothing from it was run.

| Class | Change | Where it is handled |
| --- | --- | --- |
| `MixinPacketBuffer`, `MixinPacketUtil` | `writeItemStack`: the `writeShort` calls with ordinal 0 (the `-1` empty marker) and ordinal 1 (the item id) become `writeVarInt`. `readItemStack` reads the id with `readVarInt`. Count (byte), damage (short) and NBT are unchanged. | `slot` override (`src/reid.js`) |
| `MixinSPacketEntityEffect` | `@Inject(TAIL)` on read and write adds `readVarInt`/`writeVarInt` after the vanilla fields. The vanilla effect byte is still sent. | `entity_effect` override with a `reidEffectId` tail. The bridge copies the tail into `effectId`. |
| `MixinSPacketRemoveEntityEffect` | `@Redirect`: `readUnsignedByte` becomes a no-op returning 0, and the id comes from `readInt`. Writes go through `writeInt`. | `remove_entity_effect.effectId` is `i32` |
| `MixinSPacketChunkData` | `isFullChunk` (ordinal 1) is redirected to false in `extractChunkData` and `calculateChunkSize`. A `writeVarIntArray(intBiomeArray)` is injected in its place. | `patches/prismarine-chunk+1.41.0.patch` |
| `network.MessageManager` | `newSimpleChannel("jeid")`. Discriminators: 0 BiomeChunkChange (VarInt chunkX, VarInt chunkZ, VarInt array), 1 BiomePositionChange (VarInt x, z, biomeId), 2 BiomeAreaChange (VarInt x, z, radius, biomeId). All are client-side handlers; no reply. | `decodeJeid` (`src/channels.js`) |

These still need a real capture to confirm them on the wire (G1 Run B).

## Other protocol changes

- **Entity metadata type ids** are VarInts. minecraft-data 1.12.2 says `i8`, but Forge mod serializers start at 256. This override applies on every Forge connection, as a customPackets override rather than a minecraft-data patch. An unknown serializer id throws instead of misreading. The FML EntitySpawn decoder then keeps the rest of the message raw.
- **Parse errors.** Every deserializer nmp creates is wrapped. A PartialReadError, or a packet with unread trailing bytes, is counted in `bridge.stats` and logged, and the raw bytes go to the capture. Normally protodef drops these packets silently.
- **Kick classification** (`src/kicks.js`) maps reasons to the ADR 0003 exit codes: 0 clean, 1 transient, 3 fatal. Fatal kicks: mod rejection, vanilla client rejected, not whitelisted, banned, auth failure, outdated client.

## Capture format

Captures are JSONL, one object per line, written synchronously. `kind` is one of:

- `payload`: a plugin-channel message, in either direction, with base64 data and a decoded summary.
- `packet`: selected play packets, capped per name: `map_chunk`, `window_items`, `set_slot`, `entity_effect`, `remove_entity_effect`, `login`, spawns and `entity_metadata`.
- `event`: handshake states, registries, kicks, end.
- `parse_error` and `partial_packet`.

Redaction happens at write time. The bot's username and UUID become same-length placeholders, in raw, dashed and hex forms. Login-state packets (encryption, session) are never recorded. Raw captures stay in `captures/raw/`, which is git-ignored. Only sanitized excerpts become fixtures.

`tools/capture-summary.mjs <file>` prints counts per channel, kicks, parse errors, chunk bits per block and biome formats.

## Tools

- `tools/msa-login.mjs <Bot>`: the human's one-time device-code login. It needs `MINDCRAFT_PROFILES_FOLDER` outside the repo. It prints only the Minecraft profile name, never a token.
- `tools/g1-spike.mjs`: the G1 spike. It uses Mindcraft's real `initBot` against a disposable test server, normally inside `deploy/test-server.sh run ... --`. It logs in, stays `--minutes`, chats both ways (the `say` check uses the server console), walks, and writes `capture.jsonl`, `registries.json` and `summary.json`.
  - `--mode handshake` is Run A. It is for a server started with `--capture`, which closes the connection right after the handshake.

## Tests

`npm test` covers `packages/forge-bridge/test/*.test.js`. Everything is offline.

- Codecs: VarInt, strings, every FML|HS message, and the pinned 346-entry ModList.
- The exact outgoing handshake sequence, using synthetic server messages built from the pinned mod list. A test against real captured server messages follows after Run B.
- FML, FORGE, `jeid` and FML|MP decoders.
- REID `window_items`, `set_slot`, `window_click`, `entity_effect` and `remove_entity_effect`, through nmp's real compiled 1.12.2 protocol.
- The prismarine-chunk patch: a 16-bit global palette and VarInt biomes.
- Capture redaction, kick classification, the movement throttle, and the connect and env logic.
- `e2e-initbot.test.js`: Mindcraft's real `initBot` against an in-process fake Forge server on 127.0.0.1. The run covers the status ping, tagHost, the handshake, Join Game, a REID chunk, inventory and effects, chat both ways, walking, and the capture.

## Known limits (next brief items)

- **nmp protocol cache.** nmp caches compiled protocols by state, direction and version only. The first play-state client for 1.12.2 in a process fixes the overrides for that process. That is fine with one bot per process, which is how Mindcraft runs.
- **Registry extension.** `bot.registry` is not yet extended (brief item 4). Modded blocks get prismarine-block's fallback: name `''`, bounding box `empty`. Modded items get no name.
- **FML EntitySpawn** is decoded and emitted, but not yet injected into `bot.entities` (brief item 6).
- **Book channels.** mineflayer's `MC|BEdit`/`MC|BSign` plugin channels still use the vanilla `slot` type. That only matters for writing books.
