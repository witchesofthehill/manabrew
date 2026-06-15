use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseMultikicker.ts")]
pub struct ChooseMultikickerInput {
    pub cost: String,
    pub max_kicks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseMultikicker.ts")]
pub enum ChooseMultikickerOutput {
    MultikickerDecision { kick_count: u32 },
}
