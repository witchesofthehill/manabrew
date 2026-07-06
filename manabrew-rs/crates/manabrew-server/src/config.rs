const DEFAULT_CAPTURE_MAX_GB: u64 = 20;
const BYTES_PER_GB: u64 = 1024 * 1024 * 1024;

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
        }
    }

    pub fn capture_max_bytes(&self) -> u64 {
        self.capture_max_gb.saturating_mul(BYTES_PER_GB)
    }
}
