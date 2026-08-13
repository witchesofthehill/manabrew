use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, SystemTime};

use flate2::read::GzDecoder;
use manabrew_hub::dto::CardPrintingIdentifier;
use serde::Deserialize;
use tokio::io::AsyncWriteExt;

const BULK_DATA_URL: &str = "https://api.scryfall.com/bulk-data";
const REFRESH_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct CardIndex {
    printings: HashMap<String, HashSet<String>>,
}

impl CardIndex {
    fn insert(&mut self, card: BulkCard) {
        let names = self
            .printings
            .entry(printing_key(&card.set, &card.collector_number))
            .or_default();
        names.insert(normalize_name(&card.name));
        for part in card.name.split(" // ") {
            names.insert(normalize_name(part));
        }
        for face in card.card_faces {
            names.insert(normalize_name(&face.name));
        }
    }

    pub fn matches(&self, identifier: &CardPrintingIdentifier) -> bool {
        self.printings
            .get(&printing_key(
                &identifier.set_code,
                &identifier.collector_number,
            ))
            .is_some_and(|names| names.contains(&normalize_name(&identifier.name)))
    }
}

pub struct ScryfallBulkIndex {
    path: PathBuf,
    index: RwLock<Option<CardIndex>>,
}

impl ScryfallBulkIndex {
    pub fn new(path: PathBuf) -> Self {
        let index = match load_index(&path) {
            Ok(index) => {
                tracing::info!(path = %path.display(), printings = index.printings.len(), "loaded Scryfall bulk index");
                Some(index)
            }
            Err(error) if path.exists() => {
                tracing::warn!(%error, path = %path.display(), "failed to load Scryfall bulk index");
                None
            }
            Err(_) => None,
        };
        Self {
            path,
            index: RwLock::new(index),
        }
    }

    pub fn verify(&self, identifiers: &[CardPrintingIdentifier]) -> Option<Vec<bool>> {
        let index = self.index.read().unwrap();
        index
            .as_ref()
            .map(|index| identifiers.iter().map(|item| index.matches(item)).collect())
    }

    pub async fn refresh_if_needed(&self, client: &reqwest::Client) -> Result<(), String> {
        if self.index.read().unwrap().is_some() && file_is_fresh(&self.path) {
            return Ok(());
        }
        let download_uri = bulk_download_uri(client).await?;
        let temporary_path = self.path.with_extension("json.download");
        download_file(client, &download_uri, &temporary_path).await?;
        let parse_path = temporary_path.clone();
        let index = tokio::task::spawn_blocking(move || load_index(&parse_path))
            .await
            .map_err(|error| error.to_string())??;
        std::fs::rename(&temporary_path, &self.path).map_err(|error| error.to_string())?;
        let count = index.printings.len();
        *self.index.write().unwrap() = Some(index);
        tracing::info!(path = %self.path.display(), printings = count, "refreshed Scryfall bulk index");
        Ok(())
    }
}

pub async fn refresh_loop(index: std::sync::Arc<ScryfallBulkIndex>, client: reqwest::Client) {
    loop {
        let delay = match index.refresh_if_needed(&client).await {
            Ok(()) => REFRESH_INTERVAL,
            Err(error) => {
                tracing::warn!(%error, "Scryfall bulk refresh failed");
                RETRY_INTERVAL
            }
        };
        tokio::time::sleep(delay).await;
    }
}

fn printing_key(set: &str, collector_number: &str) -> String {
    format!(
        "{}\u{1f}{}",
        set.trim().to_lowercase(),
        collector_number.trim().to_lowercase()
    )
}

fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn file_is_fresh(path: &Path) -> bool {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age < REFRESH_INTERVAL)
}

fn load_index(path: &Path) -> Result<CardIndex, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(GzDecoder::new(file));
    let mut line = String::new();
    let mut index = CardIndex::default();
    loop {
        line.clear();
        if reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            break;
        }
        index.insert(serde_json::from_str(&line).map_err(|error| error.to_string())?);
    }
    Ok(index)
}

#[derive(Deserialize)]
struct BulkCard {
    name: String,
    set: String,
    collector_number: String,
    #[serde(default)]
    card_faces: Vec<BulkCardFace>,
}

#[derive(Deserialize)]
struct BulkCardFace {
    name: String,
}

#[derive(Deserialize)]
struct BulkManifest {
    data: Vec<BulkDataItem>,
}

#[derive(Deserialize)]
struct BulkDataItem {
    r#type: String,
    jsonl_download_uri: String,
}

async fn bulk_download_uri(client: &reqwest::Client) -> Result<String, String> {
    let manifest = client
        .get(BULK_DATA_URL)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<BulkManifest>()
        .await
        .map_err(|error| error.to_string())?;
    manifest
        .data
        .into_iter()
        .find(|item| item.r#type == "default_cards")
        .map(|item| item.jsonl_download_uri)
        .ok_or_else(|| "Scryfall default_cards bulk dataset is unavailable".into())
}

async fn download_file(client: &reqwest::Client, url: &str, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|error| error.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
    }
    file.flush().await.map_err(|error| error.to_string())
}
