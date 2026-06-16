use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/payCostToPreventEffect.ts")]
pub struct PayCostToPreventEffectInput {
    pub description: String,
    pub cost_kind: String,
    pub api: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/payCostToPreventEffect.ts")]
pub enum PayCostToPreventEffectOutput {
    PayCostToPreventEffectDecision { accept: bool },
}
