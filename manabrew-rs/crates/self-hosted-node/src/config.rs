use std::env;
use std::path::{Path, PathBuf};

use manabrew_agent_interface::deck_dto::{CardIdentity, Deck, DeckCard};
use manabrew_agent_interface::protocol::GameFormat;
use serde::Deserialize;
use tracing::warn;

use crate::engine_backend::EngineBackendKind;

#[derive(Debug, Clone)]
pub struct Config {
    pub backend: EngineBackendKind,
    pub relay_url: String,
    pub username: String,
    pub password: String,
    pub room_id: Option<String>,
    pub room_name: String,
    pub max_players: u8,
    pub max_games: usize,
    pub format: GameFormat,
    pub auto_start: bool,
    pub engine_enabled: bool,
    pub host_plays: bool,
    pub official_key: Option<String>,
    pub room_password: Option<String>,
    pub bot_enabled: bool,
    pub bot_username: String,
    pub forge_ai: bool,
    pub host_deck: DeckSelection,
    pub bot_deck: DeckSelection,
}

#[derive(Debug, Clone)]
pub struct DeckSelection {
    pub name: String,
    pub deck: Deck,
    pub commander_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PresetDeckFile {
    label: String,
    cards: Vec<PresetDeckCard>,
}

#[derive(Debug, Deserialize)]
struct PresetDeckCard {
    name: String,
    count: usize,
    #[serde(default)]
    set: String,
}

impl Config {
    pub fn from_env() -> Self {
        let username = format!("self-hosted-node-{}", uuid::Uuid::new_v4());
        let bot_username = env_first("SELF_HOSTED_NODE_BOT_USERNAME", "FORGE_ROOM_BOT_USERNAME")
            .unwrap_or_else(|| format!("{username}-bot"));
        let host_deck_id = env_first("SELF_HOSTED_NODE_DECK", "FORGE_ROOM_NODE_DECK")
            .unwrap_or_else(|| "ashling_limitless_commander".into());
        let bot_deck_id = env_first("SELF_HOSTED_NODE_BOT_DECK", "FORGE_ROOM_BOT_DECK")
            .unwrap_or_else(|| "neheb_minotaur_commander".into());
        let host_commander = env_first("SELF_HOSTED_NODE_COMMANDER", "FORGE_ROOM_NODE_COMMANDER")
            .filter(|value| !value.is_empty())
            .or_else(|| infer_commander_name(&host_deck_id).map(str::to_string));
        let bot_commander = env_first("SELF_HOSTED_NODE_BOT_COMMANDER", "FORGE_ROOM_BOT_COMMANDER")
            .filter(|value| !value.is_empty())
            .or_else(|| infer_commander_name(&bot_deck_id).map(str::to_string));

        let room_id = env_first("SELF_HOSTED_NODE_ROOM_ID", "FORGE_ROOM_ID")
            .filter(|value| !value.is_empty());
        let engine_enabled_default = room_id.is_none();

        let format = env_first("SELF_HOSTED_NODE_FORMAT", "FORGE_ROOM_FORMAT")
            .and_then(|value| parse_format(&value))
            .unwrap_or(GameFormat::Any);
        Self {
            backend: EngineBackendKind::from_env(),
            relay_url: env_first("SELF_HOSTED_NODE_RELAY_URL", "FORGE_RELAY_URL")
                .unwrap_or_else(|| "ws://127.0.0.1:9443".to_string()),
            username,
            password: env_first("SELF_HOSTED_NODE_SERVER_KEY", "MANABREW_SERVER_KEY")
                .unwrap_or_else(|| "forge".to_string()),
            room_id,
            room_name: env_first("SELF_HOSTED_NODE_ROOM_NAME", "FORGE_ROOM_NAME")
                .unwrap_or_else(|| "Self-Hosted Node".into()),
            max_players: env_first("SELF_HOSTED_NODE_MAX_PLAYERS", "FORGE_ROOM_MAX_PLAYERS")
                .and_then(|value| value.parse().ok())
                .unwrap_or(4),
            max_games: env_first("SELF_HOSTED_NODE_MAX_GAMES", "FORGE_ROOM_MAX_GAMES")
                .and_then(|value| value.parse().ok())
                .filter(|games| *games >= 1)
                .unwrap_or(1),
            format,
            auto_start: env_bool(
                "SELF_HOSTED_NODE_AUTO_START",
                "FORGE_ROOM_AUTO_START",
                false,
            ),
            engine_enabled: env_bool(
                "SELF_HOSTED_NODE_ENGINE_ENABLED",
                "FORGE_ROOM_ENGINE_ENABLED",
                engine_enabled_default,
            ),
            host_plays: env_bool(
                "SELF_HOSTED_NODE_HOST_PLAYS",
                "FORGE_ROOM_NODE_HOST_PLAYS",
                false,
            ),
            official_key: arg_value("--official")
                .or_else(|| env_first("SELF_HOSTED_NODE_OFFICIAL_KEY", "SECRET_MANABREW_KEY"))
                .filter(|value| !value.is_empty()),
            room_password: arg_value("--password")
                .or_else(|| env_first("SELF_HOSTED_NODE_ROOM_PASSWORD", "FORGE_ROOM_PASSWORD"))
                .filter(|value| !value.is_empty()),
            bot_enabled: env_bool(
                "SELF_HOSTED_NODE_BOT_ENABLED",
                "FORGE_ROOM_BOT_ENABLED",
                false,
            ),
            bot_username,
            forge_ai: env_bool("SELF_HOSTED_NODE_FORGE_AI", "FORGE_ROOM_FORGE_AI", false),
            host_deck: load_deck_selection(&host_deck_id, host_commander),
            bot_deck: load_deck_selection(&bot_deck_id, bot_commander),
        }
    }

    /// Config for an embedded Forge room host (e.g. the Tauri desktop app):
    /// reuse the caller's relay connection, host the engine without taking a
    /// seat, no bot. Deck fields are placeholders — unused when `host_plays` and
    /// `bot_enabled` are false.
    pub fn for_hosted_room(
        relay_url: String,
        password: String,
        room_name: String,
        format: GameFormat,
        max_players: u8,
        room_password: Option<String>,
    ) -> Self {
        let username = format!("forge-host-{}", uuid::Uuid::new_v4());
        let bot_username = format!("{username}-bot");
        Self {
            backend: EngineBackendKind::Forge,
            relay_url,
            username,
            password,
            room_id: None,
            room_name,
            max_players,
            max_games: 1,
            format,
            auto_start: false,
            engine_enabled: true,
            host_plays: false,
            official_key: None,
            room_password,
            bot_enabled: false,
            bot_username,
            forge_ai: false,
            host_deck: synthetic_deck("forge-host", None),
            bot_deck: synthetic_deck("forge-bot", None),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SelfPlayConfig {
    pub seats: Vec<DeckSelection>,
    pub starting_life: i32,
    pub seed: u64,
}

impl SelfPlayConfig {
    pub fn from_env() -> Self {
        let seed = env::var("SELF_HOSTED_NODE_SELF_PLAY_SEED")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(42);
        let starting_life = match env::var("SELF_HOSTED_NODE_SELF_PLAY_FORMAT")
            .ok()
            .and_then(|value| parse_format(&value))
        {
            Some(GameFormat::Commander) => 40,
            _ => 20,
        };

        let base: Vec<DeckSelection> = match env::var("SELF_HOSTED_NODE_SELF_PLAY_DECKS") {
            Ok(ids) if !ids.trim().is_empty() => ids
                .split(',')
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(|id| load_deck_selection(id, infer_commander_name(id).map(str::to_string)))
                .collect(),
            _ => default_self_play_seats(),
        };

        let players = env::var("SELF_HOSTED_NODE_SELF_PLAY_PLAYERS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(base.len())
            .max(2);
        let seats = (0..players).map(|i| base[i % base.len()].clone()).collect();
        Self {
            seats,
            starting_life,
            seed,
        }
    }
}

fn default_self_play_seats() -> Vec<DeckSelection> {
    vec![
        mono_seat("Mountain", "Lightning Bolt"),
        mono_seat("Forest", "Grizzly Bears"),
    ]
}

fn mono_seat(land: &str, spell: &str) -> DeckSelection {
    let card = |name: &str| DeckCard {
        identity: CardIdentity {
            name: name.to_string(),
            ..Default::default()
        },
        ..Default::default()
    };
    let name = format!("{land} / {spell}");
    DeckSelection {
        deck: Deck {
            name: name.clone(),
            cards: (0..24)
                .map(|_| card(land))
                .chain((0..36).map(|_| card(spell)))
                .collect(),
            ..Default::default()
        },
        name,
        commander_name: None,
    }
}

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

fn load_deck_selection(deck_id: &str, commander_name: Option<String>) -> DeckSelection {
    match load_preset_deck(deck_id, commander_name.clone()) {
        Ok(deck) => deck,
        Err(error) => {
            warn!(deck_id, %error, "falling back to synthetic self-hosted-node deck");
            synthetic_deck(deck_id, commander_name)
        }
    }
}

fn load_preset_deck(
    deck_id: &str,
    commander_name: Option<String>,
) -> Result<DeckSelection, Box<dyn std::error::Error + Send + Sync>> {
    let path = preset_decks_dir().join(format!("{deck_id}.json"));
    let contents = std::fs::read_to_string(&path)?;
    let preset: PresetDeckFile = serde_json::from_str(&contents)?;
    let mut cards = Vec::new();
    for entry in preset.cards {
        for _ in 0..entry.count {
            cards.push(DeckCard {
                identity: CardIdentity {
                    name: entry.name.clone(),
                    set_code: entry.set.clone(),
                    ..Default::default()
                },
                ..Default::default()
            });
        }
    }
    let label = preset.label;
    Ok(DeckSelection {
        deck: Deck {
            name: label.clone(),
            cards,
            ..Default::default()
        },
        name: label,
        commander_name,
    })
}

fn preset_decks_dir() -> PathBuf {
    env::var("PRESET_DECKS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("public/preset_decks"))
}

fn synthetic_deck(name: &str, commander_name: Option<String>) -> DeckSelection {
    let cards: Vec<DeckCard> = (0..60)
        .map(|_| DeckCard {
            identity: CardIdentity {
                name: "Mountain".to_string(),
                set_code: "M20".to_string(),
                ..Default::default()
            },
            ..Default::default()
        })
        .collect();
    DeckSelection {
        name: name.to_string(),
        deck: Deck {
            name: name.to_string(),
            cards,
            ..Default::default()
        },
        commander_name,
    }
}

fn infer_commander_name(deck_id: &str) -> Option<&'static str> {
    match deck_id {
        "ashling_limitless_commander" => Some("Ashling, the Limitless"),
        "hearthhull_world_shaper_commander" => Some("Hearthhull, the Worldseed"),
        "kaalia_regression_commander" => Some("Kaalia of the Vast"),
        "neheb_minotaur_commander" => Some("Neheb, the Worthy"),
        "ramses_regression_commander" => Some("Ramses, Assassin Lord"),
        "real_teval_commander" => None,
        _ => None,
    }
}

fn env_first(primary: &str, fallback: &str) -> Option<String> {
    env::var(primary).ok().or_else(|| env::var(fallback).ok())
}

fn arg_value(flag: &str) -> Option<String> {
    let prefix = format!("{flag}=");
    let mut args = env::args();
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix(&prefix) {
            return Some(value.to_string());
        }
        if arg == flag {
            return args.next();
        }
    }
    None
}

fn env_bool(primary: &str, fallback: &str, default: bool) -> bool {
    env_first(primary, fallback)
        .and_then(|value| match value.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        })
        .unwrap_or(default)
}

fn parse_format(value: &str) -> Option<GameFormat> {
    let mut chars = value.trim().chars();
    let first = chars.next()?;
    let mut canonical = first.to_ascii_uppercase().to_string();
    canonical.extend(chars.map(|c| c.to_ascii_lowercase()));
    serde_json::from_value(serde_json::Value::String(canonical)).ok()
}
