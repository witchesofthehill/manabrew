---
title: Privacy & data
description: What Manabrew stores, what it sends, and what it never collects.
---

The short version: **no ads, no third-party tracking, and accounts are
optional.** Three things can leave your machine: games played on the public
relay are recorded, you can publish decks to the Deck Hub, and you can create
an account to own them. All three are described below.

## What stays on your machine

Everything you create lives in local storage on your device: your decks,
preferences, theme choice, and the marker that lets you reconnect to an
in-progress game. Nothing is uploaded or synced unless you explicitly publish
a deck (see below). The flip side: clearing site/app data deletes your decks,
so export the ones you care about.

## What the relay sees

Multiplayer goes through a relay server (the public one, or
[your own](/hosting-relay/)). While you play, the relay handles your chosen
username, the room name, and the game messages it forwards between players. It
keeps the current game state in memory so disconnected players can rejoin.

The public relay also records games. For each game it stores when it started
and ended, the format, the usernames at the table, each seat's deck (deck
name, commander, and card list), the winner, and how the game ended. It also
keeps the stream of game messages, which lets us replay engine crashes and
desyncs. We use this to fix bugs, and to build the aggregate stats behind the
top-decks board. Game records are not tied to an account; the username at the
table is whatever you typed when joining. Like any server, the relay also
keeps operational logs and metrics; logs can contain usernames and connection
addresses.

A self-hosted relay records none of this. Game recording is off unless the
operator turns it on.

## Accounts

Accounts are optional. You never need one to play, build decks, or join
multiplayer games. They exist for one thing: owning the decks you publish to
the Deck Hub.

You can sign in with GitHub, Discord, or an email code. We store your handle,
the provider you signed in with and its user id, and your email address when
the provider shares it or you signed in by email. There are no passwords.
Sign-in codes are delivered through
[Resend](https://resend.com/legal/privacy-policy), which processes your email
address for that purpose.

## Deck Hub

Publishing a deck to the Deck Hub is opt-in, per deck, and needs an account so
the deck stays yours. When you publish, we store the deck (name, description,
card list) under your handle, and both are publicly visible to everyone. You
can remove a published deck from any device you are signed in on.

The top-decks board shows aggregates from public-relay games: deck names,
commanders, and play counts. No usernames appear there.

## What leaves your machine

The client talks to two third-party services:

- **[Scryfall](https://scryfall.com/)**: card data and mana symbols, fetched
  anonymously at runtime
  ([their privacy policy](https://scryfall.com/docs/privacy)). In the browser,
  card images are loaded through a proxy on our own server rather than
  straight from Scryfall's image CDN, which does not reliably allow direct
  browser fetches. Those image requests reach our server, which forwards them
  to Scryfall. The desktop app fetches images from Scryfall directly.
- **[Commander Spellbook](https://commanderspellbook.com/)**: when you use
  combo analysis in the deck editor, the card names in your deck are sent to
  their API to find combos.

## Questions

This page describes what the code does as of when it was written, and we put
effort into keeping it up to date. If you have more doubts, or are curious
about the details, have a look at the code! It's
[all open](https://github.com/witchesofthehill/manabrew), and questions are
welcome on [Discord](https://discord.gg/NqrKpbhtcd).
