# syntax=docker/dockerfile:1
#
# Headless engine node hosting N rooms against ONE in-process Forge engine:
# native-image compiles the harness to a shared library (`graal-forge`) and every
# room attaches to one isolate, so the 34k-card database is loaded once per node.

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
# The same build-native.sh the desktop builds use, so the image cannot drift
# from a local build. Keyed on the jar, so a Rust-only change reuses the layer.
FROM ghcr.io/graalvm/native-image-community:21 AS native-builder

WORKDIR /build

COPY forge-harness/build-native.sh   forge-harness/build-native.sh
COPY forge-harness/native/           forge-harness/native/
COPY forge/forge-gui/res/languages/  forge/forge-gui/res/languages/
COPY --from=java-builder /build/forge-harness/target/forge-harness-jar-with-dependencies.jar \
    forge-harness/target/forge-harness-jar-with-dependencies.jar

ENV GRAALVM_HOME=${JAVA_HOME}
# -J-Xmx caps the BUILD jvm, which otherwise sizes itself from the whole runner.
# -R: bakes a RUNTIME default. The percentage is of the cgroup limit, but RSS is
# not the live set: the collector commits toward its max and is slow to hand
# pages back, and image heap, GC bookkeeping and thread stacks sit outside the
# cap entirely. At 70% of a 2GB limit the node reached that limit and ran in
# permanent reclaim instead of collecting (#729). 55% leaves headroom until a
# heap dump says what the real ceiling should be.
ARG FORGE_MAX_HEAP_PERCENT=55
RUN chmod +x forge-harness/build-native.sh && \
    ./forge-harness/build-native.sh -J-Xmx8g \
      -R:MaximumHeapSizePercent=${FORGE_MAX_HEAP_PERCENT}

# ── Stage 3: Build the Rust node ─────────────────────────────────────
# `graal-forge` links libforgeharness at build time, so the library must land
# before the dependency cook — build.rs links chef's stand-in binary too.
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
# No JRE: the engine is a .so in the node's own address space. Same distro as the
# builder for glibc, and /build reproduces the compile-time workspace root the
# node resolves Forge assets and preset decks against.
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
# One isolate for every room: the card database is loaded once per node.
ENV SELF_HOSTED_NODE_SHARED_ISOLATE=1
ENV LD_LIBRARY_PATH=/build/forge-harness/native/build
# Default to the in-compose relay; compose overrides as needed.
ENV FORGE_RELAY_URL=ws://manabrew-server:9443

ENTRYPOINT ["self-hosted-node"]
