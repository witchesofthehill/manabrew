//! Add mana to pool as a cost. Mirrors Java's `CostAddMana`.

use forge_foundation::mana::ManaAtom;

use crate::ids::{CardId, PlayerId};
use crate::mana::{Mana, ManaPool};

/// Pay by adding mana to the player's pool.
/// Mirrors Java's `CostAddMana.payAsDecided()`.
pub fn pay_as_decided(
    pool: &mut ManaPool,
    source: CardId,
    _player: PlayerId,
    amount: i32,
    mana_type: &str,
) -> bool {
    let atom = match mana_type.to_uppercase().as_str() {
        "W" | "WHITE" => ManaAtom::WHITE,
        "U" | "BLUE" => ManaAtom::BLUE,
        "B" | "BLACK" => ManaAtom::BLACK,
        "R" | "RED" => ManaAtom::RED,
        "G" | "GREEN" => ManaAtom::GREEN,
        "C" | "COLORLESS" => ManaAtom::COLORLESS,
        _ => ManaAtom::COLORLESS,
    };
    for _ in 0..amount {
        let mut m = Mana::simple(atom);
        m.source_card = Some(source);
        pool.add_mana(m);
    }
    true
}

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    _game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    _source: crate::ids::CardId,
    _player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    true
}

pub fn pay_with_decision(
    _game: &mut crate::game::GameState,
    _player: PlayerId,
    _source: CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    true
}
