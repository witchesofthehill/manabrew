use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/reveal.ts")]
pub struct RevealCardsInput {
    pub cards: Vec<CardDto>,
    pub zone: String,
    pub owner_player_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/reveal.ts")]
pub enum RevealCardsOutput {
    RevealCardsAcknowledged,
}
