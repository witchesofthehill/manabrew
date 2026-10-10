#![cfg_attr(not(forge_backend), allow(dead_code))]

use manabrew_relay_protocol::{ClientMessage, DecisionJournalRequest, JournalHandoff};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub(crate) fn enabled() -> bool {
    std::env::var("SELF_HOSTED_NODE_DECISION_JOURNAL")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

static ARTIFACTS: OnceLock<(String, String)> = OnceLock::new();

pub(crate) fn init_artifacts(engine: &Path, assets: &Path) -> Result<(), String> {
    if ARTIFACTS.get().is_some() {
        return Ok(());
    }
    let engine = hash_file(engine).map_err(|e| format!("cannot identify journal engine: {e}"))?;
    let mut paths = Vec::new();
    collect_assets(assets, assets, &mut paths)
        .map_err(|e| format!("cannot identify journal assets: {e}"))?;
    paths.sort();
    if paths.is_empty() {
        return Err("journal assets directory is empty".into());
    }
    let mut digest = Sha256::new();
    digest.update(b"manabrew-assets-v1\0");
    for path in paths {
        let name = path
            .to_str()
            .ok_or("journal asset path is not UTF-8")?
            .replace('\\', "/");
        digest.update((name.len() as u64).to_be_bytes());
        digest.update(name.as_bytes());
        digest.update(hash_file(&assets.join(&path)).map_err(|e| e.to_string())?);
    }
    let _ = ARTIFACTS.set((engine, format!("{:x}", digest.finalize())));
    Ok(())
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn collect_assets(
    root: &Path,
    directory: &Path,
    paths: &mut Vec<std::path::PathBuf>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect_assets(root, &entry.path(), paths)?;
        } else if kind.is_file() {
            paths.push(entry.path().strip_prefix(root).unwrap().to_owned());
        } else {
            return Err(std::io::Error::other(
                "journal assets must be regular files",
            ));
        }
    }
    Ok(())
}

struct Pending {
    id: String,
    request: DecisionJournalRequest,
    reply: mpsc::Sender<Result<String, String>>,
}

#[derive(Default)]
struct State {
    generation: u64,
    pending: Option<Pending>,
}

pub(crate) struct JournalDelivery {
    game_id: String,
    official_key: String,
    state: Mutex<State>,
}

#[derive(Deserialize)]
struct Position {
    epoch: i64,
    sequence: i64,
    unavailable_reason: Option<String>,
}

impl Position {
    fn usable(self) -> Result<Self, RpcError> {
        if self.unavailable_reason.is_some() || self.epoch < 1 || self.sequence < 0 {
            Err(RpcError::Failed("relay journal is unavailable".into()))
        } else {
            Ok(self)
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct JournalPage {
    manifest: Manifest,
    position: Position,
    entries: Vec<serde_json::Value>,
}

#[derive(Deserialize, PartialEq)]
struct Manifest {
    engine_sha256: String,
    assets_sha256: String,
    start_request: String,
}

pub(crate) struct RecoveredJournal {
    pub start_request: String,
    pub entries: Vec<serde_json::Value>,
}

impl RecoveredJournal {
    pub(crate) fn sequence(&self) -> i64 {
        self.entries.len() as i64
    }
}

pub(crate) struct JournalRecovery {
    pub journal: RecoveredJournal,
    pub replayed: mpsc::Sender<Result<(), String>>,
    pub live: mpsc::Receiver<()>,
}

pub(crate) const READ_LIMIT: u32 = 4096;

pub(crate) fn handoff_read(
    game_id: &str,
    official_key: &str,
    handoff: JournalHandoff,
    after: i64,
    request_id: String,
) -> ClientMessage {
    ClientMessage::DecisionJournal {
        game_id: game_id.to_string(),
        request_id,
        official_key: official_key.to_string(),
        request: DecisionJournalRequest::Read {
            after,
            limit: READ_LIMIT,
        },
        handoff: Some(handoff),
    }
}

/// Accumulates paginated reads of one durable prefix and refuses anything a
/// fresh engine cannot replay to exactly that prefix.
#[derive(Default)]
pub(crate) struct JournalHistory {
    manifest: Option<Manifest>,
    through: Option<i64>,
    entries: Vec<serde_json::Value>,
}

impl JournalHistory {
    pub(crate) fn after(&self) -> i64 {
        self.entries.len() as i64
    }

    pub(crate) fn complete(&self) -> bool {
        self.through == Some(self.after())
    }

    pub(crate) fn add_page(&mut self, raw: &str) -> Result<(), String> {
        let page: JournalPage =
            serde_json::from_str(raw).map_err(|_| "invalid journal page".to_string())?;
        if let Some(reason) = page.position.unavailable_reason {
            return Err(format!("journal is invalidated: {reason}"));
        }
        if self
            .manifest
            .as_ref()
            .is_some_and(|held| *held != page.manifest)
        {
            return Err("journal manifest changed between reads".into());
        }
        if self
            .through
            .is_some_and(|through| page.position.sequence < through)
        {
            return Err("durable journal prefix shrank".into());
        }
        self.manifest = Some(page.manifest);
        self.through = Some(page.position.sequence);
        if page.entries.is_empty() && !self.complete() {
            return Err("journal read made no progress".into());
        }
        for entry in page.entries {
            if entry.get("sequence").and_then(|value| value.as_i64()) != Some(self.after() + 1) {
                return Err("journal sequence gap".into());
            }
            self.entries.push(entry);
        }
        if self.through.is_some_and(|through| self.after() > through) {
            return Err("journal entries exceed the durable prefix".into());
        }
        Ok(())
    }

    pub(crate) fn recover(self, game_id: &str) -> Result<RecoveredJournal, String> {
        if !self.complete() {
            return Err("journal prefix is incomplete".into());
        }
        let manifest = self.manifest.ok_or("journal manifest is missing")?;
        let (engine, assets) = ARTIFACTS
            .get()
            .ok_or("journal artifacts were not initialized")?;
        if manifest.engine_sha256 != *engine {
            return Err("journal engine artifact mismatch".into());
        }
        if manifest.assets_sha256 != *assets {
            return Err("journal rules assets mismatch".into());
        }
        let start: serde_json::Value = serde_json::from_str(&manifest.start_request)
            .map_err(|_| "journal start request is not JSON".to_string())?;
        if start.get("gameId").and_then(|value| value.as_str()) != Some(game_id)
            || start
                .get("decisionJournal")
                .and_then(|value| value.as_bool())
                != Some(true)
            || start
                .get("decisionJournalCommitBarrier")
                .and_then(|value| value.as_bool())
                != Some(true)
        {
            return Err("journal start request does not describe this gated game".into());
        }
        Ok(RecoveredJournal {
            start_request: manifest.start_request,
            entries: self.entries,
        })
    }
}

enum RpcError {
    Retry,
    Failed(String),
}

impl JournalDelivery {
    pub(crate) fn new(game_id: String, official_key: String) -> Self {
        Self {
            game_id,
            official_key,
            state: Mutex::new(State::default()),
        }
    }

    pub(crate) fn reconnect(&self) {
        let mut state = self.state.lock().unwrap();
        state.generation += 1;
        state.pending = None;
    }

    pub(crate) fn request_after(&self, previous: Option<&str>) -> Option<(String, ClientMessage)> {
        let state = self.state.lock().unwrap();
        let pending = state.pending.as_ref()?;
        if previous == Some(pending.id.as_str()) {
            return None;
        }
        Some((
            pending.id.clone(),
            ClientMessage::DecisionJournal {
                game_id: self.game_id.clone(),
                request_id: pending.id.clone(),
                official_key: self.official_key.clone(),
                request: pending.request.clone(),
                handoff: None,
            },
        ))
    }

    pub(crate) fn complete(&self, request_id: &str, result: Result<String, String>) {
        let mut state = self.state.lock().unwrap();
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == request_id)
        {
            let _ = state.pending.take().unwrap().reply.send(result);
        }
    }

    fn rpc(
        &self,
        generation: u64,
        request: DecisionJournalRequest,
        cancel: &AtomicBool,
    ) -> Result<Position, RpcError> {
        let raw = self.call(generation, request, cancel)?;
        serde_json::from_str::<Position>(&raw)
            .map_err(|_| RpcError::Failed("invalid journal receipt".into()))
            .and_then(Position::usable)
    }

    fn call(
        &self,
        generation: u64,
        request: DecisionJournalRequest,
        cancel: &AtomicBool,
    ) -> Result<String, RpcError> {
        let (tx, rx) = mpsc::channel();
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut state = self.state.lock().unwrap();
            if state.generation != generation {
                return Err(RpcError::Retry);
            }
            state.pending = Some(Pending {
                id: id.clone(),
                request,
                reply: tx,
            });
        }
        let started = Instant::now();
        let result = loop {
            if cancel.load(Ordering::Relaxed) {
                break Err(RpcError::Failed("journal delivery cancelled".into()));
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(raw)) => break Ok(raw),
                Ok(Err(error)) if error.ends_with("busy; retry") => break Err(RpcError::Retry),
                Ok(Err(error)) => {
                    break Err(RpcError::Failed(format!(
                        "journal delivery rejected: {error}"
                    )))
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break Err(RpcError::Retry),
                Err(mpsc::RecvTimeoutError::Timeout)
                    if started.elapsed() >= Duration::from_secs(5) =>
                {
                    break Err(RpcError::Retry)
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        };
        let mut state = self.state.lock().unwrap();
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == id)
        {
            state.pending = None;
        }
        result
    }
}

pub(crate) struct JournalWriter {
    delivery: std::sync::Arc<JournalDelivery>,
    manifest: String,
    epoch: Option<(u64, i64)>,
}

impl JournalWriter {
    pub(crate) fn new(
        delivery: std::sync::Arc<JournalDelivery>,
        start_request: &str,
    ) -> Result<Self, String> {
        let (engine, assets) = ARTIFACTS
            .get()
            .ok_or("journal artifacts were not initialized")?;
        Ok(Self {
            delivery,
            manifest: json!({"engine_sha256": engine, "assets_sha256": assets, "start_request": start_request}).to_string(),
            epoch: None,
        })
    }

    fn retrying<T>(
        &mut self,
        cancel: &AtomicBool,
        mut attempt: impl FnMut(&mut Self, u64) -> Result<T, RpcError>,
    ) -> Result<T, String> {
        let started = Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("journal delivery cancelled".into());
            }
            let generation = self.delivery.state.lock().unwrap().generation;
            match attempt(self, generation) {
                Ok(value) => return Ok(value),
                Err(RpcError::Failed(error)) => return Err(error),
                Err(RpcError::Retry) => {
                    crate::metrics::record_journal_retry();
                    self.epoch = None;
                    if started.elapsed() >= Duration::from_secs(60) {
                        return Err("journal delivery timed out".into());
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
    }

    fn epoch(&mut self, generation: u64, cancel: &AtomicBool) -> Result<Position, RpcError> {
        let position = self.delivery.rpc(
            generation,
            DecisionJournalRequest::Open {
                manifest: self.manifest.clone(),
            },
            cancel,
        )?;
        self.epoch = Some((generation, position.epoch));
        Ok(position)
    }

    /// Fences every earlier writer and returns the durable prefix this writer
    /// now owns. Nothing older can extend it after this returns.
    pub(crate) fn claim(&mut self, cancel: &AtomicBool) -> Result<i64, String> {
        self.retrying(cancel, |writer, generation| {
            writer
                .epoch(generation, cancel)
                .map(|position| position.sequence)
        })
    }

    pub(crate) fn read_after(&mut self, after: i64, cancel: &AtomicBool) -> Result<String, String> {
        self.retrying(cancel, |writer, generation| {
            writer.delivery.call(
                generation,
                DecisionJournalRequest::Read {
                    after,
                    limit: READ_LIMIT,
                },
                cancel,
            )
        })
    }

    pub(crate) fn commit(&mut self, batch: String, cancel: &AtomicBool) -> Result<i64, String> {
        let parsed: serde_json::Value = serde_json::from_str(&batch).map_err(|e| e.to_string())?;
        if parsed.get("commitBarrier").and_then(|v| v.as_bool()) != Some(true) {
            return Err("engine does not confirm the journal commit barrier".into());
        }
        let through = parsed
            .get("nextSequence")
            .and_then(|v| v.as_i64())
            .filter(|n| *n > 0)
            .ok_or("invalid engine journal sequence")?
            - 1;
        let started = Instant::now();
        let sequence = self.retrying(cancel, |writer, generation| {
            let epoch = match writer.epoch.filter(|(g, _)| *g == generation) {
                Some((_, epoch)) => epoch,
                None => writer.epoch(generation, cancel)?.epoch,
            };
            let position = writer.delivery.rpc(
                generation,
                DecisionJournalRequest::Append {
                    epoch,
                    batch: batch.clone(),
                },
                cancel,
            )?;
            if position.epoch != epoch || position.sequence != through {
                return Err(RpcError::Failed(
                    "journal receipt does not match submitted prefix".into(),
                ));
            }
            Ok(position.sequence)
        })?;
        crate::metrics::record_journal_commit(through == 0, started.elapsed());
        Ok(sequence)
    }
}

#[cfg(test)]
mod history_tests {
    use super::*;

    const ENGINE: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const ASSETS: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    fn start(game: &str) -> String {
        json!({"gameId": game, "decisionJournal": true, "decisionJournalCommitBarrier": true})
            .to_string()
    }

    fn page(engine: &str, start: &str, through: i64, sequences: &[i64]) -> String {
        json!({
            "manifest": {"engine_sha256": engine, "assets_sha256": ASSETS, "start_request": start},
            "position": {"epoch": 2, "sequence": through, "unavailable_reason": null},
            "entries": sequences.iter().map(|sequence| json!({
                "sequence": sequence, "playerIndex": 0,
                "prompt": {"promptId": sequence}, "action": {"choice": sequence},
            })).collect::<Vec<_>>(),
        })
        .to_string()
    }

    fn history(pages: &[String]) -> Result<RecoveredJournal, String> {
        let _ = ARTIFACTS.set((ENGINE.to_string(), ASSETS.to_string()));
        let mut history = JournalHistory::default();
        for page in pages {
            history.add_page(page)?;
        }
        history.recover("game")
    }

    #[test]
    fn pages_join_into_the_whole_durable_prefix() {
        let start = start("game");
        let recovered = history(&[
            page(ENGINE, &start, 3, &[1, 2]),
            page(ENGINE, &start, 3, &[3]),
        ])
        .unwrap();
        assert_eq!(recovered.sequence(), 3);
        assert_eq!(recovered.start_request, start);
    }

    #[test]
    fn unrecoverable_histories_are_refused() {
        let start = start("game");
        let invalidated = page(ENGINE, &start, 1, &[1]).replace(
            "\"unavailable_reason\":null",
            "\"unavailable_reason\":\"snapshot restore\"",
        );
        let cases = [
            (vec![page(ENGINE, &start, 3, &[1, 3])], "gap"),
            (
                vec![page(ENGINE, &start, 3, &[1]), page(ENGINE, &start, 2, &[2])],
                "shrank",
            ),
            (
                vec![
                    page(ENGINE, &start, 2, &[1]),
                    page(ENGINE, &start.replace("game", "other"), 2, &[2]),
                ],
                "manifest changed",
            ),
            (vec![invalidated], "invalidated"),
            (vec![page(ENGINE, &start, 2, &[1])], "incomplete"),
            (
                vec![page(ENGINE, &start, 2, &[1]), page(ENGINE, &start, 2, &[])],
                "no progress",
            ),
            (vec![page(ENGINE, &start, 1, &[1, 2])], "exceed"),
            (
                vec![page(&ASSETS.replace('2', "3"), &start, 1, &[1])],
                "engine artifact",
            ),
            (
                vec![page(ENGINE, &start.replace("game", "other"), 1, &[1])],
                "does not describe",
            ),
        ];
        for (pages, expected) in cases {
            let error = history(&pages).err().unwrap_or_default();
            assert!(error.contains(expected), "{expected}: {error}");
        }
    }
}
