use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseRollToSwap.ts")]
pub struct ChooseRollToSwapInput {
    pub rolls: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseRollToSwap.ts")]
pub enum ChooseRollToSwapOutput {
    RollToSwapDecision { roll: Option<i32> },
}
