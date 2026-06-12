---
title: Getting started
description: Play ManaBrew in the browser, install the desktop app, or build from source.
---

## Play in the browser

The fastest way to try ManaBrew is the web client at
[manabrew.app](https://play.manabrew.app). It runs the Rust engine compiled to
WebAssembly — nothing to install.

## Desktop app

Native installers for macOS (`.dmg`) and Windows (`.exe`) are published on the
[GitHub releases page](https://github.com/witchesofthehill/manabrew/releases).

## Card images

The client does not ship card images. They are fetched from
[Scryfall](https://scryfall.com) at runtime, so playing needs an internet
connection even in the desktop app.

## Build from source

You need [Node.js](https://nodejs.org) 22+, [Yarn v1](https://classic.yarnpkg.com),
and a [Rust](https://rustup.rs) toolchain. Desktop builds also need the
[Tauri platform prerequisites](https://tauri.app/start/prerequisites/); Java
(18+) and Maven are only required for Java Forge-backed games and parity runs.

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
