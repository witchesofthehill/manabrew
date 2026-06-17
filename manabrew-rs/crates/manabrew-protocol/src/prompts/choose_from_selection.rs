use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseFromSelection.ts")]
pub struct ChooseFromSelectionInput {
    pub presentation: PromptPresentation,
    pub options: Vec<String>,
    pub min_choices: usize,
    pub max_choices: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseFromSelection.ts")]
pub enum ChooseFromSelectionOutput {
    SelectionDecision { chosen_indices: Vec<usize> },
}
