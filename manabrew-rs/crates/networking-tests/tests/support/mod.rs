// Shared harness for the networking regression suite: spawns a real relay and
// a real hosted node, and drives real websocket clients through the protocol
// crate. No mocks, no browser — the system under test is the actual binaries.

use std::any::Any;
use std::collections::HashSet;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use libtest_mimic::Arguments;
use tokio::runtime::Handle;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use manabot::{BotAgent, SimpleAi};
use manabrew_agent_interface::ids_codec::player_slot;
use manabrew_agent_interface::prompt::AgentPrompt;
use manabrew_agent_interface::protocol::{
    ClientMessage, ClientPlatform, EngineKind, GameFormat, IdentityProof, PlayerInfo, RoomInfo,
    RoomStatus, ServerMessage, StateEnvelope, TransportEndpoint, TransportMember, PROTOCOL_VERSION,
};
use manabrew_net::{
    GameReceiver, GameSender, NetConfig, NetEndpoint, RelayMode, Roster, SessionFrame,
    TransportStatus,
};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<Ws, Message>;
type WsRead = SplitStream<Ws>;

/// Short reconnect window so grace-driven scenarios run in seconds. The relay
/// clamps to a 10s minimum; forfeits fire at window + 5s margin.
pub const RECONNECT_TIMEOUT_S: u32 = 10;
pub const GRACE_DEADLINE: Duration = Duration::from_secs(30);

static PROBE_SEQ: AtomicU32 = AtomicU32::new(0);

const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const GREEN: &str = "\x1b[32m";
const RED: &str = "\x1b[31m";
const RESET: &str = "\x1b[0m";

/// Announce the scenario contract at the top of a test run.
pub fn scenario(given: &str, when: &str, then: &str) {
    println!();
    println!("  {BOLD}Given{RESET}  {given}");
    println!("  {BOLD}When{RESET}   {when}");
    println!("  {BOLD}Then{RESET}   {then}");
}

/// An action the scenario performs.
pub fn step(message: impl AsRef<str>) {
    println!("    {DIM}→{RESET} {}", message.as_ref());
}

/// A fact the scenario verified.
fn check(message: impl AsRef<str>) {
    println!("    {GREEN}✓{RESET} {}", message.as_ref());
}

fn done(message: impl AsRef<str>, elapsed: Duration) {
    println!(
        "    {GREEN}✓{RESET} {} {DIM}({:.1}s){RESET}",
        message.as_ref(),
        elapsed.as_secs_f32()
    );
}

pub struct Proc(Child);

impl Proc {
    fn running(&mut self) -> bool {
        matches!(self.0.try_wait(), Ok(None))
    }
}

impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub struct Sim {
    pub port: u16,
    pub relay_url: String,
    pub room_id: String,
    /// `MANABREW_DIRECT_TRANSPORT` on the relay, `SELF_HOSTED_NODE_IROH` on
    /// the node. Off is production before #838 and the default here.
    direct: bool,
    /// Where the relay writes its analytics events, for the direct scenarios,
    /// which are the only ones that need to read them.
    events_dir: Option<PathBuf>,
    _relay: Option<Proc>,
    node: Option<Proc>,
}

impl Sim {
    /// Relay + hosted node, node room discovered and ready.
    pub async fn spawn(port: u16) -> Sim {
        Sim::spawn_node_sim(port, None, false).await
    }

    /// Same, with the node armed to auto-update off `manifest`.
    pub async fn spawn_updating(port: u16, manifest: &str) -> Sim {
        Sim::spawn_node_sim(port, Some(manifest), false).await
    }

    /// Relay with the direct transport on and a node offering the iroh plane,
    /// which is what a desktop-hosted room looks like from a seat.
    pub async fn spawn_direct(port: u16) -> Sim {
        Sim::spawn_node_sim(port, None, true).await
    }

    async fn spawn_node_sim(port: u16, manifest: Option<&str>, direct: bool) -> Sim {
        let relay_url = format!("ws://127.0.0.1:{port}");
        let events_dir = direct.then(|| fresh_events_dir(port));
        let relay = spawn_relay(port, direct, events_dir.as_deref());
        wait_for_port(port).await;
        let node = spawn_node(&relay_url, manifest, direct);
        let mut sim = Sim {
            port,
            relay_url,
            room_id: String::new(),
            direct,
            events_dir,
            _relay: Some(relay),
            node: Some(node),
        };
        sim.room_id = tokio::time::timeout(Duration::from_secs(60), sim.discover_room())
            .await
            .expect("node room did not appear within 60s");
        step(format!(
            "relay on :{port}{}, node room {}",
            if direct {
                " with the direct transport on"
            } else {
                ""
            },
            &sim.room_id[..8]
        ));
        sim
    }

    /// Relay only — for scenarios about player-created rooms.
    pub async fn spawn_relay_only(port: u16) -> Sim {
        Sim::spawn_relay_only_with(port, false).await
    }

    /// Relay only, direct transport on: the rendezvous and signalling without
    /// an engine host behind them.
    pub async fn spawn_relay_only_direct(port: u16) -> Sim {
        Sim::spawn_relay_only_with(port, true).await
    }

    async fn spawn_relay_only_with(port: u16, direct: bool) -> Sim {
        let relay_url = format!("ws://127.0.0.1:{port}");
        let relay = spawn_relay(port, direct, None);
        wait_for_port(port).await;
        Sim {
            port,
            relay_url,
            room_id: String::new(),
            direct,
            events_dir: None,
            _relay: Some(relay),
            node: None,
        }
    }

    /// Kill the relay and start a fresh one on the same port (memory wiped).
    pub async fn restart_relay(&mut self) {
        self._relay = None;
        tokio::time::sleep(Duration::from_millis(300)).await;
        self._relay = Some(spawn_relay(
            self.port,
            self.direct,
            self.events_dir.as_deref(),
        ));
        wait_for_port(self.port).await;
        step("relay killed and restarted — memory wiped");
    }

    /// The relay's Prometheus text, off its health port.
    pub async fn metrics(&self) -> String {
        let Ok(mut stream) = TcpStream::connect(("127.0.0.1", self.port + 1)).await else {
            return String::new();
        };
        let request = b"GET /metrics HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
        if stream.write_all(request).await.is_err() {
            return String::new();
        }
        let mut body = Vec::new();
        let _ = stream.read_to_end(&mut body).await;
        let text = String::from_utf8_lossy(&body).into_owned();
        text.split_once("\r\n\r\n")
            .map(|(_, body)| body.to_string())
            .unwrap_or_default()
    }

    /// One series, by its exact `name{labels}` text; 0 when the relay has not
    /// recorded it, which is what an untouched counter looks like.
    pub async fn metric(&self, series: &str) -> f64 {
        self.metrics()
            .await
            .lines()
            .find_map(|line| {
                let (name, value) = line.rsplit_once(' ')?;
                (name == series).then(|| value.parse().ok()).flatten()
            })
            .unwrap_or(0.0)
    }

    /// Every analytics event the relay has written so far.
    pub fn events(&self) -> Vec<Value> {
        let Some(dir) = &self.events_dir else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
            .flat_map(|text| {
                text.lines()
                    .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    /// Poll the relay's events until one satisfies `pred`.
    pub async fn wait_event(&self, deadline: Duration, what: &str, pred: impl Fn(&Value) -> bool) {
        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(deadline, async {
            loop {
                if self.events().iter().any(&pred) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        })
        .await;
        assert!(result.is_ok(), "timed out waiting for: {what}");
        done(what, started.elapsed());
    }

    pub fn node_running(&mut self) -> bool {
        self.node.as_mut().is_some_and(Proc::running)
    }

    pub async fn wait_node_exit(&mut self, deadline: Duration) {
        let started = tokio::time::Instant::now();
        while started.elapsed() < deadline {
            if !self.node_running() {
                check("the drained node exited for the supervisor to respawn");
                return;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        panic!("the drained node never exited within {deadline:?}");
    }

    pub fn kill_node(&mut self) {
        self.node = None;
        step("node process killed");
    }

    async fn discover_room(&self) -> String {
        loop {
            if let Some(room) = self
                .rooms()
                .await
                .into_iter()
                .find(|room| room.hosted && room.status == RoomStatus::Lobby)
            {
                return room.room_id;
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    /// Room list as seen by a fresh probe connection.
    pub async fn rooms(&self) -> Vec<RoomInfo> {
        let probe = format!("probe-{}", PROBE_SEQ.fetch_add(1, Ordering::Relaxed));
        let Ok(mut client) = Client::connect(&self.relay_url, &probe).await else {
            return Vec::new();
        };
        if send(&mut client.write, &ClientMessage::ListRooms)
            .await
            .is_err()
        {
            return Vec::new();
        }
        for _ in 0..20 {
            match recv(&mut client.write, &mut client.read).await {
                Some(ServerMessage::RoomList { rooms }) => return rooms,
                Some(_) => continue,
                None => break,
            }
        }
        Vec::new()
    }

    /// Relay-wide player sessions as seen by a fresh probe connection.
    pub async fn players(&self) -> Vec<PlayerInfo> {
        let probe = format!("probe-{}", PROBE_SEQ.fetch_add(1, Ordering::Relaxed));
        let Ok(mut client) = Client::connect(&self.relay_url, &probe).await else {
            return Vec::new();
        };
        if send(&mut client.write, &ClientMessage::ListPlayers)
            .await
            .is_err()
        {
            return Vec::new();
        }
        for _ in 0..20 {
            match recv(&mut client.write, &mut client.read).await {
                Some(ServerMessage::PlayerList { players }) => return players,
                Some(_) => continue,
                None => break,
            }
        }
        Vec::new()
    }

    /// Poll the room list until the predicate holds for this sim's room
    /// (None = room absent from the list).
    pub async fn wait_room(
        &self,
        deadline: Duration,
        what: &str,
        pred: impl Fn(Option<&RoomInfo>) -> bool,
    ) {
        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(deadline, async {
            loop {
                let rooms = self.rooms().await;
                let room = rooms.iter().find(|room| room.room_id == self.room_id);
                if pred(room) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        })
        .await;
        assert!(result.is_ok(), "timed out waiting for: {what}");
        done(what, started.elapsed());
    }
}

pub struct Client {
    pub username: String,
    pub slot: Option<String>,
    pub game_id: Option<String>,
    /// What the relay advertised in `AuthResult.features`.
    pub features: Vec<String>,
    write: WsWrite,
    read: WsRead,
    ai: SimpleAi,
    last_prompt: Option<String>,
    envelope_kinds: HashSet<String>,
}

impl Client {
    pub async fn connect(relay_url: &str, username: &str) -> Result<Client, String> {
        Client::connect_as(relay_url, username, None).await
    }

    pub async fn connect_as(
        relay_url: &str,
        username: &str,
        device: Option<&str>,
    ) -> Result<Client, String> {
        Client::connect_full(
            relay_url,
            username,
            username,
            device.map(|secret| IdentityProof {
                token: None,
                device: Some(secret.to_string()),
            }),
            None,
        )
        .await
    }

    /// Connect reporting an app version, the way a released client does. `None`
    /// stands in for a build old enough that it reported nothing.
    pub async fn connect_versioned(
        relay_url: &str,
        username: &str,
        version: &str,
    ) -> Result<Client, String> {
        Client::connect_full(relay_url, username, username, None, Some(version)).await
    }

    /// `legacy_username` goes into the deprecated `Authenticate.username`
    /// field; `session_username` is the name the session is expected to get
    /// (the identity token's handle when one is sent).
    pub async fn connect_with_proof(
        relay_url: &str,
        legacy_username: &str,
        session_username: &str,
        identity: Option<IdentityProof>,
    ) -> Result<Client, String> {
        Client::connect_full(relay_url, legacy_username, session_username, identity, None).await
    }

    pub async fn connect_full(
        relay_url: &str,
        legacy_username: &str,
        session_username: &str,
        identity: Option<IdentityProof>,
        version: Option<&str>,
    ) -> Result<Client, String> {
        let (socket, _) = connect_async(relay_url)
            .await
            .map_err(|error| format!("connect {relay_url}: {error}"))?;
        let (mut write, mut read) = socket.split();
        send(
            &mut write,
            &ClientMessage::Authenticate {
                username: legacy_username.to_string(),
                password: "forge".to_string(),
                service: false,
                identity,
                client_platform: ClientPlatform::Unknown,
                client_version: version.map(str::to_string),
            },
        )
        .await?;
        for _ in 0..20 {
            match recv(&mut write, &mut read).await {
                Some(ServerMessage::AuthResult {
                    success: true,
                    features,
                    ..
                }) => {
                    return Ok(Client {
                        username: session_username.to_string(),
                        slot: None,
                        game_id: None,
                        features,
                        write,
                        read,
                        ai: SimpleAi::default(),
                        last_prompt: None,
                        envelope_kinds: HashSet::new(),
                    });
                }
                Some(ServerMessage::AuthResult { error, .. }) => {
                    return Err(format!("auth failed: {}", error.unwrap_or_default()));
                }
                Some(_) => continue,
                None => break,
            }
        }
        Err("no AuthResult".into())
    }

    pub async fn join(&mut self, room_id: &str, as_bot: bool) -> Result<(), String> {
        send(
            &mut self.write,
            &ClientMessage::JoinRoom {
                room_id: room_id.to_string(),
                observe: false,
                as_bot,
                password: None,
            },
        )
        .await
    }

    /// Join with retries — the room may still be resurrecting after a relay
    /// restart.
    pub async fn join_retry(&mut self, room_id: &str) -> Result<(), String> {
        for _ in 0..30 {
            self.join(room_id, false).await?;
            let joined = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    match recv(&mut self.write, &mut self.read).await {
                        Some(ServerMessage::RoomUpdate { room })
                            if room.room_id == room_id
                                && room
                                    .players
                                    .iter()
                                    .any(|p| p.username == self.username && p.connected) =>
                        {
                            return true;
                        }
                        Some(ServerMessage::Error { .. }) => return false,
                        Some(_) => continue,
                        None => return false,
                    }
                }
            })
            .await
            .unwrap_or(false);
            if joined {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Err(format!("'{}' could not (re)join {room_id}", self.username))
    }

    /// Ask the node to (re)spawn its bot with a basic deck.
    pub async fn spawn_node_bot(&mut self, room_id: &str) -> Result<(), String> {
        let envelope = StateEnvelope::RoomRelay {
            protocol: "self-hosted-node".to_string(),
            version: 1,
            message_id: uuid::Uuid::new_v4().to_string(),
            from_player: Some(self.username.clone()),
            target_player: None,
            room_id: Some(room_id.to_string()),
            payload: json!({
                "type": "spawnBot",
                "deck": { "deckName": "Reg AI", "deck": basic_deck("Reg AI", "Forest", "Centaur Courser"), "commanderName": null },
            }),
        };
        self.broadcast(&envelope).await
    }

    pub async fn select_deck_and_ready(&mut self) -> Result<(), String> {
        send(
            &mut self.write,
            &ClientMessage::SetDeckSelection {
                deck_name: "Reg Player".to_string(),
                deck: serde_json::from_value(basic_deck("Reg Player", "Mountain", "Hill Giant"))
                    .map_err(|e| e.to_string())?,
                published_deck_id: None,
                commander_name: None,
                avatar_url: None,
            },
        )
        .await?;
        send(&mut self.write, &ClientMessage::SetReady { ready: true }).await
    }

    /// Wait until `min_players` seats are ready, start the game, and record
    /// this client's slot + the relay's game_id.
    pub async fn start_game(&mut self, min_players: usize) -> Result<(), String> {
        let mut sent_start = false;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if tokio::time::Instant::now() > deadline {
                return Err("start_game timed out".into());
            }
            match recv(&mut self.write, &mut self.read).await {
                Some(ServerMessage::RoomUpdate { room }) => {
                    if !sent_start
                        && room.status == RoomStatus::Lobby
                        && room.players.len() >= min_players
                        && room
                            .players
                            .iter()
                            .all(|p| p.connected && p.ready && p.selected_deck_name.is_some())
                    {
                        sent_start = true;
                        send(
                            &mut self.write,
                            &ClientMessage::StartGame {
                                format: Some(GameFormat::Standard),
                            },
                        )
                        .await?;
                    }
                }
                Some(ServerMessage::GameStarted {
                    game_id,
                    player_order,
                    ..
                }) => {
                    self.slot = player_order
                        .iter()
                        .position(|name| name == &self.username)
                        .map(player_slot);
                    check(format!(
                        "game {} started; '{}' plays {}",
                        &game_id[..8],
                        self.username,
                        self.slot.as_deref().unwrap_or("?")
                    ));
                    self.game_id = Some(game_id);
                    return Ok(());
                }
                Some(_) => continue,
                None => return Err("connection closed before game start".into()),
            }
        }
    }

    /// Answer `n` prompts addressed to this seat — proves the engine is live
    /// and serving us.
    pub async fn answer_prompts(&mut self, n: usize) -> Result<(), String> {
        let mut answered = 0;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
        while answered < n {
            if tokio::time::Instant::now() > deadline {
                return Err(format!(
                    "'{}' answered {answered}/{n} prompts before timing out",
                    self.username
                ));
            }
            let Some(message) = recv(&mut self.write, &mut self.read).await else {
                return Err(format!("'{}' connection closed mid-game", self.username));
            };
            if let Some(response) = self.prompt_response(message)? {
                self.broadcast(&response).await?;
                answered += 1;
            }
        }
        check(format!(
            "'{}' answered {n} prompt(s) — engine is live",
            self.username
        ));
        Ok(())
    }

    /// Every envelope `kind` this client has been sent while answering
    /// prompts. Proves what the relay chose to put on the wire for this seat.
    pub fn saw_envelope_kind(&self, kind: &str) -> bool {
        self.envelope_kinds.contains(kind)
    }

    fn prompt_response(&mut self, message: ServerMessage) -> Result<Option<StateEnvelope>, String> {
        let ServerMessage::StateUpdate { state, .. } = message else {
            return Ok(None);
        };
        self.envelope_response(state)
    }

    /// The same decision for an envelope whichever transport carried it.
    fn envelope_response(&mut self, state: Value) -> Result<Option<StateEnvelope>, String> {
        if let Some(kind) = state.get("kind").and_then(serde_json::Value::as_str) {
            self.envelope_kinds.insert(kind.to_string());
        }
        let Ok(StateEnvelope::Prompt {
            for_player, prompt, ..
        }) = serde_json::from_value(state)
        else {
            return Ok(None);
        };
        if self.slot.as_deref() != Some(for_player.as_str()) {
            return Ok(None);
        }
        let key = prompt.to_string();
        if self.last_prompt.as_deref() == Some(key.as_str()) {
            return Ok(None);
        }
        self.last_prompt = Some(key);
        let Ok(agent_prompt) = serde_json::from_value::<AgentPrompt>(prompt) else {
            return Ok(None);
        };
        let prompt_id = agent_prompt.prompt_id;
        let Some(action) = self.ai.decide(agent_prompt) else {
            return Ok(None);
        };
        Ok(Some(StateEnvelope::Response {
            from_player: for_player,
            prompt_id,
            action: serde_json::to_value(&action).map_err(|e| e.to_string())?,
        }))
    }

    /// Answer `n` prompts wherever they arrive: on the seat's direct channel
    /// or on the relay socket. Both are read throughout, because the host puts
    /// room-wide envelopes on the relay whatever plane a seat took, and a
    /// socket nobody drains eventually stalls the relay's writer.
    pub async fn answer_prompts_over(
        &mut self,
        seat: &mut DirectSeat,
        n: usize,
    ) -> Result<Answered, String> {
        let mut answered = Answered::default();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
        while answered.direct + answered.relay < n {
            if tokio::time::Instant::now() > deadline {
                return Err(format!(
                    "'{}' answered {}/{n} prompts before timing out ({answered:?})",
                    self.username,
                    answered.direct + answered.relay
                ));
            }
            let arrived = tokio::select! {
                frame = seat.recv() => Arrived::Direct(frame),
                message = recv(&mut self.write, &mut self.read) => Arrived::Relay(message),
            };
            match arrived {
                Arrived::Direct(None) => {
                    return Err(format!(
                        "'{}' lost its direct channel mid-game",
                        self.username
                    ))
                }
                Arrived::Direct(Some(SessionFrame::Game { payload, .. })) => {
                    if let Some(response) = self.envelope_response(payload)? {
                        seat.send(&response)?;
                        answered.direct += 1;
                    }
                }
                Arrived::Direct(Some(_)) => {}
                Arrived::Relay(None) => {
                    return Err(format!("'{}' connection closed mid-game", self.username))
                }
                Arrived::Relay(Some(message)) => {
                    if let ServerMessage::StateUpdate { state, .. } = &message {
                        let for_me = state.get("kind").and_then(Value::as_str) == Some("prompt")
                            && state.get("forPlayer").and_then(Value::as_str)
                                == self.slot.as_deref();
                        if for_me {
                            answered.relay_prompts_for_me += 1;
                        }
                    }
                    if let Some(response) = self.prompt_response(message)? {
                        self.broadcast(&response).await?;
                        answered.relay += 1;
                    }
                }
            }
        }
        check(format!(
            "'{}' answered {n} prompt(s): {} direct, {} over the relay",
            self.username, answered.direct, answered.relay
        ));
        Ok(answered)
    }

    /// Forget what was seen so far, so the next assertions are about what
    /// arrives after a transport change rather than before it. A prompt that
    /// crossed the direct channel unanswered arrives again over the relay and
    /// must not be deduplicated away.
    pub fn on_fallback(&mut self) {
        self.last_prompt = None;
        self.envelope_kinds.clear();
    }

    /// Publishes, or with `None` withdraws, this seat's endpoint.
    pub async fn announce(&mut self, endpoint: Option<TransportEndpoint>) -> Result<(), String> {
        let what = if endpoint.is_some() {
            "announced a direct endpoint"
        } else {
            "withdrew its endpoint"
        };
        send(
            &mut self.write,
            &ClientMessage::AnnounceTransport { endpoint },
        )
        .await?;
        step(format!("'{}' {what}", self.username));
        Ok(())
    }

    /// The first roster that names a host and this seat: what a seat has to
    /// have before it may dial.
    pub async fn wait_roster(
        &mut self,
        deadline: Duration,
    ) -> Result<(TransportMember, Vec<TransportMember>), String> {
        let started = tokio::time::Instant::now();
        while started.elapsed() < deadline {
            match recv(&mut self.write, &mut self.read).await {
                Some(ServerMessage::RoomTransport {
                    host: Some(host),
                    members,
                    ..
                }) if members.iter().any(|m| m.username == self.username) => {
                    check(format!(
                        "'{}' got a roster naming host '{}' and {} member(s)",
                        self.username,
                        host.username,
                        members.len()
                    ));
                    return Ok((host, members));
                }
                Some(_) => continue,
                None => return Err("connection closed awaiting a roster".into()),
            }
        }
        Err(format!(
            "'{}' never got a roster naming a host",
            self.username
        ))
    }

    /// Every roster's host within `window`, so a scenario can say "none of
    /// them named one".
    pub async fn roster_hosts_within(&mut self, window: Duration) -> Vec<Option<String>> {
        let mut hosts = Vec::new();
        let _ = tokio::time::timeout(window, async {
            loop {
                match recv(&mut self.write, &mut self.read).await {
                    Some(ServerMessage::RoomTransport { host, .. }) => {
                        hosts.push(host.map(|h| h.username))
                    }
                    Some(_) => continue,
                    None => return,
                }
            }
        })
        .await;
        hosts
    }

    pub async fn signal_peer(&mut self, to: &str, payload: Value) -> Result<(), String> {
        send(
            &mut self.write,
            &ClientMessage::SignalPeer {
                to: to.to_string(),
                payload,
            },
        )
        .await
    }

    pub async fn expect_peer_signal(
        &mut self,
        deadline: Duration,
    ) -> Result<(String, Value), String> {
        let started = tokio::time::Instant::now();
        while started.elapsed() < deadline {
            match recv(&mut self.write, &mut self.read).await {
                Some(ServerMessage::PeerSignal { from, payload }) => {
                    check(format!(
                        "'{}' received signalling from '{from}'",
                        self.username
                    ));
                    return Ok((from, payload));
                }
                Some(_) => continue,
                None => return Err("connection closed awaiting signalling".into()),
            }
        }
        Err(format!("'{}' received no signalling", self.username))
    }

    pub async fn expect_no_peer_signal(&mut self, window: Duration) -> Result<(), String> {
        let got = tokio::time::timeout(window, async {
            loop {
                match recv(&mut self.write, &mut self.read).await {
                    Some(ServerMessage::PeerSignal { from, .. }) => return Some(from),
                    Some(_) => continue,
                    None => return None,
                }
            }
        })
        .await;
        match got {
            Ok(Some(from)) => Err(format!(
                "'{}' was sent signalling from '{from}' that the relay should have dropped",
                self.username
            )),
            _ => {
                check(format!("'{}' received nothing", self.username));
                Ok(())
            }
        }
    }

    pub async fn create_room(&mut self, name: &str) -> Result<(), String> {
        send(
            &mut self.write,
            &ClientMessage::CreateRoom {
                room_name: name.to_string(),
                max_players: 4,
                format: GameFormat::Commander,
                protocol_version: PROTOCOL_VERSION,
                hosted: false,
                engine: EngineKind::Manabrew,
                draft_config: None,
                sealed_config: None,
                official_key: None,
                password: None,
                reconnect_timeout_s: Some(RECONNECT_TIMEOUT_S),
            },
        )
        .await
    }

    pub async fn wait_own_room(&mut self) -> Result<RoomInfo, String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            if tokio::time::Instant::now() > deadline {
                return Err("no RoomCreated".into());
            }
            match recv(&mut self.write, &mut self.read).await {
                Some(ServerMessage::RoomCreated { room, .. }) => return Ok(room),
                Some(_) => continue,
                None => return Err("connection closed awaiting RoomCreated".into()),
            }
        }
    }

    /// Out-of-band concede for this seat; the seat stays in the room as a
    /// spectator.
    pub async fn concede(&mut self) -> Result<(), String> {
        let slot = self.slot.clone().ok_or("no seat to concede")?;
        let envelope = StateEnvelope::Directive {
            from_player: slot,
            directive: json!({ "type": "concede" }),
        };
        self.broadcast(&envelope).await?;
        step(format!(
            "'{}' conceded — still connected, watching",
            self.username
        ));
        Ok(())
    }

    /// Clean exit from the room; the connection itself stays up.
    pub async fn leave(&mut self) -> Result<(), String> {
        send(&mut self.write, &ClientMessage::LeaveRoom).await?;
        step(format!("'{}' left the room", self.username));
        Ok(())
    }

    pub async fn expect_session_taken_over(&mut self) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while tokio::time::Instant::now() < deadline {
            match recv(&mut self.write, &mut self.read).await {
                Some(ServerMessage::SessionTakenOver) => {
                    check(format!("'{}' was signed out by its owner", self.username));
                    return Ok(());
                }
                Some(_) => continue,
                None => return Err("socket closed before SessionTakenOver".into()),
            }
        }
        Err("no SessionTakenOver".into())
    }

    /// Abrupt exit: the socket just dies (crash, killed tab, lost network).
    pub fn vanish(self) {
        step(format!("'{}' vanished — socket dropped", self.username));
    }

    /// Pull the relay's replay and assert it resumes the expected game.
    pub async fn resync_expecting(&mut self, expected_game_id: &str) -> Result<(), String> {
        send(&mut self.write, &ClientMessage::RequestResync).await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            if tokio::time::Instant::now() > deadline {
                return Err("no GameStarted in resync".into());
            }
            match recv(&mut self.write, &mut self.read).await {
                Some(ServerMessage::GameStarted {
                    game_id,
                    player_order,
                    ..
                }) => {
                    if game_id != expected_game_id {
                        return Err(format!(
                            "resync returned game {game_id}, expected {expected_game_id}"
                        ));
                    }
                    self.slot = player_order
                        .iter()
                        .position(|name| name == &self.username)
                        .map(player_slot);
                    check(format!(
                        "resync resumed game {} for '{}'",
                        &game_id[..8],
                        self.username
                    ));
                    self.game_id = Some(game_id);
                    return Ok(());
                }
                Some(_) => continue,
                None => return Err("connection closed during resync".into()),
            }
        }
    }

    async fn broadcast(&mut self, envelope: &StateEnvelope) -> Result<(), String> {
        send(
            &mut self.write,
            &ClientMessage::BroadcastState {
                state: serde_json::to_value(envelope).map_err(|e| e.to_string())?,
                target_player: None,
            },
        )
        .await
    }
}

/// A guest seat that answers its prompts (slowly, so games outlive
/// orchestration) until aborted. Bot seats run the production `manabot`
/// client — reconnects and all; human seats use a scripted loop, since no
/// production client will sit a human seat unattended. Background task.
pub fn spawn_guest_bot(
    relay_url: String,
    username: String,
    room_id: String,
    delay: Duration,
    as_bot: bool,
) -> tokio::task::JoinHandle<()> {
    if as_bot {
        let config = manabot::BotConfig {
            username,
            password: "forge".to_string(),
            room_id,
            room_password: None,
            deck_name: "Reg AI".to_string(),
            deck: serde_json::from_value(basic_deck("Reg AI", "Forest", "Centaur Courser"))
                .expect("bot deck"),
            commander_name: None,
            agent: manabot::AgentKind::Simple,
            answer_delay_ms: Some(delay.as_millis() as u64),
        };
        let shutdown = std::sync::Arc::new(tokio::sync::Notify::new());
        return tokio::spawn(async move {
            let _ = manabot::run_bot(relay_url, config, shutdown).await;
        });
    }
    tokio::spawn(async move {
        let Ok(mut bot) = Client::connect(&relay_url, &username).await else {
            return;
        };
        if bot.join(&room_id, false).await.is_err() {
            return;
        }
        if bot.select_deck_and_ready().await.is_err() {
            return;
        }
        loop {
            let Some(message) = recv(&mut bot.write, &mut bot.read).await else {
                return;
            };
            if let ServerMessage::GameStarted { player_order, .. } = &message {
                bot.slot = player_order
                    .iter()
                    .position(|name| name == &bot.username)
                    .map(player_slot);
                continue;
            }
            let Ok(Some(response)) = bot.prompt_response(message) else {
                continue;
            };
            tokio::time::sleep(delay).await;
            if bot.broadcast(&response).await.is_err() {
                return;
            }
        }
    })
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root")
}

fn bin(name: &str, env_override: &str) -> PathBuf {
    if let Ok(path) = std::env::var(env_override) {
        return PathBuf::from(path);
    }
    // Same profile as this test binary, so a stale artifact from the other
    // profile can never be picked up.
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    workspace_root().join("target").join(profile).join(name)
}

fn spawn_relay(port: u16, direct: bool, events_dir: Option<&std::path::Path>) -> Proc {
    let mut command = Command::new(bin("manabrew-server", "REGRESSION_RELAY_BIN"));
    command
        .env("FORGE_PORT", port.to_string())
        .env("FORGE_HEALTH_PORT", (port + 1).to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if direct {
        command.env("MANABREW_DIRECT_TRANSPORT", "1");
    }
    if let Some(dir) = events_dir {
        command.env("MANABREW_EVENTS_DIR", dir);
    }
    Proc(command.spawn().expect("spawn manabrew-server"))
}

/// A directory the relay can write events into, emptied first so a scenario
/// reads only its own.
fn fresh_events_dir(port: u16) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("manabrew-regression-{port}-events"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("events dir");
    dir
}

fn spawn_node(relay_url: &str, manifest: Option<&str>, iroh: bool) -> Proc {
    let mut command = Command::new(bin("self-hosted-node", "REGRESSION_NODE_BIN"));
    if iroh {
        // The binary has to be built with `--features iroh` too; without it
        // this is a warning in the node's log and every seat stays on the
        // relay, which the direct scenarios then fail on.
        command.env("SELF_HOSTED_NODE_IROH", "1");
    }
    command
        .env("SELF_HOSTED_NODE_RELAY_URL", relay_url)
        .env("SELF_HOSTED_NODE_ROOM_NAME", "Regression room")
        .env(
            "SELF_HOSTED_NODE_RECONNECT_TIMEOUT_S",
            RECONNECT_TIMEOUT_S.to_string(),
        )
        .env(
            "CARDSET_ARCHIVE",
            workspace_root().join("src-tauri/resources/cardset.rkyv"),
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(manifest) = manifest {
        command
            .env("SELF_HOSTED_NODE_SHUTDOWN_ON_STALE", "1")
            .env("SELF_HOSTED_NODE_MANIFEST_URL", manifest)
            .env("SELF_HOSTED_NODE_STALE_POLL_SECS", "2");
    }
    if let Ok(backend) = std::env::var("REGRESSION_NODE_ENGINE_BACKEND") {
        command.env("SELF_HOSTED_NODE_ENGINE_BACKEND", backend);
    }
    Proc(command.spawn().expect("spawn self-hosted-node"))
}

/// How many prompts crossed each transport.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Answered {
    pub direct: usize,
    pub relay: usize,
    /// Prompts for this seat that arrived over the relay, answered or not. A
    /// prompt already answered on the direct channel is deduplicated and never
    /// counted in `relay`, so this is the number that says whether the host
    /// put anything for a direct seat on the relay at all.
    pub relay_prompts_for_me: usize,
}

// A frame and a relay message differ in size; one arrives at a time and is
// matched at once, so boxing the larger would buy nothing.
#[allow(clippy::large_enum_variant)]
enum Arrived {
    Direct(Option<SessionFrame>),
    Relay(Option<ServerMessage>),
}

/// A seat's iroh endpoint, standing where the desktop shell stands: it announces
/// what the shell would announce, dials the host the roster names, and carries
/// the seat's own envelopes. No relay, because everything here is on one box,
/// and one box is the case a direct path cannot lose.
pub struct DirectSeat {
    endpoint: NetEndpoint,
    username: String,
    sender: Option<GameSender>,
    receiver: Option<GameReceiver>,
    seq: u64,
    _incoming: tokio::sync::mpsc::Receiver<manabrew_net::SeatConnection>,
}

impl DirectSeat {
    pub async fn bind(username: &str) -> DirectSeat {
        let (endpoint, incoming) = NetEndpoint::bind(NetConfig {
            relay_mode: Some(RelayMode::Disabled),
            ..Default::default()
        })
        .await
        .expect("bind an iroh endpoint");
        step(format!("'{username}' bound a direct endpoint"));
        DirectSeat {
            endpoint,
            username: username.to_string(),
            sender: None,
            receiver: None,
            seq: 0,
            _incoming: incoming,
        }
    }

    /// What goes into `AnnounceTransport`.
    pub fn endpoint(&self) -> TransportEndpoint {
        self.endpoint.local()
    }

    /// Installs the roster and dials the host it names.
    pub async fn dial(
        &mut self,
        room_id: &str,
        host: &TransportMember,
        members: &[TransportMember],
    ) -> Result<TransportStatus, String> {
        self.endpoint
            .set_roster(Roster::new(room_id, Some(host), members));
        let channel = tokio::time::timeout(
            Duration::from_secs(10),
            self.endpoint.connect_to_host(&self.username),
        )
        .await
        .map_err(|_| "dialling the host timed out".to_string())?
        .map_err(|error| format!("dialling the host: {error}"))?;
        let status = channel.status();
        let (sender, receiver) = channel.split();
        self.sender = Some(sender);
        self.receiver = Some(receiver);
        self.seq = 0;
        check(format!(
            "'{}' reached the host over {} (lan={})",
            self.username,
            status.kind.as_str(),
            status.lan
        ));
        Ok(status)
    }

    /// The next frame from the host. Pends for ever with no channel, so a
    /// `select!` over both transports reads the relay alone.
    pub async fn recv(&mut self) -> Option<SessionFrame> {
        match &mut self.receiver {
            Some(receiver) => receiver.recv().await,
            None => std::future::pending().await,
        }
    }

    pub fn send(&mut self, envelope: &StateEnvelope) -> Result<(), String> {
        let sender = self.sender.as_ref().ok_or("no direct channel to send on")?;
        self.seq += 1;
        let frame = SessionFrame::Game {
            seq: self.seq,
            payload: serde_json::to_value(envelope).map_err(|e| e.to_string())?,
        };
        sender.try_send(frame).map_err(|e| e.to_string())
    }

    /// Says goodbye and closes the connection. The host puts this seat back on
    /// the relay owing it a board.
    pub async fn hang_up(&mut self) {
        if let Some(sender) = self.sender.take() {
            let _ = sender
                .send(SessionFrame::Bye {
                    reason: Some("regression: seat hangs up".to_string()),
                })
                .await;
            tokio::time::sleep(Duration::from_millis(200)).await;
            // Closed, not dropped: the receiver holds the other half of the
            // guard, and a dropped sender would leave the connection open.
            sender.close();
        }
        self.receiver = None;
        step(format!(
            "'{}' hung up its direct channel — back on the relay",
            self.username
        ));
    }

    pub async fn shutdown(self) {
        self.endpoint.shutdown().await;
    }
}

/// The release manifest the node polls. Serves this node's own build until
/// `publish`, then a newer one — a release going out under a running fleet.
pub struct Manifest {
    port: u16,
    published: Arc<AtomicBool>,
    server: tokio::task::JoinHandle<()>,
}

impl Manifest {
    pub async fn serve(port: u16) -> Manifest {
        let published = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind(("127.0.0.1", port))
            .await
            .expect("bind manifest server");
        let flag = published.clone();
        let server = tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let version = if flag.load(Ordering::Relaxed) {
                    "999.0.0"
                } else {
                    "0.0.1"
                };
                let body = json!({ "packages": { "self-hosted-node": version } }).to_string();
                let mut request = [0u8; 1024];
                let _ = socket.read(&mut request).await;
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        Manifest {
            port,
            published,
            server,
        }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/manifest.json", self.port)
    }

    pub fn publish(&self) {
        self.published.store(true, Ordering::Relaxed);
        step("a newer self-hosted-node build is published to the manifest");
    }
}

impl Drop for Manifest {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn wait_for_port(port: u16) {
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    panic!("relay did not listen on {port} within 20s");
}

fn basic_deck(name: &str, land: &str, creature: &str) -> Value {
    let mut cards: Vec<Value> = (0..40)
        .map(|i| card(format!("{}-{}", land.to_lowercase(), i), land))
        .collect();
    for i in 0..20 {
        cards.push(card(format!("creature-{i}"), creature));
    }
    json!({ "name": name, "cards": cards })
}

fn card(id: String, name: &str) -> Value {
    json!({ "identity": { "id": id, "name": name, "setCode": "", "cardNumber": "0" } })
}

async fn send(write: &mut WsWrite, message: &ClientMessage) -> Result<(), String> {
    let text = serde_json::to_string(message).map_err(|e| e.to_string())?;
    write
        .send(Message::Text(text))
        .await
        .map_err(|error| format!("send: {error}"))
}

async fn recv(write: &mut WsWrite, read: &mut WsRead) -> Option<ServerMessage> {
    while let Some(frame) = read.next().await {
        match frame {
            Ok(Message::Text(text)) => {
                if let Ok(message) = serde_json::from_str::<ServerMessage>(&text) {
                    return Some(message);
                }
            }
            Ok(Message::Ping(payload)) => {
                let _ = write.send(Message::Pong(payload)).await;
            }
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
    None
}

const RULE_WIDTH: usize = 72;

fn rule() -> String {
    "─".repeat(RULE_WIDTH)
}

pub struct Case {
    pub name: &'static str,
    pub run: Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = ()> + Send>> + Send>,
}

pub fn case<F, Fut>(name: &'static str, f: F) -> Case
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    Case {
        name,
        run: Box::new(move || Box::pin(f())),
    }
}

fn begin_test(name: &str) {
    println!();
    println!("{DIM}{}{RESET}", rule());
    println!("  {BOLD}{name}{RESET}");
}

fn pass_test(name: &str, elapsed: Duration) {
    println!();
    println!(
        "  {GREEN}{BOLD}PASS{RESET}  {DIM}{name}{RESET} {DIM}({:.1}s){RESET}",
        elapsed.as_secs_f32()
    );
}

fn fail_test(name: &str, elapsed: Duration, msg: &str) {
    println!();
    println!(
        "  {RED}{BOLD}FAIL{RESET}  {DIM}{name}{RESET} {DIM}({:.1}s){RESET}",
        elapsed.as_secs_f32()
    );
    if !msg.is_empty() {
        println!("        {RED}{msg}{RESET}");
    }
}

fn filtered_out(args: &Arguments, name: &str) -> bool {
    for skip in &args.skip {
        if name.contains(skip.as_str()) {
            return true;
        }
    }
    match &args.filter {
        Some(f) if args.exact => name != f.as_str(),
        Some(f) => !name.contains(f.as_str()),
        None => false,
    }
}

fn should_run(args: &Arguments) -> bool {
    args.ignored || args.include_ignored
}

fn panic_message(payload: Box<dyn Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        String::from("<non-string panic payload>")
    }
}

pub fn list(args: &Arguments, cases: &[Case]) {
    for case in cases {
        if !filtered_out(args, case.name) {
            println!("{}: test", case.name);
        }
    }
}

pub fn execute(args: &Arguments, handle: &Handle, cases: Vec<Case>) -> (usize, usize, usize) {
    let mut passed = 0;
    let mut failed = 0;
    let mut skipped = 0;
    for case in cases {
        if filtered_out(args, case.name) {
            continue;
        }
        if !should_run(args) {
            skipped += 1;
            println!();
            println!("  {DIM}SKIP{RESET}  {}", case.name);
            continue;
        }
        let Case { name, run } = case;
        begin_test(name);
        let start = Instant::now();
        let result = std::panic::catch_unwind(AssertUnwindSafe(|| handle.block_on(run())));
        let elapsed = start.elapsed();
        match result {
            Ok(()) => {
                passed += 1;
                pass_test(name, elapsed);
            }
            Err(payload) => {
                failed += 1;
                fail_test(name, elapsed, &panic_message(payload));
            }
        }
    }
    (passed, failed, skipped)
}

pub fn summary(passed: usize, failed: usize, skipped: usize, elapsed: Duration) {
    let tone = if failed == 0 { GREEN } else { RED };
    let mut parts = vec![format!("{passed} passed"), format!("{failed} failed")];
    if skipped > 0 {
        parts.push(format!("{skipped} skipped"));
    }
    println!();
    println!("{DIM}{}{RESET}", rule());
    println!(
        "  {tone}{BOLD}{} · {:.0}s{RESET}",
        parts.join(" · "),
        elapsed.as_secs_f32()
    );
    println!("{DIM}{}{RESET}", rule());
}
