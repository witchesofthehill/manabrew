//! File-system cache for Java harness output.
//!
//! Avoids spawning the Java harness for matchups whose output hasn't changed.
//! Cache is keyed on:
//! - A **source hash** covering all Java source files + deck definitions
//! - Per-matchup parameters (deck1, deck2, seed, max_turns, prefer_actions,
//!   deep, variant, commanders)
//!
//! When the source hash changes the entire cache is wiped (cheap — just delete
//! the directory).  Individual entries are stored as compressed JSON files so
//! they are portable between local dev, CI artefacts and Docker volumes.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::java_bridge::JavaMatchupData;
use crate::protocol::ParityLogEntry;

/// Lightweight wrapper that manages a directory of cached Java matchup outputs.
pub struct JavaCache {
    cache_dir: PathBuf,
    source_hash: String,
}

/// Parameters that uniquely identify a matchup (together with the source hash).
#[derive(Hash)]
struct MatchupKey<'a> {
    deck1: &'a str,
    deck2: &'a str,
    seed: u64,
    max_turns: u32,
    prefer_actions: bool,
    deep: bool,
    variant: &'a str,
    commanders: &'a [String],
}

// Minimal serde wrappers so we can store JavaMatchupData as JSON without
// requiring Serialize/Deserialize on the original struct.
#[derive(serde::Serialize, serde::Deserialize)]
struct CachedMatchup {
    log: Vec<ParityLogEntry>,
}

impl From<&JavaMatchupData> for CachedMatchup {
    fn from(d: &JavaMatchupData) -> Self {
        Self { log: d.log.clone() }
    }
}

impl From<CachedMatchup> for JavaMatchupData {
    fn from(c: CachedMatchup) -> Self {
        Self { log: c.log }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Manifest {
    source_hash: String,
    version: u32,
}

const MANIFEST_FILE: &str = "manifest.json";
const CACHE_VERSION: u32 = 4;

impl JavaCache {
    /// Open (or create) a cache directory.
    ///
    /// `source_hash` is an opaque string that identifies the current Java
    /// source + deck definitions.  When it changes the entire cache is wiped.
    pub fn open(cache_dir: &Path, source_hash: String) -> std::io::Result<Self> {
        fs::create_dir_all(cache_dir)?;

        // Check manifest — if source hash differs, wipe everything.
        let manifest_path = cache_dir.join(MANIFEST_FILE);
        let needs_wipe = if manifest_path.exists() {
            match fs::read_to_string(&manifest_path) {
                Ok(s) => match serde_json::from_str::<Manifest>(&s) {
                    Ok(m) => m.source_hash != source_hash || m.version != CACHE_VERSION,
                    Err(_) => true,
                },
                Err(_) => true,
            }
        } else {
            // No manifest — fresh cache, no wipe needed.
            false
        };

        if needs_wipe {
            eprintln!(
                "[java-cache] Source hash changed — wiping cache at {}",
                cache_dir.display()
            );
            // Remove all files except the directory itself
            for entry in fs::read_dir(cache_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    let _ = fs::remove_dir_all(&path);
                } else {
                    let _ = fs::remove_file(&path);
                }
            }
        }

        // Write fresh manifest
        let manifest = Manifest {
            source_hash: source_hash.clone(),
            version: CACHE_VERSION,
        };
        fs::write(&manifest_path, serde_json::to_string(&manifest)?)?;

        Ok(Self {
            cache_dir: cache_dir.to_path_buf(),
            source_hash,
        })
    }

    /// Look up a cached matchup.  Returns `None` on miss or corruption.
    pub fn get(
        &self,
        deck1: &str,
        deck2: &str,
        seed: u64,
        max_turns: u32,
        prefer_actions: bool,
        deep: bool,
        variant: &str,
        commanders: &[String],
    ) -> Option<JavaMatchupData> {
        let path = self.entry_path(
            deck1,
            deck2,
            seed,
            max_turns,
            prefer_actions,
            deep,
            variant,
            commanders,
        );
        let bytes = fs::read(&path).ok()?;
        let cached: CachedMatchup = match serde_json::from_slice(&bytes) {
            Ok(c) => c,
            Err(e) => {
                eprintln!(
                    "[java-cache] Corrupt entry {}, removing: {}",
                    path.display(),
                    e
                );
                let _ = fs::remove_file(&path);
                return None;
            }
        };
        Some(cached.into())
    }

    /// Store a matchup result.  Uses atomic write (temp + rename) to be safe
    /// under concurrent access from rayon threads.
    pub fn put(
        &self,
        deck1: &str,
        deck2: &str,
        seed: u64,
        max_turns: u32,
        prefer_actions: bool,
        deep: bool,
        variant: &str,
        commanders: &[String],
        data: &JavaMatchupData,
    ) -> std::io::Result<()> {
        let path = self.entry_path(
            deck1,
            deck2,
            seed,
            max_turns,
            prefer_actions,
            deep,
            variant,
            commanders,
        );

        // Ensure shard directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let cached = CachedMatchup::from(data);
        let json = serde_json::to_vec(&cached)?;

        // Atomic write: write to temp file, then rename
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, &json)?;
        fs::rename(&tmp, &path)?;

        Ok(())
    }

    /// Whether the cache has no entries.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Number of cached entries (for stats logging).
    pub fn len(&self) -> usize {
        let mut count = 0;
        for entry in fs::read_dir(&self.cache_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
            if entry.path().is_dir() && entry.file_name() != "." {
                for sub in fs::read_dir(entry.path()).into_iter().flatten().flatten() {
                    if sub.path().extension().map(|e| e == "json").unwrap_or(false)
                        && sub.file_name() != MANIFEST_FILE
                    {
                        count += 1;
                    }
                }
            }
        }
        count
    }

    pub fn source_hash(&self) -> &str {
        &self.source_hash
    }

    // ── internal ──────────────────────────────────────────────────────

    fn entry_path<'a>(
        &self,
        deck1: &'a str,
        deck2: &'a str,
        seed: u64,
        max_turns: u32,
        prefer_actions: bool,
        deep: bool,
        variant: &'a str,
        commanders: &'a [String],
    ) -> PathBuf {
        let key = MatchupKey {
            deck1,
            deck2,
            seed,
            max_turns,
            prefer_actions,
            deep,
            variant,
            commanders,
        };
        let hash = {
            let mut h = DefaultHasher::new();
            self.source_hash.hash(&mut h);
            key.hash(&mut h);
            format!("{:016x}", h.finish())
        };
        // Shard by first 2 hex chars to avoid giant flat directories
        let shard = &hash[..2];
        self.cache_dir.join(shard).join(format!("{}.json", hash))
    }
}

pub fn compute_source_hash(project_root: &Path) -> String {
    let dirs_to_hash = [
        "forge-harness/src",
        "forge/forge-game/src",
        "forge/forge-core/src",
        "forge/forge-ai/src",
        "forge/forge-gui/res/cardsfolder",
        "forge/forge-gui/res/tokenscripts",
        "public/preset_decks",
        "parity_decks",
    ];

    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();

    for dir in &dirs_to_hash {
        let full = project_root.join(dir);
        if !full.exists() {
            continue;
        }
        collect_files(&full, &full, &mut entries);
    }

    // Stable sort by relative path for determinism
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = DefaultHasher::new();
    for (rel_path, content) in &entries {
        rel_path.hash(&mut hasher);
        content.hash(&mut hasher);
    }

    format!("{:016x}", hasher.finish())
}

pub fn compute_jar_hash(jar_path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(jar_path)?;
    let mut hasher = DefaultHasher::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        buf[..n].hash(&mut hasher);
    }
    Ok(format!("{:016x}", hasher.finish()))
}

fn collect_files(base: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(base, &path, out);
        } else if path.is_file() {
            // Only hash source-like files
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "java" | "json" | "xml" | "properties" | "txt") {
                if let Ok(content) = fs::read(&path) {
                    let rel = path
                        .strip_prefix(base)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();
                    out.push((rel, content));
                }
            }
        }
    }
}
