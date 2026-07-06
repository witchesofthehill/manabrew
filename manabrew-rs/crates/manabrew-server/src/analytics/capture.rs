use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime};

use tracing::warn;
use zstd::Encoder;

use super::writer::{today, warn_rate_limited};

const COMPRESSION_LEVEL: i32 = 3;
const FILE_EXTENSION: &str = "jsonl.zst";
const IDLE_TIMEOUT: Duration = Duration::from_secs(6 * 3600);
const HOUSEKEEPING_INTERVAL: Duration = Duration::from_secs(60);

pub(super) enum CaptureMessage {
    Open { game_id: String, header: String },
    Line { game_id: String, line: String },
    Close { game_id: String, footer: String },
}

struct ActiveCapture {
    encoder: Encoder<'static, File>,
    last_write: Instant,
}

pub(super) fn spawn(rx: Receiver<CaptureMessage>, dir: PathBuf, max_bytes: u64) {
    std::thread::spawn(move || run(rx, dir, max_bytes));
}

fn run(rx: Receiver<CaptureMessage>, dir: PathBuf, max_bytes: u64) {
    if let Err(e) = std::fs::create_dir_all(&dir) {
        warn!("[capture] cannot create capture dir {:?}: {}", dir, e);
        return;
    }
    let mut active: HashMap<String, ActiveCapture> = HashMap::new();
    let mut current_date = today();
    let mut last_housekeeping = Instant::now();
    let mut last_warn: Option<Instant> = None;
    loop {
        match rx.recv_timeout(HOUSEKEEPING_INTERVAL) {
            Ok(CaptureMessage::Open { game_id, header }) => {
                if let Some(mut capture) = open_capture(&dir, &today(), &game_id, &mut last_warn) {
                    write_line(&mut capture, &header, &mut last_warn);
                    active.insert(game_id, capture);
                }
            }
            Ok(CaptureMessage::Line { game_id, line }) => {
                if let Some(capture) = active.get_mut(&game_id) {
                    write_line(capture, &line, &mut last_warn);
                }
            }
            Ok(CaptureMessage::Close { game_id, footer }) => {
                if let Some(mut capture) = active.remove(&game_id) {
                    write_line(&mut capture, &footer, &mut last_warn);
                    finish(capture, &mut last_warn);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if last_housekeeping.elapsed() >= HOUSEKEEPING_INTERVAL {
            last_housekeeping = Instant::now();
            close_idle(&mut active, &mut last_warn);
            let date = today();
            if date != current_date {
                current_date = date;
                enforce_retention(&dir, max_bytes);
            }
        }
    }
    for (_, capture) in active.drain() {
        finish(capture, &mut last_warn);
    }
}

fn open_capture(
    dir: &Path,
    date: &str,
    game_id: &str,
    last_warn: &mut Option<Instant>,
) -> Option<ActiveCapture> {
    let subdir = dir.join(date);
    if let Err(e) = std::fs::create_dir_all(&subdir) {
        warn_rate_limited(
            last_warn,
            format_args!("[capture] cannot create {subdir:?}: {e}"),
        );
        return None;
    }
    let path = subdir.join(format!("{game_id}.{FILE_EXTENSION}"));
    let file = match File::create(&path) {
        Ok(file) => file,
        Err(e) => {
            warn_rate_limited(
                last_warn,
                format_args!("[capture] cannot create {path:?}: {e}"),
            );
            return None;
        }
    };
    match Encoder::new(file, COMPRESSION_LEVEL) {
        Ok(encoder) => Some(ActiveCapture {
            encoder,
            last_write: Instant::now(),
        }),
        Err(e) => {
            warn_rate_limited(
                last_warn,
                format_args!("[capture] cannot start encoder for {path:?}: {e}"),
            );
            None
        }
    }
}

fn write_line(capture: &mut ActiveCapture, line: &str, last_warn: &mut Option<Instant>) {
    if line.is_empty() {
        return;
    }
    if let Err(e) = writeln!(capture.encoder, "{line}") {
        warn_rate_limited(last_warn, format_args!("[capture] write failed: {e}"));
    }
    capture.last_write = Instant::now();
}

fn finish(capture: ActiveCapture, last_warn: &mut Option<Instant>) {
    if let Err(e) = capture.encoder.finish() {
        warn_rate_limited(last_warn, format_args!("[capture] finish failed: {e}"));
    }
}

fn close_idle(active: &mut HashMap<String, ActiveCapture>, last_warn: &mut Option<Instant>) {
    let idle: Vec<String> = active
        .iter()
        .filter(|(_, capture)| capture.last_write.elapsed() >= IDLE_TIMEOUT)
        .map(|(game_id, _)| game_id.clone())
        .collect();
    for game_id in idle {
        if let Some(capture) = active.remove(&game_id) {
            finish(capture, last_warn);
        }
    }
}

fn enforce_retention(dir: &Path, max_bytes: u64) {
    let mut files: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for subdir in entries.flatten() {
        let Ok(children) = std::fs::read_dir(subdir.path()) else {
            continue;
        };
        subdirs.push(subdir.path());
        for entry in children.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            files.push((modified, meta.len(), entry.path()));
        }
    }
    let mut total: u64 = files.iter().map(|(_, len, _)| len).sum();
    if total > max_bytes {
        files.sort_by_key(|(modified, _, _)| *modified);
        for (_, len, path) in files {
            if total <= max_bytes {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(len);
            }
        }
    }
    for subdir in subdirs {
        let _ = std::fs::remove_dir(subdir);
    }
}
