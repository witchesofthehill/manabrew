use manabrew_hub::dto::{HubDeckDetail, HubDeckSummary};
use manabrew_protocol::deck_dto::{deck_fingerprint, Deck, DeckFormat};
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult, Row};

pub struct ListParams {
    pub search: Option<String>,
    pub format: Option<String>,
    pub sort: SortOrder,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Clone, Copy)]
pub enum SortOrder {
    Newest,
    Name,
}

pub struct NewHubDeck {
    pub summary: HubDeckSummary,
    pub deck_json: String,
    pub management_token_hash: String,
    pub publish_ip: String,
    pub account_id: String,
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
        for (name, sql) in MIGRATIONS {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.commit()?;
            let version: i64 =
                self.conn
                    .query_row("SELECT version FROM schema_version", [], |row| row.get(0))?;
            tracing::info!(migration = name, version, "migration ran");
        }
        Ok(())
    }

    pub fn insert_deck(&self, deck: &NewHubDeck) -> SqlResult<()> {
        let s = &deck.summary;
        self.conn.execute(
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
        let offset = params.page.saturating_sub(1) * params.page_size;
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
                self.conn
                    .execute("DELETE FROM hub_decks WHERE id = ?1", params![id])?;
                Ok(DeleteOutcome::Deleted)
            }
        }
    }

    pub fn admin_delete(&self, id: &str) -> SqlResult<bool> {
        let changed = self
            .conn
            .execute("DELETE FROM hub_decks WHERE id = ?1", params![id])?;
        Ok(changed > 0)
    }

    pub fn admin_unlist(&self, id: &str) -> SqlResult<bool> {
        let changed = self.conn.execute(
            "UPDATE hub_decks SET unlisted = 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(changed > 0)
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
                self.conn
                    .execute("DELETE FROM hub_decks WHERE id = ?1", params![id])?;
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

    pub fn create_account(&self, account: &AccountRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO accounts (id, handle, handle_set, created_at) VALUES (?1, ?2, ?3, ?4)",
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
            "UPDATE accounts SET handle = ?2, handle_set = 1 WHERE id = ?1",
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
        let changed = self.conn.execute(
            "DELETE FROM identities WHERE account_id = ?1 AND provider = ?2",
            params![account_id, provider],
        )?;
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

fn map_account(row: &Row) -> SqlResult<AccountRow> {
    Ok(AccountRow {
        id: row.get(0)?,
        handle: row.get(1)?,
        handle_set: row.get::<_, i64>(2)? != 0,
        created_at: row.get(3)?,
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
        let storage = Storage::open_memory().unwrap();
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
        let storage = Storage::open_memory().unwrap();
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
        let storage = Storage::open_memory().unwrap();
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
        let storage = Storage::open_memory().unwrap();
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
        let storage = Storage::open_memory().unwrap();
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
}
