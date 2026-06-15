use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "values/index.ts")]
pub struct GameViewDto {
    pub game_id: String,
    pub turn: u32,
    pub step: String,
    pub combat_assignments: Vec<CombatAssignmentDto>,
    pub active_player_id: String,
    pub priority_player_id: String,
    pub players: Vec<PlayerDto>,
    pub battlefield: Vec<CardDto>,
    pub stack: Vec<StackObjectDto>,
    pub game_over: bool,
    pub winner_id: Option<String>,
    #[serde(default)]
    pub conceded_player_ids: Vec<String>,
    pub monarch_id: Option<String>,
    pub initiative_holder_id: Option<String>,
}

impl GameViewDto {
    pub fn empty(game_id: String) -> Self {
        Self {
            game_id,
            step: "main1".into(),
            ..Default::default()
        }
    }

    pub fn player(&self, id: &str) -> Option<&PlayerDto> {
        self.players.iter().find(|p| p.id == id)
    }

    pub fn all_zone_cards(&self) -> impl Iterator<Item = &CardDto> {
        self.battlefield
            .iter()
            .chain(self.players.iter().flat_map(|p| {
                p.hand
                    .iter()
                    .chain(p.graveyard.iter())
                    .chain(p.exile.iter())
                    .chain(p.command_zone.iter())
            }))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "values/index.ts")]
pub struct CombatAssignmentDto {
    pub blocker_id: String,
    pub attacker_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "values/index.ts")]
pub struct PlayerDto {
    pub id: String,
    pub name: String,
    pub is_human: bool,
    pub life: i32,
    pub poison: i32,
    pub hand: Vec<CardDto>,
    pub graveyard: Vec<CardDto>,
    pub exile: Vec<CardDto>,
    pub command_zone: Vec<CardDto>,
    pub library_count: usize,
    pub mana_pool: HashMap<String, i32>,
    pub commander_damage: HashMap<String, i32>,
    pub energy_counters: i32,
    pub radiation_counters: i32,
    pub has_city_blessing: bool,
    pub ring_level: i32,
    pub speed: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "values/index.ts")]
pub struct CardDto {
    pub id: String,
    pub name: String,
    pub set_code: String,
    pub card_number: String,
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
    pub is_playable: bool,
    pub is_selected: bool,
    pub controller_id: String,
    pub owner_id: String,
    pub zone_id: String,
    pub tapped: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_crewed: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_attacking: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attacking_player_id: Option<String>,
    pub keywords: Vec<String>,
    pub counters: HashMap<String, i32>,
    pub damage: i32,
    pub summoning_sick: bool,
    pub is_token: bool,
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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "values/index.ts")]
pub struct StackObjectDto {
    pub id: String,
    pub source_id: String,
    pub controller_id: String,
    pub name: String,
    pub text: String,
    pub set_code: String,
    pub card_number: String,
    pub is_permanent_spell: bool,
    pub is_casting: bool,
    pub targets: Vec<StackTargetDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "values/index.ts")]
pub struct StackTargetDto {
    pub kind: StackTargetKindDto,
    pub id: String,
    pub node_index: u32,
    pub target_index: u32,
    pub hostile: bool,
    pub intent: TargetingIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "values/index.ts")]
pub enum StackTargetKindDto {
    Card,
    Player,
    Stack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "values/index.ts")]
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

impl TargetingIntent {
    pub fn prefers_arrow(self) -> bool {
        matches!(self, TargetingIntent::Attack | TargetingIntent::Block)
    }

    pub fn is_hostile(self) -> bool {
        matches!(
            self,
            TargetingIntent::Damage
                | TargetingIntent::Destroy
                | TargetingIntent::Sacrifice
                | TargetingIntent::Exile
                | TargetingIntent::Bounce
                | TargetingIntent::Mill
                | TargetingIntent::Discard
                | TargetingIntent::Counter
                | TargetingIntent::Tap
                | TargetingIntent::Debuff
                | TargetingIntent::LoseLife
                | TargetingIntent::GainControl
                | TargetingIntent::Fight
                | TargetingIntent::Hostile
        )
    }
}
