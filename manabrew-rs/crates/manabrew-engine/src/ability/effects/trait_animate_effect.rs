//! AnimateEffectBase — abstract base for animate effects.
//!
//! Mirrors Java's `AnimateEffectBase.java`.
//! Provides shared logic for `AnimateEffect` and `AnimateAllEffect`
//! that handles setting power/toughness, types, colors, and keywords.

use crate::spellability::SpellAbility;

/// Parsed animate parameters from a spell ability.
/// Captures the fields that animate effects need to apply.
#[derive(Debug, Clone, Default)]
pub struct AnimateParams {
    pub power: Option<i32>,
    pub toughness: Option<i32>,
    pub add_types: Vec<String>,
    pub add_keywords: Vec<String>,
    pub colors: Option<Vec<String>>,
    pub overwrite_types: bool,
}

/// Parse shared animate parameters from a spell ability.
/// Used by both `animate_effect` and `animate_all_effect`.
pub fn parse_animate_params(sa: &SpellAbility) -> AnimateParams {
    AnimateParams {
        power: sa.ir.animate_power,
        toughness: sa.ir.animate_toughness,
        add_types: sa
            .ir
            .animate_types_text
            .as_deref()
            .map(|types| types.split(',').map(|s| s.trim().to_string()).collect())
            .unwrap_or_default(),
        add_keywords: sa
            .ir
            .animate_keywords_text
            .as_deref()
            .map(|kws| kws.split(',').map(|s| s.trim().to_string()).collect())
            .unwrap_or_default(),
        colors: sa
            .ir
            .animate_colors_text
            .as_deref()
            .map(|colors| colors.split(',').map(|s| s.trim().to_string()).collect()),
        overwrite_types: sa.ir.animate_overwrite_types,
    }
}

/// Apply animate effects to a single card.
/// Mirrors Java's `AnimateEffectBase.doAnimate(Card, SpellAbility, ...)`.
///
/// Sets the card's power/toughness, adds types, keywords, and colors
/// as specified by the parsed AnimateParams.
pub fn do_animate(
    game: &mut crate::game::GameState,
    card_id: crate::ids::CardId,
    params: &AnimateParams,
    _sa: &SpellAbility,
) {
    let card = game.card_mut(card_id);

    // Set power/toughness if specified
    if let Some(power) = params.power {
        card.add_new_pt(power, params.toughness.unwrap_or(card.toughness()));
    } else if let Some(toughness) = params.toughness {
        card.add_new_pt(card.power(), toughness);
    }

    // Add types
    if params.overwrite_types {
        card.type_line.core_types.clear();
    }
    for type_name in &params.add_types {
        if let Some(core_type) = forge_foundation::CoreType::from_name(type_name) {
            card.type_line.core_types.insert(core_type);
        } else {
            // Treat as subtype
            if !card
                .type_line
                .subtypes
                .iter()
                .any(|s| s.eq_ignore_ascii_case(type_name))
            {
                card.type_line.subtypes.push(type_name.clone());
            }
        }
    }

    // Add keywords
    for kw in &params.add_keywords {
        if !card.granted_keywords.contains_string_ignore_case(kw) {
            card.granted_keywords.add(kw);
        }
    }

    // Set colors if specified
    if let Some(ref colors) = params.colors {
        let mut color_set = forge_foundation::ColorSet::COLORLESS;
        for color_name in colors {
            color_set = color_set.union(forge_foundation::ColorSet::from_names(color_name));
        }
        card.color = color_set;
    }
}

/// Run the animate effect (entry point that parses params then applies).
/// Mirrors Java's `AnimateEffectBase.run()`.
pub fn run(ctx: &mut super::EffectContext, sa: &SpellAbility, target_cards: &[crate::ids::CardId]) {
    let params = parse_animate_params(sa);
    for &card_id in target_cards {
        do_animate(ctx.game, card_id, &params, sa);
    }
}

/// Resolve the animate effect for targeted/defined cards.
/// Mirrors Java's `AnimateEffectBase.resolve()`.
pub fn resolve(ctx: &mut super::EffectContext, sa: &SpellAbility) {
    let target_cards = crate::ability::spell_ability_effect::get_target_cards(ctx.game, sa);
    run(ctx, sa, &target_cards);
}
