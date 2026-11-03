# Java 8 on Ubuntu 26.04 for the test servers (research note, 2026-11-03)

This note is for a decision: should the disposable RotN test servers move from `ubuntu-24.04` to `ubuntu-26.04`, the bot's OS since ADR 0007? For now the test servers stay on 24.04 (lead). harness-ops wrote this note; the lead may file it under `docs/research/`.

## Answer

**Yes, Java 8 is available on 26.04, from the same package as on 24.04.** Ubuntu 26.04 ("resolute") publishes `openjdk-8-jre-headless` in **universe**, with security updates. Its upstream build is the same **8u504** that 24.04 gets today:

| Series | `openjdk-8-jre-headless` (amd64), pocket |
| --- | --- |
| noble (24.04), the current test servers | 8u504-ga-1ubuntu1~24.04.3, security and updates (universe) |
| resolute (26.04), the CX23 | 8u504-ga-1ubuntu1~26.04.3, security and updates (universe) |

Sources, read on 2026-11-03:
- [packages.ubuntu.com search for openjdk-8-jre-headless](https://packages.ubuntu.com/search?keywords=openjdk-8-jre-headless&searchon=names&suite=all&section=all) lists resolute and resolute-updates for amd64, arm64, armhf, i386, ppc64el and s390x.
- [Launchpad openjdk-8 source](https://launchpad.net/ubuntu/+source/openjdk-8) lists "The Resolute Raccoon (supported): 8u504-ga-1ubuntu1~26.04.3, security and updates (universe)" and shows no removal notice. The later series (26.10 "stonking" and the one in development, "tenacious") carry 8u504 as well.

**Hetzner has the image.** A read-only `hcloud image list --type system` on the test project (2026-11-03) shows `ubuntu-26.04` for x86 and arm. `deploy/test-server.sh` already takes `--image ubuntu-26.04`.

## What a move would touch

- **`deploy/test-server.sh` cloud-init:**
  - It installs `openjdk-8-jre-headless unzip tmux curl ca-certificates jq ufw` with apt and nothing else, and it does not use sudo, so sudo-rs on 26.04 does not matter.
  - **ufw**, **jq** and **curl** already installed from the 26.04 archive in the `ci-ubuntu-2604` job. `unzip` and `tmux` are not checked yet.
  - A missing package makes cloud-init's build fail, and the batch then fails closed and deletes the server.
- **`deploy/test-server/build.sh`:** it checks `java -version` for `version "1.8` and stops otherwise, so a wrong Java cannot slip through. Forge 14.23.5.2860 and the pack run on the same 8u504 JVM on either OS.
- **The default image** is `IMAGE=ubuntu-24.04` (`deploy/test-server.sh:113`). A move is a one-line change plus a G0-style build batch. G0 batch 1 took about 4 minutes on a CPX42, one billed hour, EUR 0.14. That batch would prove the pack download, the SHA-256 check, Java 8, Forge, the 346 mods and the console on 26.04.

## Risks and unknowns

- **Universe, not main.** openjdk-8 is community-maintained in universe on both 24.04 and 26.04, so nothing changes by moving. Its security updates currently arrive in the -security pocket on both.
- **Kernel 7.0 on 26.04.** Nothing in Java 8 or Forge is known to depend on it, but it is untested until the build batch runs.
- **No GO for any of this here.** This note only reports; a 26.04 build batch needs the lead's written GO like any other paid batch.

**Recommendation:** keep the test servers on 24.04 until a quiet slot. Then run one G0-style build batch with `--image ubuntu-26.04`. If it passes, switch the default, so that the test servers match the bot's OS.
