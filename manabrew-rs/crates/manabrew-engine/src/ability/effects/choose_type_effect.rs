use super::EffectContext;
use crate::game::TypeRegistry;

/// `SP$ ChooseType` — the activating player chooses a creature type, card type, etc.
/// Stores the result in `source.chosen_type` for subsequent effects.
///
/// Mirrors Java's `ChooseTypeEffect.java`.
/// - `Type$` — the category of type to choose: "Creature", "Card", "Land", etc.
/// - `ValidTypes$` — optional comma-separated list of valid types (overrides auto-list).
///
/// # Card script examples
/// ```text
/// A:SP$ ChooseType | Type$ Creature
/// A:SP$ ChooseType | Type$ Card | ValidTypes$ Artifact,Creature,Enchantment,Land,Planeswalker
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseTypeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseTypeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let type_category = sa
        .ir
        .type_filter
        .clone()
        .unwrap_or_else(|| "Creature".to_string());

    // Build the valid types list
    let valid_types: Vec<String> = if let Some(vt) = sa.ir.valid_types_text.as_deref() {
        vt.split(',').map(|s| s.trim().to_string()).collect()
    } else {
        match type_category.as_str() {
            "Creature" => TypeRegistry::creature_types().to_vec(),
            "Basic Land" | "Land" => vec![
                "Plains".into(),
                "Island".into(),
                "Swamp".into(),
                "Mountain".into(),
                "Forest".into(),
            ],
            _ => vec![
                "Artifact".into(),
                "Creature".into(),
                "Enchantment".into(),
                "Instant".into(),
                "Land".into(),
                "Planeswalker".into(),
                "Sorcery".into(),
            ],
        }
    };

    if valid_types.is_empty() {
        return;
    }

    let chosen =
        ctx.agents[controller.index()].choose_type(controller, &type_category, &valid_types);

    if let Some(chosen_type) = chosen {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).set_chosen_type(
                Some(chosen_type),
                Some(controller),
                false,
            );
        }
    }
}
