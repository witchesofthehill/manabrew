//! UnlockDoor — unlock a door on a Room card.
//! Ported from Java's UnlockDoorEffect: unlocks one side of a Room
//! enchantment, activating its abilities.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::event::RunParams;
use crate::ids::CardId;
use crate::spellability::SpellAbilityMode;
use crate::trigger::TriggerType;

fn unlocked_room_count(ctx: &EffectContext, card_id: CardId) -> i32 {
    let card = ctx.game.card(card_id);
    // Check explicit counter first.
    if let Some(count) = card
        .svars
        .get("UnlockedRoomCount")
        .and_then(|v| v.parse::<i32>().ok())
    {
        return count;
    }
    // A Room on the battlefield always has at least its first door unlocked
    // (the door it was cast as).  The first door unlock happens implicitly at
    // ETB without going through unlock_door_effect::resolve(), so
    // UnlockedRoomCount is never set to 1.  Infer count=1 for Room cards on
    // the battlefield.
    if card.zone == ZoneType::Battlefield && card.type_line.has_subtype("Room") {
        return 1;
    }
    0
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `UnlockDoorEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(UnlockDoorEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let targets: Vec<CardId> = if let Some(target) = sa.target_chosen.target_card {
        vec![target]
    } else if let Some(source) = sa.source {
        vec![source]
    } else {
        return;
    };

    let mode = sa.ir.mode.as_ref().unwrap_or(&SpellAbilityMode::ThisDoor);

    for card_id in targets {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }

        let before = unlocked_room_count(ctx, card_id);
        let mut after = before;
        let mut unlocked = false;
        match mode {
            SpellAbilityMode::ThisDoor => {
                ctx.game.card_mut(card_id).set_s_var("DoorUnlocked", "True");
                if before < 2 {
                    after = before + 1;
                    unlocked = true;
                }
            }
            SpellAbilityMode::Unlock => {
                ctx.game.card_mut(card_id).set_s_var("DoorUnlocked", "True");
                if before < 2 {
                    after = before + 1;
                    unlocked = true;
                }
            }
            SpellAbilityMode::LockOrUnlock => {
                let is_locked = ctx
                    .game
                    .card(card_id)
                    .svars
                    .get("DoorUnlocked")
                    .is_none_or(|v| v != "True");
                if is_locked {
                    ctx.game.card_mut(card_id).set_s_var("DoorUnlocked", "True");
                    if before < 2 {
                        after = before + 1;
                        unlocked = true;
                    }
                } else {
                    ctx.game.card_mut(card_id).remove_s_var("DoorUnlocked");
                    after = before.saturating_sub(1);
                }
            }
            _ => {}
        }

        if after != before {
            ctx.game
                .card_mut(card_id)
                .set_s_var("UnlockedRoomCount", after.to_string());
        }

        if unlocked {
            ctx.trigger_handler.run_trigger(
                TriggerType::UnlockDoor,
                RunParams {
                    card: Some(card_id),
                    player: Some(sa.activating_player),
                    card_state_name: sa.ir.card_state_name.clone(),
                    ..Default::default()
                },
                true,
            );
            if before < 2 && after >= 2 {
                // When both doors are unlocked, update the card name to the
                // full combined name (e.g. "Walk-In Closet // Forgotten Cellar").
                // Mirrors Java's Card.updateRooms() setting state to Original.
                let full = ctx.game.card(card_id).full_name.clone();
                ctx.game.card_mut(card_id).card_name = full;

                ctx.trigger_handler.run_trigger(
                    TriggerType::FullyUnlock,
                    RunParams {
                        card: Some(card_id),
                        player: Some(sa.activating_player),
                        ..Default::default()
                    },
                    true,
                );
            }
        }
    }
}
