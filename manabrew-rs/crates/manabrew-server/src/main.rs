use std::net::SocketAddr;
use std::sync::Arc;

use manabrew_server::{analytics, config, deck_play_events, metrics, server, state};

fn art_cache(dir: &str) -> Arc<manabrew_art_cache::ImageCache> {
    let cache = Arc::new(manabrew_art_cache::ImageCache::new(
        std::path::PathBuf::from(dir).join(manabrew_art_cache::CACHE_DIR),
    ));
    let counted = cache.clone();
    std::thread::spawn(move || counted.reconcile());
    cache
}

/// Fetches every card's art at the styles a board actually draws, then exits.
async fn download_art(config: &config::ServerConfig) -> Result<(), String> {
    let dir = config
        .art_dir
        .as_deref()
        .ok_or("set MANABREW_ART_DIR to the directory that should hold the art")?;
    let cache = art_cache(dir);
    // Every variant, because a server serves whichever style each of its
    // players has chosen and cannot know in advance which.
    let variants = ["normal", "border_crop", "art_crop"].map(str::to_string);
    // Measured per card: normal 113KB, border_crop 101KB, art_crop 77KB.
    let estimate = 291 * 1024 * 38_628;
    let result = cache
        .download_all(&variants, estimate, |progress| {
            if progress.done % 500 == 0 || progress.done == progress.total {
                tracing::info!(
                    "[art] {}/{} ({:.1} GB)",
                    progress.done,
                    progress.total,
                    progress.bytes as f64 / 1_073_741_824.0
                );
            }
        })
        .await?;
    tracing::info!(
        "[art] done: {} fetched, {} already there, {} failed",
        result.fetched,
        result.already_cached,
        result.failed
    );
    Ok(())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "manabrew_server=info".into()),
        )
        .init();

    let config = config::ServerConfig::from_env();

    // Filling the cache is a job, not a server. Somebody runs this once when
    // they set the box up and never thinks about it again.
    if std::env::args().any(|arg| arg == "--download-art") {
        std::process::exit(match download_art(&config).await {
            Ok(()) => 0,
            Err(error) => {
                tracing::error!("{error}");
                1
            }
        });
    }

    let metrics_handle = metrics::install();
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid address");
    let health_addr: SocketAddr = format!("{}:{}", config.host, config.health_port)
        .parse()
        .expect("Invalid health address");

    let analytics = analytics::AnalyticsHandle::from_config(&config);
    let deck_play_events = deck_play_events::DeckPlayEventHandle::from_config(&config);
    let state = Arc::new(
        state::ServerState::new(
            config.server_key.clone(),
            config.max_rooms,
            config.official_key.clone(),
            analytics,
            deck_play_events,
            config.hub_jwks_url.clone(),
        )
        .with_art_base_url(config.art_base_url.clone()),
    );

    // Serving art is the reason to run a relay of your own: one machine holds
    // the images so nobody else downloads 8GB of them.
    let art = config.art_dir.as_ref().and_then(|dir| {
        let cache = art_cache(dir);
        let bind = config
            .host
            .parse()
            .unwrap_or(std::net::IpAddr::from([0, 0, 0, 0]));
        let server = manabrew_art_cache::ArtServer::spawn_on(bind, config.art_port, cache);
        match &server {
            Some(server) => tracing::info!(port = server.port, dir, "[art] serving card art"),
            None => tracing::error!(
                port = config.art_port,
                "[art] could not bind the art listener"
            ),
        }
        server
    });

    // So four desktops find this box without anyone typing its address.
    let _advert = config.lan_advertise.then(|| {
        match manabrew_lan_discovery::advertise(
            manabrew_lan_discovery::LanRole::Relay,
            &config.host,
            config.port,
            art.as_ref().map(|server| server.port),
        ) {
            Ok(advert) => {
                tracing::info!("[lan] answering mdns as a relay on this network");
                Some(advert)
            }
            Err(error) => {
                tracing::error!("[lan] could not advertise: {error}");
                None
            }
        }
    });

    // A relay in a cupboard is the half of a self-hosted setup nobody logs into,
    // and one left behind far enough refuses its own clients on
    // `PROTOCOL_VERSION`. Off unless asked: production is deployed on purpose.
    let updating = state.clone();
    tokio::spawn(manabrew_server::self_update::run(
        manabrew_server::self_update::UpdateConfig::from_env(),
        move || {
            !updating
                .rooms
                .iter()
                .any(|room| room.status == manabrew_server::protocol::RoomStatus::InGame)
        },
    ));

    if !state.identity.hub_configured() {
        tracing::info!("[auth] no hub jwks url -- account identity disabled, device proofs only");
    }

    server::run_server(state, addr, health_addr, metrics_handle).await;
}
