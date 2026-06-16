//! Sacrifice permanents as a cost. Mirrors Java's `CostSacrifice`.
//!
//! Java's `CostSacrifice` extends `CostPartWithList` and uses `doListPayment()`
//! to call `game.getAction().sacrifice()`. The LKI/card tracking lists are
//! managed by the `CostPartWithList` base class.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

/// Execute the sacrifice cost payment.
/// Mirrors Java's `CostSacrifice.doListPayment()` → `game.getAction().sacrifice()`.
///
/// For "CARDNAME" sacrifice, moves the source to graveyard.
/// For typed sacrifice, the caller must have already selected cards via the agent.
///
/// NOTE: Trigger firing (Sacrificed) must be handled by the caller since it
/// requires access to the trigger handler.
pub fn pay_as_decided_self(game: &mut GameState, source: CardId, player: PlayerId) -> bool {
    let owner = game.card(source).owner;
    game.move_card(source, ZoneType::Graveyard, owner);
    let _ = player;
    // TODO: Fire Sacrificed trigger — currently done by caller in game_action.rs
    true
}

/// Execute typed sacrifice (non-self).
/// Cards to sacrifice are passed in as `cards` (already selected by agent).
/// Mirrors Java's `CostSacrifice.doListPayment()`.
pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId], _player: PlayerId) -> bool {
    for &cid in cards {
        let owner = game.card(cid).owner;
        game.move_card(cid, ZoneType::Graveyard, owner);
        // TODO: Fire Sacrificed trigger per card
    }
    true
}

/// Hash keys for LKI/card tracking lists.
/// Mirrors Java's `CostSacrifice.getHashForLKIList()` / `getHashForCardList()`.
pub const HASH_LKI: &str = "Sacrificed";
pub const HASH_CARDS: &str = "SacrificedCards";

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::Sacrifice {
        type_filter,
        amount,
    } = part
    else {
        return false;
    };
    let card = game.card(source);
    if type_filter == "CARDNAME" {
        if card.zone != ZoneType::Battlefield {
            return false;
        }
        return !crate::staticability::static_ability_cant_sacrifice::cant_sacrifice(
            &super::static_ability_source_cards(game),
            card,
            ability,
            true,
        );
    }
    if type_filter.eq_ignore_ascii_case("All") {
        let targets = super::get_sacrifice_targets_for_cost(game, player, type_filter, ability);
        return !targets.is_empty();
    }
    let valid =
        super::get_sacrifice_targets_for_cost(game, player, type_filter, ability).len() as i32;
    valid >= amount.resolve(game, source, player)
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: CardId,
    part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::Sacrifice { type_filter, .. } = part else {
        return false;
    };
    if type_filter == "CARDNAME" || type_filter == "NICKNAME" {
        return pay_as_decided_self(game, source, player);
    }
    if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
        return pay_as_decided_cards(game, cards, player);
    }
    false
}
