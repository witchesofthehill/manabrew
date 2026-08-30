---
title: "Forge now runs in the browser"
description: "How we compiled Forge's Java rules engine to WebAssembly with GraalVM Web Image, kept its synchronous controller model, and connected it to the existing Manabrew client."
pubDate: 2026-08-30
author: "The Manabrew team"
audience: developers
---

Forge now runs in the browser. We compiled the Java engine to WebAssembly and put it behind the same
protocol and the same UI the Manabrew client already uses for our Rust engine.

[Forge](https://github.com/Card-Forge/forge) is the Magic: The Gathering rules engine Manabrew has
used as its reference implementation and hosted backend. Until now, playing with Forge meant a
server somewhere running it for you. With GraalVM Web Image, the same engine runs inside the tab.

As far as we can tell this is the first playable browser build of Forge itself. Other Forge-based
services run Forge on a server and send the game to your browser. We run Forge in your browser.

A Java desktop application with fifteen years of card support arrives over the wire in about 12 MB.
The binary is 35.3 MB and the server sends it compressed with zstd. The browser caches it. Booting
it on the deployed build, assets included, takes around 642 ms.

The feature is in production behind a server flag and an explicit opt-in under Settings. It is still
experimental. What works today:

- Play vs AI
- Constructed
- Commander
- Brawl
- Oathbreaker
- Multiplayer tables with up to four human players
- Manabrew autopass

Limited, draft, and sealed still use the Rust worker. Rollback goes away once Forge owns a game, so a
player cannot step back to an earlier state. Cancelling a mana payment still works, because Forge
answers that itself and never asks for a snapshot.

## The same engine, one more target

Manabrew already has a Rust rules engine in WebAssembly. Forge has fifteen years of rules and card
coverage that the port is still working through. That is why we want it here.

The Rust engine's card support grows by running it against Forge and fixing whatever differs. Until
now nobody could run Forge in a browser, so a browser player got the port instead.

We were already halfway here without noticing. Nothing we ship runs a JVM any more. `native-image`
compiles the Forge harness into a shared library, and both the hosted node and the desktop app load
it in process and call it over FFI: a `.so` on the servers, a `.dll` beside the executable on
Windows, a `.dylib` inside the app bundle on macOS. Web Image is that compiler with a different
backend. The browser build is the same Java code compiled for one more target.

The browser is also the only place Forge is WebAssembly. In the desktop app the wasm engine is our
Rust one, running in the webview, with Forge beside it as a native library.

So nothing is translated and there is no second Forge-compatible implementation to keep in step.
During development we ran identical games on seeds 7, 42 and 99 for up to 40 turns through the
browser build and through the reference build our parity harness tests against. The callback streams
were byte-identical. That reference build is the last thing here that still runs on a JVM.

## Keeping a synchronous engine synchronous

Forge's controller model blocks. The engine reaches a decision, asks a player for input, and waits on
the same call stack until the answer arrives. Web Image gives us one Java thread, so Forge's usual
threading model is no help.

So we kept the blocking model. Forge runs in a Web Worker. When it needs input, it writes a prompt to
a `SharedArrayBuffer` and parks the WebAssembly stack with `Atomics.wait`. The client reads the
prompt, renders it with the normal Manabrew UI, writes the response to the buffer, and wakes the
worker. Forge resumes at the suspended call site.

`SharedArrayBuffer` requires the document to be cross-origin isolated with COOP and COEP headers.
Manabrew has been cross-origin isolated since we shipped the Rust engine, so that cost was already
paid.

```text
Forge
  ↓
prompt
  ↓
SharedArrayBuffer
  ↓
Manabrew client
  ↓
response
  ↓
SharedArrayBuffer
  ↓
Forge resumes
```

The Rust engine already used this transport, so Forge could reuse the game UI we had.

## What the player actually waits for

The wait that matters is between answering a prompt and seeing the next one. Seven production games
on the browser engine, 399 decisions, put that at 47 ms p50, of which the engine is 16 ms. Nothing in
that path leaves the tab. The other 31 ms belongs to the client, which collects the answer on a
requestAnimationFrame poll and then renders the board, so the screen sets the floor rather than the
engine. The whole exchange fits in about three frames.

Two hosted commander games played by real people that day measured 277 ms and 306 ms for the same
gap. Little of that is engine time. The fleet figure of 77 ms p50 is node time, not think time. It
runs from a seat's answer to that seat's next prompt going out, so it holds the rules work plus the
node packing the board for the wire, across real games on bigger boards than our seven. Most of the
remaining gap sits outside the engine, in the hosted path.

Activating an ability costs the hosted fleet a p50 of 385 ms. It barely grows with board size, which
makes it a fixed charge rather than a scaling one. The browser sampled 54 activations at a p50 near
20 ms, on a development server rather than in production, so read that as an order of magnitude and
not a benchmark. The median player-visible gap is already about six-fold. Activations suggest the
difference gets larger on expensive decisions.

## The protocol did most of the work

Manabrew keeps the engine and the client apart. The UI never touches Forge objects. Engines publish
state and prompts through the Manabrew protocol, and the client sends actions back the same way.

We drew that boundary because we were running the Rust port next to Forge and needed both to look
identical from the outside. It now holds several runtimes behind one client:

```text
                  Manabrew client
                         │
                  Manabrew protocol
                         │
             ┌───────────┴───────────┐
             │                       │
         Rust engine               Forge
            (wasm)               server   .so
                                 desktop  .dll / .dylib
                                 browser  wasm
```

Compiling Forge for a new runtime changed nothing in the game wire format. The engine publishes the
same states and prompts as before, and the client reads them the same way.

## Rebuilding Forge's filesystem

Forge expects a filesystem: card scripts, editions, formats, lists, AI profiles. Web Image gives it
one in memory.

Manabrew already downloads a versioned `cardset.rkyv` archive for the Rust engine, and it holds the
underlying Forge card data. The browser worker rebuilds the part of Forge's filesystem this game
needs out of that archive rather than shipping a second copy of the database. Card scripts load
lazily, and the bundle frames only the cards the chosen decks name, so a game starts on 43 scripts
instead of the 33,645 Forge ships. Boot on a development server fell from 960 ms to 462 ms. The
deployed build boots in about 642 ms, because it fetches the archive over the network.

Forge starts without some of those files, but game behaviour changes. Drop `res/lists` and card
legality changes, which showed up immediately as a parity divergence. We found it in side-by-side
traces from the reference build and the WebAssembly one.

## What Web Image does not give you

Web Image is not a JVM in a browser. Forge and its dependencies make assumptions that stop being true
here:

- `Thread.start()` could appear to start a thread even though the work never ran.
- `java.util.zip` wasn't available on the path we needed, so archive decompression moved outside
  Java.
- Java object deserialisation reached unsupported low-level memory behaviour and could crash the
  runtime.
- Some Guava code selected an `Unsafe`-based implementation and had to be initialised differently.

None of it needed Forge rewritten. The work was finding the handful of places where a large Java
desktop application assumes a normal JVM. There will be more of them, which is one reason this stays
experimental.

## Hosting a table

The first target was local Play vs AI. The same engine can host a Manabrew table, with up to four
humans connecting through the normal relay while Forge runs in the host's browser.

Each seat has its own shared buffer and its own filtered view of the game. The relay moves messages
between players. The game itself runs in one client's browser, the same way the Rust browser engine
hosts.

A four-seat commander game hosted this way answers a decision in 21 ms p50 inside the engine. What a
guest waits is far longer, because that interval holds three other players' turns as well.

One cost here is the host's, not the engine's. A self-hosted node sends most boards as a patch
against the previous one. The browser workers cannot do that yet, so every seat gets a whole board
every time. Over a seven-minute four-seat game each guest pulled about 29 MB, and not one frame was a
patch. That pipeline is the next thing to build.

None of this retires the hosted fleet. When a browser hosts, the whole game runs in that browser, so
every seat's hidden information is only as private as the host's client. A hosted node keeps hidden
information out of another player's browser, does not park when a tab is backgrounded, and does not
take the table down when somebody closes a window. It also plays for people whose machine will not. A
35 MB engine and four seats of board state is a lot to ask of a phone. Hosting in the browser is
another option, not a replacement.

## Shipped, and switched off

The binary ships in the production web image with the feature off. The server turns it on, and only
then can a player opt in under Settings.

That gives us telemetry and compatibility reports from real games before anyone gets the engine by
default.

The seven production games measured above were played through that path. A longer development run
did better still, 38 ms of turnaround and 8 ms inside the engine, so production is not the ceiling
here.

## What is not done

Our automated tests only drive Chrome. Firefox works when we try it by hand, but nothing guards it,
and Safari is untested. The multiplayer tests show every seat receiving state and acting, and a
four-seat commander game has run several hundred decisions, but nobody has played a four-player game
to the end.

We have not measured peak heap for a four-seat table, and that number decides whether one fits on an
ordinary laptop.

Backgrounding the hosting tab can stall relay polling and park the game. Both browser engines have
that bug, and it matters more when the browser is hosting the whole table. Rollback is still missing.
Web Image itself is still an experimental GraalVM technology.

The engine stays opt-in until we are comfortable with those gaps.

## Where this leaves the port

We began porting Forge's engine to Rust because a Java desktop application could not run in a
browser and we wanted one that could. That premise shaped the whole port. It no longer holds. A
compiler backend that did not exist when we started now emits WebAssembly, and the engine we were
reimplementing compiled straight into the browser.

The port still answers limited and draft, it is a fifth of the download, and its disagreements with
Forge are still how we find bugs in both. It just no longer has to stand in for Forge in a browser.

Over the past 30 days 96% of Manabrew games ran on Forge, nearly all of them on the hosted fleet.
Every one of those games needed a server to run the engine. A browser game does not. Fifteen years of
card support run in the tab, with no install and no account. It is not the route we expected to get
there.
