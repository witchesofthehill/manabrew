use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseBuyback.ts")]
pub struct ChooseBuybackInput {
    pub buyback_cost: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseBuyback.ts")]
pub enum ChooseBuybackOutput {
    BuybackDecision { buyback_paid: bool },
}
