use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/dig.ts")]
pub struct DigInput {
    pub card_ids: Vec<String>,
    pub cards: Vec<CardDto>,
    pub num_to_take: usize,
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/dig.ts")]
pub enum DigOutput {
    DigDecision { chosen_card_ids: Vec<String> },
}
