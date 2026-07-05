# syntax=docker/dockerfile:1
#
# Headless engine node that hosts N concurrent rooms by spawning one Java Forge
# subprocess per game (line-delimited JSON-RPC over stdin/stdout, modelled on
# parity's --server pool). Each game owns its own JVM, so Forge's static
# counters can't race across games. The Rust backend exists too
# (SELF_HOSTED_NODE_ENGINE_BACKEND=manabrew) but this image defaults to forge.

# ── Stage 0: Generate Java prompt protocol classes ──────────────────
FROM rust:1.88-bookworm AS protocol-builder

WORKDIR /build

RUN apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/
COPY scripts/gen-harness-prompts.mjs scripts/gen-harness-prompts.mjs

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo run -q -p manabrew-protocol --bin gen-protocol -- src/protocol && \
    node scripts/gen-harness-prompts.mjs /generated

# ── Stage 1: Build the Java Forge harness JAR ───────────────────────
# Mirrors parity/Dockerfile — the harness jar bundles forge-core / game
# / ai / gui and exposes forge.harness.ManaBrewEngineAdapter, the class j4rs
# instantiates.
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

# ── Stage 2: Build the Rust node ─────────────────────────────────────
# Pure Rust build — no JDK needed at compile time. Java only runs at the
# subprocess boundary (stage 3 ships the runtime JRE).
FROM rust:1.88-bookworm AS rust-builder

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/
COPY public/preset_decks/ public/preset_decks/
# Stub the non-engine workspace members cargo metadata validates (mirrors
# manabrew-server's Dockerfile).
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo build --release -p self-hosted-node --features java-forge && \
    cp /build/target/release/self-hosted-node /usr/local/bin/self-hosted-node

# ── Stage 3: Runtime (Temurin 21 JRE) ────────────────────────────────
# Each game runs in its own `java` subprocess spawned by the node, so the
# runtime image needs the JRE on PATH. JRE 21 happily runs the harness's
# release-17 bytecode (Forge's maven.compiler.release=17), so the build stage
# can stay on Temurin 17 even though the runtime is 21.
# The node resolves Forge assets / TypeLists / preset decks relative to its
# compile-time workspace root (/build), so the image reproduces that layout.
FROM eclipse-temurin:21-jre-jammy

COPY --from=rust-builder /usr/local/bin/self-hosted-node /usr/local/bin/self-hosted-node
COPY --from=java-builder /build/forge-harness/target/forge-harness-jar-with-dependencies.jar \
    /build/forge-harness/target/forge-harness-jar-with-dependencies.jar
COPY forge/forge-gui/res/ /build/forge/forge-gui/res/
COPY public/preset_decks/ /build/public/preset_decks/

WORKDIR /build

ENV SELF_HOSTED_NODE_ENGINE_BACKEND=forge
ENV SELF_HOSTED_NODE_JAVA_HOME=/opt/java/openjdk
# Default to the in-compose relay; compose overrides as needed.
ENV FORGE_RELAY_URL=ws://manabrew-server:9443

ENTRYPOINT ["self-hosted-node"]
