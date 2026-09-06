//! The transport seam. A transport is whatever task pumps a [`GameChannel`]'s
//! two ends and reports its health, so the relay WebSocket loop qualifies
//! without becoming a `dyn` implementation.

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

impl TransportKind {
    /// The same strings the serde renames produce, so a log line, a metric
    /// label and a transport report all say the same word.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Direct => manabrew_relay_protocol::TRANSPORT_IROH_DIRECT,
            Self::Relayed => manabrew_relay_protocol::TRANSPORT_IROH_RELAYED,
        }
    }
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

/// The send half of a [`GameChannel`]; both halves keep the pump tasks alive.
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

    /// Tears the transport down from the send half. Dropping a sender is not
    /// enough: the receiver holds the same guard, so a superseded connection
    /// must be closed, not forgotten, or its reader keeps delivering.
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
