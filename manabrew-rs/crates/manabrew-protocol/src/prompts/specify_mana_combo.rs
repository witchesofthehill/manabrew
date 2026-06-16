use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/specifyManaCombo.ts")]
pub struct SpecifyManaComboInput {
    pub available_colors: Vec<String>,
    pub amount: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/specifyManaCombo.ts")]
pub enum SpecifyManaComboOutput {
    ManaComboDecision { chosen_colors: Vec<String> },
}
