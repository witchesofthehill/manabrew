use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseImprovise.ts")]
pub struct ChooseImproviseInput {
    pub valid_card_ids: Vec<String>,
    pub remaining_cost: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseImprovise.ts")]
pub enum ChooseImproviseOutput {
    ImproviseDecision { chosen_card_ids: Vec<String> },
}
