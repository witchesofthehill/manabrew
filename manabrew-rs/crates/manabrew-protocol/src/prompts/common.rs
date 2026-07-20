use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::{CardIdentity, Mana, TargetingIntent};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub struct SourceCard {
    pub engine_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lookup: Option<CardIdentity>,
}

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
    #[serde(default)]
    pub targets: Vec<TargetRef>,
}

/// Mirrors the engine's `AlternativeCost` (itself a mirror of Java's).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub enum AlternativeCostKind {
    Flashback,
    Spectacle,
    Evoke,
    Dash,
    Blitz,
    Escape,
    Overload,
    Madness,
    Foretell,
    Emerge,
    Suspend,
    Morph,
    Megamorph,
    Bestow,
    Warp,
    SacrificeAlt,
    Plot,
    Awaken,
    Disturb,
    Harmonize,
    Freerunning,
    Impending,
    Mayhem,
    #[serde(rename = "moreThanMeetsTheEye")]
    MTMtE,
    Mutate,
    Prowl,
    Sneak,
    Surge,
    WebSlinging,
    Plotted,
}

/// Mirrors the engine's `PlayCardMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/common.ts")]
pub enum PlayCardMode {
    Normal,
    BackFaceLand,
    RoomRightSplit,
    Alternative { cost: AlternativeCostKind },
    StaticAlternative,
    ForetellExile,
    UnlockDoor,
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
        mode: PlayCardMode,
        label: String,
    },
    ActivateAbility(ActivatableAbilityInfo),
    UndoMana {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/common.ts")]
pub enum PaymentResourceKind {
    Convoke,
    Improvise,
    Delve,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/common.ts")]
pub enum PaymentActionKind {
    ActivateManaAbility(ActivatableAbilityInfo),
    UndoMana {
        card_id: String,
    },
    UseResource {
        card_id: String,
        resource: PaymentResourceKind,
    },
    ReleaseResource {
        card_id: String,
        resource: PaymentResourceKind,
    },
    PayLife {
        amount: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "prompts/common.ts")]
pub struct PaymentAction {
    pub id: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub kind: PaymentActionKind,
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
