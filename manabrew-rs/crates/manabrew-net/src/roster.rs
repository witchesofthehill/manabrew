//! The relay-attested view of a room's data plane.
//!
//! Everything here comes from `ServerMessage::RoomTransport`, which the relay
//! sends only to room members and fills in from its own session records. A peer
//! learned any other way is not in the roster and is not believed.

use std::collections::HashMap;
use std::str::FromStr;

use iroh::{EndpointAddr, EndpointId, RelayUrl, TransportAddr};
use iroh_gossip::proto::TopicId;
use manabrew_relay_protocol::{TransportEndpoint, TransportMember};

use crate::{NetError, Result};

const TOPIC_DOMAIN: &str = "manabrew room topic v1";

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
    topic: TopicId,
    entries: Vec<RosterEntry>,
    by_endpoint: HashMap<EndpointId, usize>,
}

impl Roster {
    pub fn new(
        room_id: &str,
        topic_secret: &str,
        host: Option<&TransportMember>,
        members: &[TransportMember],
    ) -> Result<Self> {
        let secret = decode_topic_secret(topic_secret)?;
        let host_name = host.map(|m| m.username.as_str());

        let mut entries = Vec::with_capacity(members.len());
        for member in members {
            let addr = to_endpoint_addr(&member.endpoint)?;
            entries.push(RosterEntry {
                username: member.username.clone(),
                endpoint_id: addr.id,
                addr,
                host: member.host || Some(member.username.as_str()) == host_name,
            });
        }

        let by_endpoint = entries
            .iter()
            .enumerate()
            .map(|(idx, entry)| (entry.endpoint_id, idx))
            .collect();

        Ok(Self {
            room_id: room_id.to_string(),
            topic: derive_topic(room_id, &secret),
            entries,
            by_endpoint,
        })
    }

    pub fn room_id(&self) -> &str {
        &self.room_id
    }

    pub fn topic(&self) -> TopicId {
        self.topic
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

    pub fn entry_of(&self, username: &str) -> Option<&RosterEntry> {
        self.entries.iter().find(|entry| entry.username == username)
    }

    /// Gossip bootstrap peers: everyone else the relay has told us about. The
    /// topic is derived from a room secret, so this list is only a starting
    /// point, not an admission decision.
    pub fn bootstrap(&self, exclude: &EndpointId) -> Vec<EndpointId> {
        self.entries
            .iter()
            .map(|entry| entry.endpoint_id)
            .filter(|id| id != exclude)
            .collect()
    }
}

/// Not derived from the room id alone: a room id is visible in the lobby, so it
/// would make every topic enumerable. The 32-byte secret goes only to members.
fn derive_topic(room_id: &str, secret: &[u8; 32]) -> TopicId {
    let mut hasher = blake3::Hasher::new_derive_key(TOPIC_DOMAIN);
    hasher.update(room_id.as_bytes());
    hasher.update(secret);
    TopicId::from_bytes(*hasher.finalize().as_bytes())
}

fn decode_topic_secret(hex: &str) -> Result<[u8; 32]> {
    if hex.len() != 64 {
        return Err(NetError::BadTopicSecret);
    }
    let mut out = [0u8; 32];
    for (idx, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[idx * 2..idx * 2 + 2], 16)
            .map_err(|_| NetError::BadTopicSecret)?;
    }
    Ok(out)
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
            },
            host,
        }
    }

    fn secret_hex(fill: u8) -> String {
        (0..32).map(|_| format!("{fill:02x}")).collect()
    }

    #[test]
    fn resolves_usernames_only_for_attested_endpoints() {
        let alice = SecretKey::generate().public();
        let mallory = SecretKey::generate().public();
        let roster = Roster::new(
            "room-1",
            &secret_hex(0xab),
            None,
            &[member("alice", &alice, true)],
        )
        .unwrap();

        assert_eq!(roster.username_of(&alice), Some("alice"));
        assert_eq!(roster.username_of(&mallory), None);
        assert_eq!(roster.host().unwrap().username, "alice");
    }

    #[test]
    fn topic_depends_on_the_room_secret() {
        let alice = SecretKey::generate().public();
        let members = [member("alice", &alice, true)];
        let a = Roster::new("room-1", &secret_hex(0x01), None, &members).unwrap();
        let b = Roster::new("room-1", &secret_hex(0x02), None, &members).unwrap();
        let c = Roster::new("room-2", &secret_hex(0x01), None, &members).unwrap();
        assert_ne!(a.topic(), b.topic());
        assert_ne!(a.topic(), c.topic());
    }

    #[test]
    fn rejects_a_malformed_topic_secret() {
        let alice = SecretKey::generate().public();
        assert!(matches!(
            Roster::new("room-1", "not-hex", None, &[member("alice", &alice, true)]),
            Err(NetError::BadTopicSecret)
        ));
    }

    #[test]
    fn endpoint_conversion_round_trips() {
        let id = SecretKey::generate().public();
        let addr = EndpointAddr::new(id).with_ip_addr("10.0.0.4:9999".parse().unwrap());
        let wire = to_transport_endpoint(&addr);
        assert_eq!(to_endpoint_addr(&wire).unwrap(), addr);
    }
}
