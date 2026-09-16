#!/usr/bin/env bash
# Build the wasm Forge engine and stage it at packages/forge-wasm/, next to the
# worker; the client and the npm package import all three through the bundler,
# which hashes their names. Used locally (yarn build:forge-wasm)
# and by the web legs of staging-deploy.yml and docker-images.yml. The harness jar is built with the
# same GraalVM that native-image runs from, so no second JDK version has to be
# reconciled with the one Web Image supports.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${WEBIMAGE_GRAALVM_HOME:?point at an Oracle GraalVM with Web Image (--tool:svm-wasm)}"
export JAVA_HOME="$WEBIMAGE_GRAALVM_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

cd "$REPO_ROOT"
node scripts/harness.mjs build

RES=forge/forge-gui/res
BUNDLE="$REPO_ROOT/target/forge-assets-framed.txt"
cargo run --release -p forge-cardset-archive --features build --bin build-cardset-archive -- \
  "$RES/cardsfolder" "$RES/tokenscripts" "$RES/editions" "$RES/blockdata" \
  "$RES/lists/TypeLists.txt" "$REPO_ROOT/target/forge-cardset.rkyv"
cargo run --release -p forge-cardset-archive --bin emit-forge-assets -- \
  "$REPO_ROOT/target/forge-cardset.rkyv" "$BUNDLE"
FORGE_ASSETS="$BUNDLE" forge-harness/build-wasm.sh "$@"

cp forge-harness/native/wasm/forgeharness.js \
  forge-harness/native/wasm/forgeharness.js.wasm packages/forge-wasm/
echo "staged packages/forge-wasm/forgeharness.js{,.wasm}"
