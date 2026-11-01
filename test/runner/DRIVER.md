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
