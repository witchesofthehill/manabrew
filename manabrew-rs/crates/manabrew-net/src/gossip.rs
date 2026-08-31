//! Room-local coordination over iroh-gossip.
//!
//! Gossip carries presence and endpoint announcements, never game state. Two
//! reasons, both hard. A topic is a broadcast tree with no per-recipient
//! addressing, and per-seat `state` and `prompt` envelopes contain hidden
//! information. And gossip gives no ordering or delivery guarantee, which a
//! prompt/response protocol needs.
//!
//! Authorship has to be signed. `iroh_gossip::api::Message::delivered_from` is
//! the forwarding neighbour, not the author, so a relayed announcement carries
//! no proof of who wrote it. Every announcement is therefore signed with the
//! announcer's iroh secret key, verified against the endpoint id it claims, and
//! then checked against the relay-attested roster.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use iroh::{EndpointId, SecretKey, Signature};
use iroh_gossip::api::{Event, GossipSender};
use iroh_gossip::net::Gossip;
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::debug;

use crate::channel::ChannelGuard;
use crate::endpoint::iroh_err;
use crate::roster::Roster;
use crate::Result;

/// A peer that has not re-announced within this window is treated as gone.
pub const PRESENCE_TTL: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub room_id: String,
    pub username: String,
    pub endpoint_id: String,
    pub host: bool,
    /// Monotonic per announcer. A lower value for a known endpoint is a replay.
    pub seq: u64,
    pub sent_at_ms: u64,
}

/// The body is signed as the exact bytes that travel, so verification never
/// depends on re-serialising to the same JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedPresence {
    body: String,
    sig: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RoomGossipEvent {
    PeerUp(EndpointId),
    PeerDown(EndpointId),
    Presence(Presence),
    /// An announcement failed a check. Kept as an event rather than a silent
    /// drop so the reason reaches logs and metrics.
    Rejected {
        from: EndpointId,
        reason: String,
    },
}

#[derive(Debug)]
pub struct RoomGossip {
    sender: GossipSender,
    secret: SecretKey,
    roster: Arc<RwLock<Roster>>,
    seq: Arc<RwLock<u64>>,
    peers: Arc<RwLock<HashMap<EndpointId, Presence>>>,
    events: mpsc::Receiver<RoomGossipEvent>,
    _guard: ChannelGuard,
}

impl RoomGossip {
    pub async fn join(gossip: &Gossip, secret: SecretKey, roster: Roster) -> Result<Self> {
        let me = secret.public();
        let bootstrap = roster.bootstrap(&me);
        let topic = gossip
            .subscribe(roster.topic(), bootstrap)
            .await
            .map_err(iroh_err)?;
        let (sender, mut receiver) = topic.split();

        let roster = Arc::new(RwLock::new(roster));
        let peers: Arc<RwLock<HashMap<EndpointId, Presence>>> = Arc::default();
        let (tx, events) = mpsc::channel(64);

        let task_roster = roster.clone();
        let task_peers = peers.clone();
        let task = tokio::spawn(async move {
            while let Some(Ok(event)) = receiver.next().await {
                let out = match event {
                    Event::NeighborUp(id) => Some(RoomGossipEvent::PeerUp(id)),
                    Event::NeighborDown(id) => {
                        task_peers.write().expect("peers lock").remove(&id);
                        Some(RoomGossipEvent::PeerDown(id))
                    }
                    Event::Received(message) => Some(handle_message(
                        &message.content,
                        message.delivered_from,
                        &task_roster,
                        &task_peers,
                    )),
                    Event::Lagged => None,
                };
                if let Some(out) = out {
                    if tx.send(out).await.is_err() {
                        break;
                    }
                }
            }
        });

        Ok(Self {
            sender,
            secret,
            roster,
            seq: Arc::new(RwLock::new(0)),
            peers,
            events,
            _guard: ChannelGuard::new(vec![task]),
        })
    }

    /// Publishes this peer's presence. Called on join, on endpoint change, and
    /// on a timer so that stale entries expire on the other peers.
    pub async fn announce(&self, username: &str, host: bool) -> Result<()> {
        let seq = {
            let mut seq = self.seq.write().expect("seq lock");
            *seq += 1;
            *seq
        };
        let presence = Presence {
            room_id: self
                .roster
                .read()
                .expect("roster lock")
                .room_id()
                .to_string(),
            username: username.to_string(),
            endpoint_id: self.secret.public().to_string(),
            host,
            seq,
            sent_at_ms: now_ms(),
        };
        let body = serde_json::to_string(&presence)?;
        let sig = self.secret.sign(body.as_bytes());
        let signed = SignedPresence {
            body,
            sig: hex(&sig.to_bytes()),
        };
        self.sender
            .broadcast(serde_json::to_vec(&signed)?.into())
            .await
            .map_err(iroh_err)?;
        Ok(())
    }

    pub async fn next_event(&mut self) -> Option<RoomGossipEvent> {
        self.events.recv().await
    }

    /// Replaces the roster after the relay sends a new one. Existing presence
    /// entries for peers that are no longer attested are dropped immediately.
    pub fn update_roster(&self, roster: Roster) {
        let mut peers = self.peers.write().expect("peers lock");
        peers.retain(|id, _| roster.username_of(id).is_some());
        *self.roster.write().expect("roster lock") = roster;
    }

    pub fn peers(&self) -> Vec<Presence> {
        self.sweep();
        self.peers
            .read()
            .expect("peers lock")
            .values()
            .cloned()
            .collect()
    }

    pub fn peer_count(&self) -> usize {
        self.peers().len()
    }

    fn sweep(&self) {
        let cutoff = now_ms().saturating_sub(PRESENCE_TTL.as_millis() as u64);
        self.peers
            .write()
            .expect("peers lock")
            .retain(|_, presence| presence.sent_at_ms >= cutoff);
    }
}

fn handle_message(
    content: &[u8],
    delivered_from: EndpointId,
    roster: &Arc<RwLock<Roster>>,
    peers: &Arc<RwLock<HashMap<EndpointId, Presence>>>,
) -> RoomGossipEvent {
    let reject = |reason: &str| RoomGossipEvent::Rejected {
        from: delivered_from,
        reason: reason.to_string(),
    };

    let Ok(signed) = serde_json::from_slice::<SignedPresence>(content) else {
        return reject("unparseable announcement");
    };
    let Ok(presence) = serde_json::from_str::<Presence>(&signed.body) else {
        return reject("unparseable presence body");
    };
    let Ok(author) = EndpointId::from_str(&presence.endpoint_id) else {
        return reject("bad endpoint id");
    };
    let Some(sig) = decode_signature(&signed.sig) else {
        return reject("bad signature encoding");
    };
    if author.verify(signed.body.as_bytes(), &sig).is_err() {
        return reject("signature does not match the announced endpoint");
    }

    {
        let roster = roster.read().expect("roster lock");
        if roster.room_id() != presence.room_id {
            return reject("announcement is for another room");
        }
        match roster.username_of(&author) {
            Some(attested) if attested == presence.username => {}
            Some(_) => return reject("endpoint is attested for a different player"),
            None => return reject("endpoint is not attested for this room"),
        }
    }

    let mut peers = peers.write().expect("peers lock");
    if let Some(known) = peers.get(&author) {
        if presence.seq <= known.seq {
            return reject("stale sequence");
        }
    }
    debug!(%author, seq = presence.seq, "accepted room presence");
    peers.insert(author, presence.clone());
    RoomGossipEvent::Presence(presence)
}

fn decode_signature(hex: &str) -> Option<Signature> {
    if hex.len() != 128 {
        return None;
    }
    let mut bytes = [0u8; 64];
    for (idx, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(idx * 2..idx * 2 + 2)?, 16).ok()?;
    }
    Some(Signature::from_bytes(&bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use manabrew_relay_protocol::{TransportEndpoint, TransportMember};

    const TOPIC_SECRET: &str = "2020202020202020202020202020202020202020202020202020202020202020";

    fn roster_of(members: &[(&str, &EndpointId)]) -> Roster {
        let members: Vec<TransportMember> = members
            .iter()
            .enumerate()
            .map(|(idx, (username, id))| TransportMember {
                username: username.to_string(),
                endpoint: TransportEndpoint {
                    endpoint_id: id.to_string(),
                    relay_url: None,
                    direct_addrs: vec![],
                },
                host: idx == 0,
            })
            .collect();
        Roster::new("room-1", TOPIC_SECRET, None, &members).unwrap()
    }

    fn announcement(secret: &SecretKey, presence: &Presence) -> Vec<u8> {
        let body = serde_json::to_string(presence).unwrap();
        let sig = secret.sign(body.as_bytes());
        serde_json::to_vec(&SignedPresence {
            body,
            sig: hex(&sig.to_bytes()),
        })
        .unwrap()
    }

    fn presence_of(secret: &SecretKey, username: &str, room: &str, seq: u64) -> Presence {
        Presence {
            room_id: room.to_string(),
            username: username.to_string(),
            endpoint_id: secret.public().to_string(),
            host: false,
            seq,
            sent_at_ms: now_ms(),
        }
    }

    type TestState = (
        Arc<RwLock<Roster>>,
        Arc<RwLock<HashMap<EndpointId, Presence>>>,
    );

    fn state(members: &[(&str, &EndpointId)]) -> TestState {
        (Arc::new(RwLock::new(roster_of(members))), Arc::default())
    }

    #[test]
    fn accepts_a_signed_announcement_from_an_attested_peer() {
        let host = SecretKey::generate();
        let bob = SecretKey::generate();
        let (roster, peers) = state(&[("hostess", &host.public()), ("bob", &bob.public())]);

        let presence = presence_of(&bob, "bob", "room-1", 1);
        let event = handle_message(
            &announcement(&bob, &presence),
            host.public(),
            &roster,
            &peers,
        );

        assert_eq!(event, RoomGossipEvent::Presence(presence));
        assert_eq!(peers.read().unwrap().len(), 1);
    }

    #[test]
    fn rejects_an_endpoint_the_relay_never_attested() {
        let host = SecretKey::generate();
        let mallory = SecretKey::generate();
        let (roster, peers) = state(&[("hostess", &host.public())]);

        let presence = presence_of(&mallory, "mallory", "room-1", 1);
        let event = handle_message(
            &announcement(&mallory, &presence),
            host.public(),
            &roster,
            &peers,
        );

        assert!(matches!(event, RoomGossipEvent::Rejected { .. }));
        assert!(peers.read().unwrap().is_empty());
    }

    #[test]
    fn rejects_a_peer_impersonating_another_player() {
        let host = SecretKey::generate();
        let bob = SecretKey::generate();
        let (roster, peers) = state(&[("hostess", &host.public()), ("bob", &bob.public())]);

        // Bob signs correctly with his own key but claims to be the host. The
        // roster says his endpoint is bob's, so the name is not his to use.
        let presence = presence_of(&bob, "hostess", "room-1", 1);
        let event = handle_message(
            &announcement(&bob, &presence),
            host.public(),
            &roster,
            &peers,
        );

        assert!(matches!(event, RoomGossipEvent::Rejected { .. }));
    }

    #[test]
    fn rejects_a_forged_signature() {
        let host = SecretKey::generate();
        let bob = SecretKey::generate();
        let mallory = SecretKey::generate();
        let (roster, peers) = state(&[("hostess", &host.public()), ("bob", &bob.public())]);

        // Mallory claims bob's endpoint id but can only sign with her own key.
        let presence = presence_of(&bob, "bob", "room-1", 1);
        let event = handle_message(
            &announcement(&mallory, &presence),
            host.public(),
            &roster,
            &peers,
        );

        assert!(matches!(event, RoomGossipEvent::Rejected { .. }));
    }

    #[test]
    fn rejects_a_replayed_sequence() {
        let host = SecretKey::generate();
        let bob = SecretKey::generate();
        let (roster, peers) = state(&[("hostess", &host.public()), ("bob", &bob.public())]);

        let fresh = presence_of(&bob, "bob", "room-1", 4);
        handle_message(&announcement(&bob, &fresh), host.public(), &roster, &peers);

        let replay = presence_of(&bob, "bob", "room-1", 3);
        let event = handle_message(&announcement(&bob, &replay), host.public(), &roster, &peers);

        assert!(matches!(event, RoomGossipEvent::Rejected { .. }));
        assert_eq!(peers.read().unwrap()[&bob.public()].seq, 4);
    }

    #[test]
    fn rejects_an_announcement_for_another_room() {
        let host = SecretKey::generate();
        let bob = SecretKey::generate();
        let (roster, peers) = state(&[("hostess", &host.public()), ("bob", &bob.public())]);

        let presence = presence_of(&bob, "bob", "room-2", 1);
        let event = handle_message(
            &announcement(&bob, &presence),
            host.public(),
            &roster,
            &peers,
        );

        assert!(matches!(event, RoomGossipEvent::Rejected { .. }));
    }
}
