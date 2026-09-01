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
    /// Held so `Drop` can `unblock` it. A flag alone is only read after the
    /// next request arrives, so un-sharing a room left the thread parked on
    /// accept with the port still bound and still answering the subnet.
    server: Arc<tiny_http::Server>,
}

impl Drop for ArtServer {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

/// `None` leaves the room hosted and the other seats falling back to the CDN.
///
/// The cache is passed in rather than read from the global, so a test does not
/// have to plant one.
pub fn spawn(bind_ip: std::net::IpAddr, cache: Arc<ImageCache>) -> Option<ArtServer> {
    let server = Arc::new(tiny_http::Server::http((bind_ip, 0)).ok()?);
    let port = server.server_addr().to_ip()?.port();
    let accept = server.clone();

    std::thread::spawn(move || {
        // `unblock` ends this iterator, so the thread exits and the listener is
        // closed rather than waiting for one more request to notice.
        for request in accept.incoming_requests() {
            serve(request, &cache);
        }
    });

    Some(ArtServer { port, server })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, TcpStream};
    use std::time::{Duration, Instant};

    fn answers(port: u16) -> bool {
        TcpStream::connect_timeout(
            &(Ipv4Addr::LOCALHOST, port).into(),
            Duration::from_millis(250),
        )
        .is_ok()
    }

    /// Un-sharing a room has to close the listener. The shutdown flag was only
    /// read after `incoming_requests()` yielded the next request, so a dropped
    /// `ArtServer` left the thread parked on accept: the port stayed bound and
    /// the subnet could still read this machine's whole card cache.
    #[test]
    fn dropping_the_server_stops_the_port_answering() {
        let dir = tempfile::tempdir().expect("temp dir");
        let cache = Arc::new(ImageCache::new(dir.path().to_path_buf()));

        let server = spawn(Ipv4Addr::LOCALHOST.into(), cache).expect("spawn art server");
        let port = server.port;
        assert!(answers(port), "the listener should be up while the room is");

        drop(server);

        // The accept loop ends on `unblock`, then the thread drops its handle
        // and the socket closes.
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if !answers(port) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("port {port} still answering after the ArtServer was dropped");
    }
}
