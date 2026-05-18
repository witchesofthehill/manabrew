# Project Philosophy

`manabrew` exists to make Forge's rules knowledge available in new runtime
shapes without losing the correctness that makes Forge valuable.

## Who this is for

The audience we have in mind first is small: groups of friends who want to play
Magic together online, across whatever devices and time zones they happen to
have, without giving up open source or a modern interface. The project should
be useful to that group before it is useful to anyone else.

This is a deliberately narrow lens. It keeps scope decisions honest: a feature
that helps a small distributed group play a real game is in scope; a feature
that only matters at the scale of a hosted platform is not. If the broader MTG
community finds the result useful, that is a welcome second-order effect, not
the goal we are optimizing for.

## Correctness first

The rules engine is judged against Java Forge. Rust code may use Rust data
structures, caching, compiled IR, and WASM-friendly packaging, but behavior that
appears in a game trace should match Forge unless a divergence is explicit,
documented, and intentional.

This means:

- read Forge before changing engine behavior;
- port mechanics, not individual cards;
- keep parity failures reproducible by deck, seed, and first divergence;
- prefer small fixes in the module that mirrors the Java source.

## Self-hostable and non-commercial

The project is non-commercial and self-hostable. Users can run their own client, engine host, and relay.
Project-operated infrastructure is not required to play.

Card images are not shipped. When images or card metadata are fetched, they are
fetched at runtime by the user's instance from third-party services under those
services' terms.

## AI as acceleration, not authority

AI tools are useful for large mechanical work: trace inspection, Java/Rust
comparison, documentation passes, and coverage inventory. They do not replace
review. Every AI-assisted change still needs a human-readable reason, a source
in Forge or project docs, and a test or parity command that supports it.
