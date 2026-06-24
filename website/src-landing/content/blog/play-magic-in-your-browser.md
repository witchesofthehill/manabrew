---
title: "Play Magic: The Gathering in your browser"
description: "Manabrew is a free, open-source Magic: The Gathering client that enforces the rules and runs in your browser. Play against an AI or with friends, with nothing to install."
pubDate: 2026-06-24
author: "The Manabrew team"
audience: players
hero: battleground.webp
heroAlt: "A game of Magic in progress on the Manabrew battleground, in the browser"
---

XMage and Forge are both free, enforce the rules, and come with an AI to play against. The catch is
that they're desktop apps, so everyone has to download and install one. The browser tabletop clients
are easy to open, but they don't track the rules for you; you move the cards and work everything out
by hand.

Manabrew is free, it enforces the rules, and it runs in the browser. Nothing to install, no Java.

You can try it now at [play.manabrew.app](https://play.manabrew.app). There's also a desktop build if
you'd rather install it.

## What you can do

- **Play against an AI**, to learn the client or test a deck on your own.
- **Play with friends** in a hosted room, in the browser. If you want more control, one of you can
  host the room from the desktop app or your own server, and everyone else still joins from the web.
- **Build decks**, or import a list from your usual deckbuilder.
- **Track a paper game** with the built-in life tracker. It keeps life totals and counters for a
  game with real cards, from your phone.
- **Add it to your home screen.** Manabrew is a PWA, so you can install it on a phone or iPad and
  open it full-screen, no app store involved. That makes it easy to carry to the table as a life
  tracker.

## Two engines

Before each game, solo or multiplayer, you pick which engine runs it.

- **Forge (Java)** is the real [Forge](https://github.com/Card-Forge/forge) engine, with its
  complete card pool, kept current as new sets release. It runs your games against the AI and against
  friends. Pick it when you want to play any deck.
- **Manabrew (WASM)** is our own engine, a Rust port of Forge that runs in the browser. It's lighter
  and fully client-side, and its card support is still growing. Pick it to play on the native engine.

The full card pool is always available through Forge, so choosing Manabrew is never a dead end.

## It's public alpha

Manabrew is in public alpha. There are bugs and rough edges, things change between versions, and an
update can occasionally affect your saved decks and settings. It does not mean the card pool is
incomplete: pick Forge and every card is there. What's still maturing is our own WASM engine's
coverage and the general polish. The most useful thing you can do is play and tell us what broke. If
something goes wrong, our [Discord](https://discord.gg/NqrKpbhtcd) is the place to say so.

## Free and open source

Manabrew is free and open source, under the AGPL. No account, no telemetry, no paywall; your decks
and settings stay on your device. If you'd rather run it yourself, both the room your group plays in
and the relay it connects through are self-hostable.

## How to start

1. Open [play.manabrew.app](https://play.manabrew.app).
2. Build a deck or import a list.
3. Start a game against the AI or with friends, and pick the engine: Forge for the full card pool, or
   Manabrew (WASM) for the native browser engine.

Feedback from real games is what's most useful right now, so if you play, let us know on
[Discord](https://discord.gg/NqrKpbhtcd).
