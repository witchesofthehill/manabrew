use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn main() {
    // Order matters: tauri_build validates that every resource listed in
    // tauri.conf.json exists. Generated resource roots must be present
    // *before* tauri_build runs.
    ensure_forge_runtime_resource_dir();
    build_cardset_archive_if_stale();
    tauri_build::build();
}

fn ensure_forge_runtime_resource_dir() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let runtime_dir = manifest_dir.join("resources/forge-runtime");

    println!("cargo:rerun-if-changed=../forge/forge-harness/target/forge-harness-jar-with-dependencies.jar");
    if let Err(err) = std::fs::create_dir_all(&runtime_dir) {
        panic!(
            "failed to create Forge runtime resource dir at {}: {err}",
            runtime_dir.display()
        );
    }
}

/// Regenerate `resources/cardset.rkyv` whenever the cardsfolder, tokenscripts,
/// or editions are newer than the existing archive (or the archive is
/// missing). The archive is bundled as a Tauri resource and mmap'd at runtime
/// by `card_db.rs`.
fn build_cardset_archive_if_stale() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cardsfolder = manifest_dir.join("../forge/forge-gui/res/cardsfolder");
    let tokenscripts = manifest_dir.join("../forge/forge-gui/res/tokenscripts");
    let editions = manifest_dir.join("../forge/forge-gui/res/editions");
    let block_data = manifest_dir.join("../forge/forge-gui/res/blockdata");
    let archive_path = manifest_dir.join("resources/cardset.rkyv");

    println!("cargo:rerun-if-changed={}", cardsfolder.display());
    println!("cargo:rerun-if-changed={}", tokenscripts.display());
    println!("cargo:rerun-if-changed={}", editions.display());
    println!("cargo:rerun-if-changed={}", block_data.display());
    println!("cargo:rerun-if-env-changed=FORCE_CARDSET_REBUILD");

    if !cardsfolder.exists() {
        println!(
            "cargo:warning=cardsfolder not found at {}, skipping cardset archive build",
            cardsfolder.display()
        );
        return;
    }

    let inputs = [&cardsfolder, &tokenscripts, &editions, &block_data];
    if !needs_rebuild(&inputs, &archive_path) {
        return;
    }

    let sources = forge_cardset_archive::ArchiveSources {
        cardsfolder: &cardsfolder,
        tokenscripts: tokenscripts.exists().then_some(tokenscripts.as_path()),
        editions: editions.exists().then_some(editions.as_path()),
        block_data: block_data.exists().then_some(block_data.as_path()),
    };
    match forge_cardset_archive::build_archive_from_sources(sources, &archive_path) {
        Ok(stats) => {
            println!(
                "cargo:warning=cardset archive built: {} cards, {} tokens, {} editions, {:.2} MiB",
                stats.cards,
                stats.tokens,
                stats.editions,
                stats.bytes_written as f64 / 1024.0 / 1024.0
            );
        }
        Err(err) => {
            panic!("failed to build cardset archive: {err}");
        }
    }
}

fn needs_rebuild(inputs: &[&PathBuf], archive: &Path) -> bool {
    let archive_mtime = match archive.metadata().and_then(|m| m.modified()) {
        Ok(m) => m,
        Err(_) => return true,
    };

    // Regenerate the archive cos it has changed
    match std::fs::read(archive) {
        Ok(bytes) => {
            if forge_cardset_archive::load_checked(&bytes).is_err() {
                return true;
            }
        }
        Err(_) => return true,
    }
    for dir in inputs {
        if !dir.exists() {
            continue;
        }
        match latest_mtime(dir) {
            Some(t) if t > archive_mtime => return true,
            None => return true,
            _ => {}
        }
    }
    false
}

fn latest_mtime(dir: &Path) -> Option<SystemTime> {
    let mut latest: Option<SystemTime> = None;
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        // walkdir's metadata returns walkdir::Error, but Metadata::modified
        // returns io::Error — they don't compose via and_then.
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                latest = Some(latest.map_or(modified, |cur| cur.max(modified)));
            }
        }
    }
    latest
}
