# Scenario driver contract

A **driver** is the bot under test in a harness scenario: any program that the runner starts with `node test/runner/run.mjs --scenario <id> -- <driver> [args...]`. The runner decides pass or fail from the **server's** log and console, never from what the driver says about itself. This contract is what a driver must do so that the checks can see it.

net-forge's G1 spike can satisfy it by importing `attachScenario` from `test/runner/drivers/scenario-protocol.mjs` and calling it on its own bot. `test/runner/drivers/mineflayer-reference.mjs` shows the whole thing with stock mineflayer.

## Inputs (environment)

| Variable | Set by | Meaning |
| --- | --- | --- |
| `TEST_SERVER_HOST`, `TEST_SERVER_PORT` | `deploy/test-server.sh run` | The disposable test server. Never connect anywhere else. |
| `ROTN_SCENARIO_BOT` | runner (`--param bot=`) | The bot account's Minecraft name, `FRCFLD` by default. |
| `ROTN_SCENARIO_HELLO` | runner | A per-run nonce to say once, after spawning. |
| `ROTN_SCENARIO_RUN` | runner | The run id, for the driver's own logs. |
| `MINDCRAFT_PROFILES_FOLDER` | you (passed through) | The bot account's token cache folder, outside the repo. The runner never reads it, and the driver must never print it. |

## Behaviour

1. Log in to `TEST_SERVER_HOST:TEST_SERVER_PORT` as `ROTN_SCENARIO_BOT`, in **online mode** with the bot's own Microsoft account. Never start an interactive device-code login in a scenario: if there is no token cache, exit with code 3.
2. Once spawned, say `ROTN_SCENARIO_HELLO` in chat, exactly once.
3. When a chat line contains `scenario-echo <TOKEN>` (the runner whispers it from the console), say `echo <TOKEN>`.
4. When a chat line contains `scenario-walk <N>`, walk at least N blocks horizontally, then say `walked <x> <y> <z>`.
5. Stay connected until the runner sends SIGTERM, then quit and exit with 0.

Exit codes follow ADR 0003 decision 5: `0` clean stop, `1` transient (disconnect, timeout), `3` fatal (setup error, mod rejection, ban). Optional: print one `DRIVER {json}` line per event on stdout. The runner saves stdout and stderr as `driver.log`.

## What the runner checks (G1, `g1-login-chat-walk`)

| Check | Pass condition (server side) |
| --- | --- |
| `login_online` | `NAME joined the game`, and `UUID of player NAME is U` with a version-4 (Mojang) UUID |
| `chat_send` | `<NAME> <HELLO>` in the log |
| `chat_receive` | `<NAME> echo <TOKEN>` after the console whispered the token |
| `walk` | `tp NAME ~ ~ ~` positions before and after `scenario-walk` are at least 3 blocks apart horizontally |
| `stay_10min` | at join + 10 min: `list` shows NAME, no disconnect for NAME since the join, and the driver is still running |

Every disconnect is recorded in `result.json` under `notes.kicks`, with its reason and class (`handshake`, `timeout`, `whitelist`, `server-exception`, `client-quit`, `other`; `docs/research/fml-spec.md` section 4).
