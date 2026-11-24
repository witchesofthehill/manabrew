use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::{AttackAssignment, AttackTargetDto};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub struct AttackerOptionDto {
    pub attacker_id: String,
    pub valid_target_ids: Vec<String>,
    pub must_attack: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub suggested_target_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub struct ChooseAttackersInput {
    pub attackers: Vec<AttackerOptionDto>,
    pub attack_targets: Vec<AttackTargetDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub enum ChooseAttackersOutput {
    DeclareAttackers { assignments: Vec<AttackAssignment> },
}
