# FML protocol 2 (Forge 1.12.2) client spec for `packages/forge-bridge`

- Source: `forge-protocol-analyst` subagent, researched 2026-11-01, filed by rotn-lead. Input, not a decision; the decision is `docs/adr/0003-forge-bridge-approach.md`.
- Read the **lead addendum (section R)** first. It answers the report's open JEID/REID question: RotN ships RoughlyEnoughIDs (2.2.2 in the pinned 3.3.4 pack, ADR 0005), which changes several packet formats.
- Two corrections from the lead:
  - The report's `[ROTN-SRV]`/`[ROTN-VER]` sources point at an older fork (`CalaMariGold/Rebirth-Of-The-Night`, pack 3.1.1). The canonical repo is `Rebirth-of-the-Night/Rebirth-of-the-Night`, commit `bd2d078d…` "3.3.2" (see `rotn-progression.md`). It also ships `_server-only/forge-1.12.2-14.23.5.2860.jar`, so 2860 is very likely, but confirm it from the zip.
  - The Node conflict is resolved by ADR 0002 (Node 22).

Each fact carries a source tag like [FHM]; the tags resolve to URLs in the Sources section at the end. Anything not confirmed is marked **UNVERIFIED**. The Forge source read is the GitHub `1.12.x` branch head, which is close to the build RotN uses; whether 2860 and the branch head differ in networking code is **UNVERIFIED**, though no difference is expected.

## Summary

- The only npm release of `minecraft-protocol-forge` is 1.0.0 from 2016. Its GitHub master expects a HandshakeReset before ServerHello, so, judging from the code, a direct connection to Forge 1.12.2 fails on the first handshake packet (not run-tested). Neither version parses registries, mod entity spawns or multipart packets.
- Recommendation (section D): write `forge-bridge` fresh, using the Forge source and the `minecraft-protocol-forge` type definitions as references.
- Dependencies need changes:
  - prismarine-chunk reads the wrong bits per block for modded chunks.
  - minecraft-data reads the entity-metadata type as a byte, while Forge mod types need a VarInt.
  - Mod blocks, items and entities must be added to mineflayer's registry.
  - The REID wire changes in section R.
- Questions for the first test-server capture: the exact Forge build in the 3.3.2 zip, the bits per block in RotN's chunks, which mod channels need replies, and the mod-local entity ID table. The JEID/REID question is answered in section R.

---

## 0. Target facts

| Item | Finding |
|---|---|
| Minecraft protocol | 1.12.2 = protocol **340** [MCD-VER] |
| Forge build | 14.23.5.2860 per the repo's `_server-only/` (see the lead note above); confirm from the 3.3.2 zip. Forge's current 1.12.2 builds are latest 14.23.5.2864 and recommended 14.23.5.2859 [PROMOS]. |
| 3.3.2 files | Client file id 7219585, created 2025-11-14. Server pack file id 7219650, "Rebirth of the Night 3.3.2 Server Pack.zip", 771,286,293 bytes (= 735.6 MiB) [CF-API] [CF-ADD]. Versions 3.3.3 and 3.3.4 also exist [CF-API]. |
| Local deps | `package.json`: `mineflayer ^4.33.0`, `minecraft-data ^3.97.0`. No lockfile, no `node_modules`. No patch touches minecraft-protocol. `patches/protodef+1.19.0.patch` only comments out a log line; `patches/minecraft-data+3.97.0.patch` only touches `1.21.6/protocol.json`. |
| Node | mineflayer 4.33.0+ and minecraft-protocol 1.68.0 declare `engines.node >=22` [MF-433] [MF-LATEST] [NMP-LATEST]. Resolved by ADR 0002. |

---

## 1. Login flow

### 1.1 Wire sequence (online mode)

All FML messages travel in **play-state** `custom_payload` packets. Clientbound is packet 0x18 with `channel` (string) and `data` (rest of buffer) [MCD-PROTO]. nmp addresses packets by name, so the serverbound ID does not matter. The first byte of `data` is the FML discriminator [CODEC].

| # | Dir | Protocol state | Message | Notes |
|---|---|---|---|---|
| 1 | C→S | Handshaking | `set_protocol` with `serverHost = host + "\0FML\0"` | The server looks for `\0FML\0` in the host string (read with a 255-character limit), then strips everything from the first NUL [C00]. nmp appends `client.tagHost` to the host. `options.fakeHost` replaces the whole string, so do not use it [NMP-SETPROTO]. |
| 2 | both | Login | Encryption, set compression, Login Success (0x02) | Vanilla, handled by nmp and prismarine-auth. Forge only reroutes the end of login through `fmlServerHandshake` [LOGINPATCH]. The FML handshake starts right after Login Success [POKECHU]. |
| 3 | S→C | Play | `REGISTER` | NUL-separated UTF-8 channel names, no length prefix: `FML|HS`, `FML`, `FML|MP`, then the server's own channels, so `FML` appears twice [FHM] [POKECHU]. |
| 4 | S→C | Play | `FML|HS` ServerHello | [SRVSTATE] |
| 5 | C→S | Play | `REGISTER` | A real client sends its channel list first [CLISTATE] [POKECHU]. |
| 6 | C→S | Play | `FML|HS` ClientHello | [CLISTATE] |
| 7 | C→S | Play | `FML|HS` ModList | The server checks it and kicks the client if it is incompatible (section 1.4) [SRVSTATE] |
| 8 | S→C | Play | `FML|HS` ModList | The server's active mod list [SRVSTATE] |
| 9 | C→S | Play | HandshakeAck phase **2** | [CLISTATE] |
| 10 | S→C | Play | One RegistryData per registry, then HandshakeAck **2** | `hasMore` is true on every packet except the last [SRVSTATE] |
| 11 | C→S | Play | HandshakeAck **3**, after the last RegistryData | [CLISTATE] |
| 12 | S→C | Play | HandshakeAck **3** | Code comment: "Poke the client" [SRVSTATE] |
| 13 | C→S | Play | HandshakeAck **4**, on receiving the server's ack 2 | [CLISTATE] |
| 14 | C→S | Play | HandshakeAck **5**, on receiving the server's ack 3 | [CLISTATE] |
| 15 | S→C | Play | Vanilla `login` (Join Game 0x23) and the rest of the join sequence | The server sets FINALIZING and finishes on its next world tick through `initializeConnectionToPlayer` [DISP]. |

### 1.2 `FML|HS` message layouts

Data types [BBU]:

- **VarInt**: the standard 7-bits-per-byte encoding. Forge caps the byte count per field and throws "VarInt too big" above it.
- **String**: a VarInt byte length (at most 2 bytes, so up to 16,383 bytes), then UTF-8 bytes.

| Disc. | Name | Direction | Body |
|---|---|---|---|
| 0 | ServerHello | S→C | `byte fmlProtocol` (= 2 [POKECHU]), then `int overrideDimension`. The int is read only when `fmlProtocol > 1` [FHM]. |
| 1 | ClientHello | C→S | `byte fmlProtocol` (= 2) [FHM] [POKECHU] |
| 2 | ModList | both | `VarInt(≤2 bytes) n`, then n × (`String modid`, `String version`) [FHM] |
| 3 | RegistryData | S→C | `bool hasMore`, `String registryName`, `VarInt(≤3) nIds` × (`String name`, `VarInt(≤3) id`), `VarInt(≤3) nDummied` × `String`, `VarInt(≤3) nOverrides` × (`String name`, `String value`) [FHM] |
| −1 (0xFF) | HandshakeAck | both | `byte phase`, the ordinal of the sender's state [FHM] [POKECHU] |
| −2 (0xFE) | HandshakeReset | proxy→C | Forge writes no body [FHM]. Velocity and Gate send `{-2, 0}` [VEL-CONST] [GATE]. Forge servers do not normally send it [POKECHU]. |

Discriminator mapping from [CODEC]. The wiki.vg page lists the RegistryData tail as "substitutions, then dummies (may be absent)" [POKECHU]. That is outdated for 14.23.5: the source writes **ids, then dummied, then overrides**, and always writes all three [FHM].

### 1.3 State machines

**Server** (`FMLHandshakeServerState`, ordinals 0–5) [SRVSTATE]:

- **START**: sends REGISTER and ServerHello, moves to HELLO.
- **HELLO**: ignores ClientHello. The next message is **cast unchecked to ModList**. If the mod check passes, sends its ModList and moves to WAITINGCACK.
- **WAITINGCACK**: on the client's next message, whatever it is, sends every RegistryData (unless the connection is local), then ack 2, and moves to COMPLETE.
- **COMPLETE**: on the next client message, sends ack 3, fires CompleteHandshake, moves to DONE.
- **DONE** and **ERROR**: do nothing.

**The server never reads ack phase values; it only counts messages.** That is why MCC works even though it skips ack 3 (section 5).

**Client** (`FMLHandshakeClientState`: START 0, HELLO 1, WAITINGSERVERDATA 2, WAITINGSERVERCOMPLETE 3, PENDINGCOMPLETE 4, COMPLETE 5, DONE 6, ERROR 7) [CLISTATE] [MCC-ENUM]. Each state sends an ack equal to its own ordinal:

- **HELLO**: sends REGISTER, ClientHello and ModList, and stores `overrideDimension` when the protocol version is above 1.
- **WAITINGSERVERDATA**: on the server's ModList, sends ack 2.
- **WAITINGSERVERCOMPLETE**: collects RegistryData until `hasMore == false`, then sends ack 3.
- **PENDINGCOMPLETE**: sends ack 4.
- **COMPLETE**: sends ack 5.
- **DONE**: on HandshakeReset, goes back to HELLO.

**Minimal compliant bot**: copy the client state machine exactly. The client sends its ModList before it receives the server's, so the bot needs the mod list in advance, either from a status ping (`modinfo.type == "FML"`, `modinfo.modList` [FNH] [NMPF-AUTO]) or from a stored fixture.

### 1.4 What the server does when the client deviates

| Deviation | Server reaction | Source |
|---|---|---|
| No `\0FML\0` marker | Disconnect: "This server has mods that require FML/Forge to be installed on the client. Contact your server admin for more details." (unless every mod accepts vanilla clients). Logging in during startup gives "Server is still starting! Please wait before reconnecting." | [FCH] |
| Marker sent, but no FML reply | Logs "Timeout occurred, assuming a vanilla client", then kicks with "This is modded. No modded response received. Bye!". **UNVERIFIED**: what triggers the timeout and how long it waits. | [DISP] |
| Missing mod or wrong version in ModList | Kick: `"Server Mod rejections:\n<ModName>: " + reason`, with reasons like "Requires %s but mod is not found on client." and "Requires %s but client has %s." The default check is an exact version match. Mods with `acceptableRemoteVersions="*"` skip it. A custom `@NetworkCheckHandler` can fail with its own message. The kick is a play-state `SPacketDisconnect`. | [FNH] [NMH] [DISP] |
| Anything but ClientHello or ModList in HELLO | The unchecked cast throws ClassCastException and the handler moves to ERROR. **UNVERIFIED**: the exact kick text. | [SRVSTATE] [HMH] |
| Wrong ack values | Ignored; only the message count matters. | [SRVSTATE] |
| Too few messages | The handshake stalls. `fml.loginTimeout` defaults to 600; **UNVERIFIED**: its unit and where it is used. `fml.readTimeout` defaults to 30 s and replaces vanilla's read timeout. | [FNH] [NETSYS] |
| Missing registry entries | Checked only on the client ("Fatally missing registry entries"), so a bot can ignore it. | [CLISTATE] |

The server logs kicks as `Network Disconnect: {}` [DISP].

### 1.5 After the handshake

- **overrideDimension**: the client uses the ServerHello value when it is nonzero, otherwise the Join Game dimension [DISP]. forge-bridge should report the ServerHello value as the true dimension.
- **`FORGE` channel (S→C), discriminator 1, DimensionRegister**: `int dimensionId`, then a `short` byte length and UTF-8 `providerId` [FORGEMSG] [FORGECODEC].
- **`FORGE` channel, discriminator 2, FluidIdMap**: `int n`, n × (String name, `int` id), then optionally n × String default-fluid names [FORGEMSG] [FORGECODEC].
- Neither needs a reply. **UNVERIFIED**: exactly when they are sent.

### 1.6 `FML|MP` multipart (S→C only)

A payload of `PART_SIZE = 0x100000 - 0x50` (1,048,496) bytes or more is split [PROXY]:

- **Header** on channel `FML|MP`: `String channel` (vanilla string, at most 20 characters), `byte parts`, `int totalLength`.
- **Parts**: a 0-based part-index byte, then up to `PART_SIZE - 1` payload bytes.
- At most 255 parts. The client rejects parts that arrive out of order [DISP].
- forge-bridge should reassemble the parts and re-emit them as a `custom_payload` on the inner channel. A large RegistryData (e.g. items) could arrive this way. **UNVERIFIED** whether RotN's does.

---

## 2. Registry sync

- **Registries sent**: the server snapshots **all** active registries (`takeSnapshot(false)`), one RegistryData each, from a HashMap, so **the order is unspecified** [REGMGR] [SRVSTATE]. Forge's 11 are `minecraft:blocks`, `items`, `potions`, `biomes`, `soundevents`, `potiontypes`, `enchantments`, `entities`, `recipes`, `villagerprofessions` and `dataserializers`; mods can add more [GAMEDATA].
- **ID ranges** in stock Forge [GAMEDATA]. REID raises several of these (section R):

  | Registry | Range |
  |---|---|
  | Blocks | 0–4095 (`MAX_BLOCK_ID = 4095`) |
  | Items | up to 31999; `MIN_ITEM_ID = 4096` for non-block items. **UNVERIFIED** whether ItemBlocks reuse their block's ID, so always use the synced map. |
  | Potions, biomes | ≤255 |
  | Enchantments | < `Short.MAX_VALUE` |
  | Entities, sounds, recipes | up to `Integer.MAX_VALUE >> 5` |
  | Data serializers | mod serializers start at **256**, leaving 0–255 for vanilla |

- **Name to number**: build `name → id` and its inverse for each registry from `ids`.
  - `dummied`: names the server holds only as placeholders; treat them as unknown.
  - `overrides`: a name → string map; the value is probably the owning mod. **UNVERIFIED** beyond the field types [FHM].
- **Block states**: Forge gives each state the global ID `blockId << 4 | meta`, with `meta = getMetaFromState`, then re-puts the canonical state for each meta [GAMEDATA]. Chunk palettes and the global palette carry these values [C4K3-CHUNK], so `blockId = state >> 4` and `meta = state & 15`. Mapping meta to named properties needs per-block data from mod code, so it is rotn-data's dumper job.
- **Items on the wire** in stock 1.12: `short id` (−1 = empty), `byte count`, `short damage`, NBT (0 = none) [C4K3-SLOT]. **REID changes the id to a VarInt (section R).**
- **Timing**: Join Game and chunks arrive only after the handshake [DISP], so the registries are complete before the first chunk. forge-bridge can extend `bot.registry` (blocks, items, entities) once the last RegistryData arrives and before mineflayer needs it. rotn-data owns names and properties.

---

## 3. Mod entities

- **Routing**: Forge patches `EntityTrackerEntry.createSpawnPacket` to call `FMLNetworkHandler.getEntitySpawningPacket` first [ETE]. That returns an **FML spawn message** for any class registered through `EntityRegistry.registerModEntity`, unless the registration chose vanilla spawning [FNH]. Vanilla spawning defaults to `false` and is set only through `setCustomSpawning(..., true)` [ENTREG]. So effectively **every RotN mod mob arrives on channel `FML`, discriminator 2, with no vanilla `spawn_entity_living`**. Later move, metadata and destroy packets are vanilla, keyed by entity ID. **UNVERIFIED**: which network ID a mod entity that opts into vanilla spawning would use (probably its `minecraft:entities` ID).
- **`FML` channel discriminators** [RTCODEC]: 0 = CompleteHandshake (internal, never on the wire), 1 = OpenGui, 2 = EntitySpawnMessage.

**EntitySpawnMessage** (`FML`, discriminator 2) [FMLMSG]:

| Field | Type | Notes |
|---|---|---|
| entityId | int | |
| modId | String (Forge UTF-8) | Owning mod's ID |
| modEntityTypeId | int | The **mod-local** ID passed to `registerModEntity`, not the `minecraft:entities` ID [ENTREG] |
| uuid | long msb, long lsb | |
| x, y, z | double ×3 | Absolute, not fixed-point |
| yaw, pitch, headYaw | byte ×3 | Angle = byte × 360/256. headYaw is 0 for non-living entities. |
| metadata | vanilla entity-metadata list | Entries end with index 0xFF [C4K3-ENT]; no length prefix |
| throwerId | int | 0 = none. If nonzero, 3 × `int` velocity follow, each = motion × 8000, clamped to ±3.9 before scaling. |
| extra | rest of buffer | Mod-specific `IEntityAdditionalSpawnData`, no length; can be ignored |

**OpenGui** (discriminator 1): `int windowId`, `String modId`, `int modGuiId`, `int x`, `int y`, `int z` [FMLMSG]. Mod containers open this way with **no vanilla `open_window`**, so forge-bridge would need to create a synthetic window for the bot to use them.

**To see RotN mobs, the client must:**

1. Parse the message above.
2. Map `(modId, modEntityTypeId)` to a name. This table is **not in RegistryData**; it must come from the rotn-data dumper.
3. Create or fetch the entity the way mineflayer does (`bot.entities[id] || new Entity(id)`), set `type`, `name`, `uuid`, position and angles, and emit `entitySpawn`. Otherwise mineflayer labels unknown types `name: 'unknown'` [MF-ENT].
4. Parse metadata with **VarInt** type IDs. The 1.12 format defines Type as a VarInt [C4K3-ENT], but minecraft-data 1.12.2 declares it `i8` [MCD-PROTO]. Mod serializer IDs of 256 and up (synced in `minecraft:dataserializers` [GAMEDATA]) take 2 VarInt bytes, which the current parser misreads. Unknown serializer types cannot be skipped, so on an unknown type forge-bridge should stop and keep the partial metadata. This also affects vanilla `entity_metadata` packets for mod mobs. **UNVERIFIED** whether any RotN mod uses custom serializers.

---

## 4. Mod plugin channels and silent-channel kicks

- **Forge core**: after `FML|HS`, no core message needs a client reply. `FML` (OpenGui, EntitySpawn), `FORGE` (Dimension, Fluid) and `FML|MP` are all server-to-client [RTCODEC] [FORGECODEC] [PROXY].
- **REGISTER**: send at least `FML|HS\0FML\0FML|MP\0FML\0FORGE`, as MCC and the reference implementation do [MCC-P18] [NMPF-HS]. Echoing the server's mod channels is optional. **UNVERIFIED** whether any 1.12 mod checks what the client registered.
- **RotN mod channels that need answers: UNVERIFIED.** The mod repo is private and no per-mod requirements are published. One historical example of a mod expecting a client packet: "Add CoFH's SendUUID packet" (nmp-forge issue #9, 1.7.10 era) [NMPF-ISSUES]. Use the section 6 capture to find them.

**Detecting a kick caused by a silent channel:**

1. Record the kick reason from `kick_disconnect` (0x1a) [MCD-PROTO]. Forge kicks go through `kickWithMessage`, and the server logs `Network Disconnect: <reason>` [DISP].
2. Classify by text:
   - Handshake: "Server Mod rejections", "No modded response".
   - Timeouts: vanilla "Timed out", after `fml.readTimeout` = 30 s [FNH].
   - Server exceptions: `Internal Exception: ...` (**UNVERIFIED** wording).
   - Anything else is a mod's own message.
3. Keep a ring buffer of the last 200 clientbound `custom_payload` packets (channel, discriminator, length, time) and whether forge-bridge replied. If a kick follows within N seconds of an unanswered channel, flag that channel.
4. Confirm by replaying the scenario with a real Forge client (section 6) and diffing serverbound payloads.

---

## 5. Existing implementations

| Project | Language | Last activity | Covers | Licence | Portable? |
|---|---|---|---|---|---|
| **minecraft-protocol-forge** [NMPF] | JS | Commit 2026-10-06; "Release 1.2.0" commit 2026-03-30 [NMPF-COMMITS]. **npm has only 1.0.0 (2016-02-13), built on protodef 0.2.5** [NPM-NMPF]. | FML1 handshake (~310 lines), FML2, FML3, `autoVersionForge` | BSD-3-Clause [NPM-NMPF] | ProtoDef type definitions and structure (compatible with MIT, with attribution). Defects in B. |
| **Minecraft Console Client** [MCC] | C# | Commits 2026-10-28 [MCC-COMMITS] | FML1/2/3 handshakes (`Protocol18Forge.cs`, `Forge/*.cs`). Its 1.9–1.12 chunk reader **honours the packet's bitsPerBlock** [MCC-TERRAIN]. Reads only the RegistryData header; no FML entity spawning [MCC-P18]. | CDDL-1.0 [MCC] | Behavioural reference only. CDDL is per-file copyleft, so translated code would bring CDDL into an MIT repo. |
| **Velocity** `connection/forge/legacy` [VEL] | Java | 3.5.1, 2026-07-11 [VEL-COMMITS] | Proxy-side legacy phases, reset packet, marker constant | GPL-3.0+ [VEL-CONST] | Reference only (GPL). |
| **Gate** `pkg/edition/java/forge/legacy.go` [GATE] | Go | 0.75.16, 2026-10-31 [GATE-COMMITS] | ~100 lines: constants, `ResetPacket`, `ReadMods`; no state machine | Apache-2.0 [GATE-REPO] | Trivial; constants only. |
| **BungeeCord** `net/md_5/bungee/forge` [BUNGEE] | Java | 2026-10-31 [BUNGEE-COMMITS] | Proxy client and server handshake states [BUNGEE-STATE] | BSD-style with a hosting restriction [BUNGEE-LIC] | Reference only. |
| **Forge 1.12.x source** [FHM] etc. | Java | Branch frozen | Authoritative | LGPL-2.1 | Read only; reimplement from it. |

MCC's sequence: on START, REGISTER, ClientHello and ModList; a 2 s sleep and ack 2; registries with no ack; ack 4 on the server's ack; ack 5 [MCC-P18]. It works only because the server counts messages (section 1.3).

---

## 6. Packet-capture plan (disposable CPX42 test server only)

1. **Server setup**: the official 3.3.2 server pack, default configs, `online-mode=true`. Record the zip's SHA-256 and the Forge jar name (answers the build question).
   - Set `network-compression-threshold=-1`. The debug logger hooks the frame splitter and prepender [PLH]; **UNVERIFIED** whether it sits before decompression, so turning compression off avoids the question.
2. **Run A (handshake)**: JVM flag `-Dfml.debugNetworkHandshake=true`.
   - Forge logs every frame at DEBUG on the FML logger as `"{}:\n{}"`, with prefixes like `SERVER: C->S` and a content dump [PLH] [DISP].
   - **The server then closes the connection right after the handshake** with "Handshake Complete review log file for details." [DISP], so Run A captures only the handshake.
   - **UNVERIFIED**: which log file gets DEBUG output (check `logs/` after the run, or pass a log4j2 config).
3. **Run B (play)**: no debug flag. The bot captures on its side through nmp's `raw` and `packet` events, which see decrypted data [NMP-API]. Record chunks near spawn, every `FML` and `FORGE` payload, every `entity_metadata` for mod mobs, and every `window_items`/`set_slot` (REID slot format, section R). Then idle 10 minutes to surface kicks.
4. **Run C (golden)**: a real Forge 1.12.2 + RotN 3.3.2 client with `-Dfml.debugNetworkHandshake=true` on the client JVM. Diff its serverbound REGISTER, ModList, acks and mod-channel replies against the bot's. Needs a human with a licensed client (NEEDS-HUMAN, only if Run B shows an unexplained kick).
5. **What to log**:
   - Per packet: timestamp, direction, state, name, length, channel, discriminator, payload as base64.
   - The status-ping JSON, including `modinfo.modList`.
   - Kick reasons, plus the server log's `Network Disconnect` and `lost connection` lines.
   - The first byte of each chunk section (bits per block) whenever it is above 8.
   - The REID mod id and version string from the ModList.
6. **Fixtures** (`packages/forge-bridge/test/fixtures/`, owned by net-forge; harness-ops scenario captures may also go under `test/fixtures/`):
   - `rotn-3.3.2/forge-<build>/manifest.json`: versions, hashes, date, capture tool version.
   - `handshake.jsonl.gz`.
   - `registries/<name>.bin`: the raw RegistryData bodies.
   - `play-sample.jsonl.gz`.
   - `ping.json`.
   - Redact the username and UUID; never store tokens.
7. **Tests on the fixtures**:
   - Replay into the forge-bridge state machine on a fake nmp client (EventEmitter) and assert the exact outgoing sequence.
   - Parse every RegistryData and FML spawn message.
   - Load chunks with the patched prismarine-chunk and check that block names resolve.

---

## A. Does current nmp / mineflayer support 1.12.2?

Yes.

- 1.12.2 is in nmp's `supportedVersions` [NMP-VER], mineflayer's `testedVersions` [MF-VER] and the README [NMP].
- No open 2025–2026 report of 1.12.2 breakage was found [SEARCH-MF]. An open 2024 "chest event 1.12.2" issue exists; its status could not be confirmed (**UNVERIFIED**).
- Known Forge-specific problems:
  - mineflayer #2616: "HandshakeReset has no associated fieldInfo" when moving between servers through a proxy, still open [MF-2616].
  - The minecraft-data metadata `i8` type (section 3).
  - The prismarine-chunk bits issue (C).
  - The Node 22 engines requirement (ADR 0002).

## B. Is `minecraft-protocol-forge` compatible with current nmp, and where does it hook in?

Hook points [NMPF-HS] [NMPF-AUTO]:

- `forgeHandshake(client, { forgeMods })` sets `client.tagHost = '\0FML\0'`. nmp master still appends `tagHost` in `setProtocol.js`, so that still works [NMP-SETPROTO].
- It listens on `client.on('custom_payload')` filtered to `FML|HS`, replies with `client.write('custom_payload', …)`, and emits `forgeMods`.
- `autoVersionForge(client)` pushes three hooks onto `client.autoVersionHooks`, run on the ping response: `modinfo.type == 'FML'` selects FML1, `forgeData.fmlNetworkVersion == 2` selects FML2, `forgeData.d` selects FML3. nmp's API docs do not document `autoVersionHooks` [NMP-API] (**UNVERIFIED**).
- Using it with mineflayer means calling it on `bot._client` before `connect` fires (**UNVERIFIED**).

Compatibility:

- GitHub master's `package.json` depends on `minecraft-protocol ^1.43.1` [NMPF-PKG]. npm 1.0.0 is unusable with modern nmp (protodef 0.2.5) [NPM-NMPF].
- **Defects in master's FML1 path, from reading the code (not run-tested):**
  - It defaults to RESET and **asserts a HandshakeReset first**, so a direct ServerHello throws, uncaught. PR #21 was only tested through a proxy transfer [NMPF-HS] [PR21].
  - RegistryData is parsed only up to `hasMore`; the rest is discarded and logged with `console.log`.
  - No `FML|MP`, no `FML` or `FORGE` channel handling, no entity spawns.
  - It sends ack 2 immediately, which works only because the server counts messages.

## C. Chunk bits per block on modded 1.12.2

- **Vanilla**: sections with more than 8 bits per block use the global palette, whose width is ceil(log2(block-state count)), "13 for the current vanilla release". Entries can span two longs [C4K3-CHUNK].
- **Forge** patches the **client read path** to use the bits value from the packet ("Force bit density to fix network issues"), then resizes to its own registry size [BSC]. The server's width grows with the modded state count, up to 16 bits, since IDs reach `4095<<4|15` in stock Forge.
  - **UNVERIFIED**: RotN's actual width. Expect 14 or more; with REID it may be larger (section R).
  - **UNVERIFIED**: whether `size()` counts entries rather than the maximum ID; `ClearableObjectIntIdentityMap` does not override it [GAMEDATA].
- **prismarine-chunk 1.9 needs a patch**:
  - `ChunkColumn.load` reads `bitsPerBlock` from the packet but uses `this.maxBitsPerBlock` (from vanilla minecraft-data) for global-palette sections [PCHUNK-COL], which misreads every modded section.
  - `ChunkSection` falls back to `GLOBAL_BITS_PER_BLOCK = 13` and writes state IDs into 13 bits without a range check [PCHUNK-SEC].
  - Fix: use the packet value on load, and set `maxBitsPerBlock` = ceil(log2(synced state count)), or a safe upper bound, for local writes. MCC does the first part [MCC-TERRAIN].
- **JEID/REID**: RotN 3.3.2 ships REID; see section R for what changes.

## D. Recommendation (analyst)

Write `packages/forge-bridge` fresh as an nmp client plugin:

- Set `tagHost`.
- Implement the Forge 1.12 client state machine exactly as in section 1.3, with the full RegistryData parser, `FML|MP` reassembly, the `FML` spawn and OpenGui decoders, and the `FORGE` decoders.
- Expose the registries and the overrideDimension.
- Copy the ProtoDef type definitions from minecraft-protocol-forge (BSD-3, with attribution) rather than depending on it: npm has only the 2016 build, and master breaks on direct connections.
- Use MCC (CDDL), Velocity (GPL) and BungeeCord as behavioural references only, to keep the MIT repo clean.

Forking minecraft-protocol-forge saves little: the FML1 file is about 310 lines and most of it needs rewriting. Porting MCC or Velocity raises licensing problems and gains little.

Patch-package changes needed: prismarine-chunk bits, VarInt metadata types in minecraft-data 1.12.2, a mineflayer hook to inject entities and registries, plus the REID changes (section R).

Risks:

1. Unknown mod channels that expect replies and kick silently (section 4).
2. Custom DataSerializers stopping metadata parsing.
3. The REID wire changes (section R).
4. Mod GUIs that open without `open_window`.
5. The mod-local entity ID table depends on rotn-data's dumper.
6. Forge build unverified (2860 likely; 1.12.x networking is frozen).

---

## R. Lead addendum: RoughlyEnoughIDs (REID) is in RotN and changes the wire format

Revised 2026-11-01 after the independent review of PR #2 and after inspecting the REID 2.2.2 jar from the 3.3.4 zip (ADR 0005).

**Evidence.**

- `config/RoughlyEnoughIDs.cfg` exists in the RotN repo at the 3.3.2 commit (`Rebirth-of-the-Night/Rebirth-of-the-Night@bd2d078d`).
- The 3.3.4 server zip ships `mods/RoughlyEnoughIDs-2.2.2.jar`.
- REID source: https://github.com/TerraFirmaCraft-The-Final-Frontier/RoughlyEnoughIDs (MIT). It is the maintained successor to JustEnoughIDs (package `org.dimdev.jeid`).
- **ModList entry.** REID's `mcmod.info` has `"modid": "jeid"`, `"version": "2.2.2"`, so gate every REID override on the ModList entry **`jeid`**, not on `roughlyenoughids`.
- **The version matters.** REID's default-branch HEAD is 2.3.1, not 2.2.2, and the two differ. The list below is from the 2.2.2 jar's `mixins.jeid.core.json` and its class files. Where only HEAD source was read, the row is marked "(HEAD)".

**`mixins.jeid.core.json` in 2.2.2:**

- Common: `enchant.MixinEnchantmentHelper`, `enchant.MixinItemEnchantedBook`, `misc.MixinBlock`, `misc.MixinGameData`, `misc.MixinStatList`, `network.MixinPacketBuffer`, `network.MixinPacketUtil`, `network.MixinSPacketChunkData`, `potion.MixinSPacketEntityEffect`, `potion.MixinSPacketRemoveEntityEffect`, `world.*`.
- Client: `network.client.MixinNetHandlerPlayClient`, `potion.client.MixinNetHandlerPlayClient`, `world.client.MixinChunk`, among others.
- **There is no `MixinSPacketBlockAction` in 2.2.2.** That mixin exists only at HEAD.

| Mixin or class | Wire change | Where the bot must handle it |
|---|---|---|
| `network.MixinPacketBuffer` (2.2.2 and HEAD) | In `writeItemStack`/`readItemStack`, the item **id is a VarInt** instead of a `short`, including the `-1` for an empty stack. Count (byte), damage (short) and NBT are unchanged. This covers every slot in both directions: `window_items`, `set_slot`, entity equipment, item-entity metadata, `window_click`, creative slots. | nmp protocol type override for `slot` |
| `network.MixinPacketUtil` (2.2.2) | The same change in Forge's `writeItemStackFromClientToServer` (serverbound slots). | Same `slot` override |
| `network.MixinSPacketChunkData` (2.2.2 and HEAD) | In full chunks, the 256-byte biome array is replaced by a **VarInt array**: a VarInt length, then VarInt biome ids. This happens **inside the opaque `chunkData` byte buffer** (`extractChunkData`), after the block sections; it is not a separate `map_chunk` field. | **prismarine-chunk `ChunkColumn.load` patch**, not an nmp type override. Block sections come first, so block parsing may still work while the biome tail is wrong; check with a fixture. |
| `potion.MixinSPacketEntityEffect` (2.2.2) | Effect id as an int. At HEAD the vanilla byte is replaced by a VarInt. In 2.2.2 the TAIL injections on read/writePacketData call readVarInt/writeVarInt, so the **expected layout is the vanilla byte kept, with a VarInt effect id appended after the vanilla fields**. A capture must confirm this before the override is final. | nmp override for `entity_effect`, per capture |
| `potion.MixinSPacketRemoveEntityEffect` (2.2.2) | Effect id is a **fixed 4-byte int (i32)** (`readInt`/`writeInt`), **not a VarInt**. | nmp override for `remove_entity_effect` |
| `org.dimdev.jeid.network.MessageManager` (2.2.2) | REID's own `SimpleNetworkWrapper` channel **`jeid`**. Server-to-client messages: `BiomeChunkChangeMessage`, `BiomeAreaChangeMessage`, `BiomePositionChangeMessage`. | forge-bridge: log them, optionally apply biome updates. No reply is needed. |
| `enchant.MixinEnchantmentHelper` (2.2.2 and HEAD) | Enchantment NBT `id` is stored as TAG_Int instead of a short. | rotn-data and skills code that reads enchantments from NBT |
| `network.client.MixinNetHandlerPlayClient` (HEAD read) | Falling-block spawn data carries the full 32-bit state id. | mineflayer object spawn for falling blocks (low priority) |
| `world.MixinBlockStateContainer` | Changes NBT storage (palette ids), not the network path, as far as read. Block state ids can exceed `4095<<4\|15`, so the global palette may need more than 16 bits. | prismarine-chunk bits patch (section C) |

**Consequences for forge-bridge** (in ADR 0003 and the net-forge brief):

1. nmp protocol type overrides for `slot`, `entity_effect` and `remove_entity_effect`, applied only when REID is in the server's ModList. Do them as a protocol customization or a minecraft-data patch; never edit upstream files in place.
2. A prismarine-chunk patch for the biome VarInt tail and the packet's `bitsPerBlock`.
3. Without (1), inventory parsing fails. Without (2), at least the biome tail of every full chunk misparses; block data may survive. The spike checks both early with fixtures.
4. Fixtures must include `window_items`, `set_slot`, `map_chunk`, `entity_effect`, `remove_entity_effect` and any `jeid` channel payloads.

---

## Sources

- [POKECHU]: https://wikivg.booky.dev/User:Pokechu22/Forge (mirror of https://wiki.vg/User:Pokechu22/Forge)
- [FHM]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/handshake/FMLHandshakeMessage.java
- [CODEC]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/handshake/FMLHandshakeCodec.java
- [SRVSTATE]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/handshake/FMLHandshakeServerState.java
- [CLISTATE]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/handshake/FMLHandshakeClientState.java
- [DISP]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/handshake/NetworkDispatcher.java
- [HMH]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/handshake/HandshakeMessageHandler.java
- [FNH]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/internal/FMLNetworkHandler.java
- [FMLMSG]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/internal/FMLMessage.java
- [RTCODEC]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/internal/FMLRuntimeCodec.java
- [PROXY]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/internal/FMLProxyPacket.java
- [NMH]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/internal/NetworkModHolder.java
- [BBU]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/ByteBufUtils.java
- [PLH]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/network/PacketLoggingHandler.java
- [FCH]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/FMLCommonHandler.java
- [GAMEDATA]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/registries/GameData.java
- [REGMGR]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/registries/RegistryManager.java
- [ENTREG]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/fml/common/registry/EntityRegistry.java
- [FORGEMSG]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/common/network/ForgeMessage.java
- [FORGECODEC]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/src/main/java/net/minecraftforge/common/network/ForgeRuntimeCodec.java
- [BSC]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/patches/minecraft/net/minecraft/world/chunk/BlockStateContainer.java.patch
- [C00]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/patches/minecraft/net/minecraft/network/handshake/client/C00Handshake.java.patch
- [ETE]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/patches/minecraft/net/minecraft/entity/EntityTrackerEntry.java.patch
- [LOGINPATCH]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/patches/minecraft/net/minecraft/server/network/NetHandlerLoginServer.java.patch
- [NETSYS]: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.12.x/patches/minecraft/net/minecraft/network/NetworkSystem.java.patch
- [PROMOS]: https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json
- [C4K3-CHUNK]: https://c4k3.github.io/wiki.vg/Chunk_Format.html
- [C4K3-ENT]: https://c4k3.github.io/wiki.vg/Entities.html
- [C4K3-SLOT]: https://c4k3.github.io/wiki.vg/Slot_Data.html
- [MCD-PROTO]: https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.12.2/protocol.json
- [MCD-VER]: https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.12.2/version.json
- [NMP]: https://github.com/PrismarineJS/node-minecraft-protocol
- [NMP-SETPROTO]: https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol/master/src/client/setProtocol.js
- [NMP-VER]: https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol/master/src/version.js
- [NMP-API]: https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol/master/docs/API.md
- [NMP-LATEST]: https://registry.npmjs.org/minecraft-protocol/latest
- [MF-VER]: https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/lib/version.js
- [MF-ENT]: https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/lib/plugins/entities.js
- [MF-433]: https://registry.npmjs.org/mineflayer/4.33.0
- [MF-LATEST]: https://registry.npmjs.org/mineflayer/latest
- [MF-2616]: https://github.com/PrismarineJS/mineflayer/issues/2616
- [SEARCH-MF]: https://lightrun.com/answers/prismarinejs-mineflayer-1122-not-supported-and-no-error-displayed (2017 discussion; no newer reports found)
- [PCHUNK-COL]: https://raw.githubusercontent.com/PrismarineJS/prismarine-chunk/master/src/pc/1.9/ChunkColumn.js
- [PCHUNK-SEC]: https://raw.githubusercontent.com/PrismarineJS/prismarine-chunk/master/src/pc/1.9/ChunkSection.js
- [NMPF]: https://github.com/PrismarineJS/node-minecraft-protocol-forge
- [NMPF-HS]: https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol-forge/master/src/client/forgeHandshake.js
- [NMPF-AUTO]: https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol-forge/master/src/client/autoVersionForge.js
- [NMPF-PKG]: https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol-forge/master/package.json
- [NMPF-COMMITS]: https://github.com/PrismarineJS/node-minecraft-protocol-forge/commits/master
- [NMPF-ISSUES]: https://github.com/PrismarineJS/node-minecraft-protocol-forge/issues
- [PR21]: https://github.com/PrismarineJS/node-minecraft-protocol-forge/pull/21
- [NPM-NMPF]: https://registry.npmjs.org/minecraft-protocol-forge
- [MCC]: https://github.com/MCCTeam/Minecraft-Console-Client
- [MCC-COMMITS]: https://github.com/MCCTeam/Minecraft-Console-Client/commits/master
- [MCC-P18]: https://raw.githubusercontent.com/MCCTeam/Minecraft-Console-Client/master/MinecraftClient/Protocol/Handlers/Protocol18Forge.cs
- [MCC-ENUM]: https://raw.githubusercontent.com/MCCTeam/Minecraft-Console-Client/master/MinecraftClient/Protocol/Handlers/Forge/FMLHandshakeClientState.cs
- [MCC-TERRAIN]: https://raw.githubusercontent.com/MCCTeam/Minecraft-Console-Client/master/MinecraftClient/Protocol/Handlers/Protocol18Terrain.cs
- [VEL]: https://github.com/PaperMC/Velocity/tree/dev/3.0.0/proxy/src/main/java/com/velocitypowered/proxy/connection/forge/legacy
- [VEL-CONST]: https://raw.githubusercontent.com/PaperMC/Velocity/dev/3.0.0/proxy/src/main/java/com/velocitypowered/proxy/connection/forge/legacy/LegacyForgeConstants.java
- [VEL-COMMITS]: https://github.com/PaperMC/Velocity/commits/dev/3.0.0
- [GATE]: https://raw.githubusercontent.com/minekube/gate/master/pkg/edition/java/forge/legacy.go
- [GATE-REPO]: https://github.com/minekube/gate
- [GATE-COMMITS]: https://github.com/minekube/gate/commits/master
- [BUNGEE]: https://github.com/SpigotMC/BungeeCord/tree/master/proxy/src/main/java/net/md_5/bungee/forge
- [BUNGEE-STATE]: https://raw.githubusercontent.com/SpigotMC/BungeeCord/master/proxy/src/main/java/net/md_5/bungee/forge/ForgeServerHandshakeState.java
- [BUNGEE-LIC]: https://raw.githubusercontent.com/SpigotMC/BungeeCord/master/LICENSE
- [BUNGEE-COMMITS]: https://github.com/SpigotMC/BungeeCord/commits/master
- [ROTN-SRV] / [ROTN-VER]: the analyst used https://github.com/CalaMariGold/Rebirth-Of-The-Night (older fork, pack 3.1.1). Canonical: https://github.com/Rebirth-of-the-Night/Rebirth-of-the-Night/tree/bd2d078d933e798ad9f87d3171ca31ddbe6b24f4
- [CF-API]: https://www.curseforge.com/api/v1/mods/338901/files?pageIndex=0&pageSize=20&sort=dateCreated&sortDescending=true&removeAlphas=false
- [CF-ADD]: https://www.curseforge.com/api/v1/mods/338901/files/7219585/additional-files
- [REID]: https://github.com/TerraFirmaCraft-The-Final-Frontier/RoughlyEnoughIDs (lead addendum)
