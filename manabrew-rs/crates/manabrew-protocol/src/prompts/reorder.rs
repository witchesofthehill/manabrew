use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::CardDto;
use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/reorder.ts")]
pub struct ReorderItem {
    pub id: String,
    pub card: CardDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub oracle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/reorder.ts")]
pub struct ReorderInput {
    pub presentation: PromptPresentation,
    pub items: Vec<ReorderItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/reorder.ts")]
pub enum ReorderOutput {
    ReorderDecision { ordered_ids: Vec<String> },
}
