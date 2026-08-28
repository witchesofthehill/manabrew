#!/usr/bin/env bash
# Build the wasm Forge engine and stage it at public/forge/, the path
# forge-engine.worker.js loads it from. Used locally (yarn build:forge-wasm)
# and by the web leg of staging-deploy.yml. The harness jar is built with the
# same GraalVM that native-image runs from, so no second JDK version has to be
# reconciled with the one Web Image supports.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${WEBIMAGE_GRAALVM_HOME:?point at an Oracle GraalVM with Web Image (--tool:svm-wasm)}"
export JAVA_HOME="$WEBIMAGE_GRAALVM_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

cd "$REPO_ROOT"
node scripts/harness.mjs build
forge-harness/build-wasm.sh "$@"

mkdir -p public/forge
cp forge-harness/native/wasm/forgeharness.js \
  forge-harness/native/wasm/forgeharness.js.wasm public/forge/
echo "staged public/forge/forgeharness.js{,.wasm}"
