//! The desktop shell never installed a tracing subscriber, so every `info!`
//! and `warn!` from the embedded node was written to nothing. That is how the
//! host bridge could be denied at the IPC boundary for days without leaving a
//! trace: the denial was logged, and nobody was listening.
//!
//! Printing alone does not fix it. A bundled `.app` launched from Finder has
//! no stdout, and that is the build that matters — the one a player runs. So
//! the same lines also go to a file under the app's log directory, which is
//! somewhere a user can be asked to look.

use std::fs;

use tauri::{AppHandle, Manager};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// What to record when `RUST_LOG` says nothing. The node's own CLI defaults to
/// `self_hosted_node=info` for the same reason; the shell adds itself and the
/// relay it can embed.
const DEFAULT_FILTER: &str = "manabrew_lib=info,self_hosted_node=info,manabrew_server=info";

/// Kept for the life of the process: dropping it stops the writer thread and
/// silently truncates whatever had not been flushed.
static GUARD: std::sync::OnceLock<tracing_appender::non_blocking::WorkerGuard> =
    std::sync::OnceLock::new();

pub fn init(app: &AppHandle) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));

    // A missing log directory is not a reason to lose the terminal output too,
    // so the file layer is optional and the stdout layer is not.
    let file_layer = app
        .path()
        .app_log_dir()
        .ok()
        .and_then(|dir| fs::create_dir_all(&dir).ok().map(|()| dir))
        .map(|dir| {
            let appender = tracing_appender::rolling::daily(&dir, "manabrew.log");
            let (writer, guard) = tracing_appender::non_blocking(appender);
            let _ = GUARD.set(guard);
            eprintln!(
                "[startup] logging to {}",
                dir.join("manabrew.log").display()
            );
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(writer)
        });

    if tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(file_layer)
        .try_init()
        .is_err()
    {
        // Something already set the global subscriber. Losing that race is not
        // worth taking the app down for.
        eprintln!("[startup] tracing subscriber already installed");
    }
}
