//! Card art on disk, keyed by the path below `cards.scryfall.io` so a request
//! path maps straight to a file. That is what lets one machine serve its cache
//! to another.

pub mod server;

pub use server::ArtServer;

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;

pub const CACHE_DIR: &str = "image-cache";
const PINNED_FILE: &str = "pinned.json";
const UPSTREAM_ORIGIN: &str = "https://cards.scryfall.io";

/// Unpinned entries only, so browsing cannot evict a deliberate download.
const UNPINNED_CAP_BYTES: u64 = 1_500_000_000;

/// Written volume rather than a count: a sweep walks the tree.
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
    /// So `stats` and `evict` do not each walk a tree heading for 100k files.
    totals: Mutex<CacheStats>,
    client: reqwest::Client,
}

impl ImageCache {
    pub fn new(root: PathBuf) -> Self {
        let pinned = load_pinned(&root.join(PINNED_FILE));
        Self {
            root,
            pinned: Mutex::new(pinned),
            written_since_sweep: AtomicU64::new(0),
            totals: Mutex::new(CacheStats {
                files: 0,
                bytes: 0,
                pinned_files: 0,
                pinned_bytes: 0,
            }),
            client: reqwest::Client::builder()
                .user_agent(concat!("manabrew-desktop/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_default(),
        }
    }

    /// A network listener answers whatever it is asked for, so this is the only
    /// thing between a request and the rest of the disk.
    fn path_for(&self, key: &str) -> Option<PathBuf> {
        if key.is_empty() || key.len() > 512 {
            return None;
        }
        let mut path = self.root.clone();
        for segment in key.split('/') {
            if segment.is_empty() || segment == "." || segment == ".." {
                return None;
            }
            // Every character NTFS refuses, not just the obvious two.
            if segment.contains(['\\', ':', '?', '*', '<', '>', '|', '"']) {
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
        // Renamed into place, so a half-written file is never served.
        let temp = path.with_extension("part");
        let replaced = std::fs::metadata(&path).ok().map(|m| m.len());
        let was_pinned = self.is_pinned(key);
        std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, &path).map_err(|e| e.to_string())?;
        // Content first: `note_stored` only touches the pinned half for a key
        // already in it, so `pin` can claim a new one without double-counting.
        self.note_stored(bytes.len() as u64, replaced, was_pinned);
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
        let newly = match self.pinned.lock() {
            Ok(mut pinned) => {
                let newly = pinned.insert(key.to_string());
                if newly {
                    save_pinned(&self.root.join(PINNED_FILE), &pinned);
                }
                newly
            }
            Err(_) => return,
        };
        if !newly {
            return;
        }
        // Totals count files, not keys, so a pin only moves them if one exists.
        // `preseed`'s common path is this call alone.
        let Some(size) = self
            .path_for(key)
            .and_then(|path| std::fs::metadata(path).ok())
            .map(|meta| meta.len())
        else {
            return;
        };
        if let Ok(mut totals) = self.totals.lock() {
            totals.pinned_files += 1;
            totals.pinned_bytes += size;
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
        // Before the request, so a bad key cannot become a fetch of something
        // else.
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

    /// The estimate comes from the caller: the per-variant sizes are measured in
    /// the UI and a second copy here could disagree.
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
        self.totals
            .lock()
            .map(|totals| totals.clone())
            .unwrap_or(CacheStats {
                files: 0,
                bytes: 0,
                pinned_files: 0,
                pinned_bytes: 0,
            })
    }

    /// The one full walk, at startup, and the only place `.part` files left by a
    /// cancelled download are swept.
    pub fn reconcile(&self) {
        let mut totals = CacheStats {
            files: 0,
            bytes: 0,
            pinned_files: 0,
            pinned_bytes: 0,
        };
        for entry in self.walk_all() {
            if entry.partial {
                let _ = std::fs::remove_file(&entry.path);
                continue;
            }
            totals.files += 1;
            totals.bytes += entry.size;
            if entry.pinned {
                totals.pinned_files += 1;
                totals.pinned_bytes += entry.size;
            }
        }
        if let Ok(mut held) = self.totals.lock() {
            *held = totals;
        }
    }

    /// `was_pinned` is the state *before* the write, so this never double-counts
    /// a key `pin` is about to claim.
    fn note_stored(&self, size: u64, replaced: Option<u64>, was_pinned: bool) {
        let Ok(mut totals) = self.totals.lock() else {
            return;
        };
        match replaced {
            Some(old) => totals.bytes = totals.bytes.saturating_sub(old) + size,
            None => {
                totals.files += 1;
                totals.bytes += size;
            }
        }
        if !was_pinned {
            return;
        }
        match replaced {
            Some(old) => totals.pinned_bytes = totals.pinned_bytes.saturating_sub(old) + size,
            None => {
                totals.pinned_files += 1;
                totals.pinned_bytes += size;
            }
        }
    }

    fn note_removed(&self, size: u64, pinned: bool) {
        let Ok(mut totals) = self.totals.lock() else {
            return;
        };
        totals.files = totals.files.saturating_sub(1);
        totals.bytes = totals.bytes.saturating_sub(size);
        if pinned {
            totals.pinned_files = totals.pinned_files.saturating_sub(1);
            totals.pinned_bytes = totals.pinned_bytes.saturating_sub(size);
        }
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
            self.reconcile();
            return Ok(());
        }
        for entry in self.walk() {
            if !entry.pinned && std::fs::remove_file(&entry.path).is_ok() {
                self.note_removed(entry.size, false);
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
        if let Ok(mut totals) = self.totals.lock() {
            totals.pinned_files = 0;
            totals.pinned_bytes = 0;
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
                self.note_removed(entry.size, false);
            }
        }
    }

    fn walk(&self) -> Vec<Entry> {
        self.walk_all().into_iter().filter(|e| !e.partial).collect()
    }

    fn walk_all(&self) -> Vec<Entry> {
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
                let partial = path.extension().is_some_and(|e| e == "part");
                let Some(key) = self.key_of(&path) else {
                    continue;
                };
                out.push(Entry {
                    pinned: !partial && self.is_pinned(&key),
                    partial,
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
    /// A `.part` left by a cancelled or crashed download.
    partial: bool,
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

/// The path a `/scryfall-img/` request is asking for. The query and fragment
/// go the way `key_from_url` already drops them: on the LAN listener this is
/// the only thing shaping network input before `path_for` sees it.
pub fn key_from_request_path(path: &str) -> Option<&str> {
    path.trim_start_matches('/')
        .strip_prefix("scryfall-img/")
        .map(|key| key.split(['?', '#']).next().unwrap_or(""))
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
    /// `api.scryfall.com` requires a `User-Agent` and an `Accept` on every
    /// request and asks that the agent name a version. The image CDN is neither
    /// rate limited nor covered by that, so only the two calls to the API go
    /// through here.
    fn api_request(&self, url: &str) -> reqwest::RequestBuilder {
        self.client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json;q=0.9,*/*;q=0.8")
    }

    /// Every distinct card Scryfall knows, at the variants asked for. One
    /// printing each (`oracle_cards`), which is the set a name-keyed engine
    /// draws from.
    async fn bulk_urls(&self, variants: &[String]) -> Result<Vec<String>, String> {
        #[derive(serde::Deserialize)]
        struct Index {
            jsonl_download_uri: String,
        }
        let index: Index = self
            .api_request(BULK_INDEX_URL)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        let body = self
            .api_request(&index.jsonl_download_uri)
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

/// The cache key inside a full CDN url.
pub fn key_from_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix(UPSTREAM_ORIGIN)?.trim_start_matches('/');
    let path = rest.split(['?', '#']).next().unwrap_or("");
    (!path.is_empty()).then(|| path.to_string())
}

impl ImageCache {
    /// Fetches every card's art at the given variants, pinning as it goes.
    /// Resumable by design: what is already on disk is skipped, so a cancelled
    /// run picks up where it stopped. `progress` is called roughly every 25
    /// cards and at the end, so a caller can render it however it likes.
    pub async fn download_all(
        &self,
        variants: &[String],
        estimate_bytes: u64,
        progress: impl Fn(BulkProgress),
    ) -> Result<PreseedResult, String> {
        self.check_room_for(estimate_bytes)?;
        CANCEL_BULK.store(false, Ordering::Relaxed);

        let urls = self.bulk_urls(variants).await?;
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
            if self.contains(key) {
                self.pin(key);
                result.already_cached += 1;
            } else {
                match self.fetch(key).await {
                    Ok(body) => {
                        bytes += body.len() as u64;
                        match self.store(key, &body, true) {
                            Ok(()) => result.fetched += 1,
                            Err(_) => result.failed += 1,
                        }
                    }
                    Err(_) => result.failed += 1,
                }
            }
            if index % 25 == 0 || index + 1 == keys.len() {
                progress(BulkProgress {
                    done: index as u32 + 1,
                    total,
                    bytes,
                });
            }
        }
        Ok(result)
    }
}

/// Stops a running [`ImageCache::download_all`].
pub fn cancel_download() {
    CANCEL_BULK.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

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

    #[test]
    /// Nothing checked free space, so it filled a disk and failed per image.
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
    /// `walk` skips `.part`, so nothing counted, evicted or cleaned them.
    fn a_startup_reconcile_sweeps_what_a_cancelled_download_left() {
        let (cache, dir) = cache();
        cache.store("a.jpg", b"1234", true).unwrap();
        let orphan = dir.path().join("half.jpg.part");
        std::fs::write(&orphan, b"partial").unwrap();

        cache.reconcile();

        assert!(!orphan.exists(), "a .part file must not outlive a restart");
        let stats = cache.stats();
        assert_eq!(stats.files, 1, "and must never be counted as cached art");
        assert_eq!(stats.bytes, 4);
    }

    #[test]
    fn the_totals_follow_what_eviction_and_clearing_actually_removed() {
        let (cache, _dir) = cache();
        cache.store("keep.jpg", b"1234", true).unwrap();
        cache.store("drop.jpg", b"12", false).unwrap();
        assert_eq!(cache.stats().files, 2);

        cache.clear(false).unwrap();
        let stats = cache.stats();
        assert_eq!(stats.files, 1, "the unpinned one is gone");
        assert_eq!(stats.bytes, 4);
        assert_eq!(stats.pinned_files, 1);

        cache.reconcile();
        let walked = cache.stats();
        assert_eq!(
            (walked.files, walked.bytes, walked.pinned_bytes),
            (stats.files, stats.bytes, stats.pinned_bytes),
            "the running totals must agree with a fresh walk of the same tree"
        );
    }

    #[tokio::test]
    /// Scryfall requires both on every `api.scryfall.com` request.
    async fn api_requests_identify_this_build_and_say_what_they_accept() {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind");
        let port = server.server_addr().to_ip().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
        let record = seen.clone();
        std::thread::spawn(move || {
            if let Ok(request) = server.recv() {
                let headers = request
                    .headers()
                    .iter()
                    .map(|h| (h.field.as_str().as_str().to_string(), h.value.to_string()))
                    .collect::<Vec<_>>();
                record.lock().unwrap().extend(headers);
                let _ = request.respond(tiny_http::Response::empty(204));
            }
        });

        let (cache, _dir) = cache();
        let _ = cache
            .api_request(&format!("http://127.0.0.1:{port}/bulk"))
            .send()
            .await;

        let headers = seen.lock().unwrap().clone();
        let value = |name: &str| {
            headers
                .iter()
                .find(|(field, _)| field.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.clone())
                .unwrap_or_default()
        };
        assert_eq!(value("Accept"), "application/json;q=0.9,*/*;q=0.8");
        assert_eq!(
            value("User-Agent"),
            concat!("manabrew-desktop/", env!("CARGO_PKG_VERSION")),
            "Scryfall asks the agent to name the application and its version"
        );
    }

    #[test]
    /// The rejection list read as complete and stopped at two characters.
    fn a_key_cannot_carry_a_character_no_filesystem_will_take() {
        let (cache, _dir) = cache();
        for bad in ["a?.jpg", "a*.jpg", "a<.jpg", "a>.jpg", "a|.jpg", "a\".jpg"] {
            assert!(cache.path_for(bad).is_none(), "{bad} should be refused");
        }
        assert!(cache.path_for("front/a1b2.jpg").is_some());
    }

    #[test]
    /// The only thing shaping network input before `path_for`.
    fn a_request_path_drops_its_query_and_fragment() {
        assert_eq!(
            key_from_request_path("/scryfall-img/front/a.jpg?v=2"),
            Some("front/a.jpg")
        );
        assert_eq!(
            key_from_request_path("/scryfall-img/front/a.jpg#x"),
            Some("front/a.jpg")
        );
        assert_eq!(key_from_request_path("/scryfall-img/?v=2"), None);
    }

    #[tokio::test]
    /// `preseed`'s common path is `contains` then `pin` and no store at all.
    async fn pinning_art_that_was_already_cached_moves_it_into_the_pinned_half() {
        let (cache, _dir) = cache();
        cache.store("browsed.jpg", b"12345678", false).unwrap();
        assert_eq!(cache.stats().pinned_files, 0);

        cache.preseed(&["browsed.jpg".to_string()]).await;

        let stats = cache.stats();
        assert_eq!(stats.files, 1, "nothing was fetched, so nothing was added");
        assert_eq!(stats.pinned_files, 1, "but it is a deliberate keep now");
        assert_eq!(stats.pinned_bytes, 8);
    }

    #[test]
    fn re_storing_a_pinned_key_adjusts_its_bytes_and_nothing_else() {
        let (cache, _dir) = cache();
        cache.store("a.jpg", b"1234", true).unwrap();
        cache.store("a.jpg", b"123456", true).unwrap();

        let stats = cache.stats();
        assert_eq!((stats.files, stats.bytes), (1, 6));
        assert_eq!((stats.pinned_files, stats.pinned_bytes), (1, 6));
    }

    #[test]
    fn storing_over_an_unpinned_file_and_pinning_it_counts_once() {
        let (cache, _dir) = cache();
        cache.store("a.jpg", b"1234", false).unwrap();
        cache.store("a.jpg", b"123456", true).unwrap();

        let stats = cache.stats();
        assert_eq!((stats.files, stats.bytes), (1, 6));
        assert_eq!(
            (stats.pinned_files, stats.pinned_bytes),
            (1, 6),
            "one file, its current size, counted once"
        );

        cache.reconcile();
        let walked = cache.stats();
        assert_eq!(
            (walked.pinned_files, walked.pinned_bytes),
            (stats.pinned_files, stats.pinned_bytes),
            "the running totals must agree with a walk of the same tree"
        );
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
