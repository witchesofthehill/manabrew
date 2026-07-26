use forge_foundation::ZoneType;

use super::EffectContext;
use crate::agent::GameEntity;
use crate::game_entity_counter_table::GameEntityCounterTable;
use crate::replacement::replacement_handler::{apply_replacements_with_agents, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::trigger::TriggerType;

#[manabrew_engine_macros::spell_effect(CountersProliferateEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let mut event = ReplacementEvent::Proliferate {
        player: controller,
        count: super::resolve_numeric_svar(ctx.game, sa, "Amount", 1),
    };
    let result = apply_replacements_with_agents(ctx.game, ctx.agents, &mut event);
    if !matches!(
        result,
        ReplacementResult::NotReplaced | ReplacementResult::Updated
    ) {
        return;
    }
    let ReplacementEvent::Proliferate { count, .. } = event else {
        return;
    };

    for _ in 0..count {
        let mut candidates = Vec::new();
        for &player in &ctx.game.player_order {
            let entity = GameEntity::Player(player);
            if !GameEntityCounterTable::counters(ctx.game, entity).is_empty() {
                candidates.push(entity);
            }
        }
        for card in ctx.game.cards_in_all_zones(ZoneType::Battlefield) {
            let entity = GameEntity::Card(card);
            if !GameEntityCounterTable::counters(ctx.game, entity).is_empty() {
                candidates.push(entity);
            }
        }

        let chosen = ctx.agents[controller.index()].choose_entities_for_effect(
            controller,
            &candidates,
            0,
            candidates.len(),
        );
        let mut table = GameEntityCounterTable::default();
        for entity in chosen {
            for (counter_type, _) in GameEntityCounterTable::counters(ctx.game, entity) {
                table.put(Some(controller), entity, counter_type, 1);
            }
        }
        table.replace_counter_effect(
            ctx.game,
            Some(ctx.trigger_handler),
            Some(ctx.agents),
            Some(sa),
            true,
            Default::default(),
        );
        ctx.trigger_handler.run_trigger(
            TriggerType::Proliferate,
            crate::event::RunParams {
                player: Some(controller),
                ..Default::default()
            },
            false,
        );
    }
}
