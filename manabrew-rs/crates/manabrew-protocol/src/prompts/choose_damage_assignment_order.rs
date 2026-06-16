use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseDamageAssignmentOrder.ts")]
pub struct ChooseDamageAssignmentOrderInput {
    pub attacker_id: String,
    pub blocker_ids: Vec<String>,
    pub blocker_cards: Vec<CardDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseDamageAssignmentOrder.ts")]
pub enum ChooseDamageAssignmentOrderOutput {
    DamageAssignmentOrderDecision { ordered_blocker_ids: Vec<String> },
}
