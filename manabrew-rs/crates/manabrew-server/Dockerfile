# syntax=docker/dockerfile:1
# cargo-chef cooks the dependency graph into its own layer, keyed on the
# manifests alone. The CI layer cache (docker-images.yml, type=gha) cannot
# persist RUN --mount caches across runners, so every tag build used to
# recompile all deps from scratch — and image build time now gates the early
# web deploy (deploy.sh pulls these images with a retry loop). chef masks
# workspace-member versions, so the per-merge release bumps don't invalidate
# the cooked layer; only a real dependency change does.
FROM rust:1.88-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /build

# Workspace manifests + lockfile. manabrew-server only compiles
# manabrew-protocol now, but cargo needs every member's manifest to resolve
# the workspace, so copy the tree. src-tauri is stubbed: it is declared in
# the root Cargo.toml and cargo refuses to compile anything until every
# member resolves, but manabrew-server never links against it.
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json -p manabrew-server

COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/

RUN cargo build --release -p manabrew-server \
    && cp /build/target/release/manabrew-server /usr/local/bin/manabrew-server

# --- Runtime ---
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/manabrew-server /usr/local/bin/manabrew-server

ENV FORGE_HOST=0.0.0.0
ENV FORGE_PORT=9443
ENV FORGE_HEALTH_PORT=9444

EXPOSE 9443
EXPOSE 9444

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:9444/health || exit 1

ENTRYPOINT ["manabrew-server"]
