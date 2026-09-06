---
title: "?"
description: "?"
pubDate: 2026-08-31
author: "The Manabrew team"
audience: players
hero: welcomeScreen.webp
heroAlt: "?"
---

Structure:
Why we started: personal motivation
The technical wall: server dependency
The breakthrough: browser-native rules engine
The broader problem: fragmented open MTG ecosystem
The analogy: standards enabled other ecosystems
Our solution: Manabrew Protocol
How we achieved the impossible bit: GraalVM/WebAssembly
Why AI doesn't invalidate the work: engineering quality
Call to action: use it / contribute

Hello everyone. We're the Witches of the Hill, a group of friends that, on February 2026, decided we needed a way to play Magic: The Gathering online, without compromises.
We didn't just want to play some tabletop simulator, we wanted to play in the style of MTG Arena, but with no card restrictions, and up to 4 players. We also wanted to make this free, easy, and completely open source.
We know the hassle of having to spin up a server and setup peer to peer if you're not technical, and we wanted to make this accessible not only to tech savvys, but to everyone.
The challenge soon became apparent. There is currently no way to run a rules engine without a server, and the cost of running such servers for the entire community is too much for a small team to maintain. Writing a rules engine to run on the browser was our first idea, but despite the advancements in AI tooling, this proved much more difficult than originally anticipated.

Complete and reliable rules engines do exist, however, they are all currently written in Java, which doesn't natively run in your browser.

Until now.

We believe we've achieved what could be one of the biggest breakthroughs for free and open-source MTG in years: bringing a complete, reliable MTG rules engine to the browser, with no server required.

## The problem of many engines, many clients

We love the current state of the open MTG community. It's full of passionate players and developers building amazing projects and opening them up to the world for everyone to use.
However, this led us to quite a scattered ecosystem, where everyone is working on their codebases without standards, specs, or anything of the sort to allow the pieces to be cross compatible between projects. Engines are extremely coupled with the client they serve, and the work to adapt engine A with client B is sometimes not worth the effort.

We spent countless hours trying to understand and rip some of the open engines to pieces just to get a viable prototype on our own client. This is not only exhausting, but it dissipates the effort and prevents the community from making progress towards a truly unified MTG standard.

The greatest open source wins in history weren't built in isolation.

Linux was built on decades of work that came before it. UNIX established a common model for operating systems, and POSIX later standardized the interfaces that software could rely on across different UNIX-like systems.
This made it possible to write software once and have it run across many different implementations, rather than coupling it to a single system.

The same thing happened with networking and the web: TCP/IP, HTTP, HTML, URLs.
All these standards created the foundations for modern tech and without it, we wouldn't be able to build on top of each other pieces.
We see no reason why this wouldn't be the case for a true and open MTG ecosystem as well.

## Unifying chaos: the Manabrew Protocol

We decided the first step was going to be to standardise how a MTG engine talks to a client. What we came up with, after lots of hours and rule reading and inspecting the inner functioning of the best engines out there, is the virst version of the _Manabrew protocol_.

Despite the name, the protocol has nothing specific to the Manbrew app, and it carries no business logic whatsoever that would only benefit our own client. This is why we designed in a way that is extremely simple, minimal, and easy to integrate with.

The core idea is simple:

- The game state is defined by one single `GameView` object.
- The engine sends a prompt from an extremely reduced set of options.
- The client must answer the prompt with an appropriate, formally defined response.

This is it. There is currently a gran total of 20 possible prompts, and with these primitives, any client that implements it can use any engine that so does too.

This goes beyond MTG as well. We plan, one day, to have the protocol be even more generic. If it can play MTG there is no reason why it wouldn't be able to play Yu-Gi-Oh as well, or Heartstone, or any other card game out there.
This is because supporting MTG makes for a protocol that is capable of handling the most complicated interactions.

Our dream is that this might one day become the de-facto standard for any open card game. The possibilities would be endless, and we could wire any game, on any client, with any engine.

## Bringing the JVM to WebAssembly: About GraalVM

TODO: Ema

## The challenge with AI

Let's take a moment to address the elephant in the room: AI tools in software development.

The Manabrew team is made up of professional software engineers. We write, review, and design systems for our daily jobs in a variety of circumstances, and we've been doing this for nearly a decade now.

If you're working in software in 2026 and you want to stay competitive, you will have to use AI tools one way or another.

The challenge with AI is that whilst it changes "how" we produce software, it hasn't changed "what" good software looks like.

With the barrier to entry for software development now lower than ever, the number of community projects has skyrocketed, and the MTG space is no different.

This is mostly a good thing. However, whilst the intentions behind these projects are good, we weep at the state of many of them.
AI tools are only as good as the people using them. It is easy to let these tools run rogue, which will inevitably result not only in poor code, but in software that others cannot rely on.

We care deeply about making sure that the things we make meet the standards of what we'd consider "good software", whilst also providing solid foundations for others to build upon.

It is hard work to keep a codebase from deranging into a tangled mass of spaghetti, but we'll put in the work. We want to build software people can rely on, build on, and still be using years from now.

## Conclusions

TODO: We need you moment:

- We've put the work here's how you can use it.
- We want you! If you're a top dog, come help us! We need all the brains we can get.
