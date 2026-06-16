use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAlternativeCost.ts")]
pub struct ChooseAlternativeCostInput {
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseAlternativeCost.ts")]
pub enum ChooseAlternativeCostOutput {
    AlternativeCostDecision { chosen_index: usize },
}
