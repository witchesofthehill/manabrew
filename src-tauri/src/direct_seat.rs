//! The desktop's own iroh endpoint, native rather than in the webview.
//!
//! The web client's seat runs as `wasm32-unknown-unknown`, where iroh compiles
//! its IP transports out and every connection goes through a relay. A desktop
//! has no such limit, so it binds here instead and talks to the host directly.
//! On a LAN that is the whole point: four machines reach each other across a
//! switch with nothing in between.
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
    seq: u64,
}

#[cfg(feature = "direct-seat")]
impl DesktopSeat {
    pub async fn bind(
        username: String,
        relay_url: Option<&str>,
        relay_token: Option<&str>,
    ) -> Result<Self, String> {
        let config = match relay_url.filter(|url| !url.is_empty()) {
            Some(url) => {
                manabrew_net::NetConfig::with_relay(url, relay_token).map_err(|e| e.to_string())?
            }
            None => manabrew_net::NetConfig::default(),
        };
        let (endpoint, _incoming) = manabrew_net::NetEndpoint::bind(config)
            .await
            .map_err(|e| e.to_string())?;
        if relay_url.is_some() {
            endpoint
                .wait_online(std::time::Duration::from_secs(5))
                .await;
        }
        Ok(Self {
            endpoint,
            username,
            sender: None,
            reader: None,
            seq: 0,
        })
    }

    pub fn local(&self) -> manabrew_agent_interface::protocol::TransportEndpoint {
        self.endpoint.local()
    }

    /// Replaces the relay config, which is how the room token is renewed. This
    /// seat outlives the token it bound with, and a relay reconnect past the
    /// TTL is refused.
    pub async fn adopt_relay(
        &self,
        relay_url: &str,
        relay_token: Option<&str>,
    ) -> Result<(), String> {
        self.endpoint
            .adopt_relay(relay_url, relay_token)
            .await
            .map_err(|e| e.to_string())
    }

    /// Installs the roster and dials the host it names, handing every envelope
    /// the host sends to `on_envelope`.
    pub async fn connect(
        &mut self,
        room_id: &str,
        topic_secret: &str,
        members: &[manabrew_agent_interface::protocol::TransportMember],
        on_envelope: impl Fn(Option<serde_json::Value>) + Send + 'static,
    ) -> Result<Option<manabrew_net::TransportStatus>, String> {
        let roster = manabrew_net::Roster::new(room_id, topic_secret, None, members)
            .map_err(|e| e.to_string())?;
        // Our own entry proves the relay attested us to the host in the same
        // broadcast; dialling before that is refused, correctly.
        let attested = roster
            .username_of(&self.endpoint.id())
            .is_some_and(|name| name == self.username);
        let has_host = roster.host().is_some();
        self.endpoint.set_roster(roster);
        if self.sender.is_some() || !has_host || !attested {
            return Ok(None);
        }

        let channel = match self.endpoint.connect_to_host(&self.username).await {
            Ok(channel) => channel,
            Err(error) => {
                eprintln!("[direct] no direct path to the host: {error}");
                return Ok(None);
            }
        };
        let status = channel.status();
        let (sender, mut receiver) = channel.split();
        self.sender = Some(sender);
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
    relay_token: Option<String>,
) -> Result<SeatBinding, String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = (host, username, relay_url, relay_token);
        Err("this desktop build has no direct seat".to_string())
    }
    #[cfg(feature = "direct-seat")]
    {
        let mut guard = host.seat.lock().await;
        if guard.is_none() {
            *guard = Some(
                DesktopSeat::bind(username, relay_url.as_deref(), relay_token.as_deref()).await?,
            );
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
    topic_secret: String,
    members: serde_json::Value,
) -> Result<Option<serde_json::Value>, String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = (app, host, room_id, topic_secret, members);
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
            .connect(&room_id, &topic_secret, &members, move |envelope| {
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
    relay_token: Option<String>,
) -> Result<(), String> {
    #[cfg(not(feature = "direct-seat"))]
    {
        let _ = (host, relay_url, relay_token);
        Ok(())
    }
    #[cfg(feature = "direct-seat")]
    {
        let guard = host.seat.lock().await;
        match guard.as_ref() {
            Some(seat) => seat.adopt_relay(&relay_url, relay_token.as_deref()).await,
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

    const TOPIC_SECRET: &str = "4444444444444444444444444444444444444444444444444444444444444444";
    const ROOM: &str = "desktop-seat-room";

    fn member(endpoint: &TransportEndpoint, username: &str, host: bool) -> TransportMember {
        TransportMember {
            username: username.to_string(),
            endpoint: endpoint.clone(),
            host,
        }
    }

    /// A desktop seat against a real host, which is the path a LAN game runs on
    /// and the one no window can be driven to exercise on macOS.
    #[tokio::test]
    async fn a_desktop_seat_reaches_a_host_and_carries_envelopes_both_ways() {
        let (host, mut seats) = manabrew_net::NetEndpoint::bind(manabrew_net::NetConfig::default())
            .await
            .expect("bind host");
        let mut seat = DesktopSeat::bind("bob".to_string(), None, None)
            .await
            .expect("bind seat");

        let members = vec![
            member(&host.local(), "hostess", true),
            member(&seat.local(), "bob", false),
        ];
        let roster = manabrew_net::Roster::new(ROOM, TOPIC_SECRET, None, &members).unwrap();
        host.set_roster(roster);

        let received: Arc<Mutex<Vec<Option<serde_json::Value>>>> = Arc::default();
        let sink = received.clone();
        let status = seat
            .connect(ROOM, TOPIC_SECRET, &members, move |envelope| {
                sink.lock().unwrap().push(envelope)
            })
            .await
            .expect("connect")
            .expect("a host to reach");
        assert_eq!(status.kind, manabrew_net::TransportKind::IrohDirect);

        let mut accepted = tokio::time::timeout(std::time::Duration::from_secs(10), seats.recv())
            .await
            .expect("host accepted in time")
            .expect("seat");
        assert_eq!(accepted.username, "bob");

        assert!(seat.send(serde_json::json!({ "kind": "response", "promptId": 1 })));
        let inbound = accepted
            .channel
            .recv_timeout(std::time::Duration::from_secs(5))
            .await
            .expect("the host received the seat's answer");
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
