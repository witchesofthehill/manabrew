use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Once, OnceLock};

use forge_carddb::CardDatabase;
use forge_engine_core::card::CardInstance;
use forge_engine_core::ids::PlayerId;
use memmap2::Mmap;

static CARD_DB: OnceLock<CardDatabase> = OnceLock::new();
static TOKEN_DB: OnceLock<CardDatabase> = OnceLock::new();
static TOKEN_IMAGE_MAP: OnceLock<HashMap<String, TokenImageInfo>> = OnceLock::new();
static CARD_NAME_INDEX: OnceLock<std::collections::HashSet<String>> = OnceLock::new();
static DB_INIT: Once = Once::new();

/// Scryfall set code + collector number for a token, derived from edition files.
#[derive(Debug, Clone)]
pub struct TokenImageInfo {
    /// Scryfall token set code (e.g., "thou" for Tokens of Hour of Devastation).
    pub set_code: String,
    /// Collector number within that token set (e.g., "1").
    pub collector_number: String,
}

/// Returns the path to the Forge editions directory.
fn editions_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("EDITIONS_DIR") {
        PathBuf::from(dir)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../forge/forge-gui/res/editions")
    }
}

/// Returns the path to the pre-built cardset rkyv archive.
/// Checks `CARDSET_ARCHIVE` env var first; falls back to `resources/cardset.rkyv`
/// adjacent to this crate's manifest (where the build script writes it).
pub fn cardset_archive_path() -> PathBuf {
    if let Ok(path) = std::env::var("CARDSET_ARCHIVE") {
        PathBuf::from(path)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cardset.rkyv")
    }
}

/// Loads card + token databases on first call.
///
/// The pre-built rkyv archive at `cardset_archive_path()` is mandatory —
/// `src-tauri/build.rs` always rebuilds it when the cardsfolder changes, so
/// it should always be present after a successful build. If it isn't, the
/// process panics with a clear hint rather than silently degrading.
fn ensure_dbs_loaded() {
    DB_INIT.call_once(|| {
        let archive_path = cardset_archive_path();
        if let Err(err) = load_dbs_from_archive(&archive_path) {
            panic!(
                "[carddb] Failed to load cardset archive at {}: {}.\n\
                 Run `cargo build -p forge-web` (or `yarn build:wasm`) to rebuild it.",
                archive_path.display(),
                err
            );
        }
    });
}

pub fn get_card_db() -> &'static CardDatabase {
    ensure_dbs_loaded();
    CARD_DB.get().expect("card db must be initialized")
}

pub fn get_card_name_index() -> &'static std::collections::HashSet<String> {
    CARD_NAME_INDEX.get_or_init(|| {
        // Walk the rkyv archive (or eager cache) for names without parsing
        // any cards — `card_name_known` is hit on every UI deck-validation
        // pass, well before a game starts.
        let db = get_card_db();
        db.iter_card_keys().into_iter().collect()
    })
}

pub fn card_name_known(name: &str) -> bool {
    let index = get_card_name_index();
    if index.contains(&name.to_lowercase()) {
        return true;
    }
    if let Some((front, _)) = name.split_once(" // ") {
        return index.contains(&front.to_lowercase());
    }
    false
}

/// mmap the archive, parse it through `CardDatabase::load_from_archive`,
/// and populate both `CARD_DB` and `TOKEN_DB` from the single bundle.
fn load_dbs_from_archive(archive_path: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| format!("open: {e}"))?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap: {e}"))? };
    let bundle = CardDatabase::load_from_archive(&mmap)?;
    eprintln!(
        "[carddb] Loaded {} cards ({} failed), {} tokens ({} failed) from archive {}",
        bundle.cards_result.loaded,
        bundle.cards_result.failed,
        bundle.tokens_result.loaded,
        bundle.tokens_result.failed,
        archive_path.display()
    );
    let _ = CARD_DB.set(bundle.cards);
    let _ = TOKEN_DB.set(bundle.tokens);
    Ok(())
}

/// Returns the global token-script database, loading it on first call.
///
/// Token scripts live in `forge/forge-gui/res/tokenscripts/` and are keyed
/// by their filename stem (e.g. "r_1_1_goblin" for `r_1_1_goblin.txt`).
pub fn get_token_db() -> &'static CardDatabase {
    ensure_dbs_loaded();
    TOKEN_DB.get().expect("token db must be initialized")
}

/// Returns the global token image mapping, built from edition files on first call.
///
/// Maps token script names (e.g., "w_1_1_spirit_flying") to their Scryfall
/// token set code and collector number (e.g., set="tmid", number="2").
///
/// Scryfall token sets use the convention: "t" + lowercase edition code.
/// For example, Hour of Devastation (HOU) has token set "thou".
pub fn get_token_image_map() -> &'static HashMap<String, TokenImageInfo> {
    TOKEN_IMAGE_MAP.get_or_init(|| {
        let dir = editions_dir();
        eprintln!(
            "[tokendb] Parsing edition files from {:?} for token images …",
            dir
        );
        let map = parse_edition_token_map(&dir);
        eprintln!("[tokendb] Built token image map with {} entries", map.len());
        map
    })
}

/// Parse all edition files to build a mapping from token script name
/// to (scryfall_token_set_code, collector_number).
fn parse_edition_token_map(editions_dir: &PathBuf) -> HashMap<String, TokenImageInfo> {
    let mut map = HashMap::new();

    let entries = match std::fs::read_dir(editions_dir) {
        Ok(e) => e,
        Err(err) => {
            eprintln!("[tokendb] Failed to read editions dir: {}", err);
            return map;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Extract edition code: prefer ScryfallCode, fall back to Code
        let mut code: Option<String> = None;
        let mut scryfall_code: Option<String> = None;
        let mut in_tokens = false;

        for line in content.lines() {
            let line = line.trim();

            if line.starts_with("[") {
                in_tokens = line == "[tokens]";
                continue;
            }

            if !in_tokens {
                if let Some(val) = line.strip_prefix("Code=") {
                    code = Some(val.trim().to_string());
                } else if let Some(val) = line.strip_prefix("ScryfallCode=") {
                    scryfall_code = Some(val.trim().to_string());
                }
                continue;
            }

            // Parse token line: "1 w_4_4_angel_flying @Adi Granov"
            // Format: <collector_number> <script_name> [@artist]
            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() < 2 {
                continue;
            }

            let collector_number = parts[0].trim();
            // The script name may have trailing " @Artist" — strip it
            let script_name = parts[1].split(" @").next().unwrap_or(parts[1]).trim();

            if script_name.is_empty() || collector_number.is_empty() {
                continue;
            }

            // Build Scryfall token set code: "t" + lowercase(scryfall_code or code)
            let edition_code = scryfall_code.as_ref().or(code.as_ref());
            if let Some(ec) = edition_code {
                let token_set_code = format!("t{}", ec.to_lowercase());
                // Only insert if not already present — first edition wins,
                // ensuring we get a valid mapping without overwriting.
                map.entry(script_name.to_string())
                    .or_insert(TokenImageInfo {
                        set_code: token_set_code,
                        collector_number: collector_number.to_string(),
                    });
            }
        }
    }

    map
}

/// Convert an immutable `CardRules` definition into a mutable `CardInstance`
/// ready to be inserted into a game.
///
/// Delegates to `CardInstance::from_rules()` which mirrors Java's
/// `CardFactory.readCard()` + `CardFactoryUtil` intrinsic ability generation.
///
/// The `CardId` inside the returned instance is a placeholder (0); the real
/// ID is assigned by `game.create_card()`.
pub fn card_rules_to_instance(rules: &forge_carddb::CardRules, owner: PlayerId) -> CardInstance {
    CardInstance::from_rules(rules, owner)
}
