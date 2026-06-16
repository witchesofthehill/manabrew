use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::values::CardDto;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseEnlistAttackers.ts")]
pub struct ChooseEnlistAttackersInput {
    pub attacker_ids: Vec<String>,
    pub attacker_cards: Vec<CardDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseEnlistAttackers.ts")]
pub enum ChooseEnlistAttackersOutput {
    EnlistDecision { chosen_attacker_ids: Vec<String> },
}
