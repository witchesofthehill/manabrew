use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::{CardDto, ZoneKind};
use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/reveal.ts")]
pub struct RevealCardsInput {
    pub presentation: PromptPresentation,
    pub cards: Vec<CardDto>,
    pub zone: ZoneKind,
    pub owner_player_id: String,
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
