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

#[cfg(feature = "direct-seat")]
struct Seat {
    endpoint: manabrew_net::NetEndpoint,
    username: String,
    sender: Option<manabrew_net::GameSender>,
    reader: Option<tauri::async_runtime::JoinHandle<()>>,
    seq: u64,
}

#[derive(Default)]
pub struct DirectSeatHost {
    #[cfg(feature = "direct-seat")]
    seat: tokio::sync::Mutex<Option<Seat>>,
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
        if let Some(seat) = guard.as_ref() {
            return Ok(SeatBinding {
                endpoint: serde_json::to_value(seat.endpoint.local()).map_err(|e| e.to_string())?,
            });
        }

        let config = match relay_url.as_deref().filter(|url| !url.is_empty()) {
            Some(url) => manabrew_net::NetConfig::with_relay(url).map_err(|e| e.to_string())?,
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
        let binding = SeatBinding {
            endpoint: serde_json::to_value(endpoint.local()).map_err(|e| e.to_string())?,
        };
        *guard = Some(Seat {
            endpoint,
            username,
            sender: None,
            reader: None,
            seq: 0,
        });
        Ok(binding)
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

        let roster = manabrew_net::Roster::new(&room_id, &topic_secret, None, &members)
            .map_err(|e| e.to_string())?;
        // Our own entry proves the relay attested us to the host in the same
        // broadcast; dialling before that is refused, correctly.
        let attested = roster
            .username_of(&seat.endpoint.id())
            .is_some_and(|name| name == seat.username);
        let has_host = roster.host().is_some();
        seat.endpoint.set_roster(roster);
        if seat.sender.is_some() || !has_host || !attested {
            return Ok(None);
        }

        let channel = match seat.endpoint.connect_to_host(&seat.username).await {
            Ok(channel) => channel,
            Err(error) => {
                eprintln!("[direct] no direct path to the host: {error}");
                return Ok(None);
            }
        };
        let status = serde_json::to_value(channel.status()).map_err(|e| e.to_string())?;
        let (sender, mut receiver) = channel.split();
        seat.sender = Some(sender);
        seat.seq = 0;
        let app = app.clone();
        seat.reader = Some(tauri::async_runtime::spawn(async move {
            while let Some(frame) = receiver.recv().await {
                if let manabrew_net::SessionFrame::Game { payload, .. } = frame {
                    let _ = app.emit(ENVELOPE_EVENT, payload);
                }
            }
            // Null says the channel is gone and this seat belongs back on the
            // relay, which the host has already assumed.
            let _ = app.emit(ENVELOPE_EVENT, serde_json::Value::Null);
        }));
        Ok(Some(status))
    }
}

/// Sends one engine envelope. False means the caller must use the relay.
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
        let Some(seat) = guard.as_mut() else {
            return Ok(false);
        };
        let Some(sender) = seat.sender.clone() else {
            return Ok(false);
        };
        seat.seq += 1;
        let frame = manabrew_net::SessionFrame::Game {
            seq: seat.seq,
            payload: envelope,
        };
        if sender.try_send(frame).is_ok() {
            return Ok(true);
        }
        seat.sender = None;
        Ok(false)
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
            if let Some(reader) = seat.reader {
                reader.abort();
            }
            seat.endpoint.shutdown().await;
        }
        Ok(())
    }
}

#[cfg(feature = "direct-seat")]
type AppHandleArg = AppHandle;
#[cfg(not(feature = "direct-seat"))]
type AppHandleArg = tauri::AppHandle;
