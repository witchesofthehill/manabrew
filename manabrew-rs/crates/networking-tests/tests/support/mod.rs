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
    RoomStatus, ServerMessage, StateEnvelope, PROTOCOL_VERSION,
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
    _relay: Option<Proc>,
    node: Option<Proc>,
    direct: bool,
    log_path: Option<std::path::PathBuf>,
    capture_dir: Option<std::path::PathBuf>,
}

impl Sim {
    /// Relay + hosted node, node room discovered and ready.
    pub async fn spawn(port: u16) -> Sim {
        Sim::spawn_node_sim(port, None).await
    }

    /// Same, with the node armed to auto-update off `manifest`.
    pub async fn spawn_updating(port: u16, manifest: &str) -> Sim {
        Sim::spawn_node_sim(port, Some(manifest)).await
    }

    /// Relay + hosted node with the direct data plane on, and the node's log
    /// captured so a test can read which transport a game actually used.
    pub async fn spawn_direct(port: u16) -> Sim {
        let mut sim = Sim::spawn_node_sim_with(port, None, true).await;
        sim.direct = true;
        sim
    }

    /// Everything the node has logged so far. Empty unless spawned by
    /// [`Sim::spawn_direct`].
    pub fn node_log(&self) -> String {
        self.log_path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .unwrap_or_default()
    }

    pub async fn wait_node_log(&self, deadline: Duration, needle: &str) -> bool {
        let started = tokio::time::Instant::now();
        while started.elapsed() < deadline {
            if self.node_log().contains(needle) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        false
    }

    /// Every captured line for every game the relay recorded. Empty unless
    /// spawned by [`Sim::spawn_direct`].
    pub fn capture_lines(&self) -> Vec<String> {
        let Some(dir) = &self.capture_dir else {
            return Vec::new();
        };
        let mut lines = Vec::new();
        let mut stack = vec![dir.clone()];
        while let Some(path) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&path) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if let Ok(file) = std::fs::File::open(&path) {
                    if let Ok(text) = zstd::decode_all(file) {
                        lines.extend(String::from_utf8_lossy(&text).lines().map(str::to_string));
                    }
                }
            }
        }
        lines
    }

    pub async fn wait_capture(&self, deadline: Duration, needle: &str) -> Option<String> {
        let started = tokio::time::Instant::now();
        while started.elapsed() < deadline {
            if let Some(line) = self
                .capture_lines()
                .into_iter()
                .find(|line| line.contains(needle))
            {
                return Some(line);
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        None
    }

    async fn spawn_node_sim(port: u16, manifest: Option<&str>) -> Sim {
        Sim::spawn_node_sim_with(port, manifest, false).await
    }

    async fn spawn_node_sim_with(port: u16, manifest: Option<&str>, direct: bool) -> Sim {
        let relay_url = format!("ws://127.0.0.1:{port}");
        let capture_dir = direct.then(|| {
            let dir = std::env::temp_dir().join(format!("manabrew-capture-{port}"));
            let _ = std::fs::remove_dir_all(&dir);
            dir
        });
        let relay = spawn_relay_with(port, capture_dir.as_deref());
        wait_for_port(port).await;
        let log_path = direct.then(|| {
            std::env::temp_dir().join(format!("manabrew-node-{port}-{}.log", std::process::id()))
        });
        let node = spawn_node(&relay_url, port, manifest, direct, log_path.as_deref());
        let mut sim = Sim {
            port,
            relay_url,
            room_id: String::new(),
            _relay: Some(relay),
            node: Some(node),
            direct,
            log_path,
            capture_dir,
        };
        sim.room_id = tokio::time::timeout(Duration::from_secs(60), sim.discover_room())
            .await
            .expect("node room did not appear within 60s");
        step(format!("relay on :{port}, node room {}", &sim.room_id[..8]));
        sim
    }

    /// Relay only — for scenarios about player-created rooms.
    pub async fn spawn_relay_only(port: u16) -> Sim {
        let relay_url = format!("ws://127.0.0.1:{port}");
        let relay = spawn_relay(port);
        wait_for_port(port).await;
        Sim {
            port,
            relay_url,
            room_id: String::new(),
            _relay: Some(relay),
            node: None,
            direct: false,
            log_path: None,
            capture_dir: None,
        }
    }

    /// Kill the relay and start a fresh one on the same port (memory wiped).
    pub async fn restart_relay(&mut self) {
        self._relay = None;
        tokio::time::sleep(Duration::from_millis(300)).await;
        self._relay = Some(spawn_relay(self.port));
        wait_for_port(self.port).await;
        step("relay killed and restarted — memory wiped");
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
                Some(ServerMessage::AuthResult { success: true, .. }) => {
                    return Ok(Client {
                        username: session_username.to_string(),
                        slot: None,
                        game_id: None,
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
            iroh: false,
            iroh_relay_url: None,
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

fn spawn_relay(port: u16) -> Proc {
    spawn_relay_with(port, None)
}

fn spawn_relay_with(port: u16, capture_dir: Option<&std::path::Path>) -> Proc {
    let mut command = Command::new(bin("manabrew-server", "REGRESSION_RELAY_BIN"));
    if let Some(dir) = capture_dir {
        command.env("MANABREW_GAME_CAPTURE_DIR", dir);
        // The relay hosts its own iroh relay, gated by a room token it mints.
        // Without this the direct plane runs direct-only, which is the easy
        // case: nothing would notice a host that can never obtain a token.
        command
            .env("MANABREW_IROH_RELAY_PORT", (port + 2).to_string())
            .env(
                "MANABREW_IROH_RELAY_URL",
                format!("http://127.0.0.1:{}", port + 2),
            );
    }
    Proc(
        command
            .env("FORGE_PORT", port.to_string())
            .env("FORGE_HEALTH_PORT", (port + 1).to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn manabrew-server"),
    )
}

fn spawn_node(
    relay_url: &str,
    relay_port: u16,
    manifest: Option<&str>,
    direct: bool,
    log_path: Option<&std::path::Path>,
) -> Proc {
    let mut command = Command::new(bin("self-hosted-node", "REGRESSION_NODE_BIN"));
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
        );
    match log_path {
        // `tracing_subscriber::fmt::layer()` writes to stdout, so both streams
        // go to the file or the node's own log is invisible to a test.
        Some(path) => {
            let log = std::fs::File::create(path).expect("create node log");
            let err = log.try_clone().expect("clone node log handle");
            command
                .env("SELF_HOSTED_NODE_IROH", if direct { "1" } else { "0" })
                // Configured, which is the shape the fleet rollout uses and the
                // one that used to bind tokenless and be refused by its own
                // relay. A host binds relay-less regardless and adopts this
                // from `RoomTransport` with the token.
                .env(
                    "SELF_HOSTED_NODE_IROH_RELAY_URL",
                    format!("http://127.0.0.1:{}", relay_port + 2),
                )
                .env("RUST_LOG", "info")
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(err));
        }
        None => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }
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
