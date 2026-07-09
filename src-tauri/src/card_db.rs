use std::sync::{Once, OnceLock};

use forge_carddb::CardDatabase;

#[cfg(not(target_os = "android"))]
use memmap2::Mmap;
#[cfg(not(target_os = "android"))]
use std::path::PathBuf;

static CARD_DB: OnceLock<CardDatabase> = OnceLock::new();
static CARD_NAME_INDEX: OnceLock<std::collections::HashSet<String>> = OnceLock::new();
static DB_INIT: Once = Once::new();

#[cfg(not(target_os = "android"))]
static ARCHIVE_MMAP: OnceLock<Option<Mmap>> = OnceLock::new();

/// Returns the path to the pre-built cardset rkyv archive.
/// Checks `CARDSET_ARCHIVE` env var first; falls back to `resources/cardset.rkyv`
/// adjacent to this crate's manifest (where the build script writes it).
#[cfg(not(target_os = "android"))]
pub fn cardset_archive_path() -> PathBuf {
    if let Ok(path) = std::env::var("CARDSET_ARCHIVE") {
        PathBuf::from(path)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cardset.rkyv")
    }
}

/// Raw bytes of the bundled cardset rkyv archive, shared by the card database
/// and the limited-format edition registry, or `None` if it cannot be opened.
///
/// Desktop and iOS mmap the bundled file once and keep it mapped for the
/// process lifetime. Android's `resource_dir()` is the `asset://` APK URI,
/// which `File::open` cannot open, so the archive is embedded at compile time
/// and returned directly from the binary.
pub fn cardset_archive_bytes() -> Option<&'static [u8]> {
    #[cfg(target_os = "android")]
    {
        Some(include_bytes!("../resources/cardset.rkyv"))
    }
    #[cfg(not(target_os = "android"))]
    {
        ARCHIVE_MMAP
            .get_or_init(|| {
                let path = cardset_archive_path();
                let file = std::fs::File::open(&path)
                    .map_err(|e| eprintln!("[carddb] open {}: {e}", path.display()))
                    .ok()?;
                unsafe { Mmap::map(&file) }
                    .map_err(|e| eprintln!("[carddb] mmap {}: {e}", path.display()))
                    .ok()
            })
            .as_deref()
    }
}

fn ensure_dbs_loaded() {
    DB_INIT.call_once(|| {
        let Some(bytes) = cardset_archive_bytes() else {
            panic!(
                "[carddb] cardset archive unavailable.\n\
                 Run `cargo build -p forge-web` (or `yarn build:wasm`) to rebuild it."
            );
        };
        if let Err(err) = load_dbs_from_bytes(bytes, "cardset.rkyv") {
            panic!("[carddb] Failed to load cardset archive: {err}");
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

/// Parse the archive bytes through `CardDatabase::load_from_archive` and
/// populate `CARD_DB` from the bundle.
fn load_dbs_from_bytes(bytes: &[u8], source: &str) -> Result<(), String> {
    let bundle = CardDatabase::load_from_archive(bytes)?;
    eprintln!(
        "[carddb] Loaded {} cards ({} failed) from {}",
        bundle.cards_result.loaded, bundle.cards_result.failed, source
    );
    let _ = CARD_DB.set(bundle.cards);
    Ok(())
}
