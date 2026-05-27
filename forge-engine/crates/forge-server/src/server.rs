use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpListener;
use tracing::{debug, error, info};

use crate::cleanup::cleanup_loop;
use crate::connection::handle_connection;
use crate::state::ServerState;

pub async fn run_server(state: Arc<ServerState>, addr: SocketAddr) {
    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind to address");

    info!("[server] Forge Server listening on ws://{}", addr);
    info!("[server] Server key: {}", mask_key(&state.server_key));
    info!("[server] Max rooms: {}", state.max_rooms);

    tokio::spawn(cleanup_loop(state.clone()));

    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                debug!("[server] accepted connection from {}", peer_addr);
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, peer_addr, state).await {
                        error!("[server] connection error from {}: {}", peer_addr, e);
                    }
                });
            }
            Err(e) => {
                error!("[server] accept error: {}", e);
            }
        }
    }
}

fn mask_key(key: &str) -> String {
    if key.len() <= 2 {
        "*".repeat(key.len())
    } else {
        format!(
            "{}{}{}",
            &key[..1],
            "*".repeat(key.len() - 2),
            &key[key.len() - 1..]
        )
    }
}
