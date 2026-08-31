use std::net::SocketAddr;
use std::sync::Arc;

use manabrew_server::{analytics, config, deck_play_events, metrics, server, state};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "manabrew_server=info".into()),
        )
        .init();

    let metrics_handle = metrics::install();
    let config = config::ServerConfig::from_env();
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid address");
    let health_addr: SocketAddr = format!("{}:{}", config.host, config.health_port)
        .parse()
        .expect("Invalid health address");

    let analytics = analytics::AnalyticsHandle::from_config(&config);
    let deck_play_events = deck_play_events::DeckPlayEventHandle::from_config(&config);
    let state = Arc::new(
        state::ServerState::new(
            config.server_key.clone(),
            config.max_rooms,
            config.official_key.clone(),
            analytics,
            deck_play_events,
            config.hub_jwks_url.clone(),
        )
        .with_iroh_relay_url(config.iroh_relay_url.clone()),
    );

    let iroh_relay = spawn_iroh_relay(config.iroh_relay_port).await;

    if !state.identity.hub_configured() {
        tracing::info!("[auth] no hub jwks url -- account identity disabled, device proofs only");
    }

    server::run_server(state, addr, health_addr, metrics_handle).await;

    if let Some(relay) = iroh_relay {
        let _ = relay.shutdown().await;
    }
}

/// Hosts the deployment's own iroh relay in this process, so the data plane has
/// somewhere to fall back to that is ours. TLS is left off: the edge already
/// terminates it, and the relay speaks plain WebSocket under `/relay`, which a
/// reverse proxy carries unchanged.
async fn spawn_iroh_relay(port: Option<u16>) -> Option<iroh_relay::server::Server> {
    let port = port?;
    let bind = SocketAddr::from(([0, 0, 0, 0], port));
    let mut config = iroh_relay::server::ServerConfig::default();
    config.relay = Some(iroh_relay::server::RelayConfig::new(bind));
    match iroh_relay::server::Server::spawn(config).await {
        Ok(server) => {
            tracing::info!(%bind, "[iroh] hosting the relay for this deployment");
            Some(server)
        }
        Err(error) => {
            tracing::error!(%error, %bind, "[iroh] could not host the relay");
            None
        }
    }
}
