use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::{AttackAssignment, DefenderIdDto};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub struct ChooseAttackersInput {
    pub available_attacker_ids: Vec<String>,
    pub possible_defender_ids: Vec<DefenderIdDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub enum ChooseAttackersOutput {
    Pass {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        until_phase: Option<String>,
    },
    RestoreSnapshot {
        #[ts(type = "number")]
        checkpoint_id: u64,
    },
    DeclareAttackers {
        assignments: Vec<AttackAssignment>,
    },
}
