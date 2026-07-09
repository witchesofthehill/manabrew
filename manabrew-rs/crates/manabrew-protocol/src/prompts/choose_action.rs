use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::AvailableAction;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub struct ChooseActionInput {
    pub actions: Vec<AvailableAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub struct PassUntil {
    pub player_id: String,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub enum ChooseActionOutput {
    Pass {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        until: Option<PassUntil>,
    },
    RestoreSnapshot {
        #[ts(type = "number")]
        checkpoint_id: u64,
    },
    Act {
        action_id: String,
    },
}
