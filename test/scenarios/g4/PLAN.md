# G4 plan: proving "ready-to-try" (harness-ops, 2026-11-07; a plan, nothing built or run)

G4 passes when every item of `docs/PLAN.md` "Definition of ready-to-try" is green **on the CX23** (PLAN.md, phases). **G4 accepts no test-server evidence for any item** (lead, #316 review). A pass with the bot on the CX33 counts for G3 at most. Below, each item names what exists today, what G4 still needs, where it runs, and what needs the human.

**Two set-ups.**
- **S (service), the only G4 evidence:** the bot runs as `mindcraft-rotn@frcfld` on the CX23 and joins a disposable CPX42 test server (`test-server.sh run --allow-from <CX23 IP>/32`). That is the human's decision on #101: the first start joins a test server, never the live one. The harness on the CX33 reads the test server (console, log, `testfor`) as in G3. It reads and drives the bot side through `mindcraft-rotn-ctl`, over the restricted SSH key and its gate (ADR 0009, below): status, start, stop, journal and metrics.
- **T (rehearsal only, never evidence):** the Mindcraft driver on the CX33 joins a CPX42, as in G3. It is used to build and debug a scenario cheaply before its S run.

**Already proven on the CX23** (`test/evidence/cx23/`):
- the GO 1 probe and the GO 3 post-bootstrap check: Ubuntu 26.04.1, Node 22.23.4, users `deploy` and `mindcraft-rotn`, the unit and ctl installed, 2 GB swap, ufw active with only SSH public, password login off (drop-in), unattended upgrades on;
- the sudo rule: `deploy` may run only `mindcraft-rotn-ctl`, and the ctl refuses an unknown bot.

**Never run on the CX23 yet:** a release (`deploy.sh`), a bot start, a login, any gameplay. Still open from GO 3: the ufw rule list and `sshd -T` after the reboot (both need root, so they are for the human).

**"Today" below means G3 smoke batches** (gate: false). **No G3 gate batch has passed yet**, and none of it counts for G4.

## Item by item

| # | Ready-to-try item | Today (none of it is G4 evidence) | Needed for G4 (on S) |
| --- | --- | --- | --- |
| 1 | Service logs in with its own account; reconnects after a kick or a server restart | G1 PASS (driver, T); every G3 smoke run logs in online (Mojang v4 UUID). Unit tests: `kicks.js` classes an operator kick and a server stop as transient; `agent_process.js` restarts in-process with backoff | **`g4-service-reconnect`** (new). Start through the ctl, then the join. A console `kick`, and then a server restart (console `stop`, then a new `test-server.sh restart` verb: console `stop`, wait for the exit, `systemctl start rotn-server`, wait for a new Done line). **Pass:** for each one, the journal shows `agent_process.js`'s in-process line `[agent_process] FRCFLD: <reason>; restarting in N s.` with a transient class, and the server log shows FRCFLD joining again within N min. **A kick or a server stop never reaches systemd**, so `NRestarts` must stay unchanged here; it is the soak's measure (#7). `ctl stop` exits 0 with no restart. The effective-settings line (#8) is checked at the start. **Note (#324 review):** log4j rolls `latest.log` over when the server restarts, so the log lines from before the restart (the scenario's begin marker among them) must be read with `logRotated()` |
| 2 | RotN names; none of the top 50 blocks near spawn unknown | G2 PASS (gate, batch 8, through the driver's naming path, T). G3 commands use RotN ids | A naming check **through the agent**: `!nearbyBlocks`/`!entities` output scanned for unknown or numeric ids, at the start of the soak (#7) |
| 3 | Answers in chat, follows a player, comes when called, stops on command | Chat: G1 send/receive; G3 D's polite reply. `!followPlayer`, `!goToPlayer` and `!stop` exist | **`g4-control-commands`** (new), on S. Each command is given **as a trusted player**: the human as JQDAW, or a second scripted trusted account (the human's call). Production allows only JQDAW, and `deploy.sh` refuses the test-only `Server` giver. A T rehearsal with the `Server` giver (`!stop` only) is allowed for building it |
| 4 | RotN early game from a fresh spawn: rocks, cobblestone, crude axe, logs, planks, table, stone tools | G3 A smoke PASS in rounds 4, 6 and 7; round 8 FAIL at `sticks` (fix in progress) | The soak (#7) starts on a fresh world and must finish the agenda, with `crafted_by_bot` as in A |
| 5 | Eats, fights or flees common early mobs, survives the first night | G3 B smoke PASS in rounds 2, 5 (rerun) and 8. Food is sampled; `self_defense` was seen in round 7 | The soak (#7) spans a night. **New checks** in it: food never below a threshold, an eat event when it drops, fight or flee counted from the log, and every death reported as in #6 |
| 6 | After death: respawn, report what it lost, carry on with no chat-spam loop | Nothing on a server yet. Code: `death_report.js` (D3: loss diff, rate-limited chat, respawn retry) | **`g4-death-report`** (new; built and rehearsed on T first). On S it has **its own forced death**, a test-server console `kill FRCFLD` after the agenda has gathered items. It never relies on a death in the soak. **Checks:** respawn within 30 s; one chat line naming the lost items, consistent with the server's count of what it held; at most N chat lines per minute for 5 min; no spam kick; the agenda resumes |
| 7 | 2-hour soak: no crash, within the ADR's memory and hourly-cost targets | Nothing. The unit caps exist: `MemoryHigh=1G`, `MemoryMax=1536M`. Hourly LLM cost from G3 smoke: about USD 0.015-0.02/h (round 8 B: USD 0.011 in 40 min) | **`g4-soak-2h`** (new). It needs **the soak ADR's targets first** (lead). Samples every 5 min: `MemoryCurrent` and `NRestarts` through a new read-only ctl verb, agent exits from the journal, the key's usage once an hour. **Pass:** `NRestarts` 0, no agent exit, peak memory and USD/h within the ADR |
| 8 | Insecure coding off; no secrets in the repo | `deploy.sh` refuses a release whose `settings.js` allows insecure coding; `check-env` refuses `INSECURE_CODING`; the G3 preflight checks `settings.js`; round 8 A showed the agent's refusal ("Code writing is off"). CI leak check over `test/evidence/**` | **The running process's setting:** a startup log line printing the effective `allow_insecure_coding` (a small `main.js` change, lead-owned), checked in #1. **A repo secret scan in CI**: `test/tools/secret-scan.mjs` over every tracked file, with an allowlist (`secret-scan-allow.txt`) for known false positives; a CI step before `npm ci` |
| 9 | `TRY_IT.md`: how to talk to it, commands, limits, how to stop it, hourly cost | Not written | Written after the soak (it needs the measured cost), reviewed by the human |
| 10 | Pursues its agenda; a trusted task interrupts at the next safe point; it reports and resumes; untrusted tasks politely refused | G3 C smoke PASS in rounds 3b, 4, 6, 7 and 8; G3 D smoke PASS in rounds 5-8 | **D on S as it is:** `Server` is untrusted under the production settings. **C on S needs a trusted giver:** the human whispering one task as JQDAW, or a second scripted trusted account (the human's call) |
| 11 | Task queue and agenda survive a service restart | Unit tests: `src/agent/task_queue.test.js`, `agenda.test.js` (skills-rotn). G3 C/D move `tasks.json` and `agenda.json` aside at the start, which shows they are on disk | **`g4-restart-persistence`** (new). The agenda step counter continues after `ctl restart`, with no step done twice. **The task-queue half** needs a queued task across the restart, and only a trusted giver can queue one: JQDAW (the human) on S |
| 12 | A second bot profile starts and logs in through the template unit with no code change (smoke) | `bootstrap.sh add-bot` and the template unit (offline tests) | **`g4-second-bot`** (new, smoke): `add-bot <name>`, its env file and login, `ctl start`, the join. **A second Minecraft account** is needed, because the profile name must equal the account name and one account cannot be online twice |

## Harness work needed (offline first, each a small PR)

- **The CX33 drives the CX23 over a restricted SSH key: decided, ADR 0009 (the human, 2026-11-07).**
  - **The key and its line:** a dedicated key of root's on the CX33. Its `authorized_keys` line on the CX23 has `from="<the CX33>"`, `restrict` and `command="/usr/local/sbin/mindcraft-rotn-ssh-gate"`.
  - **The gate** is `deploy/cx23/mindcraft-rotn-ssh-gate.sh`, with tests in `test/unit/cx23-ssh-gate.test.js`.
    - It allows only `status`, `start`, `stop`, `metrics BOT` and `journal BOT [--since YYYY-MM-DDTHH:MM[:SS][Z]|@EPOCH]`, through `sudo -n mindcraft-rotn-ctl`. `restart` is deliberately left out: `stop` then `start` covers #11.
    - It refuses and logs everything else (syslog tag `rotn-ssh-gate`), **exit 126**. The ctl's own refusal is exit 2, so a scenario can tell a gate refusal (an incident) apart.
  - **The human installs the reviewed copy and reports its SHA-256** (`deploy/cx23/README.md`, G4 step 0, B1).
  - **Agent rules (ADR 0009):**
    - only the lead and harness-ops use the key, only under a written GO;
    - only `status` until the installed gate's hash matches the repo;
    - every `start` needs the human's GO, confirming the env file names a disposable test server;
    - a refusal in the gate's log is an incident.
  - **What scenarios still need:** a service adapter that runs `ssh <deploy@cx23> <request>` through the gate (below).
- **The env file's `host`, per S run (lead's decision, after #365's review):**
  - For each G4 S run, **the human** sets `"host"` in `/etc/mindcraft-rotn/frcfld.env` to that run's disposable test server before the `start`.
  - Agents cannot see or change the file, and that keeps the live server out of their reach.
  - So every S `start` needs the lead's written GO and the human's GO confirming the host (ADR 0009).
  - **The GO marker is per bot (lead, #401 review):** `ROTN_SERVICE_GO=<GO id>:<unit>:test-server-host-confirmed`. The service adapter refuses `start` unless it names the adapter's own unit (a started unit's `stop` uses the GO of its start), so a GO for `frcfld` can never start a second bot (#12), nor the reverse; the old form without a unit is refused.
- **`mindcraft-rotn-ctl`:** read-only verbs `journal <bot> [--since]` and `metrics <bot>` (`MemoryCurrent`, `MemoryPeak`, `NRestarts`, `ActiveState`). The sudo rule is unchanged: still only the ctl.
- **`test-server.sh restart`:** console `stop`, wait for the process to end, `systemctl start rotn-server` (on the server, through `rotn-test restart`), wait for a new Done line.
- **The console allowlist for `kill <bot>` (death), `kick <bot>` and `stop` (restart): test server only, by construction.**
  - The console goes only through `test-server.sh console`, which reaches only servers that script created itself: labelled, with its own per-batch SSH key from its state folder.
  - The harness holds no address, key or RCON for the live server, and the live server is never a `test-server.sh` target. So no allowlisted command can be pointed at it.
  - Each command is allowed only for the scenario that needs it, never for every G3 scenario. The bot's own `host` on the CX23 is set per GO in its env file and is never a console target.
- **A service adapter** for `run.mjs`. The bot is not spawned by the runner: start, stop and status go through the ctl, and the "driver log" is the journal.

## Needs the human (via the lead, who keeps NEEDS-HUMAN; secrets never in chat or the repo)

| What | For |
| --- | --- |
| ~~The CX33-to-CX23 channel~~: decided, ADR 0009 (restricted key and gate). Left for the human: install the reviewed gate and report its SHA-256 (README, G4 step 0) | every S scenario |
| The env file's `"host"`, set by the human to each S run's disposable test server before its `start` (the lead's decision; agents cannot change it) | every S scenario |
| **H4**: the production OpenRouter key with a credit limit in `/etc/mindcraft-rotn/frcfld.env` | the first start; every S scenario |
| **H5**: FRCFLD's device-code login on the CX23 (`/var/lib/mindcraft-rotn/frcfld/msa`) | every S scenario |
| **H6**: the CX23's IPv4 for `--allow-from`, in each GO message | every S scenario |
| The soak ADR's memory and USD/h targets (lead, after measuring) | #7 |
| A trusted player on S: the human as JQDAW for about 15 min (follow, come, stop; one trusted task; one task queued across a restart), or a second scripted trusted account (the human's call) | #3, #10 (C), #11 (queue) |
| A second Minecraft account with its own device-code login | #12 |
| **After G4 has passed:** whitelist FRCFLD on the **live** server and set `host` in the env file | the real first join (not a G4 scenario) |

## Order, cost and time (proposal; each batch needs a written GO)

CPX42 at EUR 0.1381/h, each server billed at least 1 h; the CX23 is already paid. Steps 1-6 build each scenario and run it once on S; **only step 7 is the G4 evidence**.

| Step | What | Servers | Server time | Cost |
| --- | --- | --- | --- | --- |
| 0 | CX23 first release (`deploy.sh`) and first start against a CPX42, after H4, H5, H6: the human's exact commands are in `deploy/cx23/README.md`, "G4 step 0" | 1 | ~45 min | EUR 0.14 |
| 1 | `g4-death-report`: T rehearsal (needs no CX23), then a dry run on S | 2 | ~20 min each | EUR 0.28 + ~USD 0.02 |
| 2 | `g4-service-reconnect` (S) | 1 | ~40 min | EUR 0.14 + ~USD 0.01 |
| 3 | `g4-restart-persistence` (S, agenda half) and D on S (its own fresh world) | 2 | ~40 min | EUR 0.28 + ~USD 0.01 |
| 4 | `g4-control-commands`: T rehearsal of `!stop`, then S with the trusted player | 2 | ~30 min each | EUR 0.28 |
| 5 | `g4-soak-2h` (S, TTL 4 h; covers #2, #4, #5) | 1 | ~2 h 30 min | EUR 0.41 + ~USD 0.05 |
| 6 | `g4-second-bot` (S, smoke) | 1 | ~20 min | EUR 0.14 |
| 7 | `TRY_IT.md` (#9), then **the G4 acceptance run: every item #1-#12 on S, on one commit**, see below | 6 | ~6 h | about EUR 1.1 + ~USD 0.1 |

**Step 7, the acceptance run, on 6 fresh CPX42s one after another:**
1. the soak on a fresh world: #2, #4, #5, #7, plus #8's effective-settings line;
2. `g4-service-reconnect`: #1;
3. `g4-death-report` with its own forced `kill`: #6;
4. D on its own fresh world: #10, untrusted half;
5. one session with the trusted player: #3, #10 (C) and #11 (agenda and queue across `ctl restart`);
6. `g4-second-bot`: #12.

#8's secret scan runs in CI, and #9 is the document. A failure follows the G3 rule: the remaining runs still run, the failure stays in the evidence, and only the failed scenario reruns after its fix, with the human's approval.

**In all:** about EUR 2.8 plus Primary IPv4-hours, and about USD 0.2 of LLM. Build time for the harness pieces above is about 2-3 agent days, offline, before step 1. **First build (lead's pick, 2026-11-07):** `g4-death-report`, built offline and rehearsed on T.
