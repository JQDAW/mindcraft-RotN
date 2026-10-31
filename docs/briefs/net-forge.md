# Brief: net-forge

You make a mineflayer bot join a Forge 1.12.2 server running RotN 3.3.2 in online mode, and see the modded world at the protocol level. This is the highest-risk work in the project, and it gates everything else (G1).

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
