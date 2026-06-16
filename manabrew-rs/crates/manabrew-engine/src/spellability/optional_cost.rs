//! Optional additional costs for spells.
//!
//! Mirrors Java's `OptionalCost.java` enum — represents additional costs
//! that may be paid when casting a spell.

use serde::{Deserialize, Serialize};

/// Optional additional costs for spells.
/// Mirrors Java's `OptionalCost.java` enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OptionalCost {
    /// First kicker cost was paid.
    Kicker1,
    /// Second kicker cost was paid (for cards with two kicker costs).
    Kicker2,
    /// Buyback cost was paid (return spell to hand on resolution).
    Buyback,
    /// Entwine cost was paid (choose all modes).
    Entwine,
    /// Bargain — sacrifice an artifact, enchantment, or token.
    Bargain,
    /// Promise of a gift — offer a card to an opponent.
    PromiseGift,
    /// Retrace — cast from graveyard by discarding a land.
    Retrace,
    /// Jumpstart — cast from graveyard by discarding a card.
    Jumpstart,
    /// Offering — sacrifice a creature of the specified type.
    Offering,
    /// Reduce white mana in cost.
    ReduceW,
    /// Reduce blue mana in cost.
    ReduceU,
    /// Reduce black mana in cost.
    ReduceB,
    /// Reduce red mana in cost.
    ReduceR,
    /// Reduce green mana in cost.
    ReduceG,
    /// Generic alternative cost.
    AltCost,
    /// Flash — cast at instant speed.
    Flash,
    /// Generic optional cost.
    Generic,
}

impl OptionalCost {
    /// Human-readable name for this optional cost.
    /// Mirrors Java's `OptionalCost.getName()`.
    pub fn name(&self) -> &str {
        match self {
            OptionalCost::Kicker1 => "Kicker",
            OptionalCost::Kicker2 => "Kicker 2",
            OptionalCost::Buyback => "Buyback",
            OptionalCost::Entwine => "Entwine",
            OptionalCost::Bargain => "Bargain",
            OptionalCost::PromiseGift => "Promise of a Gift",
            OptionalCost::Retrace => "Retrace",
            OptionalCost::Jumpstart => "Jumpstart",
            OptionalCost::Offering => "Offering",
            OptionalCost::ReduceW => "Reduce W",
            OptionalCost::ReduceU => "Reduce U",
            OptionalCost::ReduceB => "Reduce B",
            OptionalCost::ReduceR => "Reduce R",
            OptionalCost::ReduceG => "Reduce G",
            OptionalCost::AltCost => "Alternative Cost",
            OptionalCost::Flash => "Flash",
            OptionalCost::Generic => "Generic",
        }
    }

    /// Mana pip abbreviation for this cost (used for display).
    /// Mirrors Java's `OptionalCost.getPip()`.
    pub fn pip(&self) -> &str {
        match self {
            OptionalCost::Kicker1 => "K",
            OptionalCost::Kicker2 => "K2",
            OptionalCost::Buyback => "BB",
            OptionalCost::Entwine => "EN",
            OptionalCost::Bargain => "BG",
            OptionalCost::PromiseGift => "PG",
            OptionalCost::Retrace => "RT",
            OptionalCost::Jumpstart => "JS",
            OptionalCost::Offering => "OF",
            OptionalCost::ReduceW => "W",
            OptionalCost::ReduceU => "U",
            OptionalCost::ReduceB => "B",
            OptionalCost::ReduceR => "R",
            OptionalCost::ReduceG => "G",
            OptionalCost::AltCost => "AC",
            OptionalCost::Flash => "FL",
            OptionalCost::Generic => "GN",
        }
    }
}
