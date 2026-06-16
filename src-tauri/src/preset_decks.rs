use std::sync::OnceLock;

use forge_foundation::ZoneType;
use manabrew_agent_interface::deck_dto::{Deck as WireDeck, DeckCard as WireDeckCard};
use manabrew_engine::card::CardInstance;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::PlayerId;
use manabrew_engine::player::RegisteredPlayer;
use manabrew_game_runtime::deck::{
    card_rules_to_instance, deck_zone_for_identity, fallback_deck_zone_for_card, lookup_card_rules,
    register_card_name, PreparedRegisteredPlayer,
};
use serde::{Deserialize, Serialize};

use crate::card_db::get_card_db;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardIdentity {
    pub name: String,
    pub set_code: String,
    pub card_number: String,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub foil: bool,
}

/// Flatten a wire `Deck` into the internal `Vec<CardIdentity>` shape the
/// rest of the Tauri backend (game_manager, engine_backend, …) still
/// speaks. The wire-side `section` tag is gone — we derive it from which
/// pile of the `Deck` each card came from.
pub fn wire_deck_to_identities(deck: &WireDeck) -> Vec<CardIdentity> {
    let mut out: Vec<CardIdentity> = Vec::new();
    let push = |out: &mut Vec<CardIdentity>, list: &[WireDeckCard], section: Option<&str>| {
        for c in list {
            out.push(CardIdentity {
                name: c.identity.name.clone(),
                set_code: c.identity.set_code.clone(),
                card_number: c.identity.card_number.clone(),
                section: section.map(str::to_string),
                foil: c.identity.foil.unwrap_or(false),
            });
        }
    };
    push(&mut out, &deck.cards, Some("main"));
    push(&mut out, &deck.sideboard, Some("sideboard"));
    if let Some(list) = &deck.commanders {
        push(&mut out, list, Some("commander"));
    }
    if let Some(list) = &deck.attractions {
        push(&mut out, list, Some("attractions"));
    }
    if let Some(list) = &deck.contraptions {
        push(&mut out, list, Some("contraptions"));
    }
    if let Some(list) = &deck.schemes {
        push(&mut out, list, Some("schemes"));
    }
    if let Some(list) = &deck.planes {
        push(&mut out, list, Some("planes"));
    }
    out
}

// ── Preset deck registry ───────────────────────────────────────────

/// Metadata for a preset deck, returned to the frontend via `get_preset_decks`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetDeckInfo {
    pub id: String,
    pub label: String,
    pub desc: String,
    /// Tailwind CSS text-color class used for the deck title in the UI.
    pub color: String,
    pub format: String,
    pub commander: Option<String>,
    pub cover_card_name: Option<String>,
    pub cards: Vec<DeckCardEntry>,
}

// ── JSON deck file schema ──────────────────────────────────────────

/// A single card entry in a preset deck JSON file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckCardEntry {
    pub name: String,
    pub count: usize,
    pub set: String,
    pub card_number: String,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

/// Full JSON schema for a preset deck file. `opponent` and `ai_eligible`
/// from older deck files are silently ignored by serde (unknown fields are
/// dropped by default) — those features were removed when the UI took over
/// explicit AI-deck selection.
#[derive(Debug, Clone, Deserialize)]
struct PresetDeckFile {
    label: String,
    desc: String,
    color: String,
    #[serde(default = "default_format")]
    format: String,
    #[serde(default)]
    commander: Option<String>,
    #[serde(default)]
    order: Option<i32>,
    cards: Vec<DeckCardEntry>,
}

fn default_format() -> String {
    "standard".to_string()
}

/// Loaded preset deck with its ID and parsed data.
///
/// `opponent` and `ai_eligible` from the JSON schema are intentionally
/// dropped here — the UI now picks the opponent deck explicitly per game,
/// so neither the auto-opponent inference nor the random-AI fallback path
/// they used to feed exists. The fields are still tolerated in JSON for
/// back-compat (see `#[serde(default)]` on `PresetDeckFile`).
#[derive(Debug, Clone)]
struct LoadedPreset {
    id: String,
    label: String,
    desc: String,
    color: String,
    format: String,
    commander: Option<String>,
    order: i32,
    cards: Vec<DeckCardEntry>,
}

// ── Lazy-loaded deck registry ──────────────────────────────────────

/// Default directory for preset deck JSON files. The web build serves these
/// directly from `public/preset_decks/`; the Tauri shell bundles the same
/// directory so both platforms read the exact same on-disk files.
const DEFAULT_DECKS_DIR: &str = "public/preset_decks";

static DECK_REGISTRY: OnceLock<Vec<LoadedPreset>> = OnceLock::new();

fn get_decks_dir() -> &'static std::path::PathBuf {
    // Resolve path relative to this crate (`src-tauri`) instead of process CWD.
    static DIR: OnceLock<std::path::PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let configured =
            std::env::var("PRESET_DECKS_DIR").unwrap_or_else(|_| DEFAULT_DECKS_DIR.to_string());
        let configured_path = std::path::PathBuf::from(configured);
        if configured_path.is_absolute() {
            configured_path
        } else {
            project_root.join(configured_path)
        }
    })
}

fn load_registry() -> Vec<LoadedPreset> {
    let dir = get_decks_dir();
    let mut presets = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!(
                "[preset_decks] Failed to read directory '{}': {}",
                dir.display(),
                e
            );
            return presets;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // `index.json` is the web-side manifest of available decks, not a
        // deck itself. Skip it during the Tauri directory walk.
        if id == "index" {
            continue;
        }
        let contents = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[preset_decks] Failed to read '{}': {}", path.display(), e);
                continue;
            }
        };
        let deck: PresetDeckFile = match serde_json::from_str(&contents) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[preset_decks] Failed to parse '{}': {}", path.display(), e);
                continue;
            }
        };
        presets.push(LoadedPreset {
            id,
            label: deck.label,
            desc: deck.desc,
            color: deck.color,
            format: deck.format,
            commander: deck.commander,
            order: deck.order.unwrap_or(999),
            cards: deck.cards,
        });
    }

    // Sort by order field to maintain deterministic UI ordering
    presets.sort_by_key(|p| (p.order, p.id.clone()));
    presets
}

fn get_registry() -> &'static Vec<LoadedPreset> {
    DECK_REGISTRY.get_or_init(load_registry)
}

fn get_preset_by_id(id: &str) -> Option<&'static LoadedPreset> {
    get_registry().iter().find(|p| p.id == id)
}

fn choose_cover_card_name(cards: &[DeckCardEntry]) -> Option<String> {
    cards
        .iter()
        .find(|card| {
            !matches!(
                card.name.as_str(),
                "Plains" | "Island" | "Swamp" | "Mountain" | "Forest" | "Wastes"
            )
        })
        .or_else(|| cards.first())
        .map(|card| card.name.clone())
}

// ── Public API ─────────────────────────────────────────────────────

/// Return the ordered list of all available preset decks.
///
/// This is the single source of truth consumed by the `get_preset_decks`
/// Tauri command — the frontend no longer hardcodes deck names.
pub fn list_preset_decks() -> Vec<PresetDeckInfo> {
    get_registry()
        .iter()
        .map(|p| PresetDeckInfo {
            id: p.id.clone(),
            label: p.label.clone(),
            desc: p.desc.clone(),
            color: p.color.clone(),
            format: p.format.clone(),
            commander: p.commander.clone(),
            cover_card_name: choose_cover_card_name(&p.cards),
            cards: p.cards.clone(),
        })
        .collect()
}

pub fn is_preset_id(id: &str) -> bool {
    get_registry().iter().any(|p| p.id == id)
}

/// Build a `RegisteredPlayer` from a preset id. Returns a player with an
/// empty card list if `preset_id` is unknown — the UI is expected to only
/// pass valid ids surfaced through `list_preset_decks`.
pub fn prepare_preset_registered_player(
    name: impl Into<String>,
    preset_id: &str,
) -> PreparedRegisteredPlayer {
    let mut registered = RegisteredPlayer::new(name);
    let cards = match get_preset_by_id(preset_id) {
        Some(preset) => prepare_cards_from_entries(&preset.cards, &mut registered),
        None => {
            eprintln!(
                "[preset_decks] Unknown preset id '{}'; player will start with no deck",
                preset_id
            );
            Vec::new()
        }
    };
    PreparedRegisteredPlayer { registered, cards }
}

// ── Deck builders ──────────────────────────────────────────────────

/// Build a custom deck for `owner` from a list of card identities (one per
/// copy), loading each definition from the global CardDatabase.
/// Unrecognised names are skipped with a log message.
#[allow(dead_code)]
pub fn build_custom_deck(game: &mut GameState, owner: PlayerId, identities: &[CardIdentity]) {
    let db = get_card_db();
    for identity in identities {
        let name = &identity.name;
        match lookup_card_rules(db, name) {
            Some(rules) => {
                let mut card = card_rules_to_instance(rules, owner);
                if !identity.set_code.is_empty() {
                    card.set_code = Some(identity.set_code.clone());
                }
                card.paper_foil = identity.foil;
                let destination = deck_zone_for_identity(identity.section.as_deref(), &card);
                let id = game.create_card(card);
                if destination == ZoneType::Command {
                    game.card_mut(id).is_commander = true;
                }
                game.move_card(id, destination, owner);
            }
            None => eprintln!("[custom_deck] Unknown card '{}' — skipped", name),
        }
    }
}

pub fn prepare_custom_registered_player(
    name: impl Into<String>,
    identities: &[CardIdentity],
) -> PreparedRegisteredPlayer {
    let mut registered = RegisteredPlayer::new(name);
    let cards = prepare_cards_from_identities(identities, &mut registered);
    PreparedRegisteredPlayer { registered, cards }
}

fn prepare_cards_from_entries(
    deck: &[DeckCardEntry],
    registered: &mut RegisteredPlayer,
) -> Vec<(CardInstance, ZoneType)> {
    let db = get_card_db();
    let mut cards = Vec::new();
    for entry in deck {
        match lookup_card_rules(db, &entry.name) {
            Some(rules) => {
                for _ in 0..entry.count {
                    let mut card = card_rules_to_instance(rules, PlayerId(0));
                    if !entry.set.is_empty() {
                        card.set_code = Some(entry.set.clone());
                    }
                    if !entry.card_number.is_empty() {
                        card.card_number = Some(entry.card_number.clone());
                    }
                    let destination = fallback_deck_zone_for_card(&card);
                    register_card_name(registered, &card.card_name, destination);
                    cards.push((card, destination));
                }
            }
            None => eprintln!("[deck] Unknown card '{}' — skipped", entry.name),
        }
    }
    cards
}

fn prepare_cards_from_identities(
    identities: &[CardIdentity],
    registered: &mut RegisteredPlayer,
) -> Vec<(CardInstance, ZoneType)> {
    let db = get_card_db();
    let mut cards = Vec::new();
    for identity in identities {
        match lookup_card_rules(db, &identity.name) {
            Some(rules) => {
                let mut card = card_rules_to_instance(rules, PlayerId(0));
                if !identity.set_code.is_empty() {
                    card.set_code = Some(identity.set_code.clone());
                }
                if !identity.card_number.is_empty() {
                    card.card_number = Some(identity.card_number.clone());
                }
                card.paper_foil = identity.foil;
                let destination = deck_zone_for_identity(identity.section.as_deref(), &card);
                register_card_name(registered, &card.card_name, destination);
                cards.push((card, destination));
            }
            None => eprintln!("[custom_deck] Unknown card '{}' — skipped", identity.name),
        }
    }
    cards
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};
    use manabrew_engine::card::Card;
    use manabrew_engine::ids::CardId;

    #[test]
    fn routes_variant_cards_to_variant_decks() {
        let owner = PlayerId(0);
        let attraction = Card::new(
            CardId(0),
            "Balloon Stand".to_string(),
            owner,
            CardTypeLine::parse("Artifact Attraction"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        let contraption = Card::new(
            CardId(0),
            "Auto-Key".to_string(),
            owner,
            CardTypeLine::parse("Artifact Contraption"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        let normal = Card::new(
            CardId(0),
            "Forest".to_string(),
            owner,
            CardTypeLine::parse("Basic Land Forest"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );

        assert_eq!(
            fallback_deck_zone_for_card(&attraction),
            ZoneType::AttractionDeck
        );
        assert_eq!(
            fallback_deck_zone_for_card(&contraption),
            ZoneType::ContraptionDeck
        );
        assert_eq!(fallback_deck_zone_for_card(&normal), ZoneType::Library);
    }

    #[test]
    fn explicit_section_overrides_fallback_routing() {
        let owner = PlayerId(0);
        let normal = Card::new(
            CardId(0),
            "Forest".to_string(),
            owner,
            CardTypeLine::parse("Basic Land Forest"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        assert_eq!(
            deck_zone_for_identity(Some("sideboard"), &normal,),
            ZoneType::Sideboard
        );
        assert_eq!(
            deck_zone_for_identity(Some("commander"), &normal,),
            ZoneType::Command
        );
    }
}
