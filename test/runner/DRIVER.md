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
5. Stay connected until the runner sends SIGTERM, then quit and exit with 0 within 15 s. After 15 s the runner sends SIGKILL.

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

There are three scenarios in `test/scenarios/g2/`. Each logs in first (`login_online`, as in G1), and records the world seed (`seed`) in `notes.worldSeed`; without a seed the run is not gate-valid. **The world is fixed** (lead, after G2 batch 5): every G2 gate run uses batch 4's world, seed `1880465901402976865` (`G2_WORLD_SEED` in `test/runner/lib/g2.mjs`; create the server with `deploy/test-server.sh run --seed 1880465901402976865`). Each G2 scenario's `worldSeed` gate parameter defaults to it; a recorded seed that differs makes the run not gate-valid, and changing `worldSeed` is reported as weakened. **The cube is fixed too** (lead, after G2 batch 6, whose bot spawned on a canopy and whose cube was 90% air): after login, `g2-blocks-named` teleports the bot to batch 4's ground centre `-45,66,-66` (`G2_CUBE_CENTRE`, the `cubeCentre` gate parameter, compared 'equal'). It reads the bot's real position from the server (`tp NAME ~ ~ ~`), and whispers the census with that centre. A bot more than 2 blocks (`maxLandingOffset`, compared 'equal') from the landing spot -44.5 66 -65.5 (1.12 block-centres x and z), or a teleport the server does not confirm, makes the run not gate-valid (lead, #92 review); `notes.cube` records the planned centre, the landing spot, the teleport, the position and its offset. **A killed runner** (lead, after G2 batch 6): `result.json` exists from the start and is rewritten after every check as a progress record (`verdict: "FAIL (killed)"`, `pass: false`, `gateValid: false`, `notes.killed`; notes are written through as well; unfinished checks "not reached (runner killed)"). The final result replaces it, so a runner that `timeout` kills leaves the checks it had done and never a pass. **`botExitCode` 128** in `result.json` means the driver ended by a signal (`botExitSignal`). The runner sends SIGTERM to a driver that is still running at the end of every scenario (`botStoppedByRunner: true`), so 128 with SIGTERM is the normal end of a session, not a crash. **128 with SIGKILL** means the driver ignored SIGTERM: the runner waits 15 s after SIGTERM (`stop()` in `lib/adapters.mjs`) and then kills it. That is a driver bug (behaviour item 5), even when every check passed. **One login retry** (lead, #71, after G2 batch 2):
- **When:** if the driver exits before joining, and its output since that start contains exactly `Error: Failed to obtain profile data for NAME, does the account own minecraft?` (or the same message as a `DRIVER` error event), the runner starts it once more after 10 s.
- **Why:** minecraft-protocol throws that error whenever prismarine-auth's profile fetch fails, and the real cause is swallowed.
- **What triggers it:** that error only, whatever the exit code. Any other error, a kick, or a second failure is a FAIL.
- **Still required:** `login_online` needs a real join.
- **Recorded in:** `notes.loginRetry`.

The bot only reports names. Every verdict comes from the server's own commands on the test server.

**The naming must be the agent's own.** G2 asks whether the agent sees correct names, so a G2 run is evidence only if the driver names things through the code the agent runs:
- **Names:** block, entity and item names come from `bot.registry`, as forge-bridge extends it, read the way `src/agent/library/world.js` reads them (`block.name`, `entity.name`, inventory `slot.name`).
- **Translation:** the 1.12 to 1.13+ translation comes **only** from `src/utils/mcdata.js` (its `toNew`/`toOld` exports). rotn-data's brief item 4 wires those to rotn-data's package.
- **No local mapping:** the driver imports no naming code of its own. The one change is the `minecraft:` namespace that mineflayer leaves off vanilla names, which `testforblock`/`testfor` need.

How it fits together:
- `agentNames(mc)` and `loadAgentNames(repoRoot)` in `scenario-protocol.mjs` build that adapter from the agent's `src/utils/mcdata.js` module. The driver passes it as `attachG2(bot, { names })` next to `attachScenario(bot)`, and logs a `g2_adapter` event naming its source and whether translation is available.
- **The agent's naming API is `src/utils/mcdata.js`'s `toNew(name, meta?)` and `toOld(name)`**, with the same signatures and `null` semantics as rotn-data's (the contract between this PR and rotn-data's #44, set by the lead).
- **On every run, a child process tests it.** `agentNaming` in `lib/g2.mjs` runs `node --input-type=module`, which imports the agent's `src/utils/mcdata.js`. It requires both exports to be functions, then runs every entry of `packages/rotn-data/vanilla/flattening-items.json` through **those** exports both ways (the table supplies only the expected values). The result is in `notes.naming`.
- **Until both pass, no G2 run counts.** The run calls `notGate` with the reason ("does not export toNew and toOld as functions", or the first failing entry).
- `stockNames` is the same naming without translation, and is only for trying the protocol.
- A name the adapter cannot give is reported as `null`. The driver never guesses.

| Whisper from the console | The bot says (paged) |
| --- | --- |
| `scenario-blocks TOKEN R N K [X,Y,Z]` | `blocks TOKEN i/n name meta count x,y,z x,y,z ...; ...`: its census of the N most common **non-air** block types in the cube of radius R around X,Y,Z (the runner's fixed cube centre; without it, around the bot's floored position). Each type has up to K candidate positions, drawn uniformly from all blocks of that type. The driver first waits for the cube's chunks (`waitForChunksToLoad`, then polling every chunk column, up to 30 s). The first entry is `#unloaded U T A`: U of the T positions still had no chunk, and A of the loaded ones are air. Unloaded positions and air are never a block type. |
| `scenario-blockat TOKEN x,y,z x,y,z ...` (at most 16) | `blockat TOKEN i/n x y z name meta; ...`, or `x y z #unloaded 0` for a position without a chunk |
| `scenario-entities TOKEN R` | `entities TOKEN i/n name x y z; ...`: every non-player entity within R |
| `scenario-items TOKEN` | `items TOKEN i/n slot oldName oldMeta newName backName backMeta; ...`: per inventory slot, the 1.12 name and meta, `toNew` of it, and `toOld` of that |

- **Paging.** Replies are split into chat lines of about 200 characters, sent **at most one every 1.2 s** (`pageDelayMs`). Vanilla kicks a non-op player who chats about ten times in quick succession.
- **Order.** Requests are answered one at a time, never interleaved.
- **Names** are full registry names (`minecraft:stone`, `pyrotech:rock`). Entity names are the 1.12 ones (`minecraft:zombie_pigman`, `minecraft:villager_golem`).

| Scenario | Check | Pass condition (server side) |
| --- | --- | --- |
| `g2-blocks-named` | `blocks_named` | The census (radius 16, N = 50, K = 8) has 10..50 non-air types. Every name is a registry name: nothing `unknown`, `null` or numeric. Each type has min(count, K) distinct candidates inside the cube. Air is left out even if a bot reports it. The census must include a valid `#unloaded U T A` entry with T = 35937 and a valid air count A. **The counts add up** (#77 follow-up): with fewer than N types the census claims the whole cube, so the type counts + A + U must equal T exactly; with N types they may only fall short of T. `notes.censusSum` records the parts, and `notes.censusAt` when the reply was in. |
| | `blocks_confirmed` | For every type, **the runner** picks 3 of the candidates at random. Right before checking each, it asks the bot again for that position (`scenario-blockat`). The sample passes only if `testforblock x y z name meta` succeeds with the **fresh** answer (exact name and meta, no tolerance) **and** the fresh name equals the census name. Some blocks change state between the census and the check (G2 batch 1: Dynamic Trees leaves). `notes.samples` records, for every sample, the census answer, the fresh answer and the server's verdict. `notes.metaDrift` counts the samples where the server confirmed the census name with a different meta than the census had; these are counted, not failed. A meta must be an integer 0..15: in 1.12 `-1` is a `testforblock` wildcard, so any other value fails the sample or spot check and never reaches the server. A census that merges two blocks under one name still fails here. **World changes** (G2 batch 3, lead on #76):
<ul><li>A sample whose fresh answer the server confirms exactly, but whose name is not the census name (a plant removed in between), is a world change. It is recorded in `notes.worldChanges` (position, both answers, the server verdict, times) and never counts as a pass.</li><li>It is replaced by an unused candidate of the same census type, which must pass the full rule.</li><li>More than 2% of the planned samples (`maxWorldChangeShare`), or more than 1 in one type (`maxWorldChangesPerType`), makes the run not gate-valid.</li><li>If no candidate of the type is left, the check fails.</li><li>A fresh answer the server does not confirm is a plain fail.</li></ul> |
| | `blocks_spotcheck` | The runner picks random positions in the cube (seeded; `notes.spotSeed`) and the bot names each, until **40 non-air answers** are confirmed by `testforblock`. Air answers are checked too but don't count. **Completeness:** a census with fewer than N types (a cube with fewer non-air types) claims to name every non-air block in the cube. So one confirmed spot hit of a block **name** it lacks fails; a short census can't pass by leaving types out. Then the answers are **weighed against the census**: a type with at least 4 spot hits that is missing from the census fails, and so does a type whose spot share and census share differ by more than 0.25 (either way). The cube's centre and radius are in `notes.cube`. `#unloaded` answers are counted apart, never as a failure or a hit. **Unloaded:** `notes.unloaded` records the census and spot counts. If more than **1%** of either is unloaded (`maxUnloadedShare`), the run is not a gate run. That cap also bounds what a bot could hide behind "unloaded", the one answer the server can't check. |
| `g2-mobs-named` | `mobs_named` | The mob list comes **from data**: the first 12 of rotn-data's `packages/rotn-data/3.3.4/common-mobs.json` (`{mobs: [{name, ...}]}`, from the dump's overworld spawn lists), which must include a modded mob. The console summons each one: NoAI, invulnerable, tagged with the run id, killed at the end. The bot reports each by exactly its registry name, within 3 blocks. Any reported entity, tagged or not, whose name is a placeholder (`<mod>:entity_N`, `unknown`, `null`) fails this check. **Replacements** (G2 batch 1, lead decision):
<ul><li>A mob the server refuses to summon, or no longer has right before the bot is asked (each summon is checked with `testfor` on the run tag), is replaced by the next mob in rank from the same file.</li><li>Every replacement is recorded in `notes.replaced`.</li><li>The run is not gate-valid if more than **3** are replaced (refused and vanished counted together), if a slot stays empty, or if no modded mob is among the summoned mobs.</li></ul>**Until that file exists**, four hostile vanilla mobs are used (Animania replaces the vanilla animals on RotN) and the run is **not gate-valid**. A hand-given `mobs` list is never gate-valid. `extraMobs` adds mobs. |
| | `mobs_confirmed` | For each summoned mob the bot reported, `testfor @e[tag=<run tag>,type=name,x=,y=,z=,r=3]` at the bot's reported position finds it. Other entities the bot reports (natural mobs) go to `notes.otherSeen` and are not judged by the server. |
| `g2-items-roundtrip` | `items_table` | Run by the runner, no bot. It passes only if the agent naming check passes and the in-game sample is a subset of the table. The agent naming check is the child process above: every entry of rotn-data's **full** `vanilla/flattening-items.json` (every vanilla 1.12 item with a 1.13+ name) goes both ways through the **agent's** `src/utils/mcdata.js` `toNew`/`toOld`. Nothing in the harness imports `packages/rotn-data`. Until `mcdata.js` exports both and every entry passes, this check fails, so G2 can't pass on the sample alone. |
| | `items_read` | The console gives 30 vanilla items by 1.12 name and meta (after `clear`). The bot reports each with exactly that name and meta. |
| | `items_named` | Each new name equals the expected 1.21-style name (`dye:1` gives `red_dye`). `null` or `unknown` fails. |
| | `items_roundtrip` | `toOld(toNew(old))` gives back exactly the 1.12 name and meta. |

Some changes make a run a smoke run, never a G2 pass:
- lowering `radius`, `topN`, `minTypes`, `candidates`, `samplesPerType`, `spotChecks` or `maxMobs`;
- changing the weighting thresholds, `maxReplaced`, `maxWorldChangeShare`, `maxWorldChangesPerType`, `bot`, `mobs`, `mobsFile`, `items` or `dataRoot`;
- missing gate data.

The run's `weakenedParams` says why.

The 1.12 command replies parsed are `Successfully found the block at x, y, z`, `Found <name>`, `Object successfully summoned`, `Given [...] * 1 to NAME` and `Seed: N`. The first real G2 run (2026-11-01) confirmed them on the RotN 3.3.4 server, except that `testforblock` prints `x, y, z` with spaces and no full stop, where the en_us lang key has `x,y,z.`. The parser accepts both forms.

## G3: the real Mindcraft agent (`drivers/mindcraft-driver.mjs`)

G3 runs the real agent (`main.js` with a RotN profile), not `g1-driver.mjs`:

```bash
node test/runner/run.mjs --scenario <g3 scenario> --pass-env OPENROUTER_API_KEY -- \
  node test/runner/drivers/mindcraft-driver.mjs --profile profiles/<g3 test profile>.json
```

- **Refusals (exit 3, before anything starts).** The driver refuses:
  - **any Mindcraft task file** (lead, 2026-11-02): `--task_path`, `--task_id` in any spelling, and any argument it does not know;
  - `INSECURE_CODING` or `BLOCKED_ACTIONS` with any value;
  - `SETTINGS_JSON` from outside;
  - skills-rotn's test-only `MINDCRAFT_ROTN_ALLOW_TASK_FILES` (#110);
  - a `DEBUG` that would make prismarine-auth print tokens;
  - a `settings.js` whose `allow_insecure_coding` is not exactly `false`, that names `Server` as a task giver, or whose skills-rotn `allow_server_task_giver` is anything but `false` or absent (#146). The file checked is always the one next to `main.js`, which `main.js` imports; there is no option to check another, and `--settings` is refused;
  - a profile that is not a JSON object (`null`, a number, a string or an array);
  - a profile that is missing, has a task in it, has any task-giver key (`task_givers`, `allow_server_task_giver`, ...), or names another bot than `ROTN_SCENARIO_BOT`.
  - **a profile whose model is not `openrouter/@preset/glm-5-1-mindcraft`** (the human's decision for every LLM run, 2026-11-03; `LLM_MODEL` in `lib/g3.mjs`). It must be set in the profile itself, as a string or as `{api: "openrouter", model: "@preset/glm-5-1-mindcraft"}`. `code_model` and `vision_model` must be the same model when they are set.
- **What `main.js` gets:**
  - `SETTINGS_JSON` with only these keys:
    - `host` and `port` (from `TEST_SERVER_HOST`/`PORT`);
    - `auth: "microsoft"` and `auto_open_ui: false`;
    - **`allow_server_task_giver: true`**, skills-rotn's test-only switch (#146). With it, the console's whisper sender `Server` (the runner's G3 task giver) may give tasks, and only from the console.

    **This is the only place the switch is turned on:**
    - never in a committed `settings.js` or profile (refused above);
    - never on the CX23: `deploy/cx23/check-env.mjs` refuses `allow_server_task_giver` and `task_givers` in `SETTINGS_JSON`.

    The players in `task_givers` stay as the lead's `settings.js` has them; `Server` needs no entry there;
  - `PROFILES=[the profile]`, `MINDCRAFT_SINGLE_BOT_SERVICE=1`, and a free local `MINDSERVER_PORT`;
  - `OPENROUTER_API_KEY` only if the runner passed it with `--pass-env`. It is never printed.
  - No arguments at all, so no task file can come in.
- **Stopping leaves no process behind.** `main.js` starts the agent as a child process.
  - **On POSIX,** `main.js` runs in its own process group. On SIGTERM the driver signals the group, then SIGKILLs it after `--grace-ms` (10 s), and exits 0.
  - **On Windows,** the runner's stop is a TerminateProcess the driver cannot catch. libuv puts every non-detached child into a kill-on-close job object, so ending the driver ends `main.js`, and that ends the agent. `main.js` is therefore never detached there.
  - `test/unit/mindcraft-driver.test.js` proves both with a fake `main.js` that starts an agent child. A mutation that detaches `main.js` fails those tests.
- **Exit codes:** `main.js`'s own exit code passes through (0, 1, 3). The events are `DRIVER {"type":"mindcraft_start"|"mindcraft_exit"|"stopping"|"refused",...}`.

### G3 batches: the spend stop (`test/runner/batch.mjs`)

G3 scenarios run only through `batch.mjs` inside `deploy/test-server.sh run`:
- **The marker.** Every scenario it starts gets `ROTN_G3_BATCH=<batch id>:<limit>`. A G3 run without that marker, or whose marker limit differs from its `maxBatchUsd`, is not gate-valid.
- **The batch cross-check** (#122 review, nit 1). Anyone can set an environment variable, so the marker alone does not prove that a run happened under the spend stop. A G3 gate claim therefore needs the batch summary (`--summary`, the `BATCH` JSON) next to its `result.json` files, plus:
  ```
  node test/tools/g3-batch-check.mjs <batch.json> <result.json>...
  ```
  That command exits 0 only if all of these hold:
  - the summary has a batch id and `testMode: false`;
  - at least one G3 result is given;
  - every G3 result's `batch` is exactly `<that batch id>:<its maxBatchUsd>`;
  - the summary ran each of those scenarios exactly once;
  - the result's `runId` is the one `batch.mjs` read back from that run's `result.json`, so a second, hand-run result under a reused batch id fails;
  - no passing result has a nonzero recorded exit in the summary.

  **A result is G3** (#129 re-review nit 2) if any of these holds:
  - its gate is G3, in any case or spacing;
  - its scenario id starts with `g3-`, in any case;
  - its scenario is one that `loadScenarios` marks gate G3 (ids compared without case or surrounding spaces).

  Only a top-level JSON object counts as a result (#139 review nit 2). A G3 result wrapped in an array or inside a parent object is **not detected**, so this check alone does not catch it; the evidence review does. `run.mjs` and `batch.mjs` never write results in that shape.

  Results that are not G3 are ignored. The command exits 1 when a check fails or a file cannot be read as JSON, and 2 on a usage error.

  **The check is compulsory for evidence** (#129 review). `node test/tools/g3-batch-check.mjs --tree test/evidence` makes two demands:
  - every G3 result anywhere under `test/evidence/` has a `batch.json` in its own folder or a parent folder;
  - the nearest such `batch.json` vouches for it.

  **What gets scanned** (#129 re-review nit 1):
  - every `*.json`, whatever its name (`result.json`, `g3-result.json`, `Result.json` and so on);
  - a `*.json` that cannot be read fails the check, since it could hide a G3 result;
  - so does a `batch.json` that is itself a G3 result.

  CI runs the check on every PR (`test/unit/g3-spend.test.js`).

  **Where G3 evidence goes** (#129 re-review nit 3): commit a G3 batch as `test/evidence/g3/<batch>/batch.json`, with its results in folders below it. **Gate reviews accept G3 evidence only from `test/evidence/g3/<batch>/`.** The CI check scans only `test/evidence/`, so a G3 result anywhere else in the repo is never gate evidence.

  A `batch.json` written by hand cannot be told from a real one; the independent evidence review is the safeguard there.
- **G3 scenario requirements.** Every G3 scenario has `llm: true` and `maxBatchUsd` 2 compared 'equal' (a unit test checks this). The console allowlist applies whenever `llm` is true or the gate is G3.
- **When the spend is checked.** The key's usage is read, numbers only, at the start (none: refuse, exit 2), before each scenario, and after the last one.
  - Over `maxBatchUsd` stops the batch, or ends it with exit 5. A failed reading before a scenario stops it; a failed reading at the end exits 6.
  - The logs are always fetched.
  - A scenario that hits its `--timeout-min` is recorded with exit **124**, whatever run.mjs exits after the SIGTERM. A runner that cannot be started is recorded with exit **127**. The summary records each scenario's `out` folder and its `exit`, and the batch's own `exit`.
- **Limits:**
  - The spend is checked **between** scenarios, not during one, so a single scenario can run past the limit.
  - OpenRouter's usage figure can lag a little behind the newest requests.
  - The key's own credit limit (USD 5 for the test key) is the hard backstop.
- **Records.** `result.json`'s `llm` (the models, the calls, the usage before and after, the cost) is in every record. `llm.models` is what the driver started the agent with (its `mindcraft_start` event), and a G3 run whose recorded model is not the preset is not gate-valid. Progress and killed records carry the calls so far.
- **Test mode is for the offline tests only.** `ROTN_TEST_MODE`, `ROTN_OPENROUTER_USAGE_FILE` and `ROTN_BATCH_RUNNER` make `batch.mjs` refuse to start inside a real test-server run, and the usage read ignores the fake file there. `deploy/test-server.sh run` sets `TEST_SERVER_FAKE_CLOUD=1` only against the offline fakes. `BATCH` records `testMode`.

## S1: survey and smoke before G3

S1 (`test/scenarios/s1/`) is a survey, not a gate. **Every S1 run is not gate-valid:** `run()` first records "S1 is a survey/smoke, never a gate pass" as a notGate reason, so its verdict is at best `SMOKE-PASS (not a gate pass)`. Its findings are data the lead uses to pin G3's world, dawn bound and arbiters (`coord/STATUS-harness-ops.md`, "G3 batches"). The driver is the G2 one (`g1-driver.mjs` with `attachScenario` and `attachG2`); S1 needs one more behaviour:

| Whisper | The driver |
| --- | --- |
| `s1-whisper-<TOKEN>` (a console `tell`) | prints the event `DRIVER {"type":"whisper","username":<sender as mineflayer reports it>,"token":<TOKEN>}`, from mineflayer's `whisper` event, which Mindcraft's agent also listens to |

- **`s1-site-survey`:** a G2 census around the fresh spawn (no teleport) with radius 48 and up to 400 types. Its findings are rock piles, trees, stone and loot containers (`classifyCensus` in `lib/s1.mjs`), and up to 5 positions per group are confirmed by `testforblock`. A census cut off at the type limit is not complete.
  - **`no_containers` fails closed.** A type counts as a container if any of three signals says so:
    - its registry name (chest, barrel, crate, shulker, basket, drawer, ...);
    - it is a vanilla inventory block or a spawner;
    - its Java class in rotn-data's block dump, which has the class but no tile-entity flag (Chest, Container, TileEntity, Inventory, ...).
  - Without the dump, the check fails. Any container found is named in the check's detail ("CONTAINERS FOUND ...").
  - Every modded type that no group claims is listed in `notes.findings.unclassifiedModded`, with its class, for the lead.
- **`s1-arbiters`:** `scoreboard objectives remove` for every `s1_*` objective first (so an earlier run's leftovers cannot hide an invalid criterion), then `scoreboard objectives add` for the stat criteria G3 wants (vanilla and RotN; an `invalid` reply must name the same criterion), `scoreboard players list`, a `give` of one stone pickaxe, then the count-only `clear <bot> <item> -1 0` (it must report 1 twice, so it removed nothing, and 0 for items the bot lacks), `time query daytime`, and the whisper above.
- **`s1-day-cycle`:** `time query daytime` every 60 s for 45 min with the bot online. The runner changes neither the time nor the daylight rule; it records the rate, the day length that implies, and each new day.

The reply forms parsed (from the 1.12 en_us lang file, to be confirmed on the RotN server by S1):
- `<bot> has N items that match the criteria`, and `Could not clear the inventory of <bot>, no items to remove` for 0;
- `Added new objective '<name>' successfully`, `Invalid objective criteria type '<criteria>'`, `An objective with the name '<name>' already exists`;
- `Showing N tracked objective(s) for <bot>:` with lines `- <display name>: <score> (<objective>)`, or `Player <bot> has no scores recorded`;
- `Time is N`.
