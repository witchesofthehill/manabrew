//! The manabrew data plane.
//!
//! `manabrew-server` stays the control plane: it authenticates sessions, owns
//! room lifecycle and membership, and is the only thing that binds a relay
//! username to an endpoint id. This crate carries game traffic between the peers
//! that control plane named, over the best transport they can reach, and falls
//! back to the relay when they cannot reach each other any other way.
//!
//! See `docs/TRANSPORT.md` for the architecture and the security argument.

pub mod channel;
pub mod endpoint;
pub mod frames;
pub mod gossip;
pub mod roster;

pub use channel::{GameChannel, TransportKind, TransportStatus};
pub use endpoint::{NetConfig, NetEndpoint, SeatConnection, GAME_ALPN};
pub use frames::SessionFrame;
pub use gossip::{Presence, RoomGossip, RoomGossipEvent, PRESENCE_TTL};
pub use roster::{Roster, RosterEntry};

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("endpoint id `{0}` is not a valid key")]
    BadEndpointId(String),
    #[error("relay url `{0}` is not valid")]
    BadRelayUrl(String),
    #[error("room topic secret is not 32 hex-encoded bytes")]
    BadTopicSecret,
    #[error("no relay-attested endpoint for `{0}` in this room")]
    UnknownPeer(String),
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
