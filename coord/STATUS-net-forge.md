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
     - `packages/forge-bridge/test/bridge.test.js` covers each path.
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
- **6:** `packages/forge-bridge/test/golden.test.js` holds hand-written hex vectors for ModList, RegistryData (1-, 2- and 3-byte VarInt ids), FML EntitySpawn (metadata, thrower velocity, spawn data) and FML|MP (PART_SIZE 1048496, 2 parts). The layouts come from `javap` on Forge 14.23.5.2860's own classes in the pinned pack's Forge jar, extracted to scratch and never run. Our decoders read each vector, and our encoders reproduce it byte for byte.
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
- **Test:** `packages/forge-bridge/test/g1-driver.test.js` runs the driver as a subprocess against the fake Forge server, with the runner's allowlisted env.
- The shared fake world moved to `test/fake-world.js`.
- `npm test` passes 178/178; lint 259.

## Done: initBot auth guard and PR #15 nits (branch `agent/net-forge/initbot-auth-guard`, from develop 74b23ed)

- `initBot` throws when `auth` is `microsoft` and `MINDCRAFT_PROFILES_FOLDER` is unset, so it never falls back to nmp's shared default cache. The default `onMsaCode` logs only `device-code login needed, see coord/NEEDS-HUMAN.md` and never the code; a caller can supply its own.
- `msa-login`: the git-tree check also runs on the realpath (junctions, symlinks).
- `g1-driver`: `walkMethod` comes from the scenario (its `method`, else `scenario-protocol walk()`).
- Capture `maxFileBytes` is checked in UTF-8 bytes.
- `npm test` passes 193/193; lint 259.
- **PR #16 review (REQUEST CHANGES) fixed on the same branch:**
  - The default `onMsaCode` is now `quietMsaCodeHandler` in `src/auth-guard.js`. A test feeds it a fake `{user_code, message, ...}` and checks that none of it appears in the output.
  - `initBot` refuses Microsoft auth when `DEBUG` enables `prismarine-auth` (debug-package matching, plus the live `debug` state).
  - `initBot` runs the read-only git-work-tree check (given and real path) on `MINDCRAFT_PROFILES_FOLDER`.
  - New test: offline auth without a folder still starts.
  - The README now says the bot keeps polling until the code expires (about 15 min).
  - `npm test` passes 200/200; lint 259.

## Done: stricter DEBUG guard (branch `agent/net-forge/debug-guard-strict`, from develop 506301d; PR #16 merged)

- Lead decision: refuse when any enabled `DEBUG` pattern starts with `prismarine-auth` (for example `prismarine-auth:*`) or is a glob that could reach such a name. Only a plain prefix skip (`-prismarine-auth*`, `-prismarine*`, `-*`) clears it; `*,-prismarine-auth` is now refused.
- The live `debug` instance is checked under the same rule.
- Tests: the table now has sub-namespace and skip cases, plus a live-instance test with `debug.enable('prismarine-auth:*')`, where `debug.enabled('prismarine-auth')` is false.
- `npm test` passes 203/203; lint 259.

## Done: brief item 8, `agent_process.js` applies the exit-code contract (branch `agent/net-forge/agent-process-restart`, from develop a38e0e2; PR #18 merged)

- `decideAgentExit()` implements the ADR 0003 decision 5 table:
  - 1: restart in-process with backoff (forge-bridge `createRestartPolicy`).
  - 3: end the main process with 3, plus a line for the human.
  - 2 and 4: task codes, as upstream.
  - 0: end with 0 when `MINDCRAFT_SINGLE_BOT_SERVICE=1`; otherwise stay up.
  - A requested stop (SIGINT, SIGTERM, `stop()`) is never restarted, and `stop()` cancels a pending restart.
- New, optional exit-reason file. The agent may write `{category, exitCode, retryCap?}` to `MINDCRAFT_EXIT_REASON_FILE` before it exits. Then a fatal kick is fatal even with exit 1, and auth kicks become fatal at their cap of 3.
- `assertMicrosoftAuthSafe` errors carry `exitCode: 3`.
- **Behaviour change from upstream:** a quick crash (under 10 s) used to be left dead. It is now restarted with backoff, per the ADR. Fatal setup errors need exit 3 to stop that loop (request 9).
- **Tests:** `packages/forge-bridge/test/agent-process.test.js`, 9 tests with a fake spawn, timers and exit. `npm test` passes 212/212. Lint is 257: `agent_process.js` went from 2 errors to 0.

## Done: PR #19 review follow-ups (branch `agent/net-forge/exit-contract-followups`, from develop 976ea48; PR #19 merged)

- **Lead-approved ownership exception:** only the exit lines in `src/agent/agent.js`, plus `src/process/init_agent.js:52`.
  - Invalid name: exit 3.
  - `onDisconnect`: `process.exit(bot.forge.recordExit({event, reason}))`. It writes the reason file and exits with the kick's code.
  - Spawn-handler catch: exits 1, or 3 if fatal; never 0.
  - `cleanKill`: `requested_restart` while still connected. After a kick it reports the kick instead, so kicks keep the backoff.
  - `init_agent.js`: `process.exit(error?.exitCode === 3 ? 3 : 1)`.
- **The contract moved to forge-bridge** (`src/exit-contract.js`): `decideAgentExit`, `readExitReason`, `writeExitReason` and `recordAgentExit`. `initBot` adds `bot.forge.recordExit`.
- **`requested_restart`** restarts at once without touching the backoff. A guard falls back to the backoff after 5 requested restarts in 10 min (my addition, against login loops).
- **Single-bot service:** a requested stop ends the main process with 0. `forceRestart` is never a stop.
- **Findings 3-8:**
  - comment that "connected" is measured from spawn;
  - the reason file sits in a private mkdtemp folder;
  - multi-bot exit-3 orphaning documented;
  - new tests for `forceRestart`, the auth cap and the reset through `AgentProcess`, and stop-then-code;
  - `kicks.js` comment fixed;
  - STATUS test paths fixed.
- **Lint ratchet:** `test/lint-baseline.json` updated to 257 with `node test/tools/lint-baseline.mjs --update` (the same value as lead PR #20).
- `npm test` passes 224/224; the lint ratchet passes (257, baseline 257).

## Done: PR #23 review (REQUEST CHANGES) fixes, on the same branch

1. A `requested_restart` applies the 10-minute reset (`policy.noteSession`) but still adds nothing to the streak. Test: 2 auth kicks, a 5 h session ended by `!restart`, then 1 auth kick gives a 10 s restart, not fatal.
2. Single-bot service: `stop()` while a backoff restart is pending calls `exit(0)`.
3. `readExitReason` ignores files over 4 KB (or not a file), checked with `statSync` before reading.
4. (Nit) The mkdtemp folders are removed when the main process exits. The constructor no longer throws: without a folder, the contract runs on exit codes only.
5. (Nit) The `cleanKill` exit comment in `agent.js` is reworded.
6. New end-to-end test: a real child process classifies a ban and calls `recordAgentExit`, which writes the reason file; `AgentProcess` then calls `exit(3)` with "FATAL (banned)".
7. **Flaky loopback tests.** Under heavy load, a loopback connect on this Windows machine can fail at once with `ETIMEDOUT` (in about 300 ms).
   - forge-bridge: the status ping is now tried twice, 1 s apart. Its timeout is configurable (`FORGE_PING_TIMEOUT_MS`, and `ROTN_DRIVER_PING_TIMEOUT_MS` for the driver).
   - Tests: generous budgets. e2e-initbot gets the pinned mod-list fallback and one login retry. The g1-driver test restarts the driver once if it exits before hello. initbot-auth uses a local hang-up server and accepts a connect error to that port as proof of start.
   - **Load check:** 3 full `npm test` runs at once on this PC. All forge-bridge tests passed in all 3 runs, and the ping retry was used 3 times. Before the fixes the same check failed 2 tests per run.
- `npm test` (single run): 231/231. Lint ratchet: 257, unchanged.

## Done: status-ping budget (branch `agent/net-forge/ping-budget`, from develop e744e44; PR #23 merged)

- Lead's production item: the ping retry could take 15 + 1 + 15 = 31 s, over `spawn_timeout` (30 s). The status ping now has one total budget (`FORGE_PING_TIMEOUT_MS`, default 15 s).
  - Only a fast failure (under 3 s) is retried, once, 1 s later, and only with what is left of the budget. A ping that timed out goes straight to the mod-list file fallback.
  - Fake-clock tests show the total never exceeds the budget.
- `e2e-initbot` asserts `modListSource === 'ping'` again when the first login attempt succeeds. `file` is allowed only after a retried login.
- `npm test` passes 233/233; lint 257, unchanged.

## In review: brief item 4, `bot.registry` extension (PR #25, branch `agent/net-forge/registry-extension`, started from develop 1cbe6a8 after PR #24 merged)

- `extendRegistry(bot.registry, snapshot, {properties})` (`src/registry-extension.js`) runs in `initBot` after the last RegistryData. It covers blocks, items, entities and biomes; block states are `id << 4 | meta`.
  - Modded entries carry full registry names and safe defaults: a solid full cube, diggable, hardness `null`.
  - Vanilla names keep minecraft-data's objects; a moved vanilla id is rebound and dummied entries are skipped.
  - The shared minecraft-data object stays vanilla.
- **Contract for rotn-data:** feed properties keyed by full registry name (`minecraft:stone`, `pyrotech:rock`). Properties cannot rename an entry. See the README section "Registry extension".
- **Tests:** `registry-extension.test.js` (6, with the real prismarine-registry, prismarine-block and prismarine-item). `e2e-initbot` now checks that `blockAt` gives `pyrotech:rock` and that the inventory gives `pyrotech:crude_axe`.
- `npm test` passes 239/239; lint 257, unchanged.

## Batch A result (G1 spec Run A, handshake capture): PASS

The lead's GO was recorded at 15:35 UTC. The batch ran from a clean branch at origin/develop 2abdd3b (`agent/net-forge/g1-batch-a`), with the command exactly as planned, `MINDCRAFT_PROFILES_FOLDER` set, `DEBUG` unset, and a 30-minute TERM guard (`timeout 1800`).

- **Before:** `msa-login.mjs FRCFLD --check` printed `Signed in. Minecraft profile: FRCFLD`, and the test project was empty.
- **Preflight passed on its own:** "sweeper OK (via cadence): 3 dispatch runs on develop in the last 50 min, gaps 14.5, 15.2 min, newest 5.8 min ago". No `--skip-sweeper-check`.
- **Times (UTC):**

  | Event | Time |
  | --- | --- |
  | Command start | 15:36:19 |
  | Server created (CPX42, nbg1, TTL 2 h) | 15:36:30 |
  | Server ready | 15:39:34 |
  | Status ping: FML, 346 mods, jeid 2.2.2 | 15:39:36 |
  | Spike login, handshake done | 15:39:44 |
  | EXIT trap deleted server, Primary IPv4 and SSH key, verified gone | 15:40:14 |

  - Ran 224 s, against an expected ~20 min and a 30 min cap.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4), against the planned maximum of EUR 0.42 plus IPv4.
- **After (15:40:35 UTC):** `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` are all empty, and `deploy/test-server.sh list` shows nothing.
- **Handshake, against the real RotN 3.3.4 server:**
  - The client went START, HELLO, WAITINGSERVERDATA, WAITINGSERVERCOMPLETE, PENDINGCOMPLETE, COMPLETE, DONE in 1.1 s.
  - It sent REGISTER, ClientHello, ModList (346) and acks 2, 3, 4 and 5.
  - The server logged "Client attempting to join with 346 mods", "Server side modded connection established" and "FRCFLD ... logged in with entity id 793".
  - It then closed with "Handshake Complete review log file for details". That is `-Dfml.debugNetworkHandshake` by design, not a kick.
  - 0 parse errors, 0 partial reads, `lastKick` null, mod list from the live ping, `overrideDimension` 0.
- **Confirmed on the wire:**
  - Forge 14.23.5.2860 and REID (`jeid`) 2.2.2, from the server's ModList.
  - The live ModList has the same 346 entries as the pinned ping fixture.
  - 52 registries: `minecraft:blocks` 4896 (max id 4895), `items` 9710 (max id 13394), `entities` 971, `biomes` 175, `recipes` 10687. Every RegistryData was read to its last byte.
  - Vanilla block ids are unchanged (`minecraft:stone` = 1).
  - Also received: `FORGE` FluidIdMap (decoded), plus `OBFUSCATE|HS` (5 bytes) and `dimstack` (317 bytes) with no decoder. Run A closes right after them, so whether they need an answer shows only in Batch B.
- **Server-side note for Batch B:** right after login, JustEnoughDimensions' `ServerConnectionFromClientEvent` handler threw "DISPATCHER expects a NetworkDispatcher". It is not a kick, and it may come from the debug-flag connection; Batch B will show whether it also happens normally.
- **Not tested in Batch A:** chunks, slots, entity effects and `jeid` messages (Run A ends before play), and chat, walking and staying connected. Those are Batch B+C.
- **Raw files** stay in `captures/raw/g1-runA/` (capture, summary, registries, server logs, batch log) and are git-ignored.
- **Committed (sanitized):**
  - `packages/forge-bridge/test/fixtures/rotn-3.3.4/handshake-runA.json` (index, 7 KB) and `handshake-runA.bin.br` (all 67 payloads, brotli, 252 KB). No username, UUID or IP, and the SHA-256 is checked.
  - `test/real-handshake.test.js` replays the real server messages through `attachForgeBridge`: the bridge's replies are byte-identical to what it really sent.
- **Batch B+C:** waits for the lead's separate go-ahead.

## Batch B+C result (G1): FAIL, root cause found (Triumph advancements)

The lead's GO was recorded at 15:55 UTC. The batch ran from a clean branch at origin/develop 2abdd3b (`agent/net-forge/g1-batch-bc`), without PR #25, on one server: B = `g1-spike --minutes 11`, then C = `test/runner/run.mjs --scenario g1-login-chat-walk` with `g1-driver.mjs` and default parameters. It had a 55-minute TERM guard.

- **Before:** `msa-login --check` printed FRCFLD, and the project was empty.
- **Preflight:** passed on its own (cadence: 3 dispatch runs, gaps 15.2 and 14.7 min, newest 8 min old).
- **Times (UTC):**

  | Event | Time |
  | --- | --- |
  | Command start | 15:53:19 |
  | Server created (CPX42, nbg1, TTL 2 h) | 15:53:27 |
  | Server ready | 15:56:33 |
  | B start | 15:56:35 |
  | C start | 15:58:25 |
  | C end | 16:01:43 |
  | EXIT trap deleted everything, verified gone | 16:02:09 |

  - Up 522 s, against an expected ~35 min and a 55 min cap.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4).
- **After (16:02:36 UTC):** server, Primary IP and labelled SSH-key lists all empty.
- **C (gate evidence), `result.json`:** `gateValid: true`, `pass: false`.
  - PASS: `login_online` (online mode, v4 UUID) and `chat_send`.
  - FAIL: `chat_receive`, `walk` and `stay_10min`.
  - **B (spike):** handshake, spawn, outgoing chat and a local 19-block walk worked; incoming chat and the stay failed.
- **Root cause:**
  - The first `play.advancements` packet fails to parse (`unexpected tag end`), and a full parse error makes protodef end nmp's packet stream. No packet arrives after that, so the client keep-alive times out after 60 s and the bot quits. Everything else follows from this.
  - **Why it fails:** RotN's Triumph 3.19.2 `ExtendedDisplayInfo` (confirmed with `javap` on the pack jar in scratch, never run) sets display flag bit 8. It appends optional colours (4 optional ints), an optional boolean, 2 optional line colours, another optional boolean, a count-prefixed list of extra connection ids, and 2 optional positions. minecraft-data's vanilla layout lacks all of these.
  - A hand-written parser with the extension reads both captured packets (42 KB and 50 KB) to the last byte: 150 and 174 advancements, all extended.
- **Also checked on the wire:** REID's VarInt slot id holds for non-empty slots (`set_slot` with modded item 4924, count byte, damage, NBT end).
  - StackUp 0.2.5 (`javap`) writes counts over 64 as `0xD6` plus an int. None appeared, and I have not handled it yet.
  - The bot spawned on `dynamictrees:leaves1`, which develop still treats as empty (PR #25 makes modded blocks solid).
- **The lead's watch items:**
  - **Kicks:** none. Both sessions ended as `client-quit` after the keep-alive timeout.
  - **JustEnoughDimensions error:** 0 occurrences, so it was a Batch A debug-flag artifact.
  - **`OBFUSCATE|HS` (5 zero bytes) and `dimstack` (317 bytes, every login):** neither got an answer, and there was no kick in the 60 s each session lasted, so there is no sign either needs one. The re-run's 10-minute stay is the real check.
- **Evidence:** `test/evidence/g1/batch-bc-20261101/` holds the sanitized `result.json`, `server.log` and `driver.log`, plus a README (the lead-approved exception).
  - Fixture: `packages/forge-bridge/test/fixtures/rotn-3.3.4/advancements-triumph.{json,bin.br}`, the two real packets.
  - Raw files stay in `captures/raw/`.
- **Fix done (lead direction):**
  - With `triumph` in the ModList, `advancements` is an opaque buffer; `triumphTypes()` stays as an offline decoder.
  - Safety net: a parse error in an allowlisted cosmetic packet (advancements, statistics, unlock_recipes and others) is logged and captured in full, and the packet dropped; essential packets still fail loudly.
  - Tests replay the two real packets through nmp's real deserializer stream. `npm test` passes 258/258.
- **Next (superseded):**
  1. A fix PR: a Triumph-aware `advancements` type, gated on ModList `triumph`. Also an unparseable play packet should be dropped and counted rather than ending the stream, and parse-error captures should keep larger packets in full.
  2. Then PR #25's requested changes.
  3. A re-run of B+C needs a new GO.

## Batch B+C retry result (G1): **PASS**

The lead's GO was recorded at 17:05 UTC, after PR #28 merged. The batch ran from a clean branch at origin/develop 62ec6f1 (`agent/net-forge/g1-batch-bc2`), without PR #25, on one server: B = the 11-minute spike, then C = the runner's `g1-login-chat-walk` with `g1-driver.mjs` at default params. It had a 55-minute TERM guard.

- **Before:** `msa-login --check` printed FRCFLD, and the project was empty.
- **Preflight:** passed on its own (cadence: gaps 14.7 and 15.4 min, newest 9 min old).
- **Times (UTC):**

  | Event | Time |
  | --- | --- |
  | Command start | 17:09:50 |
  | Server created (CPX42, nbg1, TTL 2 h) | 17:09:58 |
  | Server ready | 17:12:42 |
  | B | 17:12:44 to 17:23:55 |
  | C | 17:23:55 to 17:34:24 |
  | EXIT trap deleted everything, verified gone | 17:34:44 |

  - Up 1486 s (24.8 min), against an expected ~35 min and a 55 min cap.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4).
- **After (17:35:19 UTC):** server, Primary IP and labelled SSH-key lists all empty.
- **C, `result.json`:** `pass: true`, `gateValid: true`, `weakenedParams: []`, verdict PASS, 5/5:
  - `login_online`: v4 UUID.
  - `chat_send`.
  - `chat_receive`: token echoed.
  - `walk`: 8.6 blocks, minimum 6.
  - `stay_10min`: 608 s, no disconnects.
- **B (spike):** every check passed: handshake, spawn, chat both ways, a 6-block pathfinder walk, and an 11-minute stay.
- **Advancements opaque:** yes. Triumph 3.19.2 was detected in both sessions, with no advancements parse error.
- **Safety net:** dropped nothing (`droppedPackets` `{}`, no "(dropped, allowlisted)" lines).
- **Kicks:** none (runner `kicks: []`). B ended with its own `disconnect.quitting`. The 17:34:22 "Internal Exception" disconnect is the teardown after `stay_10min` passed (SIGTERM on Windows).
- **`OBFUSCATE|HS` and `dimstack`:** no answer was needed, with no kick over 11 and 10 minutes. The JustEnoughDimensions error occurred 0 times.
- **New finding (not a blocker):** one `entity_metadata` PartialReadError per session (a player's, 77 and 78 bytes), dropped by protodef.
  - Key 17 uses serializer **type 14**, AquaAcrobatics 1.15.4's `PoseSerializer` (an enum as a VarInt ordinal), registered via vanilla `DataSerializers.registerSerializer` (`javap`).
  - base, Charset-Lib, Mowzie's Mobs and Requious Frakto also call that method, so ids from 15 up are unknown.
  - Fixture: `packages/forge-bridge/test/fixtures/rotn-3.3.4/entity-metadata-aqua-pose.json`. The follow-up needs the registration order.
- **Evidence:** `test/evidence/g1/batch-bc2-20261101/` holds the sanitized `result.json`, `server.log` and `driver.log`, plus a README.
  - Raw files stay in `captures/raw/` (`g1-runB2`, `g1-runC2`, `g1-runBC2`, and the driver capture).

## Doing

- Batch A done (above); PR #26 merged. PR #25 (registry extension) is being reworked for its review (vanilla entities, modded-block hardness, rebind logs), together with the PR #28 nits. **The next paid batch needs a new written GO.**

## Next

1. **G1 batches** (below), after the lead's written approval and a scheduled sweeper run within 120 min (PR #12).
2. Captured fixtures: real handshake, RegistryData, `window_items`/`set_slot`, chunks, `entity_effect`, `jeid`. Then the handshake test against real captured server messages; real Run A bytes become extra golden vectors.
3. Classify every kick seen, confirm chunk bits per block and the REID formats on the wire, and record walk blocks.
4. Brief item 6 (FML EntitySpawn into `bot.entities`). Item 8 is done (#19, #23). Item 4 is in review (#25).

## G1 batches (approved by the lead 2026-11-01 11:40 UTC in STATUS-rotn-lead.md; Batch A ran 15:36 UTC, PASS; Batch B+C ran 15:53 UTC, FAIL, see below)

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
8. ~~skills-rotn (`agent.js` exit lines).~~ Done by net-forge under the lead-approved exception (PR #19 follow-ups).
9. ~~Lead (`init_agent.js` exit 3).~~ Done by net-forge under the same exception.
11. **harness-ops (`test/unit/status-ping.test.js`):** under heavy load (3 `npm test` runs at once), "ping talks to a fake server and reassembles a large, chunked response" failed with an immediate `connect ETIMEDOUT 127.0.0.1:<port>` in 7 of the 9 loaded runs I did today (my changes do not touch that test). The same loopback symptom is fixed in forge-bridge's tests by retrying the connect once after 1 s.
10. **harness-ops (systemd unit `mindcraft-rotn@<bot>`):** set `Environment=MINDCRAFT_SINGLE_BOT_SERVICE=1`, so a clean agent stop ends the main process with 0, and `RestartPreventExitStatus=0 3` (ADR 0003).

## Open PRs

- Merged: #15, #16, #18, #19, #23, #24 and #26 (G1 Batch A: real handshake fixture and replay test).
- #25: brief item 4, `bot.registry` extension, on `agent/net-forge/registry-extension`. Being updated for its REQUEST CHANGES review, plus the PR #28 nits.
- #28: G1 Batch B+C FAIL evidence plus the fix (Triumph advancements opaque, parse safety net), on `agent/net-forge/g1-batch-bc`. APPROVE WITH NITS; develop merged in; CI green.
