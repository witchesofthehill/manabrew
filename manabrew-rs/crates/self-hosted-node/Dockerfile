# syntax=docker/dockerfile:1
#
# Headless engine node that hosts N concurrent rooms against ONE in-process
# Forge engine: the harness is compiled to a native shared library by GraalVM
# native-image (feature `graal-forge`), every room attaches a thread to a shared
# isolate, and the 34k-card database is paid for once for the whole node instead
# of once per game. That is what lets a preview node sit next to production on a
# 2-core box. The subprocess-per-game JVM backend still exists
# (`--features java-forge`) but this image no longer ships a JVM.

# ── cargo-chef base + shared dependency recipe ───────────────────────
# See manabrew-server's Dockerfile for why chef. One planner feeds both Rust
# stages below (debug deps for gen-protocol, release deps for the node).
FROM rust:1.88-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /build

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 0: Generate Java prompt protocol classes ──────────────────
FROM chef AS protocol-builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --recipe-path recipe.json -p manabrew-relay-protocol

COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/
COPY scripts/gen-harness-prompts.mjs scripts/gen-harness-prompts.mjs

RUN cargo run -q -p manabrew-relay-protocol --bin gen-protocol -- src/protocol && \
    node scripts/gen-harness-prompts.mjs /generated

# ── Stage 1: Build the Java Forge harness JAR ───────────────────────
# Mirrors parity/Dockerfile — the harness jar bundles forge-core / game
# / ai / gui and exposes forge.harness.ManaBrewEngineAdapter, the class the
# native library's C entry points call into.
FROM maven:3.9-eclipse-temurin-17 AS java-builder

ENV MAVEN_OPTS="-Xmx512m"
WORKDIR /build

COPY pom.xml                         pom.xml
COPY forge/pom.xml                   forge/pom.xml
COPY forge/checkstyle.xml            forge/checkstyle.xml

# Strip module declarations for modules excluded by .dockerignore
# (Maven validates all <module> entries exist before -pl filtering).
RUN sed -i '/<module>forge-gui-mobile<\/module>/d; \
    /<module>forge-gui-mobile-dev<\/module>/d; \
    /<module>forge-gui-desktop<\/module>/d; \
    /<module>forge-gui-ios<\/module>/d; \
    /<module>forge-lda<\/module>/d; \
    /<module>adventure-editor<\/module>/d; \
    /<module>forge-gui-android<\/module>/d; \
    /<module>forge-installer<\/module>/d' forge/pom.xml

COPY forge/forge-core/pom.xml        forge/forge-core/pom.xml
COPY forge/forge-game/pom.xml        forge/forge-game/pom.xml
COPY forge/forge-ai/pom.xml          forge/forge-ai/pom.xml
COPY forge/forge-gui/pom.xml         forge/forge-gui/pom.xml
COPY forge-harness/pom.xml           forge-harness/pom.xml

RUN for m in forge/forge-core forge/forge-game forge/forge-ai forge/forge-gui forge-harness; do \
    mkdir -p "$m/src/main/java"; \
    done

RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -pl forge-harness -am dependency:go-offline -Dcheckstyle.skip -q || true

COPY forge/forge-core/    forge/forge-core/
COPY forge/forge-game/    forge/forge-game/
COPY forge/forge-ai/      forge/forge-ai/
COPY forge/forge-gui/     forge/forge-gui/
COPY forge-harness/       forge-harness/
COPY --from=protocol-builder /generated/forge/harness/protocol/ \
    forge-harness/src/main/java/forge/harness/protocol/

RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -pl forge-harness -am -DskipTests -Dcheckstyle.skip package -q

# ── Stage 2: GraalVM native-image → libforgeharness.so ──────────────
# Runs the same build-native.sh the desktop/laptop builds use, so the image
# cannot drift from what a developer gets locally. native-image wants several
# GB and several minutes; the stage is keyed on the jar and the tracked
# reachability config, so a Rust-only change reuses it from the layer cache.
FROM ghcr.io/graalvm/native-image-community:21 AS native-builder

WORKDIR /build

COPY forge-harness/build-native.sh   forge-harness/build-native.sh
COPY forge-harness/native/           forge-harness/native/
COPY forge/forge-gui/res/languages/  forge/forge-gui/res/languages/
COPY --from=java-builder /build/forge-harness/target/forge-harness-jar-with-dependencies.jar \
    forge-harness/target/forge-harness-jar-with-dependencies.jar

ENV GRAALVM_HOME=${JAVA_HOME}
# -J-Xmx caps the BUILD jvm: native-image otherwise sizes its heap from the
# whole machine, and a CI runner has to leave room for buildkit and the other
# matrix images. -R: sets a RUNTIME default baked into the library: the image
# heap tops out at 70% of the container's memory limit, leaving the other 30%
# for the image's own code and data, the Rust side, and native allocations. The
# default is 80%, which is enough to get the container OOM-killed before the
# collector ever sees the cap.
RUN chmod +x forge-harness/build-native.sh && \
    ./forge-harness/build-native.sh -J-Xmx8g -R:MaximumHeapSizePercent=70

# ── Stage 3: Build the Rust node ─────────────────────────────────────
# `graal-forge` links libforgeharness at build time, so the library has to be
# in place before the dependency cook: build.rs emits the link flags for every
# artifact in this stage, including chef's stand-in binary.
FROM chef AS rust-builder

ENV FORGE_NATIVE_LIB_DIR=/build/forge-harness/native/build
COPY --from=native-builder /build/forge-harness/native/build/ \
    /build/forge-harness/native/build/

COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json -p self-hosted-node --features graal-forge

COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/
COPY public/preset_decks/ public/preset_decks/
# Stub the non-engine workspace members cargo metadata validates (mirrors
# manabrew-server's Dockerfile).
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/

RUN cargo build --release -p self-hosted-node --features graal-forge && \
    cp /build/target/release/self-hosted-node /usr/local/bin/self-hosted-node

# ── Stage 4: Runtime ─────────────────────────────────────────────────
# No JRE: the engine is libforgeharness.so, loaded into the node's own address
# space. Same distro as the Rust builder so the binary's glibc matches.
# The node resolves Forge assets / preset decks relative to its compile-time
# workspace root (/build), so the image reproduces that layout.
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates zlib1g && \
    rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /usr/local/bin/self-hosted-node /usr/local/bin/self-hosted-node
COPY --from=native-builder /build/forge-harness/native/build/libforgeharness.so \
    /build/forge-harness/native/build/libforgeharness.so
COPY forge/forge-gui/res/ /build/forge/forge-gui/res/
COPY public/preset_decks/ /build/public/preset_decks/

WORKDIR /build

ENV SELF_HOSTED_NODE_ENGINE_BACKEND=forge
# One isolate for every room, so the card database is loaded once per node
# rather than once per game.
ENV SELF_HOSTED_NODE_SHARED_ISOLATE=1
ENV LD_LIBRARY_PATH=/build/forge-harness/native/build
# Default to the in-compose relay; compose overrides as needed.
ENV FORGE_RELAY_URL=ws://manabrew-server:9443

ENTRYPOINT ["self-hosted-node"]
