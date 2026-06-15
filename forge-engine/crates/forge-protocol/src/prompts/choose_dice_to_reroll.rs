use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseDiceToReroll.ts")]
pub struct ChooseDiceToRerollInput {
    pub rolls: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseDiceToReroll.ts")]
pub enum ChooseDiceToRerollOutput {
    DiceToRerollDecision { rolls: Vec<i32> },
}
