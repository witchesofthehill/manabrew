use std::time::Duration;

use rand::Rng;
use tracing::{info, warn};

const DEFAULT_MANIFEST_URL: &str = "https://play.manabrew.app/manifest.json";
const DEFAULT_POLL_SECS: u64 = 300;
const NODE_VERSION: &str = env!("CARGO_PKG_VERSION");
const POLL_JITTER: f64 = 0.25;

pub struct StaleConfig {
    pub enabled: bool,
    pub manifest_url: String,
    pub poll: Duration,
}

impl StaleConfig {
    pub fn from_env_and_args() -> Self {
        let enabled = std::env::args().any(|arg| arg == "--shutdown-on-stale")
            || env_flag("SELF_HOSTED_NODE_SHUTDOWN_ON_STALE");
        let manifest_url = std::env::var("SELF_HOSTED_NODE_MANIFEST_URL")
            .unwrap_or_else(|_| DEFAULT_MANIFEST_URL.to_string());
        let poll = std::env::var("SELF_HOSTED_NODE_STALE_POLL_SECS")
            .ok()
            .and_then(|value| value.parse().ok())
            .map(Duration::from_secs)
            .unwrap_or(Duration::from_secs(DEFAULT_POLL_SECS));
        Self {
            enabled,
            manifest_url,
            poll,
        }
    }
}

const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

/// `live_rooms` returns `None` when liveness is unknowable; only an explicit
/// zero may end the process. `start_drain` must drain rather than kill, so that
/// publishing a release never ends a game in progress (#734).
pub async fn run_stale_monitor<F, S>(config: StaleConfig, live_rooms: F, start_drain: S)
where
    F: Fn() -> Option<usize> + Send + 'static,
    S: Fn() + Send + 'static,
{
    loop {
        tokio::time::sleep(next_poll(config.poll)).await;
        let Some(latest) = fetch_node_version(&config.manifest_url).await else {
            continue;
        };
        if !is_behind(NODE_VERSION, &latest) {
            continue;
        }
        if !config.enabled {
            warn!(
                current = NODE_VERSION,
                latest = %latest,
                manifest = %config.manifest_url,
                "self-hosted-node is OUT OF DATE — a newer build is published; restart on the latest release (enable --shutdown-on-stale to auto-exit when idle)"
            );
            continue;
        }
        let live = live_rooms();
        crate::metrics::record_stale_check(live);
        start_drain();
        if live != Some(0) {
            info!(
                current = NODE_VERSION,
                latest = %latest,
                live_rooms = ?live,
                "self-hosted-node is stale but rooms are live — draining, shutdown deferred until idle"
            );
            continue;
        }
        warn!(
            current = NODE_VERSION,
            latest = %latest,
            live_rooms = 0,
            "self-hosted-node is stale and every room is idle — exiting so the supervisor respawns on the latest build"
        );
        tokio::time::sleep(SHUTDOWN_GRACE).await;
        let live = live_rooms();
        if live != Some(0) {
            crate::metrics::record_stale_check(live);
            warn!(
                live_rooms = ?live,
                "a room went live during the shutdown grace — staying up until it drains"
            );
            continue;
        }
        std::process::exit(0);
    }
}

fn next_poll(poll: Duration) -> Duration {
    poll + poll.mul_f64(POLL_JITTER * rand::thread_rng().gen::<f64>())
}

async fn fetch_node_version(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let manifest: serde_json::Value = client.get(url).send().await.ok()?.json().await.ok()?;
    manifest
        .get("packages")?
        .get("self-hosted-node")?
        .as_str()
        .map(str::to_string)
}

fn is_behind(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(current), Some(latest)) => latest > current,
        _ => false,
    }
}

fn parse_semver(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts
        .next()
        .unwrap_or("0")
        .split('-')
        .next()?
        .parse::<u64>()
        .ok()?;
    Some((major, minor, patch))
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}
