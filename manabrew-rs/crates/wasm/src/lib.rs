//! WASM bindings for the manabrew-engine MTG rules engine.
//!
//! This crate provides a JavaScript-friendly API for running Magic: The Gathering
//! games entirely in the browser via WebAssembly.
//!
//! # Architecture
//!
//! The game engine runs synchronously, stepping through game states. The WASM API
//! exposes a step-based interface where:
//!
//! 1. Load card data with `load_card_bundle()`
//! 2. Create a game with `WasmGameEngine::new()`
//! 3. Call `step()` to advance until a decision is needed
//! 4. Get the current prompt with `get_prompt()`
//! 5. Send a response with `respond()`
//! 6. Repeat until game over
//!
//! This is designed to run in a Web Worker for non-blocking UI.

mod bot_api;
mod card_loader;
mod limited_api;
mod limited_bootstrap;
mod wasm_api;
pub mod wasm_transport;

pub use bot_api::*;
pub use card_loader::*;
pub use limited_api::*;
pub use limited_bootstrap::*;
pub use wasm_api::*;

use wasm_bindgen::prelude::*;

/// Initialize the WASM module. Call this once at startup.
#[wasm_bindgen(start)]
pub fn wasm_init() {
    // Set up better panic messages in the browser console
    console_error_panic_hook::set_once();

    // Log initialization
    web_sys::console::log_1(&"wasm initialized".into());
}

/// Log a message to the browser console (for debugging).
#[wasm_bindgen]
pub fn log(msg: &str) {
    web_sys::console::log_1(&msg.into());
}
