// macOS/Linux packaged Tauri serves the frontend from the `tauri://localhost`
// custom scheme, which WKWebView/WebKitGTK refuse for `fetch`/Cache API
// ("Request url is not HTTP/HTTPS") and cannot make cross-origin isolated, so
// the WASM engine (cardset, presets, and `SharedArrayBuffer` games) can't run.
// `tauri dev` works because vite serves over `http://localhost:1420` — a real
// http origin. This reproduces that for the packaged build: serve the embedded
// assets over `http://localhost:<port>` with COOP/COEP.
// Windows already uses `http://tauri.localhost`, so it keeps the default scheme.
//
// To Tauri this is a *remote* origin, so the app's own commands are ACL-gated:
// they reach Rust only because capabilities/default.json grants the
// `allow-app-commands` permission (permissions/app-commands.toml) for this
// origin. The `remote` block alone grants nothing — it only scopes which origin
// the listed permissions apply to.
//
// Returns None in dev and on bind failure, so the window falls back to the
// default URL (the vite devUrl). The dev gate must be explicit: in dev the
// asset resolver reads `frontendDist` (../dist) straight from disk, so a stale
// `dist/` left by an earlier `vite build` would otherwise hijack `tauri dev`
// and silently serve that old bundle instead of vite. The port is fixed
// so capabilities/default.json can list an exact `http://localhost:9527` origin.
// Also listed in manabrew-hub's `cors_origins` — the Hub rejects the app
// without it. Keep both in sync.
const ASSET_SERVER_PORT: u16 = 9527;

/// Whether anything is answering `/scryfall-img/`. Set where the route starts
/// existing, and read by the download UI, so the offer to fill the cache and
/// the ability to read it back cannot drift apart. Windows keeps the embedded
/// `http://tauri.localhost` scheme and runs no asset server, and dev hands the
/// path to vite's proxy, so neither serves the cache and neither offers it.
static CARD_ART_ROUTE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Gates Settings -> Cache. A machine that cannot read the cache is never
/// offered the download that fills it.
#[tauri::command]
pub fn card_art_route_available() -> bool {
    CARD_ART_ROUTE.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(not(target_os = "windows"))]
fn start_asset_server(app: &tauri::AppHandle) -> Option<u16> {
    if tauri::is_dev() {
        return None;
    }
    let resolver = app.asset_resolver();
    resolver.get("index.html".into())?;

    let server = tiny_http::Server::http(("127.0.0.1", ASSET_SERVER_PORT)).ok()?;

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            // Anti-DNS-rebinding: only serve requests addressed to loopback.
            let host_ok = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Host"))
                .map(|h| {
                    let v = h.value.as_str();
                    v.starts_with("localhost:") || v.starts_with("127.0.0.1:")
                })
                .unwrap_or(false);
            if !host_ok {
                let _ = request.respond(tiny_http::Response::empty(403));
                continue;
            }

            let raw = request.url().to_string();
            if let Some(key) = crate::image_cache::key_from_request_path(&raw) {
                serve_card_art(request, key);
                continue;
            }
            let path = raw.split('?').next().unwrap_or("").trim_start_matches('/');
            let lookup = if path.is_empty() { "index.html" } else { path };

            // SPA fallback: client-router paths resolve to index.html.
            let asset = resolver
                .get(lookup.to_string())
                .or_else(|| resolver.get("index.html".to_string()));

            match asset {
                Some(asset) => {
                    let mut response = tiny_http::Response::from_data(asset.bytes);
                    for (name, value) in [
                        ("Content-Type", asset.mime_type.as_str()),
                        ("Cross-Origin-Opener-Policy", "same-origin"),
                        ("Cross-Origin-Embedder-Policy", "require-corp"),
                        ("Cross-Origin-Resource-Policy", "same-origin"),
                    ] {
                        if let Ok(header) =
                            tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes())
                        {
                            response.add_header(header);
                        }
                    }
                    let _ = request.respond(response);
                }
                None => {
                    let _ = request.respond(tiny_http::Response::empty(404));
                }
            }
        }
    });

    Some(ASSET_SERVER_PORT)
}

#[cfg(not(target_os = "windows"))]
fn serve_card_art(request: tiny_http::Request, key: &str) {
    let bytes = crate::image_cache::cache().and_then(|cache| {
        tauri::async_runtime::block_on(async move { cache.get_or_fetch(key).await })
    });
    match bytes {
        Some(bytes) => {
            let mime = crate::image_cache::mime_for(key);
            let mut response = tiny_http::Response::from_data(bytes);
            for (name, value) in [
                ("Content-Type", mime),
                ("Cross-Origin-Resource-Policy", "same-origin"),
                ("Cache-Control", "public, max-age=31536000, immutable"),
            ] {
                if let Ok(header) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes())
                {
                    response.add_header(header);
                }
            }
            let _ = request.respond(response);
        }
        None => {
            let _ = request.respond(tiny_http::Response::empty(404));
        }
    }
}

pub fn main_window_url(app: &tauri::AppHandle) -> tauri::WebviewUrl {
    #[cfg(not(target_os = "windows"))]
    if let Some(port) = start_asset_server(app) {
        if let Ok(url) = format!("http://localhost:{port}").parse() {
            CARD_ART_ROUTE.store(true, std::sync::atomic::Ordering::Relaxed);
            return tauri::WebviewUrl::External(url);
        }
    }
    #[cfg(target_os = "windows")]
    let _ = app;
    tauri::WebviewUrl::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Settings -> Cache is gated on this, and the route it names only exists
    /// where `start_asset_server` ran. The gate used to be
    /// `getPlatformType() === "tauri"`, which is true on Windows and in dev,
    /// neither of which serves `/scryfall-img/`: both offered a download and
    /// then had no way to read a byte of it back.
    #[test]
    fn the_card_art_route_is_not_available_until_something_serves_it() {
        assert!(
            !card_art_route_available(),
            "nothing started the asset server here, so nothing answers /scryfall-img/"
        );
        CARD_ART_ROUTE.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(card_art_route_available());
        CARD_ART_ROUTE.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}
