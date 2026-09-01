//! The manabrew data plane.
//!
//! `manabrew-server` stays the control plane: it authenticates sessions, owns
//! room lifecycle and membership, and is the only thing that binds a relay
//! username to an endpoint id. This crate carries game traffic between the
//! peers that control plane named. Nothing here replaces the relay; a peer that
//! cannot bind or cannot reach the host stays on it.
//!
//! See `docs/TRANSPORT.md`.

pub mod channel;
pub mod endpoint;
pub mod frames;
pub mod roster;

pub use channel::{GameChannel, GameReceiver, GameSender, TransportKind, TransportStatus};
pub use endpoint::{NetConfig, NetEndpoint, SeatConnection, GAME_ALPN};
pub use frames::SessionFrame;
// Re-exported so a consumer never needs iroh in its own manifest, which would
// pull iroh's MSRV into a crate that does not otherwise compile it.
pub use iroh::{EndpointId, RelayMode, SecretKey};
pub use roster::{Roster, RosterEntry};

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("endpoint id `{0}` is not a valid key")]
    BadEndpointId(String),
    #[error("relay url `{0}` is not valid")]
    BadRelayUrl(String),
    #[error("the room has no authoritative host endpoint yet")]
    NoHost,
    #[error("host rejected the session: {0}")]
    Rejected(String),
    #[error("the session channel is closed")]
    Closed,
    #[error("frame is {0} bytes, over the {1} byte limit")]
    FrameTooLarge(usize, usize),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("iroh: {0}")]
    Iroh(String),
}

pub type Result<T> = std::result::Result<T, NetError>;
