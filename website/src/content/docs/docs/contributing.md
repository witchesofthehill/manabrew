---
title: Contributing
description: How the ManaBrew project is organized and where to start helping.
---

ManaBrew is GPL-3.0-or-later and developed in the open at
[github.com/witchesofthehill/manabrew](https://github.com/witchesofthehill/manabrew).
Read the repository's
[CONTRIBUTING guide](https://github.com/witchesofthehill/manabrew/blob/main/CONTRIBUTING.md)
before opening a pull request.

## How the repository is organized

| Area           | Path                   | Stack                    |
| -------------- | ---------------------- | ------------------------ |
| Client UI      | `src/`                 | React + TypeScript       |
| Desktop shell  | `src-tauri/`           | Tauri (Rust)             |
| Rules engine   | `forge-engine/crates/` | Rust workspace           |
| Java reference | `forge/` (submodule)   | Forge, read-only         |
| Parity harness | `forge-parity/`        | Rust + Java side-by-side |
| This website   | `website/`             | Astro + Starlight        |

## The parity philosophy

The Rust engine is a port of Forge, not a reimplementation. Every engine change
mirrors the corresponding Java code — same file names, same control flow — and
is verified by a parity harness that runs both engines with identical decks,
seeds, and choices, then compares the game traces. Most contributions are
parity fixes: find a card that diverges, locate the rule the Rust port is
missing, and port it.

## Where to start

- Join the [Discord](https://discord.gg/NqrKpbhtcd) and say hi.
- Browse [open issues](https://github.com/witchesofthehill/manabrew/issues).
- Play a game at [manabrew.app](https://manabrew.app) and report anything that
  behaves differently from paper Magic.
