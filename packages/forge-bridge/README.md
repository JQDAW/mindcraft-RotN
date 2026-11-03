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

**Profile-fetch diagnostics** (`src/auth-diagnostics.js`, G2 batch 2). prismarine-auth swallows a failed Minecraft profile fetch: it reports the cause only through `debug('prismarine-auth')`, which the guard forbids. nmp then throws "Failed to obtain profile data" with no cause. So `initBot` wraps prismarine-auth's `fetchProfile` (the copy nmp loads), and a failure logs one line:

```
[forge-bridge] Minecraft profile fetch failed after 812 ms: HTTP 429 Too Many Requests (Error)
[forge-bridge] Minecraft profile fetch failed after 20013 ms: no HTTP response (TypeError; cause Error ETIMEDOUT)
```

- **What it logs:** the status number, its standard name (from `node:http`), the error class, a network cause's class and code, and the time taken.
- **What it never logs:** the error message (prismarine-auth puts the response body in it), bodies, headers, the token, or the profiles folder. Names and codes must match a strict identifier pattern before they are logged.
- **Behaviour is unchanged:** the error is rethrown as it was.
- **Errors before login** (#72 review). mineflayer's default error logger (`logErrors`) prints whole error objects, and prismarine-auth's `checkStatus` puts the full HTTP response body in the message (Xbox user, device and title auth, Live refresh). So `initBot` turns that logger off.
  - **Before login** it logs only `classifyBeforeJoinError`'s facts: class, code, status and kind, never the message.
  - **After login** errors print as mineflayer printed them.
  - A listener is always attached (`attachBotErrorLogger`), a no-op with `hideErrors`, so an `error` never throws as unhandled.
- **prismarine-auth's own output** (`patches/prismarine-auth+3.1.1.patch`, lead-approved). The patch reduces it to status, class and code (`Util.errorSummary`):
  - `Error refreshing token` (Live and MSA) no longer prints the error object;
  - a non-200 Live device-code request prints its status, not its body;
  - an MSA device-code failure no longer prints the serialized MSAL error;
  - each failed poll of the Live device-code loop prints a summary (`[live] device code polling error (Error, expired_token)`), not the error object; the OAuth error code is attached as `code`;
  - XSTS errors carry `err.xerr`, and an unknown XErr's message no longer includes the response JSON.

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
| `MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS` | How long `bot.placeBlock` waits for the server's block update before it fails ("Event blockUpdate:... did not fire within timeout"). The default is 500 ms (Mindcraft's value; upstream mineflayer uses 5000). It wins over `settings.place_block_timeout_ms` and must be an integer from 50 to 60000; any other value is warned about and ignored. A successful placement returns as soon as the update arrives, so a larger value only delays real failures. `bot.placeBlockTimeout` changes it at runtime, and `bot._placeBlockWithOptions(ref, face, { timeout })` changes it for one call (`patches/mineflayer+4.33.0.patch`, `place_block.js`). A value set on the bot before the plugins load is kept. mineflayer's `onceWithCleanup` leaves its timer running after a success (upstream behaviour), so each placement leaves one harmless pending timer of this length. |

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
  - **1.12 names of vanilla entries are aliased, not replaced.** minecraft-data spells some vanilla entries the 1.13 way. In RotN 3.3.4 that is 2 blocks (`minecraft:silver_shulker_box` 227, `minecraft:silver_glazed_terracotta` 243) and 45 biomes (`minecraft:beaches` 16, `minecraft:void` 127, `minecraft:mutated_mesa` 165, ...). Such an entry keeps minecraft-data's data at its id (as a copy, with `registryName` set to the 1.12 name), and both the 1.12 name and minecraft-data's name resolve to it in `*ByName` (`registryReport.aliases`). The 4 vanilla items minecraft-data has no entry for (`air`, `portal`, `end_portal`, `end_gateway`) get defaults under their unprefixed name. A vanilla mob under its 1.12 name is found by minecraft-data's `internalId` (EntityList id). `forge.modded` is set only for names outside `minecraft:`.
  - **Entities are never rebound.** Forge's `minecraft:entities` holds EntityList ids (item 1, xp_orb 2, arrow 10, silverfish 60), but 1.12's `spawn_entity` uses *object* ids (item 2, arrow 60), which is what minecraft-data's `entities` map holds. Rebinding would make dropped items `xp_orb` and arrows `silverfish`. So vanilla entity entries are left alone, modded entities are added only into free ids, and `registry.entitiesByForgeId` maps every synced EntityList id to its entry.
  - Modded entries are named by their **full registry name** (`pyrotech:rock`), with `registryName` and `forge: { modded: true, propertiesKnown }`.
- **Block states** are `id << 4 | meta`, so `blocksByStateId` holds 16 states per block. `bot.blockAt()`, `Block.fromStateId()` and `new Item(id)` therefore return modded names.
- **Defaults without rotn-data's properties:**
  - A block is a solid full cube (`boundingBox: 'block'`, so the bot never falls through a modded floor), diggable, with a conservative hardness of 1.5 (stone's), so `digTime` is finite and above 0, and no drops.
  - An item stacks to 64. An entity is a `mob`. A biome is a neutral overworld biome.
- **Properties.** `extendRegistry(registry, snapshot, { properties: { blocks: { 'pyrotech:rock': {...} } } })` fills in or overrides fields, keyed by full registry name; vanilla names use `minecraft:stone`. rotn-data's dump (ADR 0004) is meant to feed this. Properties cannot rename an entry.
- **Properties after the extension** (rotn-data's request 2). `applyProperties(registry, properties)` applies rotn-data's properties to an already-extended `bot.registry`, keyed by full registry name, so `harvestTools` can use its item ids. It builds one old-to-new map per kind and swaps in a single pass over every map that can hold an entry (id map, array, all `*ByName` keys including aliases, `blocksByStateId`, `entitiesByForgeId`, and the collision-shape table when shapes change). It returns `{ applied, missing }`.
  - Properties never change `id`, `name`, `registryName`, `forge`, `minStateId`, `maxStateId` or `defaultState`; those keys are stripped. Properties under two names of one entry merge.
  - It **refuses a registry `extendRegistry` never touched**, whose maps would still be minecraft-data's process-wide objects.
- **Mindcraft's name helpers** (rotn-data's request 4). `initBot` sets `mcdata.js`'s `mcdata` to `bot.registry` at login, and again after the extension. `getBlockId`, `getItemName` and the rest therefore know the server's modded names; vanilla names are unchanged.
- **Isolation.** Dummied entries are skipped. Only `bot.registry`'s own maps and its `blockCollisionShapes` are replaced; prismarine-registry copies minecraft-data only shallowly, so the maps are copied first. The process-wide `minecraft-data` object stays vanilla.
- **Shapes.** Each modded block is registered in the copied collision-shape table, so a Block class made later keeps its shapes (prismarine-block resets shapes by name).
- **Not covered:** FML EntitySpawn uses the mod-local entity table (`modId` + `modEntityTypeId`), not `minecraft:entities`; that is brief item 6.

## Forge's two-pass block-state ids (G2 batch 4)

On a Forge 1.12 server, a block state's network id is not always `id << 4 | getMetaFromState(state)`. This was found in G2 batch 4: the bot read the upper half of every double plant as `minecraft:double_plant 11`, but the server's `testforblock` said 10. Offline decoding of that batch's capture showed the server really sends 11 (state 2811 in chunk (-3,-4)).

**Why.** Forge 14.23.5.2860's `GameData$BlockCallbacks.onAdd` (checked with `javap` on the pinned pack's Forge jar) fills `Block.BLOCK_STATE_IDS` in two passes, and the last put wins:

1. Every valid state gets `id << 4 | getMetaFromState(state)`.
2. For each meta `m` that pass 1 used (Observers excepted), `getStateFromMeta(m)` gets `id << 4 | m` again.

So a state that `getStateFromMeta` returns for several metas ends up with the highest of them.

- **Double plants.** Vanilla `BlockDoublePlant.getStateFromMeta(8..11)` ignores the facing bits and returns the default upper half (SUNFLOWER, NORTH) for all four. That is exactly the state world generation places (`placeAt`), so every generated upper half is sent as meta **11**. Its `getMetaFromState`, which `testforblock` reports, is **10**.
- **A real Forge client** resolves 2811 with `BLOCK_STATE_IDS.getByValue` to that same state, so it sees meta 10.
- **Lossy.** An upper half facing EAST with another variant is also sent as 11. World generation never places one.
- **Unaffected.** Doors (upper 8-11 hinge/powered, lower facing/open), beds (foot 0-3, head 8-15) and `minecraft:tallgrass` (0-2) all round-trip, so their network meta is the server's meta. The two-block tall grass and large fern are `double_plant` variants, so they have the upper-half issue too.

**What the bot does.** It reports the meta a real Forge client would see:
- **The table.** rotn-data's dumper (0.2.0, `state-meta-remap.json`) records the metas where the two differ. Its catalog's `stateMetaRemap().byBlock` is keyed by registry name and maps network meta → client meta: `{ "minecraft:double_plant": { "8": 10, "9": 10, "11": 10 } }`.
- **The map.** After `extendRegistry`, `initBot` calls `attachStateIdRemap(bot.registry, { blocks: loadRotnData(PACK_VERSION).stateMetaRemap().byBlock })` (`src/state-remap.js`). That sets `bot.registry.stateIdRemap`, a `Map` from network state id to client state id, built with the server's synced block ids.
  - **The table is taken literally.** Network meta `m` is client meta `table[m]`, so the map is a pure function, applied exactly once at decode time.
    - Chains and cycles therefore need no special handling. The real 3.3.4 table has permutations, such as `pyrotech:worktable` and `worktable_stone` `0 → 1, 1 → 2, 2 → 0`; 125 of its 506 entries, in 39 blocks, have a target that is itself a source. All of them apply.
    - (Before G2 batch 5's fix, these were wrongly dropped as cycles.)
  - **Only true conflicts are skipped:** one network id given two different client ids. That can happen only when two table names resolve to one synced block (an alias). Such an id is left unmapped and logged.
  - Unknown blocks and bad entries are skipped and logged.
- **Applied once, at decode time only.**
  - `patches/prismarine-chunk+1.41.0.patch` applies the map in `ChunkColumn.load`, to section palettes and global-palette data, treating its input as network data.
  - `patches/mineflayer+4.33.0.patch` applies it in the `block_change` and `multi_block_change` handlers, before `updateBlockState`.
  - **Local writes are never remapped.** `ChunkColumn.setBlockStateId`, `setBlock`, `setBlockType` and `setBlockData`, digging's `_updateBlockState`, the `update_sign` handler's `setBlock` and pathfinder's predictive writes all hold client ids already. Remapping them would apply a cycle twice.
  - `blockAt`, `findBlocks` (which checks palettes first), `blockUpdate` events, `stateId`, `name` and `metadata` therefore all agree, and so do Mindcraft's `world.js` helpers, which read through them.
  - A section palette that held both 2810 and 2811 then holds 2810 twice. That is harmless: reads index the palette, and `setBlock`'s `indexOf` takes the first.
- **Local view only.** A remapped state id (2810) **must never be sent back to the server**, whose own id for that state is 2811. 1.12 clients send positions and items, not block state ids, and nothing in forge-bridge sends one. Any future code that does must send the network id.
- **Too wide (global palette).** A target that does not fit the section's bits per block is left as sent. It is counted in `bot.registry.stateIdRemap.skippedTooWide` (a property on the live `Map`, which grows as chunks load; it is not in the `bot.forge.stateIdRemap` report, which is a snapshot taken at login), and the first one per map is logged with `console.warn`. A same-block target always fits (`2 ** bits` is a multiple of 16), so only a hand-built map that crosses blocks can hit this.
- **Known gap: other server data with block states bypasses the map.** Only chunk data, `block_change` and `multi_block_change` are remapped. Anything else the server sends that names a block state is used as sent. Examples: falling-block `spawn_entity` object data, `world_event` 2001 (block break) data, block particle arguments, and mod plugin-channel payloads. Stock mineflayer reads none of them as block states today. Vanilla 1.12 builds the first three with `Block.getStateId` (`id + (meta << 12)`, meta from `getMetaFromState`), so they may not need the map at all, but this has not been checked with `javap`. Code that starts reading them must check before it relies on them.
- **No table** (a dump made before dumper 0.2.0), or a block not in it: state ids are used as sent.
- **Report.** `bot.forge.stateIdRemap` holds `{ tableBlocks, blocks, unknownBlocks, invalid, conflicts, size }`, built once at login. The too-wide count is not in it; read `bot.registry.stateIdRemap.skippedTooWide`.
- **Login line.** At login on a Forge connection, `initBot` logs one line with the counts: `state-id remap active: applied 3 state ids in 1 of the table's 1 blocks; conflicts 0 skipped`, or `state-id remap inactive: <reason>`.

## FML EntitySpawn into `bot.entities` (brief item 6)

Forge spawns most mod entities with an FML message (`FML` channel, disc 2), not a vanilla spawn packet, so stock mineflayer never sees them. `initBot` calls `attachFmlEntities(bot, bridge, { modEntityTable })` (`src/fml-entities.js`), with the table from rotn-data (below):

- **Spawn.** Each decoded EntitySpawn becomes a mineflayer entity in `bot.entities[entityId]`, as mineflayer's `spawn_entity_living` would make it: uuid, position, yaw, pitch, headYaw, velocity (thrown entities), and metadata by key. Then `entitySpawn` is emitted.
- **Tracking.** Later vanilla packets for that entity id (moves, teleports, metadata, `entity_destroy`) go through mineflayer's own `fetchEntity`, so it is tracked and removed like any other entity.
- **Name.** The message has the mod id and a *mod-local* type id (`EntityRegistry.registerModEntity`'s id), which RegistryData does not map.
  - With rotn-data's table (`{ [modId]: { [modEntityTypeId]: 'modid:name' } }`, passed as `modEntityTable`), the entity gets its registry name, and `displayName`, size and category come from `bot.registry.entitiesByName` (PR #25).
  - **From rotn-data.** `initBot` builds the table with `fmlEntityTable({ modEntityTable, entityByModId })`, from rotn-data's catalog API (never its files). Each entry is `{ name, displayName }`; a living entity (`kinds` has `living`) also gets `type` and `category` from rotn-data's `hostile`: `hostile` / `Hostile mobs`, or `passive` / `Passive mobs`. These are the 1.13+ types Mindcraft's `isHostile` tells apart; `mob` would make every animal hostile. A non-living entity gets no type (rule below).
  - **Placeholder.** An id the dump lacks (or no table, if rotn-data fails to load) gives `<modId>:entity_<n>`, with `entity.forge.nameKnown: false`.
  - A table value can also be an object, `{ name, displayName?, type?, category?, width?, height? }`. **The table must supply `type` explicitly** for an entity to be a `mob` (or anything else): `category` alone only sets `entity.kind`.
- **Type.** It is never `mob` by default, because Mindcraft's `isHostile` treats every `mob` as hostile, and FML also spawns projectiles, vehicles and decorations. It is the table's `type` when given, else `projectile` for a thrown entity (`throwerId != 0`), else `other`. Hostility belongs to rotn-data's table and skills-rotn.
- **Size.** `width` and `height` come from the table, or from `bot.registry` when rotn-data's properties are in. Without them they are prismarine-entity's defaults, **0 × 0**, which pvp aim and collision checks should treat as unknown.
- **Debug info.** `entity.forge` has `{ modId, modEntityTypeId, nameKnown, throwerId, metadataError }`.
- **Safety.** A message that cannot be applied is logged and leaves no half-made entity behind.

## Mod entity-metadata serializers

Vanilla 1.12 defines entity-metadata serializer ids 0-13. A protodef switch cannot skip an unknown type, so a packet using one is dropped as a PartialReadError (G1: a player's AquaAcrobatics pose, key 17). `reid.js` adds the mod ones to `entityMetadataItem`, for nmp's protocol and for the FML EntitySpawn reader alike:

- **Formats.** `METADATA_SERIALIZER_TYPES` holds each mod serializer's wire format. Each one comes from `javap` on the `write()` and `read()` of the class that rotn-data's dump names for it (`METADATA_SERIALIZER_CLASSES`), in the pinned pack:

  | Id | Serializer | Class (dump) | Wire format |
  | --- | --- | --- | --- |
  | 14 | `aquaacrobatics:pose` | `PoseSerializer$1` | VarInt enum |
  | 15 | `base:resource_location` | `ResourceLocationDataSerializer` | two strings (namespace, path) |
  | 16 | `mowziesmobs:optional_trade` | `ServerProxy$1` | slot; then, unless empty, a slot and an int |
  | 17 | `charset:quaternion` | `DataSerializersCharset$1` | four floats, **w, x, y, z** |
  | 18 | `requious:spark_effect` | `ExtraSerializers$1` | int (enum ordinal) |
  | 256 | `doggytalents:talent_level_list` | `TalentListSerializer` | an int count of (string, byte) |
  | 257 | `doggytalents:optional_text_component` | `OptionalTextComponentSerializer` | an optional string |

- **Ids.** Mods that call vanilla `DataSerializers.registerSerializer` get ids 14, 15, ... in call order. Forge-registry serializers start at 256 and are synced by name.
- **From the dump.** `initBot` passes `metadataSerializersFromDump(loadRotnData(PACK_VERSION).serializers()).map` as the bridge option `metadataSerializers`. That covers every id above. A mod class with no known format is logged, and if rotn-data fails to load, the bridge falls back to the defaults.
- **Defaults** (`rotnMetadataSerializers(modList)`), the ids the bridge assumes without the dump:
  - 14 = `aquaacrobatics:pose`, **confirmed by rotn-data's dump**. G1 had inferred it by fit. Its player packet has a one-byte value under type 14 that ends exactly at the next key; only the VarInt among the five candidates fits.
  - 256 and 257 = the DoggyTalents pair (Batch A's synced registry).
  - Ids 15-18 are vanilla-registry ids in mod call order, so they come only from the dump.
- **Check.** The protocol is compiled before RegistryData arrives. So after it, the bridge compares the >= 256 ids with the synced `minecraft:dataserializers` and logs (and captures) any mismatch.

## Movement guard (G2 batch 7)

In G2 batch 7, the server kicked the items session about 2 s after join with `multiplayer.disconnect.invalid_player_movement`. Forge 1.12.2's `NetHandlerPlayServer.processPlayer` sends that for a client movement packet with a non-finite x, y, z, yaw or pitch, or with |x|, |y| or |z| above 3.0E7. `vehicle_move` gets the same check (`invalid_vehicle_movement`). Rotation range is not checked.

- **The failure mode** (reproduced offline). mineflayer sends `bot.entity` as it is. One non-finite input into the bot's own motion, such as a NaN explosion knockback, makes it send `position x NaN`. After that the state stays poisoned, and physics stops ticking because `blockAt(NaN)` is null.
- **The trigger in batch 7 is not known.** That capture recorded neither the server's movement inputs nor the bot's movement packets. The one difference from the control session is that the server set the bot's on-fire flag 10 ms before the kick.
- **`src/movement-guard.js`.** `initBot` attaches it on every connection, under the movement throttle, so merged packets are checked too. It works in four layers:
  1. **Inputs.** These are fixed before mineflayer's handlers see the packet:
     - A server `position` packet with a non-finite field keeps the current value (relative 0).
     - The bot's own `entity_teleport` (doubles on 1.12; mineflayer sets the bot's position from it) keeps the current value for a non-finite or out-of-range coordinate.
     - A non-finite explosion knockback is used as 0.
     - Velocity, relative moves and angles are integers or bytes on the wire, so they are only traced.
  2. **State.** Every physics tick, and every 250 ms while physics is stalled, a non-finite or out-of-range position, velocity, yaw or pitch is restored.
     - The source is the last good state, recorded only after the server has placed the bot (mineflayer's first `forcedMove`), so prismarine-entity's (0, 0, 0) placeholder is never used.
     - Before there is a good state, the source is the server's last absolute position (`position` with no relative x/y/z flags, or the bot's own `entity_teleport`).
     - With neither, the position is left as it is. Movement packets are held back (dropped, logged once as "no good position yet") until the server sends an absolute position. mineflayer sends no movement before the first `position` packet anyway.
  3. **Wire.** A movement packet the server would kick for is never written. It is dropped, the state is repaired, and the next tick sends a good packet.
  4. **Trace.** A ring of the last 80 movement inputs and outputs: server `position`, `explosion`, the bot's own velocity, teleports, mounts and on-fire flag, `update_health`, `abilities`, and every movement packet the bot sends. It is written once to the capture as a `movement_trace` event, at the first guard event or at a movement kick.
- **Logging.** Each kind of event is logged once (`[forge-bridge] movement guard: ...`). Counts are in `bot.forge.movementGuard`: `{ droppedPackets, repairedStates, sanitizedInputs, movementKicks, first }`.
- **If it fires on the test server**, the driver log has the line, and the capture's `movement_trace` names the input that caused it.

## Other protocol changes

- **Triumph advancements (G1 Batch B+C).** Triumph 3.19.2 (mod id `triumph`) writes `ExtendedDisplayInfo` into `play.advancements`. Flag bit 8 is set, and colours, line options, extra connections and a position are appended (`javap`, details in `reid.js` `triumphTypes`). minecraft-data's vanilla layout fails on it, and the parse error ended the packet stream.
  - When the ModList has `triumph`, `advancements` is kept as an **opaque buffer** (`{ data: restBuffer }`); the bot never needs it.
  - `triumphTypes()` is kept as an offline decoder. It reads both real packets to the last byte, but it is not used on the wire.
- **Parse safety net.** A non-partial parse error makes protodef end nmp's packet stream: nothing arrives afterwards, and the keep-alive times out.
  - For a short allowlist of cosmetic clientbound packets (`DROPPABLE_ON_PARSE_ERROR` in `bridge.js`), the error is logged and captured with the full packet bytes, and the packet is dropped (`bridge.stats.droppedPackets`). The stream continues.
  - The allowlist is `advancements`, `select_advancement_tab`, `statistics`, `unlock_recipes`, `craft_recipe_response`, `boss_bar`, `playerlist_header`, `sound_effect` and `named_sound_effect`. `world_particles` and `title` are left out on purpose: mineflayer's fishing waits for particles, and RotN may announce invasions in titles.
  - Each drop is logged with "(dropped, allowlisted)". The first drop of each packet name emits a `droppedPacket` event (`{state, name, message}`) on the bridge.
  - A **PartialReadError** (a read past the packet's end) is different: protodef itself drops that packet, for any packet including essential ones, and never ends the stream. That is upstream behaviour, not this safety net. The bridge logs it with "(dropped by protodef)", counts it in `stats.partialReadErrors`, captures its bytes and emits `parseError`, so a lost essential packet is visible.
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

- `tools/chunk-section-fixture.mjs <capture.jsonl> <chunkX> <chunkZ> <sectionY>`: cuts one chunk section out of a capture's `map_chunk` as a test fixture. It keeps only that section's bytes (block states and light): no biomes, no block entities, nothing else from the capture. Captures stay in `captures/raw/` and are never committed.
- `tools/g1-driver.mjs`: the G1 **gate** driver for harness-ops' runner (`test/runner/DRIVER.md`). It is Mindcraft's real `initBot` with forge-bridge on, plus the runner's scenario protocol (`attachScenario`: hello once, echo the whispered token, walk on request, stay until SIGTERM). The runner decides pass or fail from the server log.
  - It needs `MINDCRAFT_PROFILES_FOLDER` and never starts a device-code login: `initBot(name, { onMsaCode })` makes a stale cache exit 3.
  - Kicks: exit 3 when the runner's `FATAL_KICKS` or forge-bridge's `classifyKick` says fatal, otherwise 1. SIGTERM exits 0.
  - **Before join** (`tools/driver-exit.mjs`): never 0.
    - A login that fails before the bot joins (G2 batch 2's auth failure, which nmp reports only as an `error`) exits at once, with no `end` needed.
    - **Exit code by HTTP status:** the error's own status, or for nmp's "Failed to obtain profile data" the one the profile-fetch diagnostics captured.
      - 401 and 403 (the profile fetch or Xbox) and 404 (does not own Minecraft) exit **3**.
      - So does a permanent XSTS XErr (`PERMANENT_XSTS_XERRS`, prismarine-auth's own `xboxLiveErrors` table: no Xbox profile 2148916233, ban, child account, terms, region, proof of age, playtime, under 18). The patched prismarine-auth attaches it as `err.xerr`.
      - Network errors, timeouts, 5xx, other statuses and other XErrs exit **1**.
    - An event loop that drains without a stop also exits 1.
    - Before join the `error` event never has the message: it has `phase: before_join`, `errorClass`, `code` (for example `ECONNREFUSED`), `status`, `statusSource` and `kind`. The same goes for unhandled rejections.
    - The `end` event carries `joined` and `beforeJoin`, and setup `fatal` events carry `beforeJoin: true`, so the runner can tell "exited before join".
  - Switches: `ROTN_DRIVER_AUTH` (`offline` for loopback tests only), `ROTN_DRIVER_FORGE_BRIDGE` (default `on`), `ROTN_DRIVER_CAPTURE` (default `1`, `captures/raw/`), `ROTN_DRIVER_MODLIST_FILE`.
  - **G2:** it also answers the G2 protocol (`scenario-blocks`, `-blockat`, `-entities`, `-items`) through `attachG2` with `loadAgentNames`, the agent's own naming path. Names come from `bot.registry` as forge-bridge extends it, and translation from `src/utils/mcdata.js` `toNew`/`toOld`. It logs a `g2_adapter` event: its `source` is the mcdata.js module, or `fallback` (stock names, no translation) when mcdata.js cannot be imported. `ROTN_DRIVER_CHUNK_WAIT_MS` sets how long the census waits for the cube's chunks (scenario-protocol's default, 30 s, when unset). The effective value is logged in `g2_adapter` as `chunkWaitMs`, with `chunkWaitSource`. harness-ops' reference driver uses stock mineflayer, which a Forge server rejects at the handshake, so this is the driver for real G2 runs.
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
- `state-remap.test.js`: Forge's two-pass state ids, with mineflayer's real blocks plugin on a fake bot. Inputs:
  - the real section (-3,-4) y 64-79 from G2 batch 4's capture (`test/fixtures/rotn-3.3.4/chunk-m3-m4-section4.json`; that section's block states and light only, cut with `tools/chunk-section-fixture.mjs`);
  - the table from rotn-data's real catalog API (`stateMetaRemap().byBlock`) over its mini-dump fixture.

  What it checks:
  - Batch 4's three upper halves read as `double_plant` meta 11 without the table. With it they read as 10 in `blockAt`, `stateId`, `blocksByStateId`, the palette and `findBlocks`.
  - The 17 upper halves are the only blocks in the section that change. Lower halves are unchanged.
  - `block_change` and `multi_block_change` go through the table, including in a global-palette section. Doors, beds, tall grass and other blocks' meta 8-11 are unchanged.
  - Table building takes chains and cycles literally. A true conflict (an alias with another target) is skipped and logged. Every entry of rotn-data's real 3.3.4 table applies, with no conflicts.
  - **`pyrotech:worktable` (`0 → 1, 1 → 2, 2 → 0`):** network metas read as client metas 1, 2, 0 through chunk load, `block_change` and `multi_block_change`.
    - The same network data sent again gives the same result. This is a consistency check only: chunk load and `block_change` decode fresh bytes, so it cannot catch a double remap. The local-write check below is the real test.
    - The local write paths (digging's `_updateBlockState`, `update_sign`'s `setBlock`, `setBlockType`, `setBlockData`, pathfinder's `setBlockStateId`) leave a client id unchanged. This is checked after each write, because three stray remaps of a 3-cycle would hide the bug.
    - Against develop's prismarine-chunk patch (remap in `setBlockStateId`) or mineflayer patch (no remap in `block_change`), 2 tests fail each.
  - A global-palette target too wide for the section is left as sent, counted in `bot.registry.stateIdRemap.skippedTooWide` and logged once.
  - **Two servers, one table:** two registries sync the same block name at different ids (#82's Quark flowerpots, 1203 and 1263). Each built map, and each chunk, uses only its own server's ids.
  - The 4 chunk-path tests fail with the previous patch.
- `agent-process.test.js`: `agent_process.js` with a fake spawn, timers and exit. It covers the ADR 0003 table, the backoff and its reset, the exit-reason file (a fatal kick reported with exit 1, auth capped at 3 and reset after 10 min), requested restarts and their loop guard, single-bot stops and clean exits, `forceRestart`, a stop cancelling a pending restart, a child exiting with a code after `stop()`, the task codes, and the private reason-file folder.
- `registry-extension.test.js`: the extension against the real prismarine-registry, prismarine-block and prismarine-item for 1.12.2. It covers modded names, 16 states and the solid default, items, entities and biomes, an untouched shared minecraft-data, dummied and rebound entries, properties, and Block classes made before and after the extension. `e2e-initbot.test.js` checks the same through `initBot`: `blockAt` gives `pyrotech:rock`, and the inventory gives `pyrotech:crude_axe`.
- `fml-entities.test.js`: an FML-spawned entity, resolved through a mod-local table (string or object) and through the placeholder; with rotn-data's real table, `iceandfire:firedragon` (passive), `aether_legacy:cockatrice` (hostile), a thrown `iceandfire:dragonarrow`, and every modded mob in `common-mobs.json`.
  - It covers registry data, type (`other`, `projectile`, or the table's, checked with Mindcraft's real `isHostile`), size, angles, velocity and thrower, metadata, entity reuse, and failure cleanup.
  - A spawn whose metadata uses AquaAcrobatics' unknown serializer 14 (`entity-metadata-aqua-pose.json`) is applied with `forge.metadataError`.
  - `e2e-initbot` checks through `initBot` that the fake server's FML spawn reaches `bot.entities` as `other`, that vanilla `entity_teleport` and `rel_entity_move` update it, and that `entity_destroy` removes it.
- `exit-contract.test.js`: the agent side (`recordAgentExit`): kicks with and without a bridge, `cleanKill` before and after a kick, startup errors, and no reason file.
- `prismarine-auth-patch.test.js`: the real patched methods, with stubbed fetch, caches and MSAL, and fake tokens. Each reduced output is checked exactly and has nothing token-like. All 7 tests fail against stock 3.1.1.
- `auth-diagnostics.test.js`: the real `fetchProfile` with a stubbed fetch (429, a network error, a 2xx with `error`). The line has the status and class, and nothing token-like, no body text and no address; the error is rethrown unchanged.
- `driver-exit.test.js`: the exit decision and the logging before join.
  - One case per class: Xbox 401 and 403, profile 401 and 404 exit 3; 5xx, 429, network, timeout and connect refused exit 1.
  - A body with an `eyJ…` value never reaches the output from either handler.
  - The real driver, with prismarine-auth failing offline through `test/fake-auth-failure.mjs`: no fake token, body or address in stdout or stderr, plus the right exit code. An auth-guard refusal exits 3.
- `auth-guard.test.js` and `initbot-auth.test.js`: the default `onMsaCode` never prints a fake code or message; the `DEBUG` matching rules; each `initBot` refusal; and `auth: "offline"` without a folder still starts.
- `movement-guard.test.js`: mineflayer's real plugins, physics included, on a fake 1.12.2 client, wired as `initBot` wires them. Without the guard, a NaN explosion knockback makes mineflayer send `position x NaN`. With it, the knockback is used as 0. A server position, or the bot's own `entity_teleport`, with a non-finite field keeps the current value. A poisoned state (NaN velocity, an Infinity or 4E7 coordinate, NaN pitch) is repaired, and nothing bad is sent. After each recovery the bot walks again: more than 0.5 blocks, with good movement packets. Before any good state, the repair uses the server's absolute position, never (0, 0, 0). With none, packets are held back until one arrives. A bad packet is dropped, and each kind is logged once. A movement kick writes the trace once. `e2e-initbot.test.js` repeats the explosion case through the real `initBot`. The server never receives a non-finite position. The bot then walks more than 1.5 blocks, and the server sees it. The capture has the `movement_trace`.
- Capture redaction and limits, kick classification and the restart policy, the movement throttle, the token-folder checks, and the connect and env logic.
- `g1-driver.test.js`: the driver as a subprocess against the fake Forge server, with the runner's allowlisted environment: hello exactly once, echo, a 3-block walk, a clean stop, a redacted capture, exit 3 without a token-cache folder or host, and exit 1 with `beforeJoin` when the connect is refused.
- `e2e-initbot.test.js`: Mindcraft's real `initBot` against an in-process fake Forge server on 127.0.0.1. The run covers the status ping, tagHost, the handshake, Join Game, a REID chunk, inventory and effects, chat both ways, walking, and the capture. The state-id remap is tested through `initBot` with rotn-data's real `stateMetaRemap()` over its mini-dump fixture, because the 3.3.4 dump has no table yet. A renamed method or field therefore fails this test.
  - The fake server also syncs `minecraft:double_plant` and sends G2 batch 4's real section and a `block_change`.
  - Upper halves read as meta 10 through both the chunk-load and the block-update paths.
  - The login line says `active`.

## Known limits (next brief items)

- **nmp protocol cache and shared protocol object.** One bot per process, which is how Mindcraft runs, is fine. Two effects follow from nmp 1.x internals:
  - nmp caches compiled protocols by state, direction and version only, not by `customPackets`. The first play-state client for 1.12.2 in a process fixes the overrides for that process.
  - nmp's `createProtocol` calls lodash `merge(mcData.protocol, customPackets['1.12'])`. That **mutates the shared `minecraft-data` 1.12.2 protocol object in place**, and every `require('minecraft-data')('1.12.2')` in the process returns that same object. After the first Forge connection, `bot.registry.protocol` and any later vanilla or non-REID 1.12.2 client in the same process see the Forge and REID types. A process that needs both must run them in separate processes.
- **Registry properties.** Modded blocks, items, entities and biomes have names but default properties (below) until rotn-data's dump supplies them through `extendRegistry(..., { properties })`. Until then, for example, a modded plant is solid to the bot, and a modded block's hardness and drops are unknown.
- **FML EntitySpawn names.** Mod mobs spawned with FML EntitySpawn go into `bot.entities` (below), named from rotn-data's mod-local entity table. Their size is still 0 × 0 until rotn-data's properties supply it.
- **Chunk bit widths.** Handled by `patches/prismarine-chunk+1.41.0.patch`:
  - Reads: a global-palette section is read at the width the packet states.
  - Writes: mineflayer applies `block_change` and `multi_block_change` locally. A section widens its data array whenever a state id needs more bits, and a section that leaves its palette uses at least the width of its widest id, so wide ids are never cut to 13 bits.
  - `new Chunk({ maxBitsPerBlock })` can seed a wider starting width. mineflayer does not pass it yet, which is fine because sections widen on write.
- **`ChunkColumn.dump()`** writes biomes back as REID VarInts when they were read that way, or when an id is over 255. Readers of dumps, such as prismarine-viewer or a world saver, therefore get the real biome ids. The viewer stays off anyway (`render_bot_view: false` in `settings.js`) until it is tested against RotN chunks.
- **Book channels.** mineflayer's `MC|BEdit`/`MC|BSign` plugin channels still use the vanilla `slot` type. That only matters for writing books.
