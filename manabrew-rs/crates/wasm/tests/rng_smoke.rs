//! `StdRng::from_entropy()` panics at runtime on wasm32 without getrandom's
//! `js` feature — a `cargo build` won't catch it. Run with
//! `wasm-pack test --node` (not yet in CI).

use rand::rngs::StdRng;
use rand::{RngCore, SeedableRng};
use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn std_rng_from_entropy_constructs_and_produces_values() {
    let mut rng = StdRng::from_entropy();
    let a = rng.next_u64();
    let b = rng.next_u64();
    assert_ne!(a, b, "two consecutive draws should differ");
}
