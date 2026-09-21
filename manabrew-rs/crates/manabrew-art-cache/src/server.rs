//! Serving a card art cache to a network, so only one machine in a group has to
//! have gone online.
//!
//! Deliberately not `asset_server` with its loopback check relaxed: that one
//! serves the app's assets and answers its commands. This has one route, never
//! fetches upstream, and is world-readable to the subnet, which is why it only
//! starts on a deliberate act.

use std::sync::Arc;

use crate::cards::{parse_request, CacheRequest, CardStore};
use crate::{key_from_request_path, mime_for, ImageCache};

pub struct ArtServer {
    pub port: u16,
    /// Held so `Drop` can `unblock` it: a flag is only read after the next
    /// request arrives, leaving the port bound and answering.
    server: Arc<tiny_http::Server>,
}

impl Drop for ArtServer {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

impl ArtServer {
    /// `None` leaves peers falling back to the CDN. The cache is passed in so a
    /// headless host and the desktop shell can each own one.
    pub fn spawn(bind_ip: std::net::IpAddr, cache: Arc<ImageCache>) -> Option<ArtServer> {
        Self::spawn_on(bind_ip, 0, cache)
    }

    /// Fixed, for a host whose address a client learns from configuration.
    pub fn spawn_on(
        bind_ip: std::net::IpAddr,
        port: u16,
        cache: Arc<ImageCache>,
    ) -> Option<ArtServer> {
        let server = Arc::new(tiny_http::Server::http((bind_ip, port)).ok()?);
        let port = server.server_addr().to_ip()?.port();
        let accept = server.clone();
        // The data sits beside the pictures, so holding the cache is holding
        // both and the two can never be paired wrong.
        let cards = CardStore::new(cache.root());

        std::thread::spawn(move || {
            // `unblock` ends this iterator, closing the listener.
            for request in accept.incoming_requests() {
                serve(request, &cache, &cards);
            }
        });

        Some(ArtServer { port, server })
    }
}

fn serve(request: tiny_http::Request, cache: &ImageCache, cards: &CardStore) {
    let raw = request.url().to_string();
    if let Some(asked) = parse_request(&raw) {
        serve_json(
            request,
            match asked {
                CacheRequest::Card(name) => cards.read(&name),
                CacheRequest::Printing(set, number) => cards.read_printing(&set, &number),
                CacheRequest::Sets => cache.read_sets(),
                CacheRequest::Names => cache.read_names(),
                CacheRequest::Rulings(oracle_id) => cards.read_rulings(&oracle_id),
            },
        );
        return;
    }
    let Some(key) = key_from_request_path(&raw) else {
        let _ = request.respond(tiny_http::Response::empty(404));
        return;
    };
    // Read-only: a host with internet must not become a proxy for the subnet.
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

/// Whatever the cache was asked for, so a seat with no internet can still learn
/// what it is holding and where its picture lives. Named rather than keyed by
/// url, because a name is all a client that never reached the api has.
fn serve_json(request: tiny_http::Request, body: Option<Vec<u8>>) {
    let Some(bytes) = body else {
        let _ = request.respond(tiny_http::Response::empty(404));
        return;
    };
    let mut response = tiny_http::Response::from_data(bytes);
    for (header, value) in [
        ("Content-Type", "application/json"),
        ("Access-Control-Allow-Origin", "*"),
        ("Cross-Origin-Resource-Policy", "cross-origin"),
        // Cards are renamed and reprinted, so this is not immutable the way a
        // picture at a hashed path is.
        ("Cache-Control", "public, max-age=86400"),
    ] {
        if let Ok(header) = tiny_http::Header::from_bytes(header.as_bytes(), value.as_bytes()) {
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

    /// The picture is useless to a seat that cannot learn its url.
    #[test]
    fn a_cached_card_record_is_served_to_the_network() {
        let dir = tempfile::tempdir().expect("temp dir");
        let record = serde_json::json!({
            "name": "Lightning Bolt",
            "image_uris": { "normal": "https://cards.scryfall.io/normal/front/a/b/bolt.jpg" },
        });
        let cache = Arc::new(ImageCache::new(dir.path().to_path_buf()));
        assert_eq!(cache.store_records(std::slice::from_ref(&record)), 1);

        let server = ArtServer::spawn(Ipv4Addr::LOCALHOST.into(), cache).expect("spawn");

        let body = get(server.port, "/scryfall-card/Lightning%20Bolt");
        assert!(body.contains("200 OK"), "{body}");
        assert!(
            body.ends_with(&serde_json::to_string(&record).expect("json")),
            "{body}"
        );
        assert!(get(server.port, "/scryfall-card/Black%20Lotus").contains("404"));
        assert!(get(server.port, "/scryfall-sets").contains("404"));
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

    /// A flag was only read after the next request arrived, so the port stayed
    /// bound and serving the subnet after the room was gone.
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
