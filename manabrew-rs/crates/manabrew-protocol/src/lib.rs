//! Engine-free DTOs shared by the game clients: decks, the game-domain types,
//! prompts, display events and the agent transport envelopes. The relay wire
//! protocol lives in `manabrew-relay-protocol`, which depends on this crate.
/// This crate's version, which is also the version `@manabrew/protocol`
/// publishes at: `publish-protocol.yml` reads it out of this crate's
/// `Cargo.toml` and passes it to `npm version`. The generated `VERSION`
/// constant in the npm package is this string, so a consumer comparing
/// `VERSION` against the version they installed gets a match.
///
/// Distinct from `manabrew_relay_protocol::PROTOCOL_VERSION`, the integer
/// handshake number, which is that crate's major.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub mod deck_dto;
pub mod display;
pub mod game;
pub mod prompts;
pub mod token;
pub mod transport;

pub use token::TokenScript;
