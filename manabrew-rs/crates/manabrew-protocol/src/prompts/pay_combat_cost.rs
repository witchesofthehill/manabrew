use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::ActivatableAbilityInfo;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/payCombatCost.ts")]
pub struct PayCombatCostInput {
    pub attacker_id: String,
    pub attacker_name: String,
    pub cost: i32,
    pub description: String,
    pub mana_ability_options: Vec<ActivatableAbilityInfo>,
    pub tappable_source_ids: Vec<String>,
    pub untappable_source_ids: Vec<String>,
    pub mana_pool_total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/payCombatCost.ts")]
pub enum PayCombatCostOutput {
    PayCombatCost,
    DeclineCombatCost,
    TapForMana {
        card_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        ability_index: Option<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
    },
    Untap {
        card_id: String,
    },
}
