use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, EffectContext};

/// `SP$ ControlGainVariant` — complex control redistribution.
///
/// Mirrors Java's `ControlGainVariantEffect.java`.
///
/// # Params
/// - `ChangeController` — mode: "CardOwner", "Random", etc.
/// - `AllValid` — filter for which permanents are affected
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ControlGainVariantEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ControlGainVariantEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let mode = sa
        .ir
        .change_type
        .clone()
        .unwrap_or_else(|| "CardOwner".to_string());

    let filter = sa
        .ir
        .all_valid_text
        .clone()
        .unwrap_or_else(|| "Permanent".to_string());
    let filter_selector = sa.ir.all_valid_selector.clone();

    // Collect all matching permanents on the battlefield
    let matching: Vec<crate::ids::CardId> = {
        let mut result = Vec::new();
        for &pid in &ctx.game.player_order.clone() {
            let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            for cid in zone_cards {
                if matches_valid_cards_for_sa(
                    ctx.game,
                    sa,
                    ctx.game.card(cid),
                    filter_selector.as_ref(),
                    &filter,
                ) {
                    result.push(cid);
                }
            }
        }
        result
    };

    match mode.as_str() {
        "CardOwner" => {
            // Homeward Path: return each permanent to its owner's control
            for cid in matching {
                let owner = ctx.game.card(cid).owner;
                if ctx.game.card(cid).can_be_controlled_by(owner) {
                    ctx.game.change_controller(cid, owner);
                }
            }
        }
        "Random" => {
            // Scrambleverse: assign each permanent to a random player
            let alive = ctx.game.alive_players();
            if alive.is_empty() {
                return;
            }
            for cid in matching {
                let random_idx = ctx.rng.next_int(alive.len() as i32) as usize;
                let new_controller = alive[random_idx];
                if ctx.game.card(cid).can_be_controlled_by(new_controller) {
                    ctx.game.change_controller(cid, new_controller);
                }
            }
        }
        _ => {
            // Other modes (multiplayer-specific) are logged and skipped
            eprintln!("[ControlGainVariant] Unimplemented mode: {}", mode);
        }
    }
}
