use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::{ActivatableAbilityInfo, ManaSourceAction};

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
    pub delve_source_ids: Vec<String>,
    pub mana_pool_total: i32,
    pub can_confirm_from_pool: bool,
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
pub enum DelveAction {
    Delve { card_id: String },
    Undelve { card_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub enum ManaPayment {
    Pay {
        #[serde(default)]
        auto: bool,
    },
    PayLife,
    Cancel,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub enum PayManaCostOutput {
    ManaSourceAction(ManaSourceAction),
    DelveAction(DelveAction),
    ManaPayment(ManaPayment),
}
