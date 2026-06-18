use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;
use crate::values::CardDto;

/// A drop zone. Label, icon, and whether order matters are all derived from
/// this on the UI side (library top/bottom are ordered; the rest aren't).
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
    /// Per-zone ordered card ids, parallel to the input `zones`. Within each
    /// zone the last id is the card placed on top of that pile.
    ScryDecision { zone_card_ids: Vec<Vec<String>> },
}
