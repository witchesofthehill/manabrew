//! Pluggable RNG for game effects (shuffles, coin flips, dice rolls).
//!
//! By default, effects use the system's thread-local RNG. For parity testing,
//! a deterministic RNG (e.g. JavaRandom) can be injected to match Java Forge's
//! `MyRandom` consumption order exactly.
//!
//! # WASM Compatibility
//!
//! The `rand` crate 0.8+ supports WASM via `getrandom`. For browser WASM,
//! ensure the WASM entry point crate (wasm) includes:
//! ```toml
//! getrandom = { version = "0.2", features = ["js"] }
//! ```
//! This enables `thread_rng()` to work in browser environments.

use crate::ids::CardId;

/// Trait for game-level randomness, used by effect resolvers.
///
/// This abstraction lets parity tests inject a Java-compatible RNG
/// that matches `java.util.Random` and `Collections.shuffle()` exactly,
/// while normal gameplay uses the default thread-local RNG.
pub trait GameRng {
    /// Shuffle a slice of CardIds in-place.
    /// Must match `java.util.Collections.shuffle(list, rng)` for parity.
    fn shuffle_cards(&mut self, cards: &mut [CardId]);

    /// Return a random integer in `[0, bound)`.
    /// Must match `java.util.Random.nextInt(bound)` for parity.
    fn next_int(&mut self, bound: i32) -> i32;

    /// Debug: return the total number of RNG calls made so far (if tracked).
    fn call_count(&self) -> u64 {
        0
    }
}

/// Default RNG using `rand::thread_rng()` — non-deterministic, for normal gameplay.
pub struct ThreadRngAdapter;

impl GameRng for ThreadRngAdapter {
    fn shuffle_cards(&mut self, cards: &mut [CardId]) {
        use rand::seq::SliceRandom;
        cards.shuffle(&mut rand::thread_rng());
    }

    fn next_int(&mut self, bound: i32) -> i32 {
        use rand::Rng;
        rand::thread_rng().gen_range(0..bound)
    }
}
