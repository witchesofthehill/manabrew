use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/helpPayAssist.ts")]
pub struct HelpPayAssistInput {
    pub card_name: String,
    pub max_generic: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/helpPayAssist.ts")]
pub enum HelpPayAssistOutput {
    AssistDecision { amount_to_pay: u32 },
}
