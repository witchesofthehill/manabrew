use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tokio::sync::mpsc;
use tracing::warn;

use super::event::AnalyticsEvent;

const WARN_INTERVAL: Duration = Duration::from_secs(60);
const FILE_PREFIX: &str = "events-";
const FILE_EXTENSION: &str = "jsonl";
const DATE_FORMAT: &str = "%Y-%m-%d";

pub(super) fn spawn(rx: mpsc::Receiver<AnalyticsEvent>, dir: PathBuf) {
    std::thread::spawn(move || run(rx, dir));
}

fn run(mut rx: mpsc::Receiver<AnalyticsEvent>, dir: PathBuf) {
    if let Err(e) = std::fs::create_dir_all(&dir) {
        warn!("[analytics] cannot create events dir {:?}: {}", dir, e);
        return;
    }
    let mut current: Option<(String, File)> = None;
    let mut last_warn: Option<Instant> = None;
    while let Some(event) = rx.blocking_recv() {
        let Ok(line) = serde_json::to_string(&event) else {
            continue;
        };
        let date = today();
        if current.as_ref().map(|(d, _)| d != &date).unwrap_or(true) {
            current = open_daily_file(&dir, &date, &mut last_warn).map(|file| (date, file));
        }
        let Some((_, file)) = current.as_mut() else {
            continue;
        };
        if let Err(e) = writeln!(file, "{line}") {
            warn_rate_limited(
                &mut last_warn,
                format_args!("[analytics] write failed: {e}"),
            );
            current = None;
        }
    }
}

fn open_daily_file(dir: &Path, date: &str, last_warn: &mut Option<Instant>) -> Option<File> {
    let path = dir.join(format!("{FILE_PREFIX}{date}.{FILE_EXTENSION}"));
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => Some(file),
        Err(e) => {
            warn_rate_limited(
                last_warn,
                format_args!("[analytics] cannot open {path:?}: {e}"),
            );
            None
        }
    }
}

pub(super) fn today() -> String {
    chrono::Utc::now().format(DATE_FORMAT).to_string()
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
