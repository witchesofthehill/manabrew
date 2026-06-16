---
title: Contributing
description: How the Manabrew project is organized and where to start helping.
---

Manabrew is GPL-3.0-or-later and developed in the open at
[github.com/witchesofthehill/manabrew](https://github.com/witchesofthehill/manabrew).
Read the repository's
[CONTRIBUTING guide](https://github.com/witchesofthehill/manabrew/blob/main/CONTRIBUTING.md)
before opening a pull request.

## How the repository is organized

| Area           | Path                  | Stack                    |
| -------------- | --------------------- | ------------------------ |
| Client UI      | `src/`                | React + TypeScript       |
| Desktop shell  | `src-tauri/`          | Tauri (Rust)             |
| Rules engine   | `manabrew-rs/crates/` | Rust workspace           |
| Java reference | `forge/` (submodule)  | Forge, read-only         |
| Parity harness | `parity/`             | Rust + Java side-by-side |
| This website   | `website/`            | Astro + Starlight        |

## The parity philosophy

The Rust engine is a port of Forge, not a reimplementation. Every engine change
mirrors the corresponding Java code — same file names, same control flow — and
is verified by a parity harness that runs both engines with identical decks,
seeds, and choices, then compares the game traces. Most contributions are
parity fixes: find a card that diverges, locate the rule the Rust port is
missing, and port it.

## AI-assisted development

Manabrew is developed with substantial AI assistance, openly. The workflow
suits it: Java Forge is an external oracle, so a model can propose an engine
fix but the parity harness decides whether behavior actually matches. AI is
never treated as a rules authority. If you use AI in a contribution, review the
generated diff yourself, test it, and make sure every behavioral claim traces
back to Forge or a documented convention — see
[AI_USAGE.md](https://github.com/witchesofthehill/manabrew/blob/main/docs/AI_USAGE.md).

## Building your own client or engine

The wire protocol between frontends and engine backends is specified in
[PROTOCOL.md](https://github.com/witchesofthehill/manabrew/blob/main/docs/PROTOCOL.md)
— message shapes, game-state snapshots, prompts, and actions. Unlike the
GPL-licensed implementation, the spec itself is CC-BY-4.0, so independent
clients and engines can implement it without license entanglement.

## Where to start

- Join the [Discord](https://discord.gg/NqrKpbhtcd) and say hi.
- Browse [open issues](https://github.com/witchesofthehill/manabrew/issues).
- Play a game at [manabrew.app](https://play.manabrew.app) and report anything that
  behaves differently from paper Magic.

## Community standards

All project spaces follow the
[Code of Conduct](https://github.com/witchesofthehill/manabrew/blob/main/CODE_OF_CONDUCT.md).
Security vulnerabilities go through
[private reporting](https://github.com/witchesofthehill/manabrew/blob/main/SECURITY.md),
never public issues.
