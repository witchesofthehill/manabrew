//! Analysis daemon for parity failures.
//!
//! Polls the SQLite DB for new failures, clusters them by divergence field + deck pair,
//! calls an LLM for root cause analysis, posts alerts to Discord, and opens GitHub issues.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::agent_loop::{self, AgentConfig};
use crate::infra::discord::{DiscordClient, FailureAlert, PeriodSummary};
use crate::infra::github_issues::{DeckPairRow, GitHubIssues, IssueData};
use crate::infra::llm::{ClusterContext, LlmAnalysis, LlmClient};
use crate::infra::storage::Storage;
use crate::protocol::RunRecord;

/// Configuration for the analysis daemon.
pub struct AnalyzerConfig {
    pub poll_interval: Duration,
    pub summary_interval: Duration,
    pub issue_threshold: i64,
    pub github_repo: Option<String>,
    pub dashboard_url: Option<String>,
    pub java_jar: Option<String>,
    pub cards_dir: Option<String>,
    pub project_root: String,
}

impl Default for AnalyzerConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(60),
            summary_interval: Duration::from_secs(3600),
            issue_threshold: 5,
            github_repo: None,
            dashboard_url: None,
            java_jar: None,
            cards_dir: None,
            project_root: ".".to_string(),
        }
    }
}

/// A group of failures sharing the same cluster key.
struct FailureCluster {
    divergence_field: String,
    rust_value: String,
    java_value: String,
    deck_pairs: HashMap<(String, String), Vec<u64>>, // (deck1, deck2) -> seeds
    covered_cards: Vec<String>,
    count: usize,
}

/// Build a cluster key from a run record.
fn cluster_key(record: &RunRecord) -> String {
    let field_part = match &record.first_divergence_field {
        Some(f) => f.clone(),
        None => match &record.error_message {
            Some(msg) => format!("error:{}", &msg[..msg.len().min(50)]),
            None => "unknown".to_string(),
        },
    };

    let mut decks = [record.deck1.clone(), record.deck2.clone()];
    decks.sort();
    format!("{}|{}+{}", field_part, decks[0], decks[1])
}

/// Group failure records into clusters.
fn cluster_failures(records: &[RunRecord]) -> HashMap<String, FailureCluster> {
    let mut clusters: HashMap<String, FailureCluster> = HashMap::new();
    let mut covered_sets: HashMap<String, std::collections::HashSet<String>> = HashMap::new();

    for record in records {
        let key = cluster_key(record);

        let cluster = clusters
            .entry(key.clone())
            .or_insert_with(|| FailureCluster {
                divergence_field: record
                    .first_divergence_field
                    .clone()
                    .unwrap_or_else(|| "error".to_string()),
                rust_value: record.first_divergence_rust.clone().unwrap_or_default(),
                java_value: record.first_divergence_java.clone().unwrap_or_default(),
                deck_pairs: HashMap::new(),
                covered_cards: Vec::new(),
                count: 0,
            });

        cluster.count += 1;

        let pair = (record.deck1.clone(), record.deck2.clone());
        cluster
            .deck_pairs
            .entry(pair)
            .or_default()
            .push(record.seed);

        // Merge covered cards using HashSet for O(1) dedup
        let set = covered_sets.entry(key).or_default();
        for card in &record.covered_cards {
            if set.insert(card.clone()) {
                cluster.covered_cards.push(card.clone());
            }
        }
    }

    clusters
}

/// Run the analysis daemon loop. Intended to be spawned as a tokio task.
///
/// The `running` flag controls pause/resume — when false the loop sleeps without processing.
pub async fn run(storage: Arc<Mutex<Storage>>, config: AnalyzerConfig, running: Arc<AtomicBool>) {
    tracing::info!(
        paused = !running.load(Ordering::Relaxed),
        poll_interval_s = config.poll_interval.as_secs(),
        summary_interval_s = config.summary_interval.as_secs(),
        issue_threshold = config.issue_threshold,
        "Analyzer daemon starting"
    );

    let llm = LlmClient::from_env();
    let mut discord = DiscordClient::from_env();
    let github = GitHubIssues::new(config.github_repo.clone());

    if llm.is_some() {
        tracing::info!("LLM backend configured");
    } else {
        tracing::warn!("No LLM API key found, skipping AI analysis");
    }
    if discord.is_some() {
        tracing::info!("Discord webhook configured");
    } else {
        tracing::info!("No DISCORD_WEBHOOK_URL, skipping Discord alerts");
    }
    if github.is_available() {
        tracing::info!("GitHub API configured");
    } else {
        tracing::info!("GITHUB_TOKEN or repo not configured, skipping issue creation");
    }

    // Backfill: file GitHub issues for existing clusters in the background
    if github.is_available() {
        let backfill_storage = Arc::clone(&storage);
        let backfill_threshold = config.issue_threshold;
        let backfill_github = GitHubIssues::new(config.github_repo.clone());
        tokio::spawn(async move {
            let backfill_fields = {
                let db = backfill_storage.lock().unwrap();
                db.get_clusters_by_field(None).unwrap_or_default()
            };
            let backfill_count = backfill_fields
                .iter()
                .filter(|fc| fc.total_failures >= backfill_threshold && fc.github_issue.is_none())
                .count();
            if backfill_count == 0 {
                return;
            }
            tracing::info!(
                count = backfill_count,
                "Backfill: filing GitHub issues in background"
            );
            for fc in &backfill_fields {
                if fc.total_failures >= backfill_threshold && fc.github_issue.is_none() {
                    let analysis: Option<LlmAnalysis> = fc
                        .llm_analysis
                        .as_ref()
                        .and_then(|j| serde_json::from_str(j).ok());

                    let issue_data = IssueData {
                        divergence_field: fc.field.clone(),
                        rust_value: String::new(),
                        java_value: String::new(),
                        total_failures: fc.total_failures,
                        first_seen: fc.first_seen.clone(),
                        last_seen: fc.last_seen.clone(),
                        deck_pair_table: vec![],
                        covered_cards: String::new(),
                        analysis,
                        repro_command: String::new(),
                    };

                    match backfill_github.create_issue(&issue_data).await {
                        Ok(num) => {
                            tracing::info!(issue = num, field = %fc.field, "Backfill: created GitHub issue");
                            let db = backfill_storage.lock().unwrap();
                            if let Ok(all_clusters) = db.get_clusters() {
                                for kc in &all_clusters {
                                    if kc.cluster_key.starts_with(&format!("{}|", fc.field)) {
                                        let _ = db.set_cluster_github_issue(&kc.cluster_key, num);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(%e, field = %fc.field, "Backfill: GitHub issue creation failed")
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
            tracing::info!("Backfill complete");
        });
    }

    let mut last_summary = Instant::now();

    loop {
        // Pause check: if not running, sleep and retry
        if !running.load(Ordering::Relaxed) {
            tokio::time::sleep(config.poll_interval).await;
            continue;
        }

        // 1. Read watermark
        let watermark = {
            let db = storage.lock().unwrap();
            db.get_analysis_watermark().unwrap_or(0)
        };

        // 2. Query new failures
        let new_failures = {
            let db = storage.lock().unwrap();
            db.failures_since(watermark).unwrap_or_default()
        };

        if new_failures.is_empty() {
            tokio::time::sleep(config.poll_interval).await;
            continue;
        }

        let max_id = new_failures.iter().map(|r| r.id).max().unwrap_or(watermark);
        let failure_count = new_failures.len();
        tracing::info!(
            count = failure_count,
            from_id = watermark,
            to_id = max_id,
            "Processing new failures"
        );

        // 3. Cluster failures by (field, deck_pair)
        let clusters = cluster_failures(&new_failures);

        // 4. Upsert all clusters in DB (cheap, no LLM calls)
        let now_iso = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

        for (key, cluster) in &clusters {
            let db = storage.lock().unwrap();
            if let Err(e) = db.upsert_cluster(key, cluster.count as i64, &now_iso) {
                tracing::error!(%e, "Cluster upsert error");
            }
        }

        // 5. Aggregate by divergence field for LLM analysis (1 call per field, not per cluster)
        let mut field_groups: HashMap<String, Vec<&FailureCluster>> = HashMap::new();
        for cluster in clusters.values() {
            field_groups
                .entry(cluster.divergence_field.clone())
                .or_default()
                .push(cluster);
        }

        // Sort fields by total failure count descending — analyze most impactful first
        let mut sorted_fields: Vec<_> = field_groups.iter().collect();
        sorted_fields.sort_by(|a, b| {
            let count_a: usize = a.1.iter().map(|c| c.count).sum();
            let count_b: usize = b.1.iter().map(|c| c.count).sum();
            count_b.cmp(&count_a)
        });

        tracing::info!(
            fields = sorted_fields.len(),
            clusters = clusters.len(),
            "Unique divergence fields"
        );

        // Cache field clusters to avoid repeated DB queries in the loop
        let cached_field_clusters = {
            let db = storage.lock().unwrap();
            db.get_clusters_by_field(None).unwrap_or_default()
        };

        for (field, field_clusters) in &sorted_fields {
            let total_count: usize = field_clusters.iter().map(|c| c.count).sum();

            // Skip if this field already has LLM analysis cached
            let already_analyzed = cached_field_clusters
                .iter()
                .any(|fc| fc.field == **field && fc.llm_analysis.is_some());

            // Aggregate all deck pairs and seeds across clusters for this field
            let mut all_deck_pairs: Vec<String> = Vec::new();
            let mut all_seeds: Vec<String> = Vec::new();
            let mut all_cards: Vec<String> = Vec::new();
            let mut sample_rust = String::new();
            let mut sample_java = String::new();

            for c in *field_clusters {
                if sample_rust.is_empty() {
                    sample_rust = c.rust_value.clone();
                    sample_java = c.java_value.clone();
                }
                for ((d1, d2), seeds) in &c.deck_pairs {
                    if all_deck_pairs.len() < 10 {
                        all_deck_pairs.push(format!("{d1} vs {d2}"));
                    }
                    if all_seeds.len() < 5 {
                        for s in seeds.iter().take(2) {
                            if all_seeds.len() < 5 {
                                all_seeds.push(s.to_string());
                            }
                        }
                    }
                }
                if all_cards.len() < 20 {
                    for card in &c.covered_cards {
                        if all_cards.len() < 20 && !all_cards.contains(card) {
                            all_cards.push(card.clone());
                        }
                    }
                }
            }

            // LLM analysis (skip if already cached)
            let cached_analysis: Option<LlmAnalysis> = if already_analyzed {
                cached_field_clusters
                    .iter()
                    .find(|fc| fc.field == **field)
                    .and_then(|fc| {
                        fc.llm_analysis
                            .as_ref()
                            .and_then(|j| serde_json::from_str(j).ok())
                    })
            } else {
                None
            };

            // Run or retrieve LLM analysis
            let analysis: Option<LlmAnalysis> = if let Some(cached) = cached_analysis {
                tracing::debug!(field = %field, "Using cached LLM analysis");
                Some(cached)
            } else if let Some(ref llm_client) = llm {
                let ctx = ClusterContext {
                    count: total_count,
                    divergence_field: field.to_string(),
                    rust_value: sample_rust.clone(),
                    java_value: sample_java.clone(),
                    deck_pairs: all_deck_pairs.join(", "),
                    covered_cards: all_cards.join(", "),
                    sample_seeds: all_seeds.join(", "),
                };

                tracing::info!(
                    field = %field,
                    failures = total_count,
                    deck_pairs = all_deck_pairs.len(),
                    "Analyzing divergence field"
                );

                let agent_config = AgentConfig {
                    project_root: std::path::PathBuf::from(&config.project_root),
                    java_jar: config.java_jar.clone(),
                    cards_dir: config.cards_dir.clone(),
                };

                let analysis_result = if llm_client.supports_tool_calling() {
                    match agent_loop::run_agent_analysis(
                        llm_client,
                        &ctx,
                        &agent_config,
                        llm_client.context_size(),
                    )
                    .await
                    {
                        Ok(r) => {
                            tracing::info!(
                                field = %field,
                                duration_s = r.duration.as_secs(),
                                rounds = r.rounds_used,
                                tools = r.tools_called,
                                "Agent analysis complete"
                            );
                            Ok(r.analysis)
                        }
                        Err(e) => {
                            tracing::warn!(field = %field, %e, "Agent failed, single-shot fallback");
                            llm_client.analyze_cluster(&ctx).await
                        }
                    }
                } else {
                    llm_client.analyze_cluster(&ctx).await
                };

                match analysis_result {
                    Ok(result) => {
                        if let Ok(json) = serde_json::to_string(&result) {
                            let db = storage.lock().unwrap();
                            for key in clusters.keys() {
                                if key.starts_with(&format!("{}|", field)) {
                                    let _ = db.set_cluster_llm_analysis(key, &json);
                                }
                            }
                        }
                        tracing::info!(field = %field, mechanic = %result.mechanic, "Analysis complete");

                        // Discord alert
                        if let Some(ref mut discord_client) = discord {
                            let alert = FailureAlert {
                                field: field.to_string(),
                                rust_value: ctx.rust_value.clone(),
                                java_value: ctx.java_value.clone(),
                                deck_pairs: ctx.deck_pairs.clone(),
                                occurrences: total_count as i64,
                                sample_seeds: ctx.sample_seeds.clone(),
                                analysis: Some(result.clone()),
                            };
                            if let Err(e) = discord_client.post_failure_alert(&alert).await {
                                tracing::error!(%e, "Discord alert failed");
                            }
                        }
                        Some(result)
                    }
                    Err(e) => {
                        tracing::error!(field = %field, %e, "LLM analysis failed");
                        None
                    }
                }
            } else {
                None
            };

            // GitHub issue creation — runs independently of LLM analysis
            if total_count as i64 >= config.issue_threshold && github.is_available() {
                let normalized_field = crate::infra::github_issues::normalize_field(field);
                // Check local DB first for a known issue number (match by normalized field)
                let local_issue = {
                    let db = storage.lock().unwrap();
                    db.get_clusters_by_field(None).ok().and_then(|fields| {
                        fields
                            .iter()
                            .find(|fc| {
                                crate::infra::github_issues::normalize_field(&fc.field)
                                    == normalized_field
                            })
                            .and_then(|fc| fc.github_issue)
                    })
                };

                let existing_issue = if let Some(num) = local_issue {
                    Some(num)
                } else {
                    match github.find_existing_issue(field).await {
                        Ok(found) => found,
                        Err(e) => {
                            tracing::error!(%e, "GitHub issue search failed");
                            None
                        }
                    }
                };

                let first_cluster = &field_clusters[0];
                let deck_pair_rows: Vec<DeckPairRow> = field_clusters
                    .iter()
                    .flat_map(|c| c.deck_pairs.iter())
                    .take(10)
                    .map(|((d1, d2), seeds)| DeckPairRow {
                        deck1: d1.clone(),
                        deck2: d2.clone(),
                        failures: seeds.len(),
                        sample_seed: seeds.first().copied().unwrap_or(0),
                    })
                    .collect();

                let first_seed = all_seeds
                    .first()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(42u64);
                let repro = all_deck_pairs.first()
                    .map(|dp| {
                        let parts: Vec<&str> = dp.split(" vs ").collect();
                        format!(
                            "cargo run -p forge-parity -- --deck1 {} --deck2 {} --seed {} --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar",
                            parts.first().unwrap_or(&""), parts.get(1).unwrap_or(&""), first_seed
                        )
                    })
                    .unwrap_or_default();

                let issue_data = IssueData {
                    divergence_field: field.to_string(),
                    rust_value: first_cluster.rust_value.clone(),
                    java_value: first_cluster.java_value.clone(),
                    total_failures: total_count as i64,
                    first_seen: now_iso.clone(),
                    last_seen: now_iso.clone(),
                    deck_pair_table: deck_pair_rows,
                    covered_cards: all_cards.join(", "),
                    analysis,
                    repro_command: repro,
                };

                if let Some(issue_num) = existing_issue {
                    // Skip commenting on existing issues to avoid spamming subscribers
                    tracing::debug!(issue = issue_num, field = %field, "Existing issue found, skipping comment");
                } else {
                    match github.create_issue(&issue_data).await {
                        Ok(num) => {
                            tracing::info!(issue = num, "Created GitHub issue");
                            let db = storage.lock().unwrap();
                            for key in clusters.keys() {
                                if key.starts_with(&format!("{}|", field)) {
                                    let _ = db.set_cluster_github_issue(key, num);
                                }
                            }
                        }
                        Err(e) => tracing::error!(%e, "GitHub issue creation failed"),
                    }
                }
            } else if total_count as i64 >= config.issue_threshold {
                tracing::debug!(field = %field, "Skipping GitHub issue: not configured");
            }
        }

        // 5. Update watermark
        {
            let db = storage.lock().unwrap();
            if let Err(e) = db.set_analysis_watermark(max_id) {
                tracing::error!(%e, "Failed to update watermark");
            }
        }

        // 6. Periodic summary
        if last_summary.elapsed() >= config.summary_interval {
            if let Some(ref mut discord_client) = discord {
                let summary = {
                    let db = storage.lock().unwrap();
                    build_summary(&db, &config)
                };
                if let Some(summary) = summary {
                    if let Err(e) = discord_client.post_summary(&summary).await {
                        tracing::error!(%e, "Discord summary failed");
                    }
                }
            }
            last_summary = Instant::now();
        }

        tokio::time::sleep(config.poll_interval).await;
    }
}

/// Check if a cluster grew significantly (doubled or more since last analysis).
fn grew_significantly(cluster: &crate::infra::storage::KnownCluster) -> bool {
    // Consider significant if total count is at a power-of-2 boundary
    let count = cluster.failure_count;
    count > 0 && (count & (count - 1)) == 0
}

fn build_summary(db: &Storage, config: &AnalyzerConfig) -> Option<PeriodSummary> {
    let stats = db
        .stats(
            config.summary_interval.as_secs(),
            "1970-01-01T00:00:00Z",
            None,
            &[],
        )
        .ok()?;

    // Get top failure fields
    let failures = db.recent_failures(100, None, &[]).ok()?;
    let mut field_counts: HashMap<String, usize> = HashMap::new();
    for f in &failures {
        if let Some(ref field) = f.first_divergence_field {
            *field_counts.entry(field.clone()).or_default() += 1;
        }
    }
    let mut top: Vec<_> = field_counts.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1));
    top.truncate(5);

    Some(PeriodSummary {
        period: format!("last {}h", config.summary_interval.as_secs() / 3600),
        total_games: stats.total_games,
        passed: stats.passed,
        failed: stats.failed,
        errors: stats.errors,
        pass_rate: stats.pass_rate,
        top_failures: top,
        dashboard_url: config.dashboard_url.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{MatchupStatus, RunRecord};

    fn make_record(field: &str, deck1: &str, deck2: &str, seed: u64) -> RunRecord {
        RunRecord {
            id: 0,
            batch_id: 1,
            deck1: deck1.to_string(),
            deck2: deck2.to_string(),
            seed,
            status: MatchupStatus::Fail,
            snapshots_compared: 10,
            divergence_count: 1,
            first_divergence_field: Some(field.to_string()),
            first_divergence_rust: Some("18".to_string()),
            first_divergence_java: Some("20".to_string()),
            covered_cards: vec!["Lightning Bolt".to_string()],
            duration_ms: 100,
            error_message: None,
            rust_trace: None,
            java_trace: None,
            is_fuzz: false,
            timestamp: "2026-03-05T10:00:00Z".to_string(),
            commit_sha: None,
        }
    }

    #[test]
    fn cluster_key_sorts_decks() {
        let r1 = make_record("players[0].life", "green_stompy", "red_burn", 42);
        let r2 = make_record("players[0].life", "red_burn", "green_stompy", 43);
        assert_eq!(cluster_key(&r1), cluster_key(&r2));
    }

    #[test]
    fn cluster_key_different_fields() {
        let r1 = make_record("players[0].life", "red_burn", "green_stompy", 42);
        let r2 = make_record("players[1].life", "red_burn", "green_stompy", 42);
        assert_ne!(cluster_key(&r1), cluster_key(&r2));
    }

    #[test]
    fn cluster_failures_groups_correctly() {
        let records = vec![
            make_record("players[0].life", "red_burn", "green_stompy", 42),
            make_record("players[0].life", "red_burn", "green_stompy", 43),
            make_record("players[1].life", "red_burn", "green_stompy", 44),
        ];
        let clusters = cluster_failures(&records);
        assert_eq!(clusters.len(), 2);

        let key = cluster_key(&records[0]);
        let cluster = &clusters[&key];
        assert_eq!(cluster.count, 2);
    }

    #[test]
    fn grew_significantly_powers_of_two() {
        use crate::infra::storage::KnownCluster;

        let make = |count: i64| KnownCluster {
            id: 1,
            cluster_key: "test".into(),
            failure_count: count,
            first_seen: String::new(),
            last_seen: String::new(),
            github_issue: None,
            last_discord_ts: None,
            llm_analysis: None,
        };

        assert!(grew_significantly(&make(1)));
        assert!(grew_significantly(&make(2)));
        assert!(!grew_significantly(&make(3)));
        assert!(grew_significantly(&make(4)));
        assert!(!grew_significantly(&make(5)));
        assert!(grew_significantly(&make(8)));
        assert!(grew_significantly(&make(16)));
    }
}
