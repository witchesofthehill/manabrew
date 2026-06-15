use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/exploreDecision.ts")]
pub struct ExploreDecisionInput {
    pub revealed_card_name: String,
    pub revealed_card: Option<CardDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/exploreDecision.ts")]
pub enum ExploreDecisionOutput {
    ExploreResponse { put_in_graveyard: bool },
}
