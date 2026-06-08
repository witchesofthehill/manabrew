//! AI for the forge-engine Rust engine. Unlike the protocol-only bot in
//! `forge-bot`, this runs in-process with direct access to `GameState`, so it
//! can clone the state and drive the engine forward to look ahead.
//!
//! Evaluation heuristics are adapted from the phase-rs/phase `phase-ai` crate
//! (Apache-2.0). See THIRD-PARTY-NOTICES.md.

pub mod eval;
pub mod stats;
