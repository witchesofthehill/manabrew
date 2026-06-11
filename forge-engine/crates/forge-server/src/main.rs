use std::net::SocketAddr;
use std::sync::Arc;

mod cleanup;
mod config;
mod connection;
mod error;
mod lobby;
mod protocol;
mod replay;
mod room;
mod server;
mod state;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "forge_server=info".into()),
        )
        .init();

    let config = config::ServerConfig::from_env();
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid address");
    let health_addr: SocketAddr = format!("{}:{}", config.host, config.health_port)
        .parse()
        .expect("Invalid health address");

    let state = Arc::new(state::ServerState::new(
        config.server_key.clone(),
        config.max_rooms,
        config.official_key.clone(),
    ));

    server::run_server(state, addr, health_addr).await;
}
