//! The webview's half of a desktop host's data plane, for the seat a native
//! endpoint cannot reach.
//!
//! A desktop-hosted room runs its engine here, in Rust, on its own relay
//! session. A browser seat in that room cannot be dialled from it: a browser is
//! reachable over WebRTC and nothing else, and the only thing in this process
//! that can make a WebRTC connection is the webview sitting beside it. So the
//! envelopes go out through the shell rather than through a second Rust
//! transport stack, which is what #838 settled on.
//!
//! Two thirds of mixed rooms are desktop-hosted, so this is the larger half of
//! that case.
//!
//! The seam is [`crate::direct::DirectPlane::try_send`] returning false: this
//! is a second sink beside it, tried after it and before the relay. A seat is
//! on one of the three, never two.
//!
//! The relay socket stays here, in the node. Signalling addressed to this host
//! arrives on it and is forwarded out to the webview; what the webview answers
//! comes back and goes out under this host's attested identity. The webview
//! never gets a relay session of its own to speak for the host with.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use manabrew_relay_protocol::{SeatTransportReport, TRANSPORT_WEBRTC};
use serde_json::Value;
use tokio::sync::mpsc;

/// Node to webview.
#[derive(Debug, Clone, PartialEq)]
pub enum ShellEvent {
    /// An engine envelope for a seat the webview said it is serving.
    Envelope { target: String, envelope: Value },
    /// Signalling for this host, forwarded off the relay socket.
    Signal { from: String, payload: Value },
}

/// Webview to node.
#[derive(Debug, Clone, PartialEq)]
pub enum ShellCommand {
    /// The seats the webview has an open channel to, right now. Replaces the
    /// whole set: the webview is the only thing that knows, so a seat missing
    /// from this list is a seat that has gone.
    Serving { seats: Vec<String> },
    /// Signalling the webview wants sent under this host's relay identity.
    Signal { to: String, payload: Value },
    /// A seat's own envelope, arrived over the webview's channel. Takes the
    /// same route into the engine that a relay `StateUpdate` takes.
    SeatEnvelope { from: String, envelope: Value },
}

/// Puts a seat's board back where the relay can serve it, once that seat has
/// left this plane. Same repair the direct plane makes, for the same reason.
type Reprime = Box<dyn Fn(&str) + Send + Sync>;

/// A seat is claimed by this bridge only while the webview says it can reach
/// it AND the game froze it here.
pub struct ShellBridge {
    /// What the webview currently reaches.
    serving: Mutex<HashSet<String>>,
    /// The seats this plane is carrying, frozen at `GameStarted`. The only
    /// thing `try_send` reads, and empty outside a game, which is why nothing
    /// leaves this way before one starts. A seat is removed when its channel
    /// goes and is never put back: transport is chosen once per game and does
    /// not migrate, in either direction.
    frozen: Mutex<HashSet<String>>,
    /// Seats that left this plane mid-game and are owed a full board before
    /// anything else goes out, because while they were here the relay saw none
    /// of their envelopes. Settled when the seat answers over the relay.
    owed_a_board: Mutex<HashSet<String>>,
    /// The seats the relay's latest roster names. The relay sends an empty
    /// roster while anyone at the table has not opted in, and a channel the
    /// webview opened before that player sat down is still open; the freeze
    /// believes the roster, not the channel.
    attested: Mutex<HashSet<String>>,
    emit: Arc<dyn Fn(ShellEvent) + Send + Sync>,
    on_fallback: Mutex<Option<Reprime>>,
}

impl ShellBridge {
    /// `emit` hands an event to the shell, which puts it in front of the
    /// webview. The returned sender is what the shell feeds commands back on.
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

    /// The relay's latest roster, by username. Replaces the whole set.
    pub fn set_roster(&self, seats: impl IntoIterator<Item = String>) {
        if let Ok(mut attested) = self.attested.lock() {
            *attested = seats.into_iter().collect();
        }
    }

    /// Paid the same way the direct plane pays it: a seat that leaves this
    /// plane mid-game needs its board put back into the relay's replay cache
    /// before it reads that path again.
    pub fn set_on_fallback(&self, reprime: impl Fn(&str) + Send + Sync + 'static) {
        if let Ok(mut slot) = self.on_fallback.lock() {
            *slot = Some(Box::new(reprime));
        }
    }

    /// Replaces the served set. A seat this plane was carrying that drops out
    /// of it has lost its channel: it leaves the plane for good and goes back
    /// on the relay owing a board.
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

    /// Called on `GameStarted`, after the direct plane has taken its seats.
    /// `taken` names those, so a seat cannot be claimed by both planes. Only
    /// seats the current roster attests are carried, so an incomplete opt-in
    /// (an empty roster) freezes nobody onto this plane.
    /// Returns the seats this bridge is carrying for the game.
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

    /// An envelope from this seat over the relay says it is reading that path,
    /// so the debt is settled. Same signal the direct plane uses.
    pub fn note_relay_message(&self, username: &str) {
        if let Ok(mut owed) = self.owed_a_board.lock() {
            owed.remove(username);
        }
    }

    /// Hands one engine envelope to the webview for a seat, or says it did not.
    ///
    /// Unlike the direct plane this cannot know the send landed: the answer
    /// would have to come back across the shell, and the caller is the room's
    /// message loop. What makes that safe is the fallback debt above. A seat
    /// whose channel dies in the window between the webview's last `Serving`
    /// and this call loses envelopes, and is then owed a full board before it
    /// reads the relay again, which is the same repair the direct plane makes
    /// for the same reason.
    pub fn try_send(&self, target: &str, envelope: &Value) -> bool {
        let claimed = self
            .frozen
            .lock()
            .map(|frozen| frozen.contains(target))
            .unwrap_or(false);
        if !claimed {
            return false;
        }
        (self.emit)(ShellEvent::Envelope {
            target: target.to_string(),
            envelope: envelope.clone(),
        });
        true
    }

    /// Signalling addressed to this host, on its way to the webview that holds
    /// the peer connections.
    pub fn forward_signal(&self, from: &str, payload: Value) {
        (self.emit)(ShellEvent::Signal {
            from: from.to_string(),
            payload,
        });
    }

    /// What the relay's capture is about to stop seeing.
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
        // Serving is not the same as carrying. Until GameStarted the relay has
        // the seat, the same rule the direct plane follows.
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
        // bob is already on iroh. A desktop seat and a browser seat in the same
        // room is exactly the mixed case, and each gets one plane.
        let mine = bridge.freeze_for_game(&["bob".into(), "carol".into()], &["bob".into()]);
        assert_eq!(mine, vec!["carol".to_string()]);
        assert!(!bridge.try_send("bob", &json!({})));
        assert!(bridge.try_send("carol", &json!({})));
    }

    /// An open channel is not consent. The relay empties the roster while any
    /// player at the table has not opted in, and the freeze follows the roster.
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

        // The webview reports the channel gone.
        bridge.set_serving(vec![]);
        assert_eq!(repriced.lock().unwrap().as_slice(), ["bob"]);
        // And the envelope goes on the relay from here on.
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

        // Settling the debt must not put the seat back on this plane. Transport
        // is chosen once per game and does not migrate, in either direction.
        bridge.note_relay_message("bob");
        assert!(!bridge.try_send("bob", &json!({})));

        // Nor does the webview reporting it reachable again.
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
