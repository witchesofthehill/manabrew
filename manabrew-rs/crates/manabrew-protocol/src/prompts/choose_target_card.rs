use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::TargetingIntent;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseTargetCard.ts")]
pub struct ChooseTargetCardInput {
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
#[ts(export, export_to = "prompts/chooseTargetCard.ts")]
pub enum ChooseTargetCardOutput {
    TargetCard { card_id: Option<String> },
}
