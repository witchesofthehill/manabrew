//! Generic bot agent. Connects to a manabrew-server relay as a regular client —
//! the relay sees it as just another player, with no `isBot` flag on the wire.
//!
//! The `BotState` lifecycle (auth → join → deck → ready → play) is pure data,
//! so the same machine drives the bot from a native tokio task (Tauri,
//! self-hosted-node) and from a browser WebSocket (web via `wasm::WasmBot`).
//!
//! The decision-making strategy is pluggable via the [`BotAgent`] trait;
//! [`AgentKind`] is the wire-level selector for which built-in agent to use.

pub mod agent;
mod state;

pub use agent::{AgentKind, BotAgent, BotResponder, SimpleAi};
pub use state::{BotConfig, BotState};

#[cfg(feature = "native")]
mod native;
#[cfg(feature = "native")]
pub use native::run_bot;
