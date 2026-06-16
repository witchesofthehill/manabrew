//! GitHub issue creation and dedup via the GitHub REST API.
//!
//! Creates issues for significant parity failure clusters, and adds comments
//! to existing issues rather than creating duplicates.
//! Uses `reqwest` + `GITHUB_TOKEN` env var instead of the `gh` CLI.

use crate::infra::llm::LlmAnalysis;

/// Normalize a divergence field by replacing array indices with `[*]`.
/// e.g. `players[0].battlefield[3].power` → `players[*].battlefield[*].power`
pub fn normalize_field(field: &str) -> String {
    let mut result = String::with_capacity(field.len());
    let mut chars = field.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            result.push('[');
            // Skip digits until ']'
            while let Some(&next) = chars.peek() {
                if next == ']' {
                    break;
                }
                chars.next();
            }
            result.push('*');
        } else {
            result.push(c);
        }
    }
    result
}

/// Data for a parity failure issue.
pub struct IssueData {
    pub divergence_field: String,
    pub rust_value: String,
    pub java_value: String,
    pub total_failures: i64,
    pub first_seen: String,
    pub last_seen: String,
    pub deck_pair_table: Vec<DeckPairRow>,
    pub covered_cards: String,
    pub analysis: Option<LlmAnalysis>,
    pub repro_command: String,
}

/// A row in the deck pair table for the issue body.
pub struct DeckPairRow {
    pub deck1: String,
    pub deck2: String,
    pub failures: usize,
    pub sample_seed: u64,
}

/// GitHub issue manager using the REST API.
pub struct GitHubIssues {
    repo: String,
    token: Option<String>,
    client: reqwest::Client,
}

impl GitHubIssues {
    /// Create a new issue manager.
    /// `repo` should be in `owner/repo` format.
    /// Reads `GITHUB_TOKEN` from the environment.
    pub fn new(repo: Option<String>) -> Self {
        let token = std::env::var("GITHUB_TOKEN").ok();
        Self {
            repo: repo.unwrap_or_default(),
            token,
            client: reqwest::Client::new(),
        }
    }

    /// Check if the GitHub API is available (token + repo configured).
    pub fn is_available(&self) -> bool {
        self.token.is_some() && !self.repo.is_empty()
    }

    fn api_url(&self, path: &str) -> String {
        format!("https://api.github.com/repos/{}{}", self.repo, path)
    }

    /// Execute a request with rate-limit-aware retry (up to 2 retries with exponential backoff).
    async fn send_with_retry(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, String> {
        let mut delay = std::time::Duration::from_secs(2);
        for attempt in 0..3u32 {
            // Clone the request builder for retry (reqwest builders are not Clone,
            // so we use try_clone on the built request).
            let resp = request
                .try_clone()
                .ok_or("Request cannot be retried")?
                .send()
                .await
                .map_err(|e| format!("GitHub API request failed: {e}"))?;

            let status = resp.status();
            if status == reqwest::StatusCode::FORBIDDEN
                || status == reqwest::StatusCode::TOO_MANY_REQUESTS
            {
                // Check Retry-After or X-RateLimit-Reset header
                let retry_secs = resp
                    .headers()
                    .get("retry-after")
                    .or_else(|| resp.headers().get("x-ratelimit-reset"))
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .map(|secs| {
                        // x-ratelimit-reset is a Unix timestamp
                        if secs > 1_000_000_000 {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs();
                            secs.saturating_sub(now).min(120)
                        } else {
                            secs.min(120)
                        }
                    })
                    .unwrap_or(delay.as_secs());

                if attempt < 2 {
                    tracing::warn!(
                        attempt,
                        retry_in_secs = retry_secs,
                        "GitHub rate limited, backing off"
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(retry_secs)).await;
                    delay *= 2;
                    continue;
                }
                let text = resp.text().await.unwrap_or_default();
                return Err(format!(
                    "GitHub rate limited after retries: {status} {text}"
                ));
            }

            return Ok(resp);
        }
        Err("GitHub API: max retries exceeded".to_string())
    }

    /// Search for an existing open issue matching this cluster.
    /// Returns `Ok(Some(number))` if found, `Ok(None)` if no match, `Err` on API failure.
    pub async fn find_existing_issue(&self, divergence_field: &str) -> Result<Option<i64>, String> {
        let token = self.token.as_ref().ok_or("GITHUB_TOKEN not set")?;
        let normalized = normalize_field(divergence_field);
        let query = format!(
            "repo:{} is:issue label:parity-failure {} in:title",
            self.repo, normalized
        );
        let resp = self
            .send_with_retry(
                self.client
                    .get("https://api.github.com/search/issues")
                    .query(&[("q", &query), ("per_page", &"1".to_string())])
                    .header("Authorization", format!("Bearer {token}"))
                    .header("User-Agent", "parity")
                    .header("Accept", "application/vnd.github+json"),
            )
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub search API {status}: {text}"));
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse search response: {e}"))?;

        Ok(body
            .get("items")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("number"))
            .and_then(|n| n.as_i64()))
    }

    /// Create a new GitHub issue. Returns the issue number.
    pub async fn create_issue(&self, data: &IssueData) -> Result<i64, String> {
        let token = self.token.as_ref().ok_or("GITHUB_TOKEN not set")?;
        let normalized = normalize_field(&data.divergence_field);
        let title = format!(
            "Parity divergence: {} ({} failures)",
            normalized, data.total_failures
        );
        let body = build_issue_body(data);

        let payload = serde_json::json!({
            "title": title,
            "body": body,
            "labels": ["parity-failure", "automated"],
        });

        let resp = self
            .send_with_retry(
                self.client
                    .post(self.api_url("/issues"))
                    .header("Authorization", format!("Bearer {token}"))
                    .header("User-Agent", "parity")
                    .header("Accept", "application/vnd.github+json")
                    .json(&payload),
            )
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API {status}: {text}"));
        }

        let result: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        result
            .get("number")
            .and_then(|n| n.as_i64())
            .ok_or_else(|| "No issue number in response".to_string())
    }

    /// Add a comment to an existing issue with updated stats.
    pub async fn add_comment(&self, issue_number: i64, data: &IssueData) -> Result<(), String> {
        let token = self.token.as_ref().ok_or("GITHUB_TOKEN not set")?;
        let body = format!(
            "## Updated Parity Stats\n\n\
             **Total failures:** {}\n\
             **Last seen:** {}\n\n\
             ---\nGenerated by Parity Analysis Agent",
            data.total_failures, data.last_seen
        );

        let payload = serde_json::json!({ "body": body });

        let resp = self
            .send_with_retry(
                self.client
                    .post(self.api_url(&format!("/issues/{issue_number}/comments")))
                    .header("Authorization", format!("Bearer {token}"))
                    .header("User-Agent", "parity")
                    .header("Accept", "application/vnd.github+json")
                    .json(&payload),
            )
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API {status}: {text}"));
        }

        Ok(())
    }
}

fn build_issue_body(data: &IssueData) -> String {
    let mut body = format!(
        "## Parity Failure Report\n\n\
         **Divergence:** `{}` -- Rust: `{}`, Java: `{}`\n\
         **Occurrences:** {}\n\
         **First seen:** {}\n\
         **Last seen:** {}\n",
        data.divergence_field,
        data.rust_value,
        data.java_value,
        data.total_failures,
        data.first_seen,
        data.last_seen,
    );

    if !data.deck_pair_table.is_empty() {
        body.push_str("\n### Affected Deck Pairs\n");
        body.push_str("| Deck 1 | Deck 2 | Failures | Sample Seed |\n");
        body.push_str("|--------|--------|----------|-------------|\n");
        for row in &data.deck_pair_table {
            body.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                row.deck1, row.deck2, row.failures, row.sample_seed
            ));
        }
    }

    if !data.covered_cards.is_empty() {
        body.push_str(&format!("\n### Cards Involved\n{}\n", data.covered_cards));
    }

    if let Some(ref analysis) = data.analysis {
        body.push_str(&format!(
            "\n### AI Analysis\n{}\n\n**Suggested files:** {}\n",
            analysis.root_cause,
            analysis.files_to_check.join(", "),
        ));
    }

    body.push_str(&format!(
        "\n### Reproduction\n```\n{}\n```\n\n---\nGenerated by Parity Analysis Agent\n",
        data.repro_command,
    ));

    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_indices() {
        assert_eq!(
            normalize_field("players[0].battlefield[3].power"),
            "players[*].battlefield[*].power"
        );
        assert_eq!(normalize_field("players[1].life"), "players[*].life");
        assert_eq!(normalize_field("active_player"), "active_player");
        assert_eq!(
            normalize_field("players[0].battlefield.count"),
            "players[*].battlefield.count"
        );
    }

    #[test]
    fn is_available_requires_token_and_repo() {
        let gh = GitHubIssues {
            repo: String::new(),
            token: Some("tok".into()),
            client: reqwest::Client::new(),
        };
        assert!(!gh.is_available());

        let gh = GitHubIssues {
            repo: "owner/repo".into(),
            token: None,
            client: reqwest::Client::new(),
        };
        assert!(!gh.is_available());

        let gh = GitHubIssues {
            repo: "owner/repo".into(),
            token: Some("tok".into()),
            client: reqwest::Client::new(),
        };
        assert!(gh.is_available());
    }
}
