use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/mulliganPutBack.ts")]
pub struct MulliganPutBackInput {
    pub hand_card_ids: Vec<String>,
    pub cards: Vec<CardDto>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/mulliganPutBack.ts")]
pub enum MulliganPutBackOutput {
    MulliganPutBackDecision { card_ids: Vec<String> },
}
