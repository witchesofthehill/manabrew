use std::path::PathBuf;
use std::sync::{Once, OnceLock};

use forge_carddb::CardDatabase;
use memmap2::Mmap;

static CARD_DB: OnceLock<CardDatabase> = OnceLock::new();
static CARD_NAME_INDEX: OnceLock<std::collections::HashSet<String>> = OnceLock::new();
static DB_INIT: Once = Once::new();

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

/// Loads the card database on first call.
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
        // pass.
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
/// and populate `CARD_DB` from the bundle.
fn load_dbs_from_archive(archive_path: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| format!("open: {e}"))?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap: {e}"))? };
    let bundle = CardDatabase::load_from_archive(&mmap)?;
    eprintln!(
        "[carddb] Loaded {} cards ({} failed) from archive {}",
        bundle.cards_result.loaded,
        bundle.cards_result.failed,
        archive_path.display()
    );
    let _ = CARD_DB.set(bundle.cards);
    Ok(())
}
