# Scenario runner

Harness-ops brief deliverable 2. A scenario drives a bot (the **driver**, see `DRIVER.md`) against the disposable test server and decides pass or fail from the server's log and console. One scenario covers one or more ready-to-try items (`docs/PLAN.md`), grouped by gate under `test/scenarios/<group>/`.

```bash
# List scenarios
node test/runner/run.mjs --list

# G1 on a fresh test server (paid batch: needs the lead's approval and a recent scheduled sweeper run)
deploy/test-server.sh run --yes -- \
  node test/runner/run.mjs --scenario g1-login-chat-walk -- node <driver.mjs>

# G2 (see DRIVER.md, G2): g2-blocks-named, g2-mobs-named, g2-items-roundtrip; one bot session each
deploy/test-server.sh run --yes -- \
  node test/runner/run.mjs --scenario g2-blocks-named -- node <driver.mjs>

# Against a server that is already up (deploy/test-server.sh up), with a short stay: a smoke run
# (exit 4 if every check passes), never a G1 pass
eval "$(deploy/test-server.sh env)"
node test/runner/run.mjs --scenario g1-login-chat-walk --param stayMs=60000 -- node test/runner/drivers/mineflayer-reference.mjs
```

The driver gets an allowlisted environment (see `DRIVER.md`). Use `--pass-env NAME` for anything else it needs, such as `OPENROUTER_API_KEY` for a Mindcraft driver. Test-server and cloud credentials are refused.

Output, in `--out` (default `$TEST_SERVER_STATE_DIR/scenarios/<scenario>-<runId>/`):

- `result.json`: one entry per check, each with its ready-to-try item, plus `notes` (kicks, UUID version, walk positions, chat-mod prefixes seen on the bot's lines) and the driver's exit code. `chatPrefixes` only lists prefixes on lines that already matched as the bot's own chat (`[PREFIX] <NAME> text`, one prefix, never `[Server]`/`[Rcon]`/`[@]`). A line in a format the parser does not recognize at all does not show up there; read `server.log` for those. A check the scenario never reached is a FAIL ("not reached").
- `server.log`: the server log from the scenario's marker line on.
- `driver.log`: the driver's stdout and stderr.

Exit codes:

- `0`: a gate pass.
- `1`: a check failed.
- `2`: a usage or setup error.
- `4`: every check passed, but the parameters were weaker than the gate allows (`gateParams`), so it is a smoke run.

`result.json` has `pass`, `checksPassed`, `gateValid`, `weakenedParams` and `verdict`.

## Layout

| Path | What |
| --- | --- |
| `run.mjs` | CLI, scenario discovery, output files |
| `lib/runner.mjs` | Engine: runs a scenario with an injected server, bot and clock, so unit tests run 10 minutes in milliseconds |
| `lib/server-log.mjs` | Parsers for the Forge 1.12.2 server log (join, UUID, chat, teleport, `list`, disconnects, kick classes) |
| `lib/adapters.mjs` | Real adapters: `deploy/test-server.sh console|log`, the driver process, the wall clock |
| `drivers/scenario-protocol.mjs` | The bot side of `DRIVER.md` for any mineflayer bot |
| `drivers/mineflayer-reference.mjs` | Stock-mineflayer reference driver; a Forge server rejects it (negative control) |
| `../scenarios/g1/` | G1 scenarios |

## Why not Mindcraft's task files for G1

Mindcraft's tasks (`--task_path`, `--task_id`) score inventory and history text, need an LLM, and send `/give`, `/clear` and `/tp` as the bot, which needs op. G1 is a protocol gate on a non-op bot, so its checks are server-side. Later gates can still use a Mindcraft task as the driver (`-- node main.js --task_path ... --task_id ...`), with server-side checks for the verdict.

## Status

The log formats are vanilla 1.12.2 server messages. They are unit-tested offline against synthetic log lines and **not yet confirmed on a live RotN 3.3.4 server**. The first real G1 run confirms them, and fixes any that RotN's mods reformat.
