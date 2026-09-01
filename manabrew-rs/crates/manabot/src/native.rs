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

use crate::direct::DirectSeat;
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
        .map_err(|error| format!("Failed to connect bot to {relay_url}: {error}"))?;
    let (mut sink, mut stream) = socket.split();

    let mut direct = if config.iroh {
        DirectSeat::start(&config.username, config.iroh_relay_url.as_deref()).await
    } else {
        None
    };

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
            Some(payload) = direct_recv(&mut direct) => {
                // The host sent this straight to us. It is the same envelope
                // the relay would have wrapped in a StateUpdate, so the bot's
                // state machine cannot tell the two apart.
                let message = ServerMessage::StateUpdate {
                    from_player: String::new(),
                    state: payload,
                };
                for msg in state.on_server_message(&message) {
                    send_seat_message(&mut sink, &mut direct, &msg).await?;
                }
                if let Some(reason) = state.failure() {
                    close(&mut sink, &mut stream).await;
                    return Err(reason.to_string());
                }
                continue;
            }
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
        if let Some(seat) = &mut direct {
            if let Some(announce) = on_transport_message(seat, &message).await {
                send(&mut sink, &announce).await?;
            }
        }
        let outbound = state.on_server_message(&message);
        for msg in outbound {
            if let (Some(delay), ClientMessage::BroadcastState { .. }) =
                (state.answer_delay(), &msg)
            {
                tokio::select! {
                    _ = shutdown.notified() => {
                        close(&mut sink, &mut stream).await;
                        return Ok(SessionEnd::Shutdown);
                    }
                    _ = tokio::time::sleep(delay) => {}
                }
            }
            send_seat_message(&mut sink, &mut direct, &msg).await?;
        }
        if let Some(reason) = state.failure() {
            close(&mut sink, &mut stream).await;
            return Err(reason.to_string());
        }
    }

    Ok(SessionEnd::Disconnected)
}

/// Pends forever when there is no direct channel, so it can sit in a `select!`
/// without spinning.
async fn direct_recv(seat: &mut Option<DirectSeat>) -> Option<serde_json::Value> {
    match seat {
        Some(seat) => seat.recv().await,
        None => std::future::pending().await,
    }
}

/// Keeps the seat's view of the room's data plane in step with the relay's, and
/// returns the announcement to send when the relay first names this room.
async fn on_transport_message(
    seat: &mut DirectSeat,
    message: &ServerMessage,
) -> Option<ClientMessage> {
    match message {
        ServerMessage::RoomTransport {
            room_id,
            topic_secret,
            iroh_relay_url,
            iroh_relay_token,
            host,
            members,
        } => {
            // Before the roster, because dialling a host reachable only through
            // a relay needs that relay usable first. Every broadcast, not just
            // the first: this is also what renews an expiring token.
            let adopted = seat
                .adopt_relay(iroh_relay_url.as_deref(), iroh_relay_token.as_deref())
                .await;
            seat.on_roster(room_id, topic_secret, host.as_ref(), members)
                .await;
            // Announce on the first roster, and again if adopting a relay gave
            // this endpoint an address it did not have when it last announced.
            (!seat.announced() || adopted).then_some(())?;
            Some(ClientMessage::AnnounceTransport {
                endpoint: Some(seat.announce().await),
            })
        }
        // Both ends freeze on the same relay message, which is what lets them
        // agree on the transport for this game without negotiating.
        ServerMessage::GameStarted { .. } => {
            seat.freeze();
            None
        }
        ServerMessage::GameAborted { .. } => {
            seat.clear();
            None
        }
        _ => None,
    }
}

async fn send_seat_message(
    sink: &mut WsSink,
    direct: &mut Option<DirectSeat>,
    message: &ClientMessage,
) -> Result<(), String> {
    if let (Some(seat), ClientMessage::BroadcastState { state, .. }) = (direct.as_mut(), message) {
        if seat.try_send(state) {
            return Ok(());
        }
    }
    send(sink, message).await
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
