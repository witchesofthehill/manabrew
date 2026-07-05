use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use manabrew_agent_interface::protocol::{ClientMessage, ServerMessage};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{info, warn};

use crate::state::{BotConfig, BotState};

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsSink = SplitSink<WsStream, Message>;
type WsRead = SplitStream<WsStream>;

const RECONNECT_BACKOFF_SECS: [u64; 6] = [1, 2, 4, 8, 15, 30];

pub async fn run_bot(relay_url: String, config: BotConfig) -> Result<(), String> {
    let mut attempt: usize = 0;
    loop {
        match run_bot_session(&relay_url, config.clone()).await {
            Ok(()) => {
                info!("bot socket closed; reconnecting");
                attempt = 0;
            }
            Err(error) => {
                warn!(%error, attempt, "bot session failed; reconnecting");
            }
        }
        let delay = RECONNECT_BACKOFF_SECS[attempt.min(RECONNECT_BACKOFF_SECS.len() - 1)];
        attempt += 1;
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}

async fn run_bot_session(relay_url: &str, config: BotConfig) -> Result<(), String> {
    let (socket, _) = connect_async(relay_url)
        .await
        .map_err(|error| format!("Failed to connect bot to {}: {}", relay_url, error))?;
    let (mut sink, mut stream) = socket.split();

    let mut state = BotState::new(config);
    for outbound in state.on_open() {
        send(&mut sink, &outbound).await?;
    }

    while let Some(frame) = stream.next().await {
        let frame = frame.map_err(|error| error.to_string())?;
        let text = match frame {
            Message::Text(text) => text,
            Message::Ping(payload) => {
                sink.send(Message::Pong(payload))
                    .await
                    .map_err(|error| error.to_string())?;
                continue;
            }
            Message::Close(_) => break,
            _ => continue,
        };
        let message: ServerMessage =
            serde_json::from_str(&text).map_err(|error| error.to_string())?;
        let outbound = state.on_server_message(&message);
        for msg in outbound {
            send(&mut sink, &msg).await?;
        }
        if let Some(reason) = state.failure() {
            return Err(reason.to_string());
        }
    }

    let _: WsRead = stream;
    Ok(())
}

async fn send(sink: &mut WsSink, message: &ClientMessage) -> Result<(), String> {
    sink.send(Message::Text(
        serde_json::to_string(message).map_err(|error| error.to_string())?,
    ))
    .await
    .map_err(|error| error.to_string())
}
