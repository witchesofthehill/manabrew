use std::time::{Duration, Instant};

use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::PrometheusBuilder;
use tracing::{info, warn};

const ROOMS_HOSTED: &str = "manabrew_node_rooms_hosted";
const GAMES_ACTIVE: &str = "manabrew_node_games_active";
const GAME_DURATION_SECONDS: &str = "manabrew_node_game_duration_seconds";
const ENGINE_ERRORS: &str = "manabrew_node_engine_errors_total";
const RELAY_RECONNECTS: &str = "manabrew_node_relay_reconnects_total";
const BUILD_INFO: &str = "manabrew_node_build_info";

const LABEL_POOL: &str = "pool";
const LABEL_CLEAN: &str = "clean";
const LABEL_PLAYERS: &str = "players";
const LABEL_SIGNATURE: &str = "signature";
const LABEL_VERSION: &str = "version";

const ENV_PUSH_URL: &str = "SELF_HOSTED_NODE_METRICS_PUSH_URL";
const ENV_PUSH_USERNAME: &str = "SELF_HOSTED_NODE_METRICS_PUSH_USERNAME";
const ENV_PUSH_PASSWORD: &str = "SELF_HOSTED_NODE_METRICS_PUSH_PASSWORD";

const PUSH_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Copy)]
pub enum PoolKind {
    Solo,
    Pod,
}

impl PoolKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Solo => "solo",
            Self::Pod => "pod",
        }
    }
}

#[derive(Clone, Copy)]
enum ErrorSignature {
    IndexOob,
    UnsupportedKind,
    Comparator,
    UnwrapNone,
    Trigger,
    Other,
}

impl ErrorSignature {
    fn bucket(message: &str) -> Self {
        let lower = message.to_lowercase();
        if lower.contains("index out of bounds") || lower.contains("indexoutofbounds") {
            Self::IndexOob
        } else if lower.contains("unsupported") || lower.contains("unimplemented") {
            Self::UnsupportedKind
        } else if lower.contains("comparator") {
            Self::Comparator
        } else if lower.contains("unwrap") || lower.contains("nullpointer") {
            Self::UnwrapNone
        } else if lower.contains("trigger") {
            Self::Trigger
        } else {
            Self::Other
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::IndexOob => "index_oob",
            Self::UnsupportedKind => "unsupported_kind",
            Self::Comparator => "comparator",
            Self::UnwrapNone => "unwrap_none",
            Self::Trigger => "trigger",
            Self::Other => "other",
        }
    }
}

pub fn init_from_env() {
    let Some(url) = std::env::var(ENV_PUSH_URL).ok().filter(|v| !v.is_empty()) else {
        return;
    };
    let username = std::env::var(ENV_PUSH_USERNAME)
        .ok()
        .filter(|v| !v.is_empty());
    let password = std::env::var(ENV_PUSH_PASSWORD)
        .ok()
        .filter(|v| !v.is_empty());
    let _ = rustls::crypto::ring::default_provider().install_default();
    let builder = match PrometheusBuilder::new().with_push_gateway(
        &url,
        PUSH_INTERVAL,
        username,
        password,
        false,
    ) {
        Ok(builder) => builder,
        Err(error) => {
            warn!(%error, url, "invalid metrics push gateway config");
            return;
        }
    };
    match builder.install() {
        Ok(()) => {
            gauge!(BUILD_INFO, LABEL_VERSION => env!("CARGO_PKG_VERSION")).set(1.0);
            info!(url, "metrics push exporter installed");
        }
        Err(error) => warn!(%error, url, "failed to install metrics push exporter"),
    }
}

pub struct RoomHostedGuard {
    pool: PoolKind,
}

impl RoomHostedGuard {
    pub fn new(pool: PoolKind) -> Self {
        gauge!(ROOMS_HOSTED, LABEL_POOL => pool.as_str()).increment(1.0);
        RoomHostedGuard { pool }
    }
}

impl Drop for RoomHostedGuard {
    fn drop(&mut self) {
        gauge!(ROOMS_HOSTED, LABEL_POOL => self.pool.as_str()).decrement(1.0);
    }
}

pub fn record_relay_reconnect() {
    counter!(RELAY_RECONNECTS).increment(1);
}

pub fn record_engine_session_started() {
    gauge!(GAMES_ACTIVE).increment(1.0);
}

pub fn record_engine_session_finished(players: usize, started: Instant, fatal: Option<&str>) {
    gauge!(GAMES_ACTIVE).decrement(1.0);
    let clean = if fatal.is_none() { "true" } else { "false" };
    histogram!(
        GAME_DURATION_SECONDS,
        LABEL_PLAYERS => players.to_string(),
        LABEL_CLEAN => clean
    )
    .record(started.elapsed().as_secs_f64());
    if let Some(message) = fatal {
        counter!(ENGINE_ERRORS, LABEL_SIGNATURE => ErrorSignature::bucket(message).as_str())
            .increment(1);
    }
}
