use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, resolve_numeric_svar, EffectContext};
use crate::agent::GameEntity;
use crate::card::CounterType;
use crate::game_entity_counter_table::GameEntityCounterTable;
use crate::ids::CardId;

/// `SP$ PutCounterAll` — put counters on all matching permanents.
///
/// Mirrors Java's `CountersPutAllEffect.java`.
/// - `CounterType$` — type of counter (default P1P1).
/// - `CounterNum$` — number of counters to add (default 1).
/// - `ValidCards$` — filter for which cards receive counters.
/// - `ValidZone$` — zone to search (default Battlefield).
///
/// # Card script examples
/// ```text
/// A:SP$ PutCounterAll | CounterType$ P1P1 | CounterNum$ 1 | ValidCards$ Creature.YouCtrl
/// A:SP$ PutCounterAll | CounterType$ CHARGE | CounterNum$ 2 | ValidCards$ Artifact
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersPutAllEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersPutAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let counter_type = sa.ir.counter_type.clone().unwrap_or(CounterType::P1P1);
    let count = resolve_numeric_svar(ctx.game, sa, "CounterNum", 1);
    if count == 0 {
        return;
    }

    let valid_cards = sa.ir.valid_cards_selector.as_ref();
    let zone = sa.ir.valid_zone.unwrap_or(ZoneType::Battlefield);

    let player_ids = ctx.game.player_order.clone();
    let mut targets: Vec<CardId> = Vec::new();

    for &pid in &player_ids {
        let zone_cards = ctx.game.cards_in_zone(zone, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(ctx.game, sa, ctx.game.card(cid), valid_cards, "Creature")
            {
                targets.push(cid);
            }
        }
    }

    let placer = sa.activating_player;
    let mut table = GameEntityCounterTable::default();
    for card_id in targets {
        if ctx.game.card(card_id).zone == zone {
            if crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                &ctx.game.cards,
                ctx.game.card(card_id),
                &counter_type,
            ) {
                continue;
            }
            table.put(
                Some(placer),
                GameEntity::Card(card_id),
                counter_type.clone(),
                count,
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
