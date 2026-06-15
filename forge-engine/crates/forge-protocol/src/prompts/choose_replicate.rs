use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseReplicate.ts")]
pub struct ChooseReplicateInput {
    pub cost: String,
    pub max_replicates: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseReplicate.ts")]
pub enum ChooseReplicateOutput {
    ReplicateDecision { replicate_count: u32 },
}
