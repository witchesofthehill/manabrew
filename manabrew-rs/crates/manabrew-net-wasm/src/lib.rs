//! The browser's side of the direct data plane.
//!
//! Deliberately a separate module from the main wasm bundle. iroh costs about
//! 1.3MB gzipped, and a player who never joins a room that offers a direct
//! transport should never download it, so the client imports this lazily when
//! `RoomTransport` arrives with a relay url.
//!
//! A browser endpoint is relay-only: iroh compiles its IP transports out under
//! `wasm_browser`, so every connection here goes through the relay manabrew
//! hosts. That is still off `manabrew-server`'s game socket, and it is the only
//! connectivity a browser can have.

use manabrew_net::{GameReceiver, GameSender, NetConfig, NetEndpoint, Roster, SessionFrame};
use manabrew_relay_protocol::TransportMember;
use wasm_bindgen::prelude::*;

/// One seat's direct channel to the room's engine host.
#[wasm_bindgen]
pub struct WasmSeat {
    endpoint: NetEndpoint,
    username: String,
    sender: Option<GameSender>,
    receiver: Option<GameReceiver>,
    seq: u64,
}

fn err(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen]
impl WasmSeat {
    /// Binds an endpoint against the relay the control plane named, or with no
    /// relay at all. There is never a default: an absent relay means direct
    /// only, which is what a LAN game with no internet looks like, and a
    /// browser there simply finds no path and stays on the manabrew relay.
    #[wasm_bindgen(js_name = bindSeat)]
    pub async fn bind(
        username: String,
        relay_url: Option<String>,
        relay_token: Option<String>,
    ) -> Result<WasmSeat, JsValue> {
        let config = match relay_url.as_deref().filter(|url| !url.is_empty()) {
            Some(url) => NetConfig::with_relay(url, relay_token.as_deref()).map_err(err)?,
            None => NetConfig::default(),
        };
        let (endpoint, _seats) = NetEndpoint::bind(config).await.map_err(err)?;
        Ok(WasmSeat {
            endpoint,
            username,
            sender: None,
            receiver: None,
            seq: 0,
        })
    }

    /// The `TransportEndpoint` to put in `AnnounceTransport`, as JSON.
    #[wasm_bindgen(js_name = localEndpoint)]
    pub async fn local_endpoint(&self) -> Result<JsValue, JsValue> {
        self.endpoint
            .wait_online(std::time::Duration::from_secs(10))
            .await;
        serde_wasm_bindgen::to_value(&self.endpoint.local()).map_err(err)
    }

    #[wasm_bindgen(js_name = endpointId)]
    pub fn endpoint_id(&self) -> String {
        self.endpoint.id().to_string()
    }

    /// Installs the roster from `RoomTransport` and dials the host it names.
    /// Returns the transport actually established, or null if there is no host
    /// yet or this seat is not attested.
    #[wasm_bindgen(js_name = connectToHost)]
    pub async fn connect_to_host(
        &mut self,
        room_id: String,
        topic_secret: String,
        members: JsValue,
    ) -> Result<JsValue, JsValue> {
        let members: Vec<TransportMember> = serde_wasm_bindgen::from_value(members)?;
        let roster = Roster::new(&room_id, &topic_secret, None, &members).map_err(err)?;
        let attested = roster
            .username_of(&self.endpoint.id())
            .is_some_and(|name| name == self.username);
        let has_host = roster.host().is_some();
        self.endpoint.set_roster(roster);
        if self.sender.is_some() || !has_host || !attested {
            return Ok(JsValue::NULL);
        }

        match self.endpoint.connect_to_host(&self.username).await {
            Ok(channel) => {
                let status = channel.status();
                let (sender, receiver) = channel.split();
                self.sender = Some(sender);
                self.receiver = Some(receiver);
                serde_wasm_bindgen::to_value(&status).map_err(err)
            }
            Err(error) => {
                tracing::debug!(%error, "no direct path to the host");
                Ok(JsValue::NULL)
            }
        }
    }

    /// Sends one engine envelope, the same value the relay would have carried
    /// in `BroadcastState.state`. False means the caller must use the relay.
    pub fn send(&mut self, envelope: JsValue) -> bool {
        let Some(sender) = self.sender.clone() else {
            return false;
        };
        let Ok(payload) = serde_wasm_bindgen::from_value::<serde_json::Value>(envelope) else {
            return false;
        };
        self.seq += 1;
        let frame = SessionFrame::Game {
            seq: self.seq,
            payload,
        };
        if sender.try_send(frame).is_ok() {
            return true;
        }
        self.sender = None;
        self.receiver = None;
        false
    }

    /// Resolves with the next envelope the host sent directly, or null once the
    /// channel is gone and the seat belongs back on the relay.
    pub async fn recv(&mut self) -> Result<JsValue, JsValue> {
        let Some(receiver) = self.receiver.as_mut() else {
            return Ok(JsValue::NULL);
        };
        match receiver.recv().await {
            Some(SessionFrame::Game { payload, .. }) => {
                serde_wasm_bindgen::to_value(&payload).map_err(err)
            }
            _ => {
                self.sender = None;
                self.receiver = None;
                Ok(JsValue::NULL)
            }
        }
    }

    #[wasm_bindgen(js_name = isConnected)]
    pub fn is_connected(&self) -> bool {
        self.sender.is_some()
    }
}
