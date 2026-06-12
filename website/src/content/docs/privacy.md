---
title: Privacy & data
description: What ManaBrew stores, what it sends, and what it never collects.
---

The short version: **no accounts, no analytics, no tracking.** Here's the
complete picture.

## What stays on your machine

Everything you create lives in local storage on your device — your decks,
preferences, theme choice, and the marker that lets you reconnect to an
in-progress game. Nothing is uploaded or synced. The flip side: clearing
site/app data deletes your decks, so export the ones you care about.

## What the relay sees

Multiplayer goes through a relay server (the public one, or
[your own](/self-hosting/#hosting-your-own-relay)). While you play, the
relay handles your chosen username, the room name, and the game messages it
forwards between players. It keeps the current game state in memory so
disconnected players can rejoin. All of it is in-memory only — when the room
closes, it's gone. Nothing is written to a database. Like any server, it
keeps short-lived operational logs.

## What leaves your machine

The client talks to exactly two third-party services:

- **[Scryfall](https://scryfall.com/)** — card data and card images, fetched
  anonymously at runtime ([their privacy policy](https://scryfall.com/docs/privacy)).
- **[Commander Spellbook](https://commanderspellbook.com/)** — when you use
  combo analysis in the deck editor, the card names in your deck are sent to
  their API to find combos.

That's the list. No analytics, no telemetry, no crash reporting, no ad or
font CDNs (fonts are bundled). The desktop app does not phone home or
auto-update.

## Questions

This page describes what the code does as of when it was written. The code is
the authority — it's [all open](https://github.com/witchesofthehill/manabrew),
and questions are welcome on [Discord](https://discord.gg/NqrKpbhtcd).
