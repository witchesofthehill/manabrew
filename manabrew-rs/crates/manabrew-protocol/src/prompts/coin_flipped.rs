use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/coinFlipped.ts")]
pub enum CoinFace {
    Heads,
    Tails,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/coinFlipped.ts")]
pub struct CoinFlipEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub player_id: Option<String>,
    pub results: Vec<CoinFace>,
    pub kept_result: CoinFace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub called_face: Option<CoinFace>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub won: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/coinFlipped.ts")]
pub struct CoinFlippedInput {
    pub presentation: PromptPresentation,
    pub flips: Vec<CoinFlipEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_card_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_card_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/coinFlipped.ts")]
pub enum CoinFlippedOutput {
    CoinFlippedAcknowledged,
}
