use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use manabrew_hub::dto::TopDeckStat;
use rusqlite::{Connection, OpenFlags};

const CACHE_TTL: Duration = Duration::from_secs(60);
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub struct StatsCache {
    events_db_path: Option<String>,
    cache: Mutex<HashMap<String, (Instant, Vec<RankedDeck>)>>,
}

#[derive(Clone)]
pub struct RankedDeck {
    pub stat: TopDeckStat,
    pub deck_fingerprint: Option<String>,
}

impl StatsCache {
    pub fn new(events_db_path: Option<String>) -> Self {
        StatsCache {
            events_db_path,
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn top_decks(&self, window: &str, limit: u32) -> Vec<RankedDeck> {
        let key = format!("{window}:{limit}");
        if let Some((at, stats)) = self.cache.lock().unwrap().get(&key) {
            if at.elapsed() < CACHE_TTL {
                return stats.clone();
            }
        }
        let stats = self.query(window, limit).unwrap_or_else(|error| {
            tracing::warn!(%error, "top-decks query failed");
            Vec::new()
        });
        self.cache
            .lock()
            .unwrap()
            .insert(key, (Instant::now(), stats.clone()));
        stats
    }

    fn query(&self, window: &str, limit: u32) -> rusqlite::Result<Vec<RankedDeck>> {
        let Some(path) = self.events_db_path.as_deref() else {
            return Ok(Vec::new());
        };
        if !std::path::Path::new(path).exists() {
            return Ok(Vec::new());
        }
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        let cutoff = window_cutoff(window);
        let has_linkage =
            has_column(&conn, "published_deck_id")? && has_column(&conn, "deck_fingerprint")?;
        let linkage = if has_linkage {
            "CASE
                 WHEN count(DISTINCT gp.published_deck_id) = 1
                  AND count(DISTINCT CASE
                      WHEN gp.published_deck_id IS NOT NULL THEN gp.deck_fingerprint
                  END) = 1
                 THEN max(gp.published_deck_id)
             END,
             CASE
                 WHEN count(DISTINCT gp.published_deck_id) = 1
                  AND count(DISTINCT CASE
                      WHEN gp.published_deck_id IS NOT NULL THEN gp.deck_fingerprint
                  END) = 1
                 THEN max(CASE
                     WHEN gp.published_deck_id IS NOT NULL THEN gp.deck_fingerprint
                 END)
             END"
        } else {
            "NULL, NULL"
        };
        let sql = format!(
            "SELECT gp.deck_name, gp.commander, {linkage},
                    count(*) AS plays, max(g.started_at) AS last_played
             FROM game_players gp JOIN games g ON g.game_id = gp.game_id
             WHERE gp.deck_name IS NOT NULL AND gp.is_bot = 0
               AND g.official = 1
               AND (?1 IS NULL OR g.started_at >= ?1)
             GROUP BY gp.deck_name, gp.commander
             ORDER BY plays DESC
             LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let stats = stmt
            .query_map(rusqlite::params![cutoff, limit], |row| {
                Ok(RankedDeck {
                    stat: TopDeckStat {
                        deck_name: row.get(0)?,
                        commander: row.get(1)?,
                        published_deck_id: row.get(2)?,
                        plays: row.get(4)?,
                        last_played: row.get(5)?,
                    },
                    deck_fingerprint: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(stats)
    }
}

fn has_column(conn: &Connection, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(game_players)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in columns {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn window_cutoff(window: &str) -> Option<String> {
    let days = match window {
        "7d" => 7,
        "30d" => 30,
        _ => return None,
    };
    Some(
        (Utc::now() - chrono::Duration::days(days))
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_events_db_yields_empty() {
        let stats = StatsCache::new(Some("/nonexistent/events.db".into()));
        assert!(stats.top_decks("all", 10).is_empty());
        let stats = StatsCache::new(None);
        assert!(stats.top_decks("7d", 10).is_empty());
    }

    #[test]
    fn window_cutoff_only_for_known_windows() {
        assert!(window_cutoff("7d").is_some());
        assert!(window_cutoff("30d").is_some());
        assert!(window_cutoff("all").is_none());
        assert!(window_cutoff("junk").is_none());
    }
}
