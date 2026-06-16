//! RunChaos — run the chaos ability of the current plane card.
//! Ported from Java's RunChaosEffect: finds ChaosEnsues triggers on
//! target plane cards and fires them.

use super::EffectContext;
use crate::event::RunParams;
use crate::ids::CardId;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RunChaosEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RunChaosEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Fire ChaosEnsues trigger for target cards
    let targets: Vec<CardId> = if let Some(target) = sa.target_chosen.target_card {
        vec![target]
    } else if let Some(source) = sa.source {
        ctx.game.card(source).remembered_cards.clone()
    } else {
        return;
    };

    for card_id in targets {
        ctx.trigger_handler.run_trigger(
            TriggerType::ChaosEnsues,
            RunParams {
                card: Some(card_id),
                player: Some(sa.activating_player),
                ..Default::default()
            },
            false,
        );
    }
}
