use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::CardDto;
use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/scry.ts")]
pub enum ScryDestination {
    LibraryTop,
    LibraryBottom,
    Graveyard,
    Exile,
    Hand,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/scry.ts")]
pub struct ScryInput {
    pub presentation: PromptPresentation,
    pub cards: Vec<CardDto>,
    pub zones: Vec<ScryDestination>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/scry.ts")]
pub enum ScryOutput {
    ScryDecision { zone_card_ids: Vec<Vec<String>> },
}
