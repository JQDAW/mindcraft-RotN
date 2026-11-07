# G3 smoke round 10, batch A, ATTEMPT 1 (2026-11-07): INFRA FAULT (exit 125), a harness bug; no scenario ran; on 12fd263e; the server is deleted

**Result in one line:** the test server's Mod Director check refused its own hash list of the pinned zip's jars ("FAILED: cannot check: a bad line in /var/lib/rotn-test/pack-jars.sha256"). So the build failed closed with exit 125 before the bot joined. **This is not a bot result and not a Mod Director change.** It was a bug in #347's check, fixed in #351. The round was then restarted in full on `0daeef2d` (`g3{a,b,c,d}-20261107-r10`).

**Only `run.log` is kept:** no batch started, so there is no `batch.json`, `result.json`, driver log or server log.

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 10, under the human's advance GO (2026-11-07, about 16:35 UTC).
  - Scope: one smoke batch each of A, B, C, D, each on its own fresh server.
  - Stop the round on an infra fault (exit 125) or a harness fault.
- **Code:** a clean detached checkout of `12fd263ec8af` (develop, frozen), after `npm ci`. The commit is recorded in this README only: no batch started, so `run.log` names no commit (there is no `batch.json` or `result.json`).
- **Free memory at 18:22 UTC:** 4,403 MB available of 7,746 MB.
- **Checks right before the create (18:22:03-18:22:16 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL;
  - the dry run (sweeper OK by cadence);
  - new for #347's gz+b64 user-data:
    - 16,774 bytes, under Hetzner's 32,768;
    - `cloud-init schema`: valid;
    - every `write_files` entry decodes to the checkout's file;
  - the pack default matched the pin.
- **Command:** the DRIVER.md GO template, as in round 9's batch A (`--ttl-hours 2`, `--scenario g3-rocks-to-stone-tools`, `--out <raw>/rocks`); no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created | 18:22:47 |
| `booting:running` (the first boot with gz+b64 user-data), `unpack`, `starting` | 18:23:30, 18:24:18, 18:24:34 |
| Done; the Mod Director check (`phase: mod-director`) | 18:27:43 |
| `failed:mod-director`; the server stopped; exit 125 | 18:27:59 |
| Server, Primary IP and SSH key verified gone | 18:28:12 |

## What the run log shows

- `mod-director: pinned config/mod-director/file-director_requisites.bundle.json not on disk: Mod Director kept no copy here (not checked)`.
  - This answered the #347 review's open question. #351 then removed that line from `deploy/test-server/mod-director.sha256`, so the remote list's own hash is not checked.
- `mod-director: pinned mods/esmtweaks-1.12.2-0.4.5.jar sha256 b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933 OK`: the jar Mod Director installed matched its pin.
- `mod-director: FAILED: cannot check: a bad line in /var/lib/rotn-test/pack-jars.sha256`, then `an infra fault (the pinned Mod Director downloads): exit 125, no scenario runs`.

## Cause and fix

- 16 of the pinned zip's 337 top-level jars have spaces in their names (e.g. `mods/Aether Continuation v1.3.0.jar`).
- `rotn-test.sh`'s line check refused any path with a space.
- `build.sh`'s `record_extra_mods` had the same gap: awk's `$2` holds only the first word of such a name.
- #347's test fixtures had no such names.
- **#351 (merged) fixes both.** Its tests use the zip's real unusual names, and it was checked on all 337 real names: develop's old code gives this exact error, and the fixed code gives "337 jars of the pinned zip match".
- **The gz+b64 user-data booted correctly.** The fault came after the server's Done, in the check itself.

## Cost

- **LLM:** only the preflight probes; no batch ran, so there is no `batch.json` spend.
- **Hetzner:** ran 5 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
