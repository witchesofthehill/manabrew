//! In-memory ring buffer for structured log entries, exposed as a `tracing` layer.
//!
//! Captured events are served via the `/api/logs` dashboard endpoint.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

/// Maximum number of log entries kept in memory.
const MAX_ENTRIES: usize = 500;

/// A single structured log entry.
#[derive(Clone, Serialize)]
pub struct LogEntry {
    /// Monotonically increasing ID for incremental polling.
    pub id: u64,
    /// ISO-8601 timestamp.
    pub ts: String,
    /// Log level: "ERROR", "WARN", "INFO", "DEBUG", "TRACE".
    pub level: String,
    /// Tracing target (module path).
    pub target: String,
    /// Formatted message.
    pub message: String,
}

/// Shared ring buffer of log entries.
#[derive(Clone)]
pub struct LogBuffer {
    inner: Arc<Mutex<VecDeque<LogEntry>>>,
    next_id: Arc<AtomicU64>,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_ENTRIES))),
            next_id: Arc::new(AtomicU64::new(1)),
        }
    }

    /// Maximum message length kept per entry (longer messages are truncated).
    const MAX_MESSAGE_LEN: usize = 4096;

    /// Push a new entry into the ring buffer.
    fn push(&self, level: Level, target: &str, message: String) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let ts = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let message = if message.len() > Self::MAX_MESSAGE_LEN {
            let mut truncated = message[..Self::MAX_MESSAGE_LEN].to_string();
            truncated.push_str("...(truncated)");
            truncated
        } else {
            message
        };
        let entry = LogEntry {
            id,
            ts,
            level: level.to_string(),
            target: target.to_string(),
            message,
        };

        let mut buf = self.inner.lock().unwrap();
        if buf.len() >= MAX_ENTRIES {
            buf.pop_front();
        }
        buf.push_back(entry);
    }

    /// Return entries with id > `since`, up to `limit`.
    pub fn entries_since(&self, since: u64, limit: usize) -> Vec<LogEntry> {
        let buf = self.inner.lock().unwrap();
        buf.iter()
            .filter(|e| e.id > since)
            .take(limit)
            .cloned()
            .collect()
    }

    /// Return the most recent `limit` entries.
    pub fn recent(&self, limit: usize) -> Vec<LogEntry> {
        let buf = self.inner.lock().unwrap();
        let skip = buf.len().saturating_sub(limit);
        buf.iter().skip(skip).cloned().collect()
    }
}

/// Visitor that collects all fields from a tracing event into a readable message.
struct MessageVisitor {
    message: String,
    fields: Vec<String>,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
        } else {
            self.fields.push(format!("{}={:?}", field.name(), value));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.fields.push(format!("{}={}", field.name(), value));
        }
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.fields.push(format!("{}={}", field.name(), value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.fields.push(format!("{}={}", field.name(), value));
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.fields.push(format!("{}={:.1}", field.name(), value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.fields.push(format!("{}={}", field.name(), value));
    }
}

impl MessageVisitor {
    fn into_string(self) -> String {
        if self.fields.is_empty() {
            self.message
        } else if self.message.is_empty() {
            self.fields.join(" ")
        } else {
            format!("{} {}", self.message, self.fields.join(" "))
        }
    }
}

/// A `tracing_subscriber::Layer` that captures events into a [`LogBuffer`].
pub struct BufferLayer {
    buffer: LogBuffer,
}

impl BufferLayer {
    pub fn new(buffer: LogBuffer) -> Self {
        Self { buffer }
    }
}

impl<S: Subscriber> Layer<S> for BufferLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let meta = event.metadata();
        let mut visitor = MessageVisitor {
            message: String::new(),
            fields: Vec::new(),
        };
        event.record(&mut visitor);
        self.buffer
            .push(*meta.level(), meta.target(), visitor.into_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_capacity() {
        let buf = LogBuffer::new();
        for i in 0..550 {
            buf.push(Level::INFO, "test", format!("msg {i}"));
        }
        let entries = buf.recent(1000);
        assert_eq!(entries.len(), MAX_ENTRIES);
        // Oldest should be msg 50 (first 50 were evicted)
        assert!(entries[0].message.contains("50"));
    }

    #[test]
    fn entries_since() {
        let buf = LogBuffer::new();
        for i in 0..10 {
            buf.push(Level::INFO, "test", format!("msg {i}"));
        }
        // IDs start at 1, so since=5 means entries 6..10
        let entries = buf.entries_since(5, 100);
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[0].id, 6);
    }
}
