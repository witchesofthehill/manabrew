//! Engine-free DTOs shared by the game clients: decks, the game-domain types,
//! prompts, display events and the agent transport envelopes. The relay wire
//! protocol lives in `manabrew-relay-protocol`, which depends on this crate.
pub mod deck_dto;
pub mod display;
pub mod game;
pub mod prompts;
pub mod token;
pub mod transport;

pub use token::TokenScript;
