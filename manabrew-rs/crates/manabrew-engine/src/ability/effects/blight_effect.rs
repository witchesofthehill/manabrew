use forge_foundation::ZoneType;

use super::EffectContext;
use crate::agent::GameEntity;
use crate::card::CounterType;
use crate::game_entity_counter_table::GameEntityCounterTable;

#[manabrew_engine_macros::spell_effect(BlightEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Num", 1);
    let players = if !sa.target_chosen.all_target_players().is_empty() {
        sa.target_chosen.all_target_players()
    } else {
        sa.ir
            .defined_text
            .as_deref()
            .map(|defined| {
                crate::ability::ability_utils::resolve_defined_players_with_sa(
                    defined,
                    sa,
                    sa.activating_player,
                    ctx.game,
                )
            })
            .unwrap_or_else(|| vec![sa.activating_player])
    };
    let mut table = GameEntityCounterTable::default();
    for player in players {
        let valid: Vec<_> = ctx
            .game
            .cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .copied()
            .filter(|card| {
                ctx.game.card(*card).is_creature()
                    && !ctx.game.card(*card).phased_out
                    && !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                        &ctx.game.cards,
                        ctx.game.card(*card),
                        &CounterType::M1M1,
                    )
            })
            .collect();
        let chosen = ctx.agents[player.index()]
            .choose_cards_for_effect(player, &valid, 1, 1)
            .into_iter()
            .next();
        if let Some(card) = chosen {
            table.put(
                Some(player),
                GameEntity::Card(card),
                CounterType::M1M1,
                amount,
            );
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
}
