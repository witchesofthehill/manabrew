pub struct HubConfig {
    pub host: String,
    pub port: u16,
    pub db_path: String,
    pub jwt_key_path: String,
    pub analytics_import_db_path: Option<String>,
    pub relay_deck_plays_token: Option<String>,
    pub preset_decks_dir: String,
    pub deck_hub_enabled: bool,
    pub publish_per_hour: u32,
    pub publish_per_day: u32,
    pub play_reports_per_hour: u32,
    pub ranking_refresh_seconds: u64,
    pub auth: AuthConfig,
}

#[derive(Clone)]
pub struct AuthConfig {
    pub public_url: String,
    pub web_app_url: String,
    pub github: Option<OAuthClient>,
    pub discord: Option<OAuthClient>,
    pub resend_api_key: Option<String>,
    pub email_from: String,
    pub auth_emails_per_hour: u32,
    pub auth_attempts_per_hour: u32,
}

#[derive(Clone)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: String,
}

impl HubConfig {
    pub fn from_env() -> Self {
        let db_path = std::env::var("HUB_DB_PATH").unwrap_or_else(|_| "hub.db".into());
        HubConfig {
            host: std::env::var("HUB_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("HUB_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(9500),
            jwt_key_path: std::env::var("HUB_JWT_KEY_PATH")
                .ok()
                .filter(|path| !path.is_empty())
                .unwrap_or_else(|| {
                    std::path::Path::new(&db_path)
                        .with_file_name("jwt-ed25519.pkcs8")
                        .to_string_lossy()
                        .into_owned()
                }),
            db_path,
            analytics_import_db_path: std::env::var("HUB_ANALYTICS_IMPORT_DB_PATH")
                .ok()
                .filter(|path| !path.is_empty()),
            relay_deck_plays_token: std::env::var("HUB_RELAY_DECK_PLAYS_TOKEN")
                .ok()
                .filter(|token| !token.is_empty()),
            preset_decks_dir: std::env::var("HUB_PRESET_DECKS_DIR")
                .unwrap_or_else(|_| "public/preset_decks".into()),
            deck_hub_enabled: std::env::var("DECK_HUB").ok().is_some_and(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            }),
            publish_per_hour: std::env::var("HUB_PUBLISH_PER_HOUR")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(5),
            publish_per_day: std::env::var("HUB_PUBLISH_PER_DAY")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(20),
            play_reports_per_hour: std::env::var("HUB_PLAY_REPORTS_PER_HOUR")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(120),
            ranking_refresh_seconds: std::env::var("HUB_RANKING_REFRESH_SECONDS")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(15 * 60),
            auth: AuthConfig::from_env(),
        }
    }
}

impl AuthConfig {
    fn from_env() -> Self {
        AuthConfig {
            public_url: trimmed_var("HUB_PUBLIC_URL")
                .unwrap_or_else(|| "http://localhost:9500".into()),
            web_app_url: trimmed_var("WEB_APP_URL")
                .unwrap_or_else(|| "http://localhost:5173".into()),
            github: oauth_client("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"),
            discord: oauth_client("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"),
            resend_api_key: std::env::var("RESEND_API_KEY")
                .ok()
                .filter(|key| !key.is_empty()),
            email_from: std::env::var("AUTH_EMAIL_FROM")
                .ok()
                .filter(|from| !from.is_empty())
                .unwrap_or_else(|| "Manabrew <login@manabrew.app>".into()),
            auth_emails_per_hour: std::env::var("HUB_AUTH_EMAILS_PER_HOUR")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(30),
            auth_attempts_per_hour: std::env::var("HUB_AUTH_ATTEMPTS_PER_HOUR")
                .ok()
                .and_then(|n| n.parse().ok())
                .unwrap_or(60),
        }
    }
}

fn trimmed_var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

fn oauth_client(id_var: &str, secret_var: &str) -> Option<OAuthClient> {
    let client_id = std::env::var(id_var).ok().filter(|v| !v.is_empty())?;
    let client_secret = std::env::var(secret_var).ok().filter(|v| !v.is_empty())?;
    Some(OAuthClient {
        client_id,
        client_secret,
    })
}
