//! Incubate effect — create Incubator artifact token with +1/+1 counters.
//!
//! Ported from Java's `IncubateEffect.java`.
//! Incubate N: Create an Incubator token with N +1/+1 counters on it.
//! (It's a transforming double-faced token. Pay {2}: Transform it.
//! It becomes a 0/0 Phyrexian artifact creature.)

use super::token_effect_base::{TokenEffectBase, TOKEN_EFFECT_BASE};
use super::{parse_counter_type, EffectContext};
use crate::card::card_zone_table::CardZoneTable;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `IncubateEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(IncubateEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(0);
    let times = super::resolve_numeric_svar(ctx.game, sa, "Times", 1).max(0) as usize;
    let controller = sa.activating_player;

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    for &pid in &players {
        for _ in 0..times {
            let mut token = TOKEN_EFFECT_BASE
                .require_token_template(ctx.token_templates, "incubator_c_0_0_a_phyrexian");
            if amount > 0 {
                let ct = parse_counter_type("P1P1");
                token.add_counter(&ct, amount);
            }
            let token_table = TOKEN_EFFECT_BASE.make_token_table_internal(pid, token, 1);
            let mut trigger_list = CardZoneTable::default();
            let result =
                TOKEN_EFFECT_BASE.make_token_table(ctx, token_table, false, &mut trigger_list, sa);
            if !result.created.is_empty() {
                trigger_list.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(sa));
            }
        }
    }
}
