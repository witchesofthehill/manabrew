use std::time::{Duration, Instant};

use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::PrometheusBuilder;
use tracing::{info, warn};

const ROOMS_HOSTED: &str = "manabrew_node_rooms_hosted";
const GAMES_ACTIVE: &str = "manabrew_node_games_active";
const GAME_DURATION_SECONDS: &str = "manabrew_node_game_duration_seconds";
const FORGE_DECISION_STAGE_SECONDS: &str = "manabrew_node_forge_decision_stage_seconds";
const ENGINE_ERRORS: &str = "manabrew_node_engine_errors_total";
const RELAY_RECONNECTS: &str = "manabrew_node_relay_reconnects_total";
const BUILD_INFO: &str = "manabrew_node_build_info";
const RELAY_SEND_SECONDS: &str = "manabrew_node_relay_send_seconds";
const JVM_GC_PAUSE_SECONDS: &str = "manabrew_node_jvm_gc_pause_seconds";
const JVM_GC_TOTAL: &str = "manabrew_node_jvm_gc_total";
const JVM_HEAP_AFTER_GC_BYTES: &str = "manabrew_node_jvm_heap_after_gc_bytes";
const STALE_CHECKS: &str = "manabrew_node_stale_checks_total";
const STALE_LIVE_ROOMS: &str = "manabrew_node_stale_live_rooms";

const LABEL_POOL: &str = "pool";
const LABEL_KIND: &str = "kind";
const LABEL_CLEAN: &str = "clean";
const LABEL_PLAYERS: &str = "players";
const LABEL_SIGNATURE: &str = "signature";
const LABEL_STAGE: &str = "stage";
const LABEL_VERSION: &str = "version";
const LABEL_DECISION: &str = "decision";

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

pub fn record_relay_send(elapsed: Duration) {
    histogram!(RELAY_SEND_SECONDS).record(elapsed.as_secs_f64());
}

/// Pause and retained heap reported by the engine JVM's own GC log. The fleet
/// ships no logs, so without this a stalled JVM is invisible from off-box.
pub fn record_jvm_gc(kind: &'static str, pause: Duration, heap_after_mb: Option<u64>) {
    histogram!(JVM_GC_PAUSE_SECONDS, LABEL_KIND => kind).record(pause.as_secs_f64());
    counter!(JVM_GC_TOTAL, LABEL_KIND => kind).increment(1);
    if let Some(megabytes) = heap_after_mb {
        gauge!(JVM_HEAP_AFTER_GC_BYTES, LABEL_KIND => kind).set((megabytes * 1024 * 1024) as f64);
    }
}

/// The stale updater's shutdown decision. A node that terminates itself takes
/// its container logs with it, so this counter is the only surviving evidence
/// of why the fleet bounced.
pub fn record_stale_check(live_rooms: Option<usize>) {
    let decision = match live_rooms {
        None => "unknown",
        Some(0) => "exit",
        Some(_) => "defer",
    };
    counter!(STALE_CHECKS, LABEL_DECISION => decision).increment(1);
    if let Some(live) = live_rooms {
        gauge!(STALE_LIVE_ROOMS).set(live as f64);
    }
}

pub fn record_relay_reconnect() {
    counter!(RELAY_RECONNECTS).increment(1);
}

pub fn record_forge_decision_stage(stage: &'static str, elapsed: Duration) {
    histogram!(FORGE_DECISION_STAGE_SECONDS, LABEL_STAGE => stage).record(elapsed.as_secs_f64());
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
