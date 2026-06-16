//! Exile cards as a cost. Mirrors Java's `CostExile`.
//!
//! Covers ExileFromHand, ExileFromGrave, ExileFromTop, ExileSameGrave,
//! and ExileFromBattlefield variants. Java uses `zoneMode` to distinguish;
//! Rust uses separate CostPart variants for some (ExileFromAnyGrave, ExileFromSameGrave).

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::CardId;

/// Execute exile of self (CARDNAME/OriginalHost).
/// Mirrors Java's `CostExile` doPayment for self-exile.
pub fn pay_as_decided_self(game: &mut GameState, source: CardId) -> bool {
    let owner = game.card(source).owner;
    game.move_card(source, ZoneType::Exile, owner);
    true
}

/// Execute typed exile (non-self).
/// Cards to exile are passed in (already selected by agent).
/// Mirrors Java's `CostExile.doListPayment()`.
pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId]) -> bool {
    for &cid in cards {
        let owner = game.card(cid).owner;
        game.move_card(cid, ZoneType::Exile, owner);
    }
    true
}

/// Hash keys for LKI/card tracking lists.
pub const HASH_LKI: &str = "Exiled";
pub const HASH_CARDS: &str = "ExiledCards";

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
    let card = game.card(source);
    let static_source_cards = super::static_ability_source_cards(game);
    match part {
        super::CostPart::Exile {
            amount,
            type_filter,
            from,
        } => {
            if type_filter == "All" {
                return true;
            }
            if type_filter == "CARDNAME" || type_filter == "OriginalHost" {
                if card.zone != *from {
                    return false;
                }
                return !crate::staticability::static_ability_cant_exile::cant_exile(
                    &static_source_cards,
                    card,
                    ability,
                    true,
                );
            }

            let base_filter = super::normalize_exile_base_filter(type_filter);
            let candidates: Vec<crate::ids::CardId> =
                super::get_zone_targets(game, player, *from, &base_filter)
                    .into_iter()
                    .filter(|&cid| {
                        !crate::staticability::static_ability_cant_exile::cant_exile(
                            &static_source_cards,
                            game.card(cid),
                            ability,
                            true,
                        )
                    })
                    .collect();

            let mut available = candidates.len() as i32;
            if *from == forge_foundation::ZoneType::Hand
                && card.zone == forge_foundation::ZoneType::Hand
                && card.owner == player
                && crate::ability::effects::matches_change_type(card, &base_filter, &[])
            {
                available -= 1;
            }
            if let Some(n) = super::parse_exile_types_ge(type_filter) {
                let mut unique_types = std::collections::BTreeSet::new();
                for cid in &candidates {
                    for t in &game.card(*cid).type_line.core_types {
                        unique_types.insert(format!("{:?}", t));
                    }
                }
                if (unique_types.len() as i32) < n {
                    return false;
                }
            }
            if let Some(expr) = super::parse_exile_total_cmc_eq(type_filter) {
                let target = if expr.eq_ignore_ascii_case("X") {
                    None
                } else {
                    expr.parse::<i32>().ok()
                };
                if let Some(target) = target {
                    let values: Vec<i32> = candidates
                        .iter()
                        .map(|&cid| game.card(cid).mana_cost.cmc())
                        .collect();
                    if !super::cmc_can_sum_to(target, &values) {
                        return false;
                    }
                }
            }
            if let Some(expr) = super::parse_exile_total_cmc_ge(type_filter) {
                let target = if expr.eq_ignore_ascii_case("X") {
                    None
                } else {
                    expr.parse::<i32>().ok()
                };
                if let Some(target) = target {
                    let total: i32 = candidates
                        .iter()
                        .map(|&cid| game.card(cid).mana_cost.cmc())
                        .sum();
                    if total < target {
                        return false;
                    }
                }
            }
            if super::exile_requires_shared_card_type(type_filter) {
                if available < amount.resolve(game, source, player) {
                    return false;
                }
                let mut has_pair = false;
                for &a in &candidates {
                    for &b in &candidates {
                        if a != b && super::shares_card_type(game, a, b) {
                            has_pair = true;
                            break;
                        }
                    }
                    if has_pair {
                        break;
                    }
                }
                if !has_pair {
                    return false;
                }
            }
            available >= amount.resolve(game, source, player)
        }
        super::CostPart::ExileFromAnyGrave {
            amount,
            type_filter,
        } => {
            let base_filter = super::normalize_exile_base_filter(type_filter);
            // TriggeredNewCard refers to the card that just moved to the new
            // zone (e.g. Greenwarden's death trigger exiles Greenwarden from
            // the graveyard). Resolve to the ability's source card directly.
            if base_filter.contains("TriggeredNewCard") {
                let src = game.card(source);
                let is_eligible = src.zone == forge_foundation::ZoneType::Graveyard
                    && !crate::staticability::static_ability_cant_exile::cant_exile(
                        &static_source_cards,
                        src,
                        ability,
                        true,
                    );
                return if is_eligible {
                    amount.resolve(game, source, player) <= 1
                } else {
                    false
                };
            }
            let count = game
                .players
                .iter()
                .flat_map(|p| game.cards_in_zone(forge_foundation::ZoneType::Graveyard, p.id))
                .filter(|&&cid| {
                    (base_filter == "Card"
                        || base_filter.is_empty()
                        || crate::ability::effects::matches_change_type(
                            game.card(cid),
                            &base_filter,
                            &[],
                        ))
                        && !crate::staticability::static_ability_cant_exile::cant_exile(
                            &static_source_cards,
                            game.card(cid),
                            ability,
                            true,
                        )
                })
                .count() as i32;
            count >= amount.resolve(game, source, player)
        }
        super::CostPart::ExileFromSameGrave {
            amount,
            type_filter,
        } => {
            let resolved_amount = amount.resolve(game, source, player);
            let base_filter = super::normalize_exile_base_filter(type_filter);
            let mut by_owner: std::collections::HashMap<crate::ids::PlayerId, i32> =
                std::collections::HashMap::new();
            for p in &game.players {
                for &cid in game.cards_in_zone(forge_foundation::ZoneType::Graveyard, p.id) {
                    if base_filter == "Card"
                        || base_filter.is_empty()
                        || crate::ability::effects::matches_change_type(
                            game.card(cid),
                            &base_filter,
                            &[],
                        )
                    {
                        if crate::staticability::static_ability_cant_exile::cant_exile(
                            &static_source_cards,
                            game.card(cid),
                            ability,
                            true,
                        ) {
                            continue;
                        }
                        let owner = game.card(cid).owner;
                        *by_owner.entry(owner).or_insert(0) += 1;
                    }
                }
            }
            !by_owner.values().all(|&v| v < resolved_amount)
        }
        _ => false,
    }
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    source: CardId,
    part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    match part {
        super::CostPart::Exile { type_filter, .. } => {
            if type_filter == "CARDNAME" || type_filter == "OriginalHost" {
                pay_as_decided_self(game, source)
            } else if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
                pay_as_decided_cards(game, cards)
            } else {
                false
            }
        }
        super::CostPart::ExileFromAnyGrave { .. } | super::CostPart::ExileFromSameGrave { .. } => {
            if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
                pay_as_decided_cards(game, cards)
            } else {
                false
            }
        }
        _ => false,
    }
}

pub fn exile_multi_zone_cost_string(type_filter: &str) -> String {
    type_filter.to_string()
}
