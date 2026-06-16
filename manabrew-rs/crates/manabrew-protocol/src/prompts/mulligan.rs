use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/mulligan.ts")]
pub struct MulliganInput {
    pub hand_card_ids: Vec<String>,
    pub mulligan_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/mulligan.ts")]
pub enum MulliganOutput {
    MulliganDecision { keep: bool },
}
