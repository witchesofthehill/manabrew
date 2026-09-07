//! The desktop's instance of the shared art cache, and the commands the webview
//! drives it with. The cache itself is `manabrew-art-cache`, which a headless
//! host uses the same way with a different root and no commands.

use std::sync::{Arc, OnceLock};

pub use manabrew_art_cache::{
    cancel_download, key_from_request_path, key_from_url, mime_for, CacheStats, ImageCache,
    PreseedResult, CACHE_DIR,
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
    cache
        .download_all(&variants, estimate_bytes, |progress| {
            let _ = app.emit("card-art:progress", progress);
        })
        .await
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
