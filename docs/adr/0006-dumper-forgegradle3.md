# ADR 0006: The dumper mod builds with ForgeGradle 3 (amends ADR 0004)

- Status: accepted
- Date: 2026-11-01
- Author: rotn-lead

## Context

ADR 0004 chose a small server-side Forge 1.12.2 mod (`tools/dumper/`) as the data source and named the toolchain "JDK 8 / Gradle 4.x / ForgeGradle 2.3".

When harness-ops first tried to build it in CI (run 41338011357), ForgeGradle 2.3 failed with `Could not find net.minecraftforge:forge:1.12.2-14.23.5.2860` in `:extractUserdev`. Forge's maven no longer serves the FG2 userdev artifact for this build (`-userdev.jar` returns 404).

The PR #34 reviewer checked maven.minecraftforge.net on 2026-11-01 and found:

- `ForgeGradle 3.0.197`
- `forge-1.12.2-14.23.5.2860-userdev3.jar`
- `mcp_stable-39-1.12`
- `mcp_config-1.12.2`

All four are available. FG 3.0.x supports Gradle 4.9 to 4.10.3.

## Decision

- The dumper builds with **ForgeGradle 3.0.197** on **Gradle 4.10.3**, verified by SHA-256 in `tools/dumper/build.sh`.
- It uses Forge **14.23.5.2860** and mappings **stable 39-1.12**, with `reobfJar`, under **Temurin JDK 8** (set up by the CI workflow; `build.sh` checks for a JDK 8).
- CI builds it in `.github/workflows/dumper-build.yml` (PR #40): pull requests and develop, path-filtered, SHA-pinned actions, no secrets. The jar is a workflow artifact and is never committed.
- FG3's POM pulls `artifactural:1.0.+`, a floating version, so the jar is not byte-reproducible. Provenance therefore comes from the SHA-256 of the jar each dump ran with, recorded in the dump manifest. **This is a lead requirement on PR #34, still to implement before merge**: today `writeManifest` records only `modListSha256`, Forge, dumper version and mods.

Everything else in ADR 0004 stands: the mod runs only on the disposable test server, and output is keyed by registry name plus metadata. PR #34's review added two further rules, which this ADR makes binding: the mod runs only when the opt-in `rotn-dump.enable` marker exists, and it writes only its own output folder.

## Consequences

- A PR changing `tools/dumper/**` needs a green `dumper-build` check before merge.
- Follow-up for harness-ops: the merged workflow's header comment and step name still say "ForgeGradle 2.3-1.0.8" (stale text; it builds FG3 correctly).
- Plugin and dependency downloads are pinned by version but not checksum-verified (Gradle 4.10 has no dependency verification). This is accepted for a mod that only runs on the test server.
