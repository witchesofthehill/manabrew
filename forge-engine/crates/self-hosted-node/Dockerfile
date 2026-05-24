# syntax=docker/dockerfile:1
#
# Headless engine node running the *Java* Forge engine in-process via j4rs
# (a Rust facade over the canonical rules engine), so web "Play vs AI" gets a
# parity-correct server-side opponent. The Rust backend exists too
# (SELF_HOSTED_NODE_ENGINE_BACKEND=rust) but this image defaults to java.

# ── Stage 1: Build the Java Forge harness JAR ───────────────────────
# Mirrors forge-parity/Dockerfile — the harness jar bundles forge-core / game
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

RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -pl forge-harness -am -DskipTests -Dcheckstyle.skip package -q

# ── Stage 1b: Build the Espresso host router (JDK 21 + polyglot) ─────
# The router targets release 21 and pulls polyglot/espresso from Maven; it must
# NOT be an uber jar (that corrupts Truffle's multi-release classes), so it ships
# as a thin jar plus target/lib/ of dependency jars.
FROM maven:3.9-eclipse-temurin-21 AS espresso-host-builder
WORKDIR /host
COPY forge-engine/crates/self-hosted-node/java-espresso-host/ ./
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -q -DskipTests package

# ── Stage 2: Build the Rust node with the java-espresso feature ──────
# j4rs's build script needs a JDK (jni headers + jassets deployment), so this
# stage adds one on top of the Rust toolchain.
FROM rust:1.88-bookworm AS rust-builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends default-jdk-headless && \
    rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/default-java

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY forge-engine/ forge-engine/
COPY public/preset_decks/ public/preset_decks/
# Stub the non-engine workspace members cargo metadata validates (mirrors
# forge-server's Dockerfile).
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/

# Build the node with the java-forge backend, then copy the binary and the
# j4rs runtime jassets (which must sit next to the executable at runtime) out
# of the target cache mount.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo build --release -p self-hosted-node --features java-espresso && \
    cp /build/target/release/self-hosted-node /usr/local/bin/self-hosted-node && \
    cp -r /build/target/release/jassets /usr/local/bin/jassets

# ── Stage 3: Runtime (GraalVM, for Espresso) ─────────────────────────
# Espresso needs a GraalVM host JVM, so the runtime is Debian (matching the
# bookworm builder's glibc) plus the GraalVM CE tarball — j4rs loads libjvm from
# JAVA_HOME. The node resolves Forge assets / TypeLists / preset decks relative to
# its compile-time workspace root (/build), so the image reproduces that layout.
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN arch="$(dpkg --print-architecture | sed 's/amd64/x64/;s/arm64/aarch64/')" && \
    curl -fsSL "https://github.com/graalvm/graalvm-ce-builds/releases/download/jdk-25.0.2/graalvm-community-jdk-25.0.2_linux-${arch}_bin.tar.gz" \
      | tar xz -C /opt && \
    mv /opt/graalvm-community-openjdk-* /opt/graalvm
ENV JAVA_HOME=/opt/graalvm
ENV PATH="/opt/graalvm/bin:${PATH}"

COPY --from=rust-builder /usr/local/bin/self-hosted-node /usr/local/bin/self-hosted-node
COPY --from=rust-builder /usr/local/bin/jassets/ /usr/local/bin/jassets/
COPY --from=java-builder /build/forge-harness/target/forge-harness-jar-with-dependencies.jar \
     /build/forge-harness/target/forge-harness-jar-with-dependencies.jar
COPY --from=espresso-host-builder /host/target/manabrew-espresso-host.jar \
     /build/espresso-host/manabrew-espresso-host.jar
COPY --from=espresso-host-builder /host/target/lib/ /build/espresso-host/lib/
COPY forge/forge-gui/res/ /build/forge/forge-gui/res/
COPY public/preset_decks/ /build/public/preset_decks/

WORKDIR /build

ENV SELF_HOSTED_NODE_ENGINE_BACKEND=java
ENV SELF_HOSTED_NODE_JAVA_HOME=/opt/graalvm
ENV SELF_HOSTED_NODE_ESPRESSO_HOST_JAR=/build/espresso-host/manabrew-espresso-host.jar
# Default to the in-compose relay; compose overrides as needed.
ENV FORGE_RELAY_URL=ws://forge-server:9443

ENTRYPOINT ["self-hosted-node"]
