use forge_foundation::{CardStateName, ZoneType};

use super::EffectContext;
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbilityMode;
use crate::trigger::{TriggerHandler, TriggerType};

pub fn unlock_room(
    game: &mut GameState,
    triggers: &mut TriggerHandler,
    card_id: CardId,
    player: PlayerId,
    door: CardStateName,
) -> bool {
    triggers.flush_waiting_triggers(game);
    if !game.card_mut(card_id).unlock_room(door) {
        return false;
    }
    crate::staticability::layer::apply_continuous_effects(game);
    triggers.unregister_active_triggers(card_id);
    triggers.register_active_trigger(game, card_id);
    triggers.run_trigger(
        TriggerType::UnlockDoor,
        RunParams {
            card: Some(card_id),
            player: Some(player),
            card_state_name: Some(format!("{door:?}")),
            ..Default::default()
        },
        true,
    );
    if game.card(card_id).unlocked_doors.len() == 2 {
        triggers.run_trigger(
            TriggerType::FullyUnlock,
            RunParams {
                card: Some(card_id),
                player: Some(player),
                ..Default::default()
            },
            true,
        );
    }
    triggers.flush_waiting_triggers(game);
    true
}

pub fn lock_room(
    game: &mut GameState,
    triggers: &mut TriggerHandler,
    card_id: CardId,
    door: CardStateName,
) -> bool {
    triggers.flush_waiting_triggers(game);
    if !game.card_mut(card_id).lock_room(door) {
        return false;
    }
    crate::staticability::layer::apply_continuous_effects(game);
    triggers.unregister_active_triggers(card_id);
    triggers.register_active_trigger(game, card_id);
    true
}

#[manabrew_engine_macros::spell_effect(UnlockDoorEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let player = sa.activating_player;
    let targets = if let Some(filter) = sa.ir.choices.as_deref() {
        let choices: Vec<_> = ctx
            .game
            .cards
            .iter()
            .filter(|card| {
                card.zone == ZoneType::Battlefield
                    && super::matches_valid_cards_for_sa(
                        ctx.game,
                        sa,
                        card,
                        sa.ir.choices_selector.as_ref(),
                        filter,
                    )
            })
            .map(|card| crate::agent::GameEntity::Card(card.id))
            .collect();
        if choices.is_empty() {
            return;
        }
        ctx.agents[player.index()].snapshot_state(ctx.game, ctx.mana_pools);
        match ctx.agents[player.index()].choose_single_entity_for_effect(player, &choices, false) {
            Some(crate::agent::GameEntity::Card(card)) => vec![card],
            _ => return,
        }
    } else {
        crate::ability::spell_ability_effect::get_defined_cards_or_targeted(ctx.game, sa)
    };
    let mode = sa.ir.mode.as_ref().unwrap_or(&SpellAbilityMode::ThisDoor);
    for card_id in targets {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield || !ctx.game.card(card_id).is_room()
        {
            continue;
        }
        let door = if mode == &SpellAbilityMode::ThisDoor {
            sa.ir
                .card_state_name
                .as_deref()
                .and_then(CardStateName::from_str_compat)
        } else {
            let doors: Vec<_> = [CardStateName::LeftSplit, CardStateName::RightSplit]
                .into_iter()
                .filter(|door| {
                    mode == &SpellAbilityMode::LockOrUnlock
                        || !ctx.game.card(card_id).is_door_unlocked(*door)
                })
                .collect();
            if doors.is_empty() {
                continue;
            }
            let descriptions: Vec<_> = doors
                .iter()
                .map(|door| {
                    let action = if ctx.game.card(card_id).is_door_unlocked(*door) {
                        "Lock"
                    } else {
                        "Unlock"
                    };
                    format!(
                        "{action} {}",
                        ctx.game.card(card_id).room_face(*door).unwrap().name
                    )
                })
                .collect();
            ctx.agents[player.index()].snapshot_state(ctx.game, ctx.mana_pools);
            ctx.agents[player.index()]
                .choose_mode(player, &descriptions, 1, 1, Some(card_id))
                .first()
                .and_then(|index| doors.get(*index))
                .copied()
        };
        let Some(door) = door else { continue };
        match mode {
            SpellAbilityMode::ThisDoor | SpellAbilityMode::Unlock => {
                unlock_room(ctx.game, ctx.trigger_handler, card_id, player, door);
            }
            SpellAbilityMode::LockOrUnlock => {
                if ctx.game.card(card_id).is_door_unlocked(door) {
                    lock_room(ctx.game, ctx.trigger_handler, card_id, door);
                } else {
                    unlock_room(ctx.game, ctx.trigger_handler, card_id, player, door);
                }
            }
            _ => {}
        }
    }
}
