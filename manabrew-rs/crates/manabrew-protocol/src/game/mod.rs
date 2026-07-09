use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::TargetRef;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "game/index.ts")]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub struct Mana {
    pub color: ManaColor,
    pub amount: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub enum PlayerCounterKind {
    Poison,
    Energy,
    Experience,
    Radiation,
    Ticket,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub enum ZoneKind {
    Battlefield,
    Hand,
    Library,
    Graveyard,
    Exile,
    Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub enum StepKind {
    #[default]
    Untap,
    Upkeep,
    Draw,
    Main1,
    CombatBegin,
    CombatDeclareAttackers,
    CombatDeclareBlockers,
    CombatFirstStrikeDamage,
    CombatDamage,
    CombatEnd,
    Main2,
    EndOfTurn,
    Cleanup,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "visibility",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "game/index.ts")]
pub enum CardView {
    Visible(CardDto),
    Hidden { id: String },
}

/// One entry per (zone, owner) pair; battlefield cards are bucketed by controller.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub struct ZoneDto {
    pub zone: ZoneKind,
    pub owner_id: String,
    /// Ordered top-first where order is public knowledge; zones whose bulk is
    /// hidden from the recipient (library) elide those entries, so
    /// `count >= cards.len()`.
    pub cards: Vec<CardView>,
    pub count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub struct GameViewDto {
    pub game_id: String,
    pub turn: u32,
    pub step: StepKind,
    pub combat_assignments: Vec<CombatAssignmentDto>,
    pub active_player_id: String,
    pub priority_player_id: String,
    pub players: Vec<PlayerDto>,
    pub zones: Vec<ZoneDto>,
    pub stack: Vec<StackObjectDto>,
    pub game_over: bool,
    pub winner_id: Option<String>,
    pub monarch_id: Option<String>,
    pub initiative_holder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub struct CombatAssignmentDto {
    pub blocker_id: String,
    pub attacker_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub enum PlayerStatus {
    #[default]
    Playing,
    Lost,
    Conceded,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub struct PlayerDto {
    pub id: String,
    pub name: String,
    pub status: PlayerStatus,
    pub is_human: bool,
    pub life: i32,
    pub counters: BTreeMap<PlayerCounterKind, u32>,
    pub mana_pool: BTreeMap<ManaColor, u32>,
    #[ts(type = "Record<string, number>")]
    pub commander_damage: HashMap<String, i32>,
    pub has_city_blessing: bool,
    pub ring_level: i32,
    pub speed: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "game/index.ts")]
pub struct CardIdentity {
    pub name: String,
    pub set_code: String,
    pub card_number: String,
    pub is_token: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "game/index.ts")]
pub struct CardDto {
    pub id: String,
    pub identity: CardIdentity,
    pub color: String,
    pub mana_cost: String,
    pub cmc: i32,
    pub types: Vec<String>,
    pub subtypes: Vec<String>,
    pub supertypes: Vec<String>,
    pub power: Option<String>,
    pub toughness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub base_power: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub base_toughness: Option<i32>,
    pub text: String,
    pub controller_id: String,
    pub owner_id: String,
    pub tapped: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_crewed: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_attacking: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attacking_player_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attack_target_id: Option<String>,
    pub keywords: Vec<String>,
    /// Keyed by the engine's canonical `CounterType` display form ("P1P1",
    /// "Loyalty", one-off counter names uppercase); both producers must match it.
    #[ts(type = "Record<string, number>")]
    pub counters: BTreeMap<String, u32>,
    pub damage: i32,
    pub summoning_sick: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_copy: bool,
    pub is_double_faced: bool,
    pub is_transformed: bool,
    pub is_face_down: bool,
    pub is_bestowed: bool,
    pub phased_out: bool,
    pub exerted: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_ring_bearer: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attached_to: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachment_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub flashback_cost: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kicker_cost: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effective_mana_cost: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub madness_cost: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_madness_exiled: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_plotted: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_warp_exiled: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub foil: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub would_die_in_combat: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "game/index.ts")]
pub struct StackObjectDto {
    pub id: String,
    pub source_id: String,
    pub controller_id: String,
    pub identity: CardIdentity,
    pub text: String,
    pub is_permanent_spell: bool,
    pub is_casting: bool,
    pub targets: Vec<TargetRef>,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, strum_macros::Display,
)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub enum TargetingIntent {
    #[default]
    Damage,
    Destroy,
    Sacrifice,
    Exile,
    Bounce,
    Mill,
    Discard,
    Counter,
    Tap,
    Untap,
    Copy,
    Buff,
    Debuff,
    Heal,
    LoseLife,
    Reveal,
    Draw,
    GainControl,
    Fight,
    Attach,
    Attack,
    Block,
    Hostile,
    Friendly,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "game/index.ts")]
pub struct PlaymatSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub opacity: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub texture: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub border_width: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub border_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offset_x: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offset_y: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub zoom: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub blur: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub brightness: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
}
