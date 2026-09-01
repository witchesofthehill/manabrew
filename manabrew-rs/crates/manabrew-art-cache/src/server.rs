//! Serving a card art cache to a network, so only one machine in a group has to
//! have gone online.
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

use crate::{key_from_request_path, mime_for, ImageCache};

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

impl ArtServer {
    /// `None` leaves the caller running and its peers falling back to the CDN.
    ///
    /// The cache is passed in rather than read from a global, so a headless host
    /// and the desktop shell can each own their own.
    pub fn spawn(bind_ip: std::net::IpAddr, cache: Arc<ImageCache>) -> Option<ArtServer> {
        Self::spawn_on(bind_ip, 0, cache)
    }

    /// A fixed port, for a host whose address a client learns from configuration
    /// rather than from a fresh mDNS record every time.
    pub fn spawn_on(
        bind_ip: std::net::IpAddr,
        port: u16,
        cache: Arc<ImageCache>,
    ) -> Option<ArtServer> {
        let server = Arc::new(tiny_http::Server::http((bind_ip, port)).ok()?);
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
}

fn serve(request: tiny_http::Request, cache: &ImageCache) {
    let raw = request.url().to_string();
    let Some(key) = key_from_request_path(&raw) else {
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
        ("Content-Type", mime_for(key)),
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

    /// The whole point of a host holding the art: another machine asks for a
    /// key over http and gets the bytes, with no Scryfall in the path.
    #[test]
    fn a_cached_key_is_served_to_the_network() {
        let dir = tempfile::tempdir().expect("temp dir");
        let cache = Arc::new(ImageCache::new(dir.path().to_path_buf()));
        cache
            .store("front/a/b/card.jpg", b"pixels", true)
            .expect("store");

        let server = ArtServer::spawn(Ipv4Addr::LOCALHOST.into(), cache).expect("spawn");
        let body = get(server.port, "/scryfall-img/front/a/b/card.jpg");
        assert!(body.contains("200 OK"), "{body}");
        assert!(body.ends_with("pixels"), "{body}");

        // And nothing it does not have, rather than fetching it.
        assert!(get(server.port, "/scryfall-img/front/missing.jpg").contains("404"));
        // And nothing outside the cache.
        assert!(get(server.port, "/scryfall-img/../../etc/passwd").contains("404"));
    }

    fn get(port: u16, path: &str) -> String {
        use std::io::{Read, Write};
        let mut stream =
            TcpStream::connect((Ipv4Addr::LOCALHOST, port)).expect("connect to art server");
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        )
        .expect("request");
        let mut body = String::new();
        let _ = stream.read_to_string(&mut body);
        body
    }

    /// Un-sharing a room has to close the listener. The shutdown flag was only
    /// read after `incoming_requests()` yielded the next request, so a dropped
    /// `ArtServer` left the thread parked on accept: the port stayed bound and
    /// the subnet could still read this machine's whole card cache.
    #[test]
    fn dropping_the_server_stops_the_port_answering() {
        let dir = tempfile::tempdir().expect("temp dir");
        let cache = Arc::new(ImageCache::new(dir.path().to_path_buf()));

        let server = ArtServer::spawn(Ipv4Addr::LOCALHOST.into(), cache).expect("spawn art server");
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
