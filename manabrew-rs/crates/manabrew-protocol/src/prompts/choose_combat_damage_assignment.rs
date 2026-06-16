use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::CombatDamageAssignmentEntry;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseCombatDamageAssignment.ts")]
pub struct ChooseCombatDamageAssignmentInput {
    pub attacker_id: String,
    pub blocker_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub defender_id: Option<String>,
    pub total_damage: i32,
    pub attacker_has_deathtouch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseCombatDamageAssignment.ts")]
pub enum ChooseCombatDamageAssignmentOutput {
    CombatDamageAssignmentDecision {
        assignments: Vec<CombatDamageAssignmentEntry>,
    },
}
