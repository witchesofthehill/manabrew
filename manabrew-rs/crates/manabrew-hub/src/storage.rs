use manabrew_hub::dto::{HubDeckDetail, HubDeckSummary};
use manabrew_protocol::deck_dto::{Deck, DeckFormat};
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
}

#[derive(Debug, PartialEq, Eq)]
pub enum DeleteOutcome {
    Deleted,
    Forbidden,
    NotFound,
}

pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn open(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
        let storage = Self { conn };
        storage.init_schema()?;
        Ok(storage)
    }

    #[cfg(test)]
    pub fn open_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        let storage = Self { conn };
        storage.init_schema()?;
        Ok(storage)
    }

    fn init_schema(&self) -> SqlResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS hub_decks (
                id                    TEXT PRIMARY KEY,
                name                  TEXT NOT NULL,
                author                TEXT NOT NULL,
                description           TEXT,
                format                TEXT,
                commanders            TEXT NOT NULL DEFAULT '[]',
                colors                TEXT NOT NULL DEFAULT '',
                card_count            INTEGER NOT NULL,
                cover_card_name       TEXT,
                cover_image_url       TEXT,
                deck_json             TEXT NOT NULL,
                management_token_hash TEXT NOT NULL,
                publish_ip            TEXT NOT NULL,
                created_at            TEXT NOT NULL,
                unlisted              INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_hub_decks_browse ON hub_decks(unlisted, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_hub_decks_format ON hub_decks(format);
            CREATE INDEX IF NOT EXISTS idx_hub_decks_ip_day ON hub_decks(publish_ip, created_at);
            ",
        )
    }

    pub fn insert_deck(&self, deck: &NewHubDeck) -> SqlResult<()> {
        let s = &deck.summary;
        self.conn.execute(
            "INSERT INTO hub_decks (id, name, author, description, format, commanders, colors,
                card_count, cover_card_name, cover_image_url, deck_json, management_token_hash,
                publish_ip, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
