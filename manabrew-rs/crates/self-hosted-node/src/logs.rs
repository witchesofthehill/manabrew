//! Ships this node's warnings to Loki the same way metrics go to the push
//! gateway: the node pushes out, so a fleet on someone else's machine needs no
//! agent installed beside it.
//!
//! Without this the fleet's logs stayed on the box. `{service="self-hosted-node"}`
//! returned nothing for production, only for the staging node that happens to
//! run next to Loki, so a slow-decision warning naming its game was written and
//! never seen.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::mpsc;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

const ENV_URL: &str = "SELF_HOSTED_NODE_LOGS_PUSH_URL";
const ENV_USERNAME: &str = "SELF_HOSTED_NODE_LOGS_PUSH_USERNAME";
const ENV_PASSWORD: &str = "SELF_HOSTED_NODE_LOGS_PUSH_PASSWORD";
const ENV_LEVEL: &str = "SELF_HOSTED_NODE_LOGS_PUSH_LEVEL";
const ENV_INSTANCE: &str = "SELF_HOSTED_NODE_INSTANCE";
const ENV_METRICS_URL: &str = "SELF_HOSTED_NODE_METRICS_PUSH_URL";

const FLUSH_INTERVAL: Duration = Duration::from_secs(10);
const QUEUE_CAPACITY: usize = 2048;
const MAX_BATCH: usize = 512;

pub struct LokiLayer {
    tx: mpsc::Sender<(u128, String)>,
    level: Level,
    dropped: Arc<AtomicU64>,
}

#[derive(Default)]
struct MessageVisitor {
    message: String,
    fields: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        } else {
            self.fields
                .push_str(&format!(" {}={:?}", field.name(), value));
        }
    }
}

impl<S: Subscriber> Layer<S> for LokiLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let meta = event.metadata();
        if *meta.level() > self.level {
            return;
        }
        // The flusher reports its own failures through this same layer, so
        // without this an unreachable Loki would feed itself for ever.
        if meta.target().starts_with(module_path!()) {
            return;
        }
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let line = format!(
            "{} {} {}{}",
            meta.level(),
            meta.target(),
            visitor.message,
            visitor.fields
        );
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        if self.tx.try_send((nanos, line)).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// The instance label the push gateway already uses, so a node's logs and its
/// metrics carry the same name without configuring it twice.
fn instance_label() -> String {
    if let Ok(name) = std::env::var(ENV_INSTANCE) {
        if !name.is_empty() {
            return name;
        }
    }
    std::env::var(ENV_METRICS_URL)
        .ok()
        .and_then(|url| {
            url.rsplit_once("/instance/")
                .map(|(_, name)| name.trim_end_matches('/').to_string())
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn layer_from_env() -> Option<LokiLayer> {
    let url = std::env::var(ENV_URL).ok().filter(|v| !v.is_empty())?;
    let username = std::env::var(ENV_USERNAME).ok().filter(|v| !v.is_empty());
    let password = std::env::var(ENV_PASSWORD).ok().filter(|v| !v.is_empty());
    let level = match std::env::var(ENV_LEVEL)
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "trace" => Level::TRACE,
        "debug" => Level::DEBUG,
        "info" => Level::INFO,
        "error" => Level::ERROR,
        _ => Level::WARN,
    };
    let (tx, rx) = mpsc::channel(QUEUE_CAPACITY);
    let dropped = Arc::new(AtomicU64::new(0));
    tokio::spawn(run(
        rx,
        url,
        username,
        password,
        instance_label(),
        dropped.clone(),
    ));
    Some(LokiLayer { tx, level, dropped })
}

async fn run(
    mut rx: mpsc::Receiver<(u128, String)>,
    url: String,
    username: Option<String>,
    password: Option<String>,
    instance: String,
    dropped: Arc<AtomicU64>,
) {
    let client = reqwest::Client::new();
    let mut batch: Vec<(u128, String)> = Vec::new();
    let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
    let mut complained = false;
    loop {
        tokio::select! {
            line = rx.recv() => match line {
                Some(line) => {
                    batch.push(line);
                    if batch.len() < MAX_BATCH {
                        continue;
                    }
                }
                None => break,
            },
            _ = ticker.tick() => {}
        }
        if batch.is_empty() {
            continue;
        }
        let lost = dropped.swap(0, Ordering::Relaxed);
        if lost > 0 {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            batch.push((
                nanos,
                format!("WARN {} dropped {lost} log lines", module_path!()),
            ));
        }
        let values: Vec<[String; 2]> = batch
            .drain(..)
            .map(|(nanos, line)| [nanos.to_string(), line])
            .collect();
        let payload = serde_json::json!({
            "streams": [{
                "stream": { "service": "self-hosted-node", "instance": instance },
                "values": values,
            }]
        });
        let mut request = client.post(&url).json(&payload);
        if let Some(user) = &username {
            request = request.basic_auth(user, password.clone());
        }
        match request.send().await {
            Ok(response) if response.status().is_success() => complained = false,
            // Reported to stderr, never through `tracing`: this task is what
            // drains the layer's queue.
            Ok(response) => {
                if !complained {
                    complained = true;
                    eprintln!("[logs] loki push rejected: {}", response.status());
                }
            }
            Err(error) => {
                if !complained {
                    complained = true;
                    eprintln!("[logs] loki push failed: {error}");
                }
            }
        }
    }
}
