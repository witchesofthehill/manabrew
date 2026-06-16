//! Unattach equipment as a cost. Mirrors Java's `CostUnattach`.

use crate::cost::matches_type_filter;
use crate::game::GameState;
use crate::ids::CardId;
use crate::spellability::SpellAbility;

/// Mirrors Java's `CostUnattach.toString()`.
/// Produces "Unattach <type description>".
pub fn to_string(part: &super::CostPart) -> String {
    let desc = match part {
        super::CostPart::Unattach {
            description: Some(d),
            ..
        } => d.clone(),
        super::CostPart::Unattach { type_filter, .. } => type_filter.clone(),
        _ => "equipment".to_string(),
    };
    format!("Unattach {}", desc)
}

/// Pay by detaching the target card from whatever it's attached to.
/// Mirrors Java's `CostUnattach.doPayment(Player, SpellAbility, Card targetCard, boolean)`.
///
/// In Java, `doPayment` calls `targetCard.unattachFromEntity(targetCard.getEntityAttachedTo())`.
/// The `target_card` parameter is the equipment to unattach (which may or may not be the source).
pub fn pay_as_decided(game: &mut GameState, target_card: CardId) -> bool {
    game.detach(target_card);
    true
}

pub const HASH_LKI: &str = "Unattached";
pub const HASH_CARDS: &str = "UnattachedCards";

/// Mirrors Java's `CostUnattach.findCardToUnattach(Card source, Player activator, SpellAbility)`.
///
/// Determines which equipment(s) can be unattached to pay this cost:
/// - If `payCostFromSource()` (type is "CARDNAME"/"NICKNAME"): the source itself, if equipping.
/// - If type is "OriginalHost": the ability's original host equipment, if equipping.
/// - Otherwise: all equipment currently attached to the source, filtered by type.
pub fn find_card_to_unattach(
    game: &GameState,
    source: CardId,
    type_filter: &str,
    ability: Option<&SpellAbility>,
) -> Vec<CardId> {
    let mut attachees = Vec::new();

    if type_filter == "CARDNAME" || type_filter == "NICKNAME" {
        // Source is the equipment itself -- check if it's equipping something.
        // Java: payCostFromSource() -> source.isEquipping()
        let card = game.card(source);
        if card.attached_to.is_some() {
            attachees.push(source);
        }
    } else if type_filter == "OriginalHost" {
        // Java: Card originalEquipment = ability.getOriginalHost();
        // Prefer SpellAbility.original_host; fallback to effect_source for legacy callers.
        let original_host = ability
            .and_then(|sa| sa.original_host)
            .or_else(|| {
                ability
                    .and_then(|sa| sa.source)
                    .and_then(|sa_source| game.card(sa_source).effect_source)
            })
            .unwrap_or(source);
        let card = game.card(original_host);
        if card.attached_to.is_some() {
            attachees.push(original_host);
        }
    } else {
        // Source is the equipped creature -- find equipment attached to it matching the filter.
        // Java: attachees.addAll(source.getEquippedBy());
        //       if (!getType().contains("X") || ability.getXManaCostPaid() != null)
        //           attachees = CardLists.getValidCards(attachees, type, activator, source, ability);
        let card = game.card(source);
        let all_attachments: Vec<CardId> = card.attachments.clone();

        // Check X cost: if the type contains "X", only filter if X has been paid.
        // Java gates on `ability.getXManaCostPaid() != null`.
        // Rust stores x as `u32` and also mirrors paid X to source SVars (`XPaid`),
        // so treat either signal as "X is established for this ability".
        let should_filter = if type_filter.contains('X') {
            let x_paid_from_sa = ability.map(|sa| sa.x_mana_cost_paid > 0).unwrap_or(false);
            let x_paid_from_svar = game.card(source).svars.contains_key("XPaid");
            x_paid_from_sa || x_paid_from_svar
        } else {
            true
        };

        if should_filter {
            for &equip_id in &all_attachments {
                if matches_type_filter(game, equip_id, type_filter) {
                    attachees.push(equip_id);
                }
            }
        } else {
            attachees = all_attachments;
        }
    }

    attachees
}

/// Mirrors Java's `CostUnattach.canPay(SpellAbility, Player, boolean)`.
/// Delegates to `find_card_to_unattach` and returns true if non-empty.
pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    _player: crate::ids::PlayerId,
    ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::Unattach { type_filter, .. } = part else {
        return false;
    };
    !find_card_to_unattach(game, source, type_filter, ability).is_empty()
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    source: CardId,
    _part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let target = if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
        cards.first().copied().unwrap_or(source)
    } else {
        source
    };
    pay_as_decided(game, target)
}
