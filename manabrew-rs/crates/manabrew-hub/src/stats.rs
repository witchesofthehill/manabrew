use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use rusqlite::{Connection, OpenFlags};

const CACHE_TTL: Duration = Duration::from_secs(60);
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub struct StatsCache {
    events_db_path: Option<String>,
    publication_cache: Mutex<HashMap<String, (Instant, Vec<RankedPublication>)>>,
}

#[derive(Clone)]
pub struct RankedPublication {
    pub published_deck_id: String,
    pub deck_fingerprint: String,
    pub plays: u32,
    pub completed_games: u32,
    pub wins: u32,
}

impl StatsCache {
    pub fn new(events_db_path: Option<String>) -> Self {
        StatsCache {
            events_db_path,
            publication_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn top_publications(
        &self,
        window: &str,
        format: Option<&str>,
        limit: u32,
    ) -> Option<Vec<RankedPublication>> {
        let key = format!("{window}:{}:{limit}", format.unwrap_or("all"));
        if let Some((at, rankings)) = self.publication_cache.lock().unwrap().get(&key) {
            if at.elapsed() < CACHE_TTL {
                return Some(rankings.clone());
            }
        }
        let rankings = match self.query_publications(window, format, limit) {
            Ok(rankings) => rankings?,
            Err(error) => {
                tracing::warn!(%error, "published top-decks query failed");
                return None;
            }
        };
        self.publication_cache
            .lock()
            .unwrap()
            .insert(key, (Instant::now(), rankings.clone()));
        Some(rankings)
    }

    fn query_publications(
        &self,
        window: &str,
        format: Option<&str>,
        limit: u32,
    ) -> rusqlite::Result<Option<Vec<RankedPublication>>> {
        let Some(path) = self.events_db_path.as_deref() else {
            return Ok(None);
        };
        if !std::path::Path::new(path).exists() {
            return Ok(None);
        }
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        if !has_column(&conn, "published_deck_id")? || !has_column(&conn, "deck_fingerprint")? {
            return Ok(None);
        }
        let cutoff = window_cutoff(window);
        let mut stmt = conn.prepare(
            "SELECT gp.published_deck_id, gp.deck_fingerprint,
                    count(*) AS plays,
                    sum(CASE WHEN g.game_over = 1 THEN 1 ELSE 0 END) AS completed_games,
                    sum(CASE WHEN g.game_over = 1 AND g.winner = gp.username
                             THEN 1 ELSE 0 END) AS wins
             FROM game_players gp
             JOIN games g ON g.game_id = gp.game_id
             WHERE gp.is_bot = 0 AND g.hosted = 0
               AND gp.published_deck_id IS NOT NULL
               AND gp.deck_fingerprint IS NOT NULL
               AND (?1 IS NULL OR g.started_at >= ?1)
               AND (?2 IS NULL OR lower(g.format) = lower(?2))
             GROUP BY gp.published_deck_id, gp.deck_fingerprint
             ORDER BY plays DESC, completed_games DESC, gp.published_deck_id ASC
             LIMIT ?3",
        )?;
        let rankings = stmt
            .query_map(rusqlite::params![cutoff, format, limit], |row| {
                Ok(RankedPublication {
                    published_deck_id: row.get(0)?,
                    deck_fingerprint: row.get(1)?,
                    plays: row.get(2)?,
                    completed_games: row.get(3)?,
                    wins: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Some(rankings))
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
    fn missing_events_db_yields_unavailable() {
        let stats = StatsCache::new(Some("/nonexistent/events.db".into()));
        assert!(stats.top_publications("all", None, 10).is_none());
        let stats = StatsCache::new(None);
        assert!(stats.top_publications("7d", None, 10).is_none());
    }

    #[test]
    fn window_cutoff_only_for_known_windows() {
        assert!(window_cutoff("7d").is_some());
        assert!(window_cutoff("30d").is_some());
        assert!(window_cutoff("all").is_none());
        assert!(window_cutoff("junk").is_none());
    }
}
