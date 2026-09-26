use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::PromptPresentation;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseFromSelection.ts")]
pub struct SelectionOption {
    pub label: String,
    pub weight: usize,
    pub can_repeat: bool,
    // what taking this option costs on top of the base cost (optional costs)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cost: Option<String>,
    // whether the deciding player can pay the base cost plus this one right now
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub affordable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseFromSelection.ts")]
pub struct ChooseFromSelectionInput {
    pub presentation: PromptPresentation,
    pub options: Vec<SelectionOption>,
    pub min_total: usize,
    pub max_total: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<SelectionKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseFromSelection.ts")]
pub enum SelectionKind {
    Mode,
    OptionalCost,
    Ability,
    Number,
    Type,
    CounterType,
    CardState,
    Colors,
    Pile,
    ReplacementEffect,
    StackTarget,
    Entity,
    Player,
    Vote,
    Shield,
    StartingHand,
    Dice,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseFromSelection.ts")]
pub enum ChooseFromSelectionOutput {
    SelectionDecision { chosen_indices: Vec<usize> },
}
