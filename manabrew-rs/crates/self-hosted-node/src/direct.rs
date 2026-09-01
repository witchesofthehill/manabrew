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
use manabrew_relay_protocol::{SeatTransportReport, TransportEndpoint, TransportMember};
use serde_json::Value;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::config::Config;

/// Where a seat's envelopes go, and how it gets back.
///
/// The middle state is the point. A seat whose direct channel died has a board
/// the relay never saw, so it cannot simply resume relay traffic: the host owes
/// it a full authoritative state first. `RelayPending` is that debt, and it is
/// paid before anything else for that seat goes out, because `outbound_tx` is
/// ordered. The seat acknowledges by answering over the relay, which is the
/// first thing it does that proves it is reading that path again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeatTransport {
    Direct,
    RelayPending,
    Relay,
}

#[derive(Default)]
struct TableState {
    /// Seats that dialled in and passed the roster check, with the generation
    /// of the connection that put them there.
    live: HashMap<String, (u64, GameSender)>,
    /// Seats whose envelopes this game is allowed to send direct. Frozen when
    /// the relay announces `GameStarted`, so a seat that connects mid-game does
    /// not migrate a stream that is already in flight.
    active: HashSet<String>,
    /// Only holds seats that have been on the direct plane this game. A seat
    /// that never left the relay has no state to track.
    transport: HashMap<String, SeatTransport>,
    seq: u64,
}

/// Which seats are on the direct plane and which are still on the relay. This
/// is the whole transport-selection policy, kept apart from the endpoint so the
/// rules can be tested without a network.
type FallbackHook = Box<dyn Fn(&str) + Send + 'static>;

#[derive(Clone, Default)]
pub struct SeatTable {
    state: Arc<Mutex<TableState>>,
    /// Called with a seat's username the moment it leaves the direct plane. The
    /// relay's replay cache stopped seeing that seat when it went direct, so
    /// something has to put the current board back before a resync asks for it.
    on_fallback: Arc<Mutex<Option<FallbackHook>>>,
}

pub struct DirectPlane {
    endpoint: NetEndpoint,
    seats: SeatTable,
    gossip_joined: AtomicBool,
    has_relay: AtomicBool,
    /// `SELF_HOSTED_NODE_IROH_RELAY_URL`, used only when the control plane
    /// names no relay of its own. It carries no token, so a gated relay will
    /// refuse it; it is here for a relay too old to send one.
    fallback_relay: Option<String>,
}

impl DirectPlane {
    pub async fn start(config: &Config) -> Option<(Self, mpsc::Receiver<SeatConnection>)> {
        if !config.iroh_enabled {
            return None;
        }
        // Bound with no relay even when one is configured, because our relay
        // admits nobody without a room token and a token only exists once the
        // control plane has a room to mint it for. `RoomTransport` carries
        // both, so the relay is adopted there; the configured url is the
        // fallback for a relay too old to name one.
        match NetEndpoint::bind(NetConfig::default()).await {
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
                        has_relay: AtomicBool::new(false),
                        fallback_relay: config.iroh_relay_url.clone(),
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
        if self.has_relay.load(Ordering::SeqCst) {
            self.endpoint
                .wait_online(std::time::Duration::from_secs(5))
                .await;
        }
        self.endpoint.local()
    }

    /// Takes the relay the control plane named, and the token that goes with
    /// it. Runs on **every** `RoomTransport`, not just the first: a token
    /// expires and `insert_relay` replacing the config is what renews it. A
    /// room outliving the TTL would otherwise have its next relay reconnect
    /// refused, and the seat would fall back saying nothing.
    ///
    /// Returns true only the first time, which is when the endpoint gains an
    /// address it did not have and therefore has to announce again.
    pub async fn adopt_relay(&self, url: Option<&str>, token: Option<&str>) -> bool {
        let Some(url) = url.or(self.fallback_relay.as_deref()) else {
            return false;
        };
        if let Err(error) = self.endpoint.adopt_relay(url, token).await {
            warn!(%error, url, "control plane named an unusable relay");
            return false;
        }
        let first = !self.has_relay.swap(true, Ordering::SeqCst);
        if first {
            info!(url, "adopted the relay the control plane named");
        }
        first
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

    pub fn set_on_fallback(&self, reprime: impl Fn(&str) + Send + 'static) {
        self.seats.set_on_fallback(reprime);
    }

    pub fn note_relay_message(&self, username: &str) {
        self.seats.note_relay_message(username);
    }

    pub fn transport_report(&self, seats: &[String]) -> Vec<SeatTransportReport> {
        self.seats.transport_report(seats)
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
            username,
            generation,
            channel,
            ..
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
        if let Ok(mut state) = self.state.lock() {
            // Closed, not dropped. The superseded connection's reader task
            // holds the other half of its guard, so forgetting the sender
            // leaves that QUIC connection open and still feeding the engine
            // responses under this seat's name.
            if let Some((_, superseded)) = state.live.insert(username.clone(), (generation, sender))
            {
                superseded.close();
            }
        }

        let table = self.clone();
        let seat_name = username.clone();
        tokio::spawn(async move {
            pump_inbound(receiver, &seat_name, route).await;
            // Only if this is still the live connection: a seat that re-dialled
            // while this one was dying must not be knocked back to the relay by
            // its predecessor noticing.
            table.drop_seat_generation(&seat_name, generation);
            info!(username = %seat_name, "direct seat closed; that seat is back on the relay");
            crate::metrics::record_direct_fallback();
        });
    }

    pub fn drop_seat(&self, username: &str) {
        self.drop_seat_generation(username, u64::MAX);
    }

    /// `u64::MAX` drops whatever is live; a real generation drops it only if it
    /// is still the one that connected.
    pub fn drop_seat_generation(&self, username: &str, generation: u64) {
        let was_direct = match self.state.lock() {
            Ok(mut state) => {
                let superseded = state
                    .live
                    .get(username)
                    .is_some_and(|(live, _)| generation != u64::MAX && *live != generation);
                if superseded {
                    return;
                }
                state.live.remove(username);
                let was_direct = state.active.remove(username);
                if was_direct {
                    state
                        .transport
                        .insert(username.to_string(), SeatTransport::RelayPending);
                }
                was_direct
            }
            Err(_) => false,
        };
        if !was_direct {
            return;
        }
        // Queued before this seat's next envelope, because the queue is ordered
        // and this runs before `try_send` returns false to its caller.
        if let Ok(guard) = self.on_fallback.lock() {
            if let Some(reprime) = guard.as_ref() {
                reprime(username);
            }
        }
    }

    /// A seat answered over the relay, which is the acknowledgement: it is
    /// reading that path again, so the state it was owed arrived.
    pub fn note_relay_message(&self, username: &str) {
        if let Ok(mut state) = self.state.lock() {
            if state.transport.get(username) == Some(&SeatTransport::RelayPending) {
                state
                    .transport
                    .insert(username.to_string(), SeatTransport::Relay);
                info!(username, "seat is back on the relay");
            }
        }
    }

    pub fn transport_of(&self, username: &str) -> Option<SeatTransport> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.transport.get(username).copied())
    }

    pub fn set_on_fallback(&self, reprime: impl Fn(&str) + Send + 'static) {
        if let Ok(mut guard) = self.on_fallback.lock() {
            *guard = Some(Box::new(reprime));
        }
    }

    pub fn freeze_for_game(&self, seats: &[String]) -> Vec<String> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        state.active = seats
            .iter()
            .filter(|name| state.live.contains_key(*name))
            .cloned()
            .collect();
        state.transport = state
            .active
            .iter()
            .map(|name| (name.clone(), SeatTransport::Direct))
            .collect();
        state.seq = 0;
        let mut frozen: Vec<String> = state.active.iter().cloned().collect();
        frozen.sort();
        frozen
    }

    pub fn clear_game(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.active.clear();
            state.transport.clear();
        }
    }

    pub fn transport_report(&self, seats: &[String]) -> Vec<SeatTransportReport> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        seats
            .iter()
            .filter_map(|username| {
                state
                    .live
                    .get(username)
                    .map(|(_, sender)| SeatTransportReport {
                        username: username.clone(),
                        transport: sender.status().kind.as_str().to_string(),
                    })
            })
            .collect()
    }

    pub fn try_send(&self, target: &str, envelope: &Value) -> bool {
        let (sender, seq) = {
            let Ok(mut state) = self.state.lock() else {
                return false;
            };
            if !state.active.contains(target) {
                return false;
            }
            let Some((_, sender)) = state.live.get(target).cloned() else {
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
    use tokio::sync::watch;

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
                generation: 0,
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

    /// A channel whose inbound half is fed by a task the guard owns, which is
    /// what a real iroh connection looks like. `GameChannel::relay` carries no
    /// guard, so it cannot show a connection being closed.
    fn guarded_seat(
        table: &SeatTable,
        username: &str,
        generation: u64,
        routed: Arc<Mutex<Vec<(String, Value)>>>,
    ) -> mpsc::Sender<SessionFrame> {
        let (out_tx, _outbound) = mpsc::channel(16);
        let (feed, mut source) = mpsc::channel::<SessionFrame>(16);
        let (inbound, in_rx) = mpsc::channel(16);
        let pump = n0_future::task::spawn(async move {
            while let Some(frame) = source.recv().await {
                if inbound.send(frame).await.is_err() {
                    break;
                }
            }
        });
        let channel = GameChannel::new(out_tx, in_rx, watch::channel(status()).1)
            .with_guard(manabrew_net::channel::ChannelGuard::new(vec![pump]));
        table.register(
            SeatConnection {
                username: username.to_string(),
                endpoint_id: iroh::SecretKey::generate().public(),
                generation,
                channel,
            },
            move |from, payload| {
                routed
                    .lock()
                    .unwrap()
                    .push((from.to_string(), payload.clone()))
            },
        );
        feed
    }

    fn status() -> manabrew_net::TransportStatus {
        manabrew_net::TransportStatus::relay()
    }

    /// A seat that re-dials leaves its predecessor's reader running. Until that
    /// connection is closed rather than forgotten, whoever holds it can keep
    /// feeding the engine responses under the seat's name.
    #[tokio::test]
    async fn a_superseded_connection_stops_being_able_to_speak_for_its_seat() {
        let table = SeatTable::default();
        let routed: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();

        let stale = guarded_seat(&table, "bob", 1, routed.clone());
        stale
            .send(SessionFrame::Game {
                seq: 1,
                payload: json!({ "kind": "response", "answer": "first" }),
            })
            .await
            .unwrap();
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(routed.lock().unwrap().len(), 1, "the live seat is routed");

        let _fresh = guarded_seat(&table, "bob", 2, routed.clone());

        let sent = stale
            .send(SessionFrame::Game {
                seq: 2,
                payload: json!({ "kind": "response", "answer": "injected" }),
            })
            .await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let seen = routed.lock().unwrap();
        assert!(
            sent.is_err() || seen.len() == 1,
            "the superseded connection must not reach the engine: {seen:?}"
        );
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
                generation: 0,
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
    async fn the_report_names_only_seats_that_actually_went_direct() {
        let seat = seat("bob");
        seat.table.freeze_for_game(&["bob".into()]);

        let report = seat.table.transport_report(&["bob".into(), "carol".into()]);

        assert_eq!(
            report.len(),
            1,
            "carol never connected, so she is not in it"
        );
        assert_eq!(report[0].username, "bob");
        assert_eq!(report[0].transport, "relay", "a relay-backed test channel");
    }

    #[tokio::test]
    async fn a_seat_walks_direct_to_relay_pending_to_relay() {
        let mut seat = seat("bob");
        let owed: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = owed.clone();
        seat.table
            .set_on_fallback(move |username| sink.lock().unwrap().push(username.to_string()));

        seat.table.freeze_for_game(&["bob".into()]);
        assert_eq!(seat.table.transport_of("bob"), Some(SeatTransport::Direct));

        seat.outbound.close();
        while seat.outbound.try_recv().is_ok() {}
        assert!(!seat.table.try_send("bob", &envelope()));

        assert_eq!(
            seat.table.transport_of("bob"),
            Some(SeatTransport::RelayPending),
            "the host owes this seat a full state before it resumes"
        );
        assert_eq!(owed.lock().unwrap().as_slice(), ["bob"]);

        seat.table.note_relay_message("bob");
        assert_eq!(
            seat.table.transport_of("bob"),
            Some(SeatTransport::Relay),
            "answering over the relay is the acknowledgement"
        );
    }

    #[tokio::test]
    async fn a_seat_that_never_went_direct_has_no_transport_state() {
        let table = SeatTable::default();
        table.note_relay_message("carol");
        assert_eq!(table.transport_of("carol"), None);
    }

    #[tokio::test]
    async fn falling_back_asks_for_the_relay_cache_to_be_re_primed() {
        let mut seat = seat("bob");
        let fell_back: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = fell_back.clone();
        seat.table
            .set_on_fallback(move |username| sink.lock().unwrap().push(username.to_string()));

        seat.table.freeze_for_game(&["bob".into()]);
        assert!(seat.table.try_send("bob", &envelope()));

        seat.outbound.close();
        while seat.outbound.try_recv().is_ok() {}
        assert!(!seat.table.try_send("bob", &envelope()));

        assert_eq!(
            fell_back.lock().unwrap().as_slice(),
            ["bob"],
            "the relay stopped seeing this seat, so its cache has to be rebuilt"
        );
    }

    #[tokio::test]
    async fn a_seat_that_was_never_direct_does_not_ask_for_a_re_prime() {
        let table = SeatTable::default();
        let fell_back: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = fell_back.clone();
        table.set_on_fallback(move |username| sink.lock().unwrap().push(username.to_string()));

        table.drop_seat("carol");

        assert!(fell_back.lock().unwrap().is_empty());
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
