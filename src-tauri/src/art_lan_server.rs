//! Serving this machine's card art to the local network, so only one machine in
//! a group has to have gone online.
//!
//! Deliberately not part of `asset_server`: that one refuses anything not
//! addressed to loopback as anti-DNS-rebinding, and relaxing it would widen the
//! surface that serves the app's own assets and answers its commands. This is a
//! second listener with one route, no upstream fetch, and a lifetime bounded by
//! the room being hosted.
//!
//! Serving art is not the same trust decision as serving the relay: the relay
//! is password-gated, this is world-readable to the subnet. It starts only with
//! `share_on_lan`, which is already a deliberate act.

use std::sync::Arc;

use crate::image_cache::{self, ImageCache};

pub struct ArtServer {
    pub port: u16,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
}

impl Drop for ArtServer {
    fn drop(&mut self) {
        self.shutdown
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// `None` leaves the room hosted and the other seats falling back to the CDN.
pub fn spawn(bind_ip: std::net::IpAddr) -> Option<ArtServer> {
    let cache = image_cache::cache()?;
    let server = tiny_http::Server::http((bind_ip, 0)).ok()?;
    let port = server.server_addr().to_ip()?.port();
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop = shutdown.clone();

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            if stop.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            serve(request, &cache);
        }
    });

    Some(ArtServer { port, shutdown })
}

fn serve(request: tiny_http::Request, cache: &ImageCache) {
    let raw = request.url().to_string();
    let Some(key) = image_cache::key_from_request_path(&raw) else {
        let _ = request.respond(tiny_http::Response::empty(404));
        return;
    };
    // Read-only on purpose: a host with no internet cannot fetch, and a host
    // with one must not become an open proxy for the subnet.
    let Some(bytes) = cache.read(key) else {
        let _ = request.respond(tiny_http::Response::empty(404));
        return;
    };
    let mut response = tiny_http::Response::from_data(bytes);
    for (name, value) in [
        ("Content-Type", image_cache::mime_for(key)),
        ("Access-Control-Allow-Origin", "*"),
        ("Cross-Origin-Resource-Policy", "cross-origin"),
        ("Cache-Control", "public, max-age=31536000, immutable"),
    ] {
        if let Ok(header) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
    let _ = request.respond(response);
}
