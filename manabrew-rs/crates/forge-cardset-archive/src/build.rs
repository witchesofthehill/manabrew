use std::path::Path;

use walkdir::WalkDir;

use super::{to_bytes, BlockData, Card, CardArchive, Edition, ARCHIVE_FORMAT_VERSION};

#[derive(Debug, Default)]
pub struct BuildStats {
    pub cards: usize,
    pub tokens: usize,
    pub editions: usize,
    pub skipped: usize,
    pub duplicates: usize,
    pub bytes_written: usize,
}

pub struct ArchiveSources<'a> {
    pub cardsfolder: &'a Path,
    pub tokenscripts: Option<&'a Path>,
    pub editions: Option<&'a Path>,
    pub block_data: Option<&'a Path>,
}

pub fn build_archive_from_sources(
    sources: ArchiveSources<'_>,
    out_path: &Path,
) -> Result<BuildStats, String> {
    if !sources.cardsfolder.exists() {
        return Err(format!(
            "cardsfolder does not exist: {}",
            sources.cardsfolder.display()
        ));
    }

    let mut stats = BuildStats::default();
    let mut cards = collect_script_dir(sources.cardsfolder, ScriptKey::FromName, &mut stats)?;
    cards.sort_by(|a, b| a.name_lower.cmp(&b.name_lower));
    let before_dedup = cards.len();
    cards.dedup_by(|a, b| a.name_lower == b.name_lower);
    stats.duplicates += before_dedup - cards.len();
    stats.cards = cards.len();

    let mut tokens = Vec::new();
    if let Some(tokens_dir) = sources.tokenscripts {
        if tokens_dir.exists() {
            tokens = collect_script_dir(tokens_dir, ScriptKey::FromFilename, &mut stats)?;
            tokens.sort_by(|a, b| a.name_lower.cmp(&b.name_lower));
            let before = tokens.len();
            tokens.dedup_by(|a, b| a.name_lower == b.name_lower);
            stats.duplicates += before - tokens.len();
        }
    }
    stats.tokens = tokens.len();

    let mut editions = Vec::new();
    if let Some(editions_dir) = sources.editions {
        if editions_dir.exists() {
            editions = collect_text_dir::<Edition>(editions_dir, &mut stats, |name, raw| {
                Edition { name, raw }
            })?;
        }
    }
    stats.editions = editions.len();

    let mut block_data = Vec::new();
    if let Some(block_data_dir) = sources.block_data {
        if block_data_dir.exists() {
            block_data = collect_text_dir::<BlockData>(block_data_dir, &mut stats, |name, raw| {
                BlockData { name, raw }
            })?;
        }
    }

    let archive = CardArchive {
        format_version: ARCHIVE_FORMAT_VERSION,
        cards,
        tokens,
        editions,
        block_data,
    };
    let bytes = to_bytes(&archive)?;
    stats.bytes_written = bytes.len();

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create out dir: {e}"))?;
    }
    std::fs::write(out_path, &bytes).map_err(|e| format!("write archive: {e}"))?;

    Ok(stats)
}

#[derive(Clone, Copy)]
enum ScriptKey {
    FromName,
    FromFilename,
}

fn collect_script_dir(
    dir: &Path,
    key_mode: ScriptKey,
    stats: &mut BuildStats,
) -> Result<Vec<Card>, String> {
    let mut out: Vec<Card> = Vec::with_capacity(35_000);
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }
        let raw = match std::fs::read_to_string(entry.path()) {
            Ok(s) => s,
            Err(_) => {
                stats.skipped += 1;
                continue;
            }
        };
        let filename_stem = entry
            .path()
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());
        let name = match key_mode {
            ScriptKey::FromName => extract_name(&raw)
                .map(|s| s.to_string())
                .or_else(|| filename_stem.clone()),
            ScriptKey::FromFilename => filename_stem.clone(),
        }
        .unwrap_or_default();
        if name.is_empty() {
            stats.skipped += 1;
            continue;
        }
        out.push(Card {
            name_lower: name.to_ascii_lowercase(),
            raw,
        });
    }
    Ok(out)
}

fn collect_text_dir<T>(
    dir: &Path,
    stats: &mut BuildStats,
    make: impl Fn(String, String) -> T,
) -> Result<Vec<T>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read dir {}: {e}", dir.display()))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => {
                stats.skipped += 1;
                continue;
            }
        };
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();
        out.push(make(name, raw));
    }
    Ok(out)
}

fn extract_name(raw: &str) -> Option<&str> {
    raw.lines().find_map(|line| line.strip_prefix("Name:"))
}
