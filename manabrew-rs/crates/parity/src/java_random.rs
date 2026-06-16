//! Port of Java's `java.util.Random` (LCG) and `Collections.shuffle()`.
//!
//! This lets the Rust parity runner produce the exact same shuffle sequence as
//! the Java Forge engine when given the same seed, so opening hands match and
//! downstream divergences can be compared meaningfully.

const MULTIPLIER: i64 = 0x5DEECE66D;
const ADDEND: i64 = 0xB;
const MASK: i64 = (1i64 << 48) - 1;

/// A faithful reimplementation of `java.util.Random`.
pub struct JavaRandom {
    seed: i64,
    pub call_count: u64,
    pub label: &'static str,
}

impl JavaRandom {
    /// Equivalent to `new java.util.Random(seed)`.
    pub fn new(seed: i64) -> Self {
        Self {
            seed: (seed ^ MULTIPLIER) & MASK,
            call_count: 0,
            label: "unknown",
        }
    }

    /// Core LCG step — equivalent to `java.util.Random.next(int bits)`.
    fn next(&mut self, bits: u32) -> i32 {
        self.call_count += 1;
        self.seed = self.seed.wrapping_mul(MULTIPLIER).wrapping_add(ADDEND) & MASK;
        (self.seed >> (48 - bits)) as i32
    }

    /// Equivalent to `java.util.Random.nextInt(int bound)`.
    pub fn next_int(&mut self, bound: i32) -> i32 {
        assert!(bound > 0, "bound must be positive");
        let call_before = self.call_count;
        // Power-of-two fast path
        let result = if bound & (bound - 1) == 0 {
            ((bound as i64).wrapping_mul(self.next(31) as i64) >> 31) as i32
        } else {
            // Rejection sampling to avoid modular bias
            loop {
                let bits = self.next(31);
                let val = bits % bound;
                if bits.wrapping_sub(val).wrapping_add(bound - 1) >= 0 {
                    break val;
                }
            }
        };

        if std::env::var("FORGE_RNG_TRACE").is_ok() {
            eprintln!(
                "[rng-rust #{} ({})] nextInt({}) = {}",
                call_before + 1,
                self.label,
                bound,
                result
            );
        }
        result
    }

    /// Equivalent to `java.util.Random.nextBoolean()`.
    pub fn next_boolean(&mut self) -> bool {
        self.next(1) != 0
    }

    /// Fisher-Yates shuffle matching `java.util.Collections.shuffle(list, rng)`.
    pub fn shuffle<T>(&mut self, list: &mut [T]) {
        if std::env::var("FORGE_RNG_TRACE").is_ok() {
            eprintln!("[rng-rust ({})] shuffle(len={})", self.label, list.len());
        }
        for i in (1..list.len()).rev() {
            let j = self.next_int((i + 1) as i32) as usize;
            list.swap(i, j);
        }
    }
}

// ── GameRng adapter for parity testing ────────────────────────────────

use std::cell::RefCell;
use std::rc::Rc;

use manabrew_engine::game_rng::GameRng;
use manabrew_engine::ids::CardId;

/// Wraps a shared `JavaRandom` (via `Rc<RefCell<>>`) so it can be used as
/// the game-level RNG for effect resolvers. This ensures shuffles, coin flips,
/// and dice rolls consume the same RNG instance that agents use for random
/// discard, matching Java's single `MyRandom` consumption order.
pub struct JavaGameRng(pub Rc<RefCell<JavaRandom>>);

impl GameRng for JavaGameRng {
    fn shuffle_cards(&mut self, cards: &mut [CardId]) {
        // Rust stores libraries with last-element-is-top (pop() = draw).
        // Java stores them with index-0-is-top.
        // Fisher-Yates is order-dependent, so we must:
        //   1. Convert to Java orientation (reverse)
        //   2. Shuffle (producing Java-compatible result)
        //   3. Convert back to Rust orientation (reverse)
        cards.reverse();
        self.0.borrow_mut().shuffle(cards);
        cards.reverse();
    }

    fn next_int(&mut self, bound: i32) -> i32 {
        let v = self.0.borrow_mut().next_int(bound);
        if std::env::var("FORGE_RNG_BT").is_ok() && bound == 1 {
            let bt = std::backtrace::Backtrace::force_capture();
            eprintln!("[RNG_BT] next_int(1) backtrace:\n{}", bt);
        }
        v
    }

    fn call_count(&self) -> u64 {
        self.0.borrow().call_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that our LCG matches Java's output for seed=42.
    ///
    /// Reference values from:
    /// ```java
    /// Random r = new Random(42);
    /// for (int i = 0; i < 10; i++) System.out.println(r.nextInt(100));
    /// ```
    #[test]
    fn next_int_matches_java_seed_42() {
        let mut rng = JavaRandom::new(42);
        // Java outputs for `new Random(42)` calling `nextInt(100)` ten times:
        let expected = [30, 63, 48, 84, 70, 25, 5, 18, 19, 93];
        for &e in &expected {
            assert_eq!(rng.next_int(100), e);
        }
    }

    /// Verify power-of-two branch works correctly.
    #[test]
    fn next_int_power_of_two() {
        let mut rng = JavaRandom::new(42);
        // Java: new Random(42).nextInt(16) sequence
        let expected = [11, 0, 10, 0, 4, 15, 4, 11, 10, 1];
        for &e in &expected {
            assert_eq!(rng.next_int(16), e);
        }
    }

    /// Verify shuffle matches Java's `Collections.shuffle()`.
    #[test]
    fn shuffle_matches_java() {
        let mut rng = JavaRandom::new(42);
        // Java:
        // List<Integer> list = IntStream.range(0, 10).boxed().collect(Collectors.toList());
        // Collections.shuffle(list, new Random(42));
        // → [4, 6, 2, 1, 7, 9, 8, 5, 3, 0]
        let mut list: Vec<i32> = (0..10).collect();
        rng.shuffle(&mut list);
        assert_eq!(list, vec![4, 6, 2, 1, 7, 9, 8, 5, 3, 0]);
    }

    /// Verify that seed=0 works correctly (edge case where seed ^ multiplier != 0).
    #[test]
    fn seed_zero() {
        let mut rng = JavaRandom::new(0);
        // Should not panic and should produce deterministic output
        let v = rng.next_int(100);
        assert!(v >= 0 && v < 100);
    }

    /// Verify nextInt(1) always returns 0.
    #[test]
    fn next_int_bound_one() {
        let mut rng = JavaRandom::new(42);
        for _ in 0..10 {
            assert_eq!(rng.next_int(1), 0);
        }
    }
}
