//! The seat half of the direct data plane (`docs/TRANSPORT.md`).
//!
//! Mirrors `self-hosted-node`'s `DirectPlane`. The bot keeps its relay socket
//! for the whole control plane and only moves its own engine envelopes: the
//! `state`/`prompt` it receives and the `Response`/`Directive` it sends.

use manabrew_agent_interface::protocol::{TransportEndpoint, TransportMember};
use manabrew_net::{
    GameReceiver, GameSender, NetConfig, NetEndpoint, Roster, SessionFrame, DIAL_ATTEMPTS,
    DIAL_RETRY_DELAY, DIAL_TIMEOUT,
};
use serde_json::Value;
use tracing::{debug, info, warn};

pub struct DirectSeat {
    endpoint: NetEndpoint,
    username: String,
    has_relay: bool,
    /// The configured url, used only when the control plane names none. It
    /// carries no token, so a gated relay refuses it.
    fallback_relay: Option<String>,
    /// What is currently installed, so an unchanged relay is not re-inserted.
    /// `insert_relay` schedules a full net report, and the relay re-broadcasts
    /// on every join and leave.
    installed: Option<(String, Option<String>)>,
    sender: Option<GameSender>,
    receiver: Option<GameReceiver>,
    announced: bool,
    seq: u64,
    /// Set at `GameStarted`, cleared when the game ends. The host freezes its
    /// own seat list at the same moment, so both ends agree on which transport
    /// carries this game without any extra negotiation.
    active: bool,
}

impl DirectSeat {
    /// Binds with no relay even when one is configured: ours admits nobody
    /// without a room token, and the token arrives with the roster. See
    /// [`Self::adopt_relay`].
    pub async fn start(username: &str, iroh_relay_url: Option<&str>) -> Option<Self> {
        match NetEndpoint::bind(NetConfig::default()).await {
            Ok((endpoint, _seats)) => Some(Self {
                endpoint,
                username: username.to_string(),
                has_relay: false,
                fallback_relay: iroh_relay_url.map(str::to_string),
                installed: None,
                sender: None,
                receiver: None,
                announced: false,
                seq: 0,
                active: false,
            }),
            Err(error) => {
                warn!(%error, "failed to bind an iroh endpoint; staying on the relay");
                None
            }
        }
    }

    pub fn announced(&self) -> bool {
        self.announced
    }

    /// Takes the relay the control plane named and the token that goes with it.
    /// Runs on every `RoomTransport`, because a token expires and replacing the
    /// config is what renews it. True only the first time, when the endpoint
    /// gains an address it has to announce.
    pub async fn adopt_relay(&mut self, url: Option<&str>, token: Option<&str>) -> bool {
        let Some(url) = url.or(self.fallback_relay.as_deref()) else {
            return false;
        };
        let wanted = (url.to_string(), token.map(str::to_string));
        if self.installed.as_ref() == Some(&wanted) {
            return false;
        }
        let url = url.to_string();
        if let Err(error) = self.endpoint.adopt_relay(&url, token).await {
            warn!(%error, url, "control plane named an unusable relay");
            return false;
        }
        self.installed = Some(wanted);
        let first = !self.has_relay;
        self.has_relay = true;
        info!(
            url,
            renewed = !first,
            "adopted the relay the control plane named"
        );
        first
    }

    pub async fn announce(&mut self) -> TransportEndpoint {
        self.announced = true;
        if self.has_relay {
            self.endpoint
                .wait_online(std::time::Duration::from_secs(5))
                .await;
        }
        self.endpoint.local()
    }

    /// Installs the relay's roster and dials the host it names. Dialling only
    /// happens once; a later roster refreshes addressing without disturbing an
    /// established channel.
    pub async fn on_roster(
        &mut self,
        room_id: &str,
        topic_secret: &str,
        host: Option<&TransportMember>,
        members: &[TransportMember],
    ) {
        let roster = match Roster::new(room_id, topic_secret, host, members) {
            Ok(roster) => roster,
            Err(error) => {
                warn!(%error, room_id, "relay sent an unusable transport roster");
                return;
            }
        };
        let has_host = roster.host().is_some();
        // Our own entry proves the relay has attested us to the host in the
        // same broadcast. Dialling before that is refused, correctly.
        let attested = roster
            .username_of(&self.endpoint.id())
            .is_some_and(|name| name == self.username);
        self.endpoint.set_roster(roster);
        if self.sender.is_some() || !has_host || !attested {
            return;
        }

        // The host may not have applied the same roster yet. A short retry
        // covers that ordering, and a later roster retries anyway.
        for attempt in 0..DIAL_ATTEMPTS {
            let dial =
                tokio::time::timeout(DIAL_TIMEOUT, self.endpoint.connect_to_host(&self.username))
                    .await;
            match dial
                .unwrap_or_else(|_| Err(manabrew_net::NetError::Rejected("dial timed out".into())))
            {
                Ok(channel) => {
                    let status = channel.status();
                    info!(
                        transport = status.kind.as_str(),
                        lan = status.lan,
                        rtt_ms = status.rtt_ms,
                        setup_ms = status.setup_ms,
                        "seat reached the host directly"
                    );
                    let (sender, receiver) = channel.split();
                    self.sender = Some(sender);
                    self.receiver = Some(receiver);
                    return;
                }
                Err(error) => {
                    debug!(%error, attempt, "no direct path to the host yet");
                    if attempt + 1 < DIAL_ATTEMPTS {
                        tokio::time::sleep(DIAL_RETRY_DELAY).await;
                    }
                }
            }
        }
    }

    pub fn freeze(&mut self) {
        self.seq = 0;
        self.active = self.sender.is_some();
        if self.active {
            info!("playing this game on the direct plane");
        }
    }

    pub fn clear(&mut self) {
        self.active = false;
    }

    pub fn try_send(&mut self, envelope: &Value) -> bool {
        if !self.active {
            return false;
        }
        let Some(sender) = self.sender.clone() else {
            return false;
        };
        self.seq += 1;
        let frame = SessionFrame::Game {
            seq: self.seq,
            payload: envelope.clone(),
        };
        if sender.try_send(frame).is_ok() {
            return true;
        }
        warn!("direct channel to the host is gone; falling back to the relay");
        self.fall_back();
        false
    }

    /// Yields the next envelope the host sent directly. Resolves to `None` only
    /// when there is no channel, so a caller can hold it in a `select!` without
    /// spinning.
    pub async fn recv(&mut self) -> Option<Value> {
        let receiver = self.receiver.as_mut()?;
        match receiver.recv().await {
            Some(SessionFrame::Game { payload, .. }) => Some(payload),
            Some(SessionFrame::Bye { reason }) => {
                info!(?reason, "host closed the direct channel");
                self.fall_back();
                None
            }
            Some(other) => {
                debug!(?other, "unexpected frame from the host");
                None
            }
            None => {
                self.fall_back();
                None
            }
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    fn fall_back(&mut self) {
        self.sender = None;
        self.receiver = None;
        self.active = false;
    }

    pub async fn shutdown(self) {
        self.endpoint.shutdown().await;
    }
}
