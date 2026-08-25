#!/usr/bin/env bash
# Spike: build the forge-harness fat jar into a Wasm module with GraalVM Web Image.
#
# This is build-native.sh with the --shared/@CEntryPoint layer swapped for the
# --tool:svm-wasm backend. The reachability metadata is deliberately identical:
# the whole point of the spike is that the closed-world config we already pay
# for on the native path carries over unchanged.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HARNESS_DIR/.." && pwd)"

# Web Image needs Oracle GraalVM 25.1+; the community 21 used by build-native.sh
# does not ship the backend.
GRAALVM_HOME="${WEBIMAGE_GRAALVM_HOME:-$HOME/.local/graalvm/graalvm-25.3.4.1-dev+0.1/Contents/Home}"
NATIVE_IMAGE="$GRAALVM_HOME/bin/native-image"
JAR_BIN="$GRAALVM_HOME/bin/jar"

JAR="${HARNESS_JAR:-$HARNESS_DIR/target/forge-harness-jar-with-dependencies.jar}"
CFG="$HARNESS_DIR/native/frozen-config"
EXTRA="$HARNESS_DIR/native/extra-config"
GEN="$HARNESS_DIR/native/gen-config-wasm"
OUT="$HARNESS_DIR/native/wasm"
WASM_SRC="$HARNESS_DIR/native/wasm-src"
WASM_CLASSES="$HARNESS_DIR/native/wasm-classes"
ENTRY="${ENTRY_CLASS:-forge.harness.wasm.WasmMain}"
LANGS="$REPO_ROOT/forge/forge-gui/res/languages"

[ -x "$NATIVE_IMAGE" ] || { echo "native-image not found at $NATIVE_IMAGE"; exit 1; }
[ -f "$JAR" ] || { echo "fat jar missing at $JAR"; exit 1; }
command -v wasm-as >/dev/null || { echo "binaryen (wasm-as) not on PATH"; exit 1; }

# -parameters is mandatory: Web Image infers @JS snippet argument names from the
# method's parameter names and fails the build outright without it.
echo "==> compiling WasmMain (@JS bootstrap layer)"
rm -rf "$WASM_CLASSES"; mkdir -p "$WASM_CLASSES"
"$GRAALVM_HOME/bin/javac" -parameters --add-modules org.graalvm.webimage.api \
  -cp "$JAR" -d "$WASM_CLASSES" $(find "$WASM_SRC" -name '*.java')

echo "==> generating reflect-config (same closure as build-native.sh)"
rm -rf "$GEN"; mkdir -p "$GEN"
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

echo "==> native-image --tool:svm-wasm"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$OUT"
# --tool:svm-wasm must come first, and every Wasm-backend option after it.
"$NATIVE_IMAGE" \
  --tool:svm-wasm \
  -H:WasmComments=NONE \
  -H:Name=forgeharness \
  -cp "$JAR:$WASM_CLASSES:$LANGS" \
  -H:IncludeResourceBundles=en-US \
  --no-fallback \
  --report-unsupported-elements-at-runtime \
  -H:+ReportExceptionStackTraces \
  --initialize-at-run-time=org.tinylog,org.slf4j,io.netty,forge,org.apache.commons.lang3 \
  --initialize-at-build-time=com.google.common.util.concurrent \
  -Djava.awt.headless=true \
  -H:ConfigurationFileDirectories="$CFG,$EXTRA,$GEN" \
  "$@" \
  "$ENTRY"

# The generated launcher derives the module URL from whatever file is executing
# (`runtime.getCurrentFile() + ".wasm"`), which in a worker is the worker's own
# name, not this module's. Pin it instead, so the host is free to name its
# worker anything and no duplicate copy of the module is needed.
echo "==> pinning wasm_path in the launcher"
python3 - "$OUT/forgeharness.js" <<'PIN'
import sys
path = sys.argv[1]
src = open(path).read()
needle = "const config = new GraalVM.Config();"
if "wasm_path" in src.split(needle)[-1][:200]:
    print("    already pinned")
else:
    pin = (needle + '\nconfig.wasm_path = new URL("forgeharness.js.wasm", '
           'typeof document !== "undefined" && document.currentScript '
           '? document.currentScript.src : self.location.href).href;')
    assert needle in src, "launcher bootstrap not found"
    open(path, "w").write(src.replace(needle, pin, 1))
    print("    pinned")
PIN

echo "==> built:"
ls -la "$OUT"
