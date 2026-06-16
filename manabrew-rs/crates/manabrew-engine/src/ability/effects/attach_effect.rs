use forge_foundation::ZoneType;

use super::EffectContext;
use crate::agent::types::GameEntity;
use crate::player::player_controller::PlayerController;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;

/// SP$ Attach / AB$ Attach — attach source Equipment/Aura to target creature.
///
/// Mirrors Java's `AttachEffect.resolve()`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AttachEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AttachEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Source is the card being attached (the Equipment or Aura)
    let aura_id = match sa.source {
        Some(s) => s,
        None => return,
    };
    let chooser = sa
        .chooser()
        .and_then(|defined| {
            crate::ability::ability_utils::resolve_defined_players_with_sa(
                defined,
                sa,
                sa.activating_player,
                ctx.game,
            )
            .into_iter()
            .next()
        })
        .unwrap_or(sa.activating_player);

    let mut candidates: Vec<GameEntity> = Vec::new();
    if let Some(target_card) = sa.target_chosen.target_card {
        candidates.push(GameEntity::Card(target_card));
    }
    if let Some(target_player) = sa.target_chosen.target_player {
        candidates.push(GameEntity::Player(target_player));
    }
    if candidates.is_empty() {
        if let Some(defined) = sa.defined() {
            candidates.extend(
                crate::ability::ability_utils::get_defined_cards(
                    ctx.game,
                    Some(aura_id),
                    defined,
                    Some(sa.activating_player),
                )
                .into_iter()
                .map(GameEntity::Card),
            );
            candidates.extend(
                crate::ability::ability_utils::resolve_defined_players_with_sa(
                    defined,
                    sa,
                    sa.activating_player,
                    ctx.game,
                )
                .into_iter()
                .map(GameEntity::Player),
            );
        }
    }
    if candidates.is_empty() {
        return;
    }
    let chosen = {
        let agent = ctx.agents[chooser.index()].as_mut();
        let mut controller = PlayerController::new(ctx.game, chooser, agent);
        controller.snapshot_state(ctx.mana_pools);
        controller.choose_single_entity_for_effect(&candidates)
    };
    let chosen = match chosen {
        Some(chosen) => chosen,
        None => return,
    };
    let target = match chosen {
        GameEntity::Card(c) => c,
        GameEntity::Player(_) => return,
    };

    // Both must be on the battlefield
    if ctx.game.card(aura_id).zone != ZoneType::Battlefield
        || ctx.game.card(target).zone != ZoneType::Battlefield
    {
        return;
    }
    if crate::staticability::static_ability_cant_attach::cant_attach(
        &ctx.game.cards,
        ctx.game.card(aura_id),
        ctx.game.card(target),
        false,
    ) {
        return;
    }

    // Run Attached replacement effects before attaching.
    let mut event = ReplacementEvent::Attached {
        card: aura_id,
        target,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    ctx.game.attach_to(aura_id, target);

    // Fire Attached trigger
    ctx.trigger_handler.run_trigger(
        crate::trigger::TriggerType::Attached,
        crate::event::RunParams {
            card: Some(aura_id),
            ..Default::default()
        },
        false,
    );
}
