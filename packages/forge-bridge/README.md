# forge-bridge

A Forge 1.12.2 (FML protocol 2) client plugin for node-minecraft-protocol (nmp), aware of RoughlyEnoughIDs (REID). It lets Mindcraft's mineflayer bot join a Rebirth of the Night 3.3.4 server.

- Decision: `docs/adr/0003-forge-bridge-approach.md`. Spec: `docs/research/fml-spec.md` (sections 1-4, 6 and R).
- Owner: net-forge. Plain ES modules, no build step, no dependencies beyond the root `node_modules`.
- Written fresh from the Forge 1.12.x source behaviour described in the spec. No code was copied or translated from minecraft-protocol-forge, MCC, Velocity or BungeeCord (see `THIRD_PARTY.md`).

## How Mindcraft uses it

With `auth: "microsoft"`, `initBot` refuses to start (it throws before any bot or socket exists) in three cases (`src/auth-guard.js`):

- `MINDCRAFT_PROFILES_FOLDER` is unset. nmp would otherwise use its shared default cache.
- The folder is inside a git work tree, as given or at its real path. This check is read-only.
- `DEBUG` could enable prismarine-auth's output. That output prints access and refresh tokens, and `main.js` cannot clear `DEBUG` before its imports load. The rule is deliberately strict, so a future sub-namespace cannot print tokens either:
  - It refuses if any enabled pattern starts with `prismarine-auth` (`prismarine-auth`, `prismarine-auth:*`, `prismarine-auth:live`) or is a glob that could reach such a name (`*`, `prismarine*`, `*auth`).
  - Only a plain prefix skip turns it off: `-prismarine-auth*`, `-prismarine*` or `-*`. An exact skip such as `*,-prismarine-auth` is still refused, because it leaves sub-namespaces on.
  - The same rule is applied to the live `debug` instance that prismarine-auth resolves.
  - To fix a refusal: unset `DEBUG`, narrow it (for example `DEBUG=minecraft-protocol`), or add `-prismarine-auth*`.

It never shows a device code. The default `onMsaCode` (`quietMsaCodeHandler`) logs only `device-code login needed, see coord/NEEDS-HUMAN.md`, never the code, message or URL. prismarine-auth then **keeps polling until the code expires (about 15 min) and the login fails with an error**. The fix is the human's login (`tools/msa-login.mjs`). A caller can pass its own handler instead (`initBot(name, { onMsaCode })`): g1-driver exits 3 at once.

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
- **Kick classification** (`src/kicks.js`) maps reasons to the ADR 0003 exit codes: 0 clean, 1 transient, 3 fatal.
  - Fatal kicks: mod rejection, vanilla client rejected, not whitelisted, banned, no Minecraft licence, outdated client. The ban rule matches only the vanilla ban screens (`You are banned`, `Your IP address is banned`, `multiplayer.disconnect.banned*`), not any message containing "banned".
  - Auth kicks (`Failed to verify username`, `Invalid session`) are transient with `retryCap: 3`: the session server has hiccups, but three in a row means the login needs a human.
  - `createRestartPolicy()` turns a classification into `{restart, delayMs, exitCode}`: 10 s doubling to 5 min, reset after 10 min connected, and a capped category becomes fatal at its cap. **Nothing calls it yet.** `src/process/agent_process.js` is unchanged until brief item 8, so no run so far shows reconnect or exit-code behaviour.

## Capture format

Captures are JSONL, one object per line, written synchronously. `kind` is one of:

- `payload`: a plugin-channel message, in either direction, with base64 data and a decoded summary.
- `packet`: selected play packets, capped per name: `map_chunk`, `window_items`, `set_slot`, `entity_effect`, `remove_entity_effect`, `login`, spawns and `entity_metadata`. Outgoing `window_click`, `set_creative_slot` and `held_item_slot` are capped as `C2S:<name>`.
- `event`: handshake states, registries, kicks, end.
- `parse_error` and `partial_packet`.

Limits, so a soak run cannot fill the disk:

- Payloads are capped per direction and channel: 2000 records by default (`defaultChannelLimit`), overridable per `"<dir> <channel>"` or channel name (`channelLimits`). `FML|HS`, `REGISTER`, `UNREGISTER` and `FORGE` are never capped. The first drop on a channel writes one `channel_limit` event.
- Payloads over 1 MiB (`maxPayloadBytes`) are recorded without their bytes (`bytesOmitted: true`).
- Past 256 MiB (`maxFileBytes`) the writer records one `capture_full` event and drops the rest.
- The closing `capture_closed` event is always written. It has per-channel and per-packet counts and the dropped totals.

Redaction happens at write time. The bot's username and UUID become same-length placeholders, in raw, dashed and hex forms. Login-state packets (encryption, session) are never recorded. Raw captures stay in `captures/raw/`, which is git-ignored. Only sanitized excerpts become fixtures.

`tools/capture-summary.mjs <file>` prints counts per channel, kicks, parse errors, chunk bits per block and biome formats.

## Tools

- `tools/msa-login.mjs <Bot>`: the human's one-time device-code login. It prints only the Minecraft profile name, never a token.
  - `MINDCRAFT_PROFILES_FOLDER` must be outside every git work tree: it walks up looking for `.git` (a folder, or a file in a worktree), from both the given path and its real path, so a junction or symlink into a repo is refused too. It creates the folder with mode 0700, and chmods it on POSIX (`src/secret-folder.js`).
  - It clears `DEBUG` before prismarine-auth loads, so the `debug` package cannot log HTTP details.
- `tools/g1-spike.mjs`: the G1 spike. It uses Mindcraft's real `initBot` against a disposable test server, normally inside `deploy/test-server.sh run ... --`. It logs in, stays `--minutes`, chats both ways (the `say` check uses the server console), walks, and writes `capture.jsonl`, `registries.json` and `summary.json`.
  - `--mode handshake` is Run A. It is for a server started with `--capture`, which closes the connection right after the handshake.
  - `summary.json` records `walkMethod` (`pathfinder` or the `forward-control` fallback) and the blocks under the bot at spawn and along the walk, with the Forge registry name next to prismarine's (empty for modded blocks until brief item 4). Its `scope` field says that the spike does not test reconnects or exit codes.

- `tools/g1-driver.mjs`: the G1 **gate** driver for harness-ops' runner (`test/runner/DRIVER.md`). It is Mindcraft's real `initBot` with forge-bridge on, plus the runner's scenario protocol (`attachScenario`: hello once, echo the whispered token, walk on request, stay until SIGTERM). The runner decides pass or fail from the server log.
  - It needs `MINDCRAFT_PROFILES_FOLDER` and never starts a device-code login: `initBot(name, { onMsaCode })` makes a stale cache exit 3.
  - Kicks: exit 3 when the runner's `FATAL_KICKS` or forge-bridge's `classifyKick` says fatal, otherwise 1. SIGTERM exits 0.
  - Switches: `ROTN_DRIVER_AUTH` (`offline` for loopback tests only), `ROTN_DRIVER_FORGE_BRIDGE` (default `on`), `ROTN_DRIVER_CAPTURE` (default `1`, `captures/raw/`), `ROTN_DRIVER_MODLIST_FILE`.
  - Its `DRIVER {json}` lines add the handshake result, registry sizes, `walkMethod` and the block under the bot with its Forge registry name. `walkMethod` is the scenario's: its `method` field if `walk()` reports one, otherwise `scenario-protocol walk()`.

## Tests

`npm test` covers `packages/forge-bridge/test/*.test.js`. Everything is offline.

- Codecs: VarInt, strings, every FML|HS message, and the pinned 346-entry ModList.
- `golden.test.js`: hand-written hex vectors for ModList, RegistryData, FML EntitySpawn and FML|MP. Each is built from Forge 14.23.5.2860's own serializers (`javap` on the pinned server pack's Forge jar), not from this package's encoders. Our decoders must read each vector, and our encoders must reproduce it byte for byte.
- The exact outgoing handshake sequence, using synthetic server messages built from the pinned mod list. A test against real captured server messages follows after Run B.
- FML, FORGE, `jeid` and FML|MP decoders.
- REID `window_items`, `set_slot`, `window_click`, `entity_effect` and `remove_entity_effect`, through nmp's real compiled 1.12.2 protocol.
- The prismarine-chunk patch: a 16-bit global palette, VarInt biomes, local writes of 20-bit state ids, and `dump()` round trips with VarInt biomes. Reversing the patch fails all 9 chunk tests.
- `auth-guard.test.js` and `initbot-auth.test.js`: the default `onMsaCode` never prints a fake code or message; the `DEBUG` matching rules; each `initBot` refusal; and `auth: "offline"` without a folder still starts.
- Capture redaction and limits, kick classification and the restart policy, the movement throttle, the token-folder checks, and the connect and env logic.
- `g1-driver.test.js`: the driver as a subprocess against the fake Forge server, with the runner's allowlisted environment: hello exactly once, echo, a 3-block walk, a clean stop, a redacted capture, and exit 3 without a token-cache folder or host.
- `e2e-initbot.test.js`: Mindcraft's real `initBot` against an in-process fake Forge server on 127.0.0.1. The run covers the status ping, tagHost, the handshake, Join Game, a REID chunk, inventory and effects, chat both ways, walking, and the capture.

## Known limits (next brief items)

- **nmp protocol cache and shared protocol object.** One bot per process, which is how Mindcraft runs, is fine. Two effects follow from nmp 1.x internals:
  - nmp caches compiled protocols by state, direction and version only, not by `customPackets`. The first play-state client for 1.12.2 in a process fixes the overrides for that process.
  - nmp's `createProtocol` calls lodash `merge(mcData.protocol, customPackets['1.12'])`. That **mutates the shared `minecraft-data` 1.12.2 protocol object in place**, and every `require('minecraft-data')('1.12.2')` in the process returns that same object. After the first Forge connection, `bot.registry.protocol` and any later vanilla or non-REID 1.12.2 client in the same process see the Forge and REID types. A process that needs both must run them in separate processes.
- **Registry extension.** `bot.registry` is not yet extended (brief item 4). Modded blocks get prismarine-block's fallback: name `''`, bounding box `empty`. Modded items get no name.
- **FML EntitySpawn** is decoded and emitted, but not yet injected into `bot.entities` (brief item 6).
- **Chunk bit widths.** Handled by `patches/prismarine-chunk+1.41.0.patch`:
  - Reads: a global-palette section is read at the width the packet states.
  - Writes: mineflayer applies `block_change` and `multi_block_change` locally. A section widens its data array whenever a state id needs more bits, and a section that leaves its palette uses at least the width of its widest id, so wide ids are never cut to 13 bits.
  - `new Chunk({ maxBitsPerBlock })` can seed a wider starting width. mineflayer does not pass it yet, which is fine because sections widen on write.
- **`ChunkColumn.dump()`** writes biomes back as REID VarInts when they were read that way, or when an id is over 255. Readers of dumps, such as prismarine-viewer or a world saver, therefore get the real biome ids. The viewer stays off anyway (`render_bot_view: false` in `settings.js`) until it is tested against RotN chunks.
- **Book channels.** mineflayer's `MC|BEdit`/`MC|BSign` plugin channels still use the vanilla `slot` type. That only matters for writing books.
