use forge_foundation::mana::ManaAtom;

use super::EffectContext;
use crate::card::card_util;
use crate::mana::{color_name_to_mana_atom, Mana};

/// Configure the spell ability during construction.
/// Mirrors Java `ManaReflectedEffect.buildSpellAbility` — creates the
/// `AbilityManaPart` from the SA's params and marks as undoable if it
/// has no parent ability.
pub fn build_spell_ability(sa: &mut crate::spellability::SpellAbility) {
    // Set up the mana part from Produced$ parameter
    let produced = sa
        .produced_ir()
        .map(crate::ability::ProducedMana::as_script_text)
        .unwrap_or("Any".into());
    let restriction = sa.ir.restrict_valid.as_deref().unwrap_or("").to_string();
    sa.mana_part = Some(crate::spellability::AbilityManaPart::new(
        &produced,
        &restriction,
    ));
    sa.is_mana_ability = true;
}

/// Resolve DB$ ManaReflected — produce mana of a color/type that reflects other cards.
/// Mirrors Java's ManaReflectedEffect.java.
///
/// Key params:
/// - ReflectProperty$: "Is" (card colors), "Produce" (mana abilities), "Produced" (trigger mana)
/// - ColorOrType$: "Color" (5 colors) or "Type" (6 = 5 colors + colorless)
/// - Valid$: filter for which cards to check
/// - Amount$: how many mana to produce (default 1)
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ManaReflectedEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ManaReflectedEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let player = sa.activating_player;
    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    let amount = super::resolve_numeric_svar(ctx.game, sa, "Amount", 1);
    if amount <= 0 {
        return;
    }

    let mut available_colors =
        colors_from_names(card_util::get_reflectable_mana_colors(ctx.game, sa));
    let color_or_type = sa.ir.color_or_type.as_deref().unwrap_or("Color");
    if color_or_type == "Type" && !available_colors.contains(&ManaAtom::COLORLESS) {
        available_colors.push(ManaAtom::COLORLESS);
    }

    if available_colors.is_empty() {
        return;
    }

    // Read metadata from the ability
    let restriction = sa.ir.restrict_valid.clone();
    let source_is_snow = ctx.game.card(source_id).type_line.is_snow();

    // Sort available colors in WUBRG(C) order to match Java's ColorSet iteration.
    let wubrg_order: &[u16] = &[
        ManaAtom::WHITE,
        ManaAtom::BLUE,
        ManaAtom::BLACK,
        ManaAtom::RED,
        ManaAtom::GREEN,
        ManaAtom::COLORLESS,
    ];
    let mut sorted_colors: Vec<u16> = Vec::new();
    for &atom in wubrg_order {
        if available_colors.contains(&atom) {
            sorted_colors.push(atom);
        }
    }
    if sorted_colors.is_empty() {
        sorted_colors = available_colors;
    }

    // Convert to color names and let the agent choose (mirrors Java's chooseColor).
    let color_names: Vec<String> = sorted_colors
        .iter()
        .map(|&atom| match atom {
            ManaAtom::WHITE => "White".to_string(),
            ManaAtom::BLUE => "Blue".to_string(),
            ManaAtom::BLACK => "Black".to_string(),
            ManaAtom::RED => "Red".to_string(),
            ManaAtom::GREEN => "Green".to_string(),
            ManaAtom::COLORLESS => "Colorless".to_string(),
            _ => "Colorless".to_string(),
        })
        .collect();

    let express_choice = sa
        .express_mana_choice
        .filter(|atom| sorted_colors.contains(atom))
        .or_else(|| {
            sa.mana_part
                .as_ref()
                .map(|part| part.last_express_choice())
                .filter(|choice| !choice.is_empty())
                .and_then(color_name_to_mana_atom)
                .filter(|atom| sorted_colors.contains(atom))
        });

    let best_color = if let Some(atom) = express_choice {
        atom
    } else if let Some(chosen_name) = ctx.agents[player.index()].choose_color(player, &color_names)
    {
        match chosen_name.as_str() {
            "White" => ManaAtom::WHITE,
            "Blue" => ManaAtom::BLUE,
            "Black" => ManaAtom::BLACK,
            "Red" => ManaAtom::RED,
            "Green" => ManaAtom::GREEN,
            "Colorless" => ManaAtom::COLORLESS,
            _ => sorted_colors[0],
        }
    } else {
        sorted_colors[0]
    };

    // Produce `amount` mana of the chosen color
    for _ in 0..amount {
        let mut m = Mana::simple(best_color);
        m.source_card = Some(source_id);
        m.is_snow = source_is_snow;
        m.restriction = restriction.clone();
        ctx.mana_pools[player.index()].add_mana(m);
    }
}

fn colors_from_names(colors: std::collections::HashSet<String>) -> Vec<u16> {
    let mut out = Vec::new();
    for color in colors {
        let atom = match color.as_str() {
            "white" | "White" => Some(ManaAtom::WHITE),
            "blue" | "Blue" => Some(ManaAtom::BLUE),
            "black" | "Black" => Some(ManaAtom::BLACK),
            "red" | "Red" => Some(ManaAtom::RED),
            "green" | "Green" => Some(ManaAtom::GREEN),
            "colorless" | "Colorless" => Some(ManaAtom::COLORLESS),
            _ => None,
        };
        if let Some(atom) = atom {
            if !out.contains(&atom) {
                out.push(atom);
            }
        }
    }
    out
}
