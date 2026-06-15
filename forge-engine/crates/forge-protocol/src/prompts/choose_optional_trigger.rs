use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseOptionalTrigger.ts")]
pub struct ChooseOptionalTriggerInput {
    pub description: String,
    #[serde(default)]
    pub cards: Vec<CardDto>,
    pub prompt_kind: Option<String>,
    pub option_labels: Option<Vec<String>>,
    pub mode: Option<String>,
    pub api: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseOptionalTrigger.ts")]
pub enum ChooseOptionalTriggerOutput {
    OptionalTriggerDecision { accept: bool },
}
