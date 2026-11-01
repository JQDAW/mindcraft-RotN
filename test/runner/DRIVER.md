# Scenario driver contract

A **driver** is the bot under test in a harness scenario: any program that the runner starts with `node test/runner/run.mjs --scenario <id> -- <driver> [args...]`. The runner decides pass or fail from the **server's** log and console, never from what the driver says about itself. This contract is what a driver must do so that the checks can see it.

net-forge's G1 spike can satisfy it by importing `attachScenario` from `test/runner/drivers/scenario-protocol.mjs` and calling it on its own bot. `test/runner/drivers/mineflayer-reference.mjs` shows the whole thing with stock mineflayer.

## Inputs (environment)

The driver gets an **allowlisted** environment, not the runner's. The base system variables are `PATH`, `HOME`/`USERPROFILE`, `SYSTEMROOT`, `TEMP` and the like. On top of those it gets only the variables below, any `ROTN_SCENARIO_*` and `ROTN_DRIVER_*`, and the names given with `run.mjs --pass-env NAME`, for example `OPENROUTER_API_KEY` for a Mindcraft driver.

It **never** gets these, even with `--pass-env`:

- `TEST_SERVER_CTL`, which gives console access
- `TEST_SERVER_STATE_DIR` and `ROTN_TEST_*`, where the test server's root SSH key lives
- `HCLOUD_*`, `GH_*` and `GITHUB_*`

| Variable | Set by | Meaning |
| --- | --- | --- |
| `TEST_SERVER_HOST`, `TEST_SERVER_PORT` | `deploy/test-server.sh run` | The disposable test server. Never connect anywhere else. |
| `ROTN_SCENARIO_BOT` | runner (`--param bot=`) | The bot account's Minecraft name, `FRCFLD` by default. |
| `ROTN_SCENARIO_HELLO` | runner | A per-run nonce to say once, after spawning. |
| `ROTN_SCENARIO_RUN` | runner | The run id, for the driver's own logs. It is unrelated to the echo token. |
| `MINDCRAFT_PROFILES_FOLDER` | you (passed through) | The bot account's token cache folder, outside the repo. **Required** with Microsoft auth: without it, exit 3 rather than fall back to a shared default cache. The runner never reads it, and the driver must never print it. |

## Behaviour

1. Log in to `TEST_SERVER_HOST:TEST_SERVER_PORT` as `ROTN_SCENARIO_BOT`, in **online mode** with the bot's own Microsoft account. Never start an interactive device-code login in a scenario: if there is no token cache, exit with code 3.
2. Once spawned, say `ROTN_SCENARIO_HELLO` in chat, exactly once.
3. When a chat line contains `scenario-echo <TOKEN>`, say `echo <TOKEN>`. The runner whispers it from the console, and TOKEN is fresh random hex that the driver can only learn by hearing it.
4. When a chat line contains `scenario-walk <N>`, walk at least N blocks horizontally, then say `walked <x> <y> <z>`.
5. Stay connected until the runner sends SIGTERM, then quit and exit with 0.

Exit codes follow ADR 0003 decision 5: `0` clean stop, `1` transient (disconnect, timeout), `3` fatal (setup error, a kick classed `handshake`, `whitelist` or `banned`; see `FATAL_KICKS` in `lib/server-log.mjs`). Optional: print one `DRIVER {json}` line per event on stdout. The runner saves stdout and stderr as `driver.log`.

## What the runner checks (G1, `g1-login-chat-walk`)

| Check | Pass condition (server side) |
| --- | --- |
| `login_online` | `NAME joined the game`, and `UUID of player NAME is U` (logged only in online mode) with a version-4 (Mojang) UUID |
| `chat_send` | `<NAME> <HELLO>` in the log. The line is anchored, so `[Server] <NAME> ...` and other players quoting `<NAME>` never count. |
| `chat_receive` | `<NAME> echo <TOKEN>` after the console whispered the token |
| `walk` | `tp NAME ~ ~ ~` positions before and after `scenario-walk 8` are at least 6 blocks (0.75 x 8) apart horizontally |
| `stay_10min` | at join + 10 min: `list` shows NAME, no disconnect for NAME since the join, and the driver is still running |

A run with weaker parameters than the gate allows (a shorter `stayMs`, `walkBlocks` or `minWalkBlocks`, or another `bot`) is a **smoke run**. Its result has `pass: false` and `verdict: "SMOKE-PASS (not a gate pass)"`, and `run.mjs` exits 4.

Every disconnect is recorded in `result.json` under `notes.kicks`, with its reason and class (`handshake`, `timeout`, `whitelist`, `server-exception`, `client-quit`, `other`; `docs/research/fml-spec.md` section 4).

## G2: naming what the bot sees

There are three scenarios in `test/scenarios/g2/`. Each logs in first (`login_online`, as in G1), and records the world seed (`seed`) in `notes.worldSeed`; without a seed the run is not gate-valid. The bot only reports names. Every verdict comes from the server's own commands on the test server.

**The naming must be the agent's own.** G2 asks whether the agent sees correct names, so a G2 run is evidence only if the driver names things through the code the agent runs:
- **Names:** block, entity and item names come from `bot.registry`, as forge-bridge extends it, read the way `src/agent/library/world.js` reads them (`block.name`, `entity.name`, inventory `slot.name`).
- **Translation:** the 1.12 to 1.13+ translation comes **only** from `src/utils/mcdata.js` (its `toNew`/`toOld` exports). rotn-data's brief item 4 wires those to rotn-data's package.
- **No local mapping:** the driver imports no naming code of its own. The one change is the `minecraft:` namespace that mineflayer leaves off vanilla names, which `testforblock`/`testfor` need.

How it fits together:
- `agentNames(mc)` and `loadAgentNames(repoRoot)` in `scenario-protocol.mjs` build that adapter from the agent's `src/utils/mcdata.js` module. The driver passes it as `attachG2(bot, { names })` next to `attachScenario(bot)`, and logs a `g2_adapter` event naming its source and whether translation is available.
- **Until `src/utils/mcdata.js` imports `packages/rotn-data` and exports `toNew` and `toOld`, no G2 run counts.** The runner checks the source on every run (`mcdataWiring` in `lib/g2.mjs`; `notes.naming`) and calls `notGate` with the reason.
- `stockNames` is the same naming without translation, and is only for trying the protocol.
- A name the adapter cannot give is reported as `null`. The driver never guesses.

| Whisper from the console | The bot says (paged) |
| --- | --- |
| `scenario-blocks TOKEN R N K` | `blocks TOKEN i/n name meta count x,y,z x,y,z ...; ...`: its census of the N most common **non-air** block types in the cube of radius R around it. Each type has up to K candidate positions, drawn uniformly from all blocks of that type. |
| `scenario-blockat TOKEN x,y,z x,y,z ...` (at most 16) | `blockat TOKEN i/n x y z name meta; ...` |
| `scenario-entities TOKEN R` | `entities TOKEN i/n name x y z; ...`: every non-player entity within R |
| `scenario-items TOKEN` | `items TOKEN i/n slot oldName oldMeta newName backName backMeta; ...`: per inventory slot, the 1.12 name and meta, `toNew` of it, and `toOld` of that |

- **Paging.** Replies are split into chat lines of about 200 characters, sent **at most one every 1.2 s** (`pageDelayMs`). Vanilla kicks a non-op player who chats about ten times in quick succession.
- **Order.** Requests are answered one at a time, never interleaved.
- **Names** are full registry names (`minecraft:stone`, `pyrotech:rock`). Entity names are the 1.12 ones (`minecraft:zombie_pigman`, `minecraft:villager_golem`).

| Scenario | Check | Pass condition (server side) |
| --- | --- | --- |
| `g2-blocks-named` | `blocks_named` | The census (radius 16, N = 50, K = 8) has 10..50 non-air types. Every name is a registry name: nothing `unknown`, `null` or numeric. Each type has min(count, K) distinct candidates inside the cube. Air is left out even if a bot reports it. |
| | `blocks_confirmed` | For every type, **the runner** picks 3 of the candidates at random, and `testforblock x y z name meta` succeeds at each. A census that merges two blocks under one name fails here. |
| | `blocks_spotcheck` | The runner picks random positions in the cube (seeded; `notes.spotSeed`) and the bot names each, until **40 non-air answers** are confirmed by `testforblock`. Air answers are checked too but don't count. Then the answers are **weighed against the census**: a type with at least 4 spot hits that is missing from the census fails, and so does a type whose spot share and census share differ by more than 0.25 (either way). The cube's centre and radius are in `notes.cube`. |
| `g2-mobs-named` | `mobs_named` | The mob list comes **from data**: the first 12 of rotn-data's `packages/rotn-data/3.3.4/common-mobs.json` (`{mobs: [{name, ...}]}`, from the dump's overworld spawn lists), which must include a modded mob. The console summons each one: NoAI, invulnerable, tagged with the run id, killed at the end. The bot reports each by exactly its registry name, within 3 blocks. **Until that file exists**, the vanilla eight are used and the run is **not gate-valid**. A hand-given `mobs` list is never gate-valid. `extraMobs` adds mobs. |
| | `mobs_confirmed` | Every reported entity has a registry name, and `testfor @e[type=name,x=,y=,z=,r=3]` finds it. |
| `g2-items-roundtrip` | `items_table` | Run by the runner, no bot: every entry of rotn-data's **full** `packages/rotn-data/vanilla/flattening-items.json` (every vanilla 1.12 item with a 1.13+ name) goes both ways through Mindcraft's own `toNew`/`toOld`, and the in-game sample is a subset of the table. **Without the table or the module this check fails**, so G2 can't pass on the sample alone. |
| | `items_read` | The console gives 30 vanilla items by 1.12 name and meta (after `clear`). The bot reports each with exactly that name and meta. |
| | `items_named` | Each new name equals the expected 1.21-style name (`dye:1` gives `red_dye`). `null` or `unknown` fails. |
| | `items_roundtrip` | `toOld(toNew(old))` gives back exactly the 1.12 name and meta. |

Some changes make a run a smoke run, never a G2 pass:
- lowering `radius`, `topN`, `minTypes`, `candidates`, `samplesPerType`, `spotChecks` or `maxMobs`;
- changing the weighting thresholds, `bot`, `mobs`, `mobsFile`, `items` or `dataRoot`;
- missing gate data.

The run's `weakenedParams` says why.

The 1.12 command replies parsed (`Successfully found the block at x,y,z.`, `Found <name>`, `Object successfully summoned`, `Given [...] * 1 to NAME`, `Seed: N`) are the server's en_us strings; the first real run confirms them.
