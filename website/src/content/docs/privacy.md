---
title: Privacy & data
description: What Manabrew stores, what it sends, and what it never collects.
---

The short version: **no ads, no third-party tracking, and accounts are
optional.** Games played on the public relay are recorded, offline use of an
exact Community publication is reported for aggregate rankings, and you can
explicitly save or publish decks. These are described below.

## What stays on your machine

Decks you keep local, your preferences, theme choice, and the marker that lets
you reconnect to an in-progress game live in local storage on your device.
The app does not upload local deck contents. When you start an offline game
with an exact published Community deck, it queues the publication reference, a
deck fingerprint, the format, and an opaque report ID locally, then sends them
for aggregate Top Deck rankings when the Hub is reachable. The server records
when it receives the report. It does not include a username or card list.
Clearing site/app data deletes local-only decks and queued play reports, so
export the decks you care about.

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

## Exporting and deleting your account

Settings → Account has both, and neither needs a support request.

**Export** downloads a JSON file with everything the account holds: your
profile, the sign-in methods linked to it, your active sessions, every account
deck with its full version history and card lists, your publications, and your
favorites. It does not include the individual play reports behind your
publications, because those records belong to the people who played the games;
you get the play and win totals instead.

**Delete** erases the account, its sign-in methods and sessions, its saved
decks, and the version snapshots behind them. Decks you published to Community
are the exception: the publication stays up, and the deck behind it is
reassigned to an anonymous owner, so it shows as "Deleted user" and no longer
points at you. Version snapshots that were never published are erased with the
rest, along with the IP address recorded when you published. Publications you
had already removed from Community go too, unless a Top Deck snapshot still
ranks them. Deletion is immediate and cannot be undone.

Relay game records are separate: they are not tied to an account, so deleting
your account does not remove them. Ask on Discord to have a username scrubbed
from them.

## Community

Publishing to Community is opt-in and needs an account so each public entry
stays yours. A publication points to one immutable version of an account deck;
the same deck or version can be published more than once. We publicly show the
publishing account's handle, publication title and summary, card list, tags,
cover card, and aggregate favorite count. Favorites store the relationship
between your account and an entry, but we do not publish who favorited it. You
can remove each public entry from any device you are signed in on. Removing a
deck from My Decks also hides its public entries, because a removed deck is
kept but excluded from every public listing. Deleting your account is the one
exception - see below.

Top Deck collections are dated ranking snapshots of public Community entries,
so they show the same publication and account-handle information as the entry
itself. Rankings combine human deck use on the managed public relay with the
limited offline reports described above. Reports are accepted only when the
fingerprint still matches the exact published version.

## What leaves your machine

The client talks to two third-party services:

- **[Scryfall](https://scryfall.com/)**: card data, fetched anonymously at
  runtime ([their privacy policy](https://scryfall.com/docs/privacy)). Card
  lookups and searches go from your device straight to `api.scryfall.com`, and
  mana symbols straight to `svgs.scryfall.io`, so Scryfall sees those requests
  and your IP address. Card **images** are the exception in the browser: they
  are proxied through our own server, because Scryfall's image CDN does not
  reliably allow direct browser fetches. Those image requests reach our server,
  which forwards them to Scryfall. The desktop app fetches images directly.
- **[Commander Spellbook](https://commanderspellbook.com/)**: when you use
  combo analysis in the deck editor, the card names in your deck are sent to
  their API to find combos.

While the app is open it also fetches `play.manabrew.app/status.json` once a
minute, to show outage and maintenance notices. That request carries no
account information, but like any web request it reaches our server with your
IP address.

## Who is responsible, and how to reach us

Manabrew is run by the maintainers of the
[witchesofthehill/manabrew](https://github.com/witchesofthehill/manabrew)
project, who are the data controller for everything described on this page.
There is no company behind it and no dedicated privacy mailbox: reach us by
opening an issue on that repository, or on
[Discord](https://discord.gg/NqrKpbhtcd). If a request would expose something
in public, say so and we will arrange somewhere private.

## Why we are allowed to process this

| What                                                                          | Why we may do it                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Running your account, syncing your decks, serving your publications           | Performing the service you asked us for                                  |
| Sending a sign-in code by email                                               | Performing the service you asked us for                                  |
| Recording relay games, keeping message captures, operational logs and metrics | Our legitimate interest in keeping the service working and debuggable    |
| Aggregate Top Deck rankings                                                   | Our legitimate interest in making the app useful                         |
| Offline play reports from published decks                                     | Our legitimate interest in ranking decks; the report carries no username |

You can object to anything resting on legitimate interests - see below. We do
not sell data, we do not advertise, and we do not profile you.

## How long we keep things

Some of these are enforced by code today; the rest are honest descriptions of
current behaviour rather than promises we have automated.

| Data                                              | Kept for                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Account, decks, versions, publications, favorites | Until you delete the account                                                                                                              |
| Sign-in sessions                                  | 90 days, extended when you keep using the app                                                                                             |
| Email sign-in codes                               | 15 minutes, then unusable                                                                                                                 |
| OAuth handshake state                             | 10 minutes                                                                                                                                |
| Relay game records and analytics                  | No automatic expiry yet                                                                                                                   |
| Per-game message captures                         | A rolling 20 GB budget on the server; the oldest are dropped first, so how long a capture survives depends on how busy the relay has been |
| Server logs and metrics                           | No automatic expiry yet                                                                                                                   |

Where a row says "no automatic expiry yet", that is a gap we intend to close;
ask us and we will remove your records by hand in the meantime.

## Game captures

When a game runs on the public relay, the relay can store the stream of engine
messages for that game, compressed. That stream is the game itself: who was at
the table under their relay username, the decks and cards involved, and every
action taken. We keep it so we can replay engine crashes and desyncs against
the real sequence that caused them, which is the only reliable way to fix
rules bugs. It is not used for anything else, it is not published, and a
self-hosted relay stores nothing unless its operator turns capture on.

## Your rights

You can ask us to give you a copy of your data, correct it, delete it, limit
what we do with it, hand it to another service in a portable format, or stop
processing that rests on legitimate interests.

Two of these are self-serve and immediate, in **Settings → Account**: _Export
my data_ downloads everything the account holds as JSON, and _Delete account_
erases it. For anything else, contact us as above. We will answer within one
month.

Relay game records are the awkward case: they key on the relay username you
typed when joining, which is not connected to any account, so deleting your
account cannot reach them. Tell us the username and we will scrub it.

If you think we have handled your data badly, you can complain to your
national data protection authority - in the UK, the
[ICO](https://ico.org.uk/make-a-complaint/).

## Who else touches your data

| Who                                                                                             | What they get                                                                  | Where         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------- |
| [Hetzner](https://www.hetzner.com/legal/privacy-policy/)                                        | Hosts our servers, so everything on this page sits on their machines           | Germany       |
| [Resend](https://resend.com/legal/privacy-policy)                                               | Your email address, to deliver a sign-in code                                  | United States |
| [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) | Sees that you signed in to Manabrew, if you use GitHub sign-in                 | United States |
| [Discord](https://discord.com/privacy)                                                          | Sees that you signed in to Manabrew, if you use Discord sign-in                | United States |
| [Scryfall](https://scryfall.com/docs/privacy)                                                   | Card lookups, searches and mana symbol requests from your device, with your IP | United States |
| [Commander Spellbook](https://commanderspellbook.com/)                                          | The card names in a deck, when you run combo analysis                          | United States |

The providers outside the EU/UK receive data under the standard contractual
clauses and equivalent safeguards in their own terms. GitHub and Discord are
involved only if you choose that sign-in method, and Scryfall and Commander
Spellbook receive card queries rather than anything about you as a person.

## Questions

This page describes what the code does as of when it was written, and we put
effort into keeping it up to date. If you have more doubts, or are curious
about the details, have a look at the code! It's
[all open](https://github.com/witchesofthehill/manabrew), and questions are
welcome on [Discord](https://discord.gg/NqrKpbhtcd).
