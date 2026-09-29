use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::TargetingIntent;
use crate::prompts::common::{PromptPresentation, TargetRef};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseObject.ts")]
pub struct ChooseObjectInput {
    pub presentation: PromptPresentation,
    pub candidates: Vec<TargetRef>,
    pub selected: Vec<TargetRef>,
    pub intent: TargetingIntent,
    pub can_finish: bool,
    pub cancellable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseObject.ts")]
pub enum ChooseObjectOutput {
    Select { target: TargetRef },
    Finish,
    Cancel,
}
