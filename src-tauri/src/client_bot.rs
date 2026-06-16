use std::sync::Mutex;

use manabot::{run_bot, BotConfig};
use tauri::async_runtime::JoinHandle;

pub struct ClientBotManager {
    bots: Mutex<Vec<BotEntry>>,
}

struct BotEntry {
    username: String,
    handle: JoinHandle<()>,
}

impl ClientBotManager {
    pub fn new() -> Self {
        Self {
            bots: Mutex::new(Vec::new()),
        }
    }

    pub fn spawn_bot(&self, relay_url: String, config: BotConfig) -> Result<(), String> {
        let bot_username = config.username.clone();
        let bot_username_for_log = bot_username.clone();
        let handle = tauri::async_runtime::spawn(async move {
            if let Err(error) = run_bot(relay_url, config).await {
                eprintln!(
                    "[client_bot] bot '{}' exited: {}",
                    bot_username_for_log, error
                );
            }
        });
        let mut bots = self.bots.lock().map_err(|e| e.to_string())?;
        bots.push(BotEntry {
            username: bot_username,
            handle,
        });
        Ok(())
    }

    pub fn stop_bot(&self, username: &str) -> bool {
        let mut bots = match self.bots.lock() {
            Ok(b) => b,
            Err(_) => return false,
        };
        if let Some(idx) = bots.iter().position(|b| b.username == username) {
            let entry = bots.remove(idx);
            entry.handle.abort();
            true
        } else {
            false
        }
    }

    pub fn stop_all(&self) {
        if let Ok(mut bots) = self.bots.lock() {
            for entry in bots.drain(..) {
                entry.handle.abort();
            }
        }
    }
}
