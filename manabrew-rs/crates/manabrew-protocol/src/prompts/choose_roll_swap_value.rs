use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseRollSwapValue.ts")]
pub struct ChooseRollSwapValueInput {
    pub current_result: i32,
    pub power: i32,
    pub toughness: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseRollSwapValue.ts")]
pub enum RollSwapValue {
    Power,
    Toughness,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseRollSwapValue.ts")]
pub enum ChooseRollSwapValueOutput {
    RollSwapValueDecision { choice: Option<RollSwapValue> },
}
