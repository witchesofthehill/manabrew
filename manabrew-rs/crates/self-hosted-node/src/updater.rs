use std::time::Duration;

use tracing::{info, warn};

const DEFAULT_MANIFEST_URL: &str = "https://play.manabrew.app/manifest.json";
const DEFAULT_POLL_SECS: u64 = 300;
const NODE_VERSION: &str = env!("CARGO_PKG_VERSION");

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

pub async fn run_stale_monitor<F, S>(config: StaleConfig, is_idle: F, shutdown_rooms: S)
where
    F: Fn() -> bool + Send + 'static,
    S: Fn() + Send + 'static,
{
    let mut tick = tokio::time::interval(config.poll);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
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
        if is_idle() {
            warn!(
                current = NODE_VERSION,
                latest = %latest,
                "self-hosted-node is stale and idle — exiting so the supervisor respawns on the latest build"
            );
            shutdown_rooms();
            tokio::time::sleep(SHUTDOWN_GRACE).await;
            std::process::exit(0);
        }
        info!(
            current = NODE_VERSION,
            latest = %latest,
            "self-hosted-node is stale but a game is in progress — deferring shutdown until idle"
        );
    }
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
