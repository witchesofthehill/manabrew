---
title: Formats & limitations
description: What the engine supports today, and where the edges are.
---

ManaBrew is pre-release software built around an in-progress Rust port of the
Forge rules engine. This page is the honest version of "what works".

## Formats

The engine and client recognize: **Commander**, **Standard**, **Pioneer**,
**Modern**, **Legacy**, **Vintage**, **Pauper**, **Brawl**, **Oathbreaker**,
**Draft**, **Sealed**, and **Any** (no restrictions). The format drives deck
rules, starting life, and the editor's legality badges.

For limited play, **Booster Draft**, **Sealed**, **Winston Draft**, and
**Cube** are available, with boosters generated from real set and edition
data.

## Card coverage

The card database parses Forge's full library of 32,000+ card scripts, but
the ManaBrew engine does not implement every mechanic those scripts use yet.
What that means in practice:

- The deck editor checks every card against the engine and flags ones it
  can't run with an **unsupported** badge — check your deck before a game,
  not during one.
- Coverage grows parity-first: each fix is verified against Forge's
  behavior with identical seeds and choices, and locked in by a regression
  suite.
- The engine is swappable: rooms hosted on the original Forge engine via
  a [self-hosted node](/self-hosting/) are fully supported and give you
  Forge's complete card coverage today.

## Web vs desktop

|              | Web (play.manabrew.app)                 | Desktop (Tauri)                                          |
| ------------ | --------------------------------------- | -------------------------------------------------------- |
| Rules engine | ManaBrew engine compiled to WASM        | Same ManaBrew engine, native                             |
| Forge games  | Join rooms hosted by a self-hosted node | Same                                                     |
| Offline play | No                                      | Engine runs locally, but card images still need internet |
| Install      | None                                    | `.dmg` / `.exe` from releases                            |

The web client additionally requires a cross-origin-isolated host (see
[hosting the web client](/self-hosting/#hosting-the-web-client)) — this
is handled for you on play.manabrew.app.

## Reporting a gap

If a card behaves differently than it would in paper, that's exactly the bug
report this project runs on — see the [FAQ](/faq/#a-card-did-the-wrong-thing)
for what to include.
