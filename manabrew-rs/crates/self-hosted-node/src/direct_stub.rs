//! The direct plane, compiled out.
//!
//! Builds without the `iroh` feature keep every call site in `host.rs` and get
//! a plane that never starts, so the fleet image carries no QUIC stack, no
//! gossip and no second listening socket until someone asks for them. See
//! `docs/TRANSPORT.md` for why that is the default.

use manabrew_relay_protocol::{SeatTransportReport, TransportEndpoint, TransportMember};
use serde_json::Value;
use tokio::sync::mpsc;

use crate::config::Config;

/// Uninhabited: without the feature nothing can accept a seat, so no value of
/// this type is ever constructed and every handler below is unreachable.
pub enum SeatConnection {}

pub struct DirectPlane(std::convert::Infallible);

impl DirectPlane {
    pub async fn start(_config: &Config) -> Option<(Self, mpsc::Receiver<SeatConnection>)> {
        None
    }

    pub async fn local_endpoint(&self) -> TransportEndpoint {
        match self.0 {}
    }

    pub async fn adopt_relay(&self, _url: &str, _token: Option<&str>) -> bool {
        match self.0 {}
    }

    pub fn apply_roster(
        &self,
        _room_id: &str,
        _topic_secret: &str,
        _host: Option<&TransportMember>,
        _members: &[TransportMember],
    ) {
        match self.0 {}
    }

    pub async fn join_gossip(&self, _username: &str) {
        match self.0 {}
    }

    pub fn register_seat<F>(&self, _seat: SeatConnection, _route: F)
    where
        F: Fn(&str, &Value) + Send + 'static,
    {
        match self.0 {}
    }

    pub fn freeze_for_game(&self, _seats: &[String]) -> Vec<String> {
        match self.0 {}
    }

    pub fn clear_game(&self) {
        match self.0 {}
    }

    pub fn set_on_fallback(&self, _reprime: impl Fn(&str) + Send + 'static) {
        match self.0 {}
    }

    pub fn note_relay_message(&self, _username: &str) {
        match self.0 {}
    }

    pub fn transport_report(&self, _seats: &[String]) -> Vec<SeatTransportReport> {
        match self.0 {}
    }

    pub fn try_send(&self, _target: &str, _envelope: &Value) -> bool {
        match self.0 {}
    }

    pub async fn shutdown(self) {
        match self.0 {}
    }
}
