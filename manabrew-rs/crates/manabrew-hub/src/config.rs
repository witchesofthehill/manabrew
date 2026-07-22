pub struct HubConfig {
    pub host: String,
    pub port: u16,
    pub db_path: String,
    pub events_db_path: Option<String>,
    pub publish_per_hour: u32,
    pub publish_per_day: u32,
}

impl HubConfig {
    pub fn from_env() -> Self {
        HubConfig {
            host: std::env::var("HUB_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("HUB_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(9500),
            db_path: std::env::var("HUB_DB_PATH").unwrap_or_else(|_| "hub.db".into()),
            events_db_path: std::env::var("EVENTS_DB_PATH")
                .ok()
                .filter(|path| !path.is_empty()),
            publish_per_hour: std::env::var("HUB_PUBLISH_PER_HOUR")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(5),
            publish_per_day: std::env::var("HUB_PUBLISH_PER_DAY")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(20),
        }
    }
}
