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
| `FORGE_PING_TIMEOUT_MS` | Total status-ping budget, retry included (default 15000). Only a fast failure (under 3 s, such as a refused or dropped connect) is retried, once, 1 s later and within what is left. A ping that times out goes straight to the `FORGE_MODLIST_FILE` fallback. Keep it well under Mindcraft's `spawn_timeout` (30 s). g1-driver maps `ROTN_DRIVER_PING_TIMEOUT_MS` to it. |
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

## Registry extension (brief item 4)

After the last RegistryData, `initBot` calls `extendRegistry(bot.registry, snapshot)` (`src/registry-extension.js`). It then sets `bot.forge.registryReport` (`{added, rebound, total}` per kind) and emits `forge_registry`. This is the shared-registry contract of ADR 0003 decision 4:

- **Blocks, items, entities and biomes** get the synced ids.
  - Vanilla entries keep minecraft-data's object and unprefixed name (`stone`). A vanilla block, item or biome the server moved to another id gets a copy at the new id, and its old slot is freed. Every such rebind is in `registryReport.rebinds` and logged as `registry rebind: <kind> <name> <old> -> <new>`; RotN 3.3.4 has none.
  - **Entities are never rebound.** Forge's `minecraft:entities` holds EntityList ids (item 1, xp_orb 2, arrow 10, silverfish 60), but 1.12's `spawn_entity` uses *object* ids (item 2, arrow 60), which is what minecraft-data's `entities` map holds. Rebinding would make dropped items `xp_orb` and arrows `silverfish`. So vanilla entity entries are left alone, modded entities are added only into free ids, and `registry.entitiesByForgeId` maps every synced EntityList id to its entry.
  - Modded entries are named by their **full registry name** (`pyrotech:rock`), with `registryName` and `forge: { modded: true, propertiesKnown }`.
- **Block states** are `id << 4 | meta`, so `blocksByStateId` holds 16 states per block. `bot.blockAt()`, `Block.fromStateId()` and `new Item(id)` therefore return modded names.
- **Defaults without rotn-data's properties:**
  - A block is a solid full cube (`boundingBox: 'block'`, so the bot never falls through a modded floor), diggable, with a conservative hardness of 1.5 (stone's), so `digTime` is finite and above 0, and no drops.
  - An item stacks to 64. An entity is a `mob`. A biome is a neutral overworld biome.
- **Properties.** `extendRegistry(registry, snapshot, { properties: { blocks: { 'pyrotech:rock': {...} } } })` fills in or overrides fields, keyed by full registry name; vanilla names use `minecraft:stone`. rotn-data's dump (ADR 0004) is meant to feed this. Properties cannot rename an entry.
- **Isolation.** Dummied entries are skipped. Only `bot.registry`'s own maps and its `blockCollisionShapes` are replaced; prismarine-registry copies minecraft-data only shallowly, so the maps are copied first. The process-wide `minecraft-data` object stays vanilla.
- **Shapes.** Each modded block is registered in the copied collision-shape table, so a Block class made later keeps its shapes (prismarine-block resets shapes by name).
- **Not covered:** FML EntitySpawn uses the mod-local entity table (`modId` + `modEntityTypeId`), not `minecraft:entities`; that is brief item 6.

## Other protocol changes

- **Triumph advancements (G1 Batch B+C).** Triumph 3.19.2 (mod id `triumph`) writes `ExtendedDisplayInfo` into `play.advancements`. Flag bit 8 is set, and colours, line options, extra connections and a position are appended (`javap`, details in `reid.js` `triumphTypes`). minecraft-data's vanilla layout fails on it, and the parse error ended the packet stream.
  - When the ModList has `triumph`, `advancements` is kept as an **opaque buffer** (`{ data: restBuffer }`); the bot never needs it.
  - `triumphTypes()` is kept as an offline decoder. It reads both real packets to the last byte, but it is not used on the wire.
- **Parse safety net.** A non-partial parse error makes protodef end nmp's packet stream: nothing arrives afterwards, and the keep-alive times out.
  - For a short allowlist of cosmetic clientbound packets (`DROPPABLE_ON_PARSE_ERROR` in `bridge.js`), the error is logged and captured with the full packet bytes, and the packet is dropped (`bridge.stats.droppedPackets`). The stream continues.
  - The allowlist is `advancements`, `select_advancement_tab`, `statistics`, `unlock_recipes`, `craft_recipe_response`, `boss_bar`, `title`, `playerlist_header`, `world_particles`, `sound_effect` and `named_sound_effect`.
  - Everything else (chunks, entities, slots, `keep_alive`, position, ...) still fails loudly, and so does any login-state error.
- Parse-error and partial-packet capture records now keep packets up to 8 MiB in full; the old limit was 64 KB, which lost the first Batch B packet.

- **Entity metadata type ids** are VarInts. minecraft-data 1.12.2 says `i8`, but Forge mod serializers start at 256. This override applies on every Forge connection, as a customPackets override rather than a minecraft-data patch. An unknown serializer id throws instead of misreading. The FML EntitySpawn decoder then keeps the rest of the message raw.
- **Parse errors.** Every deserializer nmp creates is wrapped. A PartialReadError, or a packet with unread trailing bytes, is counted in `bridge.stats` and logged, and the raw bytes go to the capture. Normally protodef drops these packets silently.
- **Kick classification** (`src/kicks.js`) maps reasons to the ADR 0003 exit codes: 0 clean, 1 transient, 3 fatal.
  - Fatal kicks: mod rejection, vanilla client rejected, not whitelisted, banned, no Minecraft licence, outdated client. The ban rule matches only the vanilla ban screens (`You are banned`, `Your IP address is banned`, `multiplayer.disconnect.banned*`), not any message containing "banned".
  - Auth kicks (`Failed to verify username`, `Invalid session`) are transient with `retryCap: 3`: the session server has hiccups, but three in a row means the login needs a human.
  - `createRestartPolicy()` turns a classification into `{restart, delayMs, exitCode}`: 10 s doubling to 5 min, reset after 10 min connected, and a capped category becomes fatal at its cap. Both sides of the contract live in `src/exit-contract.js`, which `src/process/agent_process.js` (Mindcraft's main process) uses.
  - **Agent side.** `initBot` puts `bot.forge.recordExit()` on the bot. `agent.js` calls it on its exit paths, under a lead-approved ownership exception (net-forge PR for the PR #19 follow-ups). It writes `{category, exitCode, retryCap?}` to `MINDCRAFT_EXIT_REASON_FILE` and returns the exit code:
    - A disconnect or kick returns the kick's code (`bridge.lastKick`, or `classifyKick` of the raw reason without a bridge): 3 for fatal, otherwise 1.
    - `cleanKill` while still connected (`!restart`, the stuck mode, mindserver `restart-agent`) returns 1 with `requested_restart`. After a kick, `cleanKill` reports the kick instead, so a kick never skips the backoff.
    - A startup error returns 3 if it carries `exitCode: 3` (the `initBot` setup refusals), otherwise 1, never 0. An invalid bot name exits 3, and so does `init_agent.js` for errors with `exitCode: 3`.
  - **Main side,** `decideAgentExit()`:
    - Exit 1 restarts the agent in-process after the backoff. A `requested_restart` restarts at once and adds nothing to the backoff streak, but a session of 10 minutes or more still resets it. More than 5 of those within 10 min fall back to the backoff, so a loop cannot hammer the session servers with logins.
    - Exit 3 ends the main process with 3, plus a line for the human. In multi-bot mode (one main process, several agents) this also stops the sibling agents, as upstream's "code > 1" did. Run each bot as its own single-bot service if one bot must not stop the others.
    - Exit 2 and 4 stay task codes.
    - Exit 0, and a requested stop (mindserver `stopAgent`/`destroyAgent`, SIGINT, SIGTERM), end the main process with 0 when `MINDCRAFT_SINGLE_BOT_SERVICE=1` (the `mindcraft-rotn@<bot>` unit), so systemd sees the stop. Otherwise the main process stays up. `forceRestart()` is never a stop. A `stop()` while a backoff restart is pending also ends a single-bot service with 0.
    - "Connected" for the 10-minute reset is measured from the agent's spawn, so it includes the login.
  - The reason file sits in a private `mkdtemp` folder per agent (mode 0700 on POSIX), so its path cannot be predicted. The folder is removed when the main process exits.
    - A file over 4 KB is ignored unread.
    - If no folder can be made, the contract falls back to exit codes alone.
  - No real run has shown reconnect or exit-code behaviour yet. The G1 spike and driver run without `agent_process.js`.

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
  - `summary.json` records `walkMethod` (`pathfinder` or the `forward-control` fallback) and the blocks under the bot at spawn and along the walk, with the synced Forge registry name next to `bot.registry`'s, as a cross-check. Its `scope` field says that the spike does not test reconnects or exit codes.

- `tools/g1-driver.mjs`: the G1 **gate** driver for harness-ops' runner (`test/runner/DRIVER.md`). It is Mindcraft's real `initBot` with forge-bridge on, plus the runner's scenario protocol (`attachScenario`: hello once, echo the whispered token, walk on request, stay until SIGTERM). The runner decides pass or fail from the server log.
  - It needs `MINDCRAFT_PROFILES_FOLDER` and never starts a device-code login: `initBot(name, { onMsaCode })` makes a stale cache exit 3.
  - Kicks: exit 3 when the runner's `FATAL_KICKS` or forge-bridge's `classifyKick` says fatal, otherwise 1. SIGTERM exits 0.
  - Switches: `ROTN_DRIVER_AUTH` (`offline` for loopback tests only), `ROTN_DRIVER_FORGE_BRIDGE` (default `on`), `ROTN_DRIVER_CAPTURE` (default `1`, `captures/raw/`), `ROTN_DRIVER_MODLIST_FILE`.
  - Its `DRIVER {json}` lines add the handshake result, registry sizes, `walkMethod` and the block under the bot with its Forge registry name. `walkMethod` is the scenario's: its `method` field if `walk()` reports one, otherwise `scenario-protocol walk()`.

## Tests

`npm test` covers `packages/forge-bridge/test/*.test.js`. Everything is offline.

- Codecs: VarInt, strings, every FML|HS message, and the pinned 346-entry ModList.
- `triumph.test.js` and `parse-safety-net.test.js`: the two real Batch C advancements packets (`test/fixtures/rotn-3.3.4/advancements-triumph.*`).
  - minecraft-data's vanilla layout fails on them, and the Triumph decoder reads them to the last byte.
  - Through nmp's real deserializer stream with the override, they are opaque and the next `keep_alive` arrives.
  - Without the override, the safety net drops them and `keep_alive` still parses; a malformed `set_slot` still ends the stream.
  - `e2e-initbot` and the g1-driver test send both packets during the session.
- `golden.test.js`: hand-written hex vectors for ModList, RegistryData, FML EntitySpawn and FML|MP. Each is built from Forge 14.23.5.2860's own serializers (`javap` on the pinned server pack's Forge jar), not from this package's encoders. Our decoders must read each vector, and our encoders must reproduce it byte for byte.
- The exact outgoing handshake sequence, using synthetic server messages built from the pinned mod list.
- `real-handshake.test.js`: **the real RotN 3.3.4 handshake** from G1 Batch A (`test/fixtures/rotn-3.3.4/handshake-runA.{json,bin.br}`, all 67 plugin-channel payloads, sanitized). The real server messages are replayed into `attachForgeBridge`, and the bridge must answer with exactly the bytes it really sent. It also checks the ServerHello, the 346-mod ModList (same entries as the pinned ping), all 52 RegistryData read to the last byte (`minecraft:blocks` 4896, ids above 4095), and the FORGE FluidIdMap.
- FML, FORGE, `jeid` and FML|MP decoders.
- REID `window_items`, `set_slot`, `window_click`, `entity_effect` and `remove_entity_effect`, through nmp's real compiled 1.12.2 protocol.
- The prismarine-chunk patch: a 16-bit global palette, VarInt biomes, local writes of 20-bit state ids, and `dump()` round trips with VarInt biomes. Reversing the patch fails all 9 chunk tests.
- `agent-process.test.js`: `agent_process.js` with a fake spawn, timers and exit. It covers the ADR 0003 table, the backoff and its reset, the exit-reason file (a fatal kick reported with exit 1, auth capped at 3 and reset after 10 min), requested restarts and their loop guard, single-bot stops and clean exits, `forceRestart`, a stop cancelling a pending restart, a child exiting with a code after `stop()`, the task codes, and the private reason-file folder.
- `registry-extension.test.js`: the extension against the real prismarine-registry, prismarine-block and prismarine-item for 1.12.2. It covers modded names, 16 states and the solid default, items, entities and biomes, an untouched shared minecraft-data, dummied and rebound entries, properties, and Block classes made before and after the extension. `e2e-initbot.test.js` checks the same through `initBot`: `blockAt` gives `pyrotech:rock`, and the inventory gives `pyrotech:crude_axe`.
- `exit-contract.test.js`: the agent side (`recordAgentExit`): kicks with and without a bridge, `cleanKill` before and after a kick, startup errors, and no reason file.
- `auth-guard.test.js` and `initbot-auth.test.js`: the default `onMsaCode` never prints a fake code or message; the `DEBUG` matching rules; each `initBot` refusal; and `auth: "offline"` without a folder still starts.
- Capture redaction and limits, kick classification and the restart policy, the movement throttle, the token-folder checks, and the connect and env logic.
- `g1-driver.test.js`: the driver as a subprocess against the fake Forge server, with the runner's allowlisted environment: hello exactly once, echo, a 3-block walk, a clean stop, a redacted capture, and exit 3 without a token-cache folder or host.
- `e2e-initbot.test.js`: Mindcraft's real `initBot` against an in-process fake Forge server on 127.0.0.1. The run covers the status ping, tagHost, the handshake, Join Game, a REID chunk, inventory and effects, chat both ways, walking, and the capture.

## Known limits (next brief items)

- **nmp protocol cache and shared protocol object.** One bot per process, which is how Mindcraft runs, is fine. Two effects follow from nmp 1.x internals:
  - nmp caches compiled protocols by state, direction and version only, not by `customPackets`. The first play-state client for 1.12.2 in a process fixes the overrides for that process.
  - nmp's `createProtocol` calls lodash `merge(mcData.protocol, customPackets['1.12'])`. That **mutates the shared `minecraft-data` 1.12.2 protocol object in place**, and every `require('minecraft-data')('1.12.2')` in the process returns that same object. After the first Forge connection, `bot.registry.protocol` and any later vanilla or non-REID 1.12.2 client in the same process see the Forge and REID types. A process that needs both must run them in separate processes.
- **Registry properties.** Modded blocks, items, entities and biomes have names but default properties (below) until rotn-data's dump supplies them through `extendRegistry(..., { properties })`. Until then, for example, a modded plant is solid to the bot, and a modded block's hardness and drops are unknown.
- **FML EntitySpawn** is decoded and emitted, but not yet injected into `bot.entities` (brief item 6).
- **Chunk bit widths.** Handled by `patches/prismarine-chunk+1.41.0.patch`:
  - Reads: a global-palette section is read at the width the packet states.
  - Writes: mineflayer applies `block_change` and `multi_block_change` locally. A section widens its data array whenever a state id needs more bits, and a section that leaves its palette uses at least the width of its widest id, so wide ids are never cut to 13 bits.
  - `new Chunk({ maxBitsPerBlock })` can seed a wider starting width. mineflayer does not pass it yet, which is fine because sections widen on write.
- **`ChunkColumn.dump()`** writes biomes back as REID VarInts when they were read that way, or when an id is over 255. Readers of dumps, such as prismarine-viewer or a world saver, therefore get the real biome ids. The viewer stays off anyway (`render_bot_view: false` in `settings.js`) until it is tested against RotN chunks.
- **Book channels.** mineflayer's `MC|BEdit`/`MC|BSign` plugin channels still use the vanilla `slot` type. That only matters for writing books.
