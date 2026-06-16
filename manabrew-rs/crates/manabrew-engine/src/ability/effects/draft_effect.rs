//! Draft — draft a card from a spellbook (Conspiracy/Arena).
//! Ported from Java's DraftEffect: picks cards from a spellbook list,
//! presents 3 random options, player chooses one, it goes to hand.

use super::EffectContext;
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DraftEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DraftEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };
    let controller = sa.activating_player;

    // Get spellbook names
    let spellbook = match sa.ir.spellbook_text.as_deref() {
        Some(sb) => sb
            .split(',')
            .map(|s| s.trim().replace(';', ","))
            .collect::<Vec<_>>(),
        None => return,
    };

    let num_to_draft = super::resolve_numeric_svar(ctx.game, sa, "DraftNum", 1).max(1) as usize;

    for _ in 0..num_to_draft {
        if spellbook.is_empty() {
            break;
        }
        // In full implementation: present 3 random options from spellbook to player
        // For now, auto-select first option (agent would choose)
        let chosen_name =
            &spellbook[ctx.rng.next_int(spellbook.len() as i32) as usize % spellbook.len()];

        // Remember the drafted card name on source
        if sa.param_is_true(keys::REMEMBER_DRAFTED) {
            ctx.game
                .card_mut(source)
                .set_s_var("DraftedCard", chosen_name.clone());
        }
    }
    let _ = controller; // used in full impl for zone changes
}
