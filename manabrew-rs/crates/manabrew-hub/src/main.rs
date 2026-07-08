mod config;
mod rate_limit;
mod routes;
mod stats;
mod storage;
mod validate;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tracing_subscriber::EnvFilter;

use crate::config::HubConfig;
use crate::rate_limit::RateLimiter;
use crate::routes::{build_router, AppState};
use crate::stats::StatsCache;
use crate::storage::Storage;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("manabrew_hub=info")),
        )
        .init();
    let config = HubConfig::from_env();
    if let Some(parent) = std::path::Path::new(&config.db_path).parent() {
        std::fs::create_dir_all(parent).expect("create hub db directory");
    }
    let storage = Storage::open(&config.db_path).expect("open hub db");
    let state = Arc::new(AppState {
        storage: Mutex::new(storage),
        stats: StatsCache::new(config.events_db_path.clone()),
        limiter: RateLimiter::new(config.publish_per_hour),
        publish_per_day: config.publish_per_day,
    });
    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind hub listener");
    tracing::info!(%addr, db = %config.db_path, "manabrew-hub listening");
    axum::serve(
        listener,
        build_router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("serve hub");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install ctrl-c handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install sigterm handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
