#!/usr/bin/env bash
# Builds the RotN dumper jar (tools/dumper, ADR 0004) with the pinned toolchain:
# JDK 8, Gradle 4.10.3 (downloaded and SHA-256 checked here), ForgeGradle 3.0.197,
# Forge 14.23.5.2860, MCP stable 39-1.12 (see build.gradle for why not ForgeGradle 2.3).
#
# Usage: tools/dumper/build.sh            -> tools/dumper/build/libs/rotndump-<version>.jar
# Env:   JAVA_HOME     a JDK 8 (required unless `java` on PATH is 1.8)
#        DUMPER_CACHE  where Gradle is unpacked (default: $HOME/.cache/rotndump)
# Runs in CI (harness-ops' workflow) or on the disposable test server. Never on the live server.
set -Eeuo pipefail

readonly GRADLE_VERSION=4.10.3
readonly GRADLE_SHA256=8626cbf206b4e201ade7b87779090690447054bc93f052954c78480fa6ed186e
readonly GRADLE_URL="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CACHE=${DUMPER_CACHE:-$HOME/.cache/rotndump}
die() { echo "build.sh: $*" >&2; exit 1; }

JAVA=${JAVA_HOME:+$JAVA_HOME/bin/}java
"$JAVA" -version 2>&1 | head -1 | grep -q '"1\.8\.' || die "need JDK 8 (got: $("$JAVA" -version 2>&1 | head -1)); set JAVA_HOME"
if [[ -n ${JAVA_HOME:-} ]]; then export JAVA_HOME; fi

GRADLE_HOME=$CACHE/gradle-$GRADLE_VERSION
if [[ ! -x $GRADLE_HOME/bin/gradle ]]; then
  mkdir -p "$CACHE"
  zip=$CACHE/gradle-$GRADLE_VERSION-bin.zip
  echo "build.sh: downloading Gradle $GRADLE_VERSION" >&2
  curl -fsSL --retry 3 -o "$zip.part" "$GRADLE_URL"
  got=$(sha256sum "$zip.part" | cut -d' ' -f1)
  [[ $got == "$GRADLE_SHA256" ]] || { rm -f "$zip.part"; die "Gradle zip SHA-256 $got != pinned $GRADLE_SHA256"; }
  mv "$zip.part" "$zip"
  (cd "$CACHE" && unzip -q -o "$zip")
fi

# The mod's VERSION constant and build.gradle's version must agree.
gv=$(sed -n "s/^version = '\([^']*\)'.*/\1/p" "$HERE/build.gradle")
jv=$(sed -n 's/.*String VERSION = "\([^"]*\)".*/\1/p' "$HERE/src/main/java/mindcraftrotn/dumper/RotnDump.java")
[[ -n $gv && $gv == "$jv" ]] || die "version mismatch: build.gradle '$gv', RotnDump.VERSION '$jv'"

"$GRADLE_HOME/bin/gradle" --no-daemon --stacktrace -p "$HERE" build

shopt -s nullglob
jar=''
for j in "$HERE"/build/libs/rotndump-*.jar; do
  case $j in *-sources.jar|*-dev.jar) ;; *) jar=$j; break ;; esac
done
[[ -n $jar ]] || die "no jar in $HERE/build/libs"
echo "build.sh: built $jar"
sha256sum "$jar"
