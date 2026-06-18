use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;
use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseCards.ts")]
pub struct ChooseCardsInput {
    pub presentation: PromptPresentation,
    pub cards: Vec<CardDto>,
    pub min: usize,
    pub max: usize,
    pub target_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub other_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseCards.ts")]
pub enum ChooseCardsOutput {
    ChooseCardsDecision { chosen_card_ids: Vec<String> },
}
