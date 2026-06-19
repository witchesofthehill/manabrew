use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::ManaSourceAction;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub enum AvailableActionKind {
    Cast {
        card_id: String,
        mode: String,
        mode_label: String,
    },
    ActivateAbility {
        card_id: String,
        ability_index: usize,
        description: String,
        is_mana_ability: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        produced_mana: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        cost: Option<String>,
    },
    UndoMana {
        card_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub struct AvailableAction {
    pub id: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub kind: AvailableActionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub struct ChooseActionInput {
    pub actions: Vec<AvailableAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub enum ChooseActionDecision {
    Pass {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        until_phase: Option<String>,
    },
    Concede,
    RestoreSnapshot {
        #[ts(type = "number")]
        checkpoint_id: u64,
    },
    Act {
        action_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "prompts/chooseAction.ts")]
pub enum ChooseActionOutput {
    ChooseActionDecision(ChooseActionDecision),
    ManaSourceAction(ManaSourceAction),
}
