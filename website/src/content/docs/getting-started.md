---
title: Getting started
description: Play Manabrew in the browser, install the desktop app, or build from source.
---

## Play in the browser

The fastest way to try Manabrew is the web client at
[manabrew.app](https://play.manabrew.app). It runs the Manabrew engine compiled to
WebAssembly — nothing to install.

## Desktop app

Native installers are published on GitHub releases. Follow the platform
instructions:

- [Download for Windows](/download-windows/)
- [Download for macOS](/download-macos/)

## Card images

The client does not ship card images. They are fetched from
[Scryfall](https://scryfall.com) at runtime, so playing needs an internet
connection even in the desktop app.

## Build from source

You need [Node.js](https://nodejs.org) 22+, [Yarn v1](https://classic.yarnpkg.com),
and a [Rust](https://rustup.rs) toolchain. Desktop builds also need the
[Tauri platform prerequisites](https://tauri.app/start/prerequisites/); Java
(18+) and Maven are only required for Forge-backed games and parity runs.

```bash
git clone --recurse-submodules https://github.com/witchesofthehill/manabrew.git
cd manabrew
yarn install

# Web client Manabrew( engine compiled to WASM)
yarn web

# Desktop client (Tauri)
yarn dev
```

The `forge` submodule provides card scripts and the Java reference engine —
the `--recurse-submodules` flag matters.

### Initialize the submodule

If you cloned without `--recurse-submodules`, set it up before building:

```bash
git submodule update --init --recursive
```

### Update the submodule

The `forge` submodule is the whole Forge tree — the Java reference engine plus
card scripts, editions, and tokens (it tracks the `manabrew` branch). Pull the
latest commit and rebuild, since the harness, the WASM engine, and the card
archives all build from it:

```bash
git submodule update --remote forge
yarn build:harness   # rebuilds the Java harness + restages the Tauri card bundle
yarn web             # rebuilds the WASM engine and card archive (yarn dev does too)
```

Skipping the rebuild leaves stale builds; one visible symptom is the deck loader
removing any card not yet in the bundle — that "Removed from your deck" notice.

## Getting help

Questions, deck sharing, and bug reports all happen on
[Discord](https://discord.gg/NqrKpbhtcd). Issues are also welcome on
[GitHub](https://github.com/witchesofthehill/manabrew/issues).
