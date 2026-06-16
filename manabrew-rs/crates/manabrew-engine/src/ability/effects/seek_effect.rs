//! Seek effect — randomly find cards matching criteria from library.
//!
//! Ported 1:1 from Java's `SeekEffect.java`.
//! Seek N [Type]: Randomly select N cards matching [Type] from your library
//! and put them into your hand. (Arena digital mechanic — no player choice.)

use forge_foundation::ZoneType;

use super::{emit_zone_trigger, matches_change_type, EffectContext};
use crate::ids::CardId;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SeekEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SeekEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let seek_num = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0) as usize;
    if seek_num == 0 {
        return;
    }

    // Parse seek types — can be comma-separated
    let types_str = sa.ir.types_text.as_deref().unwrap_or("Card").to_string();
    let seek_types: Vec<&str> = types_str.split(',').map(str::trim).collect();

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    for pid in players {
        let mut sought: Vec<CardId> = Vec::new();

        for seek_type in &seek_types {
            // Get library cards matching the type
            let pool: Vec<CardId> = ctx
                .game
                .cards_in_zone(ZoneType::Library, pid)
                .to_vec()
                .into_iter()
                .filter(|&cid| {
                    if *seek_type == "Card" {
                        true
                    } else {
                        matches_change_type(ctx.game.card(cid), seek_type, &[])
                    }
                })
                .collect();

            if pool.is_empty() {
                continue;
            }

            // Randomly select up to seek_num cards
            let mut shuffled = pool;
            ctx.rng.shuffle_cards(&mut shuffled);
            let selected: Vec<CardId> = shuffled.into_iter().take(seek_num).collect();

            // Move each to hand
            for card_id in selected {
                let old_zone = ctx.game.card(card_id).zone;
                ctx.move_card(card_id, ZoneType::Hand, pid);
                emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, ZoneType::Hand);
                sought.push(card_id);
            }
        }

        // RememberFound$ / ImprintFound$
        if !sought.is_empty() {
            if sa.ir.remember_found {
                if let Some(sid) = sa.source {
                    for &cid in &sought {
                        ctx.game.card_mut(sid).add_remembered_card(cid);
                    }
                }
            }
            if sa.ir.imprint_found {
                if let Some(sid) = sa.source {
                    for &cid in &sought {
                        ctx.game.card_mut(sid).add_imprinted_card(cid);
                    }
                }
            }
        }
    }
}
