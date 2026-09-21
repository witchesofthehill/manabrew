//! The desktop's instance of the shared art cache, and the commands the webview
//! drives it with. The cache itself is `manabrew-art-cache`, which a headless
//! host uses the same way with a different root and no commands.

use std::sync::{Arc, OnceLock};

pub use manabrew_art_cache::cards::{parse_request, CacheRequest};
pub use manabrew_art_cache::{
    cancel_download, key_from_request_path, key_from_url, mime_for, CacheStats, CardStore,
    ImageCache, PreseedResult, CACHE_DIR,
};

static CACHE: OnceLock<Arc<ImageCache>> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let cache = Arc::new(ImageCache::new(dir.join(CACHE_DIR)));
    // One walk, off the startup path: it also sweeps `.part` leftovers and is
    // what makes `stats` a read of two numbers rather than a tree walk.
    let counted = cache.clone();
    std::thread::spawn(move || counted.reconcile());
    let _ = CACHE.set(cache);
}

pub fn cache() -> Option<Arc<ImageCache>> {
    CACHE.get().cloned()
}

pub fn cards() -> Option<CardStore> {
    cache().map(|cache| CardStore::new(cache.root()))
}

/// How many cards this machine can describe with no internet. Zero means the
/// client must not spend a request on the local route before the CDN.
#[tauri::command]
pub fn card_data_cached() -> usize {
    cards().map(|cards| cards.count()).unwrap_or(0)
}

/// The records for the cards a player just downloaded art for. The client is
/// online at that moment and already holds them, so a deck becomes playable
/// offline without the every-card download.
#[tauri::command]
pub fn cache_card_records(records: Vec<serde_json::Value>) -> Result<usize, String> {
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    Ok(cache.store_records(&records))
}

#[tauri::command]
pub async fn preseed_card_art(urls: Vec<String>) -> Result<PreseedResult, String> {
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    let keys: Vec<String> = urls.iter().filter_map(|url| key_from_url(url)).collect();
    Ok(cache.preseed(&keys).await)
}

#[tauri::command]
pub async fn download_all_card_art(
    app: tauri::AppHandle,
    variants: Vec<String>,
    estimate_bytes: u64,
) -> Result<PreseedResult, String> {
    use tauri::Emitter;
    let cache = cache().ok_or_else(|| "no cache directory".to_string())?;
    let result = cache
        .download_all(&variants, estimate_bytes, |progress| {
            let _ = app.emit("card-art:progress", progress);
        })
        .await;
    // No card record carries either of these, and the art is the long job and
    // the reason to wait, so both are best effort at the end of it.
    let _ = cache.store_sets().await;
    let _ = cache.download_rulings().await;
    result
}

#[tauri::command]
pub fn cancel_card_art_download() {
    cancel_download();
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
