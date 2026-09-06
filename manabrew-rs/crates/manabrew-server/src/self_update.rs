//! Keeps a self-hosted relay current without anyone logging into the box: a
//! relay left behind eventually refuses its own clients on `PROTOCOL_VERSION`.
//!
//! Off unless asked, since the same binary runs production. Trust is the
//! minisign signature CI produces; a download that does not verify is
//! discarded.

use std::time::Duration;

use tracing::{error, info, warn};

const DEFAULT_MANIFEST_URL: &str = "https://play.manabrew.app/manifest.json";
const DEFAULT_POLL_SECS: u64 = 3600;
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The key CI signs release assets with, from `tauri.conf.json`. Regenerating
/// the pair orphans every installed copy, desktop and server alike.
const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ1OUFFMThDMDA1NzdBNkIKUldScmVsY0FqT0dhMWI2QThlNlNNV1dFamNaOU90MXBZak5nVTd1QlRoUHAwdFBOdnVzN2NFcUQK";

const ASSET: &str = "manabrew-server-linux-x86_64";

pub struct UpdateConfig {
    pub enabled: bool,
    pub manifest_url: String,
    pub poll: Duration,
}

impl UpdateConfig {
    pub fn from_env() -> Self {
        Self {
            enabled: std::env::var("MANABREW_SELF_UPDATE")
                .map(|value| {
                    matches!(
                        value.to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on"
                    )
                })
                .unwrap_or(false),
            manifest_url: std::env::var("MANABREW_MANIFEST_URL")
                .unwrap_or_else(|_| DEFAULT_MANIFEST_URL.to_string()),
            poll: std::env::var("MANABREW_SELF_UPDATE_POLL_SECS")
                .ok()
                .and_then(|value| value.parse().ok())
                .map(Duration::from_secs)
                .unwrap_or(Duration::from_secs(DEFAULT_POLL_SECS)),
        }
    }
}

/// Replaces this binary when a newer one is published, then exits so the
/// service manager starts it again.
///
/// `is_idle` is what stops it happening mid-game. A relay that restarts under a
/// live table is worse than one that never updates, so a stale relay waits.
pub async fn run<F>(config: UpdateConfig, is_idle: F)
where
    F: Fn() -> bool + Send + 'static,
{
    if !config.enabled {
        return;
    }
    let mut tick = tokio::time::interval(config.poll);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        let Some(manifest) = fetch_manifest(&config.manifest_url).await else {
            continue;
        };
        let Some(latest) = manifest.package("manabrew-server") else {
            continue;
        };
        if !is_behind(SERVER_VERSION, &latest) {
            continue;
        }
        let Some(tag) = manifest.package("manabrew") else {
            warn!("[update] manifest names no app version, so no release to download from");
            continue;
        };
        if !is_idle() {
            info!(
                current = SERVER_VERSION,
                latest = %latest,
                "[update] newer relay published, waiting for the last game to finish"
            );
            continue;
        }
        match replace_self(&tag).await {
            Ok(()) => {
                warn!(
                    from = SERVER_VERSION,
                    to = %latest,
                    "[update] replaced this binary, exiting so the service manager restarts it"
                );
                std::process::exit(0);
            }
            Err(error) => error!("[update] {error}"),
        }
    }
}

struct Manifest(serde_json::Value);

impl Manifest {
    fn package(&self, name: &str) -> Option<String> {
        self.0
            .get("packages")?
            .get(name)?
            .as_str()
            .map(str::to_string)
    }
}

async fn fetch_manifest(url: &str) -> Option<Manifest> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let body: serde_json::Value = client.get(url).send().await.ok()?.json().await.ok()?;
    Some(Manifest(body))
}

/// Semver-ish, on the same shape `self-hosted-node` compares: a published
/// version that sorts above this one means this one is behind.
pub fn is_behind(current: &str, latest: &str) -> bool {
    fn parts(version: &str) -> Vec<u64> {
        version
            .split(['.', '-', '+'])
            .map_while(|part| part.parse().ok())
            .collect()
    }
    let (current, latest) = (parts(current), parts(latest));
    if current.is_empty() || latest.is_empty() {
        return false;
    }
    latest > current
}

/// Downloads the published binary, checks its signature, and moves it over this
/// one. The rename is what makes it safe to do while running: the old inode
/// stays alive until this process exits, which it does immediately after.
async fn replace_self(tag: &str) -> Result<(), String> {
    let base =
        format!("https://github.com/witchesofthehill/manabrew/releases/download/v{tag}/{ASSET}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let binary = get(&client, &base).await?;
    let signature = get(&client, &format!("{base}.sig")).await?;
    verify(&binary, &signature)?;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let staged = exe.with_extension("new");
    std::fs::write(&staged, &binary).map_err(|e| format!("writing {staged:?}: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    std::fs::rename(&staged, &exe).map_err(|e| format!("replacing {exe:?}: {e}"))?;
    Ok(())
}

async fn get(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{url}: HTTP {}", response.status()));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("{url}: {e}"))
}

/// An unsigned or wrongly signed download is discarded rather than run. This is
/// the only thing standing between a manifest and code running as this service.
fn verify(binary: &[u8], signature: &[u8]) -> Result<(), String> {
    let raw =
        String::from_utf8(base64_decode(PUBKEY).ok_or_else(|| "pubkey is not base64".to_string())?)
            .map_err(|_| "pubkey is not utf8".to_string())?;
    // `decode` wants the whole two-line block, comment included, which is what
    // `tauri.conf.json` stores base64'd.
    let key = minisign_verify::PublicKey::decode(&raw).map_err(|e| format!("bad pubkey: {e}"))?;
    let signature =
        String::from_utf8(signature.to_vec()).map_err(|_| "signature is not utf8".to_string())?;
    let signature = minisign_verify::Signature::decode(&signature)
        .map_err(|e| format!("bad signature: {e}"))?;
    key.verify(binary, &signature, false)
        .map_err(|e| format!("the published binary did not verify: {e}"))
}

fn base64_decode(value: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newer_published_version_is_what_counts_as_behind() {
        assert!(is_behind("0.26.1", "0.26.2"));
        assert!(is_behind("0.26.1", "0.27.0"));
        assert!(!is_behind("0.26.1", "0.26.1"));
        assert!(!is_behind("0.27.0", "0.26.1"));
        // A manifest that says something unparseable must not trigger a
        // download, because the download replaces this binary.
        assert!(!is_behind("0.26.1", "not-a-version"));
        assert!(!is_behind("", "0.26.1"));
    }

    /// The embedded key has to be the one CI signs with, and it has to decode.
    /// A key that does not parse would fail every update silently.
    #[test]
    fn the_signing_key_decodes() {
        let raw = String::from_utf8(base64_decode(PUBKEY).expect("base64")).expect("utf8");
        minisign_verify::PublicKey::decode(&raw).expect("a usable minisign key");
    }

    /// Nothing unsigned reaches the disk. This is the whole trust boundary.
    #[test]
    fn a_binary_with_a_bogus_signature_is_refused() {
        let error = verify(b"pretend binary", b"not a signature").expect_err("must refuse");
        assert!(error.contains("bad signature"), "{error}");
    }
}
