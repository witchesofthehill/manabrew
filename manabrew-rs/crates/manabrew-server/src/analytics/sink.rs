use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tokio::sync::mpsc;
use tracing::{info, warn};

use super::event::AnalyticsEvent;
use crate::metrics;

const WARN_INTERVAL: Duration = Duration::from_secs(60);
const FILE_EXTENSION: &str = "jsonl";
const DATE_FORMAT: &str = "%Y-%m-%d";
const MAX_BATCH: usize = 200;
const BATCH_LINGER: Duration = Duration::from_millis(250);
const POST_ATTEMPTS: u32 = 3;
const DRAIN_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub(super) struct HubTarget {
    pub url: String,
    pub token: String,
}

/// With a hub, every event is posted there and the directory is only a spool
/// for what could not be delivered, drained on a timer. Without one the
/// directory gets the daily JSONL files it always did.
pub(super) fn spawn(
    rx: mpsc::Receiver<AnalyticsEvent>,
    dir: Option<PathBuf>,
    hub: Option<HubTarget>,
) {
    if let (Some(dir), Some(hub)) = (dir.clone(), hub.clone()) {
        tokio::spawn(drain_loop(dir, hub));
    }
    tokio::spawn(run(rx, dir, hub));
}

async fn run(mut rx: mpsc::Receiver<AnalyticsEvent>, dir: Option<PathBuf>, hub: Option<HubTarget>) {
    if let Some(dir) = &dir {
        if let Err(e) = std::fs::create_dir_all(dir) {
            warn!("[analytics] cannot create events dir {:?}: {}", dir, e);
        }
    }
    let client = reqwest::Client::new();
    let mut last_warn: Option<Instant> = None;
    let mut spool_seq: u64 = 0;
    while let Some(first) = rx.recv().await {
        let mut lines = Vec::with_capacity(MAX_BATCH);
        push_line(&mut lines, &first);
        let deadline = tokio::time::Instant::now() + BATCH_LINGER;
        while lines.len() < MAX_BATCH {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(event)) => push_line(&mut lines, &event),
                _ => break,
            }
        }
        match &hub {
            Some(hub) => {
                if post(&client, hub, &lines).await {
                    metrics::record_analytics_delivered(metrics::ANALYTICS_LIVE, lines.len());
                } else if let Some(dir) = &dir {
                    spool_seq += 1;
                    write_file(&spool_path(dir, spool_seq), &lines, &mut last_warn);
                    metrics::record_analytics_delivered(metrics::ANALYTICS_SPOOLED, lines.len());
                } else {
                    for _ in &lines {
                        metrics::record_analytics_dropped();
                    }
                }
            }
            None => {
                if let Some(dir) = &dir {
                    write_file(&daily_path(dir), &lines, &mut last_warn);
                }
            }
        }
    }
}

fn push_line(lines: &mut Vec<String>, event: &AnalyticsEvent) {
    if let Ok(line) = serde_json::to_string(event) {
        lines.push(line);
    }
}

async fn post(client: &reqwest::Client, hub: &HubTarget, lines: &[String]) -> bool {
    let url = format!(
        "{}/internal/analytics/events",
        hub.url.trim_end_matches('/')
    );
    let body = serde_json::json!({ "events": lines });
    for attempt in 0..POST_ATTEMPTS {
        match client
            .post(&url)
            .bearer_auth(&hub.token)
            .json(&body)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return true,
            Ok(response) => {
                warn!(status = %response.status(), "[analytics] hub refused an event batch")
            }
            Err(error) => warn!(%error, "[analytics] hub event delivery failed"),
        }
        tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
    }
    false
}

/// Every `.jsonl` in the directory is either a spool file this relay wrote or
/// a daily file from before events went to the hub; both are delivered whole
/// and removed. A file that fails stays for the next round.
async fn drain_loop(dir: PathBuf, hub: HubTarget) {
    let client = reqwest::Client::new();
    loop {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .filter(|path| path.extension().is_some_and(|ext| ext == FILE_EXTENSION))
                    .collect()
            })
            .unwrap_or_default();
        files.sort();
        for path in files {
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let lines: Vec<String> = content
                .split('\n')
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect();
            let mut delivered = true;
            for chunk in lines.chunks(MAX_BATCH) {
                if !post(&client, &hub, chunk).await {
                    delivered = false;
                    break;
                }
            }
            if !delivered {
                break;
            }
            metrics::record_analytics_delivered(metrics::ANALYTICS_DRAINED, lines.len());
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    info!(path = %path.display(), lines = lines.len(), "[analytics] drained into the hub")
                }
                Err(error) => {
                    warn!(path = %path.display(), %error, "[analytics] drained but could not remove");
                    return;
                }
            }
        }
        tokio::time::sleep(DRAIN_INTERVAL).await;
    }
}

fn spool_path(dir: &Path, seq: u64) -> PathBuf {
    let millis = chrono::Utc::now().timestamp_millis();
    dir.join(format!("spool-{millis}-{seq}.{FILE_EXTENSION}"))
}

pub(super) fn today() -> String {
    chrono::Utc::now().format(DATE_FORMAT).to_string()
}

fn daily_path(dir: &Path) -> PathBuf {
    dir.join(format!("events-{}.{FILE_EXTENSION}", today()))
}

fn write_file(path: &Path, lines: &[String], last_warn: &mut Option<Instant>) {
    let written = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| {
            for line in lines {
                writeln!(file, "{line}")?;
            }
            Ok(())
        });
    if let Err(e) = written {
        warn_rate_limited(
            last_warn,
            format_args!("[analytics] cannot write {path:?}: {e}"),
        );
        for _ in lines {
            metrics::record_analytics_dropped();
        }
    }
}

pub(super) fn warn_rate_limited(last_warn: &mut Option<Instant>, message: std::fmt::Arguments<'_>) {
    if last_warn
        .map(|at| at.elapsed() < WARN_INTERVAL)
        .unwrap_or(false)
    {
        return;
    }
    *last_warn = Some(Instant::now());
    warn!("{}", message);
}
