//! Webview half of a desktop host's data plane, for seats reached over WebRTC.
//! See docs/TRANSPORT.md.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use manabrew_relay_protocol::{SeatTransportReport, TRANSPORT_WEBRTC};
use serde_json::Value;
use tokio::sync::mpsc;

/// Node to webview.
#[derive(Debug, Clone, PartialEq)]
pub enum ShellEvent {
    /// An engine envelope for a seat the webview serves.
    Envelope { target: String, envelope: Value },
    /// Signalling for this host, forwarded off the relay socket.
    Signal { from: String, payload: Value },
}

/// Webview to node.
#[derive(Debug, Clone, PartialEq)]
pub enum ShellCommand {
    /// Seats the webview has an open channel to. Replaces the whole set.
    Serving { seats: Vec<String> },
    /// Signalling to send under this host's relay identity.
    Signal { to: String, payload: Value },
    /// A seat's envelope, arrived over the webview's channel.
    SeatEnvelope { from: String, envelope: Value },
}

type Reprime = Box<dyn Fn(&str) + Send + Sync>;

/// Carries the seats the webview reaches that the game froze on this plane.
pub struct ShellBridge {
    serving: Mutex<HashSet<String>>,
    /// Frozen at `GameStarted`; a seat leaves and never comes back.
    frozen: Mutex<HashSet<String>>,
    /// Seats that left this plane mid-game and need a full board first.
    owed_a_board: Mutex<HashSet<String>>,
    /// Relay-attested roster; the freeze carries only seats named here.
    attested: Mutex<HashSet<String>>,
    emit: Arc<dyn Fn(ShellEvent) + Send + Sync>,
    on_fallback: Mutex<Option<Reprime>>,
}

impl ShellBridge {
    pub fn new(
        emit: impl Fn(ShellEvent) + Send + Sync + 'static,
    ) -> (
        Arc<Self>,
        mpsc::UnboundedSender<ShellCommand>,
        mpsc::UnboundedReceiver<ShellCommand>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        let bridge = Arc::new(Self {
            serving: Mutex::new(HashSet::new()),
            frozen: Mutex::new(HashSet::new()),
            owed_a_board: Mutex::new(HashSet::new()),
            attested: Mutex::new(HashSet::new()),
            emit: Arc::new(emit),
            on_fallback: Mutex::new(None),
        });
        (bridge, tx, rx)
    }

    pub fn set_roster(&self, seats: impl IntoIterator<Item = String>) {
        if let Ok(mut attested) = self.attested.lock() {
            *attested = seats.into_iter().collect();
        }
    }

    pub fn set_on_fallback(&self, reprime: impl Fn(&str) + Send + Sync + 'static) {
        if let Ok(mut slot) = self.on_fallback.lock() {
            *slot = Some(Box::new(reprime));
        }
    }

    /// Replaces the served set; a dropped frozen seat falls back owing a board.
    pub fn set_serving(&self, seats: Vec<String>) {
        let incoming: HashSet<String> = seats.into_iter().collect();
        let lost: Vec<String> = {
            let Ok(mut frozen) = self.frozen.lock() else {
                return;
            };
            let lost: Vec<String> = frozen.difference(&incoming).cloned().collect();
            for seat in &lost {
                frozen.remove(seat);
            }
            lost
        };
        if let Ok(mut serving) = self.serving.lock() {
            *serving = incoming;
        }
        for seat in lost {
            let newly_owed = self
                .owed_a_board
                .lock()
                .map(|mut set| set.insert(seat.clone()))
                .unwrap_or(false);
            if !newly_owed {
                continue;
            }
            if let Ok(slot) = self.on_fallback.lock() {
                if let Some(reprime) = slot.as_ref() {
                    reprime(&seat);
                }
            }
        }
    }

    /// Called on `GameStarted`; returns the seats this bridge carries.
    pub fn freeze_for_game(&self, seats: &[String], taken: &[String]) -> Vec<String> {
        let Ok(serving) = self.serving.lock() else {
            return Vec::new();
        };
        let Ok(attested) = self.attested.lock() else {
            return Vec::new();
        };
        let mine: HashSet<String> = seats
            .iter()
            .filter(|seat| {
                serving.contains(*seat) && attested.contains(*seat) && !taken.contains(*seat)
            })
            .cloned()
            .collect();
        let mut listed: Vec<String> = mine.iter().cloned().collect();
        listed.sort();
        if let Ok(mut frozen) = self.frozen.lock() {
            *frozen = mine;
        }
        if let Ok(mut owed) = self.owed_a_board.lock() {
            owed.clear();
        }
        listed
    }

    pub fn clear_game(&self) {
        if let Ok(mut frozen) = self.frozen.lock() {
            frozen.clear();
        }
        if let Ok(mut owed) = self.owed_a_board.lock() {
            owed.clear();
        }
    }

    /// A relay envelope from this seat settles its owed board.
    pub fn note_relay_message(&self, username: &str) {
        if let Ok(mut owed) = self.owed_a_board.lock() {
            owed.remove(username);
        }
    }

    /// Hands one envelope to the webview; false when the seat is not frozen here.
    pub fn try_send(&self, target: &str, envelope: &Value) -> bool {
        let claimed = self
            .frozen
            .lock()
            .map(|frozen| frozen.contains(target))
            .unwrap_or(false);
        if !claimed {
            return false;
        }
        if envelope.get("kind").and_then(Value::as_str) == Some("prompt") {
            tracing::info!(target, "shell bridge: handed a prompt to the webview");
        }
        (self.emit)(ShellEvent::Envelope {
            target: target.to_string(),
            envelope: envelope.clone(),
        });
        true
    }

    pub fn forward_signal(&self, from: &str, payload: Value) {
        (self.emit)(ShellEvent::Signal {
            from: from.to_string(),
            payload,
        });
    }

    pub fn transport_report(&self, seats: &[String]) -> Vec<SeatTransportReport> {
        seats
            .iter()
            .map(|username| SeatTransportReport {
                username: username.clone(),
                transport: TRANSPORT_WEBRTC.to_string(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::mpsc as std_mpsc;

    fn bridge() -> (Arc<ShellBridge>, std_mpsc::Receiver<ShellEvent>) {
        let (tx, rx) = std_mpsc::channel();
        let (bridge, _cmd_tx, _cmd_rx) = ShellBridge::new(move |event| {
            let _ = tx.send(event);
        });
        (bridge, rx)
    }

    #[test]
    fn nothing_leaves_this_plane_before_the_game_freezes_it() {
        let (bridge, events) = bridge();
        bridge.set_roster(["bob".to_string()]);
        bridge.set_serving(vec!["bob".into()]);
        assert!(!bridge.try_send("bob", &json!({"kind": "prompt"})));
        assert!(events.try_recv().is_err());

        bridge.freeze_for_game(&["bob".into()], &[]);
        assert!(bridge.try_send("bob", &json!({"kind": "prompt"})));
    }

    #[test]
    fn a_seat_the_direct_plane_took_is_not_claimed_twice() {
        let (bridge, _events) = bridge();
        bridge.set_roster(["bob".to_string(), "carol".to_string()]);
        bridge.set_serving(vec!["bob".into(), "carol".into()]);
        let mine = bridge.freeze_for_game(&["bob".into(), "carol".into()], &["bob".into()]);
        assert_eq!(mine, vec!["carol".to_string()]);
        assert!(!bridge.try_send("bob", &json!({})));
        assert!(bridge.try_send("carol", &json!({})));
    }

    #[test]
    fn a_seat_the_roster_does_not_name_stays_on_the_relay() {
        let (bridge, _events) = bridge();
        bridge.set_serving(vec!["bob".into()]);
        assert!(
            bridge.freeze_for_game(&["bob".into()], &[]).is_empty(),
            "no roster, no plane"
        );
        bridge.set_roster(["bob".to_string()]);
        assert_eq!(
            bridge.freeze_for_game(&["bob".into()], &[]),
            vec!["bob".to_string()]
        );
    }

    #[test]
    fn a_seat_that_loses_its_channel_falls_back_owing_a_board() {
        let (bridge, _events) = bridge();
        let repriced: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = repriced.clone();
        bridge.set_on_fallback(move |seat| seen.lock().unwrap().push(seat.to_string()));

        bridge.set_roster(["bob".to_string()]);
        bridge.set_serving(vec!["bob".into()]);
        bridge.freeze_for_game(&["bob".into()], &[]);
        assert!(bridge.try_send("bob", &json!({})));

        bridge.set_serving(vec![]);
        assert_eq!(repriced.lock().unwrap().as_slice(), ["bob"]);
        assert!(!bridge.try_send("bob", &json!({})));
    }

    #[test]
    fn the_debt_is_owed_once_and_settled_by_the_seat_answering_on_the_relay() {
        let (bridge, _events) = bridge();
        let count = Arc::new(Mutex::new(0usize));
        let seen = count.clone();
        bridge.set_on_fallback(move |_| *seen.lock().unwrap() += 1);

        bridge.set_roster(["bob".to_string()]);
        bridge.set_serving(vec!["bob".into()]);
        bridge.freeze_for_game(&["bob".into()], &[]);
        bridge.set_serving(vec![]);
        bridge.set_serving(vec![]);
        assert_eq!(*count.lock().unwrap(), 1);

        bridge.note_relay_message("bob");
        assert!(!bridge.try_send("bob", &json!({})));

        bridge.set_serving(vec!["bob".into()]);
        assert!(!bridge.try_send("bob", &json!({})));
    }

    #[test]
    fn a_seat_that_was_never_frozen_here_owes_nothing_when_it_stops_being_served() {
        let (bridge, _events) = bridge();
        let count = Arc::new(Mutex::new(0usize));
        let seen = count.clone();
        bridge.set_on_fallback(move |_| *seen.lock().unwrap() += 1);

        bridge.set_serving(vec!["bob".into()]);
        bridge.set_serving(vec![]);
        assert_eq!(*count.lock().unwrap(), 0);
    }

    #[test]
    fn the_capture_is_told_which_seats_it_stopped_seeing() {
        let (bridge, _events) = bridge();
        let report = bridge.transport_report(&["bob".into()]);
        assert_eq!(report.len(), 1);
        assert_eq!(report[0].username, "bob");
        assert_eq!(report[0].transport, TRANSPORT_WEBRTC);
    }

    #[test]
    fn signalling_for_this_host_reaches_the_webview_that_holds_the_connections() {
        let (bridge, events) = bridge();
        bridge.forward_signal("bob", json!({"sdp": {"type": "offer"}}));
        assert_eq!(
            events.try_recv().unwrap(),
            ShellEvent::Signal {
                from: "bob".into(),
                payload: json!({"sdp": {"type": "offer"}}),
            }
        );
    }
}
