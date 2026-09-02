const DEFAULT_CAPTURE_MAX_GB: u64 = 20;
const BYTES_PER_GB: u64 = 1024 * 1024 * 1024;

pub use crate::protocol::IceServer as TransportIceServer;

/// Reads `MANABREW_ICE_SERVERS`, in either of two shapes.
///
/// A comma or whitespace separated list of urls covers the common case, which
/// is one or more STUN servers and no credentials:
///
/// ```text
/// MANABREW_ICE_SERVERS=stun:stun.example.org:19302,stun:stun2.example.org
/// ```
///
/// A JSON array is the whole `RTCIceServer` shape, for TURN, which needs a
/// username and a credential:
///
/// ```text
/// MANABREW_ICE_SERVERS=[{"urls":["turn:turn.example.org"],"username":"u","credential":"p"}]
/// ```
///
/// Anything unparseable yields an empty list rather than a panic: a relay that
/// starts with no ICE servers keeps every seat on a working path, where one
/// that refuses to start serves nobody.
pub fn parse_ice_servers(raw: &str) -> Vec<TransportIceServer> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Vec::new();
    }
    if raw.starts_with('[') {
        return match serde_json::from_str::<Vec<TransportIceServer>>(raw) {
            Ok(servers) => servers.into_iter().filter(|s| !s.urls.is_empty()).collect(),
            Err(error) => {
                tracing::error!(%error, "MANABREW_ICE_SERVERS is not valid JSON; ignoring it");
                Vec::new()
            }
        };
    }
    let urls: Vec<String> = raw
        .split([',', ' ', '\t', '\n'])
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
        .collect();
    if urls.is_empty() {
        Vec::new()
    } else {
        vec![TransportIceServer {
            urls,
            username: None,
            credential: None,
        }]
    }
}

pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub health_port: u16,
    pub max_rooms: usize,
    pub server_key: String,
    pub official_key: Option<String>,
    pub events_dir: Option<String>,
    pub capture_dir: Option<String>,
    pub capture_max_gb: u64,
    pub deck_hub_enabled: bool,
    pub hub_deck_plays_url: Option<String>,
    pub hub_deck_plays_token: Option<String>,
    pub hub_jwks_url: Option<String>,
    /// Opt-in. Off, the relay never sends a roster and every room stays on the
    /// relay data plane, which is what it does today.
    pub direct_transport: bool,
    /// The iroh relay rooms should use. Unset leaves peers on iroh's own relay
    /// defaults.
    pub iroh_relay_url: Option<String>,
    /// ICE servers handed to the browser data plane. See
    /// [`parse_ice_servers`]; empty leaves WebRTC with host candidates only,
    /// which reaches nothing the embedded LAN relay does not already reach in
    /// one hop.
    pub ice_servers: Vec<TransportIceServer>,
}

impl ServerConfig {
    pub fn from_env() -> Self {
        ServerConfig {
            host: std::env::var("FORGE_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("FORGE_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(9443),
            health_port: std::env::var("FORGE_HEALTH_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(9444),
            max_rooms: std::env::var("FORGE_MAX_ROOMS")
                .ok()
                .and_then(|r| r.parse().ok())
                .unwrap_or(100),
            server_key: std::env::var("MANABREW_SERVER_KEY").unwrap_or_else(|_| "forge".into()),
            official_key: std::env::var("SECRET_MANABREW_KEY")
                .ok()
                .filter(|key| !key.is_empty()),
            events_dir: std::env::var("MANABREW_EVENTS_DIR")
                .ok()
                .filter(|dir| !dir.is_empty()),
            capture_dir: std::env::var("MANABREW_GAME_CAPTURE_DIR")
                .ok()
                .filter(|dir| !dir.is_empty()),
            capture_max_gb: std::env::var("MANABREW_GAME_CAPTURE_MAX_GB")
                .ok()
                .and_then(|gb| gb.parse().ok())
                .unwrap_or(DEFAULT_CAPTURE_MAX_GB),
            deck_hub_enabled: std::env::var("DECK_HUB").ok().is_some_and(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            }),
            hub_deck_plays_url: std::env::var("MANABREW_HUB_DECK_PLAYS_URL")
                .ok()
                .filter(|url| !url.is_empty()),
            hub_deck_plays_token: std::env::var("MANABREW_HUB_DECK_PLAYS_TOKEN")
                .ok()
                .filter(|token| !token.is_empty()),
            hub_jwks_url: std::env::var("MANABREW_HUB_JWKS_URL")
                .ok()
                .filter(|url| !url.is_empty()),
            direct_transport: std::env::var("MANABREW_DIRECT_TRANSPORT")
                .is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true")),
            iroh_relay_url: std::env::var("MANABREW_IROH_RELAY_URL")
                .ok()
                .filter(|url| !url.is_empty()),
            ice_servers: std::env::var("MANABREW_ICE_SERVERS")
                .ok()
                .map(|raw| parse_ice_servers(&raw))
                .unwrap_or_default(),
        }
    }

    pub fn capture_max_bytes(&self) -> u64 {
        self.capture_max_gb.saturating_mul(BYTES_PER_GB)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The common case: one or more STUN urls, no credentials.
    #[test]
    fn a_plain_url_list_becomes_one_server() {
        let parsed = parse_ice_servers("stun:a.example.org:19302, stun:b.example.org");
        assert_eq!(parsed.len(), 1);
        assert_eq!(
            parsed[0].urls,
            vec!["stun:a.example.org:19302", "stun:b.example.org"]
        );
        assert!(parsed[0].username.is_none());
    }

    /// TURN needs the full shape, so JSON is accepted too.
    #[test]
    fn json_carries_turn_credentials() {
        let parsed = parse_ice_servers(
            r#"[{"urls":["turn:t.example.org"],"username":"u","credential":"p"}]"#,
        );
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].username.as_deref(), Some("u"));
        assert_eq!(parsed[0].credential.as_deref(), Some("p"));
    }

    /// A relay that cannot parse its ICE config still starts. Every seat has a
    /// working path without one; a relay that refuses to boot serves nobody.
    #[test]
    fn anything_unparseable_yields_no_servers_rather_than_a_panic() {
        assert!(parse_ice_servers("").is_empty());
        assert!(parse_ice_servers("   ").is_empty());
        assert!(parse_ice_servers("[not json").is_empty());
        assert!(parse_ice_servers(r#"[{"username":"u"}]"#).is_empty());
        // An entry with no urls is useless to RTCPeerConnection, so it is dropped.
        assert!(parse_ice_servers(r#"[{"urls":[]}]"#).is_empty());
    }
}
