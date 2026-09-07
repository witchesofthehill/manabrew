//! The direct data plane for a hosted room. The relay stays the control plane
//! and the fallback; what moves here is the per-seat engine envelopes, from
//! `BroadcastState` onto a seat's own QUIC stream. One endpoint per room. See
//! docs/TRANSPORT.md.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use manabrew_net::{
    GameReceiver, GameSender, NetConfig, NetEndpoint, Roster, SeatConnection, SessionFrame,
};
use manabrew_relay_protocol::{SeatTransportReport, TransportEndpoint, TransportMember};
use serde_json::Value;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::config::Config;

/// Where a seat's envelopes go. `RelayPending` is the debt owed to a seat that
/// fell back: the relay never saw its board, so a full state goes out before
/// anything else, cleared when the seat answers over the relay.
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
    /// The relay currently installed. Re-inserting an unchanged one schedules a
    /// full net report on every join and leave, so it is guarded.
    installed: Mutex<Option<String>>,
}

impl DirectPlane {
    pub async fn start(config: &Config) -> Option<(Self, mpsc::Receiver<SeatConnection>)> {
        if !config.iroh_enabled {
            return None;
        }
        // A configured relay wins; otherwise iroh's own defaults, which is what
        // lets a seat that cannot reach this host directly reach it at all. The
        // control plane can still name one later, in `RoomTransport`.
        let config_relay = config.iroh_relay_url.as_deref();
        let net = match config_relay.map(NetConfig::with_relay).transpose() {
            Ok(net) => net.unwrap_or_default(),
            Err(error) => {
                warn!(%error, "configured iroh relay url is unusable; taking the defaults");
                NetConfig::default()
            }
        };
        match NetEndpoint::bind(net).await {
            Ok((endpoint, seats)) => {
                info!(
                    endpoint_id = %endpoint.id(),
                    relay = config.iroh_relay_url.as_deref().unwrap_or("iroh defaults"),
                    "direct plane listening"
                );
                Some((
                    Self {
                        endpoint,
                        seats: SeatTable::default(),
                        installed: Mutex::new(config_relay.map(str::to_string)),
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
    /// announcement is useful to a peer that cannot reach us directly. A
    /// timeout still leaves the direct addresses, which is all a peer on the
    /// same network needs, and is what an offline room hits every time.
    pub async fn local_endpoint(&self) -> TransportEndpoint {
        self.endpoint
            .wait_online(std::time::Duration::from_secs(3))
            .await;
        self.endpoint.local()
    }

    /// Takes the relay the control plane named. True when the endpoint gained
    /// an address it did not have, which is what has to be announced again.
    pub async fn adopt_relay(&self, url: Option<&str>) -> bool {
        let Some(url) = url else {
            return false;
        };
        if self
            .installed
            .lock()
            .is_ok_and(|held| held.as_deref() == Some(url))
        {
            return false;
        }
        if let Err(error) = self.endpoint.adopt_relay(url).await {
            warn!(%error, url, "control plane named an unusable relay");
            return false;
        }
        if let Ok(mut held) = self.installed.lock() {
            *held = Some(url.to_string());
        }
        info!(url, "adopted the relay the control plane named");
        true
    }

    pub fn apply_roster(
        &self,
        room_id: &str,
        host: Option<&TransportMember>,
        members: &[TransportMember],
    ) {
        let roster = Roster::new(room_id, host, members);
        debug!(room_id, peers = roster.entries().len(), "roster installed");
        self.endpoint.set_roster(roster);
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
    ///
    /// Only seats the current roster names: the relay empties the roster while
    /// anyone at the table has not opted in, and the roster, not a live
    /// connection, is the word on who agreed.
    pub fn freeze_for_game(&self, seats: &[String]) -> Vec<String> {
        let roster = self.endpoint.roster();
        let named: Vec<String> = roster
            .as_ref()
            .map(|roster| {
                roster
                    .entries()
                    .iter()
                    .map(|e| e.username.clone())
                    .collect()
            })
            .unwrap_or_default();
        self.seats.freeze_for_game(&attested_seats(seats, &named))
    }

    /// The seats the relay currently attests, in `seats` order. Empty when the
    /// roster is, which is what an incomplete opt-in looks like from here.
    pub fn attested(&self, seats: &[String]) -> Vec<String> {
        let roster = self.endpoint.roster();
        let named: Vec<String> = roster
            .as_ref()
            .map(|roster| {
                roster
                    .entries()
                    .iter()
                    .map(|e| e.username.clone())
                    .collect()
            })
            .unwrap_or_default();
        attested_seats(seats, &named)
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

/// `seats` restricted to the names in `roster`, order kept. Kept apart from the
/// endpoint so the rule can be tested without a network.
pub fn attested_seats(seats: &[String], roster: &[String]) -> Vec<String> {
    seats
        .iter()
        .filter(|seat| roster.contains(*seat))
        .cloned()
        .collect()
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
            // Closed, not dropped: the superseded reader holds the other half
            // of the guard and would keep feeding the engine under this name.
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
        let kind = envelope.get("kind").and_then(Value::as_str).unwrap_or("?");
        match sender.try_send(frame) {
            Ok(()) => {
                crate::metrics::record_direct_frame("out");
                // Prompts are the envelope a seat waits on, so name them: this
                // is the "did the host send the mulligan over iroh" line.
                if kind == "prompt" {
                    info!(target, seq, "direct plane: sent a prompt to the seat");
                } else {
                    debug!(target, seq, kind, "direct frame out");
                }
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

/// Reads a seat's inbound frames. The username is relay-attested and matched
/// against the endpoint id, so it carries the same authority as
/// `StateUpdate.from_player` on the relay path.
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
    use manabrew_net::channel::ChannelGuard;
    use manabrew_net::{GameChannel, TransportKind, TransportStatus};
    use serde_json::json;
    use tokio::sync::watch;

    fn status() -> TransportStatus {
        TransportStatus {
            kind: TransportKind::Direct,
            lan: true,
            rtt_ms: None,
            setup_ms: None,
            reconnects: 0,
        }
    }

    fn envelope() -> Value {
        json!({ "kind": "state", "forPlayer": "player-1" })
    }

    /// Registers a seat whose inbound half is fed by a task the guard owns,
    /// which is what a real iroh connection looks like: closing the sender has
    /// to stop the reader too.
    fn register(
        table: &SeatTable,
        username: &str,
        generation: u64,
        routed: Arc<Mutex<Vec<(String, Value)>>>,
    ) -> (mpsc::Sender<SessionFrame>, mpsc::Receiver<SessionFrame>) {
        let (out_tx, outbound) = mpsc::channel(16);
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
            .with_guard(ChannelGuard::new(vec![pump]));
        table.register(
            SeatConnection {
                username: username.to_string(),
                endpoint_id: manabrew_net::SecretKey::generate().public(),
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
        (feed, outbound)
    }

    /// A seat that re-dials leaves its predecessor's reader running. Until that
    /// connection is closed rather than forgotten, whoever holds it can keep
    /// feeding the engine responses under the seat's name.
    #[tokio::test]
    async fn a_superseded_connection_stops_being_able_to_speak_for_its_seat() {
        let table = SeatTable::default();
        let routed: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();

        let (stale, _out) = register(&table, "bob", 1, routed.clone());
        stale
            .send(SessionFrame::Game {
                seq: 1,
                payload: json!({ "kind": "response", "answer": "first" }),
            })
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(routed.lock().unwrap().len(), 1, "the live seat is routed");

        let _fresh = register(&table, "bob", 2, routed.clone());
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

    /// Transport is chosen at `GameStarted` and never changes mid-game, in
    /// either direction.
    #[tokio::test]
    async fn only_seats_connected_at_the_freeze_go_direct() {
        let table = SeatTable::default();
        let routed: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
        let (_feed, mut outbound) = register(&table, "bob", 0, routed.clone());

        assert!(
            !table.try_send("bob", &envelope()),
            "an unfrozen seat goes through the relay"
        );
        assert_eq!(table.freeze_for_game(&["bob".into()]), vec!["bob"]);
        assert!(table.try_send("bob", &envelope()));
        assert!(matches!(
            outbound.try_recv(),
            Ok(SessionFrame::Game { seq: 1, .. })
        ));
        assert!(
            !table.try_send("mallory", &envelope()),
            "a seat the relay never named is not reachable"
        );

        table.clear_game();
        assert!(!table.try_send("bob", &envelope()), "the game ended");

        // A seat that connects after the freeze does not migrate a stream that
        // is already in flight.
        let late = SeatTable::default();
        assert!(late.freeze_for_game(&["bob".into()]).is_empty());
        let (_late_feed, mut late_out) = register(&late, "bob", 0, routed);
        assert!(!late.try_send("bob", &envelope()));
        assert!(late_out.try_recv().is_err());
    }

    /// The relay saw none of this seat's envelopes while it was direct, so a
    /// fallback owes it a full state before anything else goes out.
    #[tokio::test]
    async fn a_seat_walks_direct_to_relay_pending_to_relay() {
        let table = SeatTable::default();
        let routed: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
        let (_feed, mut outbound) = register(&table, "bob", 0, routed);
        let owed: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = owed.clone();
        table.set_on_fallback(move |username| sink.lock().unwrap().push(username.to_string()));

        table.freeze_for_game(&["bob".into()]);
        assert_eq!(table.transport_of("bob"), Some(SeatTransport::Direct));

        outbound.close();
        while outbound.try_recv().is_ok() {}
        assert!(!table.try_send("bob", &envelope()));

        assert_eq!(table.transport_of("bob"), Some(SeatTransport::RelayPending));
        assert_eq!(owed.lock().unwrap().as_slice(), ["bob"]);

        table.note_relay_message("bob");
        assert_eq!(
            table.transport_of("bob"),
            Some(SeatTransport::Relay),
            "answering over the relay is the acknowledgement"
        );
    }

    /// The relay withholds the roster while anyone at the table has not opted
    /// in. A seat that dialled before then is connected but not attested, and
    /// the freeze has to believe the roster, not the connection.
    #[test]
    fn a_connected_seat_the_roster_no_longer_names_is_not_frozen_direct() {
        let seats = ["alice".to_string(), "bob".to_string(), "bot".to_string()];
        assert_eq!(
            attested_seats(&seats, &["bob".to_string(), "alice".to_string()]),
            ["alice", "bob"]
        );
        assert!(
            attested_seats(&seats, &[]).is_empty(),
            "an empty roster freezes nobody"
        );
    }

    #[tokio::test]
    async fn a_seat_that_was_never_direct_owes_nothing() {
        let table = SeatTable::default();
        let fell_back: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = fell_back.clone();
        table.set_on_fallback(move |username| sink.lock().unwrap().push(username.to_string()));

        table.drop_seat("carol");
        table.note_relay_message("carol");

        assert!(fell_back.lock().unwrap().is_empty());
        assert_eq!(table.transport_of("carol"), None);
    }

    /// The relay re-broadcasts the roster on every join and leave, and
    /// `insert_relay` schedules a full net report, so an unchanged relay must
    /// not be re-inserted.
    #[tokio::test]
    async fn an_unchanged_relay_is_not_re_adopted() {
        let plane = DirectPlane {
            endpoint: manabrew_net::NetEndpoint::bind(manabrew_net::NetConfig {
                relay_mode: Some(manabrew_net::RelayMode::Disabled),
                ..Default::default()
            })
            .await
            .expect("bind")
            .0,
            seats: SeatTable::default(),
            installed: Mutex::new(None),
        };
        let url = "http://127.0.0.1:1";

        assert!(plane.adopt_relay(Some(url)).await, "first adoption");
        assert!(!plane.adopt_relay(Some(url)).await, "nothing to do");
        plane.endpoint.shutdown().await;
    }
}
