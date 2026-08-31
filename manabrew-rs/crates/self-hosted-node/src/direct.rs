//! The direct data plane for a hosted room (phase 2 of `docs/TRANSPORT.md`).
//!
//! The relay stays the control plane and the fallback. What moves here is one
//! thing: the per-seat engine envelopes this node would otherwise push through
//! `BroadcastState` with a `target_player`. A seat that has proved itself over
//! iroh receives them on its own QUIC stream instead.
//!
//! One endpoint per room rather than per node, because the roster is per room
//! and `max_games` defaults to 1 on the fleet.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use manabrew_net::{
    GameReceiver, GameSender, NetConfig, NetEndpoint, Roster, SeatConnection, SessionFrame,
};
use manabrew_relay_protocol::{TransportEndpoint, TransportMember};
use serde_json::Value;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::config::Config;

#[derive(Default)]
struct TableState {
    /// Seats that dialled in and passed the roster check.
    live: HashMap<String, GameSender>,
    /// Seats whose envelopes this game is allowed to send direct. Frozen when
    /// the relay announces `GameStarted`, so a seat that connects mid-game does
    /// not migrate a stream that is already in flight.
    active: HashSet<String>,
    seq: u64,
}

/// Which seats are on the direct plane and which are still on the relay. This
/// is the whole transport-selection policy, kept apart from the endpoint so the
/// rules can be tested without a network.
#[derive(Clone, Default)]
pub struct SeatTable(Arc<Mutex<TableState>>);

pub struct DirectPlane {
    endpoint: NetEndpoint,
    seats: SeatTable,
    gossip_joined: AtomicBool,
    has_relay: bool,
}

impl DirectPlane {
    pub async fn start(config: &Config) -> Option<(Self, mpsc::Receiver<SeatConnection>)> {
        if !config.iroh_enabled {
            return None;
        }
        let net_config = match &config.iroh_relay_url {
            Some(url) => match NetConfig::with_relay(url) {
                Ok(config) => config,
                Err(error) => {
                    warn!(%error, url, "invalid iroh relay url; direct plane disabled");
                    return None;
                }
            },
            None => NetConfig::default(),
        };
        match NetEndpoint::bind(net_config).await {
            Ok((endpoint, seats)) => {
                info!(
                    endpoint_id = %endpoint.id(),
                    relay = config.iroh_relay_url.as_deref().unwrap_or("none, direct only"),
                    "direct plane listening"
                );
                Some((
                    Self {
                        endpoint,
                        seats: SeatTable::default(),
                        gossip_joined: AtomicBool::new(false),
                        has_relay: config.iroh_relay_url.is_some(),
                    },
                    seats,
                ))
            }
            Err(error) => {
                warn!(%error, "failed to bind the iroh endpoint; staying on the relay");
                None
            }
        }
    }

    /// What to announce to the relay. Waits briefly for a home relay so the
    /// announcement is useful to peers that cannot reach us directly; a timeout
    /// still leaves the direct addresses, which is all a LAN peer needs.
    pub async fn local_endpoint(&self) -> TransportEndpoint {
        // Without a relay configured there is no home relay to wait for, and
        // waiting would delay hosting the room by the whole timeout.
        if self.has_relay {
            self.endpoint
                .wait_online(std::time::Duration::from_secs(5))
                .await;
        }
        self.endpoint.local()
    }

    pub fn apply_roster(
        &self,
        room_id: &str,
        topic_secret: &str,
        host: Option<&TransportMember>,
        members: &[TransportMember],
    ) {
        match Roster::new(room_id, topic_secret, host, members) {
            Ok(roster) => {
                let peers = roster.entries().len();
                self.endpoint.set_roster(roster);
                debug!(room_id, peers, "roster installed");
            }
            Err(error) => warn!(%error, room_id, "relay sent an unusable transport roster"),
        }
    }

    /// The relay re-broadcasts the roster on every membership change, so this
    /// only subscribes once; later rosters reach the topic through
    /// [`Self::apply_roster`].
    pub async fn join_gossip(&self, username: &str) {
        if self.gossip_joined.swap(true, Ordering::SeqCst) {
            return;
        }
        match self.endpoint.join_room_gossip().await {
            Ok(gossip) => {
                if let Err(error) = gossip.announce(username, true).await {
                    warn!(%error, "failed to announce presence");
                }
                // Held by the task so the subscription outlives this call.
                tokio::spawn(async move {
                    let mut gossip = gossip;
                    while let Some(event) = gossip.next_event().await {
                        debug!(?event, "room gossip");
                    }
                });
            }
            Err(error) => {
                self.gossip_joined.store(false, Ordering::SeqCst);
                debug!(%error, "room gossip unavailable");
            }
        }
    }

    /// Takes an accepted seat and starts reading it. `route` receives the
    /// authenticated username and the raw envelope, which is exactly the pair
    /// the relay path hands to `route_remote_response`.
    pub fn register_seat<F>(&self, seat: SeatConnection, route: F)
    where
        F: Fn(&str, &Value) + Send + 'static,
    {
        self.seats.register(seat, route);
    }

    /// Called on `GameStarted`. Only seats already connected take part, so no
    /// stream changes transport while the game runs.
    pub fn freeze_for_game(&self, seats: &[String]) -> Vec<String> {
        self.seats.freeze_for_game(seats)
    }

    pub fn clear_game(&self) {
        self.seats.clear_game();
    }

    /// Delivers one engine envelope to a seat. `false` means the caller must
    /// send it over the relay, which is also what happens for every seat that
    /// never took the direct plane.
    pub fn try_send(&self, target: &str, envelope: &Value) -> bool {
        self.seats.try_send(target, envelope)
    }

    pub async fn shutdown(self) {
        self.endpoint.shutdown().await;
    }
}

impl SeatTable {
    pub fn register<F>(&self, seat: SeatConnection, route: F)
    where
        F: Fn(&str, &Value) + Send + 'static,
    {
        let SeatConnection {
            username, channel, ..
        } = seat;
        let status = channel.status();
        info!(
            username,
            transport = status.kind.as_str(),
            lan = status.lan,
            rtt_ms = status.rtt_ms,
            "seat took the direct plane"
        );
        crate::metrics::record_direct_seat(status.kind);

        let (sender, receiver) = channel.split();
        if let Ok(mut state) = self.0.lock() {
            state.live.insert(username.clone(), sender);
        }

        let table = self.clone();
        let seat_name = username.clone();
        tokio::spawn(async move {
            pump_inbound(receiver, &seat_name, route).await;
            table.drop_seat(&seat_name);
            info!(username = %seat_name, "direct seat closed; that seat is back on the relay");
            crate::metrics::record_direct_fallback();
        });
    }

    pub fn drop_seat(&self, username: &str) {
        if let Ok(mut state) = self.0.lock() {
            state.live.remove(username);
            state.active.remove(username);
        }
    }

    pub fn freeze_for_game(&self, seats: &[String]) -> Vec<String> {
        let Ok(mut state) = self.0.lock() else {
            return Vec::new();
        };
        state.active = seats
            .iter()
            .filter(|name| state.live.contains_key(*name))
            .cloned()
            .collect();
        state.seq = 0;
        let mut frozen: Vec<String> = state.active.iter().cloned().collect();
        frozen.sort();
        frozen
    }

    pub fn clear_game(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.active.clear();
        }
    }

    pub fn try_send(&self, target: &str, envelope: &Value) -> bool {
        let (sender, seq) = {
            let Ok(mut state) = self.0.lock() else {
                return false;
            };
            if !state.active.contains(target) {
                return false;
            }
            let Some(sender) = state.live.get(target).cloned() else {
                return false;
            };
            state.seq += 1;
            (sender, state.seq)
        };

        let frame = SessionFrame::Game {
            seq,
            payload: envelope.clone(),
        };
        match sender.try_send(frame) {
            Ok(()) => {
                crate::metrics::record_direct_frame("out");
                true
            }
            Err(error) => {
                warn!(target, %error, "direct seat channel unusable; falling back to the relay");
                self.drop_seat(target);
                crate::metrics::record_direct_fallback();
                false
            }
        }
    }
}

/// Reads a seat's inbound frames. The username is the one the relay attested
/// and `manabrew-net` matched against the connecting endpoint id, so it carries
/// exactly the authority `StateUpdate.from_player` carries on the relay path,
/// and the same routing and seat checks apply unchanged.
async fn pump_inbound(mut receiver: GameReceiver, username: &str, route: impl Fn(&str, &Value)) {
    while let Some(frame) = receiver.recv().await {
        match frame {
            SessionFrame::Game { payload, .. } => {
                crate::metrics::record_direct_frame("in");
                route(username, &payload);
            }
            SessionFrame::Bye { reason } => {
                info!(username, ?reason, "seat closed its direct channel");
                break;
            }
            other => debug!(username, ?other, "unexpected frame on a seat channel"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use manabrew_net::GameChannel;
    use serde_json::json;

    struct FakeSeat {
        table: SeatTable,
        outbound: mpsc::Receiver<SessionFrame>,
        inbound: mpsc::Sender<SessionFrame>,
        routed: Arc<Mutex<Vec<(String, Value)>>>,
    }

    fn seat(username: &str) -> FakeSeat {
        let table = SeatTable::default();
        let (out_tx, outbound) = mpsc::channel(16);
        let (inbound, in_rx) = mpsc::channel(16);
        let routed: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
        let sink = routed.clone();
        table.register(
            SeatConnection {
                username: username.to_string(),
                endpoint_id: iroh::SecretKey::generate().public(),
                channel: GameChannel::relay(out_tx, in_rx),
            },
            move |from, payload| {
                sink.lock()
                    .unwrap()
                    .push((from.to_string(), payload.clone()))
            },
        );
        FakeSeat {
            table,
            outbound,
            inbound,
            routed,
        }
    }

    fn envelope() -> Value {
        json!({ "kind": "state", "forPlayer": "player-1" })
    }

    #[tokio::test]
    async fn a_connected_seat_stays_on_the_relay_until_a_game_freezes_it() {
        let mut seat = seat("bob");

        assert!(
            !seat.table.try_send("bob", &envelope()),
            "an unfrozen seat must go through the relay"
        );

        assert_eq!(seat.table.freeze_for_game(&["bob".into()]), vec!["bob"]);
        assert!(seat.table.try_send("bob", &envelope()));
        assert!(matches!(
            seat.outbound.try_recv(),
            Ok(SessionFrame::Game { seq: 1, .. })
        ));
    }

    #[tokio::test]
    async fn a_seat_that_connects_after_the_freeze_does_not_migrate_mid_game() {
        let table = SeatTable::default();
        // The game starts with nobody on the direct plane.
        assert!(table.freeze_for_game(&["bob".into()]).is_empty());

        let (out_tx, mut outbound) = mpsc::channel(16);
        let (_in_tx, in_rx) = mpsc::channel(16);
        table.register(
            SeatConnection {
                username: "bob".into(),
                endpoint_id: iroh::SecretKey::generate().public(),
                channel: GameChannel::relay(out_tx, in_rx),
            },
            |_, _| {},
        );

        assert!(!table.try_send("bob", &envelope()));
        assert!(outbound.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_seat_never_told_to_us_by_the_relay_is_not_reachable() {
        let seat = seat("bob");
        seat.table.freeze_for_game(&["bob".into()]);
        assert!(!seat.table.try_send("mallory", &envelope()));
    }

    #[tokio::test]
    async fn a_dead_channel_falls_back_to_the_relay() {
        let mut seat = seat("bob");
        seat.table.freeze_for_game(&["bob".into()]);
        assert!(seat.table.try_send("bob", &envelope()));

        seat.outbound.close();
        while seat.outbound.try_recv().is_ok() {}

        assert!(
            !seat.table.try_send("bob", &envelope()),
            "a closed channel must fall back rather than drop the envelope"
        );
        assert!(
            !seat.table.try_send("bob", &envelope()),
            "and the seat stays on the relay afterwards"
        );
    }

    #[tokio::test]
    async fn ending_a_game_puts_every_seat_back_on_the_relay() {
        let seat = seat("bob");
        seat.table.freeze_for_game(&["bob".into()]);
        seat.table.clear_game();
        assert!(!seat.table.try_send("bob", &envelope()));
    }

    #[tokio::test]
    async fn inbound_frames_route_under_the_attested_username() {
        let seat = seat("bob");
        seat.inbound
            .send(SessionFrame::Game {
                seq: 1,
                payload: json!({ "kind": "response", "fromPlayer": "player-1" }),
            })
            .await
            .unwrap();

        for _ in 0..50 {
            tokio::task::yield_now().await;
            if !seat.routed.lock().unwrap().is_empty() {
                break;
            }
        }
        let routed = seat.routed.lock().unwrap();
        assert_eq!(routed.len(), 1);
        assert_eq!(routed[0].0, "bob", "the seat cannot name itself");
    }
}
