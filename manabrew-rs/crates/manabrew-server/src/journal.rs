use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

const MAX_BATCH_BYTES: usize = 9 * 1024 * 1024;
const MAX_JOURNAL_BYTES: i64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JournalManifest {
    pub engine_sha256: String,
    pub assets_sha256: String,
    pub start_request: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalEntry {
    pub sequence: i64,
    pub player_index: i32,
    pub prompt: Value,
    pub action: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalBatch {
    version: u32,
    #[serde(default, rename = "commitBarrier")]
    _commit_barrier: bool,
    next_sequence: i64,
    start_request: Option<String>,
    unavailable_reason: Option<String>,
    entries: Vec<JournalEntry>,
}

#[derive(Debug, Serialize)]
pub struct JournalPosition {
    pub epoch: i64,
    pub sequence: i64,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct JournalPage {
    pub manifest: JournalManifest,
    pub position: JournalPosition,
    pub entries: Vec<JournalEntry>,
}

pub struct JournalStore {
    connection: Connection,
}

fn failure(error: impl std::fmt::Display) -> String {
    error.to_string()
}

impl JournalStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(failure)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(failure)?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
            )
            .map_err(failure)?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(failure)?;
        if version == 0 {
            connection
                .execute_batch(
                    "BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS engine_journals (
                    game_id TEXT PRIMARY KEY,
                    manifest TEXT NOT NULL,
                    writer TEXT NOT NULL,
                    epoch INTEGER NOT NULL CHECK (epoch > 0),
                    sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
                    bytes INTEGER NOT NULL,
                    unavailable_reason TEXT
                );
                CREATE TABLE IF NOT EXISTS engine_decisions (
                    game_id TEXT NOT NULL REFERENCES engine_journals(game_id),
                    sequence INTEGER NOT NULL CHECK (sequence > 0),
                    entry TEXT NOT NULL,
                    PRIMARY KEY (game_id, sequence)
                );
                PRAGMA user_version=1;
                COMMIT;",
                )
                .map_err(failure)?;
        } else if version != 1 {
            return Err("unsupported engine journal database version".into());
        }
        Ok(Self { connection })
    }

    pub fn begin(
        &mut self,
        game_id: &str,
        writer: &str,
        manifest: &JournalManifest,
    ) -> Result<JournalPosition, String> {
        self.open_writer(game_id, writer, manifest, false)
    }

    pub fn open_writer(
        &mut self,
        game_id: &str,
        writer: &str,
        manifest: &JournalManifest,
        replace_writer: bool,
    ) -> Result<JournalPosition, String> {
        validate_identity(game_id, writer)?;
        for hash in [&manifest.engine_sha256, &manifest.assets_sha256] {
            if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("engine and asset SHA-256 identities are required".into());
            }
        }
        if manifest.start_request.len() > 8 * 1024 * 1024 {
            return Err("journal start request exceeds limit".into());
        }
        let request: Value = serde_json::from_str(&manifest.start_request).map_err(failure)?;
        if !request.is_object() {
            return Err("journal start request must be an object".into());
        }
        let encoded = serde_json::to_string(manifest).map_err(failure)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(failure)?;
        let existing: Option<(String, String)> = tx
            .query_row(
                "SELECT manifest, writer FROM engine_journals WHERE game_id=?1",
                [game_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(failure)?;
        if let Some((previous, owner)) = existing {
            if serde_json::from_str::<JournalManifest>(&previous).map_err(failure)? != *manifest
                || (owner != writer && !replace_writer)
            {
                return Err("journal already exists with another manifest or writer".into());
            }
            if owner != writer {
                let changed = tx.execute(
                    "UPDATE engine_journals SET writer=?2, epoch=epoch+1 WHERE game_id=?1 AND epoch < 9223372036854775807",
                    params![game_id, writer],
                ).map_err(failure)?;
                if changed != 1 {
                    return Err("journal writer epoch exhausted".into());
                }
            }
        } else {
            tx.execute("INSERT INTO engine_journals(game_id, manifest, writer, epoch, bytes) VALUES (?1, ?2, ?3, 1, ?4)",
                params![game_id, encoded, writer, encoded.len() as i64]).map_err(failure)?;
        }
        let position = position(&tx, game_id)?;
        tx.commit().map_err(failure)?;
        Ok(position)
    }

    pub fn claim(
        &mut self,
        game_id: &str,
        writer: &str,
        expected_epoch: i64,
    ) -> Result<JournalPosition, String> {
        validate_identity(game_id, writer)?;
        if expected_epoch < 1 {
            return Err("stale journal ownership claim".into());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(failure)?;
        let (owner, epoch): (String, i64) = tx
            .query_row(
                "SELECT writer, epoch FROM engine_journals WHERE game_id=?1",
                [game_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(failure)?;
        if owner != writer {
            if epoch != expected_epoch || epoch == i64::MAX {
                return Err("stale journal ownership claim".into());
            }
            tx.execute(
                "UPDATE engine_journals SET writer=?2, epoch=epoch+1 WHERE game_id=?1",
                params![game_id, writer],
            )
            .map_err(failure)?;
        } else if expected_epoch != epoch && expected_epoch.checked_add(1) != Some(epoch) {
            return Err("stale journal ownership claim".into());
        }
        let position = position(&tx, game_id)?;
        tx.commit().map_err(failure)?;
        Ok(position)
    }

    pub fn append(
        &mut self,
        game_id: &str,
        writer: &str,
        epoch: i64,
        raw_batch: &str,
    ) -> Result<JournalPosition, String> {
        if raw_batch.len() > MAX_BATCH_BYTES {
            return Err("journal batch exceeds limit".into());
        }
        let batch: JournalBatch = serde_json::from_str(raw_batch).map_err(failure)?;
        if batch.version != 1 || batch.next_sequence < 1 || batch.entries.len() > MAX_ENTRIES {
            return Err("invalid journal batch header".into());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(failure)?;
        let (manifest, owner, mut bytes): (String, String, i64) = tx
            .query_row(
                "SELECT manifest, writer, bytes FROM engine_journals WHERE game_id=?1",
                [game_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(failure)?;
        let mut durable = position(&tx, game_id)?;
        if owner != writer || epoch != durable.epoch {
            return Err("stale journal writer".into());
        }
        if durable.unavailable_reason.is_some() {
            if durable.unavailable_reason == batch.unavailable_reason && batch.entries.is_empty() {
                tx.commit().map_err(failure)?;
                return Ok(durable);
            }
            return Err("journal has been invalidated".into());
        }
        if let Some(start) = &batch.start_request {
            if *start
                != serde_json::from_str::<JournalManifest>(&manifest)
                    .map_err(failure)?
                    .start_request
            {
                return Err("journal start request conflicts with manifest".into());
            }
        }
        if let Some(reason) = &batch.unavailable_reason {
            if reason.is_empty() || reason.len() > 512 || !batch.entries.is_empty() {
                return Err("invalid journal invalidation".into());
            }
            tx.execute(
                "UPDATE engine_journals SET unavailable_reason=?2 WHERE game_id=?1",
                params![game_id, reason],
            )
            .map_err(failure)?;
            durable.unavailable_reason = Some(reason.clone());
        } else {
            let mut previous = None;
            for entry in &batch.entries {
                if entry.sequence < 1
                    || previous.is_some_and(|seq: i64| seq.checked_add(1) != Some(entry.sequence))
                {
                    return Err("journal batch is not contiguous".into());
                }
                previous = Some(entry.sequence);
                if entry.sequence <= durable.sequence {
                    let stored: String = tx
                        .query_row(
                            "SELECT entry FROM engine_decisions WHERE game_id=?1 AND sequence=?2",
                            params![game_id, entry.sequence],
                            |row| row.get(0),
                        )
                        .map_err(failure)?;
                    if serde_json::from_str::<JournalEntry>(&stored).map_err(failure)? != *entry {
                        return Err("conflicting journal retry".into());
                    }
                    continue;
                }
                if durable.sequence.checked_add(1) != Some(entry.sequence) {
                    return Err("journal sequence gap".into());
                }
                let encoded = serde_json::to_string(entry).map_err(failure)?;
                bytes += encoded.len() as i64;
                if bytes > MAX_JOURNAL_BYTES {
                    return Err("journal storage limit reached".into());
                }
                tx.execute(
                    "INSERT INTO engine_decisions(game_id, sequence, entry) VALUES (?1, ?2, ?3)",
                    params![game_id, entry.sequence, encoded],
                )
                .map_err(failure)?;
                durable.sequence = entry.sequence;
            }
            if previous.map_or(batch.next_sequence != 1, |seq| {
                seq.checked_add(1) != Some(batch.next_sequence)
            }) {
                return Err("journal batch end does not match its entries".into());
            }
            tx.execute(
                "UPDATE engine_journals SET sequence=?2, bytes=?3 WHERE game_id=?1",
                params![game_id, durable.sequence, bytes],
            )
            .map_err(failure)?;
            durable.sequence = durable.sequence.min(batch.next_sequence - 1);
        }
        tx.commit().map_err(failure)?;
        Ok(durable)
    }

    pub fn status(&mut self, game_id: &str) -> Result<Option<JournalPosition>, String> {
        query_position(&self.connection, game_id)
            .optional()
            .map_err(failure)
    }

    pub fn read(&mut self, game_id: &str, after: i64, limit: usize) -> Result<JournalPage, String> {
        if after < 0 || limit == 0 || limit > MAX_ENTRIES {
            return Err("invalid journal read window".into());
        }
        let tx = self.connection.transaction().map_err(failure)?;
        let durable = position(&tx, game_id)?;
        if after > durable.sequence {
            return Err("journal read exceeds durable prefix".into());
        }
        let manifest: String = tx
            .query_row(
                "SELECT manifest FROM engine_journals WHERE game_id=?1",
                [game_id],
                |row| row.get(0),
            )
            .map_err(failure)?;
        let mut entries = Vec::new();
        let mut bytes = 0;
        {
            let mut statement = tx.prepare("SELECT entry FROM engine_decisions WHERE game_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3")
                .map_err(failure)?;
            let mut rows = statement
                .query(params![game_id, after, limit as i64])
                .map_err(failure)?;
            while let Some(row) = rows.next().map_err(failure)? {
                let raw: String = row.get(0).map_err(failure)?;
                if bytes + raw.len() > MAX_BATCH_BYTES {
                    break;
                }
                bytes += raw.len();
                entries.push(serde_json::from_str(&raw).map_err(failure)?);
            }
        }
        let page = JournalPage {
            manifest: serde_json::from_str(&manifest).map_err(failure)?,
            position: durable,
            entries,
        };
        tx.commit().map_err(failure)?;
        Ok(page)
    }
}

fn position(connection: &Connection, game_id: &str) -> Result<JournalPosition, String> {
    query_position(connection, game_id).map_err(failure)
}

fn query_position(connection: &Connection, game_id: &str) -> rusqlite::Result<JournalPosition> {
    connection.query_row(
        "SELECT epoch, sequence, unavailable_reason FROM engine_journals WHERE game_id=?1",
        [game_id],
        |row| {
            Ok(JournalPosition {
                epoch: row.get(0)?,
                sequence: row.get(1)?,
                unavailable_reason: row.get(2)?,
            })
        },
    )
}

fn validate_identity(game_id: &str, writer: &str) -> Result<(), String> {
    if game_id.is_empty() || game_id.len() > 128 || writer.is_empty() || writer.len() > 128 {
        return Err("invalid journal identity".into());
    }
    Ok(())
}
