//! Discord webhook integration for parity failure alerts and summaries.
//!
//! Posts rich embeds to a Discord channel via webhook URL from `DISCORD_WEBHOOK_URL`.

use serde::Serialize;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::infra::llm::LlmAnalysis;

/// Discord webhook client with rate limiting.
pub struct DiscordClient {
    webhook_url: String,
    client: reqwest::Client,
    /// Timestamps of recent sends for rate limiting (max 5 per 2s).
    send_times: VecDeque<Instant>,
}

#[derive(Serialize)]
struct WebhookPayload {
    embeds: Vec<Embed>,
}

#[derive(Serialize)]
struct Embed {
    title: String,
    description: String,
    color: u32,
}

/// Failure alert data for a cluster.
pub struct FailureAlert {
    pub field: String,
    pub rust_value: String,
    pub java_value: String,
    pub deck_pairs: String,
    pub occurrences: i64,
    pub sample_seeds: String,
    pub analysis: Option<LlmAnalysis>,
}

/// Summary data for periodic reporting.
pub struct PeriodSummary {
    pub period: String,
    pub total_games: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
    pub pass_rate: f64,
    pub top_failures: Vec<(String, usize)>,
    pub dashboard_url: Option<String>,
}

impl DiscordClient {
    /// Create a client from `DISCORD_WEBHOOK_URL` env var. Returns `None` if unset.
    pub fn from_env() -> Option<Self> {
        let url = std::env::var("DISCORD_WEBHOOK_URL").ok()?;
        if url.is_empty() {
            return None;
        }
        Some(Self {
            webhook_url: url,
            client: reqwest::Client::new(),
            send_times: VecDeque::new(),
        })
    }

    /// Post a failure alert embed.
    pub async fn post_failure_alert(&mut self, alert: &FailureAlert) -> Result<(), String> {
        let mut desc = format!(
            "**Field:** `{}`\n**Rust:** `{}` | **Java:** `{}`\n**Decks:** {}\n**Occurrences:** {}\n**Seeds:** {}",
            alert.field, alert.rust_value, alert.java_value,
            alert.deck_pairs, alert.occurrences, alert.sample_seeds,
        );

        if let Some(ref analysis) = alert.analysis {
            desc.push_str(&format!(
                "\n\n**AI Analysis:**\n{}\n\n**Suggested files:** {}",
                analysis.root_cause,
                analysis.files_to_check.join(", "),
            ));
        }

        let embed = Embed {
            title: "New Parity Failure Pattern".to_string(),
            description: desc,
            color: 0xED4245, // red
        };

        self.send_embed(embed).await
    }

    /// Post a periodic summary embed.
    pub async fn post_summary(&mut self, summary: &PeriodSummary) -> Result<(), String> {
        let mut desc = format!(
            "**Games:** {} | **Pass Rate:** {:.1}%\n**Passed:** {} | **Failed:** {} | **Errors:** {}",
            summary.total_games,
            summary.pass_rate * 100.0,
            summary.passed,
            summary.failed,
            summary.errors,
        );

        if !summary.top_failures.is_empty() {
            desc.push_str("\n\n**Top failures:**");
            for (field, count) in &summary.top_failures {
                desc.push_str(&format!("\n  - `{}` ({} occurrences)", field, count));
            }
        }

        if let Some(ref url) = summary.dashboard_url {
            desc.push_str(&format!("\n\n**Dashboard:** {}", url));
        }

        let embed = Embed {
            title: format!("Parity Summary ({})", summary.period),
            description: desc,
            color: 0x5865F2, // blurple
        };

        self.send_embed(embed).await
    }

    async fn send_embed(&mut self, embed: Embed) -> Result<(), String> {
        self.rate_limit().await;

        let payload = WebhookPayload {
            embeds: vec![embed],
        };

        let resp = self
            .client
            .post(&self.webhook_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Discord webhook request failed: {e}"))?;

        if resp.status().as_u16() == 429 {
            // Rate limited — extract retry_after and wait
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let retry_after = body["retry_after"].as_f64().unwrap_or(2.0);
            eprintln!(
                "[analyzer] Discord rate limited, retrying in {:.1}s",
                retry_after
            );
            tokio::time::sleep(Duration::from_secs_f64(retry_after)).await;

            // Retry once
            let retry_resp = self
                .client
                .post(&self.webhook_url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Discord webhook retry failed: {e}"))?;

            if !retry_resp.status().is_success() {
                let status = retry_resp.status();
                let text = retry_resp.text().await.unwrap_or_default();
                return Err(format!(
                    "Discord webhook error after retry {status}: {text}"
                ));
            }
        } else if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Discord webhook error {status}: {text}"));
        }

        self.send_times.push_back(Instant::now());
        Ok(())
    }

    /// Enforce max 5 messages per 2 seconds.
    async fn rate_limit(&mut self) {
        let window = Duration::from_secs(2);
        let now = Instant::now();

        // Purge old entries
        while self
            .send_times
            .front()
            .is_some_and(|t| now.duration_since(*t) > window)
        {
            self.send_times.pop_front();
        }

        if self.send_times.len() >= 5 {
            if let Some(oldest) = self.send_times.front() {
                let wait = window.saturating_sub(now.duration_since(*oldest));
                if !wait.is_zero() {
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }
}
