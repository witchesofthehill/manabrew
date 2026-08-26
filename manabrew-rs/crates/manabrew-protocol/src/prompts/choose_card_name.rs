use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseCardName.ts")]
pub struct ChooseCardNameInput {
    pub presentation: PromptPresentation,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseCardName.ts")]
pub enum ChooseCardNameOutput {
    CardNameDecision { name: String },
}
