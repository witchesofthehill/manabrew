//! Reveal cards as a cost. Mirrors Java's `CostReveal`.

// NOTE: pay_as_decided is handled by GameLoop::pay_reveal_cost() in game_action.rs
// because it requires agent interaction for card selection.
// Java's CostReveal.doPayment() calls game.getAction().reveal() which is display-only.

pub const HASH_LKI: &str = "Revealed";
pub const HASH_CARDS: &str = "RevealedCards";

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::Reveal {
        amount,
        type_filter,
        from,
    } = part
    else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    if type_filter == "Hand" {
        return true;
    }
    if type_filter == "CARDNAME" || type_filter == "NICKNAME" {
        let src_zone = game.card(source).zone;
        return match from {
            super::RevealFrom::Hand => src_zone == forge_foundation::ZoneType::Hand,
            super::RevealFrom::Exile => src_zone == forge_foundation::ZoneType::Exile,
            super::RevealFrom::HandOrBattlefield => {
                src_zone == forge_foundation::ZoneType::Hand
                    || src_zone == forge_foundation::ZoneType::Battlefield
            }
            super::RevealFrom::All => true,
        };
    }
    let candidates = super::reveal_candidates(game, player, source, type_filter, from);
    if type_filter == "SameColor" {
        for &cid in &candidates {
            let color = game.card(cid).color;
            let count = candidates
                .iter()
                .filter(|&&other| game.card(other).color.shares_color_with(color))
                .count() as i32;
            if count >= resolved_amount {
                return true;
            }
        }
        return false;
    }
    (candidates.len() as i32) >= resolved_amount
}

pub fn pay_with_decision(
    _game: &mut crate::game::GameState,
    _player: crate::ids::PlayerId,
    _source: crate::ids::CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    true
}
