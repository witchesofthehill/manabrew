//! The `/scryfall-img/` route web deployments get from Caddy, backed by a cache
//! under the app data directory. The key is the path below `cards.scryfall.io`,
//! so a request path maps straight to a file, which is also what lets one
//! machine serve its cache to a LAN.
//!
//! Two classes of entry. Art fetched because somebody asked for it
//! (`preseed_card_art`) is pinned and never evicted, usually so a group can
//! unplug the internet and still play; art picked up while browsing is evicted
//! oldest-first once the unpinned half passes the cap.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use serde::Serialize;

const CACHE_DIR: &str = "image-cache";
const PINNED_FILE: &str = "pinned.json";
const UPSTREAM_ORIGIN: &str = "https://cards.scryfall.io";

/// Applies to unpinned entries only. Deliberate downloads are never counted
/// against it, so filling the cache by browsing cannot undo one.
const UNPINNED_CAP_BYTES: u64 = 1_500_000_000;

/// A sweep walks the whole tree, so it runs on written volume rather than on
/// every store: at roughly 100KB an image this is a sweep every few hundred.
const SWEEP_EVERY_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub files: u64,
    pub bytes: u64,
    pub pinned_files: u64,
    pub pinned_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreseedResult {
    pub already_cached: u32,
    pub fetched: u32,
    pub failed: u32,
}

pub struct ImageCache {
    root: PathBuf,
    pinned: Mutex<HashSet<String>>,
    written_since_sweep: AtomicU64,
    client: reqwest::Client,
}

impl ImageCache {
    pub fn new(root: PathBuf) -> Self {
        let pinned = load_pinned(&root.join(PINNED_FILE));
        Self {
            root,
            pinned: Mutex::new(pinned),
            written_since_sweep: AtomicU64::new(0),
            client: reqwest::Client::builder()
                .user_agent("manabrew-desktop")
                .build()
                .unwrap_or_default(),
        }
    }

    /// Where a request path lands on disk, or `None` if it tries to leave the
    /// cache. A LAN listener answers whatever the network asks for, so this is
    /// the only thing standing between a request and the rest of the disk.
    fn path_for(&self, key: &str) -> Option<PathBuf> {
        if key.is_empty() || key.len() > 512 {
            return None;
        }
        let mut path = self.root.clone();
        for segment in key.split('/') {
            if segment.is_empty() || segment == "." || segment == ".." {
                return None;
            }
            if segment.contains('\\') || segment.contains(':') {
                return None;
            }
            path.push(segment);
        }
        Some(path)
    }

    pub fn read(&self, key: &str) -> Option<Vec<u8>> {
        let path = self.path_for(key)?;
        let mut file = std::fs::File::open(&path).ok()?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).ok()?;
        Some(bytes)
    }

    pub fn contains(&self, key: &str) -> bool {
        self.path_for(key).map(|p| p.is_file()).unwrap_or(false)
    }

    fn store(&self, key: &str, bytes: &[u8], pin: bool) -> Result<(), String> {
        let path = self
            .path_for(key)
            .ok_or_else(|| "bad cache key".to_string())?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Written beside the target and renamed, so a half-written file is
        // never served: the LAN listener has no way to tell one from a whole.
        let temp = path.with_extension("part");
        std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, &path).map_err(|e| e.to_string())?;
        if pin {
            self.pin(key);
        }
        let written = self
            .written_since_sweep
            .fetch_add(bytes.len() as u64, Ordering::Relaxed)
            + bytes.len() as u64;
        if written >= SWEEP_EVERY_BYTES {
            self.written_since_sweep.store(0, Ordering::Relaxed);
            self.evict();
        }
        Ok(())
    }

    fn pin(&self, key: &str) {
        let mut pinned = match self.pinned.lock() {
            Ok(pinned) => pinned,
            Err(_) => return,
        };
        if pinned.insert(key.to_string()) {
            save_pinned(&self.root.join(PINNED_FILE), &pinned);
        }
    }

    fn is_pinned(&self, key: &str) -> bool {
        self.pinned
            .lock()
            .map(|pinned| pinned.contains(key))
            .unwrap_or(false)
    }

    pub async fn get_or_fetch(&self, key: &str) -> Option<Vec<u8>> {
        if let Some(bytes) = self.read(key) {
            return Some(bytes);
        }
        let bytes = self.fetch(key).await.ok()?;
        let _ = self.store(key, &bytes, false);
        Some(bytes)
    }

    async fn fetch(&self, key: &str) -> Result<Vec<u8>, String> {
        // Rejected before the request so a bad key cannot be turned into a
        // fetch of something else.
        self.path_for(key)
            .ok_or_else(|| "bad cache key".to_string())?;
        let url = format!("{UPSTREAM_ORIGIN}/{key}");
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("{url}: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("{url}: HTTP {}", response.status()));
        }
        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("{url}: {e}"))
    }

    /// Per-url outcomes rather than a failed batch: one dead url should not
    /// lose a download somebody is waiting on.
    pub async fn preseed(&self, keys: &[String]) -> PreseedResult {
        let mut result = PreseedResult {
            already_cached: 0,
            fetched: 0,
            failed: 0,
        };
        for key in keys {
            if self.contains(key) {
                self.pin(key);
                result.already_cached += 1;
                continue;
            }
            match self.fetch(key).await {
                Ok(bytes) => match self.store(key, &bytes, true) {
                    Ok(()) => result.fetched += 1,
                    Err(_) => result.failed += 1,
                },
                Err(_) => result.failed += 1,
            }
        }
        result
    }

    /// Refuses a download the disk cannot hold. The estimate comes from the
    /// caller because the per-variant sizes are measured in the UI and nothing
    /// is served by having a second copy of them here that can disagree.
    pub fn check_room_for(&self, estimate_bytes: u64) -> Result<(), String> {
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let available = fs4::available_space(&self.root).map_err(|e| e.to_string())?;
        if available >= estimate_bytes {
            return Ok(());
        }
        Err(format!(
            "not enough room: this needs about {} and the disk has {} free",
            human_bytes(estimate_bytes),
            human_bytes(available)
        ))
    }

    pub fn stats(&self) -> CacheStats {
        let mut stats = CacheStats {
            files: 0,
            bytes: 0,
            pinned_files: 0,
            pinned_bytes: 0,
        };
        for entry in self.walk() {
            stats.files += 1;
            stats.bytes += entry.size;
            if entry.pinned {
                stats.pinned_files += 1;
                stats.pinned_bytes += entry.size;
            }
        }
        stats
    }

    pub fn clear(&self, include_pinned: bool) -> Result<(), String> {
        if include_pinned {
            if self.root.exists() {
                std::fs::remove_dir_all(&self.root).map_err(|e| e.to_string())?;
            }
            if let Ok(mut pinned) = self.pinned.lock() {
                pinned.clear();
                save_pinned(&self.root.join(PINNED_FILE), &pinned);
            }
            return Ok(());
        }
        for entry in self.walk() {
            if !entry.pinned {
                let _ = std::fs::remove_file(&entry.path);
            }
        }
        Ok(())
    }

    /// Drops the mark without deleting: the art stays until it loses on age.
    pub fn unpin_all(&self) {
        if let Ok(mut pinned) = self.pinned.lock() {
            pinned.clear();
            save_pinned(&self.root.join(PINNED_FILE), &pinned);
        }
    }

    fn evict(&self) {
        let mut unpinned: Vec<Entry> = self.walk().into_iter().filter(|e| !e.pinned).collect();
        let mut total: u64 = unpinned.iter().map(|e| e.size).sum();
        if total <= UNPINNED_CAP_BYTES {
            return;
        }
        unpinned.sort_by_key(|e| e.modified);
        for entry in unpinned {
            if total <= UNPINNED_CAP_BYTES {
                break;
            }
            if std::fs::remove_file(&entry.path).is_ok() {
                total = total.saturating_sub(entry.size);
            }
        }
    }

    fn walk(&self) -> Vec<Entry> {
        let mut out = Vec::new();
        let mut stack = vec![self.root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(meta) = entry.metadata() else { continue };
                if meta.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.file_name().is_some_and(|n| n == PINNED_FILE) {
                    continue;
                }
                if path.extension().is_some_and(|e| e == "part") {
                    continue;
                }
                let Some(key) = self.key_of(&path) else {
                    continue;
                };
                out.push(Entry {
                    pinned: self.is_pinned(&key),
                    path,
                    size: meta.len(),
                    modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                });
            }
        }
        out
    }

    fn key_of(&self, path: &Path) -> Option<String> {
        let relative = path.strip_prefix(&self.root).ok()?;
        let mut key = String::new();
        for segment in relative.components() {
            let segment = segment.as_os_str().to_str()?;
            if !key.is_empty() {
                key.push('/');
            }
            key.push_str(segment);
        }
        Some(key)
    }
}

struct Entry {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
    pinned: bool,
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn load_pinned(path: &Path) -> HashSet<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .map(HashSet::from_iter)
        .unwrap_or_default()
}

fn save_pinned(path: &Path, pinned: &HashSet<String>) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let list: Vec<&String> = pinned.iter().collect();
    if let Ok(raw) = serde_json::to_string(&list) {
        let _ = std::fs::write(path, raw);
    }
}

/// The path a `/scryfall-img/` request is asking for.
pub fn key_from_request_path(path: &str) -> Option<&str> {
    path.trim_start_matches('/')
        .strip_prefix("scryfall-img/")
        .filter(|key| !key.is_empty())
}

pub fn mime_for(key: &str) -> &'static str {
    let lower = key.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/jpeg"
    }
}

const BULK_INDEX_URL: &str = "https://api.scryfall.com/bulk-data/oracle-cards";

/// Downloading every card is a long job somebody can change their mind about.
static CANCEL_BULK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkProgress {
    pub done: u32,
    pub total: u32,
    pub bytes: u64,
}

impl ImageCache {
    /// Every distinct card Scryfall knows, at the variants asked for. One
    /// printing each (`oracle_cards`), which is the set a name-keyed engine
    /// draws from.
    async fn bulk_urls(&self, variants: &[String]) -> Result<Vec<String>, String> {
        #[derive(serde::Deserialize)]
        struct Index {
            jsonl_download_uri: String,
        }
        let index: Index = self
            .client
            .get(BULK_INDEX_URL)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        let body = self
            .client
            .get(&index.jsonl_download_uri)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;

        let reader = std::io::BufReader::new(flate2::read::GzDecoder::new(&body[..]));
        let mut urls = Vec::new();
        for line in std::io::BufRead::lines(reader) {
            let Ok(line) = line else { break };
            let Ok(card) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            // A double-faced card carries its art per face rather than at the
            // top level, and both faces get drawn.
            let faces = card
                .get("card_faces")
                .and_then(|f| f.as_array())
                .map(|faces| faces.iter().filter_map(|f| f.get("image_uris")).collect())
                .unwrap_or_else(|| card.get("image_uris").into_iter().collect::<Vec<_>>());
            for uris in faces {
                for variant in variants {
                    if let Some(url) = uris.get(variant.as_str()).and_then(|u| u.as_str()) {
                        urls.push(url.to_string());
                    }
                }
            }
        }
        Ok(urls)
    }
}

static CACHE: OnceLock<Arc<ImageCache>> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = CACHE.set(Arc::new(ImageCache::new(dir.join(CACHE_DIR))));
}

pub fn cache() -> Option<Arc<ImageCache>> {
    CACHE.get().cloned()
}

/// Seeds the global the `spawn` paths read, which `init` otherwise fills from
/// an `AppHandle` no test has.
#[cfg(test)]
pub fn set_cache_for_tests(cache: Arc<ImageCache>) {
    let _ = CACHE.set(cache);
}

#[tauri::command]
pub async fn preseed_card_art(urls: Vec<String>) -> Result<PreseedResult, String> {
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    let keys: Vec<String> = urls.iter().filter_map(|url| key_from_url(url)).collect();
    Ok(cache.preseed(&keys).await)
}

/// Fetches every card's art at the given variants, pinning as it goes and
/// reporting progress on `card-art:progress`. Resumable by design: what is
/// already on disk is skipped, so a cancelled run picks up where it stopped.
#[tauri::command]
pub async fn download_all_card_art(
    app: tauri::AppHandle,
    variants: Vec<String>,
    estimate_bytes: u64,
) -> Result<PreseedResult, String> {
    use tauri::Emitter;
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    cache.check_room_for(estimate_bytes)?;
    CANCEL_BULK.store(false, Ordering::Relaxed);

    let urls = cache.bulk_urls(&variants).await?;
    let keys: Vec<String> = urls.iter().filter_map(|url| key_from_url(url)).collect();
    let total = keys.len() as u32;

    let mut result = PreseedResult {
        already_cached: 0,
        fetched: 0,
        failed: 0,
    };
    let mut bytes = 0u64;
    for (index, key) in keys.iter().enumerate() {
        if CANCEL_BULK.load(Ordering::Relaxed) {
            break;
        }
        if cache.contains(key) {
            cache.pin(key);
            result.already_cached += 1;
        } else {
            match cache.fetch(key).await {
                Ok(body) => {
                    bytes += body.len() as u64;
                    match cache.store(key, &body, true) {
                        Ok(()) => result.fetched += 1,
                        Err(_) => result.failed += 1,
                    }
                }
                Err(_) => result.failed += 1,
            }
        }
        if index % 25 == 0 || index + 1 == keys.len() {
            let _ = app.emit(
                "card-art:progress",
                BulkProgress {
                    done: index as u32 + 1,
                    total,
                    bytes,
                },
            );
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn cancel_card_art_download() {
    CANCEL_BULK.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn card_art_cache_stats() -> Result<CacheStats, String> {
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    Ok(cache.stats())
}

#[tauri::command]
pub fn clear_card_art_cache(include_downloaded: Option<bool>) -> Result<(), String> {
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    cache.clear(include_downloaded.unwrap_or(false))
}

#[tauri::command]
pub fn forget_downloaded_card_art() -> Result<(), String> {
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    cache.unpin_all();
    Ok(())
}

/// The cache key inside a full CDN url.
pub fn key_from_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix(UPSTREAM_ORIGIN)?.trim_start_matches('/');
    let path = rest.split(['?', '#']).next().unwrap_or("");
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache() -> (ImageCache, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (ImageCache::new(dir.path().to_path_buf()), dir)
    }

    #[test]
    fn a_key_cannot_leave_the_cache() {
        let (cache, _dir) = cache();
        for key in [
            "../secret",
            "normal/../../secret",
            "/etc/passwd",
            "normal/./x.jpg",
            "",
        ] {
            assert!(cache.path_for(key).is_none(), "{key} should be refused");
        }
        assert!(cache.path_for("normal/front/a/b/x.jpg").is_some());
    }

    #[test]
    fn pinned_art_survives_eviction_and_unpinned_does_not() {
        let (cache, _dir) = cache();
        cache.store("normal/keep.jpg", b"pinned", true).unwrap();
        cache.store("normal/drop.jpg", b"loose", false).unwrap();

        cache.clear(false).unwrap();

        assert!(cache.contains("normal/keep.jpg"));
        assert!(!cache.contains("normal/drop.jpg"));
    }

    #[test]
    fn a_pin_survives_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let cache = ImageCache::new(dir.path().to_path_buf());
            cache.store("normal/keep.jpg", b"pinned", true).unwrap();
        }
        let reopened = ImageCache::new(dir.path().to_path_buf());
        assert!(reopened.is_pinned("normal/keep.jpg"));
    }

    /// Nothing checked free space, so "download every card" would fill a disk
    /// to zero and only stop when writes started failing one image at a time.
    #[test]
    fn a_download_bigger_than_the_disk_is_refused_before_it_starts() {
        let (cache, _dir) = cache();
        assert!(cache.check_room_for(1024).is_ok());

        let error = cache.check_room_for(u64::MAX).expect_err("must refuse");
        assert!(
            error.contains("not enough room"),
            "the message has to say it is a space problem: {error}"
        );
        // Both numbers, so the message says what to free up.
        assert!(error.contains("PB"), "wants the estimate: {error}");
        assert!(error.contains(" free"), "wants what the disk has: {error}");
    }

    #[test]
    fn stats_separate_the_deliberate_half() {
        let (cache, _dir) = cache();
        cache.store("a.jpg", b"1234", true).unwrap();
        cache.store("b.jpg", b"12", false).unwrap();

        let stats = cache.stats();
        assert_eq!(stats.files, 2);
        assert_eq!(stats.bytes, 6);
        assert_eq!(stats.pinned_files, 1);
        assert_eq!(stats.pinned_bytes, 4);
    }

    #[test]
    fn urls_map_to_keys() {
        assert_eq!(
            key_from_url("https://cards.scryfall.io/normal/front/a/b/x.jpg").as_deref(),
            Some("normal/front/a/b/x.jpg")
        );
        assert_eq!(key_from_url("https://example.com/x.jpg"), None);
        assert_eq!(key_from_url("https://cards.scryfall.io/"), None);
    }

    #[test]
    fn request_paths_map_to_keys() {
        assert_eq!(
            key_from_request_path("/scryfall-img/normal/front/a/b/x.jpg"),
            Some("normal/front/a/b/x.jpg")
        );
        assert_eq!(key_from_request_path("/index.html"), None);
        assert_eq!(key_from_request_path("/scryfall-img/"), None);
    }
}
