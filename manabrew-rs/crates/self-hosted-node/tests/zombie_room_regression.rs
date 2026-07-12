// Pins the abandoned-room recovery contract end-to-end: a hosted game whose
// humans vanish must not zombify the room. The relay resets it to Lobby, the
// node aborts its stale engine session, and the same room must then serve a
// fresh, working game. Regression for the production incident where wedged
// engine sessions made rooms load forever (fix: game_id reconcile in host.rs).
//
// Self-orchestrating: spawns relay + node binaries from target/{release,debug}
// (override via ZOMBIE_RELAY_BIN / ZOMBIE_NODE_BIN). Run explicitly:
//   cargo test -p self-hosted-node --test zombie_room_regression -- --ignored

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use manabot::{BotAgent, SimpleAi};
use manabrew_agent_interface::ids_codec::player_slot;
use manabrew_agent_interface::prompt::AgentPrompt;
use manabrew_agent_interface::protocol::{
    ClientMessage, GameFormat, RoomStatus, ServerMessage, StateEnvelope,
};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<Ws, Message>;
type WsRead = SplitStream<Ws>;

struct Proc(Child);

impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Humans vanish (disconnect): seats stay for the reconnect grace, the relay's
/// humanless sweep reclaims the room within minutes, and the node's reconcile
/// aborts the stale session.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "spawns relay + node; run explicitly (CI: build-checks multiplayer-regression)"]
async fn abandoned_room_recovers() {
    scenario(9571, HumanExit::Vanish, 300).await;
}

/// Humans leave (explicit): their seats are gone for good, so the node ends
/// the bots-only game immediately — seconds, not the sweep's minutes.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "spawns relay + node; run explicitly (CI: build-checks multiplayer-regression)"]
async fn left_room_ends_immediately() {
    scenario(9573, HumanExit::Leave, 30).await;
}

#[derive(Clone, Copy)]
enum HumanExit {
    Vanish,
    Leave,
}

async fn scenario(port: u16, exit: HumanExit, reset_deadline_secs: u64) {
    let relay_url = format!("ws://127.0.0.1:{port}");
    let _relay = spawn_relay(port);
    wait_for_port(port).await;
    let _node = spawn_node(&relay_url);
    let room_id = tokio::time::timeout(Duration::from_secs(60), discover_room(&relay_url))
        .await
        .expect("node room did not appear within 60s");

    // A slow second bot keeps the engine session alive after the human's seat
    // is grace-conceded, so the session is still running when the relay's
    // humanless reset fires — the exact wedge condition.
    let bot = tokio::spawn(drive_seat(
        relay_url.clone(),
        "zombie-driver-bot".into(),
        room_id.clone(),
        Seat::Bot,
    ));

    tokio::time::sleep(Duration::from_secs(3)).await;
    let first_game = tokio::time::timeout(
        Duration::from_secs(120),
        drive_seat(
            relay_url.clone(),
            "zombie-human-a".into(),
            room_id.clone(),
            Seat::Human {
                min_players: 3,
                exit,
            },
        ),
    )
    .await
    .expect("first game did not start within 120s")
    .expect("first game failed");
    eprintln!("[regression] first game {first_game} live; human gone");

    tokio::time::timeout(
        Duration::from_secs(reset_deadline_secs),
        wait_for_lobby(&relay_url, &room_id),
    )
    .await
    .unwrap_or_else(|_| {
        panic!("room was not reset to lobby within {reset_deadline_secs}s of abandonment")
    });
    eprintln!("[regression] room reset to lobby");

    let second_game = tokio::time::timeout(
        Duration::from_secs(120),
        drive_seat(
            relay_url.clone(),
            "zombie-human-b".into(),
            room_id.clone(),
            Seat::Human {
                min_players: 2,
                exit: HumanExit::Vanish,
            },
        ),
    )
    .await
    .expect("second game did not start within 120s — room zombified")
    .expect("second game failed");
    assert_ne!(first_game, second_game, "relay must mint a fresh game_id");
    eprintln!("[regression] second game {second_game} live; room recovered");

    bot.abort();
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
    Proc(
        Command::new(bin("manabrew-server", "ZOMBIE_RELAY_BIN"))
            .env("FORGE_PORT", port.to_string())
            .env("FORGE_HEALTH_PORT", (port + 1).to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn manabrew-server"),
    )
}

fn spawn_node(relay_url: &str) -> Proc {
    Proc(
        Command::new(bin("self-hosted-node", "ZOMBIE_NODE_BIN"))
            .env("SELF_HOSTED_NODE_RELAY_URL", relay_url)
            .env("SELF_HOSTED_NODE_ROOM_NAME", "Zombie regression room")
            .env(
                "CARDSET_ARCHIVE",
                workspace_root().join("src-tauri/resources/cardset.rkyv"),
            )
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn self-hosted-node"),
    )
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

async fn discover_room(relay_url: &str) -> String {
    loop {
        if let Ok(Some(room_id)) = list_hosted_lobby_room(relay_url, "probe-discover").await {
            return room_id;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn wait_for_lobby(relay_url: &str, room_id: &str) {
    loop {
        if let Ok(Some(found)) = list_hosted_lobby_room(relay_url, "probe-reset").await {
            if found == room_id {
                return;
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn list_hosted_lobby_room(relay_url: &str, username: &str) -> Result<Option<String>, String> {
    let (mut write, mut read) = connect_and_auth(relay_url, username).await?;
    send(&mut write, &ClientMessage::ListRooms).await?;
    for _ in 0..20 {
        match recv(&mut write, &mut read).await {
            Some(ServerMessage::RoomList { rooms }) => {
                return Ok(rooms
                    .into_iter()
                    .find(|room| room.hosted && room.status == RoomStatus::Lobby)
                    .map(|room| room.room_id));
            }
            Some(_) => continue,
            None => break,
        }
    }
    Err("no RoomList received".into())
}

enum Seat {
    Human { min_players: usize, exit: HumanExit },
    Bot,
}

/// Drives one seat. Humans join, spawn the node bot, start the game, answer
/// three prompts to prove the engine is alive, then vanish (abrupt socket
/// drop) and return the game_id. Bots join and answer prompts (slowly)
/// until their socket dies.
async fn drive_seat(
    relay_url: String,
    username: String,
    room_id: String,
    seat: Seat,
) -> Result<String, String> {
    let is_bot = matches!(seat, Seat::Bot);
    let (min_players, exit) = match seat {
        Seat::Human { min_players, exit } => (min_players, exit),
        Seat::Bot => (usize::MAX, HumanExit::Vanish),
    };
    let (mut write, mut read) = connect_and_auth(&relay_url, &username).await?;

    send(
        &mut write,
        &ClientMessage::JoinRoom {
            room_id: room_id.clone(),
            observe: false,
            as_bot: is_bot,
            password: None,
        },
    )
    .await?;

    if !is_bot {
        let spawn_bot = StateEnvelope::RoomRelay {
            protocol: "self-hosted-node".to_string(),
            version: 1,
            message_id: uuid::Uuid::new_v4().to_string(),
            from_player: Some(username.clone()),
            target_player: None,
            room_id: Some(room_id.clone()),
            payload: json!({
                "type": "spawnBot",
                "deck": { "deckName": "Zombie AI", "deck": basic_deck("Zombie AI", "Forest", "Centaur Courser"), "commanderName": null },
            }),
        };
        send(
            &mut write,
            &ClientMessage::BroadcastState {
                state: serde_json::to_value(&spawn_bot).map_err(|e| e.to_string())?,
            },
        )
        .await?;
    }
    send(
        &mut write,
        &ClientMessage::SetDeckSelection {
            deck_name: "Zombie Player".to_string(),
            deck: serde_json::from_value(basic_deck("Zombie Player", "Mountain", "Hill Giant"))
                .map_err(|e| e.to_string())?,
            commander_name: None,
            avatar: None,
        },
    )
    .await?;
    send(&mut write, &ClientMessage::SetReady { ready: true }).await?;

    let mut ai = SimpleAi::default();
    let mut my_slot: Option<String> = None;
    let mut game_id: Option<String> = None;
    let mut answered = 0usize;
    let mut sent_start = false;
    let mut last_prompt: Option<String> = None;
    while let Some(message) = recv(&mut write, &mut read).await {
        match message {
            ServerMessage::RoomUpdate { room } => {
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
                        &mut write,
                        &ClientMessage::StartGame {
                            format: Some(GameFormat::Standard),
                        },
                    )
                    .await?;
                }
            }
            ServerMessage::GameStarted {
                game_id: id,
                player_order,
                ..
            } => {
                my_slot = player_order
                    .iter()
                    .position(|name| name == &username)
                    .map(player_slot);
                game_id = Some(id);
            }
            ServerMessage::StateUpdate { state, .. } => {
                let Ok(envelope) = serde_json::from_value::<StateEnvelope>(state) else {
                    continue;
                };
                if let StateEnvelope::Prompt { for_player, prompt } = envelope {
                    if my_slot.as_deref() != Some(for_player.as_str()) {
                        continue;
                    }
                    let key = prompt.to_string();
                    if last_prompt.as_deref() == Some(key.as_str()) {
                        continue;
                    }
                    last_prompt = Some(key);
                    let Ok(agent_prompt) = serde_json::from_value::<AgentPrompt>(prompt) else {
                        continue;
                    };
                    if let Some(action) = ai.decide(agent_prompt) {
                        if is_bot {
                            tokio::time::sleep(Duration::from_millis(2000)).await;
                        }
                        let response = StateEnvelope::Response {
                            from_player: for_player,
                            action: serde_json::to_value(&action).map_err(|e| e.to_string())?,
                        };
                        send(
                            &mut write,
                            &ClientMessage::BroadcastState {
                                state: serde_json::to_value(&response)
                                    .map_err(|e| e.to_string())?,
                            },
                        )
                        .await?;
                        answered += 1;
                        if !is_bot && answered >= 3 {
                            if matches!(exit, HumanExit::Leave) {
                                send(&mut write, &ClientMessage::LeaveRoom).await?;
                            }
                            return game_id.ok_or("prompts flowed before GameStarted".into());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Err(format!(
        "'{username}': connection closed before the engine produced prompts"
    ))
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

async fn connect_and_auth(relay_url: &str, username: &str) -> Result<(WsWrite, WsRead), String> {
    let (socket, _) = connect_async(relay_url)
        .await
        .map_err(|error| format!("connect {relay_url}: {error}"))?;
    let (mut write, mut read) = socket.split();
    send(
        &mut write,
        &ClientMessage::Authenticate {
            username: username.to_string(),
            password: "forge".to_string(),
            service: false,
        },
    )
    .await?;
    for _ in 0..20 {
        match recv(&mut write, &mut read).await {
            Some(ServerMessage::AuthResult { success: true, .. }) => return Ok((write, read)),
            Some(ServerMessage::AuthResult {
                success: false,
                error,
                ..
            }) => return Err(format!("auth failed: {}", error.unwrap_or_default())),
            Some(_) => continue,
            None => break,
        }
    }
    Err("no AuthResult".into())
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
