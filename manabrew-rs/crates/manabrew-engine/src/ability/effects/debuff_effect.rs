//! Debuff — reduce stats permanently (digital-only).

use super::EffectContext;
use crate::ability::ability_ir::DebuffAllSuffixKeywords;
use crate::ability::spell_ability_effect::get_target_cards;
use crate::keyword::keyword_instance::Keyword;
use crate::parsing::keys;
use crate::spellability::AbilityDuration;

/// End-of-turn revert for debuff. Mirrors the `GameCommand.run()` in Java
/// `DebuffEffect` that restores the original P/T when the effect expires.
///
/// Reverses the debuff by adding back the debuff amount to power/toughness modifiers.
pub fn run(game: &mut crate::game::GameState, card_id: crate::ids::CardId, amount: i32) {
    if game.card(card_id).zone == forge_foundation::ZoneType::Battlefield {
        game.card_mut(card_id).power_modifier += amount;
        game.card_mut(card_id).toughness_modifier += amount;
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DebuffEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DebuffEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = if sa.ir.debuff.num_present {
        super::resolve_numeric_svar(ctx.game, sa, keys::NUM, 0).max(0)
    } else {
        0
    };
    let permanent = matches!(sa.ir.duration, Some(AbilityDuration::Permanent));
    let targets = debuff_targets(ctx, sa);
    for target in targets {
        if amount > 0 {
            ctx.game.card_mut(target).power_modifier -= amount;
            ctx.game.card_mut(target).toughness_modifier -= amount;
        }

        let mut removed_keywords = sa.ir.debuff.keywords.clone();
        if matches!(
            sa.ir.debuff.all_suffix_keywords,
            Some(DebuffAllSuffixKeywords::Walk)
        ) {
            removed_keywords.extend(landwalk_keywords(ctx, target));
        }

        for kw in removed_keywords {
            if permanent {
                ctx.game.card_mut(target).remove_intrinsic_keyword(&kw);
            } else {
                ctx.game.card_mut(target).add_cant_have_keyword(&kw);
            }
        }
    }
}

fn debuff_targets(
    ctx: &EffectContext,
    sa: &crate::spellability::SpellAbility,
) -> Vec<crate::ids::CardId> {
    get_target_cards(ctx.game, sa)
}

fn landwalk_keywords(ctx: &EffectContext, target: crate::ids::CardId) -> Vec<String> {
    let card = ctx.game.card(target);
    card.keywords
        .get_values_for(Keyword::Landwalk)
        .into_iter()
        .chain(card.granted_keywords.get_values_for(Keyword::Landwalk))
        .chain(card.pump_keywords.get_values_for(Keyword::Landwalk))
        .map(|kw| kw.original.clone())
        .collect()
}
