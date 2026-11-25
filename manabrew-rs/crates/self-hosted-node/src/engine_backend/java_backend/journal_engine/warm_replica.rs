use super::JournalEngine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::{Duration, Instant};

const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;
const MAX_LOG_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 50_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalBatch {
    pub game_id: String,
    pub epoch: u64,
    pub identity: String,
    pub journal: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplicaReceipt {
    pub game_id: String,
    pub epoch: u64,
    pub sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JournalBoundary {
    pub game_id: String,
    pub epoch: u64,
    pub sequence: u64,
    pub boundary: Value,
}

pub struct JournalHost {
    engine: JournalEngine,
    game_id: String,
    epoch: u64,
    identity: String,
    last_read: Option<u64>,
    acknowledged: Option<u64>,
}

impl JournalHost {
    pub fn start(request: &str, epoch: u64) -> Result<Self, String> {
        Self::start_matching(request, epoch, None)
    }

    fn start_matching(request: &str, epoch: u64, identity: Option<&str>) -> Result<Self, String> {
        let value: Value = serde_json::from_str(request).map_err(|e| e.to_string())?;
        if epoch == 0
            || value["decisionJournal"] != true
            || value["decisionJournalCommitBarrier"] != true
            || value["journalRewind"] == true
            || value.get("replaySnapshot").is_some()
        {
            return Err(
                "warm replication requires an epoch and externally acknowledged journal delivery"
                    .into(),
            );
        }
        if value["players"]
            .as_array()
            .is_none_or(|players| players.iter().any(|p| p["ai"] == true))
        {
            return Err("warm replication awaits deterministic internal Forge bots".into());
        }
        let engine = JournalEngine::spawn()?;
        let actual = engine.call("replayIdentity", "")?;
        if identity.is_some_and(|expected| expected != actual) {
            return Err("replica runtime, harness, assets or preferences differ".into());
        }
        let game_id = engine.start_game(request)?;
        Ok(Self {
            engine,
            game_id,
            epoch,
            identity: actual,
            last_read: None,
            acknowledged: None,
        })
    }

    pub fn process_id(&self) -> u32 {
        self.engine.bridge.borrow().child.id()
    }

    pub fn read_batch(&mut self) -> Result<Option<JournalBatch>, String> {
        let raw = self.engine.call("readDecisionJournal", &self.game_id)?;
        if raw.is_empty() {
            return Ok(None);
        }
        if raw.len() > MAX_BATCH_BYTES {
            return Err("journal batch exceeds replication limit".into());
        }
        let journal: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let sequence = validate_batch(&journal)?;
        self.last_read = Some(sequence);
        Ok(Some(JournalBatch {
            game_id: self.game_id.clone(),
            epoch: self.epoch,
            identity: self.identity.clone(),
            journal,
        }))
    }

    pub fn acknowledge(&mut self, receipt: &ReplicaReceipt) -> Result<(), String> {
        if receipt.game_id != self.game_id
            || receipt.epoch != self.epoch
            || self
                .last_read
                .is_none_or(|sequence| receipt.sequence > sequence)
        {
            return Err("receipt does not belong to the read journal prefix and host epoch".into());
        }
        self.engine.bridge.borrow_mut().call(
            &json!({
                "command": "acknowledgeDecisionJournal", "sessionId": self.game_id,
                "sequence": receipt.sequence.to_string(),
            })
            .to_string(),
        )?;
        self.acknowledged = Some(
            self.acknowledged
                .map_or(receipt.sequence, |n| n.max(receipt.sequence)),
        );
        Ok(())
    }

    pub fn boundary(&mut self) -> Result<JournalBoundary, String> {
        if self.read_batch()?.is_some() || self.acknowledged.is_none() {
            return Err("acknowledge the pending journal before requesting a boundary".into());
        }
        let boundary: Value =
            serde_json::from_str(&self.engine.call("replayBoundary", &self.game_id)?)
                .map_err(|e| e.to_string())?;
        let sequence = boundary["nextSequence"]
            .as_u64()
            .and_then(|n| n.checked_sub(1))
            .ok_or("invalid journal boundary sequence")?;
        if Some(sequence) != self.acknowledged {
            return Err("boundary does not match the acknowledged prefix".into());
        }
        Ok(JournalBoundary {
            game_id: self.game_id.clone(),
            epoch: self.epoch,
            sequence,
            boundary,
        })
    }

    pub fn submit_action(&self, action: &Value) -> Result<(), String> {
        self.engine
            .submit_action(&self.game_id, &action.to_string())
            .map(|_| ())
    }

    pub fn snapshot(&self, viewer: Option<usize>) -> Result<Value, String> {
        serde_json::from_str(&self.engine.get_snapshot(&self.game_id, viewer)?)
            .map_err(|e| e.to_string())
    }

    pub fn terminate(self) -> Result<(), String> {
        let mut bridge = self.engine.bridge.borrow_mut();
        bridge.failed = true;
        bridge.child.kill().map_err(|e| e.to_string())?;
        bridge.child.wait().map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct WarmReplica {
    host: Option<JournalHost>,
    log: File,
    records: Vec<(u64, usize)>,
    start_request: String,
    applied: u64,
    verified: Option<JournalBoundary>,
    failed: bool,
}

impl WarmReplica {
    pub fn start(manifest: &JournalBatch, path: &Path) -> Result<(Self, ReplicaReceipt), String> {
        if validate_batch(&manifest.journal)? != 0 {
            return Err("a warm replica starts with the sequence-zero manifest".into());
        }
        let start = manifest.journal["startRequest"]
            .as_str()
            .ok_or("manifest has no start request")?;
        let mut host =
            JournalHost::start_matching(start, manifest.epoch, Some(&manifest.identity))?;
        let local = host.read_batch()?.ok_or("replica produced no manifest")?;
        if local.game_id != manifest.game_id || local.journal != manifest.journal {
            return Err("replica start manifest differs".into());
        }
        let mut options = OpenOptions::new();
        options.create_new(true).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let log = options.open(path).map_err(|e| e.to_string())?;
        let mut replica = Self {
            host: Some(host),
            log,
            records: Vec::new(),
            start_request: start.into(),
            applied: 0,
            verified: None,
            failed: false,
        };
        replica.persist(&serde_json::to_value(manifest).map_err(|e| e.to_string())?)?;
        #[cfg(unix)]
        File::open(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )
        .and_then(|directory| directory.sync_all())
        .map_err(|e| e.to_string())?;
        let receipt = replica.receipt()?;
        replica.host_mut()?.acknowledge(&receipt)?;
        Ok((replica, receipt))
    }

    pub fn process_id(&self) -> Result<u32, String> {
        Ok(self.host()?.process_id())
    }

    pub fn durable_sequence(&self) -> u64 {
        self.records.len().saturating_sub(1) as u64
    }

    pub fn applied_sequence(&self) -> u64 {
        self.applied
    }

    pub fn verified_sequence(&self) -> Option<u64> {
        self.verified.as_ref().map(|b| b.sequence)
    }

    pub fn receipt(&self) -> Result<ReplicaReceipt, String> {
        let host = self.host()?;
        Ok(ReplicaReceipt {
            game_id: host.game_id.clone(),
            epoch: host.epoch,
            sequence: self.applied,
        })
    }

    pub fn apply(&mut self, batch: &JournalBatch) -> Result<ReplicaReceipt, String> {
        let host = self.host()?;
        if batch.game_id != host.game_id
            || batch.epoch != host.epoch
            || batch.identity != host.identity
        {
            return Err("journal batch belongs to a different game, epoch or runtime".into());
        }
        validate_batch(&batch.journal)?;
        if batch
            .journal
            .get("startRequest")
            .is_some_and(|start| start.as_str() != Some(self.start_request.as_str()))
        {
            return Err("journal manifest changed".into());
        }
        let entries = batch.journal["entries"]
            .as_array()
            .ok_or("missing entries")?;
        if entries
            .first()
            .is_some_and(|entry| entry["sequence"].as_u64().unwrap() > self.applied + 1)
        {
            return Err("journal gap before batch".into());
        }
        let result = self.apply_entries(entries);
        if result.is_err() {
            self.failed = true;
            self.verified = None;
        }
        result
    }

    fn apply_entries(&mut self, entries: &[Value]) -> Result<ReplicaReceipt, String> {
        for entry in entries {
            let sequence = entry["sequence"].as_u64().ok_or("missing entry sequence")?;
            if sequence <= self.applied {
                if self.read_record(sequence)? != *entry {
                    return Err("conflicting repeated journal entry".into());
                }
                continue;
            }
            let before = self.host_mut()?.boundary()?;
            if before.sequence + 1 != sequence
                || before.boundary["prompt"] != entry["prompt"]
                || before.boundary["verification"] != entry["verification"]
            {
                return Err(format!("replica diverged before decision {sequence}"));
            }
            self.verified = None;
            // Durable receipt precedes execution; an uncertain write or apply poisons promotion.
            self.persist(entry)?;
            self.host()?.submit_action(&entry["action"])?;
            let deadline = Instant::now() + Duration::from_secs(30);
            let consumed = loop {
                if let Some(consumed) = self.host_mut()?.read_batch()? {
                    break consumed;
                }
                if Instant::now() >= deadline {
                    return Err("replica input was not consumed".into());
                }
                std::thread::sleep(Duration::from_millis(2));
            };
            if consumed.journal["entries"] != json!([entry]) {
                return Err(format!(
                    "replica consumed different input at decision {sequence}"
                ));
            }
            let host = self.host_mut()?;
            host.acknowledge(&ReplicaReceipt {
                game_id: host.game_id.clone(),
                epoch: host.epoch,
                sequence,
            })?;
            self.applied = sequence;
        }
        self.receipt()
    }

    pub fn verify(&mut self, boundary: &JournalBoundary) -> Result<(), String> {
        let host = self.host()?;
        if boundary.game_id != host.game_id
            || boundary.epoch != host.epoch
            || boundary.sequence != self.applied
        {
            return Err("verification does not describe the applied journal prefix".into());
        }
        let actual = self.host_mut()?.boundary()?;
        if actual != *boundary {
            self.failed = true;
            self.verified = None;
            return Err("replica pending boundary diverged".into());
        }
        self.verified = Some(actual);
        Ok(())
    }

    pub fn advance_epoch(&mut self, previous: u64, epoch: u64) -> Result<(), String> {
        let host = self.host_mut()?;
        if host.epoch != previous || epoch <= previous {
            return Err("stale replica epoch transition".into());
        }
        host.epoch = epoch;
        self.verified = None;
        Ok(())
    }

    pub fn promote(&mut self, committed_sequence: u64, epoch: u64) -> Result<JournalHost, String> {
        let host = self.host()?;
        if epoch <= host.epoch
            || committed_sequence != self.applied
            || self.verified_sequence() != Some(committed_sequence)
        {
            return Err("promotion requires a new epoch and the verified committed prefix".into());
        }
        let verified = self.verified.clone().ok_or("replica is not verified")?;
        self.verify(&verified)?;
        let mut host = self.host.take().ok_or("replica already promoted")?;
        host.epoch = epoch;
        Ok(host)
    }

    fn host(&self) -> Result<&JournalHost, String> {
        if self.failed {
            return Err("replica is invalidated".into());
        }
        self.host
            .as_ref()
            .ok_or_else(|| "replica already promoted".into())
    }

    fn host_mut(&mut self) -> Result<&mut JournalHost, String> {
        if self.failed {
            return Err("replica is invalidated".into());
        }
        self.host
            .as_mut()
            .ok_or_else(|| "replica already promoted".into())
    }

    fn persist(&mut self, value: &Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        let offset = self.log.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
        if self.records.len() > MAX_ENTRIES || offset + bytes.len() as u64 + 1 > MAX_LOG_BYTES {
            return Err("replica journal retention limit reached".into());
        }
        self.log
            .write_all(&bytes)
            .and_then(|_| self.log.write_all(b"\n"))
            .and_then(|_| self.log.sync_all())
            .map_err(|e| e.to_string())?;
        self.records.push((offset, bytes.len()));
        Ok(())
    }

    fn read_record(&mut self, sequence: u64) -> Result<Value, String> {
        let &(offset, len) = self
            .records
            .get(sequence as usize)
            .ok_or("journal entry not retained")?;
        self.log
            .seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut bytes = vec![0; len];
        self.log.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }
}

fn validate_batch(journal: &Value) -> Result<u64, String> {
    if journal["version"] != 2
        || journal.get("unavailableReason").is_some()
        || serde_json::to_vec(journal)
            .map_err(|e| e.to_string())?
            .len()
            > MAX_BATCH_BYTES
    {
        return Err("invalid or unavailable journal delivery".into());
    }
    let entries = journal["entries"]
        .as_array()
        .ok_or("journal has no entries")?;
    let last = journal["nextSequence"]
        .as_u64()
        .and_then(|n| n.checked_sub(1))
        .ok_or("invalid journal sequence")?;
    let mut previous: Option<u64> = None;
    for entry in entries {
        let sequence = entry["sequence"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or("invalid entry sequence")?;
        if previous.is_some_and(|n| Some(sequence) != n.checked_add(1))
            || !entry["action"].is_object()
            || !entry["verification"].is_object()
            || !entry["prompt"].is_object()
            || entry["playerIndex"].as_u64().is_none()
            || entry["prompt"]["decidingPlayerId"].as_str()
                != entry["playerIndex"]
                    .as_u64()
                    .map(|seat| format!("player-{seat}"))
                    .as_deref()
        {
            return Err("invalid journal entry or sequence gap".into());
        }
        previous = Some(sequence);
    }
    if previous.is_some_and(|n| n != last)
        || (journal.get("startRequest").is_some() && last != entries.len() as u64)
    {
        return Err("journal batch has inconsistent bounds".into());
    }
    Ok(last)
}

#[cfg(all(test, feature = "java-forge"))]
mod tests {
    use super::super::super::{scenario_deck, PlayerConfig, StartGameRequest};
    use super::*;
    use manabot::{BotAgent, SimpleAi};
    use manabrew_agent_interface::prompt::AgentPrompt;

    fn next_batch(host: &mut JournalHost) -> JournalBatch {
        let until = Instant::now() + Duration::from_secs(30);
        loop {
            if let Some(batch) = host.read_batch().unwrap() {
                return batch;
            }
            assert!(Instant::now() < until, "journal did not advance");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn request() -> String {
        let mut cards = scenario_deck("Mountain");
        cards[0].name = "Krenko, Mob Boss".into();
        let players = (0..4)
            .map(|seat| {
                PlayerConfig::new(
                    format!("Replica seat {seat}"),
                    &cards,
                    vec!["Krenko, Mob Boss".into()],
                )
            })
            .collect();
        let mut request = serde_json::to_value(StartGameRequest::new(
            "warm-replica-test".into(),
            "Commander".into(),
            40,
            42,
            players,
        ))
        .unwrap();
        request["snapshotRecording"] = json!(false);
        request["decisionJournal"] = json!(true);
        request["decisionJournalCommitBarrier"] = json!(true);
        request.to_string()
    }

    fn action(boundary: &JournalBoundary, ai: &mut SimpleAi) -> Value {
        let prompt = &boundary.boundary["prompt"];
        if prompt["input"]["type"] == "mulligan" {
            return json!({"type":"mulligan","output":{"type":"mulliganDecision","keep":true}});
        }
        let prompt: AgentPrompt = serde_json::from_value(prompt.clone()).unwrap();
        serde_json::to_value(ai.decide(prompt).expect("scripted decision")).unwrap()
    }

    #[test]
    #[ignore]
    fn warm_journal_replica_promotes_without_restarting_the_engine() {
        let dir = std::env::temp_dir().join(format!("manabrew-warm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let mut source = JournalHost::start(&request(), 1).unwrap();
        let manifest = next_batch(&mut source);
        let (mut standby, receipt) =
            WarmReplica::start(&manifest, &dir.join("standby.jsonl")).unwrap();
        let (mut witness, _) = WarmReplica::start(&manifest, &dir.join("witness.jsonl")).unwrap();
        let standby_pid = standby.process_id().unwrap();
        assert_ne!(standby_pid, source.process_id());
        source.acknowledge(&receipt).unwrap();
        let mut ai = SimpleAi::default();
        let mut conceded = false;
        let mut boundary = source.boundary().unwrap();
        standby.verify(&boundary).unwrap();
        witness.verify(&boundary).unwrap();
        for _ in 0..600 {
            let turn = source.snapshot(None).unwrap()["turn"].as_u64().unwrap();
            if turn >= 5 {
                break;
            }
            let input = if !conceded && turn >= 2 {
                conceded = true;
                json!({"type":"directive","player":3,"directive":{"type":"concede"}})
            } else {
                action(&boundary, &mut ai)
            };
            source.submit_action(&input).unwrap();
            let batch = next_batch(&mut source);
            if standby.applied_sequence() == 0 {
                let mut incompatible = batch.clone();
                incompatible.identity = "different artifact".into();
                assert!(standby.apply(&incompatible).is_err());
                let mut gap = batch.clone();
                gap.journal["entries"][0]["sequence"] = json!(2);
                gap.journal["nextSequence"] = json!(3);
                assert!(standby.apply(&gap).is_err());
            }
            let receipt = standby.apply(&batch).unwrap();
            assert_eq!(
                standby.apply(&batch).unwrap(),
                receipt,
                "duplicate delivery"
            );
            assert_eq!(witness.apply(&batch).unwrap(), receipt);
            assert!(
                standby.promote(receipt.sequence, 2).is_err(),
                "unverified tail cannot promote"
            );
            source.acknowledge(&receipt).unwrap();
            boundary = source.boundary().unwrap();
            standby.verify(&boundary).unwrap();
            witness.verify(&boundary).unwrap();
        }
        assert!(conceded);
        assert!(source.snapshot(None).unwrap()["turn"].as_u64().unwrap() >= 5);
        assert_eq!(standby.durable_sequence(), boundary.sequence);
        assert_eq!(standby.applied_sequence(), boundary.sequence);
        assert!(standby.promote(boundary.sequence + 1, 2).is_err());
        assert!(standby.promote(boundary.sequence, 1).is_err());
        let views: Vec<_> = (0..4)
            .map(|seat| source.snapshot(Some(seat)).unwrap())
            .collect();
        source.terminate().unwrap();
        let mut promoted = standby.promote(boundary.sequence, 2).unwrap();
        assert_eq!(
            promoted.process_id(),
            standby_pid,
            "promotion must reuse the warm process"
        );
        assert!(standby.promote(boundary.sequence, 3).is_err());
        for (seat, view) in views.iter().enumerate() {
            assert_eq!(&promoted.snapshot(Some(seat)).unwrap(), view);
        }
        witness.advance_epoch(1, 2).unwrap();
        boundary = promoted.boundary().unwrap();
        witness.verify(&boundary).unwrap();
        let promoted_at = boundary.sequence;
        let mut last_batch = None;
        for _ in 0..600 {
            if promoted.snapshot(None).unwrap()["turn"].as_u64().unwrap() >= 7 {
                break;
            }
            promoted.submit_action(&action(&boundary, &mut ai)).unwrap();
            let batch = next_batch(&mut promoted);
            let mut stale = batch.clone();
            stale.epoch = 1;
            assert!(witness.apply(&stale).is_err());
            let receipt = witness.apply(&batch).unwrap();
            let mut stale_receipt = receipt.clone();
            stale_receipt.epoch = 1;
            assert!(promoted.acknowledge(&stale_receipt).is_err());
            promoted.acknowledge(&receipt).unwrap();
            boundary = promoted.boundary().unwrap();
            witness.verify(&boundary).unwrap();
            last_batch = Some(batch);
        }
        assert!(promoted.snapshot(None).unwrap()["turn"].as_u64().unwrap() >= 7);
        assert!(
            boundary.sequence > promoted_at + 12,
            "verify continued play, not only promotion"
        );
        let mut conflicting = last_batch.unwrap();
        conflicting.journal["entries"][0]["action"]["unexpected"] = json!(true);
        assert!(witness.apply(&conflicting).is_err());
        assert!(
            witness.promote(boundary.sequence, 3).is_err(),
            "diverged replica stays invalidated"
        );
        promoted.terminate().unwrap();
        drop(witness);
        drop(standby);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[ignore]
    fn warm_journal_replica_does_not_ack_failed_storage() {
        let dir = std::env::temp_dir().join(format!("manabrew-warm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("standby.jsonl");
        let mut source = JournalHost::start(&request(), 1).unwrap();
        let manifest = next_batch(&mut source);
        let (mut standby, receipt) = WarmReplica::start(&manifest, &path).unwrap();
        source.acknowledge(&receipt).unwrap();
        let boundary = source.boundary().unwrap();
        standby.verify(&boundary).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        standby.log = File::open(&path).unwrap();
        source
            .submit_action(&action(&boundary, &mut SimpleAi::default()))
            .unwrap();
        let batch = next_batch(&mut source);
        assert!(standby.apply(&batch).is_err());
        assert_eq!(standby.durable_sequence(), 0);
        assert_eq!(standby.applied_sequence(), 0);
        assert!(standby.receipt().is_err());
        assert!(standby.promote(0, 2).is_err());
        assert_eq!(source.read_batch().unwrap().unwrap().journal, batch.journal);
        assert!(
            source.boundary().is_err(),
            "source must still wait for durable receipt"
        );
        source.terminate().unwrap();
        drop(standby);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
