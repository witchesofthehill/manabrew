//! The transport seam.
//!
//! A transport is not a trait object here. It is whatever task pumps a
//! [`GameChannel`]'s two ends and reports its own health. That is enough to
//! swap implementations, and it lets the existing relay WebSocket loop qualify
//! as a transport without being rewritten as a `dyn` implementation.

use std::time::Duration;

use tokio::sync::{mpsc, watch};

use crate::frames::SessionFrame;
use crate::{NetError, Result};

pub const CHANNEL_CAPACITY: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransportKind {
    /// manabrew-server carried it.
    Relay,
    /// iroh, on a direct path to the peer.
    IrohDirect,
    /// iroh, but the selected path still goes through an iroh relay.
    IrohRelayed,
}

impl TransportKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Relay => "relay",
            Self::IrohDirect => "iroh-direct",
            Self::IrohRelayed => "iroh-relayed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportStatus {
    pub kind: TransportKind,
    pub connected: bool,
    /// The selected path's remote address is private or link-local. This is the
    /// only thing "LAN" means here; it is an observation, not a mode.
    pub lan: bool,
    pub remote_addr: Option<String>,
    pub relay_url: Option<String>,
    pub rtt_ms: Option<u64>,
    pub setup_ms: Option<u64>,
    pub reconnects: u32,
    pub failure: Option<String>,
}

impl TransportStatus {
    pub fn relay() -> Self {
        Self {
            kind: TransportKind::Relay,
            connected: true,
            lan: false,
            remote_addr: None,
            relay_url: None,
            rtt_ms: None,
            setup_ms: None,
            reconnects: 0,
            failure: None,
        }
    }

    pub fn failed(kind: TransportKind, failure: impl Into<String>) -> Self {
        Self {
            kind,
            connected: false,
            lan: false,
            remote_addr: None,
            relay_url: None,
            rtt_ms: None,
            setup_ms: None,
            reconnects: 0,
            failure: Some(failure.into()),
        }
    }
}

/// Aborts a transport's pump tasks when the channel is dropped, which is what
/// closes the underlying connection.
#[derive(Debug, Default)]
pub struct ChannelGuard(Vec<tokio::task::JoinHandle<()>>);

impl ChannelGuard {
    pub fn new(tasks: Vec<tokio::task::JoinHandle<()>>) -> Self {
        Self(tasks)
    }
}

impl Drop for ChannelGuard {
    fn drop(&mut self) {
        for task in &self.0 {
            task.abort();
        }
    }
}

#[derive(Debug)]
pub struct GameChannel {
    outbound: mpsc::Sender<SessionFrame>,
    inbound: mpsc::Receiver<SessionFrame>,
    status: watch::Receiver<TransportStatus>,
    guard: Option<ChannelGuard>,
}

impl GameChannel {
    pub fn new(
        outbound: mpsc::Sender<SessionFrame>,
        inbound: mpsc::Receiver<SessionFrame>,
        status: watch::Receiver<TransportStatus>,
    ) -> Self {
        Self {
            outbound,
            inbound,
            status,
            guard: None,
        }
    }

    pub fn with_guard(mut self, guard: ChannelGuard) -> Self {
        self.guard = Some(guard);
        self
    }

    /// Wraps an already-running relay path as a transport. The relay loop keeps
    /// its own socket; it only hands over the two ends.
    pub fn relay(
        outbound: mpsc::Sender<SessionFrame>,
        inbound: mpsc::Receiver<SessionFrame>,
    ) -> Self {
        let (_tx, rx) = watch::channel(TransportStatus::relay());
        // The sender is dropped on purpose: a relay channel's status never
        // changes from this side, and `watch::Receiver::borrow` keeps working.
        Self::new(outbound, inbound, rx)
    }

    pub async fn send(&self, frame: SessionFrame) -> Result<()> {
        self.outbound
            .send(frame)
            .await
            .map_err(|_| NetError::Closed)
    }

    pub async fn recv(&mut self) -> Option<SessionFrame> {
        self.inbound.recv().await
    }

    pub async fn recv_timeout(&mut self, timeout: Duration) -> Option<SessionFrame> {
        tokio::time::timeout(timeout, self.inbound.recv())
            .await
            .ok()
            .flatten()
    }

    pub fn status(&self) -> TransportStatus {
        self.status.borrow().clone()
    }

    pub fn watch_status(&self) -> watch::Receiver<TransportStatus> {
        self.status.clone()
    }

    pub async fn close(mut self) {
        let _ = self.send(SessionFrame::Bye { reason: None }).await;
        self.inbound.close();
    }
}
