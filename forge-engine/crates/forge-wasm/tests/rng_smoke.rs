//! Runtime smoke test for RNG construction on wasm32.
//!
//! `StdRng::from_entropy()` routes through `getrandom`, which on wasm32
//! pulls from `crypto.getRandomValues` — but only when getrandom's `js`
//! feature is enabled (see this crate's Cargo.toml). Without it the call
//! panics at runtime, and `cargo build --target wasm32-unknown-unknown`
//! does NOT catch that: the build succeeds, the panic only fires when the
//! code runs. Since the host runtime now expects the caller to construct
//! the RNG (both Tauri and WASM call `StdRng::from_entropy()`), this test
//! exercises that path in an actual wasm runtime.
//!
//! Run with: `wasm-pack test --node` (from this crate's dir) or
//!           `--headless --chrome`. Not yet wired into CI.

use rand::rngs::StdRng;
use rand::{RngCore, SeedableRng};
use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn std_rng_from_entropy_constructs_and_produces_values() {
    let mut rng = StdRng::from_entropy();
    // Two draws so we also exercise the generator, not just construction.
    let a = rng.next_u64();
    let b = rng.next_u64();
    assert_ne!(a, b, "two consecutive draws should differ");
}
