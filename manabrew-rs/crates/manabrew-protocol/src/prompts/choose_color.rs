use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseColor.ts")]
pub struct ChooseColorInput {
    pub presentation: PromptPresentation,
    pub valid_colors: Vec<String>,
    pub amount: u32,
    pub repeat_allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseColor.ts")]
pub enum ChooseColorOutput {
    ColorDecision {
        chosen_colors: BTreeMap<String, u32>,
    },
}
