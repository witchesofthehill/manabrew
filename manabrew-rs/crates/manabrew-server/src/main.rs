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
        .with_direct_transport(config.direct_transport, config.iroh_relay_url.clone()),
    );

    if !state.identity.hub_configured() {
        tracing::info!("[auth] no hub jwks url -- account identity disabled, device proofs only");
    }

    server::run_server(state, addr, health_addr, metrics_handle).await;
}
