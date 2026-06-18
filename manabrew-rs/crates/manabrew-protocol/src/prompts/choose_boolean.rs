use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseBoolean.ts")]
pub struct ChooseBooleanInput {
    pub presentation: PromptPresentation,
    pub confirm_label: String,
    pub deny_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseBoolean.ts")]
pub enum ChooseBooleanOutput {
    Decision { value: bool },
}
