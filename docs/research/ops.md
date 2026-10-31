# Ops research: Mindcraft-RotN

- Source: `ops-analyst` subagent, 2026-10-31, filed by rotn-lead. Input, not a decision.
- No keys, .env, token caches or Hetzner tokens were read or handled. Estimates are labelled. The repo has no `package-lock.json` and no `node_modules`, so package versions come from npm manifests, not an install.
- Lead check (2026-10-31): flag 1 confirmed directly against the npm registry. mineflayer `engines.node` is `>=18` up to 4.25.0 and `>=22` from 4.27.0 through 4.39.0; minecraft-protocol 1.68.0 is also `>=22`. Node 20 reached end-of-life in April 2026. Flag 4 (prices and availability) comes from a secondary source and is **not yet verified** with `hcloud`.

## Flags for the lead (read first)

1. **Node version conflict.** `package.json` pins `mineflayer ^4.33.0`. The npm manifests for mineflayer 4.33.0 and latest 4.39.0 both declare `engines.node >=22` ([4.33.0](https://registry.npmjs.org/mineflayer/4.33.0), [latest](https://registry.npmjs.org/mineflayer/latest)). PLAN and CLAUDE.md pin Node 20. Harness-ops must test the bot on Node 20 and record the result, or the lead needs an ADR. Whether it breaks at runtime is unverified.
2. **No lockfile.** No `package-lock.json` exists, so the prismarine-auth version is not pinned. Commit a lockfile.
3. **No `profilesFolder` is set in the code.** `src/utils/mcdata.js` (`initBot`, lines 55-68) passes `username, host, port, auth: settings.auth, version` and nothing else. No `profilesFolder` is set anywhere in the repo, so the default applies (section 1). `settings.js` (repo root) defaults `auth` to `"offline"`.
4. **Hetzner prices changed on 15 June 2026.** Published monthly figures are CX23 EUR 3.99 to 5.49 and CPX42 EUR 25.49 to 69.49, both excluding IPv4 ([secondary source citing Hetzner's price-adjustment page](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do)). The brief's CPX42 EUR 0.138/h and EUR 86.17/month cap are not reproduced. Hetzner's own cloud page shows the shared plans as "Currently not available" ([hetzner.com/cloud](https://www.hetzner.com/cloud/)), which may block CX23 and CPX42 orders. Confirm with `hcloud server-type list` and a real order before the plan depends on either.
5. **No `--enable-ipv4` flag in hcloud.** Use `--primary-ipv4 <name>` or `--without-ipv4` ([hcloud server create reference](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server_create.md)).
6. **PLAN risk "No OpenRouter embeddings" is out of date.** OpenRouter documents `POST /api/v1/embeddings` (section D). This repo's `src/models/openrouter.js` lines 74-76 still throw in `embed()`. `src/utils/examples.js` lines 28-43 catch that and set `this.model = null`, so the word-overlap fallback is what runs today.

---

## 1. prismarine-auth token cache and first login

**Chain.** mineflayer `createBot` calls `mc.createClient(options)` ([mineflayer lib/loader.js](https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/lib/loader.js)), so `profilesFolder` passed to `createBot` reaches node-minecraft-protocol. node-minecraft-protocol 1.68.0 depends on `prismarine-auth ^3.1.1` and `minecraft-folder-path ^1.2.0` ([node-minecraft-protocol package.json](https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol/master/package.json), [prismarine-auth latest](https://registry.npmjs.org/prismarine-auth/latest)). Mineflayer 4.33.0 pulls `minecraft-protocol ^1.61.0`. The exact prismarine-auth version this repo resolves is unverified; run `npm ls prismarine-auth` after install.

**Default location.** node-minecraft-protocol's `validateOptions` sets `options.profilesFolder = path.join(minecraftFolderPath, 'nmp-cache')` when none is given, then calls `new PrismarineAuth(options.username, options.profilesFolder, options, options.onMsaCode)` ([microsoftAuth.js](https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol/master/src/client/microsoftAuth.js)). So node-minecraft-protocol, not prismarine-auth, supplies the folder.

- Linux: `path.join(os.homedir(), '.minecraft')` then `nmp-cache`. For user `mindcraft-rotn` with home `/var/lib/mindcraft-rotn`, that is `/var/lib/mindcraft-rotn/.minecraft/nmp-cache`.
- Windows: `%APPDATA%\.minecraft\nmp-cache`.
- Source: [minecraft-folder-path index.js](https://raw.githubusercontent.com/simonmeusel/minecraft-folder-path/master/index.js).
- The repo's `.gitignore` line 35 ignores `**/nmp-cache/`. A custom folder outside the repo avoids depending on that rule.

**Per-bot location.** Set `profilesFolder` in `initBot`. A small, reversible change; `initBot` belongs to net-forge per CLAUDE.md:

```js
// src/utils/mcdata.js, inside the options object in initBot (proposed)
profilesFolder: process.env.MINDCRAFT_PROFILES_FOLDER || undefined, // undefined keeps the default
```

Each bot gets its own folder via its own env file (section 2). Do not use `HOME` tricks; they move other state too.

**Permissions.** The library creates the directory with `mkdirSync(..., { recursive: true })` using the process umask ([MicrosoftAuthFlow.js](https://raw.githubusercontent.com/PrismarineJS/prismarine-auth/master/src/MicrosoftAuthFlow.js)). Pre-create it with mode 0700 and set `UMask=0077` in the unit.

**First device-code login over SSH (human-run).** The library prints `[msa] First time signing in. Please authenticate now:` followed by Microsoft's message, which contains a URL and a code, to stdout unless a code callback is supplied ([MicrosoftAuthFlow.js](https://raw.githubusercontent.com/PrismarineJS/prismarine-auth/master/src/MicrosoftAuthFlow.js)). That works over SSH: the human opens the URL on their own device and types the code. Per CLAUDE.md this is a human action; route it to `coord/NEEDS-HUMAN.md`. The agent must not complete the sign-in or handle the code or password.

```bash
sudo install -d -m 0700 -o mindcraft-rotn -g mindcraft-rotn /var/lib/mindcraft-rotn/rotn-bot/msa
sudo -u mindcraft-rotn env MINDCRAFT_PROFILES_FOLDER=/var/lib/mindcraft-rotn/rotn-bot/msa \
  node /opt/mindcraft-rotn/deploy/login-bot.mjs rotn-bot    # proposed helper, not yet written
```

Helper sketch (proposed, untested). It makes the same constructor and calls as node-minecraft-protocol. The `authTitle`, `deviceType` and `flow` values are node-minecraft-protocol's defaults:

```js
import { Authflow, Titles } from 'prismarine-auth';
const username = process.argv[2];
const folder = process.env.MINDCRAFT_PROFILES_FOLDER;
const flow = new Authflow(username, folder,
  { authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live' },
  (resp) => console.log(resp.message));   // prints the device-code instructions
const { profile } = await flow.getMinecraftJavaToken({ fetchProfile: true, fetchCertificates: false });
console.log('signed in as', profile.name);  // never print tokens
```

**Verify without reading secrets.** `ls -ld` and `ls -l` the folder (names and modes only). Do not `cat` or open cache files. The exact cache file names were not confirmed from sources.

**Bot auth setting.** The bot profile or settings must set `auth` to `microsoft`. Whether `main.js` exposes an env override for `auth` is unverified.

---

## 2. Hardened systemd template unit

Assumes a `mindcraft-rotn` system user, Node at `/usr/bin/node` (NodeSource package; unverified path), and the repo at `/opt/mindcraft-rotn`.

`/etc/systemd/system/mindcraft-rotn@.service`:

```ini
[Unit]
Description=Mindcraft-RotN bot %i
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=600
StartLimitBurst=6

[Service]
Type=simple
User=mindcraft-rotn
Group=mindcraft-rotn
WorkingDirectory=/opt/mindcraft-rotn
EnvironmentFile=/etc/mindcraft-rotn/%i.env
ExecStart=/usr/bin/node /opt/mindcraft-rotn/main.js
Restart=always
RestartSec=20
TimeoutStopSec=30
UMask=0077

# Resource caps (estimates, see section 5)
MemoryHigh=1G
MemoryMax=1536M
MemorySwapMax=0
CPUQuota=100%
TasksMax=256

# Hardening
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
ReadWritePaths=/var/lib/mindcraft-rotn/%i /opt/mindcraft-rotn/bots

[Install]
WantedBy=multi-user.target
```

Notes:

- **Restart policy.** `Restart=always` is deliberate. `on-failure` does not restart after a clean exit (exit code 0), so a bot that exits cleanly on a kick would stay down. `always` plus `StartLimitBurst` stops tight crash loops. Restart is subject to start rate limiting ([systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)); `StartLimitIntervalSec` and `StartLimitBurst` belong in `[Unit]` ([systemd.unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)). In-app reconnect is still needed for the PLAN's "reconnects after a kick" item.
- **Do not set `MemoryDenyWriteExecute`.** V8's JIT needs writable-executable memory, so this would break Node.
- `ReadWritePaths` is needed because `ProtectSystem=strict` makes `/opt` read-only. Confirm the bot's per-bot memory folder in the repo (`bots/`) before relying on that path.
- `%i` expands in unit-file lines and in `EnvironmentFile=` paths. It does not expand inside the env file, so write each bot's values literally.
- `ProtectSystem=strict` and `ProtectHome` are described in [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html). `MemoryMax`, `MemoryHigh`, `CPUQuota` and `TasksMax` are described in [systemd.resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html).

Per-bot env file `/etc/mindcraft-rotn/rotn-bot.env` (owner `root:mindcraft-rotn`, mode 0640). Placeholder only; the human sets the real key:

```ini
MINDCRAFT_PROFILES_FOLDER=/var/lib/mindcraft-rotn/rotn-bot/msa
OPENROUTER_API_KEY=<set-by-human-never-in-repo>
NODE_OPTIONS=--max-old-space-size=768
```

Setup and checks (standard systemd and useradd commands):

```bash
sudo useradd --system --home-dir /var/lib/mindcraft-rotn --shell /usr/sbin/nologin mindcraft-rotn
sudo install -d -m 0750 -o mindcraft-rotn -g mindcraft-rotn /var/lib/mindcraft-rotn/rotn-bot
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/mindcraft-rotn@.service
sudo systemctl enable --now mindcraft-rotn@rotn-bot
systemd-analyze security mindcraft-rotn@rotn-bot.service
```

---

## 3. hcloud: create with cloud-init, label, delete with Primary IP; watchdog

**Flags verified** ([hcloud server create](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server_create.md), [primary-ip create](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_primary-ip_create.md), [server delete](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server_delete.md), [primary-ip delete](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_primary-ip_delete.md)): `--label key=value` (repeatable), `--user-data-from-file`, `--primary-ipv4`, `--location` (`--datacenter` removed), `--ssh-key`, `--auto-delete` (bool), `--assignee-id`.

```bash
# The human creates the context once; the API token is typed at the prompt. The agent never handles it.
hcloud context create mindcraft-rotn-test

NAME="mcr-test-$(date -u +%Y%m%d-%H%M)"
DEL_AFTER="$(date -u -d '+8 hours' +%s)"   # default watchdog 8 h

# Primary IP first. --auto-delete=true lets the IP go with the server; the explicit delete below still runs.
hcloud primary-ip create --name "$NAME-ip" --type ipv4 --location nbg1 --auto-delete=true \
  --label purpose=mindcraft-rotn-test --label "delete-after=$DEL_AFTER"

hcloud server create --name "$NAME" --type cpx42 --image ubuntu-24.04 --location nbg1 \
  --ssh-key <your-ssh-key-name> --primary-ipv4 "$NAME-ip" \
  --user-data-from-file ./cloud-init.yaml \
  --label purpose=mindcraft-rotn-test --label "delete-after=$DEL_AFTER"

# Teardown: server first, then its IP. Treat "not found" on the IP as already deleted.
hcloud server delete "$NAME"
hcloud primary-ip delete "$NAME-ip"
hcloud server list -l purpose=mindcraft-rotn-test
hcloud primary-ip list | grep "$NAME" || echo "no primary IP left"
```

Caveats: `--ssh-key` takes an uploaded key name (placeholder above). The image name `ubuntu-24.04` and location `nbg1` are assumptions to confirm with `hcloud image list` and `hcloud location list` (not verified). `hcloud primary-ip list -l` was not confirmed, so use the grep form.

**Billing facts behind the watchdog.** Servers are billed whether powered on or off until deleted ([billing FAQ](https://docs.hetzner.com/cloud/billing/faq/)). Primary IPs are billed once creation finishes, including unassigned ones, and stay billed until deleted. Auto-delete removes an unprotected IP with its server; when disabled, the IP stays ([Primary IP FAQ](https://docs.hetzner.com/cloud/servers/primary-ips/faq/)). So stopping a server does not stop the cost; only deleting it does.

**Watchdog design.**

1. Every server and IP gets `purpose=mindcraft-rotn-test` and `delete-after=<unix epoch, now + 8 h>`. Use epoch digits only, to avoid label-value rules (not verified).
2. The PC wrapper runs `trap` on EXIT to delete the server and IP, best effort. This covers normal failures on the PC.
3. An independent sweeper does the real work, because a PC crash or sleep would otherwise leave resources running. Run it on a schedule that does not depend on the PC, e.g. a CI cron job every 15 minutes whose Hetzner token is set by the human in that CI's secret store. Off-PC, not on the CX23 bot, and not the live server.
   - Select only by label: `purpose=mindcraft-rotn-test`. Never by name prefix. Never touch unlabelled resources.
   - For each server with `delete-after` in the past, delete it. Then delete any labelled primary IP whose `delete-after` has passed, retrying if still assigned.
   - Alert if any labelled resource is older than 8 h plus a grace period (e.g. 30 min).
4. The token the sweeper uses needs Read & Write. Read-only tokens allow GET requests only ([API token docs](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/)).
5. Estimate: an 8 h CPX42 run at the June 2026 monthly price is about EUR 0.76 (69.49 x 8 / 730), excluding IPv4 and VAT. This is prorated from the monthly price and is an estimate.

**Build in cloud-init or from the PC? Recommendation: cloud-init does the build.** The PC only calls create, polls, runs tests and deletes.

- A PC-driven build needs an SSH session per step, a PC that stays on, retry logic on the PC, and leaves partial builds behind on failure.
- cloud-init gives one reproducible boot script that logs to the box, and the PC polls once.
- Cost: cloud-init failures are silent unless polled, so use a marker file. `runcmd` runs on first boot, which is fine for disposable servers.

Skeleton (the pack URL and SHA-256 are placeholders the lead must pin; the pack location was not verified):

```yaml
#cloud-config
write_files:
  - path: /usr/local/sbin/build-rotn-test.sh
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      exec >>/var/log/build-rotn-test.log 2>&1
      apt-get update
      apt-get install -y openjdk-8-jre-headless unzip curl ca-certificates
      mkdir -p /opt/rotn && cd /opt/rotn
      curl -fsSL -o pack.zip "<PINNED_ROTN_3.3.2_SERVER_PACK_URL>"
      echo "<PINNED_SHA256>  pack.zip" | sha256sum -c -
      unzip -q pack.zip
      # start and EULA steps per the pack (human approves EULA handling)
      touch /var/lib/rotn-build.ok
runcmd:
  - [/usr/local/sbin/build-rotn-test.sh]
```

Ready check from the PC: `ssh <root-or-tester>@<ip> 'cloud-init status --wait >/dev/null && test -f /var/lib/rotn-build.ok'`.

Do not put secrets in user-data. Assume it can be read through the API. The user-data size limit was not confirmed (Hetzner's API page returned 404), so keep the file small.

**Windows install of hcloud (A).** Use either of these:

- `winget install HetznerCloud.CLI`, or `scoop install hcloud`. Hetzner's tutorial warns that neither package entry is maintained by Hetzner ([setup tutorial](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/tutorials/setup-hcloud-cli.md)).
- Or the official release v1.70.2 (published 2026-10-23): `hcloud-windows-amd64.zip`, with `checksums.txt` and `checksums.txt.sig` ([GitHub release API](https://api.github.com/repos/hetznercloud/cli/releases/latest)). Verify in PowerShell with `Get-FileHash .\hcloud-windows-amd64.zip -Algorithm SHA256` against `checksums.txt`. Put `hcloud.exe` on PATH, open a new Git Bash, and run `hcloud version`.
- Token: `hcloud context create <name>` prompts for the token, or the human sets `HCLOUD_TOKEN` in the environment ([configuration reference](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/configuration.md)). Config path on Windows is `%APPDATA%\hcloud\cli.toml`. The agent never reads or prints the token.

---

## 4. OpenRouter per-key limits and usage

**How the limit works** ([limits reference](https://openrouter.ai/docs/api-reference/limits)):

- A key can carry an optional credit cap: `limit` (null means unlimited), `limit_remaining`, and `limit_reset` (null means never resets). Accepted `limit_reset` values were not listed on the page read.
- Spend windows are UTC. A daily budget resets at 00:00 UTC.
- `include_byok_in_limit` only matters if BYOK is used.
- When a key is exhausted, the API returns HTTP 402 with `limit_source: openrouter_key_limit`. Fix: raise the limit or wait for reset. The bot should keep its reflexes running with no LLM calls (PLAN priority 1).

**Reading usage per key:**

- With the bot's own key, `GET https://openrouter.ai/api/v1/key` returns `usage` (all time), `usage_daily`, `usage_weekly` (UTC week starting Monday), `usage_monthly`, `limit`, `limit_remaining`, `limit_reset` and `is_free_tier`.

```bash
# $OPENROUTER_API_KEY comes from the environment and is never printed
curl -sS https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

- Management keys are a separate kind. `GET /api/v1/keys` and `GET /api/v1/keys/{hash}` need a management key, which cannot call completion endpoints. Keep it off the bot ([provisioning keys](https://openrouter.ai/docs/guides/overview/auth/provisioning-api-keys)). The PATCH example shows `name`, `disabled`, `include_byok_in_limit` and `limit_reset`; it does not show a credit-limit field, so changing a limit via PATCH is unverified.
- For the hourly cost target, sample `usage` at fixed intervals and take the differences. The embeddings response also reports `usage.cost` ([embeddings reference](https://openrouter.ai/docs/api-reference/embeddings/create-embeddings)).

---

## 5. Memory and CPU budget for one headless mineflayer bot (ESTIMATE, not measured)

| Component | Estimate | Basis |
| --- | --- | --- |
| Node base RSS | 40-60 MB | typical idle Node; estimate |
| mineflayer, minecraft-protocol, minecraft-data (1.12.2 plus RotN registry) | 120-220 MB | estimate |
| Loaded chunks | 50-150 MB | estimate; depends on render distance |
| Plugins (pathfinder, pvp, collectblock, armor, auto-eat) | 20-40 MB | estimate |
| Mindcraft LLM history and mindserver UI | 30-80 MB | estimate |
| Total steady RSS | about 300-500 MB; peaks near 700 MB | estimate |

- **CPU:** idle a few percent of one vCPU; bursts of 20-50% of one vCPU during chunk decode and pathing; average about 5-15% of one vCPU. Estimate.
- **Network:** position packets are throttled to 50 ms (`src/utils/mcdata.js` line 75), so roughly 20 small packets per second upstream. Downstream is dominated by chunks. Estimate.
- **Disk:** logs and memory files, tens of MB per day. Estimate.
- **Unit caps** (section 2): `MemoryHigh=1G`, `MemoryMax=1536M`, `NODE_OPTIONS=--max-old-space-size=768`, `CPUQuota=100%`. These are estimates chosen to leave headroom under the caps; check them with the soak.
- **CX23 (4 GB, 2 vCPU):** one bot plus the OS (about 300-500 MB, estimate) fits with room. Two bots with 1.5 GB caps each would exceed comfortable headroom on 4 GB. Treat multi-bot as needing a bigger box or lower caps; measure in the soak.
- **Measure:** `systemctl status` and `systemd-cgtop` for cgroup memory and CPU, `/proc/<pid>/status` for VmRSS.

**Java heap for the test server (B, estimate).** RotN's wiki says about 6,000 MB for the client ([rotn.wiki.gg](https://rotn.wiki.gg/wiki/Installation)); the wiki gives no server heap figure. A third-party host recommends 4-5 GB for a 3.3.4 server and at least 6 GB generally ([StickyPiston](https://stickypiston.co/curseforge/curse-rebirth-of-the-night-server-hosting/), [GameHostBros](https://www.gamehostbros.com/minecraft-server-hosting/modpacks/338901)). For a roughly 200-mod pack on the 16 GB CPX42, a starting point is `-Xms4G -Xmx8G`, leaving about 8 GB for the OS, harness and any bots. Estimate. Check the pack's own start script first; it may already set heap flags. Confirm with GC logs and the first boot's RSS.

---

## A. Test-server script: PC or cloud-init (summary)

Covered in section 3. Recommendation: the PC calls only `hcloud` create, poll, test and delete; cloud-init does the build. The watchdog sweeper runs off the PC.

## B. Java 8 on Ubuntu 24.04

- Ubuntu's `openjdk-8-jre-headless` is in noble universe. Version `8u504-ga-1ubuntu1~24.04.3` on amd64; arm64 shows `8u402-ga-8build1` ([packages.ubuntu.com](https://packages.ubuntu.com/noble/openjdk-8-jre-headless)). Install with `sudo apt-get install -y openjdk-8-jre-headless`. Enable universe first if apt cannot find it. A JRE is enough to run Forge. Confirm with `java -version`.
- Temurin 8 on noble: unverified. Adoptium's Linux page gives the apt pattern and `temurin-8-jdk` as an example, but its noble support statement was on a page that could not be read ([Adoptium](https://adoptium.net/installation/linux/)). Use Ubuntu's package unless the lead wants Temurin; then check with `apt-cache policy temurin-8-jdk` after adding the repo.
- RotN wiki: Java 8 is mandatory and "Any other versions of Java will not work!" ([rotn.wiki.gg](https://rotn.wiki.gg/wiki/Installation)).

## C. Hetzner specs and prices (flagged differences)

| Item | Brief | Found | Status |
| --- | --- | --- | --- |
| CX23 | 2 vCPU, 4 GB, 40 GB | 2 vCPU, 4 GB per brief; EUR 3.99 to 5.49/mo from 15 Jun 2026, excl. IPv4 ([privatedevops](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do)) | price differs; availability risk |
| CPX42 | 8 vCPU, 16 GB, 320 GB; EUR 0.138/h; EUR 86.17/mo cap | 8/16/320 consistent with PLAN; EUR 25.49 to 69.49/mo; hourly not found | price differs; hourly unverified |
| Availability | none | [Hetzner cloud page](https://www.hetzner.com/cloud/) shows shared plans "Currently not available" | confirm before planning |

- Plan families: CX is Intel shared, CPX is AMD shared, CCX/General Purpose is dedicated ([privatedevops](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do); [Hetzner cloud page](https://www.hetzner.com/cloud/)). The June increases apply to new orders and rescales; existing servers keep their price.
- hcloud type names: `cx23`, `cpx42` (lowercase). Check with `hcloud server-type list -o columns=name,cores,cpu_type,memory,disk,deprecated`. The column names are verified against the [server-type reference](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server-type_list.md). Prices are not in those columns; read them from the API or the console.

## D. OpenRouter embeddings

- Yes, the endpoint exists: `POST https://openrouter.ai/api/v1/embeddings`. Required fields `model` and `input` (a string or array) ([embeddings reference](https://openrouter.ai/docs/api-reference/embeddings/create-embeddings)). OpenRouter's 2026 embedding overview lists a catalog of 37 entries, last verified 11 Sep 2026 ([blog](https://openrouter.ai/blog/insights/best-embedding-models-2026/)).
- The "OpenAI-compatible" claim came from third-party and model pages, not the official reference; unverified.
- In this repo, `openrouter.js` `embed()` throws (lines 74-76) and `examples.js` `load()` (lines 28-43) falls back to word overlap. Wiring OpenRouter embeddings in is a skills-rotn or lead decision, not an ops one. Any embedding spend also draws on the bot's per-key limit.

## Unverified or not done

- prismarine-auth's resolved version and the cache file names (not in sources; not inspected, by design).
- Temurin 8 on Ubuntu 24.04 noble.
- Hetzner user-data size limit; hourly prices; whether CX23 or CPX42 are orderable today.
- hcloud `primary-ip list -l`, `--format` and JSON output shapes; image name `ubuntu-24.04`; location `nbg1`.
- Whether mineflayer runs on Node 20 despite `engines >=22` (see the lead check at the top; the Node pin needs an ADR).
- An official RotN 3.3.2 server RAM figure (not found; community figures are for 3.3.4).
- Label value rules in Hetzner.
- Whether Hetzner's server create auto-creates a Primary IP with auto-delete on (not confirmed; the explicit `--auto-delete=true` avoids depending on it).

## Sources

Repo: `package.json`, `src/utils/mcdata.js` (lines 55-68, 75), `src/utils/examples.js` (lines 21-43), `src/models/openrouter.js` (lines 74-76), `settings.js`, `docs/PLAN.md`, `.gitignore` (line 35).

Upstream and packages: [mineflayer lib/loader.js](https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/lib/loader.js); [mineflayer 4.33.0 manifest](https://registry.npmjs.org/mineflayer/4.33.0) and [latest](https://registry.npmjs.org/mineflayer/latest); [node-minecraft-protocol microsoftAuth.js](https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol/master/src/client/microsoftAuth.js) and [package.json](https://raw.githubusercontent.com/PrismarineJS/node-minecraft-protocol/master/package.json); [prismarine-auth MicrosoftAuthFlow.js](https://raw.githubusercontent.com/PrismarineJS/prismarine-auth/master/src/MicrosoftAuthFlow.js) and [latest](https://registry.npmjs.org/prismarine-auth/latest); [minecraft-folder-path](https://raw.githubusercontent.com/simonmeusel/minecraft-folder-path/master/index.js); [mineflayer docs/api.md](https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/docs/api.md).

hcloud and Hetzner: [setup tutorial](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/tutorials/setup-hcloud-cli.md); [configuration](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/configuration.md); [server create](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server_create.md), [primary-ip create](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_primary-ip_create.md), [server delete](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server_delete.md), [primary-ip delete](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_primary-ip_delete.md), [server list](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server_list.md), [server-type list](https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server-type_list.md); [releases API](https://api.github.com/repos/hetznercloud/cli/releases/latest); [billing FAQ](https://docs.hetzner.com/cloud/billing/faq/); [Primary IP FAQ](https://docs.hetzner.com/cloud/servers/primary-ips/faq/); [API token docs](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/); [cloud pricing page](https://www.hetzner.com/cloud/); [privatedevops June 2026 price article](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do).

OpenRouter: [limits](https://openrouter.ai/docs/api-reference/limits); [provisioning keys](https://openrouter.ai/docs/guides/overview/auth/provisioning-api-keys); [embeddings](https://openrouter.ai/docs/api-reference/embeddings/create-embeddings); [embedding models 2026](https://openrouter.ai/blog/insights/best-embedding-models-2026/).

Java and RotN: [Ubuntu noble openjdk-8-jre-headless](https://packages.ubuntu.com/noble/openjdk-8-jre-headless); [Adoptium Linux](https://adoptium.net/installation/linux/); [RotN wiki installation](https://rotn.wiki.gg/wiki/Installation); [StickyPiston (3.3.4)](https://stickypiston.co/curseforge/curse-rebirth-of-the-night-server-hosting/); [GameHostBros](https://www.gamehostbros.com/minecraft-server-hosting/modpacks/338901).

systemd: [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html); [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html); [systemd.resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html); [systemd.unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html).
