//! SQLite persistence for continuous parity runs.
//!
//! Stores each game result with deck pair, seed, status, divergence details,
//! duration, and covered cards. Provides queries for stats, trends, and heatmaps.

use rusqlite::{params, Connection, Result as SqlResult};

use crate::protocol::{
    ContinuousStats, DeckPairStats, MatchupResult, MatchupStatus, RunRecord, TrendPoint,
};

/// A tracked failure cluster from the analysis daemon.
#[derive(Debug, Clone, serde::Serialize)]
pub struct KnownCluster {
    pub id: i64,
    pub cluster_key: String,
    pub failure_count: i64,
    pub first_seen: String,
    pub last_seen: String,
    pub github_issue: Option<i64>,
    pub last_discord_ts: Option<String>,
    pub llm_analysis: Option<String>,
}

/// Clusters aggregated by divergence field (for the UI).
#[derive(Debug, Clone, serde::Serialize)]
pub struct FieldCluster {
    pub field: String,
    pub total_failures: i64,
    pub num_deck_pairs: i64,
    pub first_seen: String,
    pub last_seen: String,
    pub github_issue: Option<i64>,
    pub llm_analysis: Option<String>,
    pub deck_pairs: Option<String>,
}

/// Normalize a divergence field by replacing array indices with `[*]`.
fn normalize_field_for_storage(field: &str) -> String {
    let mut result = String::with_capacity(field.len());
    let mut in_bracket = false;
    for c in field.chars() {
        if c == '[' {
            result.push('[');
            in_bracket = true;
        } else if c == ']' {
            if in_bracket {
                result.push('*');
            }
            result.push(']');
            in_bracket = false;
        } else if !in_bracket {
            result.push(c);
        }
        // skip digits inside brackets
    }
    result
}

/// Build a SQL filter clause that excludes rows where deck1 or deck2 match any prefix.
fn build_exclude_filter(prefixes: &[String]) -> String {
    if prefixes.is_empty() {
        return String::new();
    }
    let conditions: Vec<String> = prefixes
        .iter()
        .flat_map(|p| {
            let escaped = p.replace('\'', "''");
            vec![
                format!("deck1 NOT LIKE '{}%'", escaped),
                format!("deck2 NOT LIKE '{}%'", escaped),
            ]
        })
        .collect();
    format!(" AND {}", conditions.join(" AND "))
}

/// SQLite-backed storage for parity run records.
pub struct Storage {
    conn: Connection,
}

impl Storage {
    /// Open (or create) a SQLite database at the given path.
    pub fn open(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        let storage = Self { conn };
        storage.init_schema()?;
        Ok(storage)
    }

    /// Open an in-memory database (for tests).
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
            CREATE TABLE IF NOT EXISTS runs (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id              INTEGER NOT NULL,
                deck1                 TEXT NOT NULL,
                deck2                 TEXT NOT NULL,
                seed                  INTEGER NOT NULL,
                status                TEXT NOT NULL,
                snapshots_compared    INTEGER NOT NULL,
                divergence_count      INTEGER NOT NULL,
                first_divergence_field TEXT,
                first_divergence_rust  TEXT,
                first_divergence_java  TEXT,
                covered_cards         TEXT NOT NULL DEFAULT '[]',
                duration_ms           INTEGER NOT NULL,
                error_message         TEXT,
                rust_trace            TEXT,
                java_trace            TEXT,
                is_fuzz               INTEGER NOT NULL DEFAULT 0,
                timestamp             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp);
            CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
            CREATE INDEX IF NOT EXISTS idx_runs_batch ON runs(batch_id);
            CREATE INDEX IF NOT EXISTS idx_runs_deck_pair ON runs(deck1, deck2);

            CREATE TABLE IF NOT EXISTS analysis_state (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS known_clusters (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_key     TEXT NOT NULL UNIQUE,
                failure_count   INTEGER NOT NULL DEFAULT 0,
                first_seen      TEXT NOT NULL,
                last_seen       TEXT NOT NULL,
                github_issue    INTEGER,
                last_discord_ts TEXT,
                llm_analysis    TEXT
            );
            ",
        )?;
        // Migrate: add columns if they don't exist (for existing DBs)
        let _ = self.conn.execute_batch(
            "ALTER TABLE runs ADD COLUMN rust_trace TEXT;
             ALTER TABLE runs ADD COLUMN java_trace TEXT;",
        );
        let _ = self
            .conn
            .execute_batch("ALTER TABLE runs ADD COLUMN is_fuzz INTEGER NOT NULL DEFAULT 0;");
        let _ = self
            .conn
            .execute_batch("ALTER TABLE runs ADD COLUMN commit_sha TEXT;");
        Ok(())
    }

    /// Return the (deck1, deck2) of the most recently inserted non-fuzz game.
    pub fn last_preset_pair(&self) -> SqlResult<Option<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT deck1, deck2 FROM runs WHERE is_fuzz = 0 ORDER BY id DESC LIMIT 1")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(Some((row.get(0)?, row.get(1)?)))
        } else {
            Ok(None)
        }
    }

    /// Insert a run result into the database.
    pub fn insert_run(
        &self,
        batch_id: i64,
        result: &MatchupResult,
        duration_ms: u64,
        is_fuzz: bool,
        commit_sha: Option<&str>,
    ) -> SqlResult<i64> {
        let status_str = match result.status {
            MatchupStatus::Pass => "pass",
            MatchupStatus::Skipped => "skipped",
            MatchupStatus::Fail => "fail",
            MatchupStatus::Error => "error",
        };

        let (div_field, div_rust, div_java) = match &result.first_divergence {
            Some(d) => (
                Some(d.field.clone()),
                Some(d.rust_value.clone()),
                Some(d.java_value.clone()),
            ),
            None => (None, None, None),
        };

        let covered_json = serde_json::to_string(&result.covered_cards).unwrap_or_default();

        self.conn.execute(
            "INSERT INTO runs (batch_id, deck1, deck2, seed, status, snapshots_compared,
             divergence_count, first_divergence_field, first_divergence_rust,
             first_divergence_java, covered_cards, duration_ms, error_message,
             rust_trace, java_trace, is_fuzz, commit_sha)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                batch_id,
                result.deck1,
                result.deck2,
                result.seed as i64,
                status_str,
                result.snapshots_compared as i64,
                result.divergence_count as i64,
                div_field,
                div_rust,
                div_java,
                covered_json,
                duration_ms as i64,
                result.error_message,
                result
                    .rust_snapshot
                    .as_ref()
                    .and_then(|s| serde_json::to_string(s).ok()),
                result
                    .java_snapshot
                    .as_ref()
                    .and_then(|s| serde_json::to_string(s).ok()),
                is_fuzz as i64,
                commit_sha,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Get aggregate stats across all runs.
    ///
    /// `start_time_iso` filters `games_per_minute` to only count games from
    /// the current session, while totals/pass_rate reflect all historical data.
    pub fn stats(
        &self,
        uptime_seconds: u64,
        start_time_iso: &str,
        since: Option<&str>,
        exclude_prefixes: &[String],
    ) -> SqlResult<ContinuousStats> {
        // Preset-only stats (is_fuzz = 0), optionally filtered by time range
        let time_filter = since
            .map(|s| format!(" AND timestamp >= '{}'", s.replace('\'', "''")))
            .unwrap_or_default();

        // Exclude blacklisted deck prefixes from stats
        let exclude_filter = build_exclude_filter(exclude_prefixes);

        let total: usize = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM runs WHERE is_fuzz = 0{time_filter}{exclude_filter}"),
            [],
            |r| r.get(0),
        )?;
        let passed: usize = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM runs WHERE status = 'pass' AND is_fuzz = 0{time_filter}{exclude_filter}"),
            [],
            |r| r.get(0),
        )?;
        let failed: usize = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM runs WHERE status = 'fail' AND is_fuzz = 0{time_filter}{exclude_filter}"),
            [],
            |r| r.get(0),
        )?;
        let errors: usize = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM runs WHERE status = 'error' AND is_fuzz = 0{time_filter}{exclude_filter}"),
            [],
            |r| r.get(0),
        )?;

        let pass_rate = if passed + failed > 0 {
            passed as f64 / (passed + failed) as f64
        } else {
            0.0
        };

        // Only count preset games from the current session for games/minute
        let session_games: usize = self.conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM runs WHERE timestamp >= ?1 AND is_fuzz = 0{exclude_filter}"
            ),
            params![start_time_iso],
            |r| r.get(0),
        )?;

        let games_per_minute = if uptime_seconds > 0 {
            session_games as f64 / (uptime_seconds as f64 / 60.0)
        } else {
            0.0
        };

        let current_batch: i64 =
            self.conn
                .query_row("SELECT COALESCE(MAX(batch_id), 0) FROM runs", [], |r| {
                    r.get(0)
                })?;

        // Fuzz-only stats
        let fuzz_total: usize = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM runs WHERE is_fuzz = 1{time_filter}"),
            [],
            |r| r.get(0),
        )?;
        let fuzz_passed: usize = self.conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM runs WHERE status = 'pass' AND is_fuzz = 1{time_filter}"
            ),
            [],
            |r| r.get(0),
        )?;
        let fuzz_failed: usize = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM runs WHERE status IN ('fail', 'error') AND is_fuzz = 1{time_filter}"),
            [],
            |r| r.get(0),
        )?;
        let fuzz_pass_rate = if fuzz_passed + fuzz_failed > 0 {
            fuzz_passed as f64 / (fuzz_passed + fuzz_failed) as f64
        } else {
            0.0
        };

        Ok(ContinuousStats {
            total_games: total,
            passed,
            failed,
            errors,
            pass_rate,
            games_per_minute,
            uptime_seconds,
            current_batch,
            fuzz_total,
            fuzz_passed,
            fuzz_failed,
            fuzz_pass_rate,
            commit_sha: None, // filled by web handler
        })
    }

    /// Get time-series trend data bucketed by hour or day.
    ///
    /// `since` is an optional ISO-8601 timestamp; only rows with `timestamp >= since` are included.
    pub fn trend(
        &self,
        bucket: &str,
        limit: usize,
        since: Option<&str>,
        exclude_prefixes: &[String],
    ) -> SqlResult<Vec<TrendPoint>> {
        let format_str = match bucket {
            "day" => "%Y-%m-%d",
            _ => "%Y-%m-%dT%H:00:00Z", // hour
        };

        let since_clause = if since.is_some() {
            "AND timestamp >= ?2"
        } else {
            ""
        };
        let exclude_filter = build_exclude_filter(exclude_prefixes);

        let sql = format!(
            "SELECT
                strftime('{format_str}', timestamp) as bucket,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
             FROM runs
             WHERE is_fuzz = 0 {since_clause}{exclude_filter}
             GROUP BY bucket
             ORDER BY bucket DESC
             LIMIT ?1"
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let map_row = |row: &rusqlite::Row<'_>| {
            let total: usize = row.get(1)?;
            let passed: usize = row.get(2)?;
            let failed: usize = row.get(3)?;
            let errors: usize = row.get(4)?;
            let pass_rate = if passed + failed > 0 {
                passed as f64 / (passed + failed) as f64
            } else {
                0.0
            };
            Ok(TrendPoint {
                bucket: row.get(0)?,
                total,
                passed,
                failed,
                errors,
                pass_rate,
            })
        };
        if let Some(s) = since {
            stmt.query_map(params![limit as i64, s], map_row)?.collect()
        } else {
            stmt.query_map(params![limit as i64], map_row)?.collect()
        }
    }

    /// Get recent failures with divergence details.
    pub fn recent_failures(
        &self,
        limit: usize,
        since: Option<&str>,
        exclude_prefixes: &[String],
    ) -> SqlResult<Vec<RunRecord>> {
        let since_clause = since
            .map(|s| format!(" AND timestamp >= '{}'", s.replace('\'', "''")))
            .unwrap_or_default();
        let exclude_filter = build_exclude_filter(exclude_prefixes);
        let sql = format!(
            "SELECT id, batch_id, deck1, deck2, seed, status, snapshots_compared,
                    divergence_count, first_divergence_field, first_divergence_rust,
                    first_divergence_java, covered_cards, duration_ms, error_message,
                    rust_trace, java_trace, is_fuzz, timestamp, commit_sha
             FROM runs
             WHERE status IN ('fail', 'error'){since_clause}{exclude_filter}
             ORDER BY id DESC
             LIMIT ?1"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit as i64], |row| Self::row_to_record(row))?;
        rows.collect()
    }

    /// Get recent failures filtered by normalized divergence field.
    pub fn failures_by_field(
        &self,
        field: &str,
        limit: usize,
        since: Option<&str>,
        exclude_prefixes: &[String],
    ) -> SqlResult<Vec<RunRecord>> {
        let since_clause = since
            .map(|s| format!(" AND timestamp >= '{}'", s.replace('\'', "''")))
            .unwrap_or_default();
        let exclude_filter = build_exclude_filter(exclude_prefixes);
        let sql = format!(
            "SELECT id, batch_id, deck1, deck2, seed, status, snapshots_compared,
                    divergence_count, first_divergence_field, first_divergence_rust,
                    first_divergence_java, covered_cards, duration_ms, error_message,
                    rust_trace, java_trace, is_fuzz, timestamp, commit_sha
             FROM runs
             WHERE status = 'fail' AND first_divergence_field IS NOT NULL{since_clause}{exclude_filter}
             ORDER BY id DESC
             LIMIT 5000"
        );
        let mut stmt = self.conn.prepare(&sql)?;

        let normalized_target = normalize_field_for_storage(field);
        let rows = stmt.query_map([], |row| Self::row_to_record(row))?;
        let mut results = Vec::new();
        for row in rows {
            let record = row?;
            if let Some(ref f) = record.first_divergence_field {
                if normalize_field_for_storage(f) == normalized_target {
                    results.push(record);
                    if results.len() >= limit {
                        break;
                    }
                }
            }
        }
        Ok(results)
    }

    /// Get a specific run by ID.
    pub fn get_run(&self, id: i64) -> SqlResult<RunRecord> {
        self.conn.query_row(
            "SELECT id, batch_id, deck1, deck2, seed, status, snapshots_compared,
                    divergence_count, first_divergence_field, first_divergence_rust,
                    first_divergence_java, covered_cards, duration_ms, error_message,
                    rust_trace, java_trace, is_fuzz, timestamp, commit_sha
             FROM runs WHERE id = ?1",
            params![id],
            |row| Self::row_to_record(row),
        )
    }

    /// Get pass rate heatmap by deck pair.
    pub fn deck_pair_matrix(
        &self,
        since: Option<&str>,
        exclude_prefixes: &[String],
    ) -> SqlResult<Vec<DeckPairStats>> {
        let since_clause = if since.is_some() {
            "AND timestamp >= ?1"
        } else {
            ""
        };
        let exclude_filter = build_exclude_filter(exclude_prefixes);
        let sql = format!(
            "SELECT deck1, deck2, COUNT(*) as total,
                    SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) as passed,
                    SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
             FROM runs
             WHERE is_fuzz = 0 {since_clause}{exclude_filter}
             GROUP BY deck1, deck2
             ORDER BY deck1, deck2"
        );
        let mut stmt = self.conn.prepare(&sql)?;

        let map_row = |row: &rusqlite::Row<'_>| {
            let total: usize = row.get(2)?;
            let passed: usize = row.get(3)?;
            let failed: usize = row.get(4)?;
            let errors: usize = row.get(5)?;
            let pass_rate = if total > 0 {
                passed as f64 / total as f64
            } else {
                0.0
            };
            Ok(DeckPairStats {
                deck1: row.get(0)?,
                deck2: row.get(1)?,
                total,
                passed,
                failed,
                errors,
                pass_rate,
            })
        };
        if let Some(s) = since {
            stmt.query_map(params![s], map_row)?.collect()
        } else {
            stmt.query_map([], map_row)?.collect()
        }
    }

    /// Compute the current pass rate (excluding errors).
    pub fn pass_rate(&self) -> SqlResult<f64> {
        let passed: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status = 'pass' AND is_fuzz = 0",
            [],
            |r| r.get(0),
        )?;
        let failed: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status = 'fail' AND is_fuzz = 0",
            [],
            |r| r.get(0),
        )?;
        if passed + failed == 0 {
            return Ok(0.0);
        }
        Ok(passed as f64 / (passed + failed) as f64)
    }

    /// Get recent fuzz game results.
    pub fn recent_fuzz_games(&self, limit: usize) -> SqlResult<Vec<RunRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, batch_id, deck1, deck2, seed, status, snapshots_compared,
                    divergence_count, first_divergence_field, first_divergence_rust,
                    first_divergence_java, covered_cards, duration_ms, error_message,
                    rust_trace, java_trace, is_fuzz, timestamp, commit_sha
             FROM runs
             WHERE is_fuzz = 1
             ORDER BY id DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| Self::row_to_record(row))?;
        rows.collect()
    }

    // ── Analysis Daemon Queries ──────────────────────────────────────

    /// Get the last analyzed run ID (watermark).
    pub fn get_analysis_watermark(&self) -> SqlResult<i64> {
        let result: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM analysis_state WHERE key = 'last_analyzed_id'",
                [],
                |r| r.get(0),
            )
            .ok();
        Ok(result.and_then(|v| v.parse::<i64>().ok()).unwrap_or(0))
    }

    /// Update the watermark to the given run ID.
    pub fn set_analysis_watermark(&self, id: i64) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO analysis_state (key, value) VALUES ('last_analyzed_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![id.to_string()],
        )?;
        Ok(())
    }

    /// Fetch failures with id > watermark.
    pub fn failures_since(&self, after_id: i64) -> SqlResult<Vec<RunRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, batch_id, deck1, deck2, seed, status, snapshots_compared,
                    divergence_count, first_divergence_field, first_divergence_rust,
                    first_divergence_java, covered_cards, duration_ms, error_message,
                    rust_trace, java_trace, is_fuzz, timestamp, commit_sha
             FROM runs
             WHERE id > ?1 AND status IN ('fail', 'error')
             ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![after_id], |row| Self::row_to_record(row))?;
        rows.collect()
    }

    /// Upsert a known cluster; returns (is_new, updated_row).
    pub fn upsert_cluster(
        &self,
        cluster_key: &str,
        additional_failures: i64,
        now_iso: &str,
    ) -> SqlResult<(bool, KnownCluster)> {
        // Try to find existing
        let existing: Option<KnownCluster> = self
            .conn
            .query_row(
                "SELECT id, cluster_key, failure_count, first_seen, last_seen,
                        github_issue, last_discord_ts, llm_analysis
                 FROM known_clusters WHERE cluster_key = ?1",
                params![cluster_key],
                |row| {
                    Ok(KnownCluster {
                        id: row.get(0)?,
                        cluster_key: row.get(1)?,
                        failure_count: row.get(2)?,
                        first_seen: row.get(3)?,
                        last_seen: row.get(4)?,
                        github_issue: row.get(5)?,
                        last_discord_ts: row.get(6)?,
                        llm_analysis: row.get(7)?,
                    })
                },
            )
            .ok();

        if let Some(mut cluster) = existing {
            self.conn.execute(
                "UPDATE known_clusters SET failure_count = failure_count + ?1, last_seen = ?2
                 WHERE cluster_key = ?3",
                params![additional_failures, now_iso, cluster_key],
            )?;
            cluster.failure_count += additional_failures;
            cluster.last_seen = now_iso.to_string();
            Ok((false, cluster))
        } else {
            self.conn.execute(
                "INSERT INTO known_clusters (cluster_key, failure_count, first_seen, last_seen)
                 VALUES (?1, ?2, ?3, ?3)",
                params![cluster_key, additional_failures, now_iso],
            )?;
            let id = self.conn.last_insert_rowid();
            Ok((
                true,
                KnownCluster {
                    id,
                    cluster_key: cluster_key.to_string(),
                    failure_count: additional_failures,
                    first_seen: now_iso.to_string(),
                    last_seen: now_iso.to_string(),
                    github_issue: None,
                    last_discord_ts: None,
                    llm_analysis: None,
                },
            ))
        }
    }

    /// Update a cluster's LLM analysis cache.
    pub fn set_cluster_llm_analysis(&self, cluster_key: &str, analysis: &str) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE known_clusters SET llm_analysis = ?1 WHERE cluster_key = ?2",
            params![analysis, cluster_key],
        )?;
        Ok(())
    }

    /// Record that a GitHub issue was opened for this cluster.
    pub fn set_cluster_github_issue(&self, cluster_key: &str, issue_number: i64) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE known_clusters SET github_issue = ?1 WHERE cluster_key = ?2",
            params![issue_number, cluster_key],
        )?;
        Ok(())
    }

    /// Record the last Discord post timestamp for this cluster.
    pub fn set_cluster_discord_ts(&self, cluster_key: &str, ts: &str) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE known_clusters SET last_discord_ts = ?1 WHERE cluster_key = ?2",
            params![ts, cluster_key],
        )?;
        Ok(())
    }

    /// Get all known clusters, ordered by failure count descending.
    pub fn get_clusters(&self) -> SqlResult<Vec<KnownCluster>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, cluster_key, failure_count, first_seen, last_seen,
                    github_issue, last_discord_ts, llm_analysis
             FROM known_clusters
             ORDER BY failure_count DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(KnownCluster {
                id: row.get(0)?,
                cluster_key: row.get(1)?,
                failure_count: row.get(2)?,
                first_seen: row.get(3)?,
                last_seen: row.get(4)?,
                github_issue: row.get(5)?,
                last_discord_ts: row.get(6)?,
                llm_analysis: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    /// Get clusters aggregated by divergence field, with total failures and analysis.
    /// Returns one entry per unique field, picking the first non-null LLM analysis found.
    /// If `since` is provided, only clusters with `last_seen >= since` are included.
    pub fn get_clusters_by_field(&self, since: Option<&str>) -> SqlResult<Vec<FieldCluster>> {
        let since_clause = since
            .map(|s| format!("WHERE last_seen >= '{}'", s.replace('\'', "''")))
            .unwrap_or_default();
        let sql = format!(
            "SELECT
                substr(cluster_key, 1, instr(cluster_key, '|') - 1) as field,
                SUM(failure_count) as total_failures,
                COUNT(*) as num_deck_pairs,
                MIN(first_seen) as first_seen,
                MAX(last_seen) as last_seen,
                MAX(github_issue) as github_issue,
                (SELECT kc2.llm_analysis FROM known_clusters kc2
                 WHERE substr(kc2.cluster_key, 1, instr(kc2.cluster_key, '|') - 1)
                       = substr(known_clusters.cluster_key, 1, instr(known_clusters.cluster_key, '|') - 1)
                 AND kc2.llm_analysis IS NOT NULL LIMIT 1) as llm_analysis,
                GROUP_CONCAT(DISTINCT replace(substr(cluster_key, instr(cluster_key, '|') + 1), '+', ' vs ')) as deck_pairs
             FROM known_clusters
             {since_clause}
             GROUP BY field
             ORDER BY total_failures DESC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(FieldCluster {
                field: row.get(0)?,
                total_failures: row.get(1)?,
                num_deck_pairs: row.get(2)?,
                first_seen: row.get(3)?,
                last_seen: row.get(4)?,
                github_issue: row.get(5)?,
                llm_analysis: row.get(6)?,
                deck_pairs: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunRecord> {
        let status_str: String = row.get(5)?;
        let status = match status_str.as_str() {
            "pass" => MatchupStatus::Pass,
            "skipped" => MatchupStatus::Skipped,
            "fail" => MatchupStatus::Fail,
            _ => MatchupStatus::Error,
        };
        let covered_json: String = row.get(11)?;
        let covered_cards: Vec<String> = serde_json::from_str(&covered_json).unwrap_or_default();
        let seed_i64: i64 = row.get(4)?;

        Ok(RunRecord {
            id: row.get(0)?,
            batch_id: row.get(1)?,
            deck1: row.get(2)?,
            deck2: row.get(3)?,
            seed: seed_i64 as u64,
            status,
            snapshots_compared: row.get::<_, i64>(6)? as usize,
            divergence_count: row.get::<_, i64>(7)? as usize,
            first_divergence_field: row.get(8)?,
            first_divergence_rust: row.get(9)?,
            first_divergence_java: row.get(10)?,
            covered_cards,
            duration_ms: row.get::<_, i64>(12)? as u64,
            error_message: row.get(13)?,
            rust_trace: row.get(14)?,
            java_trace: row.get(15)?,
            is_fuzz: row.get::<_, i64>(16)? != 0,
            timestamp: row.get(17)?,
            commit_sha: row.get(18).ok().flatten(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{Divergence, MatchupResult, MatchupStatus};

    fn make_result(status: MatchupStatus) -> MatchupResult {
        let is_fail = matches!(status, MatchupStatus::Fail);
        let is_error = matches!(status, MatchupStatus::Error);
        let is_skipped = matches!(status, MatchupStatus::Skipped);
        MatchupResult {
            deck1: "red_burn".into(),
            deck2: "green_stompy".into(),
            seed: 42,
            status,
            snapshots_compared: 10,
            divergence_count: if is_fail { 1 } else { 0 },
            first_divergence: if is_fail {
                Some(Divergence {
                    snapshot_index: 3,
                    turn: 2,
                    phase: "Main1".into(),
                    field: "players[0].life".into(),
                    rust_value: "18".into(),
                    java_value: "20".into(),
                })
            } else {
                None
            },
            error_message: if is_error {
                Some("test error".into())
            } else {
                None
            },
            skip_reason: if is_skipped {
                Some("ignored".into())
            } else {
                None
            },
            rust_snapshot: None,
            java_snapshot: None,
            covered_cards: vec!["Lightning Bolt".into()],
            rust_log: vec![],
            java_log: vec![],
            finished_turn: None,
        }
    }

    #[test]
    fn insert_and_query_stats() {
        let db = Storage::open_memory().unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Pass), 100, false, None)
            .unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Pass), 150, false, None)
            .unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Fail), 200, false, None)
            .unwrap();

        let stats = db.stats(60, "2024-01-01T00:00:00Z", None, &[]).unwrap();
        assert_eq!(stats.total_games, 3);
        assert_eq!(stats.passed, 2);
        assert_eq!(stats.failed, 1);
        assert!((stats.pass_rate - 0.6667).abs() < 0.01);
    }

    #[test]
    fn recent_failures_query() {
        let db = Storage::open_memory().unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Pass), 100, false, None)
            .unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Fail), 200, false, None)
            .unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Error), 50, false, None)
            .unwrap();

        let failures = db.recent_failures(10, None, &[]).unwrap();
        assert_eq!(failures.len(), 2);
        assert_eq!(failures[0].status, MatchupStatus::Error);
        assert_eq!(failures[1].status, MatchupStatus::Fail);
    }

    #[test]
    fn get_run_by_id() {
        let db = Storage::open_memory().unwrap();
        let id = db
            .insert_run(1, &make_result(MatchupStatus::Pass), 100, false, None)
            .unwrap();

        let record = db.get_run(id).unwrap();
        assert_eq!(record.deck1, "red_burn");
        assert_eq!(record.seed, 42);
    }

    #[test]
    fn deck_pair_matrix_query() {
        let db = Storage::open_memory().unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Pass), 100, false, None)
            .unwrap();
        db.insert_run(1, &make_result(MatchupStatus::Fail), 200, false, None)
            .unwrap();

        let matrix = db.deck_pair_matrix(None, &[]).unwrap();
        assert_eq!(matrix.len(), 1);
        assert_eq!(matrix[0].total, 2);
        assert_eq!(matrix[0].passed, 1);
    }

    #[test]
    fn pass_rate_empty() {
        let db = Storage::open_memory().unwrap();
        assert_eq!(db.pass_rate().unwrap(), 0.0);
    }
}
