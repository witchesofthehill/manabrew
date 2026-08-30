//! Load generator for the hosted-room fleet.
//!
//! Each client is a real seat: it claims an empty hosted room, asks the node for
//! an AI opponent, plays a real game with `manabot`'s `SimpleAi`, and records the
//! turnaround between answering a prompt and being asked the next one. That
//! number is what a player waits, so it includes the opponent's turn and two
//! network crossings, not engine time alone.
//!
//! Seats join as bots so the games never land in distinct-player analytics.
//! Configured entirely by environment; see the crate README.

use std::collections::HashSet;
use std::env;
use std::time::{Duration, Instant};

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use manabot::{BotAgent, SimpleAi};
use manabrew_agent_interface::ids_codec::player_slot;
use manabrew_agent_interface::prompt::AgentPrompt;
use manabrew_agent_interface::protocol::{
    ClientMessage, ClientPlatform, GameFormat, RoomInfo, RoomStatus, ServerMessage, StateEnvelope,
};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<Ws, Message>;
type WsRead = SplitStream<Ws>;

fn verbose() -> bool {
    env::var("VERBOSE").is_ok()
}

fn node_key(host: &str) -> String {
    match host.rsplit_once('-') {
        Some((head, tail)) if tail.chars().all(|c| c.is_ascii_digit()) => head.to_string(),
        _ => host.to_string(),
    }
}

fn var(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.to_string())
}

struct Stats {
    room: String,
    host: String,
    user: String,
    error: Option<String>,
    join_to_start_ms: u128,
    first_prompt_ms: u128,
    turnarounds_ms: Vec<u128>,
    bytes_in: usize,
    frames_in: usize,
    delta_frames: usize,
    full_state_frames: usize,
    game_over: bool,
    games: usize,
    start_times_ms: Vec<u128>,
}

#[tokio::main]
async fn main() {
    let relay = var("RELAY", "wss://relay.manabrew.app");
    let password = var(
        "RELAY_PASSWORD",
        "725c5fba479c4e59605e39988e31cb76813afa55cd1e71488c4dd2aae998164b",
    );
    let prefix = var("PREFIX", "loadtest");
    let hosts: Vec<String> = var("HOSTS", "")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    let per_host: usize = var("PER_HOST", "4").parse().unwrap_or(4);
    let duration = Duration::from_secs(var("DURATION_S", "300").parse().unwrap_or(300));
    let stagger = Duration::from_millis(var("STAGGER_MS", "500").parse().unwrap_or(500));
    let deck_path = var(
        "DECK",
        "public/preset_decks/starter_deck_red_deck_wins.json",
    );
    let format = match var("FORMAT", "Any").as_str() {
        "Modern" => GameFormat::Modern,
        "Standard" => GameFormat::Standard,
        "Commander" => GameFormat::Commander,
        "Pioneer" => GameFormat::Pioneer,
        "Legacy" => GameFormat::Legacy,
        "Vintage" => GameFormat::Vintage,
        "Pauper" => GameFormat::Pauper,
        _ => GameFormat::Any,
    };

    let deck = load_deck(&deck_path);
    let rooms = list_rooms(&relay, &password).await;
    println!("listed {} rooms", rooms.len());
    let mut picked: Vec<RoomInfo> = Vec::new();
    let mut per_host_count: std::collections::HashMap<String, usize> = Default::default();
    for room in rooms
        .into_iter()
        .filter(|r| r.hosted && r.status == RoomStatus::Lobby && r.players.is_empty())
    {
        if !hosts.is_empty() && !hosts.iter().any(|h| room.host.contains(h.as_str())) {
            continue;
        }
        let slot = per_host_count.entry(node_key(&room.host)).or_default();
        if *slot >= per_host {
            continue;
        }
        *slot += 1;
        picked.push(room);
    }
    picked.sort_by(|a, b| {
        (a.host.clone(), a.room_name.clone()).cmp(&(b.host.clone(), b.room_name.clone()))
    });

    println!(
        "relay={relay} rooms picked={} duration={}s format={format:?} deck={deck_path}",
        picked.len(),
        duration.as_secs()
    );
    for room in &picked {
        println!(
            "  {} {} [{}]",
            &room.room_id[..8],
            room.room_name,
            room.host
        );
    }
    if picked.is_empty() {
        println!("nothing to do");
        return;
    }

    let started = Instant::now();
    let mut tasks = Vec::new();
    for (index, room) in picked.into_iter().enumerate() {
        let relay = relay.clone();
        let password = password.clone();
        let user = format!("{prefix}-{:02}", index + 1);
        let deck = deck.clone();
        let format = format.clone();
        tasks.push(tokio::spawn(async move {
            tokio::time::sleep(stagger * index as u32).await;
            play(relay, password, user, room, deck, duration, format).await
        }));
    }

    let mut all = Vec::new();
    for task in tasks {
        match task.await {
            Ok(stats) => all.push(stats),
            Err(error) => println!("task panicked: {error}"),
        }
    }
    report(&all, started.elapsed());
}

fn report(all: &[Stats], elapsed: Duration) {
    println!("\n=== run finished in {:.0}s ===", elapsed.as_secs_f64());
    println!(
        "{:<14} {:<24} {:>7} {:>8} {:>8} {:>7} {:>7} {:>7} {:>7} {:>9} {:>6}",
        "user",
        "host",
        "prompts",
        "start_s",
        "first_s",
        "p50_ms",
        "p90_ms",
        "p99_ms",
        "max_ms",
        "MB_in",
        "over"
    );
    let mut pooled: Vec<u128> = Vec::new();
    for s in all {
        let mut lat = s.turnarounds_ms.clone();
        lat.sort_unstable();
        pooled.extend(lat.iter().copied());
        let q = |p: f64| -> u128 {
            if lat.is_empty() {
                return 0;
            }
            lat[((lat.len() as f64 - 1.0) * p).round() as usize]
        };
        println!(
            "{:<14} {:<24} {:>7} {:>8.1} {:>8.1} {:>7} {:>7} {:>7} {:>7} {:>9.2} {:>6}",
            s.user,
            &s.host[..s.host.len().min(24)],
            lat.len(),
            s.join_to_start_ms as f64 / 1000.0,
            s.first_prompt_ms as f64 / 1000.0,
            q(0.5),
            q(0.9),
            q(0.99),
            lat.last().copied().unwrap_or(0),
            s.bytes_in as f64 / 1_048_576.0,
            s.games
        );
        if let Some(error) = &s.error {
            println!("    ! {error}");
        }
        println!(
            "    frames={} state_full={} state_delta={} room={}",
            s.frames_in, s.full_state_frames, s.delta_frames, s.room
        );
    }
    pooled.sort_unstable();
    if !pooled.is_empty() {
        let q = |p: f64| pooled[((pooled.len() as f64 - 1.0) * p).round() as usize];
        let mean: f64 = pooled.iter().sum::<u128>() as f64 / pooled.len() as f64;
        println!(
            "\nPOOLED prompts={} mean={:.0}ms p50={}ms p90={}ms p99={}ms max={}ms",
            pooled.len(),
            mean,
            q(0.5),
            q(0.9),
            q(0.99),
            pooled.last().copied().unwrap_or(0)
        );
    }
}

fn load_deck(path: &str) -> Value {
    let raw: Value =
        serde_json::from_slice(&std::fs::read(path).expect("deck file")).expect("deck json");
    let name = raw
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("Loadtest")
        .to_string();
    let mut cards = Vec::new();
    for entry in raw
        .get("cards")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let count = entry.get("count").and_then(Value::as_u64).unwrap_or(1);
        for _ in 0..count {
            cards.push(json!({
                "identity": {
                    "name": entry.get("name").and_then(Value::as_str).unwrap_or(""),
                    "setCode": entry.get("set").and_then(Value::as_str).unwrap_or(""),
                    "cardNumber": entry.get("cardNumber").and_then(Value::as_str).unwrap_or("0"),
                }
            }));
        }
    }
    json!({ "name": name, "cards": cards })
}

async fn list_rooms(relay: &str, password: &str) -> Vec<RoomInfo> {
    let (socket, _) = connect_async(relay).await.expect("probe connect");
    let (mut write, mut read) = socket.split();
    authenticate(&mut write, &mut read, "loadtest-probe", password)
        .await
        .expect("probe auth");
    send(&mut write, &ClientMessage::ListRooms)
        .await
        .expect("list");
    for _ in 0..40 {
        match recv(&mut write, &mut read).await {
            Some((ServerMessage::RoomList { rooms }, _, _)) => return rooms,
            Some(_) => continue,
            None => break,
        }
    }
    Vec::new()
}

#[allow(clippy::too_many_arguments)]
async fn play(
    relay: String,
    password: String,
    user: String,
    room: RoomInfo,
    deck: Value,
    duration: Duration,
    format: GameFormat,
) -> Stats {
    let mut stats = Stats {
        room: room.room_id.clone(),
        host: room.host.clone(),
        user: user.clone(),
        error: None,
        join_to_start_ms: 0,
        first_prompt_ms: 0,
        turnarounds_ms: Vec::new(),
        bytes_in: 0,
        frames_in: 0,
        delta_frames: 0,
        full_state_frames: 0,
        game_over: false,
        games: 0,
        start_times_ms: Vec::new(),
    };
    let deadline = Instant::now() + duration;
    let loop_games = std::env::var("LOOP").is_ok();

    let Ok((socket, _)) = connect_async(&relay).await else {
        stats.error = Some("connect failed".into());
        return stats;
    };
    let (mut write, mut read) = socket.split();
    if let Err(error) = authenticate(&mut write, &mut read, &user, &password).await {
        stats.error = Some(error);
        return stats;
    }

    loop {
        if Instant::now() >= deadline {
            break;
        }
        let joined = Instant::now();
        if let Err(error) = send(
            &mut write,
            &ClientMessage::JoinRoom {
                room_id: room.room_id.clone(),
                observe: false,
                as_bot: std::env::var("AS_BOT").map(|v| v != "0").unwrap_or(true),
                password: None,
            },
        )
        .await
        {
            stats.error = Some(error);
            break;
        }

        // Ask the node for an AI opponent, then take a seat.
        let bot_envelope = StateEnvelope::RoomRelay {
            protocol: "self-hosted-node".to_string(),
            version: 1,
            message_id: uuid::Uuid::new_v4().to_string(),
            from_player: Some(user.clone()),
            target_player: None,
            room_id: Some(room.room_id.clone()),
            payload: json!({
                "type": "spawnBot",
                "deck": { "deckName": "Loadtest AI", "deck": deck, "commanderName": null },
            }),
        };
        let _ = broadcast(&mut write, &bot_envelope).await;
        let _ = send(
            &mut write,
            &ClientMessage::SetDeckSelection {
                deck_name: deck
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Loadtest")
                    .to_string(),
                deck: serde_json::from_value(deck.clone()).expect("deck dto"),
                published_deck_id: None,
                commander_name: None,
                avatar: None,
            },
        )
        .await;
        let _ = send(&mut write, &ClientMessage::SetReady { ready: true }).await;

        // Start once every seat in the room is ready.
        let mut slot: Option<String> = None;
        let mut sent_start = false;
        let mut closed = false;
        let start_deadline = Instant::now() + Duration::from_secs(120);
        while slot.is_none() {
            if Instant::now() > start_deadline {
                stats.error = Some("game never started".into());
                break;
            }
            match recv(&mut write, &mut read).await {
                Some((ServerMessage::RoomUpdate { room: info }, bytes, _)) => {
                    stats.bytes_in += bytes;
                    stats.frames_in += 1;
                    if verbose() {
                        println!(
                            "[{user}] RoomUpdate status={:?} players={:?}",
                            info.status,
                            info.players
                                .iter()
                                .map(|p| format!(
                                    "{}(ready={},deck={:?},conn={})",
                                    p.username, p.ready, p.selected_deck_name, p.connected
                                ))
                                .collect::<Vec<_>>()
                        );
                    }
                    let ready = info.players.len() >= 2
                        && info
                            .players
                            .iter()
                            .all(|p| p.connected && p.ready && p.selected_deck_name.is_some());
                    if !sent_start && info.status == RoomStatus::Lobby && ready {
                        sent_start = true;
                        let _ = send(
                            &mut write,
                            &ClientMessage::StartGame {
                                format: Some(format.clone()),
                            },
                        )
                        .await;
                    }
                }
                Some((ServerMessage::GameStarted { player_order, .. }, bytes, _)) => {
                    stats.bytes_in += bytes;
                    stats.frames_in += 1;
                    stats.join_to_start_ms = joined.elapsed().as_millis();
                    slot = player_order
                        .iter()
                        .position(|name| name == &user)
                        .map(player_slot);
                }
                Some((ServerMessage::Error { code, message }, bytes, _)) => {
                    stats.bytes_in += bytes;
                    stats.frames_in += 1;
                    if verbose() {
                        println!("[{user}] Error {code}: {message}");
                    }
                    if code != "NotInRoom" {
                        stats.error = Some(format!("{code}: {message}"));
                    }
                }
                Some((other, bytes, _)) => {
                    stats.bytes_in += bytes;
                    stats.frames_in += 1;
                    if verbose() {
                        let text = serde_json::to_string(&other).unwrap_or_default();
                        println!("[{user}] {}", &text[..text.len().min(220)]);
                    }
                }
                None => {
                    stats.error = Some("socket closed before game start".into());
                    closed = true;
                    break;
                }
            }
        }
        if closed {
            break;
        }
        let Some(slot) = slot else { break };
        stats.games += 1;
        stats.start_times_ms.push(stats.join_to_start_ms);
        let game_started = Instant::now();

        // Play: answer every prompt for our seat, timing engine turnaround.
        let mut ai = SimpleAi::default();
        let mut last_answer = game_started;
        let mut seen_prompts: HashSet<String> = HashSet::new();
        let game_deadline = std::env::var("GAME_S")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .map(|secs| game_started + Duration::from_secs(secs));
        while Instant::now() < deadline {
            if game_deadline.is_some_and(|at| Instant::now() >= at) {
                break;
            }
            let remaining = game_deadline
                .unwrap_or(deadline)
                .min(deadline)
                .saturating_duration_since(Instant::now());
            let Ok(frame) = tokio::time::timeout(remaining, recv(&mut write, &mut read)).await
            else {
                break;
            };
            let Some((message, bytes, _)) = frame else {
                stats.error = Some("socket closed mid-game".into());
                break;
            };
            stats.bytes_in += bytes;
            stats.frames_in += 1;
            let ServerMessage::StateUpdate { state, .. } = message else {
                continue;
            };
            match state.get("kind").and_then(Value::as_str) {
                Some("state") => stats.full_state_frames += 1,
                Some("stateDelta") => stats.delta_frames += 1,
                _ => {}
            }
            if state
                .get("state")
                .and_then(|s| s.get("gameOver"))
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                stats.game_over = true;
                break;
            }
            let Ok(StateEnvelope::Prompt {
                for_player, prompt, ..
            }) = serde_json::from_value(state)
            else {
                continue;
            };
            if for_player != slot {
                continue;
            }
            let key = prompt.to_string();
            if !seen_prompts.insert(key) {
                continue;
            }
            let Ok(agent_prompt) = serde_json::from_value::<AgentPrompt>(prompt) else {
                continue;
            };
            let prompt_id = agent_prompt.prompt_id;
            let Some(action) = ai.decide(agent_prompt) else {
                continue;
            };
            let turnaround = last_answer.elapsed().as_millis();
            if stats.turnarounds_ms.is_empty() {
                stats.first_prompt_ms = game_started.elapsed().as_millis();
            }
            stats.turnarounds_ms.push(turnaround);
            if let Ok(path) = std::env::var("RAW") {
                use std::io::Write as _;
                if let Ok(mut fh) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                {
                    let line = format!("{user},{},{turnaround}\n", stats.turnarounds_ms.len());
                    let _ = fh.write_all(line.as_bytes());
                }
            }
            let response = StateEnvelope::Response {
                from_player: for_player,
                prompt_id,
                action: serde_json::to_value(&action).unwrap_or(Value::Null),
            };
            if broadcast(&mut write, &response).await.is_err() {
                stats.error = Some("send failed".into());
                break;
            }
            last_answer = Instant::now();
        }

        if !stats.game_over {
            let concede = StateEnvelope::Directive {
                from_player: slot,
                directive: json!({ "type": "concede" }),
            };
            let _ = broadcast(&mut write, &concede).await;
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        let _ = send(&mut write, &ClientMessage::LeaveRoom).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
        stats.game_over = false;
        if !loop_games {
            break;
        }
    }

    let _ = write.send(Message::Close(None)).await;
    stats
}

async fn authenticate(
    write: &mut WsWrite,
    read: &mut WsRead,
    user: &str,
    password: &str,
) -> Result<(), String> {
    send(
        write,
        &ClientMessage::Authenticate {
            username: user.to_string(),
            password: password.to_string(),
            service: false,
            identity: None,
            client_platform: ClientPlatform::Web,
            client_version: Some(var("CLIENT_VERSION", "3.17.3")),
        },
    )
    .await?;
    for _ in 0..40 {
        match recv(write, read).await {
            Some((ServerMessage::AuthResult { success: true, .. }, _, _)) => return Ok(()),
            Some((ServerMessage::AuthResult { error, .. }, _, _)) => {
                return Err(format!("auth rejected: {}", error.unwrap_or_default()))
            }
            Some(_) => continue,
            None => break,
        }
    }
    Err("no AuthResult".into())
}

async fn broadcast(write: &mut WsWrite, envelope: &StateEnvelope) -> Result<(), String> {
    send(
        write,
        &ClientMessage::BroadcastState {
            state: serde_json::to_value(envelope).map_err(|e| e.to_string())?,
            target_player: None,
        },
    )
    .await
}

async fn send(write: &mut WsWrite, message: &ClientMessage) -> Result<(), String> {
    let text = serde_json::to_string(message).map_err(|e| e.to_string())?;
    write
        .send(Message::Text(text))
        .await
        .map_err(|error| format!("send: {error}"))
}

async fn recv(write: &mut WsWrite, read: &mut WsRead) -> Option<(ServerMessage, usize, Instant)> {
    while let Some(frame) = read.next().await {
        match frame {
            Ok(Message::Text(text)) => {
                let bytes = text.len();
                if let Ok(message) = serde_json::from_str::<ServerMessage>(&text) {
                    return Some((message, bytes, Instant::now()));
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
