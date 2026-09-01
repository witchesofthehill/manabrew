//! The seat's direct plane, compiled out.
//!
//! Without the `iroh` feature a bot stays on the relay for everything and the
//! binary carries no QUIC stack. Every call site in `native.rs` still compiles;
//! `start` just never hands one back.

use manabrew_agent_interface::protocol::{TransportEndpoint, TransportMember};
use serde_json::Value;

pub struct DirectSeat(std::convert::Infallible);

impl DirectSeat {
    pub async fn start(_username: &str, _iroh_relay_url: Option<&str>) -> Option<Self> {
        None
    }

    pub fn announced(&self) -> bool {
        match self.0 {}
    }

    pub async fn announce(&mut self) -> TransportEndpoint {
        match self.0 {}
    }

    pub async fn adopt_relay(&mut self, _url: Option<&str>, _token: Option<&str>) -> bool {
        match self.0 {}
    }

    pub async fn on_roster(
        &mut self,
        _room_id: &str,
        _topic_secret: &str,
        _host: Option<&TransportMember>,
        _members: &[TransportMember],
    ) {
        match self.0 {}
    }

    pub fn freeze(&mut self) {
        match self.0 {}
    }

    pub fn clear(&mut self) {
        match self.0 {}
    }

    pub fn try_send(&mut self, _envelope: &Value) -> bool {
        match self.0 {}
    }

    pub async fn recv(&mut self) -> Option<Value> {
        match self.0 {}
    }

    pub fn is_active(&self) -> bool {
        match self.0 {}
    }

    pub async fn shutdown(self) {
        match self.0 {}
    }
}
