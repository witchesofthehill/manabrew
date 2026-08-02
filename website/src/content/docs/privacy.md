---
title: Privacy & data
description: What Manabrew stores, what it sends, and what it never collects.
---

The short version: **no ads, no third-party tracking, and accounts are
optional.** Three things can leave your machine: games played on the public
relay are recorded, you can explicitly save decks to an account, and you can
publish deck versions to Community. All three are described below.

## What stays on your machine

Decks you keep local, your preferences, theme choice, and the marker that lets
you reconnect to an in-progress game live in local storage on your device.
Nothing is uploaded unless you explicitly save a deck to your account or
publish it (see below). Clearing site/app data deletes local-only decks, so
export the ones you care about.

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

Accounts are optional. You never need one to play, build local decks, or join
multiplayer games. An account lets you save selected decks across devices,
keeps immutable version history when you save changes, owns your Community
publications, and stores your Community favorites.

You can sign in with GitHub, Discord, or an email code. We store your handle,
the provider you signed in with and its user id, and your email address when
the provider shares it or you signed in by email. There are no passwords.
Sign-in codes are delivered through
[Resend](https://resend.com/legal/privacy-policy), which processes your email
address for that purpose.

## Community

Publishing to Community is opt-in and needs an account so each public entry
stays yours. A publication points to one immutable version of an account deck;
the same deck or version can be published more than once. We publicly show the
publishing account's handle, publication title and summary, card list, tags,
cover card, and aggregate favorite count. Favorites store the relationship
between your account and an entry, but we do not publish who favorited it. You
can remove each public entry from any device you are signed in on. Removing a
deck from My Decks does not automatically remove its existing public entries.

Top Deck collections are dated ranking snapshots of public Community entries, so
they show the same publication and account-handle information as the entry
itself. Legacy clients may still show the older aggregate public-relay board,
which contains deck names, commanders, play counts, and recent-play timing but
no usernames.

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
