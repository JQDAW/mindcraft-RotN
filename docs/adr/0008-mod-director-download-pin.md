# ADR 0008: Pin the Mod Director download (ESM-Tweaks) on test servers

- Status: accepted (test servers). The live-server part is the human's decision, open in `coord/NEEDS-HUMAN.md`.
- Date: 2026-11-07
- Author: rotn-lead

## Context

ADR 0005 pins RotN 3.3.4 by the server pack zip's SHA-256. During the G3 round 9 batch B analysis, rotn-data (PR #339) found that the zip does not hold the full mod set the server loads:

- The zip ships `mods/!mod-director-launchwrapper-1.9.1.jar` and `config/mod-director/requisites.remote.json`. That file only names a remote list: `https://raw.githubusercontent.com/Rebirth-of-the-Night/Rebirth-Of-The-Night/stable/config/mod-director/fd-3.3.4/file-director_requisites.bundle.json`, on the moving `stable` branch.
- At every server start, Mod Director downloads what that list names. The #339 reviewer compared the 347 mod ids the server loaded with the zip's jars: **ESM-Tweaks 0.4.5 is the only loaded mod missing from the zip**, so it is the only mod Mod Director adds.
- ESM-Tweaks is not cosmetic. It replaces Epic Siege Mod's digging AI and sets `mustHaveCorrectTool=true`, which decides whether zombies can dig the bot's shelter (`docs/research/rotn-progression.md`, section B).
- harness-ops checked 10 raw log sets (the validation batch, rounds 8 and 9, T1): each shows the same URL, file and version. No run recorded a hash, so identical bytes are not proven. Mod Director has hash support, but we have not confirmed that the bundle uses it.

So the pin in ADR 0005 does not cover one mod that shapes night-time survival, and a change on the `stable` branch could change test results with no change on our side. The live server, which runs the same pack, is exposed to the same thing.

## Options

1. Accept the download as part of "the pack" and do nothing.
2. **Record the downloaded files' SHA-256s on test servers and fail closed on any difference** (harness-ops' option (a)): commit the hashes of today's ESM-Tweaks 0.4.5 jar (it matches GitHub's digest `b57590bf…`) and of the remote list; check at each server `Done`.
3. Ship the jar ourselves and replace the remote list with a local one. This changes pack files that ADR 0005 pins and diverges from the live server unless the human does the same there.

## Decision

Option 2 for every disposable test server:

- `rotn-test` compares `mods/` with the pinned zip's file list plus a committed SHA-256 list of what Mod Director adds (today: ESM-Tweaks 0.4.5), and the remote list's hash. It checks at each `Done`, restarts included.
- An extra file, a missing file or a mismatch sets the phase `failed:mod-director`, stops the server, and ends the batch as an infra fault (exit 125) before any scenario runs. The hashes go into `run.log` as evidence.
- A change upstream therefore stops our tests visibly, and the lead decides whether to adopt it (a new hash list in a reviewed PR) instead of it slipping in.
- The pack as tested is now: the zip of ADR 0005 **plus** the committed Mod Director hash list.

The live server is the human's. The lead recommends that the human either keeps the auto-download and accepts that the mod can change, or pins it there too (for example with a local copy of the jar and list). That choice is recorded in `coord/NEEDS-HUMAN.md`.

## Consequences

- harness-ops builds the check in `deploy/test-server/` and its unit tests, with no paid run needed to set it up. The next batch verifies the hashes on a real server.
- Evidence READMEs cite the Mod Director hashes alongside the zip's SHA-256.
- If the bot ever runs against the live server while it has a different ESM-Tweaks, test results may not carry over. G4's plan already runs only against test servers; the first live join comes after G4.
- What we give up: an upstream fix to ESM-Tweaks reaches our tests only after a reviewed hash update.
