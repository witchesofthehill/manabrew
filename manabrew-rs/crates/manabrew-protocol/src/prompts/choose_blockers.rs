use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::BlockAssignment;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseBlockers.ts")]
pub struct ChooseBlockersInput {
    pub attacker_ids: Vec<String>,
    pub available_blocker_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseBlockers.ts")]
pub enum ChooseBlockersOutput {
    Pass {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        until_phase: Option<String>,
    },
    RestoreSnapshot {
        #[ts(type = "number")]
        checkpoint_id: u64,
    },
    DeclareBlockers {
        assignments: Vec<BlockAssignment>,
    },
}
