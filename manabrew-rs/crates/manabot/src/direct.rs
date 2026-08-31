//! The seat half of the direct data plane (`docs/TRANSPORT.md`).
//!
//! Mirrors `self-hosted-node`'s `DirectPlane`. The bot keeps its relay socket
//! for the whole control plane and only moves its own engine envelopes: the
//! `state`/`prompt` it receives and the `Response`/`Directive` it sends.

use manabrew_agent_interface::protocol::{TransportEndpoint, TransportMember};
use manabrew_net::{GameReceiver, GameSender, NetConfig, NetEndpoint, Roster, SessionFrame};
use serde_json::Value;
use tracing::{debug, info, warn};

const DIAL_ATTEMPTS: usize = 2;
const DIAL_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(300);
/// Dialling happens inline in the session loop, so it must not hold the relay
/// socket for long.
const DIAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

pub struct DirectSeat {
    endpoint: NetEndpoint,
    username: String,
    has_relay: bool,
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
    pub async fn start(username: &str, iroh_relay_url: Option<&str>) -> Option<Self> {
        let config = match iroh_relay_url {
            Some(url) => match NetConfig::with_relay(url) {
                Ok(config) => config,
                Err(error) => {
                    warn!(%error, url, "invalid iroh relay url; staying on the relay");
                    return None;
                }
            },
            None => NetConfig::default(),
        };
        match NetEndpoint::bind(config).await {
            Ok((endpoint, _seats)) => Some(Self {
                endpoint,
                username: username.to_string(),
                has_relay: iroh_relay_url.is_some(),
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
                    tokio::time::sleep(DIAL_RETRY_DELAY).await;
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
