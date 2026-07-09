use std::path::Path;

use manabrew_game_runtime::deck::DeckCardIdentity;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
struct CardEntry {
    name: String,
    #[serde(default)]
    set_code: String,
    #[serde(default = "one")]
    count: u32,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DeckSelectedEvent {
    event: String,
    #[serde(default)]
    ts: String,
    #[serde(default)]
    room_id: Option<String>,
    #[serde(default)]
    username: String,
    #[serde(default)]
    cards: Vec<CardEntry>,
}

pub struct Selections {
    events: Vec<DeckSelectedEvent>,
}

impl Selections {
    pub fn load(path: &Path) -> Result<Self, String> {
        let mut files: Vec<std::path::PathBuf> = Vec::new();
        if path.is_dir() {
            let entries = std::fs::read_dir(path).map_err(|e| format!("read dir {path:?}: {e}"))?;
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    files.push(p);
                }
            }
        } else {
            files.push(path.to_path_buf());
        }
        files.sort();

        let mut events = Vec::new();
        for file in files {
            let text = std::fs::read_to_string(&file).map_err(|e| format!("read {file:?}: {e}"))?;
            for line in text.lines() {
                let Ok(event) = serde_json::from_str::<DeckSelectedEvent>(line) else {
                    continue;
                };
                if event.event == "deck_selected" {
                    events.push(event);
                }
            }
        }
        Ok(Self { events })
    }

    pub fn deck_for(
        &self,
        room_id: Option<&str>,
        username: &str,
        game_ts: Option<&str>,
    ) -> Option<Vec<DeckCardIdentity>> {
        let selected = self
            .events
            .iter()
            .filter(|e| e.username == username)
            .filter(|e| room_id.is_none() || e.room_id.as_deref() == room_id)
            .filter(|e| match game_ts {
                Some(ts) => e.ts.as_str() <= ts,
                None => true,
            })
            .max_by(|a, b| a.ts.cmp(&b.ts))
            .or_else(|| {
                self.events
                    .iter()
                    .filter(|e| e.username == username)
                    .filter(|e| room_id.is_none() || e.room_id.as_deref() == room_id)
                    .max_by(|a, b| a.ts.cmp(&b.ts))
            })?;

        let mut identities = Vec::new();
        for card in &selected.cards {
            for _ in 0..card.count.max(1) {
                identities.push(DeckCardIdentity {
                    name: card.name.clone(),
                    set_code: card.set_code.clone(),
                    card_number: String::new(),
                    section: Some("main".to_string()),
                });
            }
        }
        if identities.is_empty() {
            return None;
        }
        Some(identities)
    }
}
