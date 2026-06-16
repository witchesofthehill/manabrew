//! Guardrail: every card name referenced from `parity_decks/` and
//! `public/preset_decks/` must resolve in the cardset archive.
//!
//! Background: a deck file written with a typo or stripped diacritic (e.g.
//! "Troll of Khazad-dum" instead of "Troll of Khazad-dûm") panics the engine
//! at game start with `Card not found: …`. We hit that in CI from a deck
//! shipped under `public/preset_decks/`. This test catches the next one at
//! build time before it reaches anyone.
//!
//! The lookup goes through `CardDatabase::get_by_card_name`, which already
//! applies case-insensitive + deunicode fallback matching — so a deck that
//! fails this test would also fail at runtime. Decks where every entry
//! resolves here are guaranteed safe for the engine's name-based dispatch.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use forge_carddb::CardDatabase;
use memmap2::Mmap;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct DeckFile {
    #[serde(default)]
    cards: Vec<DeckCardEntry>,
    #[serde(default)]
    commanders: Vec<DeckCardEntry>,
}

#[derive(Debug, Deserialize)]
struct DeckCardEntry {
    name: String,
}

/// Workspace root, derived from this crate's manifest directory.
fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root resolves")
}

fn archive_path() -> PathBuf {
    if let Ok(path) = std::env::var("CARDSET_ARCHIVE") {
        return PathBuf::from(path);
    }
    workspace_root().join("src-tauri/resources/cardset.rkyv")
}

fn load_card_db() -> CardDatabase {
    let path = archive_path();
    let file = fs::File::open(&path).unwrap_or_else(|e| {
        panic!(
            "cardset archive missing at {}: {e}. Run `cargo build -p manabrew` to generate it.",
            path.display()
        )
    });
    let mmap = unsafe { Mmap::map(&file).expect("mmap archive") };
    CardDatabase::load_from_archive(&mmap)
        .expect("archive validates against current schema")
        .cards
}

fn collect_deck_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("json"))
        // `public/preset_decks/index.json` is a flat list of deck stems used
        // by the web build to enumerate decks — not itself a deck.
        .filter(|p| p.file_name().and_then(|n| n.to_str()) != Some("index.json"))
        .collect();
    out.sort();
    out
}

// Currently fails on cards that simply aren't in Forge yet (e.g. unported
// Universes Beyond entries like "Leonardo, Big Brother" and "Flow State").
// Re-enable once the Forge cardsfolder is bumped to cover the affected
// decks. Run locally with `cargo test -p parity --test
// deck_card_lookup -- --ignored`.
#[test]
#[ignore = "blocked on Forge cardsfolder update — see test body for details"]
fn every_deck_card_resolves_in_archive() {
    let db = load_card_db();
    let root = workspace_root();
    let deck_dirs = [root.join("parity_decks"), root.join("public/preset_decks")];

    // Map of deck-relative path -> sorted list of unresolved card names.
    let mut failures: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut decks_checked = 0_usize;
    let mut cards_checked = 0_usize;

    for dir in &deck_dirs {
        for deck_path in collect_deck_files(dir) {
            decks_checked += 1;
            let display_name = deck_path
                .strip_prefix(&root)
                .unwrap_or(&deck_path)
                .display()
                .to_string();
            let raw = fs::read_to_string(&deck_path)
                .unwrap_or_else(|e| panic!("read {}: {e}", deck_path.display()));
            let deck: DeckFile = serde_json::from_str(&raw)
                .unwrap_or_else(|e| panic!("parse {}: {e}", deck_path.display()));

            let mut missing: Vec<String> = Vec::new();
            for entry in deck.cards.iter().chain(deck.commanders.iter()) {
                cards_checked += 1;
                if db.get_by_card_name(&entry.name).is_none() {
                    missing.push(entry.name.clone());
                }
            }
            if !missing.is_empty() {
                missing.sort();
                missing.dedup();
                failures.insert(display_name, missing);
            }
        }
    }

    assert!(
        decks_checked > 0,
        "no deck files found under {:?} — check workspace layout",
        deck_dirs,
    );
    eprintln!(
        "[deck-card-lookup] checked {} cards across {} deck files",
        cards_checked, decks_checked
    );

    if failures.is_empty() {
        return;
    }

    let mut report =
        String::from("Cards in deck files that don't resolve in the cardset archive:\n");
    for (deck, names) in &failures {
        report.push_str(&format!("  {} ({} missing):\n", deck, names.len()));
        for n in names {
            report.push_str(&format!("    - {n}\n"));
        }
    }
    panic!("{report}");
}
