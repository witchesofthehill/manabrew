use std::time::Duration;

use forge_agent_interface::ids_codec::player_slot;
use forge_agent_interface::prompt::AgentPrompt;
use forge_agent_interface::protocol::{
    ClientMessage, GameFormat, RoomStatus, ServerMessage, StateEnvelope,
};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use manabot::{BotAgent, SimpleAi};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<Ws, Message>;
type WsRead = SplitStream<Ws>;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a running relay + self-hosted-node; run with --ignored"]
async fn hosted_play_vs_ai_smoke() {
    let relay = env_or("HOSTED_SMOKE_RELAY_URL", "ws://127.0.0.1:9443");
    let key = env_or("HOSTED_SMOKE_SERVER_KEY", "forge");
    let games: usize = env_or("HOSTED_SMOKE_GAMES", "2").parse().unwrap_or(2);
    let max_prompts: usize = env_or("HOSTED_SMOKE_MAX_PROMPTS", "600")
        .parse()
        .unwrap_or(600);
    let timeout_secs: u64 = env_or("HOSTED_SMOKE_TIMEOUT_SECS", "240")
        .parse()
        .unwrap_or(240);

    eprintln!(
        "[smoke] relay={relay} games={games} max_prompts={max_prompts} timeout={timeout_secs}s"
    );

    let rooms =
        match tokio::time::timeout(Duration::from_secs(30), discover_rooms(&relay, &key, games))
            .await
        {
            Ok(Ok(rooms)) => rooms,
            Ok(Err(error)) => panic!("room discovery failed: {error}"),
            Err(_) => panic!("room discovery timed out after 30s"),
        };
    assert!(
        rooms.len() >= games,
        "need {games} open node rooms, found {} (is the node up with MAX_GAMES>={games}?)",
        rooms.len()
    );

    let mut handles = Vec::new();
    for (i, room_id) in rooms.into_iter().take(games).enumerate() {
        let relay = relay.clone();
        let key = key.clone();
        handles.push(tokio::spawn(async move {
            let result = play_game(&relay, &key, &room_id, i, max_prompts, timeout_secs).await;
            (i, result)
        }));
    }

    let mut ok = 0usize;
    for handle in handles {
        match handle.await {
            Ok((i, Ok(()))) => {
                ok += 1;
                eprintln!("[smoke] game {i} OK");
            }
            Ok((i, Err(error))) => eprintln!("[smoke] game {i} FAIL: {error}"),
            Err(error) => eprintln!("[smoke] task panicked: {error}"),
        }
    }
    eprintln!("[smoke] {ok}/{games} games completed");
    assert_eq!(ok, games, "{ok}/{games} games completed");
}

async fn discover_rooms(relay: &str, key: &str, want: usize) -> Result<Vec<String>, String> {
    let (mut write, mut read) = connect(relay).await?;
    send(
        &mut write,
        &ClientMessage::Authenticate {
            username: "smoke-probe".to_string(),
            password: key.to_string(),
            service: false,
        },
    )
    .await?;
    await_auth(&mut write, &mut read).await?;
    send(&mut write, &ClientMessage::ListRooms).await?;
    for _ in 0..50 {
        match recv(&mut write, &mut read).await {
            Some(ServerMessage::RoomList { rooms }) => {
                let ids = rooms
                    .into_iter()
                    .filter(|room| {
                        room.hosted
                            && room.status == RoomStatus::Lobby
                            && room.format == GameFormat::Any
                            && room.players.len() < room.max_players as usize
                    })
                    .map(|room| room.room_id)
                    .collect::<Vec<_>>();
                eprintln!("[smoke] discovered {} open node rooms", ids.len());
                return Ok(ids.into_iter().take(want).collect());
            }
            Some(_) => continue,
            None => break,
        }
    }
    Err("no RoomList received".to_string())
}

async fn play_game(
    relay: &str,
    key: &str,
    room_id: &str,
    idx: usize,
    max_prompts: usize,
    timeout_secs: u64,
) -> Result<(), String> {
    let username = format!("smoke-player-{idx}");
    let run = async {
        let (mut write, mut read) = connect(relay).await?;
        send(
            &mut write,
            &ClientMessage::Authenticate {
                username: username.clone(),
                password: key.to_string(),
                service: false,
            },
        )
        .await?;
        await_auth(&mut write, &mut read).await?;

        send(
            &mut write,
            &ClientMessage::JoinRoom {
                room_id: room_id.to_string(),
                observe: false,
                as_bot: false,
                password: None,
            },
        )
        .await?;

        let spawn_bot = StateEnvelope::RoomRelay {
            protocol: "self-hosted-node".to_string(),
            version: 1,
            message_id: uuid::Uuid::new_v4().to_string(),
            from_player: Some(username.clone()),
            target_player: None,
            room_id: Some(room_id.to_string()),
            payload: json!({
                "type": "spawnBot",
                "deck": { "deckName": "Smoke AI", "deck": basic_deck("Smoke AI", "Forest", "Centaur Courser"), "commanderName": null },
            }),
        };
        send(
            &mut write,
            &ClientMessage::BroadcastState {
                state: serde_json::to_value(&spawn_bot).map_err(|e| e.to_string())?,
            },
        )
        .await?;

        send(
            &mut write,
            &ClientMessage::SetDeckSelection {
                deck_name: "Smoke Player".to_string(),
                deck: serde_json::from_value(basic_deck("Smoke Player", "Mountain", "Hill Giant"))
                    .map_err(|e| e.to_string())?,
                commander_name: None,
            },
        )
        .await?;
        send(&mut write, &ClientMessage::SetReady { ready: true }).await?;

        let mut ai = SimpleAi::default();
        let mut my_slot: Option<String> = None;
        let mut acted = 0usize;
        let mut last_prompt: Option<String> = None;
        let mut sent_start = false;
        while let Some(message) = recv(&mut write, &mut read).await {
            match message {
                ServerMessage::GameStarted { player_order, .. } => {
                    my_slot = player_order
                        .iter()
                        .position(|name| name == &username)
                        .map(player_slot);
                    eprintln!("[smoke] game {idx}: started, my slot={my_slot:?}");
                }
                ServerMessage::StateUpdate { state, .. } => {
                    if is_game_over(&state) {
                        return Ok(());
                    }
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
                            acted += 1;
                            if acted >= max_prompts {
                                return Err(format!("game {idx} exceeded {max_prompts} prompts"));
                            }
                        }
                    }
                }
                ServerMessage::RoomUpdate { room } => {
                    if !sent_start
                        && room.status == RoomStatus::Lobby
                        && room.players.len() >= 2
                        && room
                            .players
                            .iter()
                            .all(|p| p.connected && p.ready && p.selected_deck_name.is_some())
                    {
                        sent_start = true;
                        let start = StateEnvelope::RoomRelay {
                            protocol: "self-hosted-node".to_string(),
                            version: 1,
                            message_id: uuid::Uuid::new_v4().to_string(),
                            from_player: Some(username.clone()),
                            target_player: None,
                            room_id: Some(room_id.to_string()),
                            payload: json!({ "type": "startGame", "format": "Standard" }),
                        };
                        send(
                            &mut write,
                            &ClientMessage::BroadcastState {
                                state: serde_json::to_value(&start).map_err(|e| e.to_string())?,
                            },
                        )
                        .await?;
                    }
                }
                ServerMessage::Error { code, message } => {
                    eprintln!("[smoke] game {idx}: relay error {code}: {message}");
                }
                _ => {}
            }
        }
        Err(format!("game {idx}: connection closed before game over"))
    };

    match tokio::time::timeout(Duration::from_secs(timeout_secs), run).await {
        Ok(result) => result,
        Err(_) => Err(format!("game {idx}: timed out after {timeout_secs}s")),
    }
}

fn is_game_over(state: &Value) -> bool {
    let text = state.to_string();
    text.contains("\"type\":\"gameOver\"")
        || text.contains("\"gameOver\":true")
        || text.contains("\"game_over\":true")
        || text.contains("\"winner\"")
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
    json!({ "id": id, "name": name, "setCode": "", "cardNumber": "0" })
}

async fn connect(relay: &str) -> Result<(WsWrite, WsRead), String> {
    let (socket, _) = connect_async(relay)
        .await
        .map_err(|error| format!("connect {relay}: {error}"))?;
    let (write, read) = socket.split();
    Ok((write, read))
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

async fn await_auth(write: &mut WsWrite, read: &mut WsRead) -> Result<(), String> {
    for _ in 0..20 {
        match recv(write, read).await {
            Some(ServerMessage::AuthResult { success: true, .. }) => return Ok(()),
            Some(ServerMessage::AuthResult {
                success: false,
                error,
                ..
            }) => {
                return Err(format!("auth failed: {}", error.unwrap_or_default()));
            }
            Some(_) => continue,
            None => break,
        }
    }
    Err("no AuthResult".to_string())
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
