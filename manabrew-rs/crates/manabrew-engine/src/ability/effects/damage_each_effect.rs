use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, resolve_numeric_svar, EffectContext};
use crate::card::card_damage_map::DamageTarget;
use crate::ids::CardId;

/// `SP$ EachDamage` — each matching creature/player deals damage.
///
/// Mirrors Java's `DamageEachEffect.java`.
/// - `ValidCards$` — which creatures deal damage.
/// - `NumDmg$` — how much damage each deals (default: power of the creature).
/// - `DefinedPlayers$` — if set, damage is dealt to matching players.
///
/// # Card script examples
/// ```text
/// A:SP$ EachDamage | ValidCards$ Creature.YouCtrl | NumDmg$ X
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DamageEachEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DamageEachEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let use_damage_map = ctx.game.pending_damage_map.is_some() || sa.ir.damage_map;
    if sa.ir.damage_map {
        ctx.game.ensure_pending_damage_maps();
    }

    let valid_cards = sa.ir.valid_cards_selector.as_ref();
    let fixed_dmg = sa
        .ir
        .num_dmg_present
        .then(|| {
            let v = resolve_numeric_svar(ctx.game, sa, "NumDmg", -1);
            if v == -1 {
                None
            } else {
                Some(v)
            }
        })
        .flatten();

    let player_ids = ctx.game.player_order.clone();
    let mut damagers: Vec<CardId> = Vec::new();

    for &pid in &player_ids {
        let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(ctx.game, sa, ctx.game.card(cid), valid_cards, "Creature")
            {
                damagers.push(cid);
            }
        }
    }

    // Determine damage target: opponent by default
    let target_player = sa
        .target_chosen
        .target_player
        .unwrap_or_else(|| ctx.game.opponent_of(sa.activating_player));

    for card_id in damagers {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }
        let dmg = fixed_dmg.unwrap_or_else(|| ctx.game.card(card_id).power().max(0));
        if dmg <= 0 {
            continue;
        }

        if use_damage_map {
            if let Some(map) = ctx.game.pending_damage_map.as_mut() {
                map.put(card_id, DamageTarget::Player(target_player), dmg);
            }
        } else {
            // Deal damage to the target player
            let dealt = ctx.game.deal_damage_to_player(target_player, dmg);
            ctx.game.record_player_damage_assignment(
                Some(card_id),
                Some(target_player),
                dealt,
                false,
            );

            ctx.trigger_handler.run_trigger(
                crate::trigger::TriggerType::DamageDone,
                crate::event::RunParams {
                    damage_source: Some(card_id),
                    damage_target_player: Some(target_player),
                    damage_amount: Some(dmg),
                    is_combat_damage: Some(false),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
