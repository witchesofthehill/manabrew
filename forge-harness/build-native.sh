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
# Tracked snapshot of the non-forge reachability metadata (library/JDK reflection,
# resources, JNI, serialization) captured once with the tracing agent. The agent
# run is gone — gen-config below owns the entire forge.* closed world generatively,
# so nothing depends on a sample game anymore. To refresh the JDK/library slice
# after a dependency bump, re-run the agent by hand and diff the result in.
CFG="$HARNESS_DIR/native/frozen-config"
OUT="$HARNESS_DIR/native/build"
LANGS="$REPO_ROOT/forge/forge-gui/res/languages"

[ -x "$NATIVE_IMAGE" ] || { echo "native-image not found at $NATIVE_IMAGE"; exit 1; }
[ -f "$JAR" ] || { echo "fat jar missing — run: yarn build:harness"; exit 1; }

echo "==> compiling ForgeNative with GraalVM javac"
rm -rf "$CLASSES"; mkdir -p "$CLASSES"
"$JAVAC" -cp "$JAR" -d "$CLASSES" "$SRC"

#  - forge.harness.{protocol,host}: Gson DTOs (prompts/actions) serialized and
#    deserialized reflectively → need fields (the "type" discriminator is a field).
echo "==> generating reflect-config for reflectively-accessed classes"
GEN="$HARNESS_DIR/native/gen-config"
rm -rf "$GEN"; mkdir -p "$GEN"
JAR_BIN="$GRAALVM_HOME/bin/jar"
{
  "$JAR_BIN" --list --file "$JAR" \
    | grep -E '^forge/.*\.class$' \
    | grep -vE '^forge/harness/(protocol|host)/' \
    | sed 's#\.class$##; s#/#.#g' \
    | sed 's/$/\t"allDeclaredConstructors":true/'
  "$JAR_BIN" --list --file "$JAR" \
    | grep -E '^forge/harness/(protocol|host)/[^/]+\.class$' \
    | sed 's#\.class$##; s#/#.#g' \
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
