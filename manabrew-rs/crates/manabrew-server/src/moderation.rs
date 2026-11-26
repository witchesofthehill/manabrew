use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::Deserialize;
use tracing::{info, warn};

use crate::protocol::ChatMessage;
use crate::state::ServerState;

const RELOAD_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatBan {
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub ip: Option<String>,
    pub reason: String,
    #[serde(default)]
    pub until: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub report: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Redaction {
    pub from: String,
    pub sent_at_ms: u64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ModerationFile {
    #[serde(default)]
    bans: Vec<ChatBan>,
    #[serde(default)]
    redact: Vec<Redaction>,
}

impl ChatBan {
    fn active(&self) -> bool {
        self.until.is_none_or(|until| chrono::Utc::now() < until)
    }

    fn names(&self, username: &str) -> bool {
        self.username
            .as_deref()
            .is_some_and(|name| name.eq_ignore_ascii_case(username))
    }
}

#[derive(Default)]
struct Loaded {
    file: ModerationFile,
    seen: Option<SystemTime>,
}

#[derive(Default)]
pub struct Moderation {
    path: Option<PathBuf>,
    loaded: Mutex<Loaded>,
}

impl Moderation {
    pub fn from_path(path: Option<PathBuf>) -> Self {
        let moderation = Self {
            path,
            loaded: Mutex::default(),
        };
        moderation.reload();
        moderation
    }

    pub fn ban_for(&self, username: &str, ip: &str) -> Option<ChatBan> {
        self.loaded
            .lock()
            .unwrap()
            .file
            .bans
            .iter()
            .find(|ban| ban.active() && (ban.names(username) || ban.ip.as_deref() == Some(ip)))
            .cloned()
    }

    pub fn visible(&self, message: &ChatMessage) -> bool {
        let loaded = self.loaded.lock().unwrap();
        !loaded
            .file
            .bans
            .iter()
            .any(|ban| ban.active() && ban.names(&message.from))
            && !loaded.file.redact.iter().any(|line| {
                line.sent_at_ms == message.sent_at_ms
                    && line.from.eq_ignore_ascii_case(&message.from)
            })
    }

    fn reload(&self) -> bool {
        let Some(path) = &self.path else {
            return false;
        };
        let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok();
        let mut loaded = self.loaded.lock().unwrap();
        if modified == loaded.seen {
            return false;
        }
        loaded.seen = modified;
        if modified.is_none() {
            info!(path = %path.display(), "[moderation] file gone; no bans or redactions");
            *loaded = Loaded::default();
            return true;
        }
        match std::fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|raw| parse(&raw))
        {
            Ok(file) => {
                info!(
                    path = %path.display(),
                    bans = file.bans.len(),
                    redactions = file.redact.len(),
                    "[moderation] loaded"
                );
                loaded.file = file;
                true
            }
            Err(error) => {
                warn!(path = %path.display(), %error, "[moderation] file rejected; keeping the last good list");
                false
            }
        }
    }
}

fn parse(raw: &str) -> Result<ModerationFile, String> {
    let file: ModerationFile = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    if let Some(ban) = file
        .bans
        .iter()
        .find(|ban| ban.username.is_none() && ban.ip.is_none())
    {
        return Err(format!("ban {:?} has no username or ip", ban.reason));
    }
    Ok(file)
}

pub async fn watch(state: Arc<ServerState>) {
    if state.moderation.path.is_none() {
        return;
    }
    let mut tick = tokio::time::interval(RELOAD_INTERVAL);
    loop {
        tick.tick().await;
        if state.moderation.reload() {
            crate::connection::apply_moderation(&state);
        }
    }
}
