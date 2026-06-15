use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

fn default_top_of_deck() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/reorderLibrary.ts")]
pub struct ReorderLibraryInput {
    pub card_ids: Vec<String>,
    pub cards: Vec<CardDto>,
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default = "default_top_of_deck")]
    pub top_of_deck: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/reorderLibrary.ts")]
pub enum ReorderLibraryOutput {
    ReorderLibraryDecision { ordered_card_ids: Vec<String> },
}
