//! Helpers for mana-part parity with Java `CostPartMana`.

use forge_foundation::ManaCost;

use crate::game::GameState;
use crate::ids::CardId;
use crate::mana::mana_cost_being_paid::ManaCostBeingPaid;

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

/// Java `CostPartMana.shouldPayLast()` returns `true` when `isExiledCreatureCost`
/// is set — the mana portion depends on knowing the exiled creature's CMC, so it
/// must be paid after the exile cost.
pub fn should_pay_last(part: &super::CostPart) -> bool {
    match part {
        super::CostPart::Mana {
            is_exiled_creature_cost,
            ..
        } => *is_exiled_creature_cost,
        _ => false,
    }
}

pub fn can_pay(
    game: &GameState,
    available_mana: &crate::mana::ManaPool,
    source: CardId,
    _player: crate::ids::PlayerId,
    ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let mana_cost = get_mana_cost_for(game, source, ability, part);
    available_mana.can_pay(&mana_cost)
}

/// Mirrors Java `CostPartMana.payAsDecided(Player, PaymentDecision, SpellAbility, boolean)`.
///
/// In Java, this method saves and restores the player's `ManaConversionMatrix` around
/// the interactive mana payment:
/// ```java
/// ManaConversionMatrix old = new ManaConversionMatrix();
/// old.restoreColorReplacements();
/// old.applyCardMatrix(payer.getManaPool());
/// boolean result = payer.getController().payManaCost(this, sa, null, pd.matrix, effect);
/// payer.getManaPool().restoreColorReplacements();
/// payer.getManaPool().applyCardMatrix(old);
/// ```
///
/// In the Rust architecture, mana pools are managed externally by the game loop (not
/// on `GameState`), so the matrix save/restore is the game loop's responsibility.
/// The `ManaPool.color_matrix` field provides the storage, and the game loop must
/// call `pool.restore_color_replacements()` / `pool.apply_card_matrix(&saved)` around
/// the interactive mana payment call. This function delegates to the core payment logic.
pub fn pay_as_decided(
    game: &mut GameState,
    player: crate::ids::PlayerId,
    source: CardId,
    part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
    is_effect: bool,
) -> bool {
    crate::cost::cost_payment::pay_as_decided(game, player, source, part, decision, is_effect)
}

pub fn pay_with_decision(
    _game: &mut GameState,
    _player: crate::ids::PlayerId,
    _source: CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    true
}

/// Save the current `ManaConversionMatrix` state from a mana pool before mana payment.
/// Returns the saved matrix. Call `restore_matrix_after_payment` after payment completes.
///
/// Mirrors the Java pattern:
/// ```java
/// ManaConversionMatrix old = new ManaConversionMatrix();
/// old.restoreColorReplacements();
/// old.applyCardMatrix(payer.getManaPool());
/// ```
pub fn save_matrix_before_payment(
    pool: &crate::mana::ManaPool,
) -> crate::mana::mana_conversion_matrix::ManaConversionMatrix {
    let mut saved = crate::mana::mana_conversion_matrix::ManaConversionMatrix::new();
    saved.apply_card_matrix(&pool.color_matrix);
    saved
}

/// Restore the `ManaConversionMatrix` state on a mana pool after mana payment.
///
/// Mirrors the Java pattern:
/// ```java
/// payer.getManaPool().restoreColorReplacements();
/// payer.getManaPool().applyCardMatrix(old);
/// ```
pub fn restore_matrix_after_payment(
    pool: &mut crate::mana::ManaPool,
    saved: &crate::mana::mana_conversion_matrix::ManaConversionMatrix,
) {
    pool.restore_color_replacements();
    pool.apply_card_matrix(saved);
}

/// Mirrors Java `CostPartMana.getManaCostFor(SpellAbility)`.
///
/// Modifies the base mana cost depending on:
/// - `isExiledCreatureCost` — adds the exiled creature's mana cost to the base cost
/// - `isEnchantedCreatureCost` — adds the enchanted creature's mana cost
/// - `isCostPayAnyNumberOfTimes` — multiplies the base cost by an SVar-determined count
pub fn get_mana_cost_for(
    game: &GameState,
    source: CardId,
    ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> ManaCost {
    match part {
        super::CostPart::Mana {
            cost,
            is_exiled_creature_cost,
            is_enchanted_creature_cost,
            is_cost_pay_any_number_of_times,
            ..
        } => {
            // isExiledCreatureCost: add the exiled creature's mana cost
            // Java: sa.getPaidList(CostExile.HashLKIListKey, true).get(0).getManaCost()
            if *is_exiled_creature_cost {
                let source_card = game.card(source);
                // Prefer cards exiled as part of this specific cost payment.
                if let Some(&exiled_id) = source_card.paid_cost_exiled_cards.first() {
                    let exiled_card = game.card(exiled_id);
                    let mod_cost = &exiled_card.mana_cost;
                    if mod_cost.is_no_cost() {
                        return mod_cost.clone();
                    }
                    let mut mana_cost_new = ManaCostBeingPaid::from_mana_cost(cost);
                    mana_cost_new.add_mana_cost(mod_cost);
                    return mana_cost_new.to_mana_cost();
                }
                // Fallback to legacy source tracking if no per-payment record exists.
                if let Some(&exiled_id) = source_card.exiled_cards.first() {
                    let exiled_card = game.card(exiled_id);
                    let mod_cost = &exiled_card.mana_cost;
                    if mod_cost.is_no_cost() {
                        return mod_cost.clone();
                    }
                    let mut mana_cost_new = ManaCostBeingPaid::from_mana_cost(cost);
                    mana_cost_new.add_mana_cost(mod_cost);
                    return mana_cost_new.to_mana_cost();
                }
            }

            // isEnchantedCreatureCost: add the enchanted creature's mana cost
            // Java: sa.getHostCard().getEnchantingCard().getManaCost()
            if *is_enchanted_creature_cost {
                let source_card = game.card(source);
                if let Some(enchanted_id) = source_card.attached_to {
                    let enchanted_card = game.card(enchanted_id);
                    let mod_cost = &enchanted_card.mana_cost;
                    if mod_cost.is_no_cost() {
                        return mod_cost.clone();
                    }
                    let mut mana_cost_new = ManaCostBeingPaid::from_mana_cost(cost);
                    mana_cost_new.add_mana_cost(mod_cost);
                    return mana_cost_new.to_mana_cost();
                }
            }

            // isCostPayAnyNumberOfTimes: multiply the base cost by NumTimes SVar
            if *is_cost_pay_any_number_of_times {
                let times_to_pay = ability
                    .map(|sa| crate::svar::resolve_numeric_svar(game, sa, "NumTimes", 0))
                    .unwrap_or_else(|| {
                        game.card(source)
                            .svars
                            .get("NumTimes")
                            .and_then(|s| s.parse::<i32>().ok())
                            .unwrap_or(0)
                    });
                if times_to_pay == 0 {
                    return ManaCost::zero();
                }
                let mut total_mana = ManaCostBeingPaid::from_mana_cost(cost);
                for _ in 1..times_to_pay {
                    total_mana.add_mana_cost(cost);
                }
                return total_mana.to_mana_cost();
            }

            cost.clone()
        }
        _ => ManaCost::zero(),
    }
}

/// Mirrors Java `CostPartMana.getAmountOfX()`.
///
/// Returns the number of `{X}` symbols in the mana cost.
pub fn get_amount_of_x(part: &super::CostPart) -> i32 {
    match part {
        super::CostPart::Mana { cost, .. } => cost.count_x() as i32,
        _ => 0,
    }
}

/// Mirrors Java `CostPartMana.getXMin()`.
pub fn get_x_min(part: &super::CostPart) -> i32 {
    match part {
        super::CostPart::Mana { x_min, .. } => *x_min,
        _ => 0,
    }
}

/// Mirrors Java `CostPartMana.isExiledCreatureCost()`.
pub fn is_exiled_creature_cost(part: &super::CostPart) -> bool {
    match part {
        super::CostPart::Mana {
            is_exiled_creature_cost,
            ..
        } => *is_exiled_creature_cost,
        _ => false,
    }
}

/// Mirrors Java `CostPartMana.isEnchantedCreatureCost()`.
pub fn is_enchanted_creature_cost(part: &super::CostPart) -> bool {
    match part {
        super::CostPart::Mana {
            is_enchanted_creature_cost,
            ..
        } => *is_enchanted_creature_cost,
        _ => false,
    }
}

/// Mirrors Java `CostPartMana.isReusable()` — always true.
pub fn is_reusable() -> bool {
    true
}

/// Mirrors Java `CostPartMana.isUndoable()` — always true.
pub fn is_undoable() -> bool {
    true
}

/// Mirrors Java `CostPartMana.getMaxWaterbend()`.
pub fn get_max_waterbend(part: &super::CostPart) -> Option<&str> {
    match part {
        super::CostPart::Mana { max_waterbend, .. } => max_waterbend.as_deref(),
        _ => None,
    }
}

/// Mirrors Java `CostPartMana.setMaxWaterbend(String)`.
pub fn set_max_waterbend(part: &mut super::CostPart, max: Option<String>) {
    if let super::CostPart::Mana { max_waterbend, .. } = part {
        *max_waterbend = max;
    }
}

/// Mirrors Java `CostPartMana.getMana()`.
pub fn get_mana(part: &super::CostPart) -> Option<&ManaCost> {
    match part {
        super::CostPart::Mana { cost, .. } => Some(cost),
        _ => None,
    }
}
