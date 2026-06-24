#!/usr/bin/env bash
# Builds libforgeharness.<dylib|so> from the forge-harness fat jar + the
# ForgeNative @CEntryPoint layer, using GraalVM native-image.
#
# The Forge maven build is untouched: ForgeNative lives under native/ (outside
# src/main/java) and is compiled here with GraalVM's javac, which ships the
# org.graalvm.nativeimage module the @CEntryPoint API lives in.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HARNESS_DIR/.." && pwd)"

GRAALVM_HOME="${GRAALVM_HOME:-$HOME/.local/graalvm/graalvm-community-openjdk-21.0.2+13.1/Contents/Home}"
JAVAC="$GRAALVM_HOME/bin/javac"
NATIVE_IMAGE="$GRAALVM_HOME/bin/native-image"

JAR="$HARNESS_DIR/target/forge-harness-jar-with-dependencies.jar"
SRC="$HARNESS_DIR/native/forge/harness/ffi/ForgeNative.java"
CLASSES="$HARNESS_DIR/native/classes"
CFG="$HARNESS_DIR/native/native-image-config"
OUT="$HARNESS_DIR/native/build"
LANGS="$REPO_ROOT/forge/forge-gui/res/languages"

[ -x "$NATIVE_IMAGE" ] || { echo "native-image not found at $NATIVE_IMAGE"; exit 1; }
[ -f "$JAR" ] || { echo "fat jar missing — run: yarn build:harness"; exit 1; }

# Capture native-image reachability metadata (reflect/resource/jni/serialization)
# by running a sample game under the tracing agent. Cached after the first run;
# delete native/native-image-config to force a fresh capture (e.g. after a Forge
# bump). gen-config (below) covers the by-name class families comprehensively;
# this captures everything else the agent observes.
if [ ! -d "$CFG" ]; then
  echo "==> capturing native-image metadata via tracing agent (sample game)"
  mkdir -p "$CFG"
  ( cd "$REPO_ROOT" && "$GRAALVM_HOME/bin/java" \
      -agentlib:native-image-agent=config-output-dir="$CFG" \
      -Djava.awt.headless=true \
      -jar "$JAR" --deck1 red_burn --deck2 green_stompy --seed 42 --max-turns 8 \
      >/dev/null 2>&1 )
fi

echo "==> compiling ForgeNative with GraalVM javac"
rm -rf "$CLASSES"; mkdir -p "$CLASSES"
"$JAVAC" -cp "$JAR" -d "$CLASSES" "$SRC"

# A tracing run only captures the subset a single game touches. Register the
# whole closed sets from the jar so any card / any prompt works:
#  - forge.game.{trigger,replacement,...}: instantiated reflectively by name
#    (TriggerType/ReplacementType/ApiType/CostType) → need constructors.
#  - forge.harness.{protocol,host}: Gson DTOs (prompts/actions) serialized and
#    deserialized reflectively → need fields (the "type" discriminator is a field).
echo "==> generating reflect-config for reflectively-accessed classes"
GEN="$HARNESS_DIR/native/gen-config"
rm -rf "$GEN"; mkdir -p "$GEN"
JAR_BIN="$GRAALVM_HOME/bin/jar"
{
  "$JAR_BIN" --list --file "$JAR" \
    | grep -E '^forge/game/(trigger|replacement|ability/effects|ability/ai|staticability|cost)/[^/]*\.class$' \
    | grep -v '\$' | sed 's#\.class$##; s#/#.#g' \
    | sed 's/$/\t"allDeclaredConstructors":true/'
  "$JAR_BIN" --list --file "$JAR" \
    | grep -E '^forge/harness/(protocol|host)/[^/]*\.class$' \
    | grep -v '\$' | sed 's#\.class$##; s#/#.#g' \
    | sed 's/$/\t"allDeclaredFields":true,"allDeclaredConstructors":true,"allDeclaredMethods":true/'
} | sort -u \
  | awk -F'\t' 'BEGIN{print "["} {if(NR>1)printf ",\n"; printf "  {\"name\":\"%s\",%s}", $1, $2} END{print "\n]"}' \
  > "$GEN/reflect-config.json"
echo "    registered $(grep -c '"name"' "$GEN/reflect-config.json") classes for reflection"

echo "==> native-image --shared → libforgeharness"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$OUT"
EXTRA="$HARNESS_DIR/native/extra-config"
CONFIG_ARG=""
[ -d "$CFG" ] && CONFIG_ARG="-H:ConfigurationFileDirectories=$CFG,$EXTRA,$GEN"
"$NATIVE_IMAGE" \
  --shared \
  -H:Name=forgeharness \
  -cp "$JAR:$CLASSES:$LANGS" \
  -H:IncludeResourceBundles=en-US \
  --no-fallback \
  --report-unsupported-elements-at-runtime \
  -H:+ReportExceptionStackTraces \
  --initialize-at-run-time=org.tinylog,org.slf4j,io.netty,forge,org.apache.commons.lang3 \
  -Djava.awt.headless=true \
  $CONFIG_ARG \
  "$@"

# Rust links `-l forgeharness`, which resolves to the lib-prefixed name.
if [ -f "$OUT/forgeharness.dylib" ]; then
  cp "$OUT/forgeharness.dylib" "$OUT/libforgeharness.dylib"
  install_name_tool -id "@rpath/libforgeharness.dylib" "$OUT/libforgeharness.dylib"
  # arm64 macOS refuses to load unsigned dylibs; ad-hoc sign so the bundled
  # .app can dlopen it even when the build is otherwise unsigned.
  codesign --force --sign - "$OUT/libforgeharness.dylib"
elif [ -f "$OUT/forgeharness.so" ]; then
  cp "$OUT/forgeharness.so" "$OUT/libforgeharness.so"
fi

echo "==> built:"
ls -la "$OUT"
