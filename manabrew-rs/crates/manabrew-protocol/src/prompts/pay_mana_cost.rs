use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::AvailableAction;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub struct PayManaCostInput {
    pub card_id: String,
    pub card_name: String,
    pub mana_cost: String,
    pub can_confirm_from_pool: bool,
    pub actions: Vec<AvailableAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub enum PayManaCostOutput {
    Act {
        action_id: String,
    },
    Pay {
        #[serde(default)]
        auto: bool,
    },
    PayLife,
    Cancel,
}
