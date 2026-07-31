use std::collections::BTreeMap;

use manabrew_hub::dto::{
    AccountDeckDetail, AccountDeckSummary, AdminTopDeckSnapshotEntry, DeckHubEntryDetail,
    DeckHubEntrySummary, DeckHubFacet, DeckHubFacets, DeckHubTag, DeckVersionDetail,
    DeckVersionSummary, FavoriteResponse, HubDeckDetail, HubDeckSummary, TopDeckBucket,
    TopDeckSnapshot, TopDeckSnapshotEntry,
};
use manabrew_protocol::deck_dto::{deck_fingerprint, Deck, DeckCard, DeckFormat};
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult, Row, Transaction};
use sha2::{Digest, Sha256};

use crate::preset_decks::PresetDeck;

pub struct ListParams {
    pub search: Option<String>,
    pub format: Option<String>,
    pub sort: SortOrder,
    pub page: u32,
    pub page_size: u32,
}

pub struct DeckHubListParams {
    pub search: Option<String>,
    pub source_kind: Option<String>,
    pub formats: Vec<String>,
    pub colors: Option<String>,
    pub color_match: DeckHubColorMatch,
    pub tags: Vec<String>,
    pub tag_match: DeckHubTagMatch,
    pub commander: Option<String>,
    pub card: Option<String>,
    pub favorites_only: bool,
    pub owned_only: bool,
    pub sort: DeckHubSortOrder,
    pub page: u32,
    pub page_size: u32,
    pub viewer_account_id: Option<String>,
}

#[derive(Clone, Copy)]
pub enum SortOrder {
    Newest,
    Name,
}

#[derive(Clone, Copy)]
pub enum DeckHubSortOrder {
    Newest,
    Name,
    Favorites,
}

#[derive(Clone, Copy)]
pub enum DeckHubColorMatch {
    Exact,
    Includes,
}

#[derive(Clone, Copy)]
pub enum DeckHubTagMatch {
    Any,
    All,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReplaceSnapshotOutcome {
    Replaced,
    BucketNotFound,
    EntryUnavailable,
}

#[derive(Debug)]
pub enum SaveVersionOutcome {
    Saved(AccountDeckDetail),
    Unchanged(AccountDeckDetail),
    Conflict,
    Forbidden,
    NotFound,
}

pub struct NewHubDeck {
    pub summary: HubDeckSummary,
    pub deck_json: String,
    pub management_token_hash: String,
    pub publish_ip: String,
    pub account_id: String,
}

pub struct NewDeckHubEntry {
    pub deck_id: String,
    pub published_version_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub tags: Vec<String>,
    pub cover_card_id: Option<String>,
    pub cover_card_name: Option<String>,
    pub publish_ip: String,
    pub created_at: String,
}

pub struct DeckHubEntryUpdate {
    pub title: String,
    pub summary: Option<String>,
    pub tags: Vec<String>,
    pub cover_card_id: Option<String>,
    pub cover_card_name: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DeleteOutcome {
    Deleted,
    Forbidden,
    NotFound,
}

#[derive(Debug, Clone)]
pub struct AccountRow {
    pub id: String,
    pub handle: String,
    pub handle_set: bool,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct IdentityRow {
    pub account_id: String,
    pub provider: String,
    pub email: Option<String>,
}

#[derive(Debug)]
pub struct OAuthStateRow {
    pub provider: String,
    pub mode: String,
    pub client: String,
    pub link_account_id: Option<String>,
    pub return_to: String,
}

pub struct NewOAuthState<'a> {
    pub state_hash: &'a str,
    pub provider: &'a str,
    pub mode: &'a str,
    pub client: &'a str,
    pub link_account_id: Option<&'a str>,
    pub return_to: &'a str,
    pub created_at: &'a str,
    pub expires_at: &'a str,
}

#[derive(Debug, PartialEq, Eq)]
pub enum HandleOutcome {
    Updated,
    Conflict,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LoginCodeOutcome {
    Verified,
    Invalid,
}

include!(concat!(env!("OUT_DIR"), "/migrations.rs"));

pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn open(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
        conn.execute_batch("PRAGMA foreign_keys=ON")?;
        let storage = Self { conn };
        storage.migrate()?;
        Ok(storage)
    }

    #[cfg(test)]
    pub fn open_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON")?;
        let storage = Self { conn };
        storage.migrate()?;
        Ok(storage)
    }

    fn migrate(&self) -> SqlResult<()> {
        let has_schema_version: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version')",
            [],
            |row| row.get(0),
        )?;
        let mut current = if has_schema_version {
            self.conn.query_row(
                "SELECT version FROM schema_version WHERE id = 1",
                [],
                |row| row.get(0),
            )?
        } else {
            0
        };
        for (version, name, sql) in MIGRATIONS {
            if *version <= current {
                continue;
            }
            let rebuilds_decks = *version == 4;
            if rebuilds_decks {
                self.conn.execute_batch("PRAGMA foreign_keys=OFF")?;
            }
            let result = (|| {
                let tx = self.conn.unchecked_transaction()?;
                tx.execute_batch(sql)?;
                if *version == 2 {
                    migrate_legacy_hub_decks(&tx)?;
                }
                if *version == 3 {
                    backfill_version_discovery(&tx)?;
                }
                tx.execute(
                    "UPDATE schema_version SET version = ?1 WHERE id = 1",
                    params![version],
                )?;
                tx.commit()
            })();
            if rebuilds_decks {
                self.conn.execute_batch("PRAGMA foreign_keys=ON")?;
            }
            result?;
            current = *version;
            tracing::info!(migration = name, version, "migration ran");
        }
        let mismatch: u32 =
            self.conn
                .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                    row.get(0)
                })?;
        if mismatch > 0 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(())
    }

    pub fn insert_deck(&self, deck: &NewHubDeck) -> SqlResult<()> {
        let s = &deck.summary;
        let snapshot: Deck = serde_json::from_str(&deck.deck_json)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let tx = self.conn.unchecked_transaction()?;
        let deck_id = uuid::Uuid::new_v4().to_string();
        let version_id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO decks
                (id, account_id, name, format, description, visibility, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'public', ?6, ?6)",
            params![
                deck_id,
                deck.account_id,
                s.name,
                format_to_str(s.format),
                s.description,
                s.created_at,
            ],
        )?;
        tx.execute(
            "INSERT INTO deck_versions
                (id, deck_id, version_no, format, color_identity, card_count,
                 commander_names, snapshot_json, content_hash, created_at)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                version_id,
                deck_id,
                format_to_str(snapshot.format),
                deck_colors(&snapshot),
                display_cards(&snapshot).count() as u32,
                commander_names_json(&snapshot),
                deck.deck_json,
                sha256_hex(deck.deck_json.as_bytes()),
                s.created_at,
            ],
        )?;
        insert_deck_cards(&tx, &version_id, &snapshot)?;
        tx.execute(
            "INSERT INTO deckhub_entries
                (id, deck_id, published_version_id, slug, title, summary, cover_card_name,
                 status, published_at, created_at, updated_at, legacy_management_token_hash,
                 publish_ip)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'published', ?8, ?8, ?8, ?9, ?10)",
            params![
                s.id,
                deck_id,
                version_id,
                legacy_slug(&s.name, &s.id),
                s.name,
                s.description,
                s.cover_card_name,
                s.created_at,
                deck.management_token_hash,
                deck.publish_ip,
            ],
        )?;
        tx.execute(
            "INSERT INTO hub_decks (id, name, author, description, format, commanders, colors,
                card_count, cover_card_name, cover_image_url, deck_json, management_token_hash,
                publish_ip, created_at, account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                s.id,
                s.name,
                s.author,
                s.description,
                format_to_str(s.format),
                serde_json::to_string(&s.commanders).unwrap_or_else(|_| "[]".into()),
                s.colors,
                s.card_count,
                s.cover_card_name,
                s.cover_image_url,
                deck.deck_json,
                deck.management_token_hash,
                deck.publish_ip,
                s.created_at,
                deck.account_id,
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_decks(&self, params: &ListParams) -> SqlResult<(Vec<HubDeckSummary>, u32)> {
        let mut where_clause = String::from("unlisted = 0");
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(search) = params.search.as_deref().filter(|s| !s.is_empty()) {
            let pattern = format!(
                "%{}%",
                search
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            );
            where_clause.push_str(
                " AND (name LIKE ?1 ESCAPE '\\' OR author LIKE ?1 ESCAPE '\\' OR commanders LIKE ?1 ESCAPE '\\')",
            );
            args.push(Box::new(pattern));
        }
        if let Some(format) = params.format.as_deref().filter(|f| !f.is_empty()) {
            where_clause.push_str(&format!(" AND format = ?{}", args.len() + 1));
            args.push(Box::new(format.to_string()));
        }
        let order = match params.sort {
            SortOrder::Newest => "created_at DESC",
            SortOrder::Name => "name COLLATE NOCASE ASC",
        };
        let total: u32 = self.conn.query_row(
            &format!("SELECT count(*) FROM hub_decks WHERE {where_clause}"),
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            |row| row.get(0),
        )?;
        let offset = params
            .page
            .saturating_sub(1)
            .saturating_mul(params.page_size);
        let sql = format!(
            "SELECT id, name, author, description, format, commanders, colors, card_count,
                    cover_card_name, cover_image_url, created_at
             FROM hub_decks WHERE {where_clause} ORDER BY {order} LIMIT {} OFFSET {}",
            params.page_size, offset
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let decks = stmt
            .query_map(
                rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
                map_summary,
            )?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok((decks, total))
    }

    pub fn get_deck(&self, id: &str) -> SqlResult<Option<HubDeckDetail>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, name, author, description, format, commanders, colors, card_count,
                        cover_card_name, cover_image_url, created_at, deck_json
                 FROM hub_decks WHERE id = ?1 AND unlisted = 0",
                params![id],
                |row| {
                    let summary = map_summary(row)?;
                    let deck_json: String = row.get(11)?;
                    Ok((summary, deck_json))
                },
            )
            .optional()?;
        Ok(row.and_then(|(summary, deck_json)| {
            serde_json::from_str::<Deck>(&deck_json)
                .ok()
                .map(|deck| HubDeckDetail { summary, deck })
        }))
    }

    pub fn published_deck_matches(&self, id: &str, fingerprint: &str) -> SqlResult<bool> {
        let deck_json = self
            .conn
            .query_row(
                "SELECT deck_json FROM hub_decks WHERE id = ?1 AND unlisted = 0",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(deck_json
            .and_then(|json| serde_json::from_str::<Deck>(&json).ok())
            .is_some_and(|deck| deck_fingerprint(&deck) == fingerprint))
    }

    pub fn delete_deck(&self, id: &str, token_hash: &str) -> SqlResult<DeleteOutcome> {
        let stored: Option<String> = self
            .conn
            .query_row(
                "SELECT management_token_hash FROM hub_decks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        match stored {
            None => Ok(DeleteOutcome::NotFound),
            Some(stored) if stored != token_hash => Ok(DeleteOutcome::Forbidden),
            Some(_) => {
                let tx = self.conn.unchecked_transaction()?;
                tx.execute("DELETE FROM hub_decks WHERE id = ?1", params![id])?;
                tx.execute(
                    "UPDATE deckhub_entries
                     SET status = 'unlisted', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                     WHERE id = ?1",
                    params![id],
                )?;
                update_deck_visibility(&tx, id)?;
                tx.commit()?;
                Ok(DeleteOutcome::Deleted)
            }
        }
    }

    pub fn admin_delete(&self, id: &str) -> SqlResult<bool> {
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute("DELETE FROM hub_decks WHERE id = ?1", params![id])?;
        let entry_changed = tx.execute(
            "UPDATE deckhub_entries
             SET status = 'archived', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![id],
        )?;
        update_deck_visibility(&tx, id)?;
        tx.commit()?;
        Ok(changed > 0 || entry_changed > 0)
    }

    pub fn admin_unlist(&self, id: &str) -> SqlResult<bool> {
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE hub_decks SET unlisted = 1 WHERE id = ?1",
            params![id],
        )?;
        let entry_changed = tx.execute(
            "UPDATE deckhub_entries
             SET status = 'unlisted', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![id],
        )?;
        update_deck_visibility(&tx, id)?;
        tx.commit()?;
        Ok(changed > 0 || entry_changed > 0)
    }

    pub fn publishes_since(&self, ip: &str, since: &str) -> SqlResult<u32> {
        self.conn.query_row(
            "SELECT count(*) FROM hub_decks WHERE publish_ip = ?1 AND created_at >= ?2",
            params![ip, since],
            |row| row.get(0),
        )
    }

    pub fn deck_owner(&self, id: &str) -> SqlResult<Option<Option<String>>> {
        self.conn
            .query_row(
                "SELECT account_id FROM hub_decks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn delete_deck_owned(&self, id: &str, account_id: &str) -> SqlResult<DeleteOutcome> {
        match self.deck_owner(id)? {
            None => Ok(DeleteOutcome::NotFound),
            Some(owner) if owner.as_deref() != Some(account_id) => Ok(DeleteOutcome::Forbidden),
            Some(_) => {
                let tx = self.conn.unchecked_transaction()?;
                tx.execute("DELETE FROM hub_decks WHERE id = ?1", params![id])?;
                tx.execute(
                    "UPDATE deckhub_entries
                     SET status = 'unlisted', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                     WHERE id = ?1",
                    params![id],
                )?;
                update_deck_visibility(&tx, id)?;
                tx.commit()?;
                Ok(DeleteOutcome::Deleted)
            }
        }
    }

    pub fn list_account_decks(
        &self,
        account_id: &str,
        limit: u32,
    ) -> SqlResult<Vec<HubDeckSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, author, description, format, commanders, colors, card_count,
                    cover_card_name, cover_image_url, created_at
             FROM hub_decks
             WHERE account_id = ?1 AND unlisted = 0
             ORDER BY created_at DESC LIMIT ?2",
        )?;
        let decks = stmt
            .query_map(params![account_id, limit], map_summary)?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(decks)
    }

    pub fn create_account_deck(
        &self,
        account_id: &str,
        deck: &Deck,
        notes: Option<&str>,
        now: &str,
    ) -> SqlResult<AccountDeckDetail> {
        let deck_id = uuid::Uuid::new_v4().to_string();
        let version_id = uuid::Uuid::new_v4().to_string();
        let snapshot_json = serde_json::to_string(deck)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO decks
                (id, account_id, name, format, description, visibility, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'private', ?6, ?6)",
            params![
                deck_id,
                account_id,
                deck.name,
                format_to_str(deck.format),
                deck.description,
                now,
            ],
        )?;
        tx.execute(
            "INSERT INTO deck_versions
                (id, deck_id, version_no, notes, format, color_identity, card_count,
                 commander_names, snapshot_json, content_hash, created_at)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                version_id,
                deck_id,
                notes,
                format_to_str(deck.format),
                deck_colors(deck),
                display_cards(deck).count() as u32,
                commander_names_json(deck),
                snapshot_json,
                sha256_hex(snapshot_json.as_bytes()),
                now,
            ],
        )?;
        insert_deck_cards(&tx, &version_id, deck)?;
        tx.commit()?;
        self.get_account_deck(account_id, &deck_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn sync_preset_decks(&self, presets: &[PresetDeck], now: &str) -> SqlResult<()> {
        let tx = self.conn.unchecked_transaction()?;
        let mut current_entries = Vec::with_capacity(presets.len());
        tx.execute_batch(
            "CREATE TEMP TABLE syncing_preset_keys (preset_key TEXT PRIMARY KEY) WITHOUT ROWID;",
        )?;
        for preset in presets {
            tx.execute(
                "INSERT INTO syncing_preset_keys (preset_key) VALUES (?1)",
                params![preset.key],
            )?;
            let deck_id = format!("preset-deck:{}", preset.key);
            let snapshot_json = serde_json::to_string(&preset.deck)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            let content_hash = sha256_hex(snapshot_json.as_bytes());
            tx.execute(
                "INSERT INTO decks
                    (id, account_id, kind, preset_key, name, format, description, visibility,
                     created_at, updated_at)
                 VALUES (?1, NULL, 'preset', ?2, ?3, ?4, ?5, 'public', ?6, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    format = excluded.format,
                    description = excluded.description,
                    visibility = 'public',
                    updated_at = excluded.updated_at,
                    deleted_at = NULL",
                params![
                    deck_id,
                    preset.key,
                    preset.deck.name,
                    format_to_str(preset.deck.format),
                    preset.deck.description,
                    now,
                ],
            )?;
            let current = tx
                .query_row(
                    "SELECT id, version_no, content_hash FROM deck_versions
                     WHERE deck_id = ?1 ORDER BY version_no DESC LIMIT 1",
                    params![deck_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, u32>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            let (version_id, version_no) = match current {
                Some((version_id, version_no, current_hash)) if current_hash == content_hash => {
                    (version_id, version_no)
                }
                current => {
                    let version_no = current.map_or(1, |(_, version_no, _)| version_no + 1);
                    let version_id = format!("preset-version:{}:{version_no}", preset.key);
                    tx.execute(
                        "INSERT INTO deck_versions
                            (id, deck_id, version_no, notes, format, color_identity, card_count,
                             commander_names, snapshot_json, content_hash, created_at)
                         VALUES (?1, ?2, ?3, 'Official preset snapshot', ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        params![
                            version_id,
                            deck_id,
                            version_no,
                            format_to_str(preset.deck.format),
                            deck_colors(&preset.deck),
                            display_cards(&preset.deck).count() as u32,
                            commander_names_json(&preset.deck),
                            snapshot_json,
                            content_hash,
                            now,
                        ],
                    )?;
                    insert_deck_cards(&tx, &version_id, &preset.deck)?;
                    (version_id, version_no)
                }
            };
            let entry_id = format!("preset-entry:{}:{version_no}", preset.key);
            current_entries.push(entry_id.clone());
            let slug = format!(
                "{}-v{version_no}",
                legacy_slug(&preset.deck.name, &preset.key)
            );
            tx.execute(
                "UPDATE deckhub_entries
                 SET status = 'archived', updated_at = ?2
                 WHERE deck_id = ?1 AND id != ?3 AND status = 'published'",
                params![deck_id, now, entry_id],
            )?;
            tx.execute(
                "INSERT INTO deckhub_entries
                    (id, deck_id, published_version_id, slug, title, summary, cover_card_name,
                     status, published_at, created_at, updated_at, legacy_author)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'published', ?8, ?8, ?8, 'ManaBrew')
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    summary = excluded.summary,
                    cover_card_name = excluded.cover_card_name,
                    status = 'published',
                    updated_at = excluded.updated_at",
                params![
                    entry_id,
                    deck_id,
                    version_id,
                    slug,
                    preset.deck.name,
                    preset.deck.description,
                    preset.deck.cover_card_name,
                    now,
                ],
            )?;
            replace_entry_tags(&tx, &entry_id, &["Official".into(), "Preset".into()])?;
        }
        tx.execute(
            "UPDATE deckhub_entries
             SET status = 'archived', updated_at = ?1
             WHERE status = 'published' AND deck_id IN (
                SELECT id FROM decks WHERE kind = 'preset' AND preset_key NOT IN (
                    SELECT preset_key FROM syncing_preset_keys
                )
             )",
            params![now],
        )?;
        tx.execute(
            "UPDATE decks
             SET visibility = 'unlisted', deleted_at = ?1, updated_at = ?1
             WHERE kind = 'preset' AND preset_key NOT IN (
                SELECT preset_key FROM syncing_preset_keys
             )",
            params![now],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO top_deck_buckets (id, key, label, scope, created_at)
             VALUES ('top-decks-official-presets', 'official-presets', 'Official Presets',
                     'preset', ?1)",
            params![now],
        )?;
        let snapshot_date = now.split('T').next().unwrap_or(now);
        tx.execute(
            "DELETE FROM top_deck_snapshots
             WHERE bucket_id = 'top-decks-official-presets' AND snapshot_date = ?1",
            params![snapshot_date],
        )?;
        for (index, entry_id) in current_entries.iter().enumerate() {
            tx.execute(
                "INSERT INTO top_deck_snapshots
                    (id, bucket_id, deckhub_entry_id, rank, reason, snapshot_date, created_at)
                 VALUES (?1, 'top-decks-official-presets', ?2, ?3,
                         'Official ManaBrew preset', ?4, ?5)",
                params![
                    format!("preset-snapshot:{snapshot_date}:{}", index + 1),
                    entry_id,
                    index + 1,
                    snapshot_date,
                    now,
                ],
            )?;
        }
        tx.execute_batch("DROP TABLE syncing_preset_keys")?;
        tx.commit()
    }

    pub fn fork_preset_deck(
        &self,
        account_id: &str,
        preset_key: &str,
        now: &str,
    ) -> SqlResult<Option<AccountDeckDetail>> {
        let existing = self
            .conn
            .query_row(
                "SELECT fork.id
                 FROM decks fork
                 JOIN decks preset ON preset.id = fork.derived_from_deck_id
                 WHERE fork.account_id = ?1 AND fork.kind = 'user'
                   AND preset.preset_key = ?2 COLLATE NOCASE
                   AND fork.deleted_at IS NULL",
                params![account_id, preset_key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(deck_id) = existing {
            return self.get_account_deck(account_id, &deck_id);
        }
        let source = self
            .conn
            .query_row(
                "SELECT d.id, v.snapshot_json
                 FROM decks d
                 JOIN deck_versions v ON v.deck_id = d.id
                    AND v.version_no = (
                        SELECT max(latest.version_no) FROM deck_versions latest
                        WHERE latest.deck_id = d.id
                    )
                 WHERE d.kind = 'preset' AND d.preset_key = ?1 COLLATE NOCASE
                   AND d.deleted_at IS NULL",
                params![preset_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((source_deck_id, snapshot_json)) = source else {
            return Ok(None);
        };
        let mut deck: Deck = serde_json::from_str(&snapshot_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        let deck_id = uuid::Uuid::new_v4().to_string();
        let version_id = uuid::Uuid::new_v4().to_string();
        deck.id = Some(deck_id.clone());
        let fork_snapshot = serde_json::to_string(&deck)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO decks
                (id, account_id, kind, derived_from_deck_id, name, format, description,
                 visibility, created_at, updated_at)
             VALUES (?1, ?2, 'user', ?3, ?4, ?5, ?6, 'private', ?7, ?7)",
            params![
                deck_id,
                account_id,
                source_deck_id,
                deck.name,
                format_to_str(deck.format),
                deck.description,
                now,
            ],
        )?;
        tx.execute(
            "INSERT INTO deck_versions
                (id, deck_id, version_no, notes, format, color_identity, card_count,
                 commander_names, snapshot_json, content_hash, created_at)
             VALUES (?1, ?2, 1, 'Created from an official preset', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                version_id,
                deck_id,
                format_to_str(deck.format),
                deck_colors(&deck),
                display_cards(&deck).count() as u32,
                commander_names_json(&deck),
                fork_snapshot,
                sha256_hex(fork_snapshot.as_bytes()),
                now,
            ],
        )?;
        insert_deck_cards(&tx, &version_id, &deck)?;
        tx.commit()?;
        self.get_account_deck(account_id, &deck_id)
    }

    pub fn list_owned_decks(&self, account_id: &str) -> SqlResult<Vec<AccountDeckSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT d.id, d.name, d.format, d.description, d.visibility,
                    v.id, v.version_no,
                    (SELECT count(*) FROM deckhub_entries e
                     WHERE e.deck_id = d.id AND e.status != 'archived'),
                    source.preset_key, d.created_at, d.updated_at
             FROM decks d
             LEFT JOIN decks source ON source.id = d.derived_from_deck_id
             JOIN deck_versions v ON v.deck_id = d.id
                AND v.version_no = (
                    SELECT max(latest.version_no) FROM deck_versions latest
                    WHERE latest.deck_id = d.id
                )
             WHERE d.account_id = ?1 AND d.deleted_at IS NULL
             ORDER BY d.updated_at DESC, d.id ASC",
        )?;
        let rows = stmt.query_map(params![account_id], map_account_deck_summary)?;
        rows.collect::<SqlResult<Vec<_>>>()
    }

    pub fn get_account_deck(
        &self,
        account_id: &str,
        deck_id: &str,
    ) -> SqlResult<Option<AccountDeckDetail>> {
        self.conn
            .query_row(
                "SELECT d.id, d.name, d.format, d.description, d.visibility,
                        v.id, v.version_no,
                        (SELECT count(*) FROM deckhub_entries e
                         WHERE e.deck_id = d.id AND e.status != 'archived'),
                        source.preset_key, d.created_at, d.updated_at, v.snapshot_json
                 FROM decks d
                 LEFT JOIN decks source ON source.id = d.derived_from_deck_id
                 JOIN deck_versions v ON v.deck_id = d.id
                    AND v.version_no = (
                        SELECT max(latest.version_no) FROM deck_versions latest
                        WHERE latest.deck_id = d.id
                    )
                 WHERE d.id = ?1 AND d.account_id = ?2 AND d.deleted_at IS NULL",
                params![deck_id, account_id],
                |row| {
                    let summary = map_account_deck_summary(row)?;
                    let snapshot_json: String = row.get(11)?;
                    let deck = serde_json::from_str(&snapshot_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            11,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(AccountDeckDetail { summary, deck })
                },
            )
            .optional()
    }

    pub fn save_account_deck(
        &self,
        account_id: &str,
        deck_id: &str,
        expected_version_no: u32,
        deck: &Deck,
        notes: Option<&str>,
        now: &str,
    ) -> SqlResult<SaveVersionOutcome> {
        let tx = self.conn.unchecked_transaction()?;
        let current = tx
            .query_row(
                "SELECT d.account_id, v.version_no, v.content_hash
                 FROM decks d
                 JOIN deck_versions v ON v.deck_id = d.id
                    AND v.version_no = (
                        SELECT max(latest.version_no) FROM deck_versions latest
                        WHERE latest.deck_id = d.id
                    )
                 WHERE d.id = ?1 AND d.kind = 'user' AND d.deleted_at IS NULL",
                params![deck_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u32>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((owner, current_version_no, current_hash)) = current else {
            return Ok(SaveVersionOutcome::NotFound);
        };
        if owner != account_id {
            return Ok(SaveVersionOutcome::Forbidden);
        }
        if current_version_no != expected_version_no {
            return Ok(SaveVersionOutcome::Conflict);
        }
        let snapshot_json = serde_json::to_string(deck)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let content_hash = sha256_hex(snapshot_json.as_bytes());
        if content_hash == current_hash {
            tx.rollback()?;
            return self
                .get_account_deck(account_id, deck_id)?
                .map(SaveVersionOutcome::Unchanged)
                .ok_or(rusqlite::Error::QueryReturnedNoRows);
        }
        let version_id = uuid::Uuid::new_v4().to_string();
        let version_no = current_version_no + 1;
        tx.execute(
            "INSERT INTO deck_versions
                (id, deck_id, version_no, notes, format, color_identity, card_count,
                 commander_names, snapshot_json, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                version_id,
                deck_id,
                version_no,
                notes,
                format_to_str(deck.format),
                deck_colors(deck),
                display_cards(deck).count() as u32,
                commander_names_json(deck),
                snapshot_json,
                content_hash,
                now,
            ],
        )?;
        insert_deck_cards(&tx, &version_id, deck)?;
        tx.execute(
            "UPDATE decks
             SET name = ?2, format = ?3, description = ?4, updated_at = ?5
             WHERE id = ?1",
            params![
                deck_id,
                deck.name,
                format_to_str(deck.format),
                deck.description,
                now,
            ],
        )?;
        tx.commit()?;
        self.get_account_deck(account_id, deck_id)?
            .map(SaveVersionOutcome::Saved)
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn delete_account_deck(
        &self,
        account_id: &str,
        deck_id: &str,
        now: &str,
    ) -> SqlResult<DeleteOutcome> {
        let owner = self
            .conn
            .query_row(
                "SELECT account_id FROM decks
                 WHERE id = ?1 AND kind = 'user' AND deleted_at IS NULL",
                params![deck_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        match owner {
            None => Ok(DeleteOutcome::NotFound),
            Some(owner) if owner != account_id => Ok(DeleteOutcome::Forbidden),
            Some(_) => {
                self.conn.execute(
                    "UPDATE decks SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                    params![deck_id, now],
                )?;
                Ok(DeleteOutcome::Deleted)
            }
        }
    }

    pub fn list_deck_versions(
        &self,
        account_id: &str,
        deck_id: &str,
    ) -> SqlResult<Option<Vec<DeckVersionSummary>>> {
        if !self.owns_deck(account_id, deck_id)? {
            return Ok(None);
        }
        let mut stmt = self.conn.prepare(
            "SELECT v.id, v.version_no, v.notes,
                    EXISTS(SELECT 1 FROM deckhub_entries e
                           WHERE e.published_version_id = v.id AND e.status != 'archived'),
                    v.created_at
             FROM deck_versions v
             WHERE v.deck_id = ?1
             ORDER BY v.version_no DESC",
        )?;
        let versions = stmt
            .query_map(params![deck_id], |row| {
                Ok(DeckVersionSummary {
                    id: row.get(0)?,
                    version_no: row.get(1)?,
                    notes: row.get(2)?,
                    published: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(Some(versions))
    }

    pub fn get_deck_version(
        &self,
        account_id: &str,
        deck_id: &str,
        version_no: u32,
    ) -> SqlResult<Option<DeckVersionDetail>> {
        self.conn
            .query_row(
                "SELECT v.id, v.version_no, v.notes,
                        EXISTS(SELECT 1 FROM deckhub_entries e
                               WHERE e.published_version_id = v.id AND e.status != 'archived'),
                        v.created_at, v.snapshot_json
                 FROM deck_versions v
                 JOIN decks d ON d.id = v.deck_id
                 WHERE v.deck_id = ?1 AND v.version_no = ?2 AND d.account_id = ?3",
                params![deck_id, version_no, account_id],
                |row| {
                    let summary = DeckVersionSummary {
                        id: row.get(0)?,
                        version_no: row.get(1)?,
                        notes: row.get(2)?,
                        published: row.get(3)?,
                        created_at: row.get(4)?,
                    };
                    let snapshot_json: String = row.get(5)?;
                    let deck = serde_json::from_str(&snapshot_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            5,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(DeckVersionDetail { summary, deck })
                },
            )
            .optional()
    }

    fn owns_deck(&self, account_id: &str, deck_id: &str) -> SqlResult<bool> {
        self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM decks
                           WHERE id = ?1 AND kind = 'user'
                             AND account_id = ?2 AND deleted_at IS NULL)",
            params![deck_id, account_id],
            |row| row.get(0),
        )
    }

    pub fn list_deckhub_entries(
        &self,
        params: &DeckHubListParams,
    ) -> SqlResult<(Vec<DeckHubEntrySummary>, u32)> {
        let mut where_clause = String::from("e.status = 'published'");
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(search) = params.search.as_deref().filter(|value| !value.is_empty()) {
            let pattern = like_pattern(search);
            let index = args.len() + 1;
            where_clause.push_str(&format!(
                " AND (e.title LIKE ?{index} ESCAPE '\\'
                       OR COALESCE(e.summary, '') LIKE ?{index} ESCAPE '\\'
                       OR COALESCE(e.legacy_author, a.username, a.handle, 'ManaBrew') LIKE ?{index} ESCAPE '\\'
                       OR EXISTS(
                           SELECT 1 FROM deck_cards search_card
                           WHERE search_card.deck_version_id = v.id
                             AND search_card.card_name LIKE ?{index} ESCAPE '\\'
                       ))"
            ));
            args.push(Box::new(pattern));
        }
        if let Some(source_kind) = params.source_kind.as_deref() {
            let index = args.len() + 1;
            where_clause.push_str(&format!(" AND d.kind = ?{index}"));
            args.push(Box::new(source_kind.to_string()));
        }
        if !params.formats.is_empty() {
            let placeholders = push_string_args(&mut args, &params.formats);
            where_clause.push_str(&format!(" AND v.format IN ({placeholders})"));
        }
        if let Some(colors) = params.colors.as_deref() {
            match params.color_match {
                DeckHubColorMatch::Exact => {
                    let index = args.len() + 1;
                    where_clause.push_str(&format!(" AND v.color_identity = ?{index}"));
                    args.push(Box::new(colors.to_string()));
                }
                DeckHubColorMatch::Includes => {
                    for color in colors.chars() {
                        let index = args.len() + 1;
                        where_clause
                            .push_str(&format!(" AND instr(v.color_identity, ?{index}) > 0"));
                        args.push(Box::new(color.to_string()));
                    }
                }
            }
        }
        if !params.tags.is_empty() {
            match params.tag_match {
                DeckHubTagMatch::Any => {
                    let placeholders = push_string_args(&mut args, &params.tags);
                    where_clause.push_str(&format!(
                        " AND EXISTS(
                            SELECT 1 FROM deckhub_entry_tags et
                            JOIN deckhub_tags t ON t.id = et.tag_id
                            WHERE et.deckhub_entry_id = e.id
                              AND t.slug IN ({placeholders})
                        )"
                    ));
                }
                DeckHubTagMatch::All => {
                    for tag in &params.tags {
                        let index = args.len() + 1;
                        where_clause.push_str(&format!(
                            " AND EXISTS(
                                SELECT 1 FROM deckhub_entry_tags et
                                JOIN deckhub_tags t ON t.id = et.tag_id
                                WHERE et.deckhub_entry_id = e.id
                                  AND t.slug = ?{index} COLLATE NOCASE
                            )"
                        ));
                        args.push(Box::new(tag.clone()));
                    }
                }
            }
        }
        for (value, commander_only) in [
            (params.commander.as_deref(), true),
            (params.card.as_deref(), false),
        ] {
            if let Some(value) = value.filter(|value| !value.is_empty()) {
                let index = args.len() + 1;
                where_clause.push_str(&format!(
                    " AND EXISTS(
                        SELECT 1 FROM deck_cards filter_card
                        WHERE filter_card.deck_version_id = v.id
                          AND filter_card.card_name LIKE ?{index} ESCAPE '\\'
                          {}
                    )",
                    if commander_only {
                        "AND filter_card.is_commander = 1"
                    } else {
                        ""
                    }
                ));
                args.push(Box::new(like_pattern(value)));
            }
        }
        if params.favorites_only {
            if let Some(account_id) = params.viewer_account_id.as_deref() {
                let index = args.len() + 1;
                where_clause.push_str(&format!(
                    " AND EXISTS(
                        SELECT 1 FROM deckhub_favorites viewer_favorite
                        WHERE viewer_favorite.deckhub_entry_id = e.id
                          AND viewer_favorite.account_id = ?{index}
                    )"
                ));
                args.push(Box::new(account_id.to_string()));
            } else {
                where_clause.push_str(" AND 0 = 1");
            }
        }
        if params.owned_only {
            if let Some(account_id) = params.viewer_account_id.as_deref() {
                let index = args.len() + 1;
                where_clause.push_str(&format!(" AND d.account_id = ?{index}"));
                args.push(Box::new(account_id.to_string()));
            } else {
                where_clause.push_str(" AND 0 = 1");
            }
        }
        let total: u32 = self.conn.query_row(
            &format!(
                "SELECT count(*) FROM deckhub_entries e
                 JOIN decks d ON d.id = e.deck_id
                 LEFT JOIN accounts a ON a.id = d.account_id
                 JOIN deck_versions v ON v.id = e.published_version_id
                 WHERE {where_clause}"
            ),
            rusqlite::params_from_iter(args.iter().map(|argument| argument.as_ref())),
            |row| row.get(0),
        )?;
        let viewer_index = args.len() + 1;
        let order = match params.sort {
            DeckHubSortOrder::Newest => "e.published_at DESC, e.id ASC",
            DeckHubSortOrder::Name => "e.title COLLATE NOCASE ASC, e.id ASC",
            DeckHubSortOrder::Favorites => "favorite_count DESC, e.published_at DESC, e.id ASC",
        };
        let offset = params
            .page
            .saturating_sub(1)
            .saturating_mul(params.page_size);
        let sql = format!(
            "SELECT e.id, e.deck_id, e.published_version_id, v.version_no, e.slug, e.title,
                    e.summary, COALESCE(e.legacy_author, a.username, a.handle, 'ManaBrew'),
                    d.kind, d.preset_key, v.format,
                    v.commander_names, v.color_identity, v.card_count, v.snapshot_json,
                    e.cover_card_id, e.cover_card_name, e.status, e.published_at,
                    (SELECT count(*) FROM deckhub_favorites f WHERE f.deckhub_entry_id = e.id)
                        AS favorite_count,
                    EXISTS(SELECT 1 FROM deckhub_favorites f
                           WHERE f.deckhub_entry_id = e.id AND f.account_id = ?{viewer_index}),
                    COALESCE(d.account_id = ?{viewer_index}, 0)
             FROM deckhub_entries e
             JOIN decks d ON d.id = e.deck_id
             LEFT JOIN accounts a ON a.id = d.account_id
             JOIN deck_versions v ON v.id = e.published_version_id
             WHERE {where_clause}
             ORDER BY {order} LIMIT {} OFFSET {}",
            params.page_size, offset
        );
        args.push(Box::new(params.viewer_account_id.clone()));
        let mut stmt = self.conn.prepare(&sql)?;
        let mut entries = stmt
            .query_map(
                rusqlite::params_from_iter(args.iter().map(|argument| argument.as_ref())),
                map_deckhub_entry_summary,
            )?
            .collect::<SqlResult<Vec<_>>>()?;
        self.attach_entry_tags(&mut entries)?;
        Ok((entries, total))
    }

    pub fn get_deckhub_entry(
        &self,
        entry_ref: &str,
        viewer_account_id: Option<&str>,
    ) -> SqlResult<Option<DeckHubEntryDetail>> {
        let detail = self
            .conn
            .query_row(
                "SELECT e.id, e.deck_id, e.published_version_id, v.version_no, e.slug, e.title,
                        e.summary, COALESCE(e.legacy_author, a.username, a.handle, 'ManaBrew'),
                        d.kind, d.preset_key, v.format,
                        v.commander_names, v.color_identity, v.card_count, v.snapshot_json,
                        e.cover_card_id, e.cover_card_name, e.status, e.published_at,
                        (SELECT count(*) FROM deckhub_favorites f
                         WHERE f.deckhub_entry_id = e.id),
                        EXISTS(SELECT 1 FROM deckhub_favorites f
                               WHERE f.deckhub_entry_id = e.id AND f.account_id = ?2),
                        COALESCE(d.account_id = ?2, 0)
                 FROM deckhub_entries e
                 JOIN decks d ON d.id = e.deck_id
                 LEFT JOIN accounts a ON a.id = d.account_id
                 JOIN deck_versions v ON v.id = e.published_version_id
                 WHERE (e.id = ?1 OR e.slug = ?1 COLLATE NOCASE
                        OR (d.kind = 'preset' AND d.preset_key = ?1 COLLATE NOCASE
                            AND e.status = 'published'))
                   AND (e.status = 'published'
                        OR (e.status = 'archived' AND d.kind = 'preset')
                        OR d.account_id = ?2)",
                params![entry_ref, viewer_account_id],
                |row| {
                    let entry = map_deckhub_entry_summary(row)?;
                    let snapshot_json: String = row.get(14)?;
                    let deck = serde_json::from_str(&snapshot_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            14,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(DeckHubEntryDetail { entry, deck })
                },
            )
            .optional()?;
        match detail {
            Some(mut detail) => {
                detail.entry.tags = self.list_entry_tags(&detail.entry.id)?;
                Ok(Some(detail))
            }
            None => Ok(None),
        }
    }

    pub fn create_deckhub_entry(
        &self,
        account_id: &str,
        entry: &NewDeckHubEntry,
    ) -> SqlResult<Option<DeckHubEntryDetail>> {
        let source = self
            .conn
            .query_row(
                "SELECT v.snapshot_json, a.handle
                 FROM decks d
                 JOIN deck_versions v ON v.deck_id = d.id
                 JOIN accounts a ON a.id = d.account_id
                 WHERE d.id = ?1 AND v.id = ?2 AND d.account_id = ?3 AND d.deleted_at IS NULL",
                params![entry.deck_id, entry.published_version_id, account_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((snapshot_json, author)) = source else {
            return Ok(None);
        };
        let deck: Deck = serde_json::from_str(&snapshot_json)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let id = uuid::Uuid::new_v4().to_string();
        let tx = self.conn.unchecked_transaction()?;
        let slug = unique_slug(&tx, &entry.title, &id)?;
        tx.execute(
            "INSERT INTO deckhub_entries
                (id, deck_id, published_version_id, slug, title, summary, cover_card_id,
                 cover_card_name, status, published_at, created_at, updated_at, publish_ip)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'published', ?9, ?9, ?9, ?10)",
            params![
                id,
                entry.deck_id,
                entry.published_version_id,
                slug,
                entry.title,
                entry.summary,
                entry.cover_card_id,
                entry.cover_card_name,
                entry.created_at,
                entry.publish_ip,
            ],
        )?;
        replace_entry_tags(&tx, &id, &entry.tags)?;
        tx.execute(
            "UPDATE decks SET visibility = 'public', updated_at = ?2 WHERE id = ?1",
            params![entry.deck_id, entry.created_at],
        )?;
        let legacy = legacy_summary(&id, &author, &deck, &entry.created_at);
        tx.execute(
            "INSERT INTO hub_decks
                (id, name, author, description, format, commanders, colors, card_count,
                 cover_card_name, cover_image_url, deck_json, management_token_hash,
                 publish_ip, created_at, account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                legacy.id,
                entry.title,
                legacy.author,
                entry.summary,
                format_to_str(legacy.format),
                serde_json::to_string(&legacy.commanders).unwrap_or_else(|_| "[]".into()),
                legacy.colors,
                legacy.card_count,
                legacy.cover_card_name,
                legacy.cover_image_url,
                snapshot_json,
                sha256_hex(uuid::Uuid::new_v4().as_bytes()),
                entry.publish_ip,
                entry.created_at,
                account_id,
            ],
        )?;
        tx.commit()?;
        self.get_deckhub_entry(&id, Some(account_id))
    }

    pub fn update_deckhub_entry(
        &self,
        account_id: &str,
        entry_id: &str,
        update: &DeckHubEntryUpdate,
    ) -> SqlResult<DeleteOutcome> {
        let owner = self.deckhub_entry_owner(entry_id)?;
        match owner {
            None => Ok(DeleteOutcome::NotFound),
            Some(owner) if owner != account_id => Ok(DeleteOutcome::Forbidden),
            Some(_) => {
                let tx = self.conn.unchecked_transaction()?;
                tx.execute(
                    "UPDATE deckhub_entries
                     SET title = ?2, summary = ?3, cover_card_id = ?4,
                         cover_card_name = ?5, updated_at = ?6
                     WHERE id = ?1",
                    params![
                        entry_id,
                        update.title,
                        update.summary,
                        update.cover_card_id,
                        update.cover_card_name,
                        update.updated_at,
                    ],
                )?;
                replace_entry_tags(&tx, entry_id, &update.tags)?;
                tx.execute(
                    "UPDATE hub_decks
                     SET name = ?2, description = ?3, cover_card_name = ?4
                     WHERE id = ?1",
                    params![
                        entry_id,
                        update.title,
                        update.summary,
                        update.cover_card_name,
                    ],
                )?;
                tx.commit()?;
                Ok(DeleteOutcome::Deleted)
            }
        }
    }

    pub fn unpublish_deckhub_entry(
        &self,
        account_id: &str,
        entry_id: &str,
        now: &str,
    ) -> SqlResult<DeleteOutcome> {
        let owner = self.deckhub_entry_owner(entry_id)?;
        match owner {
            None => Ok(DeleteOutcome::NotFound),
            Some(owner) if owner != account_id => Ok(DeleteOutcome::Forbidden),
            Some(_) => {
                let tx = self.conn.unchecked_transaction()?;
                tx.execute(
                    "UPDATE deckhub_entries SET status = 'unlisted', updated_at = ?2 WHERE id = ?1",
                    params![entry_id, now],
                )?;
                tx.execute(
                    "UPDATE hub_decks SET unlisted = 1 WHERE id = ?1",
                    params![entry_id],
                )?;
                update_deck_visibility(&tx, entry_id)?;
                tx.commit()?;
                Ok(DeleteOutcome::Deleted)
            }
        }
    }

    fn deckhub_entry_owner(&self, entry_id: &str) -> SqlResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT d.account_id
                 FROM deckhub_entries e JOIN decks d ON d.id = e.deck_id
                 WHERE e.id = ?1 AND d.account_id IS NOT NULL",
                params![entry_id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn list_tags(&self) -> SqlResult<Vec<DeckHubTag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.slug
             FROM deckhub_tags t
             WHERE EXISTS(SELECT 1 FROM deckhub_entry_tags et
                          JOIN deckhub_entries e ON e.id = et.deckhub_entry_id
                          WHERE et.tag_id = t.id AND e.status = 'published')
             ORDER BY t.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], map_deckhub_tag)?;
        rows.collect::<SqlResult<Vec<_>>>()
    }

    pub fn deckhub_facets(&self) -> SqlResult<DeckHubFacets> {
        let total = self.conn.query_row(
            "SELECT count(*) FROM deckhub_entries WHERE status = 'published'",
            [],
            |row| row.get(0),
        )?;
        let formats = {
            let mut stmt = self.conn.prepare(
                "SELECT v.format, v.format, count(*)
                 FROM deckhub_entries e
                 JOIN deck_versions v ON v.id = e.published_version_id
                 WHERE e.status = 'published' AND v.format IS NOT NULL
                 GROUP BY v.format ORDER BY count(*) DESC, v.format ASC",
            )?;
            let rows = stmt
                .query_map([], map_deckhub_facet)?
                .collect::<SqlResult<Vec<_>>>()?;
            rows
        };
        let colors = {
            let mut stmt = self.conn.prepare(
                "SELECT v.color_identity, v.color_identity, count(*)
                 FROM deckhub_entries e
                 JOIN deck_versions v ON v.id = e.published_version_id
                 WHERE e.status = 'published'
                 GROUP BY v.color_identity ORDER BY count(*) DESC, v.color_identity ASC",
            )?;
            let rows = stmt
                .query_map([], map_deckhub_facet)?
                .collect::<SqlResult<Vec<_>>>()?;
            rows
        };
        let tags = {
            let mut stmt = self.conn.prepare(
                "SELECT t.slug, t.name, count(*)
                 FROM deckhub_tags t
                 JOIN deckhub_entry_tags et ON et.tag_id = t.id
                 JOIN deckhub_entries e ON e.id = et.deckhub_entry_id
                 WHERE e.status = 'published'
                 GROUP BY t.id ORDER BY count(*) DESC, t.name COLLATE NOCASE ASC",
            )?;
            let rows = stmt
                .query_map([], map_deckhub_facet)?
                .collect::<SqlResult<Vec<_>>>()?;
            rows
        };
        Ok(DeckHubFacets {
            total,
            formats,
            colors,
            tags,
        })
    }

    fn list_entry_tags(&self, entry_id: &str) -> SqlResult<Vec<DeckHubTag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.slug
             FROM deckhub_tags t
             JOIN deckhub_entry_tags et ON et.tag_id = t.id
             WHERE et.deckhub_entry_id = ?1
             ORDER BY t.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![entry_id], map_deckhub_tag)?;
        rows.collect::<SqlResult<Vec<_>>>()
    }

    fn attach_entry_tags(&self, entries: &mut [DeckHubEntrySummary]) -> SqlResult<()> {
        if entries.is_empty() {
            return Ok(());
        }
        let placeholders = (1..=entries.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT et.deckhub_entry_id, t.id, t.name, t.slug
             FROM deckhub_entry_tags et
             JOIN deckhub_tags t ON t.id = et.tag_id
             WHERE et.deckhub_entry_id IN ({placeholders})
             ORDER BY t.name COLLATE NOCASE ASC"
        );
        let ids = entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>();
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids), |row| {
            Ok((
                row.get::<_, String>(0)?,
                DeckHubTag {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    slug: row.get(3)?,
                },
            ))
        })?;
        let mut tags = BTreeMap::<String, Vec<DeckHubTag>>::new();
        for row in rows {
            let (entry_id, tag) = row?;
            tags.entry(entry_id).or_default().push(tag);
        }
        for entry in entries {
            entry.tags = tags.remove(&entry.id).unwrap_or_default();
        }
        Ok(())
    }

    pub fn set_favorite(
        &self,
        account_id: &str,
        entry_id: &str,
        favorite: bool,
        now: &str,
    ) -> SqlResult<Option<FavoriteResponse>> {
        let exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM deckhub_entries
                           WHERE id = ?1 AND status = 'published')",
            params![entry_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(None);
        }
        if favorite {
            self.conn.execute(
                "INSERT OR IGNORE INTO deckhub_favorites
                    (account_id, deckhub_entry_id, created_at)
                 VALUES (?1, ?2, ?3)",
                params![account_id, entry_id, now],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM deckhub_favorites WHERE account_id = ?1 AND deckhub_entry_id = ?2",
                params![account_id, entry_id],
            )?;
        }
        let favorite_count = self.conn.query_row(
            "SELECT count(*) FROM deckhub_favorites WHERE deckhub_entry_id = ?1",
            params![entry_id],
            |row| row.get(0),
        )?;
        Ok(Some(FavoriteResponse {
            favorite_count,
            favorited: favorite,
        }))
    }

    pub fn list_top_deck_buckets(&self) -> SqlResult<Vec<TopDeckBucket>> {
        let mut stmt = self.conn.prepare(
            "SELECT key, label, scope FROM top_deck_buckets
             ORDER BY CASE key
                 WHEN 'trending' THEN 0
                 WHEN 'commander' THEN 1
                 WHEN 'staff-picks' THEN 2
                 ELSE 3
             END, label COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TopDeckBucket {
                key: row.get(0)?,
                label: row.get(1)?,
                scope: row.get(2)?,
            })
        })?;
        rows.collect::<SqlResult<Vec<_>>>()
    }

    pub fn get_top_deck_snapshot(
        &self,
        bucket_key: &str,
        requested_date: Option<&str>,
        viewer_account_id: Option<&str>,
    ) -> SqlResult<Option<TopDeckSnapshot>> {
        let bucket = self
            .conn
            .query_row(
                "SELECT id, key, label, scope FROM top_deck_buckets WHERE key = ?1 COLLATE NOCASE",
                params![bucket_key],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        TopDeckBucket {
                            key: row.get(1)?,
                            label: row.get(2)?,
                            scope: row.get(3)?,
                        },
                    ))
                },
            )
            .optional()?;
        let Some((bucket_id, bucket)) = bucket else {
            return Ok(None);
        };
        let snapshot_date = match requested_date {
            Some(date) => Some(date.to_string()),
            None => self.conn.query_row(
                "SELECT max(snapshot_date) FROM top_deck_snapshots WHERE bucket_id = ?1",
                params![bucket_id],
                |row| row.get(0),
            )?,
        };
        let Some(snapshot_date) = snapshot_date else {
            return Ok(Some(TopDeckSnapshot {
                bucket,
                snapshot_date: None,
                entries: Vec::new(),
            }));
        };
        let ranked = {
            let mut stmt = self.conn.prepare(
                "SELECT deckhub_entry_id, rank, score, reason
                 FROM top_deck_snapshots
                 WHERE bucket_id = ?1 AND snapshot_date = ?2
                 ORDER BY rank ASC",
            )?;
            let rows = stmt.query_map(params![bucket_id, snapshot_date], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, Option<f64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?;
            rows.collect::<SqlResult<Vec<_>>>()?
        };
        let mut entries = Vec::with_capacity(ranked.len());
        for (entry_id, rank, score, reason) in ranked {
            if let Some(detail) = self.get_deckhub_entry(&entry_id, viewer_account_id)? {
                entries.push(TopDeckSnapshotEntry {
                    rank,
                    score,
                    reason,
                    entry: detail.entry,
                });
            }
        }
        Ok(Some(TopDeckSnapshot {
            bucket,
            snapshot_date: Some(snapshot_date),
            entries,
        }))
    }

    pub fn replace_top_deck_snapshot(
        &self,
        bucket_key: &str,
        snapshot_date: &str,
        entries: &[AdminTopDeckSnapshotEntry],
        now: &str,
    ) -> SqlResult<ReplaceSnapshotOutcome> {
        let bucket_id = self
            .conn
            .query_row(
                "SELECT id FROM top_deck_buckets WHERE key = ?1 COLLATE NOCASE",
                params![bucket_key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(bucket_id) = bucket_id else {
            return Ok(ReplaceSnapshotOutcome::BucketNotFound);
        };
        let tx = self.conn.unchecked_transaction()?;
        for entry in entries {
            let published = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM deckhub_entries
                               WHERE id = ?1 AND status = 'published')",
                params![entry.deckhub_entry_id],
                |row| row.get::<_, bool>(0),
            )?;
            if !published {
                return Ok(ReplaceSnapshotOutcome::EntryUnavailable);
            }
        }
        tx.execute(
            "DELETE FROM top_deck_snapshots WHERE bucket_id = ?1 AND snapshot_date = ?2",
            params![bucket_id, snapshot_date],
        )?;
        for entry in entries {
            tx.execute(
                "INSERT INTO top_deck_snapshots
                    (id, bucket_id, deckhub_entry_id, rank, score, reason,
                     snapshot_date, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    bucket_id,
                    entry.deckhub_entry_id,
                    entry.rank,
                    entry.score,
                    entry.reason,
                    snapshot_date,
                    now,
                ],
            )?;
        }
        tx.commit()?;
        Ok(ReplaceSnapshotOutcome::Replaced)
    }

    pub fn create_account(&self, account: &AccountRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO accounts
                (id, handle, handle_set, created_at, username, display_name, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?2, ?2, ?4)",
            params![
                account.id,
                account.handle,
                account.handle_set as i64,
                account.created_at
            ],
        )?;
        Ok(())
    }

    pub fn get_account(&self, id: &str) -> SqlResult<Option<AccountRow>> {
        self.conn
            .query_row(
                "SELECT id, handle, handle_set, created_at FROM accounts WHERE id = ?1",
                params![id],
                map_account,
            )
            .optional()
    }

    pub fn update_handle(&self, id: &str, handle: &str) -> SqlResult<HandleOutcome> {
        let result = self.conn.execute(
            "UPDATE accounts
             SET handle = ?2,
                 username = ?2,
                 display_name = CASE WHEN display_name = handle THEN ?2 ELSE display_name END,
                 handle_set = 1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![id, handle],
        );
        match result {
            Ok(_) => Ok(HandleOutcome::Updated),
            Err(error) if is_unique_violation(&error) => Ok(HandleOutcome::Conflict),
            Err(error) => Err(error),
        }
    }

    pub fn insert_identity(
        &self,
        account_id: &str,
        provider: &str,
        provider_user_id: &str,
        email: Option<&str>,
        email_verified: bool,
        now: &str,
    ) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO identities (id, account_id, provider, provider_user_id, email,
                email_verified, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                uuid::Uuid::new_v4().to_string(),
                account_id,
                provider,
                provider_user_id,
                email,
                email_verified as i64,
                now
            ],
        )?;
        if email_verified {
            self.conn.execute(
                "UPDATE accounts
                 SET email = COALESCE(email, ?2),
                     updated_at = CASE WHEN email IS NULL THEN ?3 ELSE updated_at END
                 WHERE id = ?1
                   AND NOT EXISTS (
                       SELECT 1 FROM accounts other
                       WHERE other.id != ?1
                         AND other.email = ?2 COLLATE NOCASE
                   )",
                params![account_id, email, now],
            )?;
        }
        Ok(())
    }

    pub fn identity_by_provider(
        &self,
        provider: &str,
        provider_user_id: &str,
    ) -> SqlResult<Option<IdentityRow>> {
        self.conn
            .query_row(
                "SELECT account_id, provider, email FROM identities
                 WHERE provider = ?1 AND provider_user_id = ?2",
                params![provider, provider_user_id],
                map_identity,
            )
            .optional()
    }

    pub fn account_id_by_verified_email(&self, email: &str) -> SqlResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT account_id FROM identities
                 WHERE email = ?1 COLLATE NOCASE AND email_verified = 1
                 ORDER BY created_at ASC LIMIT 1",
                params![email],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn list_identities(&self, account_id: &str) -> SqlResult<Vec<IdentityRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT account_id, provider, email FROM identities
             WHERE account_id = ?1 ORDER BY created_at ASC",
        )?;
        let identities = stmt
            .query_map(params![account_id], map_identity)?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(identities)
    }

    pub fn delete_identity(&self, account_id: &str, provider: &str) -> SqlResult<bool> {
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "DELETE FROM identities WHERE account_id = ?1 AND provider = ?2",
            params![account_id, provider],
        )?;
        if changed > 0 {
            tx.execute(
                "UPDATE accounts
                 SET email = (
                        SELECT i.email FROM identities i
                        WHERE i.account_id = ?1 AND i.email_verified = 1 AND i.email IS NOT NULL
                          AND NOT EXISTS (
                              SELECT 1 FROM accounts other
                              WHERE other.id != ?1 AND other.email = i.email COLLATE NOCASE
                          )
                        ORDER BY i.created_at ASC LIMIT 1
                     ),
                     updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                 WHERE id = ?1",
                params![account_id],
            )?;
        }
        tx.commit()?;
        Ok(changed > 0)
    }

    pub fn insert_session(
        &self,
        token_hash: &str,
        account_id: &str,
        now: &str,
        expires_at: &str,
    ) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM sessions WHERE expires_at <= ?1", params![now])?;
        self.conn.execute(
            "INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![token_hash, account_id, now, expires_at],
        )?;
        Ok(())
    }

    pub fn session_account(&self, token_hash: &str, now: &str) -> SqlResult<Option<AccountRow>> {
        self.conn
            .query_row(
                "SELECT a.id, a.handle, a.handle_set, a.created_at
                 FROM sessions s JOIN accounts a ON a.id = s.account_id
                 WHERE s.token_hash = ?1 AND s.expires_at > ?2",
                params![token_hash, now],
                map_account,
            )
            .optional()
    }

    pub fn extend_session(
        &self,
        token_hash: &str,
        threshold: &str,
        expires_at: &str,
    ) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE sessions SET expires_at = ?3
             WHERE token_hash = ?1 AND expires_at < ?2",
            params![token_hash, threshold, expires_at],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, token_hash: &str) -> SqlResult<()> {
        self.conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?1",
            params![token_hash],
        )?;
        Ok(())
    }

    pub fn insert_login_token(
        &self,
        code_hash: &str,
        email: &str,
        now: &str,
        expires_at: &str,
        request_ip: &str,
    ) -> SqlResult<()> {
        self.conn.execute(
            "DELETE FROM login_tokens WHERE expires_at <= ?1",
            params![now],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO login_tokens (code_hash, email, attempts, created_at,
                expires_at, request_ip)
             VALUES (?1, ?2, 0, ?3, ?4, ?5)",
            params![code_hash, email, now, expires_at, request_ip],
        )?;
        Ok(())
    }

    pub fn login_tokens_since(&self, email: &str, since: &str) -> SqlResult<u32> {
        self.conn.query_row(
            "SELECT count(*) FROM login_tokens
             WHERE email = ?1 COLLATE NOCASE AND created_at >= ?2",
            params![email, since],
            |row| row.get(0),
        )
    }

    pub fn delete_login_token(&self, code_hash: &str) -> SqlResult<()> {
        self.conn.execute(
            "DELETE FROM login_tokens WHERE code_hash = ?1",
            params![code_hash],
        )?;
        Ok(())
    }

    pub fn take_login_code(
        &self,
        email: &str,
        code_hash: &str,
        now: &str,
    ) -> SqlResult<LoginCodeOutcome> {
        let matched = self.conn.execute(
            "DELETE FROM login_tokens
             WHERE email = ?1 COLLATE NOCASE AND code_hash = ?2 AND expires_at > ?3",
            params![email, code_hash, now],
        )?;
        if matched > 0 {
            return Ok(LoginCodeOutcome::Verified);
        }
        self.conn.execute(
            "UPDATE login_tokens SET attempts = attempts + 1
             WHERE email = ?1 COLLATE NOCASE AND expires_at > ?2",
            params![email, now],
        )?;
        self.conn.execute(
            "DELETE FROM login_tokens WHERE email = ?1 COLLATE NOCASE AND attempts >= 5",
            params![email],
        )?;
        Ok(LoginCodeOutcome::Invalid)
    }

    pub fn insert_oauth_state(&self, state: &NewOAuthState) -> SqlResult<()> {
        self.conn.execute(
            "DELETE FROM oauth_states WHERE expires_at <= ?1",
            params![state.created_at],
        )?;
        self.conn.execute(
            "INSERT INTO oauth_states (state_hash, provider, mode, client, link_account_id,
                return_to, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                state.state_hash,
                state.provider,
                state.mode,
                state.client,
                state.link_account_id,
                state.return_to,
                state.created_at,
                state.expires_at
            ],
        )?;
        Ok(())
    }

    pub fn take_oauth_state(
        &self,
        state_hash: &str,
        now: &str,
    ) -> SqlResult<Option<OAuthStateRow>> {
        let row = self
            .conn
            .query_row(
                "SELECT provider, mode, client, link_account_id, return_to
                 FROM oauth_states WHERE state_hash = ?1 AND expires_at > ?2",
                params![state_hash, now],
                |row| {
                    Ok(OAuthStateRow {
                        provider: row.get(0)?,
                        mode: row.get(1)?,
                        client: row.get(2)?,
                        link_account_id: row.get(3)?,
                        return_to: row.get(4)?,
                    })
                },
            )
            .optional()?;
        self.conn.execute(
            "DELETE FROM oauth_states WHERE state_hash = ?1",
            params![state_hash],
        )?;
        Ok(row)
    }

    pub fn insert_auth_code(
        &self,
        code_hash: &str,
        account_id: &str,
        now: &str,
        expires_at: &str,
    ) -> SqlResult<()> {
        self.conn.execute(
            "DELETE FROM auth_codes WHERE expires_at <= ?1",
            params![now],
        )?;
        self.conn.execute(
            "INSERT INTO auth_codes (code_hash, account_id, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![code_hash, account_id, now, expires_at],
        )?;
        Ok(())
    }

    pub fn take_auth_code(&self, code_hash: &str, now: &str) -> SqlResult<Option<String>> {
        let account_id: Option<String> = self
            .conn
            .query_row(
                "SELECT account_id FROM auth_codes WHERE code_hash = ?1 AND expires_at > ?2",
                params![code_hash, now],
                |row| row.get(0),
            )
            .optional()?;
        self.conn.execute(
            "DELETE FROM auth_codes WHERE code_hash = ?1",
            params![code_hash],
        )?;
        Ok(account_id)
    }
}

struct LegacyHubDeck {
    id: String,
    name: String,
    author: String,
    description: Option<String>,
    format: Option<String>,
    cover_card_name: Option<String>,
    deck_json: String,
    management_token_hash: String,
    publish_ip: String,
    created_at: String,
    unlisted: bool,
    account_id: Option<String>,
}

fn migrate_legacy_hub_decks(tx: &Transaction<'_>) -> SqlResult<()> {
    const LEGACY_ACCOUNT_ID: &str = "00000000-0000-0000-0000-000000000000";
    tx.execute(
        "INSERT OR IGNORE INTO accounts
            (id, handle, handle_set, created_at, username, display_name, updated_at)
         VALUES (?1, 'legacy-deckhub', 1, '1970-01-01T00:00:00Z',
                 'legacy-deckhub', 'DeckHub Archive', '1970-01-01T00:00:00Z')",
        params![LEGACY_ACCOUNT_ID],
    )?;

    let legacy = {
        let mut stmt = tx.prepare(
            "SELECT id, name, author, description, format, cover_card_name, deck_json,
                    management_token_hash, publish_ip, created_at, unlisted, account_id
             FROM hub_decks ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LegacyHubDeck {
                id: row.get(0)?,
                name: row.get(1)?,
                author: row.get(2)?,
                description: row.get(3)?,
                format: row.get(4)?,
                cover_card_name: row.get(5)?,
                deck_json: row.get(6)?,
                management_token_hash: row.get(7)?,
                publish_ip: row.get(8)?,
                created_at: row.get(9)?,
                unlisted: row.get::<_, i64>(10)? != 0,
                account_id: row.get(11)?,
            })
        })?;
        rows.collect::<SqlResult<Vec<_>>>()?
    };

    for row in legacy {
        let deck: Deck = serde_json::from_str(&row.deck_json)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let owner_exists = match row.account_id.as_deref() {
            Some(account_id) => tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
                params![account_id],
                |result| result.get::<_, bool>(0),
            )?,
            None => false,
        };
        let account_id = if owner_exists {
            row.account_id.as_deref().unwrap_or(LEGACY_ACCOUNT_ID)
        } else {
            LEGACY_ACCOUNT_ID
        };
        let deck_id = format!("legacy-deck-{}", row.id);
        let version_id = format!("legacy-version-{}", row.id);
        tx.execute(
            "INSERT INTO decks
                (id, account_id, name, format, description, visibility, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                deck_id,
                account_id,
                row.name,
                row.format,
                row.description,
                if row.unlisted { "unlisted" } else { "public" },
                row.created_at,
            ],
        )?;
        tx.execute(
            "INSERT INTO deck_versions
                (id, deck_id, version_no, snapshot_json, content_hash, created_at)
             VALUES (?1, ?2, 1, ?3, ?4, ?5)",
            params![
                version_id,
                deck_id,
                row.deck_json,
                sha256_hex(row.deck_json.as_bytes()),
                row.created_at,
            ],
        )?;
        insert_deck_cards(tx, &version_id, &deck)?;
        tx.execute(
            "INSERT INTO deckhub_entries
                (id, deck_id, published_version_id, slug, title, summary, cover_card_name,
                 status, published_at, created_at, updated_at, legacy_author,
                 legacy_management_token_hash, publish_ip)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?9, ?10, ?11, ?12)",
            params![
                row.id,
                deck_id,
                version_id,
                legacy_slug(&row.name, &row.id),
                row.name,
                row.description,
                row.cover_card_name,
                if row.unlisted {
                    "unlisted"
                } else {
                    "published"
                },
                row.created_at,
                row.author,
                row.management_token_hash,
                row.publish_ip,
            ],
        )?;
    }
    Ok(())
}

fn backfill_version_discovery(tx: &Transaction<'_>) -> SqlResult<()> {
    let versions = {
        let mut stmt = tx.prepare("SELECT id, snapshot_json FROM deck_versions")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<SqlResult<Vec<_>>>()?
    };
    for (id, snapshot_json) in versions {
        let deck: Deck = serde_json::from_str(&snapshot_json)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        tx.execute(
            "UPDATE deck_versions
             SET format = ?1, color_identity = ?2, card_count = ?3, commander_names = ?4
             WHERE id = ?5",
            params![
                format_to_str(deck.format),
                deck_colors(&deck),
                display_cards(&deck).count() as u32,
                commander_names_json(&deck),
                id,
            ],
        )?;
    }
    Ok(())
}

type DeckCardRowKey = (Option<String>, String, String, String, bool, String, bool);

fn insert_deck_cards(tx: &Transaction<'_>, version_id: &str, deck: &Deck) -> SqlResult<()> {
    let mut cards = BTreeMap::<DeckCardRowKey, u32>::new();
    add_card_rows(&mut cards, &deck.cards, "main", false);
    add_card_rows(&mut cards, &deck.sideboard, "sideboard", false);
    add_card_rows(
        &mut cards,
        deck.commanders.as_deref().unwrap_or_default(),
        "commander",
        true,
    );
    if let Some(card) = deck.companion.as_ref() {
        add_card_rows(&mut cards, std::slice::from_ref(card), "companion", false);
    }
    for (board, zone) in [
        (deck.maybeboard.as_deref(), "maybeboard"),
        (deck.attractions.as_deref(), "attraction"),
        (deck.contraptions.as_deref(), "contraption"),
        (deck.schemes.as_deref(), "scheme"),
        (deck.planes.as_deref(), "plane"),
        (deck.tokens.as_deref(), "token"),
    ] {
        add_card_rows(&mut cards, board.unwrap_or_default(), zone, false);
    }
    for ((oracle_id, name, set_code, collector_number, foil, zone, is_commander), quantity) in cards
    {
        tx.execute(
            "INSERT INTO deck_cards
                (id, deck_version_id, card_oracle_id, card_name, set_code, collector_number,
                 foil, quantity, zone, is_commander)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                uuid::Uuid::new_v4().to_string(),
                version_id,
                oracle_id,
                name,
                set_code,
                collector_number,
                foil as i64,
                quantity,
                zone,
                is_commander as i64,
            ],
        )?;
    }
    Ok(())
}

fn add_card_rows(
    rows: &mut BTreeMap<DeckCardRowKey, u32>,
    cards: &[DeckCard],
    zone: &str,
    is_commander: bool,
) {
    for card in cards {
        *rows
            .entry((
                card.identity.oracle_id.clone(),
                card.identity.name.clone(),
                card.identity.set_code.clone(),
                card.identity.card_number.clone(),
                card.identity.foil.unwrap_or(false),
                zone.to_string(),
                is_commander,
            ))
            .or_default() += 1;
    }
}

fn legacy_slug(name: &str, id: &str) -> String {
    let mut slug = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        id.to_string()
    } else {
        format!("{slug}-{id}")
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn map_deckhub_entry_summary(row: &Row) -> SqlResult<DeckHubEntrySummary> {
    let format: Option<String> = row.get(10)?;
    let commanders: String = row.get(11)?;
    let snapshot_json: String = row.get(14)?;
    let deck: Deck = serde_json::from_str(&snapshot_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(14, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let cover_card_name: Option<String> = row
        .get::<_, Option<String>>(16)?
        .or_else(|| deck.cover_card_name.clone());
    let cover_image_url = cover_image(&deck, cover_card_name.as_deref());
    Ok(DeckHubEntrySummary {
        id: row.get(0)?,
        deck_id: row.get(1)?,
        published_version_id: row.get(2)?,
        published_version_no: row.get(3)?,
        slug: row.get(4)?,
        title: row.get(5)?,
        summary: row.get(6)?,
        author: row.get(7)?,
        source_kind: row.get(8)?,
        preset_key: row.get(9)?,
        format: format.as_deref().and_then(format_from_str),
        commanders: serde_json::from_str(&commanders).unwrap_or_default(),
        colors: row.get(12)?,
        card_count: row.get(13)?,
        cover_card_id: row.get(15)?,
        cover_card_name,
        cover_image_url,
        status: row.get(17)?,
        published_at: row.get(18)?,
        tags: Vec::new(),
        favorite_count: row.get(19)?,
        favorited: row.get(20)?,
        owned_by_viewer: row.get(21)?,
    })
}

fn map_deckhub_facet(row: &Row) -> SqlResult<DeckHubFacet> {
    Ok(DeckHubFacet {
        key: row.get(0)?,
        label: row.get(1)?,
        count: row.get(2)?,
    })
}

fn like_pattern(value: &str) -> String {
    format!(
        "%{}%",
        value
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}

fn push_string_args(args: &mut Vec<Box<dyn rusqlite::types::ToSql>>, values: &[String]) -> String {
    let start = args.len() + 1;
    args.extend(
        values
            .iter()
            .cloned()
            .map(|value| Box::new(value) as Box<dyn rusqlite::types::ToSql>),
    );
    (start..start + values.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn map_deckhub_tag(row: &Row) -> SqlResult<DeckHubTag> {
    Ok(DeckHubTag {
        id: row.get(0)?,
        name: row.get(1)?,
        slug: row.get(2)?,
    })
}

fn replace_entry_tags(tx: &Transaction<'_>, entry_id: &str, tags: &[String]) -> SqlResult<()> {
    tx.execute(
        "DELETE FROM deckhub_entry_tags WHERE deckhub_entry_id = ?1",
        params![entry_id],
    )?;
    let mut seen = std::collections::BTreeSet::new();
    for name in tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
    {
        let slug = slug_base(name);
        if slug.is_empty() || !seen.insert(slug.clone()) {
            continue;
        }
        tx.execute(
            "INSERT OR IGNORE INTO deckhub_tags (id, name, slug) VALUES (?1, ?2, ?3)",
            params![uuid::Uuid::new_v4().to_string(), name, slug],
        )?;
        let tag_id: String = tx.query_row(
            "SELECT id FROM deckhub_tags WHERE slug = ?1 COLLATE NOCASE",
            params![slug],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO deckhub_entry_tags (deckhub_entry_id, tag_id) VALUES (?1, ?2)",
            params![entry_id, tag_id],
        )?;
    }
    Ok(())
}

fn update_deck_visibility(tx: &Transaction<'_>, entry_id: &str) -> SqlResult<()> {
    tx.execute(
        "UPDATE decks
         SET visibility = CASE
                WHEN EXISTS (
                    SELECT 1 FROM deckhub_entries e
                    WHERE e.deck_id = decks.id AND e.status = 'published'
                ) THEN 'public'
                ELSE 'private'
             END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = (SELECT deck_id FROM deckhub_entries WHERE id = ?1)",
        params![entry_id],
    )?;
    Ok(())
}

fn unique_slug(tx: &Transaction<'_>, title: &str, id: &str) -> SqlResult<String> {
    let base = slug_base(title);
    let base = if base.is_empty() { "deck" } else { &base };
    let suffix: String = id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let candidate = format!("{base}-{suffix}");
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM deckhub_entries WHERE slug = ?1 COLLATE NOCASE)",
        params![candidate],
        |row| row.get(0),
    )?;
    if exists {
        Ok(format!("{base}-{}", id.replace('-', "")))
    } else {
        Ok(candidate)
    }
}

fn slug_base(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug.trim_matches('-').to_string()
}

fn legacy_summary(id: &str, author: &str, deck: &Deck, created_at: &str) -> HubDeckSummary {
    let cover_card_name = deck.cover_card_name.clone().or_else(|| {
        display_cards(deck)
            .next()
            .map(|card| card.identity.name.clone())
    });
    HubDeckSummary {
        id: id.to_string(),
        name: deck.name.clone(),
        author: author.to_string(),
        description: deck.description.clone(),
        format: deck.format,
        commanders: deck
            .commanders
            .iter()
            .flatten()
            .map(|card| card.identity.name.clone())
            .collect(),
        colors: deck_colors(deck),
        card_count: display_cards(deck).count() as u32,
        cover_card_name: cover_card_name.clone(),
        cover_image_url: cover_image(deck, cover_card_name.as_deref()),
        created_at: created_at.to_string(),
    }
}

fn display_cards(deck: &Deck) -> impl Iterator<Item = &DeckCard> {
    deck.cards
        .iter()
        .chain(deck.sideboard.iter())
        .chain(deck.commanders.iter().flatten())
        .chain(deck.companion.iter())
        .chain(deck.attractions.iter().flatten())
        .chain(deck.contraptions.iter().flatten())
        .chain(deck.schemes.iter().flatten())
        .chain(deck.planes.iter().flatten())
        .chain(deck.maybeboard.iter().flatten())
}

fn deck_colors(deck: &Deck) -> String {
    const ORDER: &str = "WUBRG";
    let colors = ORDER
        .chars()
        .filter(|color| {
            display_cards(deck).any(|card| {
                card.rules
                    .color_identity
                    .iter()
                    .any(|identity| identity == &color.to_string())
            })
        })
        .collect::<String>();
    if colors.is_empty() {
        "C".to_string()
    } else {
        colors
    }
}

fn commander_names_json(deck: &Deck) -> String {
    serde_json::to_string(
        &deck
            .commanders
            .iter()
            .flatten()
            .map(|card| card.identity.name.as_str())
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string())
}

fn cover_image(deck: &Deck, cover_card_name: Option<&str>) -> Option<String> {
    let card = cover_card_name
        .and_then(|name| display_cards(deck).find(|card| card.identity.name == name))
        .or_else(|| display_cards(deck).next())?;
    [
        &card.uris.art_crop,
        &card.uris.normal,
        &card.uris.large,
        &card.uris.small,
    ]
    .into_iter()
    .find(|uri| !uri.is_empty())
    .cloned()
}

fn map_account(row: &Row) -> SqlResult<AccountRow> {
    Ok(AccountRow {
        id: row.get(0)?,
        handle: row.get(1)?,
        handle_set: row.get::<_, i64>(2)? != 0,
        created_at: row.get(3)?,
    })
}

fn map_account_deck_summary(row: &Row) -> SqlResult<AccountDeckSummary> {
    let format: Option<String> = row.get(2)?;
    Ok(AccountDeckSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        format: format.as_deref().and_then(format_from_str),
        description: row.get(3)?,
        visibility: row.get(4)?,
        current_version_id: row.get(5)?,
        current_version_no: row.get(6)?,
        publication_count: row.get(7)?,
        derived_from_preset_key: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn map_identity(row: &Row) -> SqlResult<IdentityRow> {
    Ok(IdentityRow {
        account_id: row.get(0)?,
        provider: row.get(1)?,
        email: row.get(2)?,
    })
}

pub fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

fn map_summary(row: &Row) -> SqlResult<HubDeckSummary> {
    let format: Option<String> = row.get(4)?;
    let commanders: String = row.get(5)?;
    Ok(HubDeckSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        author: row.get(2)?,
        description: row.get(3)?,
        format: format.as_deref().and_then(format_from_str),
        commanders: serde_json::from_str(&commanders).unwrap_or_default(),
        colors: row.get(6)?,
        card_count: row.get(7)?,
        cover_card_name: row.get(8)?,
        cover_image_url: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn format_to_str(format: Option<DeckFormat>) -> Option<String> {
    format.and_then(|f| {
        serde_json::to_value(f).ok().and_then(|v| match v {
            serde_json::Value::String(s) => Some(s),
            _ => None,
        })
    })
}

fn format_from_str(s: &str) -> Option<DeckFormat> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage_with_account() -> Storage {
        let storage = Storage::open_memory().unwrap();
        storage
            .create_account(&AccountRow {
                id: "acct-1".into(),
                handle: "tester".into(),
                handle_set: true,
                created_at: "2026-07-01T00:00:00Z".into(),
            })
            .unwrap();
        storage
    }

    fn sample(id: &str, name: &str, ip: &str, created_at: &str) -> NewHubDeck {
        NewHubDeck {
            summary: HubDeckSummary {
                id: id.into(),
                name: name.into(),
                author: "tester".into(),
                description: None,
                format: Some(DeckFormat::Commander),
                commanders: vec!["Neheb, the Worthy".into()],
                colors: "BR".into(),
                card_count: 100,
                cover_card_name: None,
                cover_image_url: None,
                created_at: created_at.into(),
            },
            deck_json: r#"{"name":"x","cards":[],"sideboard":[]}"#.into(),
            management_token_hash: "hash".into(),
            publish_ip: ip.into(),
            account_id: "acct-1".into(),
        }
    }

    fn default_params() -> ListParams {
        ListParams {
            search: None,
            format: None,
            sort: SortOrder::Newest,
            page: 1,
            page_size: 20,
        }
    }

    #[test]
    fn insert_list_get_roundtrip() {
        let storage = storage_with_account();
        storage
            .insert_deck(&sample(
                "a",
                "Neheb Burn",
                "1.1.1.1",
                "2026-07-01T00:00:00Z",
            ))
            .unwrap();
        storage
            .insert_deck(&sample(
                "b",
                "Atraxa Toolbox",
                "1.1.1.1",
                "2026-07-02T00:00:00Z",
            ))
            .unwrap();
        let (decks, total) = storage.list_decks(&default_params()).unwrap();
        assert_eq!(total, 2);
        assert_eq!(decks[0].id, "b");
        assert_eq!(decks[0].format, Some(DeckFormat::Commander));
        assert_eq!(decks[0].commanders, vec!["Neheb, the Worthy".to_string()]);
        let detail = storage.get_deck("a").unwrap().unwrap();
        assert_eq!(detail.summary.name, "Neheb Burn");
        assert_eq!(detail.deck.name, "x");
    }

    #[test]
    fn search_filters_by_name_author_commander() {
        let storage = storage_with_account();
        storage
            .insert_deck(&sample(
                "a",
                "Neheb Burn",
                "1.1.1.1",
                "2026-07-01T00:00:00Z",
            ))
            .unwrap();
        storage
            .insert_deck(&sample(
                "b",
                "Atraxa Toolbox",
                "1.1.1.1",
                "2026-07-02T00:00:00Z",
            ))
            .unwrap();
        let mut params = default_params();
        params.search = Some("atraxa".into());
        let (decks, total) = storage.list_decks(&params).unwrap();
        assert_eq!(total, 1);
        assert_eq!(decks[0].id, "b");
        params.search = Some("neheb, the".into());
        let (_, total) = storage.list_decks(&params).unwrap();
        assert_eq!(total, 2);
    }

    #[test]
    fn delete_requires_matching_token() {
        let storage = storage_with_account();
        storage
            .insert_deck(&sample(
                "a",
                "Neheb Burn",
                "1.1.1.1",
                "2026-07-01T00:00:00Z",
            ))
            .unwrap();
        assert_eq!(
            storage.delete_deck("a", "wrong").unwrap(),
            DeleteOutcome::Forbidden
        );
        assert_eq!(
            storage.delete_deck("missing", "hash").unwrap(),
            DeleteOutcome::NotFound
        );
        assert_eq!(
            storage.delete_deck("a", "hash").unwrap(),
            DeleteOutcome::Deleted
        );
        assert!(storage.get_deck("a").unwrap().is_none());
    }

    #[test]
    fn unlisted_decks_hidden_from_list_and_get() {
        let storage = storage_with_account();
        storage
            .insert_deck(&sample(
                "a",
                "Neheb Burn",
                "1.1.1.1",
                "2026-07-01T00:00:00Z",
            ))
            .unwrap();
        assert!(storage.admin_unlist("a").unwrap());
        let (decks, total) = storage.list_decks(&default_params()).unwrap();
        assert_eq!(total, 0);
        assert!(decks.is_empty());
        assert!(storage.get_deck("a").unwrap().is_none());
    }

    #[test]
    fn publishes_since_counts_per_ip() {
        let storage = storage_with_account();
        storage
            .insert_deck(&sample("a", "One", "1.1.1.1", "2026-07-01T00:00:00Z"))
            .unwrap();
        storage
            .insert_deck(&sample("b", "Two", "1.1.1.1", "2026-07-02T00:00:00Z"))
            .unwrap();
        storage
            .insert_deck(&sample("c", "Three", "2.2.2.2", "2026-07-02T00:00:00Z"))
            .unwrap();
        assert_eq!(
            storage
                .publishes_since("1.1.1.1", "2026-07-01T12:00:00Z")
                .unwrap(),
            1
        );
        assert_eq!(
            storage
                .publishes_since("1.1.1.1", "2026-01-01T00:00:00Z")
                .unwrap(),
            2
        );
    }

    #[test]
    fn legacy_publication_migrates_to_normalized_domain() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        conn.execute_batch(MIGRATIONS[0].2).unwrap();
        conn.execute(
            "INSERT INTO accounts (id, handle, handle_set, created_at)
             VALUES ('acct-1', 'tester', 1, '2026-07-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO hub_decks
                (id, name, author, format, card_count, deck_json, management_token_hash,
                 publish_ip, created_at, account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                "legacy-entry",
                "Legacy Deck",
                "tester",
                "commander",
                1,
                serde_json::json!({
                    "name": "Legacy Deck",
                    "format": "commander",
                    "cards": [{
                        "identity": {
                            "id": "instance-1",
                            "name": "Lightning Bolt",
                            "setCode": "lea",
                            "cardNumber": "161"
                        }
                    }],
                    "sideboard": []
                })
                .to_string(),
                "hash",
                "127.0.0.1",
                "2026-07-01T00:00:00Z",
                "acct-1",
            ],
        )
        .unwrap();
        let storage = Storage { conn };
        storage.migrate().unwrap();

        let version: u32 = storage
            .conn
            .query_row("SELECT version FROM schema_version", [], |row| row.get(0))
            .unwrap();
        let cards: u32 = storage
            .conn
            .query_row("SELECT count(*) FROM deck_cards", [], |row| row.get(0))
            .unwrap();
        let mismatch: u32 = storage
            .conn
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        let kind: String = storage
            .conn
            .query_row(
                "SELECT kind FROM decks WHERE id = 'legacy-deck-legacy-entry'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 4);
        assert_eq!(cards, 1);
        assert_eq!(mismatch, 0);
        assert_eq!(kind, "user");
        let detail = storage
            .get_deckhub_entry("legacy-entry", Some("acct-1"))
            .unwrap()
            .unwrap();
        assert_eq!(detail.entry.title, "Legacy Deck");
        assert_eq!(detail.entry.card_count, 1);
        assert_eq!(detail.entry.colors, "C");
        assert_eq!(detail.deck.cards[0].identity.name, "Lightning Bolt");
    }
}
