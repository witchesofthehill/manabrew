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
// Returns None in dev (no embedded assets → Tauri uses the vite devUrl) and on
// bind failure, so the window falls back to the default URL. The port is fixed
// so capabilities/default.json can list an exact `http://localhost:9527` origin.
const ASSET_SERVER_PORT: u16 = 9527;

#[cfg(not(target_os = "windows"))]
fn start_asset_server(app: &tauri::AppHandle) -> Option<u16> {
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

            let raw = request.url();
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

pub fn main_window_url(app: &tauri::AppHandle) -> tauri::WebviewUrl {
    #[cfg(not(target_os = "windows"))]
    if let Some(port) = start_asset_server(app) {
        if let Ok(url) = format!("http://localhost:{port}").parse() {
            return tauri::WebviewUrl::External(url);
        }
    }
    #[cfg(target_os = "windows")]
    let _ = app;
    tauri::WebviewUrl::default()
}
