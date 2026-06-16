//! Card database loading for WASM.
//!

use std::sync::OnceLock;

use forge_carddb::CardDatabase;
use forge_foundation::edition::EditionsRegistry;
use forge_limited::bootstrap::build_registry;
use wasm_bindgen::prelude::*;

/// The global card database, populated by `load_card_archive`.
static CARD_DB: OnceLock<CardDatabase> = OnceLock::new();
/// The global token-script database, populated alongside `CARD_DB` from the
/// unified archive.
static TOKEN_DB: OnceLock<CardDatabase> = OnceLock::new();
static EDITIONS: OnceLock<EditionsRegistry> = OnceLock::new();

/// A card entry inside a deck list, post-conversion from `JsDeckCard`.
pub struct DeckCard {
    pub name: String,
    pub count: usize,
    pub set_code: String,
    pub card_number: String,
}

/// Load the card + token + edition database from a single rkyv archive.
///
#[wasm_bindgen]
pub fn load_card_archive(bytes: &[u8]) -> Result<u64, JsError> {
    if CARD_DB.get().is_some() {
        return Err(JsError::new("Card database already initialized"));
    }

    web_sys::console::log_1(
        &format!(
            "[card_loader] Loading rkyv archive ({:.2} MiB) …",
            bytes.len() as f64 / 1024.0 / 1024.0
        )
        .into(),
    );

    // `load_from_archive` copies into an `AlignedVec` itself — we just hand
    // it the raw `Uint8Array` view.
    let bundle = CardDatabase::load_from_archive(bytes)
        .map_err(|e| JsError::new(&format!("Failed to load archive: {e}")))?;

    let cards_loaded = bundle.cards_result.loaded as u32;
    let tokens_loaded = bundle.tokens_result.loaded as u32;

    if bundle.cards_result.failed > 0 {
        web_sys::console::warn_1(
            &format!(
                "[card_loader] {} cards failed to parse",
                bundle.cards_result.failed
            )
            .into(),
        );
        for (file, err) in bundle.cards_result.errors.iter().take(5) {
            web_sys::console::warn_1(&format!("  - {}: {}", file, err).into());
        }
    }

    CARD_DB
        .set(bundle.cards)
        .map_err(|_| JsError::new("Card database already initialized"))?;
    TOKEN_DB
        .set(bundle.tokens)
        .map_err(|_| JsError::new("Token database already initialized"))?;

    if let Some(archive) = CARD_DB.get().and_then(|db| db.archive()) {
        let editions: Vec<(&str, &str)> = archive
            .editions
            .iter()
            .map(|e| (e.name.as_str(), e.raw.as_str()))
            .collect();
        let block_data: Vec<(&str, &str)> = archive
            .block_data
            .iter()
            .map(|b| (b.name.as_str(), b.raw.as_str()))
            .collect();
        let card_db = CARD_DB.get().expect("just set");
        let (registry, report) = build_registry(
            editions.iter().copied(),
            block_data.iter().copied(),
            |code, entry| {
                let mut pc = forge_foundation::sealed_product::PaperCard::new(
                    &entry.name,
                    code,
                    &entry.collector_number,
                    entry.rarity,
                );
                if let Some(rules) = card_db.get(&entry.name) {
                    pc = pc
                        .with_colors(rules.color())
                        .with_double_faced(rules.split_type.is_dual_faced());
                }
                pc
            },
        );
        let _ = EDITIONS.set(registry);
        web_sys::console::log_1(
            &format!(
                "[card_loader] Limited registry ready · {} editions ({} failed), templates: {}",
                report.editions_loaded,
                report.editions_failed,
                if report.booster_templates_loaded {
                    "yes"
                } else {
                    "no"
                }
            )
            .into(),
        );
    }

    web_sys::console::log_1(
        &format!(
            "[card_loader] Loaded {} cards, {} tokens from archive",
            cards_loaded, tokens_loaded
        )
        .into(),
    );

    Ok(((cards_loaded as u64) << 32) | (tokens_loaded as u64))
}

pub fn get_editions() -> Option<&'static EditionsRegistry> {
    EDITIONS.get()
}

/// Check if the card database is loaded.
#[wasm_bindgen]
pub fn is_card_db_loaded() -> bool {
    CARD_DB.get().is_some()
}

/// Get the number of cards in the database.
#[wasm_bindgen]
pub fn get_card_count() -> u32 {
    CARD_DB.get().map(|db| db.len() as u32).unwrap_or(0)
}

/// Get the card database (internal use).
pub fn get_card_db() -> Option<&'static CardDatabase> {
    CARD_DB.get()
}

#[wasm_bindgen]
pub fn is_token_db_loaded() -> bool {
    TOKEN_DB.get().is_some()
}

#[wasm_bindgen]
pub fn get_token_count() -> u32 {
    TOKEN_DB.get().map(|db| db.len() as u32).unwrap_or(0)
}

pub fn get_token_db() -> Option<&'static CardDatabase> {
    TOKEN_DB.get()
}

/// Look up a card by name to verify it exists.
#[wasm_bindgen]
pub fn has_card(name: &str) -> bool {
    CARD_DB
        .get()
        .map(|db| db.get_by_card_name(name).is_some())
        .unwrap_or(false)
}
