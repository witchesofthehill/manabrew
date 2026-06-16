//! Canonical stored perpetual-effect records on `Card`.

use forge_foundation::{ColorSet, ManaCost};
use serde::{Deserialize, Serialize};

use crate::card::card_trait_changes::CardTraitChanges;
use crate::card::Card;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PerpetualRecord {
    PtBoost {
        timestamp: i64,
        power: i32,
        toughness: i32,
    },
    NewPt {
        timestamp: i64,
        power: Option<i32>,
        toughness: Option<i32>,
    },
    Types {
        timestamp: i64,
        add_types: Vec<String>,
    },
    Colors {
        timestamp: i64,
        colors: ColorSet,
        overwrite: bool,
    },
    Keywords {
        timestamp: i64,
        add_keywords: Vec<String>,
        remove_keywords: Vec<String>,
        remove_all: bool,
    },
    ManaCost {
        timestamp: i64,
        mana_cost: ManaCost,
    },
    Incorporate {
        timestamp: i64,
        incorporate: ManaCost,
    },
    Abilities {
        timestamp: i64,
        changes: CardTraitChanges,
    },
}

impl PerpetualRecord {
    pub fn timestamp(&self) -> i64 {
        match self {
            Self::PtBoost { timestamp, .. }
            | Self::NewPt { timestamp, .. }
            | Self::Types { timestamp, .. }
            | Self::Colors { timestamp, .. }
            | Self::Keywords { timestamp, .. }
            | Self::ManaCost { timestamp, .. }
            | Self::Incorporate { timestamp, .. }
            | Self::Abilities { timestamp, .. } => *timestamp,
        }
    }

    /// Apply the effect payload to card state without storing the record again.
    pub fn apply_effect(&self, card: &mut Card) {
        match self {
            Self::PtBoost {
                power, toughness, ..
            } => {
                card.perpetual_power_modifier += *power;
                card.perpetual_toughness_modifier += *toughness;
            }
            Self::NewPt {
                power, toughness, ..
            } => {
                if let Some(p) = power {
                    card.base_power = Some(*p);
                }
                if let Some(t) = toughness {
                    card.base_toughness = Some(*t);
                }
            }
            Self::Types { add_types, .. } => {
                for ty in add_types {
                    card.add_type(ty);
                }
            }
            Self::Colors {
                colors, overwrite, ..
            } => {
                if *overwrite {
                    card.color = *colors;
                } else {
                    card.add_color(*colors);
                }
            }
            Self::Keywords {
                add_keywords,
                remove_keywords,
                remove_all,
                ..
            } => {
                if *remove_all {
                    card.clear_changed_card_keywords();
                }
                for kw in remove_keywords {
                    card.remove_changed_card_keywords(kw);
                }
                for kw in add_keywords {
                    card.add_changed_card_keywords(kw);
                }
            }
            Self::ManaCost { mana_cost, .. } => {
                card.add_changed_mana_cost(&mana_cost.to_string());
            }
            Self::Incorporate { incorporate, .. } => {
                card.add_changed_mana_cost(&incorporate.to_string());
                card.add_color(incorporate.color_set());
            }
            Self::Abilities {
                timestamp, changes, ..
            } => {
                card.add_changed_card_traits(changes.clone(), *timestamp, 0);
                if changes.contains_cost_change() {
                    card.calculate_perpetual_adjusted_mana_cost();
                }
            }
        }
    }
}
