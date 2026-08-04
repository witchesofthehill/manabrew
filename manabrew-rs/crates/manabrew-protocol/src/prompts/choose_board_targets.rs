use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::TargetingIntent;
use crate::prompts::common::{PromptPresentation, TargetRef};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseBoardTargets.ts")]
pub struct ChooseBoardTargetsInput {
    pub presentation: PromptPresentation,
    pub candidates: Vec<TargetRef>,
    #[serde(default)]
    pub hostile: bool,
    pub intent: TargetingIntent,
    pub min_targets: i32,
    pub max_targets: i32,
    pub chosen_targets: i32,
    pub cancellable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseBoardTargets.ts")]
pub enum ChooseBoardTargetsOutput {
    BoardTargets { chosen: Vec<TargetRef> },
    Cancel,
}
