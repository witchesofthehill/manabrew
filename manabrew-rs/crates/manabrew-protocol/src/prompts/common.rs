use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::TargetingIntent;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct PromptPresentation {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_card_id: Option<String>,
    #[serde(default)]
    pub targets: Vec<TargetRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct PlayOptionDto {
    pub card_id: String,
    pub mode: String,
    pub mode_label: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "prompts/common.ts")]
pub enum ManaColor {
    #[serde(rename = "W")]
    White,
    #[serde(rename = "U")]
    Blue,
    #[serde(rename = "B")]
    Black,
    #[serde(rename = "R")]
    Red,
    #[serde(rename = "G")]
    Green,
    #[serde(rename = "C")]
    Colorless,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct Mana {
    pub color: ManaColor,
    pub amount: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct ActivatableAbilityInfo {
    pub card_id: String,
    pub ability_index: usize,
    pub description: String,
    pub is_mana_ability: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cost: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub produced_mana: Option<Vec<Mana>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/common.ts")]
pub enum AvailableActionKind {
    Cast {
        card_id: String,
        mode: String,
        mode_label: String,
    },
    ActivateAbility(ActivatableAbilityInfo),
    UndoMana {
        card_id: String,
    },
    Delve {
        card_id: String,
    },
    Undelve {
        card_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "prompts/common.ts")]
pub struct AvailableAction {
    pub id: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub kind: AvailableActionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub enum AttackTargetKind {
    Player,
    Planeswalker,
    Battle,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct AttackTargetDto {
    pub id: String,
    pub label: String,
    pub kind: AttackTargetKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct BlockAssignment {
    pub blocker_id: String,
    pub attacker_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct AttackAssignment {
    pub attacker_id: String,
    pub target_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct CombatDamageAssignmentEntry {
    pub assignee_id: String,
    pub damage: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/common.ts")]
pub enum TargetAnyChoice {
    Player { player_id: String },
    Card { card_id: String },
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub enum TargetKind {
    Player,
    Card,
    Spell,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct TargetRef {
    pub kind: TargetKind,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub intent: Option<TargetingIntent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub oracle: Option<String>,
}

impl TargetRef {
    pub fn card(id: String) -> Self {
        Self {
            kind: TargetKind::Card,
            id,
            intent: None,
            oracle: None,
        }
    }

    pub fn player(id: String) -> Self {
        Self {
            kind: TargetKind::Player,
            id,
            intent: None,
            oracle: None,
        }
    }

    pub fn spell(id: String) -> Self {
        Self {
            kind: TargetKind::Spell,
            id,
            intent: None,
            oracle: None,
        }
    }
}
