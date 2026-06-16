# syntax=docker/dockerfile:1
# ── Stage 1: Build Java harness JAR ─────────────────────────────────
FROM maven:3.9-eclipse-temurin-17 AS java-builder

# Cap JVM heap so Maven doesn't get OOM-killed when building alongside Rust
ENV MAVEN_OPTS="-Xmx512m"

WORKDIR /build

# Copy only POMs first so dependency download is cached separately.
# The root aggregator pom builds forge-harness in one reactor with the engine
# modules in forge/ that it depends on (resolves the engine's ${revision}).
COPY pom.xml                         pom.xml
COPY forge/pom.xml                   forge/pom.xml
COPY forge/checkstyle.xml            forge/checkstyle.xml

# Strip module declarations for modules excluded by .dockerignore
# (Maven validates all <module> entries exist before -pl filtering)
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

# Create stub source dirs so Maven resolves modules without error
RUN for m in forge/forge-core forge/forge-game forge/forge-ai forge/forge-gui forge-harness; do \
      mkdir -p "$m/src/main/java"; \
    done

# Download all dependencies (cached until a pom.xml changes)
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -pl forge-harness -am dependency:go-offline -Dcheckstyle.skip -q || true

# Now copy the real source code
COPY forge/forge-core/    forge/forge-core/
COPY forge/forge-game/    forge/forge-game/
COPY forge/forge-ai/      forge/forge-ai/
COPY forge/forge-gui/     forge/forge-gui/
COPY forge-harness/       forge-harness/

# Build the harness fat JAR in one reactor with its engine deps
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -pl forge-harness -am -DskipTests -Dcheckstyle.skip package -q

# ── Stage 2: Build Rust binary ──────────────────────────────────────
FROM rust:1.88-bookworm AS rust-builder

WORKDIR /build

# Copy workspace manifests for dependency caching
COPY Cargo.toml Cargo.lock ./
COPY manabrew-engine/ manabrew-engine/
COPY public/preset_decks/ public/preset_decks/
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
# tree-sitter-forge-card-script is also a workspace member (declared at the
# repo root, not under manabrew-engine/) so cargo metadata fails without it.
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/

# Card / token / edition / block data — inputs to the cardset rkyv archive
# that the parity binary loads at startup. Without this archive the binary
# crash-loops with "Cardset archive not found at src-tauri/resources/
# cardset.rkyv".
COPY forge/forge-gui/res/cardsfolder/   forge/forge-gui/res/cardsfolder/
COPY forge/forge-gui/res/tokenscripts/  forge/forge-gui/res/tokenscripts/
COPY forge/forge-gui/res/editions/      forge/forge-gui/res/editions/
COPY forge/forge-gui/res/blockdata/     forge/forge-gui/res/blockdata/

# Build parity binary + the build-cardset-archive helper, then run
# the helper to produce src-tauri/resources/cardset.rkyv at the path the
# parity runner expects. Copy both artefacts out of the cache mount.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo build --release -p parity --features analyze -p forge-cardset-archive \
    && /build/target/release/build \
    && cp /build/target/release/parity /usr/local/bin/parity \
    && cp src-tauri/resources/cardset.rkyv /usr/local/share/cardset.rkyv

# ── Stage 3: Runtime ────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-jammy

RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 curl \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=rust-builder /usr/local/bin/parity /appparity/
COPY --from=rust-builder /usr/local/share/cardset.rkyv /app/src-tauri/resources/cardset.rkyv
COPY --from=java-builder /build/forge-harness/target/forge-harness-jar-with-dependencies.jar /app/forge-harness.jar
COPY forge/forge-gui/res/ /app/forge-gui/res/
COPY public/preset_decks/ /app/preset_decks/

# Download MTG Comprehensive Rules for agent analysis
RUN curl -fsSL -o /app/mtg_rules.txt "https://media.wizards.com/2026/downloads/MagicCompRules%2020260227.txt" || true

ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

VOLUME /app/data

EXPOSE 8080

ENTRYPOINT ["/bin/sh", "-c", "\
    ARGS=\"--serve --port ${PORT:-8080} \
    --db-path /app/data/parity.db \
    --java-jar /app/forge-harness.jar \
    --cards-dir /app/forge-gui/res/cardsfolder \
    --decks-dir /app/preset_decks \
    --java-heap ${JAVA_HEAP:-512m} \
    --threshold ${THRESHOLD:-0.90} \
    --fuzz-per-batch ${FUZZ_PER_BATCH:-0} \
    --max-turns ${MAX_TURNS:-10}\"; \
    if [ -n \"${MAX_GAMES}\" ]; then ARGS=\"${ARGS} --max-games ${MAX_GAMES}\"; fi; \
    if [ -n \"${DECKS}\" ]; then ARGS=\"${ARGS} --decks ${DECKS}\"; fi; \
    if [ -n \"${ANALYZE}\" ]; then ARGS=\"${ARGS} --analyze\"; fi; \
    if [ -n \"${POLL_INTERVAL}\" ]; then ARGS=\"${ARGS} --poll-interval ${POLL_INTERVAL}\"; fi; \
    if [ -n \"${SUMMARY_INTERVAL}\" ]; then ARGS=\"${ARGS} --summary-interval ${SUMMARY_INTERVAL}\"; fi; \
    if [ -n \"${ISSUE_THRESHOLD}\" ]; then ARGS=\"${ARGS} --issue-threshold ${ISSUE_THRESHOLD}\"; fi; \
    if [ -n \"${GITHUB_REPO}\" ]; then ARGS=\"${ARGS} --github-repo ${GITHUB_REPO}\"; fi; \
    if [ -n \"${EXTRA_ARGS}\" ]; then ARGS=\"${ARGS} ${EXTRA_ARGS}\"; fi; \
    exec /app/parity ${ARGS}"]
