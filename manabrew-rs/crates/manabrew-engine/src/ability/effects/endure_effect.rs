//! Endure — creature endures: either put +1/+1 counters on it, or create
//! a Spirit token with power/toughness equal to the endure amount.
//! Ported from Java's EndureEffect.

use forge_foundation::ZoneType;

use super::token_effect_base::{TokenEffectBase, TOKEN_EFFECT_BASE};
use super::EffectContext;
use crate::card::card_zone_table::CardZoneTable;
use crate::ids::CardId;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `EndureEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(EndureEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0);
    if amount < 1 {
        return; // CR 701.63b
    }

    let targets: Vec<CardId> = if let Some(target) = sa.target_chosen.target_card {
        vec![target]
    } else if let Some(source) = sa.source {
        ctx.game.card(source).remembered_cards.clone()
    } else {
        return;
    };

    let mut token_table = super::token_effect_base::TokenCreateTable::default();
    for card_id in targets {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }

        let counter_type = super::parse_counter_type("P1P1");
        if crate::card::card_predicates::can_receive_counters(ctx.game, card_id, &counter_type) {
            // Rust agents do not expose Java's Endure confirm prompt yet; preserve
            // the current auto-counter behavior when the target can receive counters.
            ctx.game
                .card_mut(card_id)
                .add_counter(&counter_type, amount);
        } else {
            let controller = ctx.game.card(card_id).controller;
            let mut token =
                TOKEN_EFFECT_BASE.require_token_template(ctx.token_templates, "w_x_x_spirit");
            token.set_base_power(Some(amount));
            token.set_base_toughness(Some(amount));
            token_table.put(controller, token, 1);
        }
    }

    if !token_table.is_empty() {
        let mut trigger_list = CardZoneTable::default();
        let result =
            TOKEN_EFFECT_BASE.make_token_table(ctx, token_table, false, &mut trigger_list, sa);
        if !result.created.is_empty() {
            trigger_list.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(sa));
        }
    }
}
