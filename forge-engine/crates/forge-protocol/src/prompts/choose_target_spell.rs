use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::TargetingIntent;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseTargetSpell.ts")]
pub struct ChooseTargetSpellInput {
    pub valid_spell_ids: Vec<String>,
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
#[ts(export, export_to = "prompts/chooseTargetSpell.ts")]
pub enum ChooseTargetSpellOutput {
    TargetSpell { spell_id: Option<String> },
}
