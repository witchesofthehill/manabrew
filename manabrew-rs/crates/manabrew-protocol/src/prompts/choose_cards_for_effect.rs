use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseCardsForEffect.ts")]
pub struct ChooseCardsForEffectInput {
    pub valid_card_ids: Vec<String>,
    pub zone_cards: Vec<CardDto>,
    pub min_choices: usize,
    pub max_choices: usize,
    pub source_card_name: Option<String>,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseCardsForEffect.ts")]
pub enum ChooseCardsForEffectOutput {
    ChooseCardsDecision { chosen_card_ids: Vec<String> },
}
