//! The desktop's own iroh endpoint, native rather than in the webview.
//!
//! The web client's seat runs as `wasm32-unknown-unknown`, where iroh compiles
//! its IP transports out and every connection goes through a relay. A desktop
//! has no such limit, so it binds here instead and talks to the host directly.
//!
//! The case this is for is a seat that is not on the host's network. One that
//! is already reaches an embedded relay over mDNS in a single local hop, and
//! nothing beats a single local hop; a seat in another house otherwise takes
//! two WAN hops through `manabrew.app`.
//!
//! The webview drives it through commands and receives the host's envelopes as
//! events, so `directSeat.ts` reads the same either way and the game protocol
//! never learns which one it got.

use serde::Serialize;
use tauri::State;

#[cfg(feature = "direct-seat")]
use tauri::{AppHandle, Emitter};

/// Envelopes from the host arrive on this event, carrying exactly what the
/// relay would have put in `StateUpdate.state`.
#[cfg(feature = "direct-seat")]
const ENVELOPE_EVENT: &str = "direct-seat:envelope";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatBinding {
    /// The `TransportEndpoint` to announce, as the relay protocol shapes it.
    pub endpoint: serde_json::Value,
}

/// The seat proper, with no Tauri in it. macOS has no WebDriver for WKWebView,
/// so a desktop build cannot be driven headlessly; keeping the logic here means
/// it can still be tested against a real host, which is the part that matters.
#[cfg(feature = "direct-seat")]
pub struct DesktopSeat {
    endpoint: manabrew_net::NetEndpoint,
    username: String,
    sender: Option<manabrew_net::GameSender>,
    reader: Option<tauri::async_runtime::JoinHandle<()>>,
    /// The room the live connection was dialled for. A roster for another
    /// room, or one that no longer names a host, hangs it up.
    connected_room: Option<String>,
    seq: u64,
}

#[cfg(feature = "direct-seat")]
impl DesktopSeat {
    pub async fn bind(username: String, relay_url: Option<&str>) -> Result<Self, String> {
        let config = match relay_url.filter(|url| !url.is_empty()) {
            Some(url) => manabrew_net::NetConfig::with_relay(url).map_err(|e| e.to_string())?,
            None => manabrew_net::NetConfig::default(),
        };
        let (endpoint, _incoming) = manabrew_net::NetEndpoint::bind(config)
            .await
            .map_err(|e| e.to_string())?;
        endpoint
            .wait_online(std::time::Duration::from_secs(3))
            .await;
        Ok(Self {
            endpoint,
            username,
            sender: None,
            reader: None,
            connected_room: None,
            seq: 0,
        })
    }

    pub fn local(&self) -> manabrew_agent_interface::protocol::TransportEndpoint {
        self.endpoint.local()
    }

    /// Adds a relay the control plane named after this seat bound.
    pub async fn adopt_relay(&self, relay_url: &str) -> Result<(), String> {
        self.endpoint
            .adopt_relay(relay_url)
            .await
            .map_err(|e| e.to_string())
    }

    /// Installs the roster and dials the host it names, handing every envelope
    /// the host sends to `on_envelope`.
    pub async fn connect(
        &mut self,
        room_id: &str,
        members: &[manabrew_agent_interface::protocol::TransportMember],
        on_envelope: impl Fn(Option<serde_json::Value>) + Send + 'static,
    ) -> Result<Option<manabrew_net::TransportStatus>, String> {
        let roster = manabrew_net::Roster::new(room_id, None, members);
        // Our own entry proves the relay attested us to the host in the same
        // broadcast; dialling before that is refused, correctly.
        let attested = roster
            .username_of(&self.endpoint.id())
            .is_some_and(|name| name == self.username);
        let has_host = roster.host().is_some();
        self.endpoint.set_roster(roster);
        if let Some(sender) = &self.sender {
            if self.connected_room.as_deref() == Some(room_id) && has_host && attested {
                // The roster is re-broadcast on every join and leave. Still
                // connected is not a failed attempt; it is the same one.
                return Ok(Some(sender.status()));
            }
            // A different room, or the relay withdrew the plane because a
            // player at this table has not opted in. Either way the connection
            // from before does not carry over.
            self.hang_up();
        }
        if !has_host || !attested {
            return Ok(None);
        }

        // Bounded like the bot's, and for a sharper reason: the webview awaits
        // this command, so an unbounded dial hangs the join.
        let mut last = String::new();
        let mut channel = None;
        for attempt in 0..manabrew_net::DIAL_ATTEMPTS {
            match tokio::time::timeout(
                manabrew_net::DIAL_TIMEOUT,
                self.endpoint.connect_to_host(&self.username),
            )
            .await
            {
                Ok(Ok(open)) => {
                    channel = Some(open);
                    break;
                }
                Ok(Err(error)) => last = error.to_string(),
                Err(_) => last = "dial timed out".to_string(),
            }
            if attempt + 1 < manabrew_net::DIAL_ATTEMPTS {
                tokio::time::sleep(manabrew_net::DIAL_RETRY_DELAY).await;
            }
        }
        let Some(channel) = channel else {
            eprintln!("[direct] no direct path to the host: {last}");
            return Ok(None);
        };
        let status = channel.status();
        let (sender, mut receiver) = channel.split();
        self.sender = Some(sender);
        self.connected_room = Some(room_id.to_string());
        self.seq = 0;
        self.reader = Some(tauri::async_runtime::spawn(async move {
            while let Some(frame) = receiver.recv().await {
                if let manabrew_net::SessionFrame::Game { payload, .. } = frame {
                    on_envelope(Some(payload));
                }
            }
            // None says the channel is gone and this seat belongs back on the
            // relay, which the host has already assumed.
            on_envelope(None);
        }));
        Ok(Some(status))
    }

    /// Closes the live connection, if any. `close`, not drop: the reader holds
    /// the other half of the channel guard, so a dropped sender would leave
    /// the QUIC connection open and still delivering.
    fn hang_up(&mut self) {
        if let Some(sender) = self.sender.take() {
            sender.close();
        }
        if let Some(reader) = self.reader.take() {
            reader.abort();
        }
        self.connected_room = None;
    }

    pub fn send(&mut self, envelope: serde_json::Value) -> bool {
        let Some(sender) = self.sender.clone() else {
            return false;
        };
        self.seq += 1;
        let frame = manabrew_net::SessionFrame::Game {
            seq: self.seq,
            payload: envelope,
        };
        if sender.try_send(frame).is_ok() {
            return true;
        }
        self.sender = None;
        false
    }

    pub async fn shutdown(self) {
        if let Some(reader) = self.reader {
            reader.abort();
        }
        self.endpoint.shutdown().await;
    }
}

#[derive(Default)]
pub struct DirectSeatHost {
    #[cfg(feature = "direct-seat")]
    seat: tokio::sync::Mutex<Option<DesktopSeat>>,
}

impl DirectSeatHost {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Binds this machine's endpoint. `relay_url` is whatever the control plane
/// named, and `None` means direct only, which is what a LAN with no internet
/// looks like.
#[tauri::command]
pub async fn direct_seat_start(
    host: State<'_, DirectSeatHost>,
    username: String,
    relay_url: Option<String>,
) -> Result<SeatBinding, String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = (host, username, relay_url);
        Err("this desktop build has no direct seat".to_string())
    }
    #[cfg(feature = "direct-seat")]
    {
        let mut guard = host.seat.lock().await;
        if guard.is_none() {
            *guard = Some(DesktopSeat::bind(username, relay_url.as_deref()).await?);
        }
        let seat = guard.as_ref().expect("just bound");
        Ok(SeatBinding {
            endpoint: serde_json::to_value(seat.local()).map_err(|e| e.to_string())?,
        })
    }
}

/// Installs the roster the relay broadcast and dials the host it names. Returns
/// the transport that was established, or null when there is nothing to dial or
/// no path to it, in which case this seat stays on the relay.
#[tauri::command]
pub async fn direct_seat_roster(
    app: AppHandleArg,
    host: State<'_, DirectSeatHost>,
    room_id: String,
    members: serde_json::Value,
) -> Result<Option<serde_json::Value>, String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = (app, host, room_id, members);
        Ok(None)
    }
    #[cfg(feature = "direct-seat")]
    {
        let members: Vec<manabrew_agent_interface::protocol::TransportMember> =
            serde_json::from_value(members).map_err(|e| e.to_string())?;
        let mut guard = host.seat.lock().await;
        let Some(seat) = guard.as_mut() else {
            return Ok(None);
        };
        let app = app.clone();
        let status = seat
            .connect(&room_id, &members, move |envelope| {
                let _ = app.emit(ENVELOPE_EVENT, envelope.unwrap_or(serde_json::Value::Null));
            })
            .await?;
        match status {
            Some(status) => Ok(Some(
                serde_json::to_value(status).map_err(|e| e.to_string())?,
            )),
            None => Ok(None),
        }
    }
}

/// Sends one engine envelope. False means the caller must use the relay.
#[tauri::command]
pub async fn direct_seat_adopt_relay(
    host: State<'_, DirectSeatHost>,
    relay_url: String,
) -> Result<(), String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = (host, relay_url);
        Ok(())
    }
    #[cfg(feature = "direct-seat")]
    {
        let guard = host.seat.lock().await;
        match guard.as_ref() {
            Some(seat) => seat.adopt_relay(&relay_url).await,
            None => Ok(()),
        }
    }
}

#[tauri::command]
pub async fn direct_seat_send(
    host: State<'_, DirectSeatHost>,
    envelope: serde_json::Value,
) -> Result<bool, String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = (host, envelope);
        Ok(false)
    }
    #[cfg(feature = "direct-seat")]
    {
        let mut guard = host.seat.lock().await;
        Ok(guard.as_mut().is_some_and(|seat| seat.send(envelope)))
    }
}

#[tauri::command]
pub async fn direct_seat_stop(host: State<'_, DirectSeatHost>) -> Result<(), String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = host;
        Ok(())
    }
    #[cfg(feature = "direct-seat")]
    {
        if let Some(seat) = host.seat.lock().await.take() {
            seat.shutdown().await;
        }
        Ok(())
    }
}

#[cfg(feature = "direct-seat")]
type AppHandleArg = AppHandle;
#[cfg(not(feature = "direct-seat"))]
type AppHandleArg = tauri::AppHandle;

#[cfg(all(test, feature = "direct-seat"))]
mod tests {
    use super::*;
    use manabrew_agent_interface::protocol::{TransportEndpoint, TransportMember};
    use std::sync::{Arc, Mutex};

    const ROOM: &str = "desktop-seat-room";

    fn member(endpoint: &TransportEndpoint, username: &str, host: bool) -> TransportMember {
        TransportMember {
            username: username.to_string(),
            endpoint: endpoint.clone(),
            host,
        }
    }

    /// The webview awaits `direct_seat_roster`, so an unbounded dial hangs the
    /// join. A host that is attested but unreachable is the case that does it:
    /// there is a path to try and nothing at the end of it.
    #[tokio::test]
    async fn a_dial_that_will_never_land_gives_up_instead_of_hanging_the_join() {
        let mut seat = DesktopSeat::bind("bob".to_string(), None)
            .await
            .expect("bind seat");

        // A real endpoint id, so the roster accepts it, advertised at an
        // address that will not route: the dial neither connects nor fails
        // fast, which is the shape that used to hang.
        let (elsewhere, _) = manabrew_net::NetEndpoint::bind(manabrew_net::NetConfig::default())
            .await
            .expect("bind");
        let unreachable = TransportEndpoint {
            endpoint_id: elsewhere.local().endpoint_id,
            relay_url: None,
            direct_addrs: vec!["10.255.255.1:9".to_string()],
            kinds: vec![],
        };
        let members = vec![
            member(&unreachable, "hostess", true),
            member(&seat.local(), "bob", false),
        ];

        let started = std::time::Instant::now();
        let status = seat
            .connect(ROOM, &members, |_| {})
            .await
            .expect("a dial that cannot land is not an error");
        let waited = started.elapsed();

        assert!(status.is_none(), "nothing was reached, so no transport");
        let ceiling = manabrew_net::DIAL_TIMEOUT * manabrew_net::DIAL_ATTEMPTS as u32
            + manabrew_net::DIAL_RETRY_DELAY
            + std::time::Duration::from_secs(2);
        assert!(
            waited < ceiling,
            "the dial has to be bounded: waited {waited:?}, ceiling {ceiling:?}"
        );
    }

    /// A desktop seat against a real host, which is the path a LAN game runs on
    /// and the one no window can be driven to exercise on macOS.
    #[tokio::test]
    async fn a_desktop_seat_reaches_a_host_and_carries_envelopes_both_ways() {
        let (host, mut seats) = manabrew_net::NetEndpoint::bind(manabrew_net::NetConfig::default())
            .await
            .expect("bind host");
        let mut seat = DesktopSeat::bind("bob".to_string(), None)
            .await
            .expect("bind seat");

        let members = vec![
            member(&host.local(), "hostess", true),
            member(&seat.local(), "bob", false),
        ];
        let roster = manabrew_net::Roster::new(ROOM, None, &members);
        host.set_roster(roster);

        let received: Arc<Mutex<Vec<Option<serde_json::Value>>>> = Arc::default();
        let sink = received.clone();
        let status = seat
            .connect(ROOM, &members, move |envelope| {
                sink.lock().unwrap().push(envelope)
            })
            .await
            .expect("connect")
            .expect("a host to reach");
        assert_eq!(status.kind, manabrew_net::TransportKind::Direct);

        let mut accepted = tokio::time::timeout(std::time::Duration::from_secs(10), seats.recv())
            .await
            .expect("host accepted in time")
            .expect("seat");
        assert_eq!(accepted.username, "bob");

        assert!(seat.send(serde_json::json!({ "kind": "response", "promptId": 1 })));
        let inbound =
            tokio::time::timeout(std::time::Duration::from_secs(5), accepted.channel.recv())
                .await
                .expect("the host received the seat's answer in time")
                .expect("a frame");
        assert!(matches!(
            inbound,
            manabrew_net::SessionFrame::Game { seq: 1, .. }
        ));

        accepted
            .channel
            .send(manabrew_net::SessionFrame::Game {
                seq: 9,
                payload: serde_json::json!({ "kind": "state", "forPlayer": "player-1" }),
            })
            .await
            .unwrap();
        for _ in 0..100 {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            if !received.lock().unwrap().is_empty() {
                break;
            }
        }
        let delivered = received.lock().unwrap().clone();
        assert_eq!(
            delivered.len(),
            1,
            "the host's envelope reached the webview"
        );
        assert!(
            delivered[0].is_some(),
            "and it was an envelope, not a close"
        );

        seat.shutdown().await;
        host.shutdown().await;
    }
}
