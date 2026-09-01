//! The transport seam.
//!
//! A transport is not a trait object here. It is whatever task pumps a
//! [`GameChannel`]'s two ends and reports its own health. That is enough to
//! swap implementations, and it lets the existing relay WebSocket loop qualify
//! as a transport without being rewritten as a `dyn` implementation.

use std::sync::Arc;

use tokio::sync::{mpsc, watch};

use crate::frames::SessionFrame;
use crate::{NetError, Result};

pub const CHANNEL_CAPACITY: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TransportKind {
    /// A direct path to the peer.
    #[serde(rename = "iroh-direct")]
    Direct,
    /// The selected path still goes through an iroh relay.
    #[serde(rename = "iroh-relayed")]
    Relayed,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportStatus {
    pub kind: TransportKind,
    /// The selected path's remote address is private or link-local. This is the
    /// only thing "LAN" means here; it is an observation, not a mode.
    pub lan: bool,
    pub rtt_ms: Option<u64>,
    pub setup_ms: Option<u64>,
    pub reconnects: u32,
}

/// Aborts a transport's pump tasks when the last half of the channel is
/// dropped, which is what closes the underlying connection.
#[derive(Debug)]
pub struct ChannelGuard(Vec<n0_future::task::JoinHandle<()>>);

impl ChannelGuard {
    pub fn new(tasks: Vec<n0_future::task::JoinHandle<()>>) -> Self {
        Self(tasks)
    }

    fn abort(&self) {
        for task in &self.0 {
            task.abort();
        }
    }
}

impl Drop for ChannelGuard {
    fn drop(&mut self) {
        self.abort();
    }
}

#[derive(Debug)]
pub struct GameChannel {
    outbound: mpsc::Sender<SessionFrame>,
    inbound: mpsc::Receiver<SessionFrame>,
    status: watch::Receiver<TransportStatus>,
    guard: Option<Arc<ChannelGuard>>,
}

/// The send half of a [`GameChannel`]. Splitting is what lets one task write
/// while another reads; both halves keep the transport's tasks alive.
#[derive(Debug, Clone)]
pub struct GameSender {
    outbound: mpsc::Sender<SessionFrame>,
    status: watch::Receiver<TransportStatus>,
    guard: Option<Arc<ChannelGuard>>,
}

#[derive(Debug)]
pub struct GameReceiver {
    inbound: mpsc::Receiver<SessionFrame>,
    _guard: Option<Arc<ChannelGuard>>,
}

impl GameSender {
    pub async fn send(&self, frame: SessionFrame) -> Result<()> {
        self.outbound
            .send(frame)
            .await
            .map_err(|_| NetError::Closed)
    }

    pub fn try_send(&self, frame: SessionFrame) -> Result<()> {
        self.outbound.try_send(frame).map_err(|_| NetError::Closed)
    }

    pub fn status(&self) -> TransportStatus {
        self.status.borrow().clone()
    }

    /// Tears the transport down from the send half alone. Dropping a sender is
    /// not enough: the receiver holds the same guard, so a reader that outlives
    /// its sender keeps the connection open and keeps delivering. A superseded
    /// connection has to be closed, not merely forgotten.
    pub fn close(&self) {
        if let Some(guard) = &self.guard {
            guard.abort();
        }
    }
}

impl GameReceiver {
    pub async fn recv(&mut self) -> Option<SessionFrame> {
        self.inbound.recv().await
    }
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
        self.guard = Some(Arc::new(guard));
        self
    }

    pub fn split(self) -> (GameSender, GameReceiver) {
        (
            GameSender {
                outbound: self.outbound,
                status: self.status,
                guard: self.guard.clone(),
            },
            GameReceiver {
                inbound: self.inbound,
                _guard: self.guard,
            },
        )
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

    pub fn status(&self) -> TransportStatus {
        self.status.borrow().clone()
    }
}
