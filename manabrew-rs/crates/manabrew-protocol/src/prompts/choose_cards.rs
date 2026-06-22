use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::CardDto;
use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseCards.ts")]
pub struct ChooseCardsInput {
    pub presentation: PromptPresentation,
    pub cards: Vec<CardDto>,
    pub min: usize,
    pub max: usize,
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
