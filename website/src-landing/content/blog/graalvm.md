---
title: "Forge now runs in the browser"
description: "How we compiled Forge's Java rules engine to WebAssembly with GraalVM Web Image, kept its synchronous controller model, and connected it to the existing Manabrew client."
pubDate: 2026-08-30
author: "The Manabrew team"
audience: developers
---

Forge now runs in the browser. We've compiled the Java engine itself to WebAssembly and connected it
to the Manabrew client using the same protocol and UI as our Rust engine.

[Forge](https://github.com/Card-Forge/forge) is the Magic: The Gathering rules engine Manabrew has
used as its reference implementation and hosted backend. Until now, playing with Forge meant a
server somewhere running it for you. With GraalVM Web Image, the same engine runs inside the tab.

As far as we can tell this is the first playable browser build of Forge itself. Other Forge-based
services run Forge on a server and send the game to your browser. We run Forge in your browser.

A Java desktop application with fifteen years of card support arrives over the wire in about 12 MB.
The binary is 35.3 MB and the server sends it compressed with zstd. It downloads once and the
browser keeps it. Booting it on the deployed build, assets included, takes around 642 ms.

The feature is in production behind a server flag and an explicit opt-in under Settings. It's still
experimental, but it already supports:

- Play vs AI
- Constructed
- Commander
- Brawl
- Oathbreaker
- Multiplayer tables with up to four human players
- Manabrew autopass

Limited, draft, and sealed still use the Rust worker. Rollback is unavailable once Forge owns a game,
so a player cannot return to an earlier game state. Cancelling a mana payment still works, because
Forge answers that itself and never asks for a snapshot.

## Why run Forge locally?

Manabrew already has a Rust rules engine that runs in WebAssembly. Forge has more than fifteen years
of rules and card support behind it, which is the reason to bring it into the browser as well.

The browser currently runs the Rust implementation, whose card support grows through parity work
against Forge. The browser was the one place we could not offer Forge itself.

We were already halfway here without noticing. Nothing we ship runs a JVM any more. `native-image`
compiles the Forge harness into a shared library, and both the hosted node and the desktop app load
it in process and call it over FFI: a `.so` on the servers, a `.dll` beside the executable on
Windows, a `.dylib` inside the app bundle on macOS. Web Image is that same compiler with a different
backend. Same bytecode, one more shape.

The browser is the only place Forge is WebAssembly. On the desktop the wasm engine is our own Rust
one, running in the same webview, with Forge sitting next to it as a native library.

So there is no card-script translation and no second Forge-compatible implementation to keep in
step. During development we ran full games on seeds 7, 42 and 99 to a 40-turn limit through the
browser build and the reference one, and compared the callback streams. They were byte-identical.

## Keeping a synchronous engine synchronous

The main integration problem was preserving Forge's blocking controller model.

Forge's controller model is synchronous. The engine reaches a decision, asks a player for input, and
waits on the same call stack until the answer arrives. Web Image currently gives us one Java
execution thread, so Forge's usual threading model isn't useful here.

We retained the synchronous model. Forge runs in a Web Worker. When it needs input, it writes a
prompt to a `SharedArrayBuffer` and parks the WebAssembly stack with `Atomics.wait`. The client reads
the prompt, renders it with the normal Manabrew UI, writes the response to the buffer, and wakes the
worker. Forge resumes at the suspended call site.

`SharedArrayBuffer` requires the document to be cross-origin isolated with COOP and COEP headers.
Manabrew has shipped under cross-origin isolation since the Rust engine was introduced, so this
requirement is not new.

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

Manabrew already used this transport for its Rust WebAssembly engine, so the browser uses the
existing game UI for Forge.

## The latency win is mostly in the tail

What a player waits for is the gap between answering a prompt and seeing the next one. Seven
production games on the browser engine, 399 decisions, put that at 47 ms p50. The engine itself
accounts for 16 ms of it, and nothing in the path leaves the tab.

Two hosted commander games played by real people on the same day measured 277 ms and 306 ms for the
same gap. The engine is not the reason. It answers in 77 ms p50 on the fleet; the rest is the round
trip out to a server and back.

The tail is where this gets interesting. Activating an ability costs the hosted fleet a p50 of
385 ms, and it barely grows with board size, so it reads as a fixed charge rather than a scaling
one. The browser sampled 54 activations at a p50 near 20 ms, on a development server rather than in
production, so take that as an order of magnitude and not a benchmark. The cheap decisions were
never the problem. The expensive ones were.

## The protocol did most of the work

The existing protocol reduced the integration work. Manabrew separates the game engine from the
client. The UI doesn't manipulate Forge objects directly. Engines publish state and prompts through
the Manabrew protocol, and the client sends actions back across the same boundary.

That separation was originally necessary because we were running our Rust port alongside Forge. It
now gives us several interchangeable runtimes behind one client:

```text
                  Manabrew client
                         │
                  Manabrew protocol
                         │
             ┌───────────┴───────────┐
             │                       │
         Rust engine               Forge
            (wasm)         server .so, desktop .dll or .dylib,
                                 browser wasm
```

Compiling Forge for a new runtime changed nothing in the game wire format. The engine publishes the
same states and prompts as before, and the client reads them the same way.

## Rebuilding Forge's filesystem

Forge normally expects a filesystem full of card scripts, editions, formats, lists, AI profiles, and
other resources. Web Image provides an in-memory filesystem for these resources.

Manabrew already downloads a versioned `cardset.rkyv` archive for the Rust engine, containing the
underlying Forge card data. The browser worker uses that archive to reconstruct the part of Forge's
filesystem needed for the current game instead of sending another copy of the database. Card scripts
load lazily, and the bundle frames only the cards the chosen decks name, so a game starts on 43
scripts instead of the 33,645 Forge ships. Boot on a development server fell from 960 ms to 462 ms.
The deployed build boots in about 642 ms, because it fetches the archive over the network.

Forge could start without some resources even though their absence changed game behaviour. Removing
`res/lists`, for example, changed card legality and caused parity to diverge. Side-by-side JVM and
WebAssembly traces exposed the difference.

## Where Java meets WebAssembly

Web Image isn't a complete JVM running in a browser. We found several assumptions in Forge and its
dependencies that don't hold in this environment:

- `Thread.start()` could appear to start a thread even though the work never ran.
- `java.util.zip` wasn't available on the path we needed, so archive decompression moved outside
  Java.
- Java object deserialization reached unsupported low-level memory behaviour and could crash the
  runtime.
- Some Guava code selected an `Unsafe`-based implementation and had to be initialised differently.

None of this required rewriting Forge. The work was finding the small number of places where a large
Java desktop application assumes it runs on a normal JVM. We expect further compatibility issues,
which is one reason the feature remains experimental.

## Multiplayer works too

The first target was local Play vs AI. The same engine can also host a Manabrew multiplayer table,
with up to four human players connecting through the normal relay while Forge runs in the host's
browser.

Each seat has its own shared buffer and receives its own filtered view of the game. The relay moves
messages between players. Game execution remains in one client's browser, using the same hosting
model as the Rust browser engine.

A four-seat commander game hosted this way answers a decision in 21 ms p50 inside the engine. What
a guest waits is far longer, because that interval holds three other players' turns as well.

One cost belongs to the host and not to the engine. A self-hosted node sends most boards as patches
against the previous one. The browser workers have no such pipeline, so every seat receives a full
board every time. In a seven-minute four-seat game each guest downloaded about 29 MB, and not one
frame was a patch. Adding that pipeline to the workers is the next piece of work here.

## In production, but not the default

The Forge WebAssembly binary is included in the production web image and disabled by default. The
server enables the feature, after which the player can opt in under Settings.

This allows browser telemetry and compatibility testing on long games before the engine is enabled
more broadly.

Seven production games so far, across pioneer, standard and commander, report a turnaround p50 of
47 ms and an engine-think p50 of 16 ms. A development run on a longer game measured 38 ms
turnaround and 8 ms engine-side.

## What remains

Automated browser coverage is Chrome-first. Firefox works in manual testing, but nothing guards it.
Safari is untested. Our multiplayer tests prove that every seat can receive state and act, and a
four-seat commander game has now run for several hundred decisions, but no four-player game has
been played to its end.

We have not measured peak heap in the tab for a four-seat table. That number decides whether such a
table fits in the memory of a normal laptop.

Backgrounding the hosting tab can stall relay polling and park the game. Both browser engines share
this defect, but it is more visible when the browser hosts the entire table. The rollback limitation
described above also remains. Web Image itself is still an experimental GraalVM technology.

The feature remains opt-in while these gaps are being measured and tested.

## Where this leaves the port

Manabrew started as a self-hosted way for a group of friends to play Magic online. We looked at
XMage and Forge, then began porting Forge's engine to Rust, because a Java desktop application could
not run in a browser and we wanted one that could.

That premise carried years of work. It stopped being true this month, and not because anyone
rewrote anything. A compiler backend that did not exist when we started now emits WebAssembly, and
the engine we had been reimplementing walked into the browser on its own.

Over the past 30 days 96% of Manabrew games ran on Forge, nearly all of them on the hosted fleet.
Those machines exist for one reason, which is that the engine needed somewhere to live. For a game
played this way, that reason is gone. Fifteen years of card support, no account, no install, no
server in the loop, and the tab does the rules.

The Rust port keeps its work. It answers limited and draft, it is a fifth of the download, and its
disagreements with Forge are still how we find out which of the two is wrong. But the wall it was
built to get around turned out to have a door in it.
