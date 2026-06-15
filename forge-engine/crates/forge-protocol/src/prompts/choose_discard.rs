use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseDiscard.ts")]
pub struct ChooseDiscardInput {
    pub hand_card_ids: Vec<String>,
    pub num_to_discard: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseDiscard.ts")]
pub enum ChooseDiscardOutput {
    DiscardDecision { discarded_card_ids: Vec<String> },
}
