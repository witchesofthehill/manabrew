use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::TargetAnyChoice;
use crate::values::TargetingIntent;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseTargetAny.ts")]
pub struct ChooseTargetAnyInput {
    pub valid_player_ids: Vec<String>,
    pub valid_card_ids: Vec<String>,
    #[serde(default)]
    pub hostile: bool,
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
#[ts(export, export_to = "prompts/chooseTargetAny.ts")]
pub enum ChooseTargetAnyOutput {
    TargetAny { target: TargetAnyChoice },
}
