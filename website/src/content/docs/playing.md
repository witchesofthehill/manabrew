---
title: Playing Manabrew
description: Building decks, playing against the AI, multiplayer rooms, drafts, and the paper-play companion.
---

## Building a deck

The deck editor accepts decks three ways:

- **Paste a list** — plain text, one card per line (`4 Lightning Bolt`), with
  sideboard and commander sections recognized.
- **Import from a URL** — Archidekt and Moxfield deck links.
- **Start from a preset** — the client ships a set of ready-to-play decks.

Decks can be exported back out as Arena-style text. While you edit, the list
is checked live:

- **Legality badges** mark cards that are banned or restricted in the deck's
  format.
- An **unsupported** badge marks cards the Manabrew engine can't run yet — the
  deck still saves, but those cards won't behave correctly in a game.
- For Commander decks, the editor shows detected **combos** (via Commander
  Spellbook), **Game Changers**, and an estimated **bracket**: brackets 2–4
  are assessed automatically from Game Changer count, mass land denial, and
  early infinite combos; brackets 1 and 5 are yours to declare.

Decks are stored locally in your browser (or the desktop app's local storage)
— nothing is uploaded. Export lists you care about.

## Single-player

Choose **Play Offline** from Home or the navigation bar, select a format, then
pick your deck and opponent. The AI opponent is pre-filled, but you can swap it
before starting. The app remembers your format, engine, deck, and opponent for
next time. The AI plays the same engine you do. Clicking a deck in Home's **My
Decks** shelf opens that deck in the editor.

Use the **Constructed** and **Limited** tabs at the top of Play Offline to move
between deck-based matches and draft, sealed, Winston, or cube setup.

## Multiplayer

Create a room from the lobby — name it, optionally set a password, choose the
player count (2–8) and a reconnection timeout (30, 60, or 90 seconds). The
lobby remembers your last table setup and pre-selects your last-played deck
when it's legal in the room's format. Other players join from the public room
list; the host starts the game once seats fill.

If you disconnect mid-game (tab closed, network blip), you have the room's
reconnection window to come back: reopen the app and it resumes your seat,
replaying the current game state. If the **host** closes their tab, the game
cannot continue — the room returns to the lobby.

## Drafts and limited

Limited play supports **Booster Draft**, **Sealed**, **Winston Draft**, and
**Cube**, with boosters built from real set data. Draft against AI opponents
and take the deck into a **gauntlet** of games, or draft a multiplayer pod
and play the games online in the same room.

## Companion: paper-play life tracker

Playing with physical cards? The **Companion** view (in the Home screen's
Tools area) is a tabletop life tracker for 2–6 players: preset starting
totals (20/40/60), poison, energy, and custom counters, commander damage,
per-player layouts you can drag, rotate and scale, a dice roller, and a game
log. It's designed to sit flat on the table between players.
