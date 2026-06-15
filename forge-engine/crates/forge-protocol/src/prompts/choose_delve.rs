use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseDelve.ts")]
pub struct ChooseDelveInput {
    pub valid_card_ids: Vec<String>,
    pub zone_cards: Vec<CardDto>,
    pub max_cards: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseDelve.ts")]
pub enum ChooseDelveOutput {
    DelveDecision { chosen_card_ids: Vec<String> },
}
