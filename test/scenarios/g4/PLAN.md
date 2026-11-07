# G4 plan: proving "ready-to-try" (harness-ops, 2026-11-07; a plan, nothing built or run)

G4 passes when every item of `docs/PLAN.md` "Definition of ready-to-try" is green **on the CX23** (PLAN.md, phases). A pass on a CPX42 test server counts for G3 only. Below, each item names what already covers it, what is still needed, where it must run, and what needs the human.

**Two set-ups.**
- **S (service):** the bot runs as `mindcraft-rotn@frcfld` on the CX23 and joins a disposable CPX42 test server (`test-server.sh run --allow-from <CX23 IP>/32`). That is the human's decision on #101: the first start joins a test server, never the live one. The harness on the CX33 reads the test server (console, log, `testfor`) as in G3, and reads the bot side through `mindcraft-rotn-ctl` (status, journal, memory).
- **T (test server only):** the Mindcraft driver on the CX33 joins a CPX42, as in G3. This is used only where the host does not matter.

**Already proven on the CX23** (`test/evidence/cx23/`):
- the GO 1 probe and the GO 3 post-bootstrap check: Ubuntu 26.04.1, Node 22.23.4, users `deploy` and `mindcraft-rotn`, the unit and ctl installed, 2 GB swap, ufw active with only SSH public, password login off (drop-in), unattended upgrades on;
- the sudo rule: `deploy` may run only `mindcraft-rotn-ctl`, and the ctl refuses an unknown bot.

**Never run on the CX23 yet:** a release (`deploy.sh`), a bot start, a login, any gameplay. Still open from GO 3: the ufw rule list and `sshd -T` after the reboot (both need root, so they are for the human).

## Item by item

| # | Ready-to-try item | Covered today (where) | Needed for G4 | Runs on |
| --- | --- | --- | --- | --- |
| 1 | Service logs in with its own account; reconnects after a kick or a server restart | G1 and every G3 run: online login with a Mojang v4 UUID, through the driver (T). Unit tests: `kicks.js` classes an operator kick and a server stop as transient; `agent_process.js` restarts with backoff | **`g4-service-reconnect`** (new). Start through the ctl, then the join. Console `kick` leads to a rejoin within N min. A server restart (console `stop`, then a new `test-server.sh restart` verb that runs `rotn-test start`) leads to a rejoin after "ready". The journal shows the transient class and no systemd restart storm (`StartLimitBurst` 6/10 min). `ctl stop` exits 0 with no restart | S |
| 2 | RotN names; none of the top 50 blocks near spawn unknown | **G2 PASS** (batch 8): 50 blocks, 12 mobs, the item round-trip, through the driver's naming path (T). G3 commands use RotN ids | A naming check **through the agent**: `!nearbyBlocks`/`!entities` output scanned for unknown or numeric ids. Folded into the start of the soak (#7), so no batch of its own | S |
| 3 | Answers in chat, follows a player, comes when called, stops on command | Chat: G1 send/receive (T); G3 D's polite reply (T). `!followPlayer`, `!goToPlayer` and `!stop` exist | **`g4-control-commands`** (new). `!stop` can be tested with the test-only `Server` giver on T: start a long action, whisper `!stop`, check it ended. **Follow and come need a real player entity**: either a scripted second account, or the human playing JQDAW on a test server for 10 min (see "Needs the human") | T (+ human) |
| 4 | RotN early game from a fresh spawn: rocks, cobblestone, crude axe, logs, planks, table, stone tools | **G3 A**: PASS in rounds 4, 6 and 7; round 8 FAIL at `sticks` (fix in progress) (T) | One run on S: the soak (#7) starts on a fresh world and must finish the agenda with `crafted_by_bot` as in A | S |
| 5 | Eats, fights or flees common early mobs, survives the first night | **G3 B**: PASS 5/5 in rounds 5-rerun and 8 (T). Food is sampled; `self_defense` was seen in round 7 | The soak (#7) spans a night. **New checks** in it: food never below a threshold, an eat event when it drops, deaths 0 or each death reported (#6), fight or flee counted from the log | S |
| 6 | After death: respawn, report what it lost, carry on with no chat-spam loop | Nothing on a server yet. Code: `death_report.js` (D3: loss diff, rate-limited chat, respawn retry) | **`g4-death-report`** (new). Console `kill FRCFLD` after the agenda has gathered items (`kill` is not on the G3 console allowlist: a lead decision, test server only). Checks: respawn within 30 s, one chat line naming the lost items, at most N chat lines per minute for 5 min, no spam kick, the agenda resumes | T |
| 7 | 2-hour soak: no crash, within the ADR's memory and hourly-cost targets | Nothing. The unit caps exist: `MemoryHigh=1G`, `MemoryMax=1536M`. Hourly LLM cost from G3: about USD 0.015-0.02/h (round 8 B: USD 0.011 in 40 min) | **`g4-soak-2h`** (new). It needs **the soak ADR's targets first** (lead). Samples every 5 min: `MemoryCurrent` and `NRestarts` through a new read-only ctl verb, agent exits from the journal, the key's usage once an hour. Pass: `NRestarts` 0, no agent exit, peak memory and USD/h within the ADR | S |
| 8 | Insecure coding off; no secrets in the repo | `deploy.sh` refuses a release whose `settings.js` allows insecure coding; `check-env` refuses `INSECURE_CODING`; the G3 preflight checks `settings.js`; round 8 A showed the agent's own refusal ("Code writing is off"). CI leak check over `test/evidence/**` | The brief wants **the running process's** setting: a startup log line printing the effective `allow_insecure_coding` (a small `main.js` change, lead-owned), checked in #1. **A repo secret scan in CI** (offline; new, small) | S + CI |
| 9 | `TRY_IT.md`: how to talk to it, commands, limits, how to stop it, hourly cost | Not written | Written after #7 (it needs the measured cost), reviewed by the human | doc |
| 10 | Pursues its agenda; a trusted task interrupts at the next safe point; it reports and resumes; untrusted tasks politely refused | **G3 C** (PASS in rounds 4, 6, 7 and 8) and **G3 D** (PASS in rounds 5-8) (T) | On S: **D as it is** (`Server` is untrusted under the production settings). C needs a trusted giver, but production allows only JQDAW, and `deploy.sh` refuses the test-only `Server` giver. So C on the CX23 is the human whispering one task as JQDAW, or the lead accepts G3 C as evidence | S (+ human) |
| 11 | Task queue and agenda survive a service restart | Unit tests: `src/agent/task_queue.test.js`, `agenda.test.js` (skills-rotn). G3 C/D move `tasks.json` and `agenda.json` aside at the start, which shows they are on disk. Nothing restarted on a server | **`g4-restart-persistence`** (new). On S: the agenda step counter continues after `ctl restart`, with no step done twice. The **task queue** half needs a queued task, so either the human adds one as JQDAW, or a T variant restarts the driver with the `Server` giver | S (+ T) |
| 12 | A second bot profile starts and logs in through the template unit with no code change (smoke) | `bootstrap.sh add-bot` and the template unit (offline tests) | **`g4-second-bot`** (new, smoke). `add-bot <name>`, its env file and login, `ctl start`, the join. **A second Minecraft account** is needed, because the profile name must equal the account name and one account cannot be online twice | S (+ human) |

## Harness work needed (offline first, each a small PR)

- **The CX33 must drive the CX23.**
  - Before the move this went through an Orca terminal on `cx23-deploy`, by hand, step by step.
  - A scenario that runs for 2 h needs a scripted channel. The options, for the lead and the human to choose:
    - (a) an Orca terminal driven by `orca terminal send/read` from the scenario;
    - (b) a dedicated SSH key from the CX33 to `deploy@cx23`, limited by the existing sudo rule to `mindcraft-rotn-ctl`.

    Today agents never run `ssh` themselves, so (b) needs an explicit decision.
- **`mindcraft-rotn-ctl`:** read-only verbs `journal <bot> [--since]` and `metrics <bot>` (`MemoryCurrent`, `MemoryPeak`, `NRestarts`, `ActiveState`). The sudo rule is unchanged: still only the ctl.
- **`test-server.sh restart`** (console `stop`, wait for the process to end, `rotn-test start`, wait for "ready"), and the console allowlist for `kick`, `kill` (death) and `stop` (restart), test server only (lead).
- **A service adapter** for `run.mjs`. The bot is not spawned by the runner: start, stop and status go through the ctl, and the "driver log" is the journal.

## Needs the human (via the lead; secrets never in chat or the repo)

| What | For |
| --- | --- |
| The CX23 path from the CX33: an Orca target `cx23-deploy` usable from the dev server, or the SSH-key decision above | every S scenario |
| **H4**: the production OpenRouter key with a credit limit in `/etc/mindcraft-rotn/frcfld.env` | the first start; #1, #7, #10-12 |
| **H5**: FRCFLD's device-code login on the CX23 (`/var/lib/mindcraft-rotn/frcfld/msa`) | every S scenario |
| **H6**: the CX23's IPv4 for `--allow-from`, in each GO message | every S scenario |
| The soak ADR's memory and USD/h targets (lead, after measuring) | #7 |
| 10 min as JQDAW on a test server (follow, come, one trusted task, one task across a restart), or a second scripted account | #3, #10 (C), #11 (queue) |
| A second Minecraft account with its own device-code login | #12 |
| After G4: whitelist FRCFLD on the **live** server and set `host` in the env file | the real first join (not a G4 scenario) |

## Order, cost and time (proposal; each batch needs a written GO)

| Step | What | Server time | Cost (CPX42 EUR 0.1381/h, 1 h billed minimum; the CX23 is already paid) |
| --- | --- | --- | --- |
| 0 | CX23 first release (`deploy.sh`) and first start against a CPX42 (`STATUS` "CX23 first run", steps 6-8), after H4, H5, H6 | ~45 min | EUR 0.14 |
| 1 | `g4-death-report` (T; needs no CX23) | ~20 min | EUR 0.14 + ~USD 0.01 |
| 2 | `g4-service-reconnect` (S) | ~40 min | EUR 0.14 + ~USD 0.01 |
| 3 | `g4-restart-persistence` (S) and D on S | ~40 min | EUR 0.28 + ~USD 0.01 |
| 4 | `g4-control-commands` (T, plus the human's 10 min) | ~30 min | EUR 0.14 |
| 5 | `g4-soak-2h` (S, TTL 4 h; covers #2, #4, #5) | ~2 h 30 min | EUR 0.41 + ~USD 0.05 |
| 6 | `g4-second-bot` (S, smoke) | ~20 min | EUR 0.14 |
| 7 | `TRY_IT.md`, then the full G4 acceptance run of #1-#12 on one commit | ~4 h | about EUR 0.7 + ~USD 0.1 |

**In all:** about EUR 2.1 plus Primary IPv4-hours, and about USD 0.2 of LLM. Build time for the harness pieces above is about 2-3 agent days, offline, before step 1. **Suggested first build:** `g4-death-report`. It needs no CX23 and no human item, only the lead's OK for `kill` on the test-server console, and it covers an item nothing tests today.
