//! Replacement effect event types.
//!
//! Mirrors Java `ReplacementType.java` in `forge/game/replacement/`.
//! Each variant corresponds to an `Event$ <Value>` entry in card scripts.

use serde::{Deserialize, Serialize};
use strum_macros::EnumString;

use crate::parsing::{keys, Params};

use super::replacement_effect::{parse_zone_list, ReplacementEffect, ReplacementLayer};

/// The type of game event a replacement effect intercepts. Mirrors Java
/// `ReplacementType` enum. `EnumString` derives a case-insensitive
/// `FromStr` that maps `"<VariantName>"` (any case) to the variant.
/// `#[strum(default)]` on `Other` makes unknown values fall through
/// instead of erroring.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, EnumString)]
#[strum(ascii_case_insensitive)]
pub enum ReplacementType {
    AddCounter,
    AssembleContraption,
    AssignDealDamage,
    Attached,
    BeginPhase,
    BeginTurn,
    Cascade,
    Counter,
    CopySpell,
    CreateToken,
    DamageDone,
    DealtDamage,
    DeclareBlocker,
    Destroy,
    Draw,
    DrawCards,
    Explore,
    GainLife,
    GameLoss,
    GameWin,
    Learn,
    LifeReduced,
    LoseMana,
    Mill,
    Moved,
    PayLife,
    PlanarDiceResult,
    Planeswalk,
    ProduceMana,
    Proliferate,
    RemoveCounter,
    RollDice,
    RollPlanarDice,
    Scry,
    SetInMotion,
    Tap,
    Transform,
    TurnFaceUp,
    Untap,
    #[strum(default)]
    Other(String),
}

impl ReplacementType {
    pub fn smart_value_of(value: &str) -> Self {
        value.trim().parse().expect("Other variant catches all")
    }

    pub fn create_replacement(event: &ReplacementType, params: &Params) -> ReplacementEffect {
        let layer = params
            .get(keys::LAYER)
            .and_then(ReplacementLayer::smart_value_of)
            .unwrap_or(ReplacementLayer::Other);
        let active_zones = params
            .get(keys::ACTIVE_ZONES)
            .map(parse_zone_list)
            .unwrap_or_default();
        ReplacementEffect::new(event.clone(), layer, params.clone(), active_zones)
    }
}
