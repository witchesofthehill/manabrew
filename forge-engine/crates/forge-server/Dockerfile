# syntax=docker/dockerfile:1
FROM rust:1.88-bookworm AS builder

WORKDIR /build

# Workspace manifests + lockfile
COPY Cargo.toml Cargo.lock ./

# Workspace crates. forge-server only compiles forge-protocol now, but cargo
# needs every member's manifest to resolve the workspace, so copy the tree.
COPY forge-engine/ forge-engine/

# Stub the other workspace members that cargo metadata validates.
# src-tauri and tree-sitter-forge-card-script are declared in the root
# Cargo.toml; cargo refuses to compile anything until every member
# resolves, but forge-server never links against them.
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo build --release -p forge-server \
    && cp /build/target/release/forge-server /usr/local/bin/forge-server

# --- Runtime ---
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/forge-server /usr/local/bin/forge-server

ENV FORGE_HOST=0.0.0.0
ENV FORGE_PORT=9443
ENV FORGE_HEALTH_PORT=9444

EXPOSE 9443
EXPOSE 9444

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:9444/health || exit 1

ENTRYPOINT ["forge-server"]
