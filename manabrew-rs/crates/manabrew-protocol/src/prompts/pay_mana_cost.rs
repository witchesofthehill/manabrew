use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::ActivatableAbilityInfo;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub struct PayManaCostInput {
    pub card_id: String,
    pub card_name: String,
    pub mana_cost: String,
    pub mana_ability_options: Vec<ActivatableAbilityInfo>,
    pub tappable_source_ids: Vec<String>,
    pub untappable_source_ids: Vec<String>,
    pub mana_pool_total: i32,
    pub can_confirm_from_pool: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub enum PayManaCostOutput {
    PayManaCost {
        #[serde(default)]
        auto: bool,
    },
    PayLife,
    CancelManaCost,
}
