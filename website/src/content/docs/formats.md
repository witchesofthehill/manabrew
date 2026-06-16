---
title: Formats & limitations
description: What the engine supports today, and where the edges are.
---

Manabrew is pre-release software built around an in-progress Rust port of the
Forge rules engine. This page is the honest version of "what works".

## Formats

The engine and client recognize: **Commander**, **Standard**, **Pioneer**,
**Modern**, **Legacy**, **Vintage**, **Pauper**, **Brawl**, **Oathbreaker**,
**Draft**, and **Sealed**. The format drives deck
rules, starting life, and the editor's legality badges.

For limited play, **Booster Draft**, **Sealed**, **Winston Draft**, and
**Cube** are available, with boosters generated from real set and edition
data.

## Card coverage

The card database parses Forge's full library of 32,000+ card scripts, but
the Manabrew engine does not implement every mechanic those scripts use yet.
We work hard to bring more and more functionality to the Manabrew engine, but as of today, it remains
experimental, with many mechanics still not working.

## Web vs desktop

|              | Web (play.manabrew.app)                 | Desktop (Tauri)                                          |
| ------------ | --------------------------------------- | -------------------------------------------------------- |
| Rules engine | Manabrew engine compiled to WASM        | Same Manabrew engine, native                             |
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
