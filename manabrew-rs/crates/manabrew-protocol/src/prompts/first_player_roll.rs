use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::FirstPlayerRollEntry;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/firstPlayerRoll.ts")]
pub struct FirstPlayerRollInput {
    pub sides: i32,
    #[serde(rename = "firstPlayerRolls")]
    #[ts(rename = "firstPlayerRolls")]
    pub rolls: Vec<FirstPlayerRollEntry>,
    pub winner_player_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/firstPlayerRoll.ts")]
pub enum FirstPlayerRollOutput {
    FirstPlayerRollAcknowledged,
}
