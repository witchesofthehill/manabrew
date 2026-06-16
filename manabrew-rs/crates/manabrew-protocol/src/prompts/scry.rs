use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/scry.ts")]
pub struct ScryInput {
    pub card_ids: Vec<String>,
    pub cards: Vec<CardDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/scry.ts")]
pub enum ScryOutput {
    ScryDecision { bottom_card_ids: Vec<String> },
}
