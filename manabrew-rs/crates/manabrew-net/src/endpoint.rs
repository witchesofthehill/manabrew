//! iroh endpoint lifecycle and the direct seat channel.

use n0_future::time::{Duration, Instant};
use std::net::IpAddr;
use std::sync::{Arc, RwLock};

use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::{Connection, PathEvent, RecvStream, SendStream};
use iroh::protocol::{AcceptError, ProtocolHandler, Router};
use iroh::{Endpoint, EndpointId, RelayMap, RelayMode, RelayUrl, SecretKey, TransportAddr};
use iroh_gossip::net::{Gossip, GOSSIP_ALPN};
use manabrew_relay_protocol::{TransportEndpoint, PROTOCOL_VERSION};
use n0_future::StreamExt;
use tokio::sync::{mpsc, watch};
use tracing::{debug, warn};

use crate::channel::{ChannelGuard, GameChannel, TransportKind, TransportStatus, CHANNEL_CAPACITY};
use crate::frames::{read_frame, write_frame, SessionFrame};
use crate::gossip::RoomGossip;
use crate::roster::{to_transport_endpoint, Roster};
use crate::{NetError, Result};

pub const GAME_ALPN: &[u8] = b"manabrew/game/1";

const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
const REJECT_LINGER: Duration = Duration::from_secs(2);

#[derive(Debug, Default)]
pub struct NetConfig {
    /// Reused across restarts if the caller persists it. Fresh keys are fine:
    /// the relay re-attests the new endpoint id on the next announcement.
    pub secret_key: Option<SecretKey>,
    /// Defaults to an empty relay map, never to the public n0 relays.
    /// Manabrew runs its own `iroh-relay`; endpoint ids and connection metadata
    /// must not transit third-party infrastructure.
    pub relay_mode: Option<RelayMode>,
    /// Drop the IP transports, leaving only the relay. This is the shape a
    /// browser endpoint has whether it asks for it or not, so setting it on a
    /// native endpoint is how the relay path gets tested without a browser.
    pub relay_only: bool,
}

impl NetConfig {
    /// Points the endpoint at a manabrew-operated `iroh-relay`.
    /// The token is what the relay admits this room on; a relay running without
    /// one ignores it.
    pub fn with_relay(url: &str, token: Option<&str>) -> Result<Self> {
        Ok(Self {
            secret_key: None,
            relay_mode: Some(RelayMode::Custom(RelayMap::from_iter([relay_config(
                url, token,
            )?]))),
            relay_only: false,
        })
    }
}

/// A seat that dialled us and passed the roster check.
#[derive(Debug)]
pub struct SeatConnection {
    pub username: String,
    pub endpoint_id: EndpointId,
    /// Distinguishes one connection from the same seat's next one. A seat that
    /// re-dials after a blip is a new connection, not the old one recovering,
    /// and the old one's reader will still fire when it finally notices.
    pub generation: u64,
    pub channel: GameChannel,
}

/// The host may not have applied the same roster yet, so one retry covers that
/// ordering; a later roster retries anyway.
pub const DIAL_ATTEMPTS: usize = 2;
pub const DIAL_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(300);
/// Dialling happens inline in a message loop or a command the UI awaits, so it
/// must not hold either for long.
pub const DIAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Debug)]
pub struct NetEndpoint {
    endpoint: Endpoint,
    gossip: Gossip,
    router: Router,
    roster: SharedRoster,
    /// Addresses learned out of band, which for manabrew means "from the relay".
    /// `connect_to_host` passes a full address so it does not need this, but
    /// gossip dials by endpoint id alone and would otherwise have nothing to
    /// resolve. Feeding it only from the roster keeps the control plane the sole
    /// source of addressing.
    known_addrs: MemoryLookup,
}

pub(crate) type SharedRoster = Arc<RwLock<Option<Roster>>>;

impl NetEndpoint {
    pub async fn bind(config: NetConfig) -> Result<(Self, mpsc::Receiver<SeatConnection>)> {
        let known_addrs = MemoryLookup::new();
        let mut builder = Endpoint::builder(iroh::endpoint::presets::Minimal)
            // An empty map rather than `Disabled`: both mean no relay to start
            // with, but `Disabled` builds no relay transport at all, so
            // `adopt_relay` would have nothing to run the relay it inserts.
            .relay_mode(
                config
                    .relay_mode
                    .unwrap_or_else(|| RelayMode::Custom(RelayMap::empty())),
            )
            .address_lookup(known_addrs.clone());
        // A browser endpoint has no IP transports to begin with, so the knob
        // only exists where they do.
        #[cfg(not(wasm_browser))]
        if config.relay_only {
            builder = builder.clear_ip_transports();
        }
        if let Some(secret) = config.secret_key {
            builder = builder.secret_key(secret);
        }
        // No address lookup service is configured on purpose. The relay hands us
        // a full `EndpointAddr` for every peer, so publishing endpoint ids to a
        // third-party DNS or DHT would leak the roster for no benefit.
        let endpoint = builder.bind().await.map_err(iroh_err)?;

        let gossip = Gossip::builder().spawn(endpoint.clone());
        let roster: SharedRoster = Arc::new(RwLock::new(None));
        let (seats_tx, seats_rx) = mpsc::channel(16);

        let router = Router::builder(endpoint.clone())
            .accept(GOSSIP_ALPN, gossip.clone())
            .accept(
                GAME_ALPN,
                GameAcceptor {
                    roster: roster.clone(),
                    seats: seats_tx,
                    generation: Arc::default(),
                },
            )
            .spawn();

        Ok((
            Self {
                endpoint,
                gossip,
                router,
                roster,
                known_addrs,
            },
            seats_rx,
        ))
    }

    pub fn id(&self) -> EndpointId {
        self.endpoint.id()
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// What to put in `ClientMessage::AnnounceTransport`.
    pub fn local(&self) -> TransportEndpoint {
        to_transport_endpoint(&self.endpoint.addr())
    }

    /// Waits until the endpoint has a home relay, so `local()` is worth
    /// announcing. Returns false on timeout; the caller can still announce its
    /// direct addresses, which is all a LAN peer needs.
    pub async fn wait_online(&self, timeout: Duration) -> bool {
        n0_future::time::timeout(timeout, self.endpoint.online())
            .await
            .is_ok()
    }

    /// Adds a relay the control plane named, for an endpoint that bound without
    /// one. A host that nobody can reach directly then has a path anyway, which
    /// is the difference between a desktop room being playable from across the
    /// internet and only from the same network.
    ///
    /// No QUIC address discovery is configured with it: the relay is reached
    /// through an ordinary reverse proxy, which carries the WebSocket and not
    /// the QAD endpoint.
    pub async fn adopt_relay(&self, url: &str, token: Option<&str>) -> Result<()> {
        let config = relay_config(url, token)?;
        self.endpoint
            .insert_relay(config.url.clone(), Arc::new(config))
            .await;
        Ok(())
    }

    /// Installs the roster the relay just sent. Admission checks read this, so
    /// it must never be fed from gossip.
    pub fn set_roster(&self, roster: Roster) {
        for entry in roster.entries() {
            self.known_addrs.add_endpoint_info(entry.addr.clone());
        }
        *self.roster.write().expect("roster lock") = Some(roster);
    }

    pub fn roster(&self) -> Option<Roster> {
        self.roster.read().expect("roster lock").clone()
    }

    pub async fn join_room_gossip(&self) -> Result<RoomGossip> {
        let roster = self.roster().ok_or(NetError::NoHost)?;
        RoomGossip::join(&self.gossip, self.endpoint.secret_key().clone(), roster).await
    }

    /// Dials the room's authoritative host as `username`.
    ///
    /// Every caller does this from somewhere that must not stall: the bot from
    /// its relay message loop, the desktop seat from a command the webview is
    /// awaiting. [`DIAL_ATTEMPTS`] and [`DIAL_TIMEOUT`] bound it for all of
    /// them.
    pub async fn connect_to_host(&self, username: &str) -> Result<GameChannel> {
        let roster = self.roster().ok_or(NetError::NoHost)?;
        let host = roster.host().ok_or(NetError::NoHost)?.clone();
        let started = Instant::now();

        let conn = self
            .endpoint
            .connect(host.addr.clone(), GAME_ALPN)
            .await
            .map_err(iroh_err)?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(iroh_err)?;

        write_frame(
            &mut send,
            &SessionFrame::Hello {
                room_id: roster.room_id().to_string(),
                username: username.to_string(),
                protocol_version: PROTOCOL_VERSION,
                resume_from: 0,
            },
        )
        .await?;

        match n0_future::time::timeout(HELLO_TIMEOUT, read_frame(&mut recv)).await {
            Ok(Ok(SessionFrame::Welcome { accepted: true, .. })) => {}
            Ok(Ok(SessionFrame::Welcome { reason, .. })) => {
                return Err(NetError::Rejected(
                    reason.unwrap_or_else(|| "no reason given".to_string()),
                ))
            }
            Ok(Ok(_)) => return Err(NetError::Rejected("expected a welcome frame".to_string())),
            Ok(Err(err)) => return Err(err),
            Err(_) => return Err(NetError::Rejected("welcome timed out".to_string())),
        }

        Ok(pump(conn, send, recv, started.elapsed()))
    }

    pub async fn shutdown(self) {
        let _ = self.router.shutdown().await;
        self.endpoint.close().await;
    }
}

#[derive(Debug, Clone)]
struct GameAcceptor {
    roster: SharedRoster,
    seats: mpsc::Sender<SeatConnection>,
    generation: Arc<std::sync::atomic::AtomicU64>,
}

impl ProtocolHandler for GameAcceptor {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        let remote = conn.remote_id();
        let (mut send, mut recv) = conn.accept_bi().await?;

        let hello = match n0_future::time::timeout(HELLO_TIMEOUT, read_frame(&mut recv)).await {
            Ok(Ok(frame)) => frame,
            _ => {
                conn.close(1u8.into(), b"no hello");
                return Ok(());
            }
        };

        let SessionFrame::Hello {
            room_id, username, ..
        } = hello
        else {
            conn.close(1u8.into(), b"expected hello");
            return Ok(());
        };

        // The whole admission decision. `remote` is proven by the QUIC
        // handshake; the roster is the relay's word on who owns it. A claim in
        // the `Hello` frame is worth nothing on its own.
        let verdict = {
            let guard = self.roster.read().expect("roster lock");
            match guard.as_ref() {
                None => Err("room has no roster yet"),
                Some(roster) if roster.room_id() != room_id => Err("wrong room"),
                Some(roster) => match roster.username_of(&remote) {
                    Some(attested) if attested == username => Ok(()),
                    Some(_) => Err("endpoint is attested for a different player"),
                    None => Err("endpoint is not in this room"),
                },
            }
        };

        if let Err(reason) = verdict {
            warn!(%remote, %username, reason, "rejected a direct seat connection");
            let _ = write_frame(
                &mut send,
                &SessionFrame::Welcome {
                    accepted: false,
                    reason: Some(reason.to_string()),
                },
            )
            .await;
            let _ = send.finish();
            // Give the peer time to read the rejection. Closing straight away
            // races it, and it would only see "connection lost".
            let _ = n0_future::time::timeout(REJECT_LINGER, conn.closed()).await;
            conn.close(1u8.into(), reason.as_bytes());
            return Ok(());
        }

        if write_frame(
            &mut send,
            &SessionFrame::Welcome {
                accepted: true,
                reason: None,
            },
        )
        .await
        .is_err()
        {
            return Ok(());
        }

        debug!(%remote, %username, "accepted a direct seat connection");
        let closed = conn.clone();
        let seat = SeatConnection {
            username,
            endpoint_id: remote,
            generation: self
                .generation
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst),
            channel: pump(conn, send, recv, Duration::ZERO),
        };
        if self.seats.send(seat).await.is_err() {
            return Ok(());
        }
        closed.closed().await;
        Ok(())
    }
}

/// Wires a connected bidirectional stream into a [`GameChannel`], plus a task
/// that keeps [`TransportStatus`] in step with the connection's path changes.
fn pump(
    conn: Connection,
    mut send: SendStream,
    mut recv: RecvStream,
    setup: Duration,
) -> GameChannel {
    let (out_tx, mut out_rx) = mpsc::channel::<SessionFrame>(CHANNEL_CAPACITY);
    let (in_tx, in_rx) = mpsc::channel::<SessionFrame>(CHANNEL_CAPACITY);
    let (status_tx, status_rx) = watch::channel(status_of(&conn, setup, 0));

    let writer_conn = conn.clone();
    let writer = n0_future::task::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            if write_frame(&mut send, &frame).await.is_err() {
                break;
            }
        }
        let _ = send.finish();
        drop(writer_conn);
    });

    let reader = n0_future::task::spawn(async move {
        while let Ok(frame) = read_frame(&mut recv).await {
            if in_tx.send(frame).await.is_err() {
                break;
            }
        }
    });

    let watcher_conn = conn.clone();
    let watcher = n0_future::task::spawn(async move {
        let mut events = watcher_conn.path_events();
        let mut churn = 0u32;
        while let Some(event) = events.next().await {
            if matches!(event, PathEvent::Opened { .. } | PathEvent::Closed { .. }) {
                churn += 1;
            }
            if status_tx
                .send(status_of(&watcher_conn, setup, churn))
                .is_err()
            {
                break;
            }
        }
    });

    GameChannel::new(out_tx, in_rx, status_rx)
        .with_guard(ChannelGuard::new(vec![writer, reader, watcher]))
}

fn status_of(conn: &Connection, setup: Duration, reconnects: u32) -> TransportStatus {
    let paths = conn.paths();
    let selected = paths.iter().find(|path| path.is_selected());
    let path = selected.or_else(|| paths.iter().next());

    let Some(path) = path else {
        return TransportStatus {
            kind: TransportKind::IrohRelayed,
            connected: true,
            lan: false,
            remote_addr: None,
            relay_url: None,
            rtt_ms: None,
            setup_ms: setup_ms(setup),
            reconnects,
            failure: None,
        };
    };

    let (kind, remote_addr, relay_url, lan) = match path.remote_addr() {
        TransportAddr::Ip(socket) => (
            TransportKind::IrohDirect,
            Some(socket.to_string()),
            None,
            is_lan(socket.ip()),
        ),
        TransportAddr::Relay(url) => (
            TransportKind::IrohRelayed,
            None,
            Some(url.to_string()),
            false,
        ),
        other => (
            TransportKind::IrohRelayed,
            Some(other.to_string()),
            None,
            false,
        ),
    };

    TransportStatus {
        kind,
        connected: true,
        lan,
        remote_addr,
        relay_url,
        rtt_ms: Some(path.rtt().as_millis() as u64),
        setup_ms: setup_ms(setup),
        reconnects,
        failure: None,
    }
}

fn setup_ms(setup: Duration) -> Option<u64> {
    (setup > Duration::ZERO).then_some(setup.as_millis() as u64)
}

/// "LAN" is an observation about the selected path, not a room mode.
fn is_lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// No QUIC address discovery is configured with it: the relay is reached
/// through an ordinary reverse proxy, which carries the WebSocket and not the
/// QAD endpoint.
fn relay_config(url: &str, token: Option<&str>) -> Result<iroh::RelayConfig> {
    let parsed: RelayUrl = url
        .parse()
        .map_err(|_| NetError::BadRelayUrl(url.to_string()))?;
    let config = iroh::RelayConfig::new(parsed, None);
    Ok(match token {
        Some(token) => config.with_auth_token(token),
        None => config,
    })
}

pub(crate) fn iroh_err<E: std::fmt::Display>(err: E) -> NetError {
    NetError::Iroh(err.to_string())
}
