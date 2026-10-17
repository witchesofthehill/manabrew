FROM node:24-bookworm-slim

COPY --from=rust:1.98-slim-bookworm /usr/local/rustup /usr/local/rustup
COPY --from=rust:1.98-slim-bookworm /usr/local/cargo /usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
ENV PATH="/usr/local/cargo/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
