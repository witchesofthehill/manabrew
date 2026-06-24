use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::CardDto;
use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/reorderCards.ts")]
pub struct ReorderCardsInput {
    pub presentation: PromptPresentation,
    pub cards: Vec<CardDto>,
    pub target_label: String,
    pub top_of_deck: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/reorderCards.ts")]
pub enum ReorderCardsOutput {
    ReorderDecision { ordered_card_ids: Vec<String> },
}
