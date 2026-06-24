---
title: "Manabrew: a Rust port of Forge, kept honest by testing against it"
description: "How Manabrew ports the Forge Magic: The Gathering rules engine to Rust and keeps it correct, using differential testing against Java Forge as an external oracle."
pubDate: 2026-06-24
author: "The Manabrew team"
audience: developers
---

Manabrew is an open-source Magic: The Gathering client with two engines behind it. One is
[Forge](https://github.com/Card-Forge/forge), the long-running open-source Java engine, running server-side, which gives complete games today. The other is our own engine: a Rust port of Forge that runs client-side, via WebAssembly. The port is the long-term project, and we keep it faithful to Forge by differential testing: running the same game in
both engines and comparing them. That's tractable because the engine it has to match is running right next to it.

This post is about how the port stays correct, which is the part most likely to matter if you want to work on it.

## The problem with porting a rules engine

Magic has thirty years of rules, and the hard part is how they interact, not the individual cards. What does a replacement effect do to the event a trigger was watching? Which continuous effect wins a layer conflict? When you port an engine that large, one mistake keeps coming up: a card misbehaves, and the quickest fix is a special case on that card. Four lines, the test goes green, you move on. Do that often enough and you no longer have a rules engine. You have a pile of per-card patches that pass the games you happened to try and break on the ones you didn't.

So we don't allow that fix. A divergence on one card is a symptom; the bug is almost always a missing
general rule. Forge is the reference for what that rule is.

## The harness

The mechanism is simple. You give it two decks, a seed, and a deterministic agent that makes the same
choices every time, so the only variable is the engine. It plays the game once in Rust and once in
Forge, walks both traces, and stops at the first point where they disagree. It reports where they parted: the phase, the active player, the field that differs, the Rust value, and the Java value.

That report is the whole signal. Java says the attacker has power 4, Rust says 3, so now you go find
out why. The harness has no opinion on the cause, only on where the two engines split.

Two honest limits. It's a tool you run while fixing something, not a dashboard in CI; engine work
tends to start from a failing parity run. And the Rust port's card coverage is still partial, with no
percentage worth quoting, which is why the Forge engine runs server-side in the meantime. Games
are complete while the port grows into them.

## What fixing a bug looks like

This is also the main way to contribute, so it's worth being concrete.

A parity run diverges. You don't patch the card that exposed it; you find the rule. You open the Java
file in Forge that owns the mechanic (the trigger, the replacement effect, the static-ability layer,
the cost), read it, and find the branch Java takes that the Rust port doesn't. The fix goes where
Java keeps the rule.

What makes this approachable for a newcomer is the mirror discipline: the Rust mostly follows Forge's
own structure. A Java class becomes a snake-cased Rust file, Forge's module layout becomes the
engine's, and symbol names keep their Java lineage. So "where does this fix go" usually has a
mechanical answer: find the Java file, go to its Rust counterpart. You don't have to hold the whole
engine in your head to land a correct change.

The gate is then a matrix of representative decks played against each other across several seeds. A
fix has to leave the whole matrix matching Forge, not just the matchup that was failing, and it gets
recorded as a regression entry so it can't quietly break later.

The test you hold yourself to is one question: if a different card hit this same code path, would it
work? If only the original card works, you haven't found the rule yet.

## Why the Rust looks unidiomatic

A fair criticism on first read is that the engine doesn't always look like idiomatic Rust. That's
deliberate. Forge threads long argument lists through everything, and we keep them rather than fold
them into tidy context structs. We mirror Java's control flow even where Rust would express it more
cleanly, and we silence the clippy lints that would push us off that path. The reason is that once
the Rust stops matching Java's structure, the trail back to the reference goes cold, and the next
divergence becomes an investigation instead of a diff. Idiomatic structure is for the layers where
parity has nothing to say: performance, and the UI, which is a fresh design rather than a port.

## On AI

A port this size uses AI assistance, and we say so plainly. Models are good at the mechanical core:
lining a Java file up against its Rust port, summarising a long trace down to the phase that matters,
drafting a first pass. The reason that doesn't degrade the engine is the harness. It's an external
oracle, so generated code either makes the trace match Forge or it doesn't, however plausible it
looked. Forge's behaviour is the authority, the harness checks it, and a human reviews and owns the
change.

## Trying it and contributing

Manabrew is in public alpha. You can play today at <https://play.manabrew.app>, and the code is at
<https://github.com/witchesofthehill/manabrew>.

The engine is a derivative work of [Forge](https://github.com/Card-Forge/forge) and is licensed AGPL-3.0-or-later. For something played over
a network and meant to be self-hostable, the AGPL is a deliberate choice: it stops a hosted fork from
closing the source.

If you want to contribute, the most useful work is small, well-scoped parity fixes, along with
reproducible issue reports, documentation, and UI fixes. The [contributing guide](https://docs.manabrew.app/contributing/) covers the setup and
the conventions, and the [Discord](https://discord.gg/NqrKpbhtcd) is a good place to ask where a
given divergence probably lives before you go digging.
