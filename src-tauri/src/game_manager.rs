use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;
use tauri::AppHandle;

use crate::engine_backend::{java_backend, rust_backend, EngineBackendKind};
use crate::multiplayer_controller::{
    parse_remote_response, spawn_engine_prompt_forwarder, spawn_notify_forwarder,
    spawn_remote_prompt_forwarder, spawn_snapshot_forwarder,
};
use crate::preset_decks::CardIdentity;
use forge_agent_interface::game_log_event::GameLogEntryDto;
use forge_agent_interface::game_snapshot_event::GameSnapshotEventDto;
use forge_agent_interface::ids_codec::player_slot;
use forge_agent_interface::prompt::{AgentMessage, AgentPrompt, PlayerAction};

const GAME_THREAD_STACK_SIZE: usize = 64 * 1024 * 1024;

pub struct GameManager {
    pub session: Mutex<Option<GameSession>>,
    pub latest_prompt: Arc<Mutex<Option<AgentPrompt>>>,
    pub latest_prompt_payload: Arc<Mutex<Option<Value>>>,
}

pub struct GameSession {
    #[allow(dead_code)]
    pub game_id: String,
    pub response_tx: Option<mpsc::Sender<PlayerAction>>,
    /// Per-remote-player response channels (player_index -> sender).
    pub remote_response_txs: HashMap<usize, mpsc::Sender<PlayerAction>>,
    #[allow(dead_code)]
    pub thread_handle: Option<thread::JoinHandle<()>>,
    pub is_multiplayer: bool,
    pub is_host: bool,
    /// Cooperative abort flag shared with the Rust game thread's `GameLoop`.
    pub abort_signal: Arc<AtomicBool>,
}

impl GameManager {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            latest_prompt: Arc::new(Mutex::new(None)),
            latest_prompt_payload: Arc::new(Mutex::new(None)),
        }
    }

    pub fn get_latest_prompt_payload(&self) -> Option<Value> {
        self.latest_prompt_payload
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .or_else(|| {
                self.latest_prompt.lock().ok().and_then(|g| {
                    g.as_ref()
                        .and_then(|prompt| serde_json::to_value(prompt).ok())
                })
            })
    }

    pub fn start_game(
        &self,
        app: AppHandle,
        deck_list: Vec<CardIdentity>,
        starting_life: i32,
        commander_name: Option<String>,
        opponent_deck_list: Option<Vec<CardIdentity>>,
    ) -> Result<String, String> {
        let mut session_guard = self.session.lock().map_err(|e| e.to_string())?;

        if let Some(old) = session_guard.take() {
            old.abort_signal.store(true, Ordering::Relaxed);
            drop(old.response_tx);
            drop(old.remote_response_txs);
        }
        self.clear_latest_prompt();

        let game_id = format!("game-{}", uuid_simple());
        let game_id_clone = game_id.clone();
        let deck = deck_list;
        let backend = EngineBackendKind::from_env();
        if !backend.is_supported() {
            java_backend::JavaRuntimeConfig::from_env().validate()?;
            return Err(java_backend::unsupported_error());
        }

        let (prompt_tx, prompt_rx) = mpsc::channel::<AgentMessage>();
        let (response_tx, response_rx) = mpsc::channel::<PlayerAction>();
        let (notify_tx, notify_rx) = mpsc::channel::<GameLogEntryDto>();
        let (snapshot_tx, snapshot_rx) = mpsc::channel::<GameSnapshotEventDto>();

        let response_tx_clone = response_tx.clone();
        let abort_signal = Arc::new(AtomicBool::new(false));
        let abort_signal_for_thread = abort_signal.clone();

        spawn_engine_prompt_forwarder(
            app.clone(),
            self.latest_prompt.clone(),
            self.latest_prompt_payload.clone(),
            prompt_rx,
        );
        spawn_notify_forwarder(app.clone(), notify_rx, None);
        spawn_snapshot_forwarder(app.clone(), snapshot_rx, None);

        let handle = thread::Builder::new()
            .name(format!("game-thread-{}", game_id))
            .stack_size(GAME_THREAD_STACK_SIZE)
            .spawn(move || {
                eprintln!(
                    "[game_thread] Starting game: {} with backend={} deck={:?}",
                    game_id_clone,
                    backend.label(),
                    deck
                );
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match backend {
                        EngineBackendKind::Manabrew => rust_backend::run_game(
                            game_id_clone.clone(),
                            deck,
                            starting_life,
                            commander_name,
                            opponent_deck_list,
                            prompt_tx,
                            response_rx,
                            notify_tx,
                            snapshot_tx,
                            abort_signal_for_thread,
                        ),
                        EngineBackendKind::Forge => java_backend::run_game(
                            game_id_clone.clone(),
                            deck,
                            starting_life,
                            commander_name,
                            opponent_deck_list,
                            prompt_tx,
                            response_rx,
                        ),
                    }));
                match result {
                    Ok(()) => eprintln!("[game_thread] Game {} finished normally", game_id_clone),
                    Err(e) => {
                        let msg = if let Some(s) = e.downcast_ref::<String>() {
                            s.clone()
                        } else if let Some(s) = e.downcast_ref::<&str>() {
                            s.to_string()
                        } else {
                            "Unknown panic".to_string()
                        };
                        eprintln!("[game_thread] PANIC in game {}: {}", game_id_clone, msg);
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn game thread: {}", e))?;

        *session_guard = Some(GameSession {
            game_id: game_id.clone(),
            response_tx: Some(response_tx_clone),
            remote_response_txs: HashMap::new(),
            thread_handle: Some(handle),
            is_multiplayer: false,
            is_host: true,
            abort_signal,
        });

        Ok(game_id)
    }

    pub fn respond(&self, action: PlayerAction) -> Result<(), String> {
        let session_guard = self.session.lock().map_err(|e| e.to_string())?;
        if let Some(session) = session_guard.as_ref() {
            if let Some(tx) = session.response_tx.as_ref() {
                tx.send(action)
                    .map_err(|e| format!("Game thread not responding: {}", e))?;
                Ok(())
            } else {
                Err("No active game response channel".into())
            }
        } else {
            Err("No active game session".into())
        }
    }

    pub fn end_game(&self) -> Result<(), String> {
        let mut session_guard = self.session.lock().map_err(|e| e.to_string())?;
        if let Some(session) = session_guard.take() {
            session.abort_signal.store(true, Ordering::Relaxed);
            drop(session.response_tx);
            drop(session.remote_response_txs);
        }
        self.clear_latest_prompt();
        Ok(())
    }

    pub fn start_multiplayer_game(
        &self,
        app: AppHandle,
        player_names: Vec<String>,
        deck_lists: Vec<Vec<CardIdentity>>,
        commander_names: Vec<Option<String>>,
        engine_player_index: usize,
        local_is_host: bool,
        starting_life: i32,
    ) -> Result<String, String> {
        let num_players = player_names.len();
        if num_players < 2 {
            return Err("Need at least 2 players".into());
        }
        if engine_player_index >= num_players {
            return Err("Invalid engine player index".into());
        }
        if deck_lists.len() != num_players {
            return Err("Deck list count must match player count".into());
        }
        if commander_names.len() != num_players {
            return Err("Commander list count must match player count".into());
        }
        if deck_lists.iter().any(|deck| deck.is_empty()) {
            return Err("All players must have a selected deck".into());
        }

        let mut session_guard = self.session.lock().map_err(|e| e.to_string())?;

        if let Some(old) = session_guard.take() {
            old.abort_signal.store(true, Ordering::Relaxed);
            drop(old.response_tx);
            drop(old.remote_response_txs);
        }
        self.clear_latest_prompt();

        if !local_is_host {
            return Ok("relay-only".into());
        }

        let game_id = format!("game-{}", uuid_simple());
        let game_id_clone = game_id.clone();
        let backend = EngineBackendKind::from_env();
        if !backend.is_supported() || matches!(backend, EngineBackendKind::Forge) {
            java_backend::JavaRuntimeConfig::from_env().validate()?;
            return Err("Tauri multiplayer java-forge dispatch is not wired yet".to_string());
        }

        let (engine_prompt_tx, engine_prompt_rx) = mpsc::channel::<AgentMessage>();
        let (engine_response_tx, engine_response_rx) = mpsc::channel::<PlayerAction>();
        let (engine_notify_tx, notify_rx) = mpsc::channel::<GameLogEntryDto>();
        let (engine_snapshot_tx, snapshot_rx) = mpsc::channel::<GameSnapshotEventDto>();

        let engine_response_tx_clone = engine_response_tx.clone();
        let (remote_prompt_tx, remote_prompt_rx) = mpsc::channel::<(usize, AgentMessage)>();
        let mut remote_response_txs: HashMap<usize, mpsc::Sender<PlayerAction>> = HashMap::new();
        let mut remote_response_rxs: Vec<(usize, mpsc::Receiver<PlayerAction>)> = Vec::new();

        for i in 0..num_players {
            if i != engine_player_index {
                let (resp_tx, resp_rx) = mpsc::channel::<PlayerAction>();
                remote_response_txs.insert(i, resp_tx);
                remote_response_rxs.push((i, resp_rx));
            }
        }

        let game_engine_prompt_tx = engine_prompt_tx.clone();
        let game_remote_prompt_tx = remote_prompt_tx.clone();
        drop(engine_prompt_tx);
        drop(remote_prompt_tx);

        spawn_engine_prompt_forwarder(
            app.clone(),
            self.latest_prompt.clone(),
            self.latest_prompt_payload.clone(),
            engine_prompt_rx,
        );
        spawn_notify_forwarder(
            app.clone(),
            notify_rx,
            Some(player_slot(engine_player_index)),
        );
        spawn_snapshot_forwarder(
            app.clone(),
            snapshot_rx,
            Some(player_slot(engine_player_index)),
        );
        spawn_remote_prompt_forwarder(app.clone(), remote_prompt_rx);

        let player_name_strs = player_names.clone();
        let selected_deck_lists = deck_lists.clone();
        let selected_commander_names = commander_names.clone();
        let abort_signal = Arc::new(AtomicBool::new(false));
        let abort_signal_for_thread = abort_signal.clone();
        let handle = thread::Builder::new()
            .name(format!("game-thread-{}", game_id))
            .stack_size(GAME_THREAD_STACK_SIZE)
            .spawn(move || {
                eprintln!(
                    "[game_thread] Starting multiplayer game: {} with backend={} players={}",
                    game_id_clone,
                    backend.label(),
                    num_players
                );
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match backend {
                        EngineBackendKind::Manabrew => rust_backend::run_multiplayer_game(
                            game_id_clone.clone(),
                            player_name_strs,
                            selected_deck_lists,
                            selected_commander_names,
                            engine_player_index,
                            starting_life,
                            game_engine_prompt_tx,
                            engine_response_rx,
                            engine_notify_tx,
                            engine_snapshot_tx,
                            game_remote_prompt_tx,
                            remote_response_rxs,
                            abort_signal_for_thread,
                        ),
                        EngineBackendKind::Forge => {
                            unreachable!("unsupported backend rejected before thread start")
                        }
                    }));
                match result {
                    Ok(()) => eprintln!("[game_thread] Game {} finished normally", game_id_clone),
                    Err(e) => {
                        let msg = if let Some(s) = e.downcast_ref::<String>() {
                            s.clone()
                        } else if let Some(s) = e.downcast_ref::<&str>() {
                            s.to_string()
                        } else {
                            "Unknown panic".to_string()
                        };
                        eprintln!("[game_thread] PANIC in game {}: {}", game_id_clone, msg);
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn game thread: {}", e))?;

        *session_guard = Some(GameSession {
            game_id: game_id.clone(),
            response_tx: Some(engine_response_tx_clone),
            remote_response_txs,
            thread_handle: Some(handle),
            is_multiplayer: true,
            is_host: local_is_host,
            abort_signal,
        });

        Ok(game_id)
    }

    pub fn route_remote_response(&self, state: &serde_json::Value) {
        let (player_index, action) = match parse_remote_response(state) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[route] {}", e);
                return;
            }
        };

        let session_guard = match self.session.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        if let Some(session) = session_guard.as_ref() {
            if let Some(tx) = session.remote_response_txs.get(&player_index) {
                if let Err(e) = tx.send(action) {
                    eprintln!("[route] Failed to send to player {}: {}", player_index, e);
                }
            } else {
                eprintln!("[route] No channel for player index {}", player_index);
            }
        }
    }

    pub fn restore_snapshot(&self, checkpoint_id: u64) -> Result<(), String> {
        let session_guard = self.session.lock().map_err(|e| e.to_string())?;
        if let Some(session) = session_guard.as_ref() {
            if session.is_multiplayer && !session.is_host {
                return Err("Only the host can restore snapshots".into());
            }
            session
                .response_tx
                .as_ref()
                .ok_or_else(|| "Restore snapshots are not supported by java-forge yet".to_string())?
                .send(PlayerAction::RestoreSnapshot { checkpoint_id })
                .map_err(|e| format!("Game thread not responding: {}", e))?;
            Ok(())
        } else {
            Err("No active game session".into())
        }
    }

    fn clear_latest_prompt(&self) {
        if let Ok(mut lp) = self.latest_prompt.lock() {
            *lp = None;
        }
        if let Ok(mut lp) = self.latest_prompt_payload.lock() {
            *lp = None;
        }
    }
}

fn uuid_simple() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("{:08x}{:08x}", rng.gen::<u32>(), rng.gen::<u32>())
}
