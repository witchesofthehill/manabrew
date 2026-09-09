use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/planarDieRolled.ts")]
pub enum PlanarDieFace {
    Planeswalk,
    Chaos,
    Blank,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/planarDieRolled.ts")]
pub struct PlanarDieRollEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub player_id: Option<String>,
    pub results: Vec<PlanarDieFace>,
    pub ignored_results: Vec<PlanarDieFace>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/planarDieRolled.ts")]
pub struct PlanarDieRolledInput {
    pub presentation: PromptPresentation,
    pub rolls: Vec<PlanarDieRollEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_card_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_card_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/planarDieRolled.ts")]
pub enum PlanarDieRolledOutput {
    PlanarDieRolledAcknowledged,
}
