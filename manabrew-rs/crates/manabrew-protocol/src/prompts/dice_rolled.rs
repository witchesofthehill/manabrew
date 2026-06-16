use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/diceRolled.ts")]
pub struct DiceRolledInput {
    pub player_id: String,
    pub sides: i32,
    pub natural_results: Vec<i32>,
    pub final_results: Vec<i32>,
    pub ignored_rolls: Vec<i32>,
    pub source_card_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/diceRolled.ts")]
pub enum DiceRolledOutput {
    DiceRolledAcknowledged,
}
