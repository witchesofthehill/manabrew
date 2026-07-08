# syntax=docker/dockerfile:1
FROM rust:1.88-bookworm AS builder

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY manabrew-rs/ manabrew-rs/

# Stub the workspace members cargo metadata validates but manabrew-hub never links.
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
COPY tree-sitter-forge-card-script/ tree-sitter-forge-card-script/
COPY xtask/ xtask/

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo build --release -p manabrew-hub \
    && cp /build/target/release/manabrew-hub /usr/local/bin/manabrew-hub

FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/manabrew-hub /usr/local/bin/manabrew-hub

ENV HUB_HOST=0.0.0.0
ENV HUB_PORT=9500

EXPOSE 9500

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:9500/health || exit 1

ENTRYPOINT ["manabrew-hub"]
