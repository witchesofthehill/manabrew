//! The relay-attested view of a room's data plane. Everything comes from
//! `ServerMessage::RoomTransport`, filled in from the relay's own session
//! records; a peer learned any other way is not believed.

use std::collections::HashMap;
use std::str::FromStr;

use iroh::{EndpointAddr, EndpointId, RelayUrl, TransportAddr};
use manabrew_relay_protocol::{TransportEndpoint, TransportMember};

use crate::{NetError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterEntry {
    pub username: String,
    pub endpoint_id: EndpointId,
    pub addr: EndpointAddr,
    pub host: bool,
}

#[derive(Debug, Clone)]
pub struct Roster {
    room_id: String,
    entries: Vec<RosterEntry>,
    by_endpoint: HashMap<EndpointId, usize>,
}

impl Roster {
    pub fn new(room_id: &str, host: Option<&TransportMember>, members: &[TransportMember]) -> Self {
        let host_name = host.map(|m| m.username.as_str());
        // A member whose endpoint does not parse is dropped, not failed: one
        // bad announcement must not cost everyone else the plane.
        let entries: Vec<RosterEntry> = members
            .iter()
            .filter_map(|member| {
                let addr = to_endpoint_addr(&member.endpoint).ok()?;
                Some(RosterEntry {
                    username: member.username.clone(),
                    endpoint_id: addr.id,
                    addr,
                    host: member.host || Some(member.username.as_str()) == host_name,
                })
            })
            .collect();

        let by_endpoint = entries
            .iter()
            .enumerate()
            .map(|(idx, entry)| (entry.endpoint_id, idx))
            .collect();

        Self {
            room_id: room_id.to_string(),
            entries,
            by_endpoint,
        }
    }

    pub fn room_id(&self) -> &str {
        &self.room_id
    }

    pub fn host(&self) -> Option<&RosterEntry> {
        self.entries.iter().find(|entry| entry.host)
    }

    pub fn entries(&self) -> &[RosterEntry] {
        &self.entries
    }

    /// The relay's answer to "who is this endpoint id?". `None` means the peer
    /// is not in this room as far as the control plane is concerned.
    pub fn username_of(&self, endpoint_id: &EndpointId) -> Option<&str> {
        self.by_endpoint
            .get(endpoint_id)
            .map(|idx| self.entries[*idx].username.as_str())
    }
}

pub fn to_endpoint_addr(endpoint: &TransportEndpoint) -> Result<EndpointAddr> {
    let id = EndpointId::from_str(&endpoint.endpoint_id)
        .map_err(|_| NetError::BadEndpointId(endpoint.endpoint_id.clone()))?;
    let mut addr = EndpointAddr::new(id);
    if let Some(url) = &endpoint.relay_url {
        let url = RelayUrl::from_str(url).map_err(|_| NetError::BadRelayUrl(url.clone()))?;
        addr = addr.with_relay_url(url);
    }
    for direct in &endpoint.direct_addrs {
        if let Ok(socket) = direct.parse() {
            addr = addr.with_ip_addr(socket);
        }
    }
    Ok(addr)
}

pub fn to_transport_endpoint(addr: &EndpointAddr) -> TransportEndpoint {
    let mut relay_url = None;
    let mut direct_addrs = Vec::new();
    for entry in &addr.addrs {
        match entry {
            TransportAddr::Relay(url) => relay_url = Some(url.to_string()),
            TransportAddr::Ip(socket) => direct_addrs.push(socket.to_string()),
            _ => {}
        }
    }
    TransportEndpoint {
        endpoint_id: addr.id.to_string(),
        relay_url,
        direct_addrs,
        // Stated rather than left to the empty-means-iroh default, so a browser
        // can read what the host speaks.
        kinds: vec![manabrew_relay_protocol::TRANSPORT_KIND_IROH.to_string()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;

    fn member(username: &str, id: &EndpointId, host: bool) -> TransportMember {
        TransportMember {
            username: username.to_string(),
            endpoint: TransportEndpoint {
                endpoint_id: id.to_string(),
                relay_url: None,
                direct_addrs: vec!["192.168.1.9:4433".to_string()],
                kinds: vec![],
            },
            host,
        }
    }

    /// The one property the admission check rests on.
    #[test]
    fn resolves_usernames_only_for_attested_endpoints() {
        let alice = SecretKey::generate().public();
        let mallory = SecretKey::generate().public();
        let roster = Roster::new("room-1", None, &[member("alice", &alice, true)]);

        assert_eq!(roster.username_of(&alice), Some("alice"));
        assert_eq!(roster.username_of(&mallory), None);
        assert_eq!(roster.host().unwrap().username, "alice");
    }

    #[test]
    fn a_malformed_endpoint_costs_only_its_own_member() {
        let alice = SecretKey::generate().public();
        let mut bad = member("mallory", &alice, false);
        bad.endpoint.endpoint_id = "not-a-key".to_string();
        let roster = Roster::new("room-1", None, &[bad, member("alice", &alice, true)]);

        assert_eq!(roster.entries().len(), 1);
        assert_eq!(roster.username_of(&alice), Some("alice"));
    }
}
