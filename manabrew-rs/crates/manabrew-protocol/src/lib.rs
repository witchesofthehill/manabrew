//! Engine-free wire protocol shared by `manabrew-server` (the relay) and the game
//! clients — split out of `manabrew-agent-interface` so the relay needn't compile
//! the engine. Engine-coupled DTOs (prompts, `StateEnvelope`) stay there.
pub mod deck_dto;
pub mod display;
pub mod game;
pub mod prompts;
pub mod protocol;
pub mod transport;
