---
title: Getting started
description: Play ManaBrew in the browser, install the desktop app, or build from source.
---

## Play in the browser

The fastest way to try ManaBrew is the web client at
[manabrew.app](https://manabrew.app). It runs the Rust engine compiled to
WebAssembly — nothing to install.

## Desktop app

Native installers for macOS (`.dmg`) and Windows (`.exe`) are published on the
[GitHub releases page](https://github.com/witchesofthehill/manabrew/releases).

## Build from source

You need [Node.js](https://nodejs.org) 20+, [Yarn](https://classic.yarnpkg.com),
and a [Rust](https://rustup.rs) toolchain.

```bash
git clone --recurse-submodules https://github.com/witchesofthehill/manabrew.git
cd manabrew
yarn install

# Web client (Rust engine compiled to WASM)
yarn dev:web

# Desktop client (Tauri)
yarn dev
```

The `forge` submodule provides card scripts and the Java reference engine —
the `--recurse-submodules` flag matters.

## Getting help

Questions, deck sharing, and bug reports all happen on
[Discord](https://discord.gg/NqrKpbhtcd). Issues are also welcome on
[GitHub](https://github.com/witchesofthehill/manabrew/issues).
