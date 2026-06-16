use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::{CardDto, TargetingIntent};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseTargetCardFromZone.ts")]
pub struct ChooseTargetCardFromZoneInput {
    pub valid_card_ids: Vec<String>,
    pub zone: String,
    pub zone_cards: Vec<CardDto>,
    pub intent: TargetingIntent,
    pub min_targets: i32,
    pub max_targets: i32,
    pub chosen_targets: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseTargetCardFromZone.ts")]
pub enum ChooseTargetCardFromZoneOutput {
    TargetCard { card_id: Option<String> },
}
