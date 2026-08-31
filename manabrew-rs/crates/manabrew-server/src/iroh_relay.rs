//! The iroh relay this deployment hosts, in the same process as the game
//! socket. TLS is left off: in production the edge terminates it, and on a LAN
//! there is nothing to terminate.

use std::net::SocketAddr;

use tracing::{error, info};

pub use iroh_relay::server::Server;

/// Binds the relay, or returns `None` when it cannot start. A relay that fails
/// to bind must not take the game socket down with it: peers simply stay direct
/// only, which on a LAN is all they need anyway.
pub async fn spawn(bind: SocketAddr) -> Option<Server> {
    let mut config = iroh_relay::server::ServerConfig::default();
    config.relay = Some(iroh_relay::server::RelayConfig::new(bind));
    match Server::spawn(config).await {
        Ok(server) => {
            info!(%bind, "[iroh] hosting the relay for this deployment");
            Some(server)
        }
        Err(error) => {
            error!(%error, %bind, "[iroh] could not host the relay");
            None
        }
    }
}
