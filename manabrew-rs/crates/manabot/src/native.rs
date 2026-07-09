use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use manabrew_agent_interface::protocol::{ClientMessage, ServerMessage};
use tokio::net::TcpStream;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{info, warn};

use crate::state::{BotConfig, BotState};

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsSink = SplitSink<WsStream, Message>;
type WsRead = SplitStream<WsStream>;

const RECONNECT_BACKOFF_SECS: [u64; 6] = [1, 2, 4, 8, 15, 30];
const CLOSE_DRAIN_TIMEOUT: Duration = Duration::from_secs(3);

enum SessionEnd {
    Shutdown,
    Disconnected,
}

pub async fn run_bot(
    relay_url: String,
    config: BotConfig,
    shutdown: Arc<Notify>,
) -> Result<(), String> {
    let mut attempt: usize = 0;
    loop {
        match run_bot_session(&relay_url, config.clone(), &shutdown).await {
            Ok(SessionEnd::Shutdown) => {
                info!("bot socket closed on shutdown");
                return Ok(());
            }
            Ok(SessionEnd::Disconnected) => {
                info!("bot socket closed; reconnecting");
                attempt = 0;
            }
            Err(error) => {
                warn!(%error, attempt, "bot session failed; reconnecting");
            }
        }
        let delay = RECONNECT_BACKOFF_SECS[attempt.min(RECONNECT_BACKOFF_SECS.len() - 1)];
        attempt += 1;
        tokio::select! {
            _ = shutdown.notified() => return Ok(()),
            _ = tokio::time::sleep(Duration::from_secs(delay)) => {}
        }
    }
}

async fn run_bot_session(
    relay_url: &str,
    config: BotConfig,
    shutdown: &Notify,
) -> Result<SessionEnd, String> {
    let (socket, _) = connect_async(relay_url)
        .await
        .map_err(|error| format!("Failed to connect bot to {}: {}", relay_url, error))?;
    let (mut sink, mut stream) = socket.split();

    let mut state = BotState::new(config);
    for outbound in state.on_open() {
        send(&mut sink, &outbound).await?;
    }

    loop {
        let frame = tokio::select! {
            _ = shutdown.notified() => {
                close(&mut sink, &mut stream).await;
                return Ok(SessionEnd::Shutdown);
            }
            frame = stream.next() => frame,
        };
        let Some(frame) = frame else { break };
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
            close(&mut sink, &mut stream).await;
            return Err(reason.to_string());
        }
    }

    Ok(SessionEnd::Disconnected)
}

async fn close(sink: &mut WsSink, stream: &mut WsRead) {
    if sink.send(Message::Close(None)).await.is_err() {
        return;
    }
    let _ = tokio::time::timeout(CLOSE_DRAIN_TIMEOUT, async {
        while let Some(Ok(_)) = stream.next().await {}
    })
    .await;
}

async fn send(sink: &mut WsSink, message: &ClientMessage) -> Result<(), String> {
    sink.send(Message::Text(
        serde_json::to_string(message).map_err(|error| error.to_string())?,
    ))
    .await
    .map_err(|error| error.to_string())
}
