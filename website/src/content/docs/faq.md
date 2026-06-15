---
title: FAQ & troubleshooting
description: Common questions and what to do when something breaks.
---

## The page loads but games won't start (web)

The web engine needs `SharedArrayBuffer`, which requires cross-origin
isolation. The app shows a toast and a console error when the host is
misconfigured. On [manabrew.app](https://play.manabrew.app) this should never
happen — report it on [Discord](https://discord.gg/NqrKpbhtcd). If you're
hosting the client yourself, see
[hosting the web client](/self-hosting/#hosting-the-web-client).

## Card images don't load

Images aren't shipped with the client — they come from
[Scryfall](https://scryfall.com) at runtime. If images are missing, check
your connection or whether Scryfall is reachable from your network. Game
rules keep working without images.

## A card did the wrong thing

Probably a gap in the ManaBrew engine — these reports are the project's
lifeblood. Post on [Discord](https://discord.gg/NqrKpbhtcd) or open a
[GitHub issue](https://github.com/witchesofthehill/manabrew/issues) with:

- the card name(s) involved,
- what happened vs. what should have happened,
- your deck list (export it from the editor),
- roughly when in the game it occurred.

## Why is a card marked "unsupported"?

The ManaBrew engine doesn't implement everything that card's script needs yet.
The deck still saves; the card just won't behave correctly in-game. See
[Formats & limitations](/formats/).

## Can I play offline?

On desktop, the engine runs locally but card images still need internet. The
web client is not offline-capable. See the
[web vs desktop comparison](/formats/#web-vs-desktop).

## I closed my tab mid-game — is the game lost?

Reopen the app within the room's reconnection window (30–90 seconds, set by
the host) and you'll be put back in your seat. If the host disconnects, the
game ends and the room returns to the lobby. See
[multiplayer](/playing/#multiplayer).

## Where are my decks stored?

Locally, in your browser's (or the desktop app's) storage. Nothing is
uploaded. That also means clearing site data deletes them — export decks you
care about.

## Is this free? Is it official?

Free and open source, GPL-3.0-or-later. It is unofficial fan software — not
affiliated with, endorsed by, or sponsored by Wizards of the Coast LLC or the
Forge project.
