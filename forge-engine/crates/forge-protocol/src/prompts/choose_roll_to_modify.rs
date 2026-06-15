use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseRollToModify.ts")]
pub struct ChooseRollToModifyInput {
    pub rolls: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseRollToModify.ts")]
pub enum ChooseRollToModifyOutput {
    RollToModifyDecision { roll: Option<i32> },
}
