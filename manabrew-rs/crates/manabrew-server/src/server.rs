use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::{response::Json, routing::get, Router};
use serde_json::{json, Value};
use socket2::{SockRef, TcpKeepalive};
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::cleanup::cleanup_loop;
use crate::connection::handle_connection;
use crate::protocol::ServerMessage;
use crate::state::ServerState;

const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);
const SHUTDOWN_RECONNECT_HINT_S: u32 = 5;

pub async fn run_server(state: Arc<ServerState>, addr: SocketAddr, health_addr: SocketAddr) {
    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind to address");

    info!("[server] Forge Server listening on ws://{}", addr);
    info!("[server] Server key: {}", mask_key(&state.server_key));
    info!("[server] Max rooms: {}", state.max_rooms);

    let shutdown = Arc::new(Notify::new());

    tokio::spawn(cleanup_loop(state.clone()));
    tokio::spawn(run_health_listener(state.clone(), health_addr));
    tokio::spawn(wait_for_shutdown_signal(shutdown.clone()));

    let accept = accept_loop(state.clone(), listener, shutdown.clone());

    tokio::select! {
        _ = accept => {}
        _ = shutdown.notified() => {
            info!("[server] shutdown signal received — draining");
        }
    }

    drain_and_exit(state).await;
}

async fn accept_loop(state: Arc<ServerState>, listener: TcpListener, shutdown: Arc<Notify>) {
    loop {
        tokio::select! {
            res = listener.accept() => match res {
                Ok((stream, peer_addr)) => {
                    debug!("[server] accepted connection from {}", peer_addr);
                    apply_tcp_keepalive(&stream, peer_addr);
                    let state = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, peer_addr, state).await {
                            error!("[server] connection error from {}: {}", peer_addr, e);
                        }
                    });
                }
                Err(e) => {
                    error!("[server] accept error: {}", e);
                }
            },
            _ = shutdown.notified() => {
                info!("[server] accept loop stopping");
                return;
            }
        }
    }
}

fn apply_tcp_keepalive(stream: &tokio::net::TcpStream, peer_addr: SocketAddr) {
    let keepalive = TcpKeepalive::new()
        .with_time(Duration::from_secs(30))
        .with_interval(Duration::from_secs(10));
    if let Err(e) = SockRef::from(stream).set_tcp_keepalive(&keepalive) {
        warn!(
            "[server] failed to enable TCP keepalive on {}: {}",
            peer_addr, e
        );
    }
}

async fn wait_for_shutdown_signal(shutdown: Arc<Notify>) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                warn!("[server] failed to install SIGTERM handler: {}", e);
                return;
            }
        };
        let mut int = match signal(SignalKind::interrupt()) {
            Ok(s) => s,
            Err(e) => {
                warn!("[server] failed to install SIGINT handler: {}", e);
                return;
            }
        };
        tokio::select! {
            _ = term.recv() => info!("[server] SIGTERM received"),
            _ = int.recv()  => info!("[server] SIGINT received"),
        }
    }
    #[cfg(not(unix))]
    {
        if let Err(e) = tokio::signal::ctrl_c().await {
            warn!("[server] ctrl_c handler error: {}", e);
            return;
        }
        info!("[server] ctrl_c received");
    }
    shutdown.notify_waiters();
}

async fn drain_and_exit(state: Arc<ServerState>) {
    let msg = ServerMessage::ServerShuttingDown {
        reconnect_in_s: SHUTDOWN_RECONNECT_HINT_S,
    };
    let json = match serde_json::to_string(&msg) {
        Ok(s) => s,
        Err(e) => {
            error!("[server] failed to serialize shutdown message: {}", e);
            return;
        }
    };

    let mut notified = 0usize;
    for entry in state.players.iter() {
        let player = entry.value();
        if !player.connected {
            continue;
        }
        if player.sender.send(Message::Text(json.clone())).is_ok() {
            notified += 1;
        }
    }
    info!(
        "[server] broadcast ServerShuttingDown to {} players",
        notified
    );

    tokio::time::sleep(SHUTDOWN_GRACE).await;
    info!("[server] shutdown grace elapsed — exiting");
}

async fn run_health_listener(state: Arc<ServerState>, addr: SocketAddr) {
    let app = Router::new()
        .route("/health", get(health_handler))
        .with_state(state);

    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            error!("[server] failed to bind health listener on {}: {}", addr, e);
            return;
        }
    };
    info!("[server] health endpoint on http://{}/health", addr);

    if let Err(e) = axum::serve(listener, app).await {
        error!("[server] health listener stopped: {}", e);
    }
}

async fn health_handler(
    axum::extract::State(state): axum::extract::State<Arc<ServerState>>,
) -> Json<Value> {
    let connected_players = state.players.iter().filter(|e| e.value().connected).count();
    Json(json!({
        "status": "ok",
        "rooms": state.rooms.len(),
        "connected_players": connected_players,
        "uptime_s": uptime_secs(),
    }))
}

fn uptime_secs() -> u64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs()
}

fn mask_key(key: &str) -> String {
    if key.len() <= 2 {
        "*".repeat(key.len())
    } else {
        format!(
            "{}{}{}",
            &key[..1],
            "*".repeat(key.len() - 2),
            &key[key.len() - 1..]
        )
    }
}
