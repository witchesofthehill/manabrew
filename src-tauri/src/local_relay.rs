use serde::Serialize;
use tauri::State;

#[cfg(feature = "forge-room")]
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize)]
pub struct LocalRelayInfo {
    pub host: String,
    pub port: u16,
    pub password: String,
}

#[cfg(feature = "forge-room")]
struct RunningRelay {
    info: LocalRelayInfo,
    shutdown: Arc<tokio::sync::Notify>,
    handle: tauri::async_runtime::JoinHandle<()>,
}

/// Holds the loopback relay this app is running (one at a time), so Forge
/// play-vs-AI works without an external relay: the self-hosted-node host and
/// the webview relay client both connect to it on 127.0.0.1.
#[derive(Default)]
pub struct LocalRelayHost {
    #[cfg(feature = "forge-room")]
    running: Mutex<Option<RunningRelay>>,
}

impl LocalRelayHost {
    pub fn new() -> Self {
        Self::default()
    }
}

#[tauri::command]
pub async fn start_local_relay(relay: State<'_, LocalRelayHost>) -> Result<LocalRelayInfo, String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = relay;
        Err("this desktop build was not compiled with the forge-room feature".to_string())
    }
    #[cfg(feature = "forge-room")]
    {
        if let Some(running) = relay.running.lock().map_err(|e| e.to_string())?.as_ref() {
            return Ok(running.info.clone());
        }

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("failed to bind the local relay: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        use rand::{distributions::Alphanumeric, Rng};
        let password: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();

        let state = Arc::new(manabrew_server::state::ServerState::new(
            password.clone(),
            4,
            None,
            manabrew_server::analytics::AnalyticsHandle::disabled(),
        ));
        let shutdown = Arc::new(tokio::sync::Notify::new());
        let health_addr = std::net::SocketAddr::from(([127, 0, 0, 1], 0));
        let handle = tauri::async_runtime::spawn(manabrew_server::server::serve(
            state,
            listener,
            health_addr,
            manabrew_server::metrics::detached_handle(),
            shutdown.clone(),
        ));

        let info = LocalRelayInfo {
            host: "127.0.0.1".to_string(),
            port,
            password,
        };
        let mut guard = relay.running.lock().map_err(|e| e.to_string())?;
        if let Some(running) = guard.as_ref() {
            shutdown.notify_waiters();
            handle.abort();
            return Ok(running.info.clone());
        }
        *guard = Some(RunningRelay {
            info: info.clone(),
            shutdown,
            handle,
        });
        Ok(info)
    }
}

#[tauri::command]
pub async fn stop_local_relay(relay: State<'_, LocalRelayHost>) -> Result<(), String> {
    #[cfg(not(feature = "forge-room"))]
    {
        let _ = relay;
    }
    #[cfg(feature = "forge-room")]
    {
        if let Some(running) = relay.running.lock().map_err(|e| e.to_string())?.take() {
            running.shutdown.notify_waiters();
            running.handle.abort();
        }
    }
    Ok(())
}
