pub mod config;
#[cfg(feature = "iroh")]
pub mod direct;
#[cfg(not(feature = "iroh"))]
#[path = "direct_stub.rs"]
pub mod direct;
pub mod engine_backend;
pub mod host;
pub mod logs;
pub mod metrics;
/// Unconditional, unlike `direct`: the webview does not need the iroh feature
/// to hold a WebRTC connection, and a desktop build without iroh still hosts
/// browser seats.
pub mod shell_bridge;
pub mod updater;

/// Whether the `iroh` feature is compiled in. A build that turns the direct
/// plane on in config but was built without it announces no endpoint and keeps
/// every seat on the relay, saying nothing, so a caller that depends on the
/// plane should assert this at compile time rather than find out on a LAN.
pub const DIRECT_PLANE: bool = cfg!(feature = "iroh");

pub use config::Config;
pub use engine_backend::EngineBackendKind;
pub use host::{cli_entry, host_room, host_room_bridged, RoomCancel, ShellBridgeHandle};
