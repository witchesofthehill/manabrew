use std::time::{Duration, Instant};

use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::{Matcher, PrometheusBuilder};
use tracing::{info, warn};

const ROOMS_HOSTED: &str = "manabrew_node_rooms_hosted";
const GAMES_ACTIVE: &str = "manabrew_node_games_active";
const GAME_DURATION_SECONDS: &str = "manabrew_node_game_duration_seconds";
const FORGE_DECISION_STAGE_SECONDS: &str = "manabrew_node_forge_decision_stage_seconds";
const FORGE_DECISION_SECONDS: &str = "manabrew_node_forge_decision_seconds";
const ENGINE_ERRORS: &str = "manabrew_node_engine_errors_total";
const RELAY_RECONNECTS: &str = "manabrew_node_relay_reconnects_total";
#[cfg(feature = "iroh")]
const DIRECT_SEATS: &str = "manabrew_node_direct_seats_total";
#[cfg(feature = "iroh")]
const DIRECT_FRAMES: &str = "manabrew_node_direct_frames_total";
#[cfg(feature = "iroh")]
const DIRECT_FALLBACKS: &str = "manabrew_node_direct_fallbacks_total";
const BUILD_INFO: &str = "manabrew_node_build_info";
const RELAY_SEND_SECONDS: &str = "manabrew_node_relay_send_seconds";
const JVM_GC_PAUSE_SECONDS: &str = "manabrew_node_jvm_gc_pause_seconds";
const JVM_GC_TOTAL: &str = "manabrew_node_jvm_gc_total";
const JVM_HEAP_AFTER_GC_BYTES: &str = "manabrew_node_jvm_heap_after_gc_bytes";
const ENGINE_GC_COLLECTIONS: &str = "manabrew_node_engine_gc_collections_total";
const ENGINE_GC_PAUSE_MILLIS: &str = "manabrew_node_engine_gc_pause_millis_total";
const ENGINE_HEAP_USED_BYTES: &str = "manabrew_node_engine_heap_used_bytes";
const ENGINE_HEAP_MAX_BYTES: &str = "manabrew_node_engine_heap_max_bytes";
const ENGINE_STALL_MILLIS: &str = "manabrew_node_engine_stall_millis_total";
const ENGINE_LONG_STALLS: &str = "manabrew_node_engine_long_stalls_total";
const ENGINE_STALL_MAX_MILLIS: &str = "manabrew_node_engine_stall_max_millis";

const LABEL_POOL: &str = "pool";
const LABEL_KIND: &str = "kind";
const LABEL_CLEAN: &str = "clean";
const LABEL_PLAYERS: &str = "players";
const LABEL_SIGNATURE: &str = "signature";
const LABEL_STAGE: &str = "stage";
#[cfg(feature = "iroh")]
const LABEL_DIRECTION: &str = "direction";
const LABEL_COLLECTOR: &str = "collector";
const LABEL_VERSION: &str = "version";
const LABEL_SEATS: &str = "seats";

const ENV_PUSH_URL: &str = "SELF_HOSTED_NODE_METRICS_PUSH_URL";
const ENV_PUSH_USERNAME: &str = "SELF_HOSTED_NODE_METRICS_PUSH_USERNAME";
const ENV_PUSH_PASSWORD: &str = "SELF_HOSTED_NODE_METRICS_PUSH_PASSWORD";

const PUSH_INTERVAL: Duration = Duration::from_secs(15);

// Boundaries are close together through the range decisions actually land in.
// `histogram_quantile` interpolates linearly inside a bucket, so a wide one
// flatters the quantile upward: with 2.0 and 5.0 adjacent, a window holding a
// single decision somewhere between them reported 4.58s.
const DECISION_BUCKETS: &[f64] = &[
    0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0,
];

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
    // Only this metric gets explicit buckets. Everything else stays a summary,
    // whose quantiles are per process and cannot be aggregated across the fleet
    // — which is why a fleet-wide p99 was never really a fleet-wide p99.
    let builder = match PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full(FORGE_DECISION_SECONDS.to_string()),
            DECISION_BUCKETS,
        )
        .expect("decision buckets are a non-empty literal")
        .with_push_gateway(&url, PUSH_INTERVAL, username, password, false)
    {
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

/// Isolate-wide GC and heap, polled from the engine rather than parsed from a
/// log the graal fleet does not write. Cumulative, so
/// `rate(engine_gc_pause_millis_total) / 1000` is the fraction of wall clock
/// stopped, which is the figure that identified #684. Every room on the node
/// shares one isolate, so a collection here stops all of them at once.
/// The collection counters carry a `collector` label and are emitted by
/// [`record_engine_gc_collector`]; emitting an unlabelled copy of the same name
/// here would double every `sum`.
pub fn record_engine_gc(_collections: i64, _pause_millis: i64, heap_used: u64, heap_max: u64) {
    gauge!(ENGINE_HEAP_USED_BYTES).set(heap_used as f64);
    gauge!(ENGINE_HEAP_MAX_BYTES).set(heap_max as f64);
}

/// Split by collector. Incremental collections are a few milliseconds and
/// harmless; a complete collection traces the whole live set, and this live set
/// is a permanently reachable card database, so it costs about 1.3ms per MB
/// whether it reclaims anything or not. Only the complete series is worth
/// alerting on.
pub fn record_engine_gc_collector(collector: &str, collections: u64, pause_millis: u64) {
    let name = collector.to_string();
    counter!(ENGINE_GC_COLLECTIONS, LABEL_COLLECTOR => name.clone()).absolute(collections);
    counter!(ENGINE_GC_PAUSE_MILLIS, LABEL_COLLECTOR => name).absolute(pause_millis);
}

/// Wall clock the engine was stopped, from a probe inside the isolate rather
/// than from the collector. [`record_engine_gc_collector`] is the better signal
/// where it exists, but Substrate registers collector beans for its Serial GC
/// only, so on the G1 image it reports nothing at all and this is the only
/// series that shows a stall. Cumulative, so
/// `rate(engine_stall_millis_total) / 1000` is the fraction of wall clock lost.
pub fn record_engine_stall(stalled_millis: u64, max_stall_millis: u64, long_stalls: u64) {
    counter!(ENGINE_STALL_MILLIS).absolute(stalled_millis);
    counter!(ENGINE_LONG_STALLS).absolute(long_stalls);
    gauge!(ENGINE_STALL_MAX_MILLIS).set(max_stall_millis as f64);
}

pub fn record_relay_reconnect() {
    counter!(RELAY_RECONNECTS).increment(1);
}

#[cfg(feature = "iroh")]
pub fn record_direct_seat(kind: manabrew_net::TransportKind) {
    counter!(DIRECT_SEATS, LABEL_KIND => kind.as_str()).increment(1);
}

#[cfg(feature = "iroh")]
pub fn record_direct_frame(direction: &'static str) {
    counter!(DIRECT_FRAMES, LABEL_DIRECTION => direction).increment(1);
}

/// A seat that was on the direct plane and is now back on the relay.
#[cfg(feature = "iroh")]
pub fn record_direct_fallback() {
    counter!(DIRECT_FALLBACKS).increment(1);
}

pub fn record_forge_decision_stage(stage: &'static str, elapsed: Duration) {
    histogram!(FORGE_DECISION_STAGE_SECONDS, LABEL_STAGE => stage).record(elapsed.as_secs_f64());
}

/// The rules work between a seat answering and the next prompt appearing, split
/// by seat count. Measured over two days of captures, four seats run this at a
/// p99 of about 2.9s against 0.35s for two, and put 2-5% of decisions over two
/// seconds where two seats put none. A fleet-wide quantile averages the many
/// clean rooms against the few bad ones and shows neither.
///
/// There is no bot count. It was recorded from the engine's own AI seat list,
/// which is empty for every hosted game because bots join as ordinary relay
/// clients, so the label read zero on every series it ever produced. Only the
/// relay knows which seats are bots, and the node is not told.
pub fn record_forge_decision(seats: usize, elapsed: Duration) {
    histogram!(FORGE_DECISION_SECONDS, LABEL_SEATS => seats.to_string())
        .record(elapsed.as_secs_f64());
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
