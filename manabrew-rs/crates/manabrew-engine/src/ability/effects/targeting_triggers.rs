//! `BecomesTarget` / `BecomesTargetOnce` trigger emission.
//!
//! Mirrors the call sites of `TriggerHandler.runTrigger(BecomesTarget, ...)`
//! in Java's `SpellAbility.resolve` and copy-of-spell paths.

use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::CardId;
use crate::spellability::SpellAbility;
use crate::trigger::handler::TriggerHandler;
use crate::trigger::TriggerType;

use super::effect_context::EffectContext;

pub(crate) fn emit_targeting_triggers(
    ctx: &mut EffectContext,
    card_id: CardId,
    trigger_sa: &SpellAbility,
) {
    emit_targeting_triggers_for_sa(ctx.trigger_handler, ctx.game, card_id, trigger_sa);
}

pub(crate) fn emit_targeting_triggers_for_sa(
    trigger_handler: &mut TriggerHandler,
    game: &mut GameState,
    card_id: CardId,
    trigger_sa: &SpellAbility,
) {
    let controller = trigger_sa.activating_player;

    // Per-target `BecomesTarget` firings (Java MagicStack.java:510,
    // SpellAbilityStackInstance.java:165).
    for target_id in trigger_sa.target_chosen.all_target_cards() {
        let first_time = !game.card(target_id).has_become_target_this_turn();
        game.card_mut(target_id).add_target_from_this_turn();
        let params = RunParams {
            card: Some(target_id),
            target_card: Some(target_id),
            cards: Some(vec![target_id]),
            cause_player: Some(controller),
            cause_card: Some(card_id),
            source_sa: Some(trigger_sa.clone()),
            first_time: Some(first_time),
            ..Default::default()
        };
        trigger_handler.run_trigger(TriggerType::BecomesTarget, params, false);
    }

    for target_player in trigger_sa.target_chosen.all_target_players() {
        let params = RunParams {
            player: Some(target_player),
            target_player: Some(target_player),
            cause_player: Some(controller),
            cause_card: Some(card_id),
            source_sa: Some(trigger_sa.clone()),
            ..Default::default()
        };
        trigger_handler.run_trigger(TriggerType::BecomesTarget, params, false);
    }

    // `BecomesTargetOnce` fires exactly once per SA regardless of target count
    // (Java MagicStack.java:517, SpellAbilityStackInstance.java:173). Skip when
    // the SA had no targets.
    let has_any_target = !trigger_sa.target_chosen.all_target_cards().is_empty()
        || !trigger_sa.target_chosen.all_target_players().is_empty();
    if has_any_target {
        let params = RunParams {
            cause_player: Some(controller),
            cause_card: Some(card_id),
            source_sa: Some(trigger_sa.clone()),
            ..Default::default()
        };
        trigger_handler.run_trigger(TriggerType::BecomesTargetOnce, params, false);
    }
}
